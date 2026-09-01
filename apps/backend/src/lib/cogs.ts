import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { money } from "./money-sql";

// Cost of goods sold, read two ways: orderCogsSql for a whole order, and
// lineCogsSql for a single line. Both are built from the same pieces below,
// because a dashboard and a report that disagree about cost are worse than
// either being wrong on its own.
//
// The hard part is that cost coverage is per LINE, not per order: some lines
// leave a cost trail in the ledger and some cannot, and the same order routinely
// contains both. Three kinds of line exist —
//
//   * a product that tracks its own stock          -> one movement, ledger cost
//   * a composition (track_stock=false + a recipe) -> movements against its
//                                                     INGREDIENTS, ledger cost
//   * track_stock=false with NO recipe             -> moves nothing, ever. A
//                                                     valid permanent state: a
//                                                     service, a fee, an item
//                                                     nobody counts.
//
// The third kind has no ledger cost and never will, so its cost comes from the
// price frozen on the line when it was sold (orderDetails.unit_cost, migration
// 0065), falling back to the live products.buying_price where no price was on
// record at the time.
//
// THE QUESTION THIS FILE EXISTS TO ANSWER is which kind a given line is, and
// there are two ways to answer it. Every version before migration 0066 asked
// the PRODUCT: is track_stock false, and does it have no recipe? That reads the
// product as it stands today to describe a sale that happened months ago, so
// the answer changes when the owner changes their mind. Flip a sold product
// from track_stock true to false and its old orders start counting that line
// twice — once from the movement still sitting in the ledger, once from the
// fallback that now matches it. Flip it the other way and the line disappears
// from both halves instead. Neither is visible; both rewrite closed months.
//
// Since 0066 the question is asked of HISTORY instead: every movement a sale
// writes carries the orderDetails row that caused it, ingredient movements of a
// composition included. So a line is costed from the movements tagged to it, and
// a line with none never moved anything and is costed from its frozen price. No
// product column is read, and no later edit can change the answer.
//
// The pre-0066 shape is kept below for orders written before the tag existed —
// gated on whether the order has any tagged movement at all, so the two never
// mix and nothing needs backfilling.
//
// `orderId` is whatever SQL expression identifies the order in the caller's
// query. Both readers share this so the dashboard and the reports page can never
// answer the same question differently.
//
// buying_price goes through money() for the reason every read of it does: it is
// a varchar that is routinely blank, and an unguarded cast aborts the whole
// statement rather than just its own row. See lib/money-sql.ts.

// What one unit of a line costs, for a line the ledger cannot cost.
//
// orderDetails.unit_cost is the price frozen when the line was written
// (migration 0065). It is NULL for lines written before that column existed,
// and for lines whose product had no price on record at the time — blank or
// zero buying_price, a routine state. NULL falls back to the LIVE buying_price,
// which is what every reader did before 0065: imperfect, but it starts telling
// the truth the day a real price is entered, where a frozen zero never would.
//
// Written against whatever columns the caller can name, because the same two
// expressions are needed from two different vantage points: the order-scoped
// readers below introduce their own `od2`/`p2` aliases inside a subquery, while
// lineCogsSql is spliced into a caller's existing FROM. Parameterising the refs
// is what keeps those from drifting into two answers.
type Ref = AnyColumn | SQL;

const unitCostOf = (unitCost: Ref, buyingPrice: Ref) =>
  sql`coalesce(${unitCost}, ${money(buyingPrice)})`;

// Sales rows are negative and voids positive, so negating the sum makes a
// cancelled line cost nothing with no special case.
const ledgerCostOf = (lineId: Ref) => sql`
  (select -sum(sm.cost_change)
     from stock_movements sm
    where sm.order_detail_id = ${lineId}
      and sm.cost_change is not null
      and sm.reason in ('sales', 'void'))
`;

// The pair bound to the aliases the order-scoped subqueries below introduce.
const lineCost = unitCostOf(sql`od2.unit_cost`, sql`p2.buying_price`);
const taggedLedgerCost = ledgerCostOf(sql`od2.id`);

// ── Since 0066: cost every line from what it actually did ───────────────────
//
// The coalesce IS the branch. sum() over no rows is NULL, not 0, so a line that
// moved nothing falls through to its frozen price — while a line whose sale and
// void cancel out sums to a real 0 and correctly keeps it.
const perLineCogs = (orderId: SQL | string) => sql`
  (select coalesce(sum(coalesce(${taggedLedgerCost}, ${lineCost} * od2.quantity)), 0)
     from "orderDetails" od2
     join products p2 on p2.id = od2.product_id
    where od2.order_id = ${orderId})
`;

// ── Pre-0066 only, from here down ───────────────────────────────────────────

// Lines whose product cannot produce a stock movement, and therefore cannot
// produce a ledger cost. `not exists` over recipe_items rather than a column,
// because "has a recipe" is the thing that decides it. This is the guess the
// tag replaced; it survives only for orders whose movements predate the tag.
const nonMovingLinesFallback = (orderId: SQL | string) => sql`
  (select coalesce(sum(${lineCost} * od2.quantity), 0)
     from "orderDetails" od2
     join products p2 on p2.id = od2.product_id
    where od2.order_id = ${orderId}
      and p2.track_stock = false
      and not exists (select 1 from recipe_items ri where ri.product_id = p2.id))
`;

const allLinesFallback = (orderId: SQL | string) => sql`
  (select coalesce(sum(${lineCost} * od2.quantity), 0)
     from "orderDetails" od2
     join products p2 on p2.id = od2.product_id
    where od2.order_id = ${orderId})
`;

// The value to stamp on a NEW order line, resolved in the insert itself so the
// write path costs no extra round trip. The scalar subquery yields NULL when
// the product has no usable price — the `> 0` makes it match no row rather than
// freeze a zero — which is exactly what lineCost above treats as "fall back".
//
// Deliberately the same rule, via the same money() regex, as the 0065 backfill:
// a price stamped here and a price stamped there are accepted or rejected
// identically, so a line written the day of the deploy cannot disagree with one
// written the day before it.
export const lineUnitCostSql = (productId: SQL | string) => sql`
  (select ${money(sql`p.buying_price`)}
     from products p
    where p.id = ${productId}
      and ${money(sql`p.buying_price`)} > 0)
`;

export const orderCogsSql = (orderId: SQL | string) => sql`
  (case
     -- Which era wrote this order. A tagged movement can only have come from a
     -- sale posted after 0066, so its presence is the whole test.
     --
     -- An order with NO movements at all lands in the pre-0066 branch whichever
     -- era wrote it — an app order, or a counter sale of nothing but services.
     -- That is not a misroute: with nothing tagged, every line falls back in
     -- both branches, and allLinesFallback below is exactly what perLineCogs
     -- would reduce to.
     when exists (
       select 1 from stock_movements sm
        where sm.order_id = ${orderId}
          and sm.order_detail_id is not null
     )
     then ${perLineCogs(orderId)}

     when exists (
       select 1 from stock_movements sm
        where sm.order_id = ${orderId}
          and sm.cost_change is not null
          and sm.reason in ('sales', 'void')
     )
     then
       -- Pre-0066: ledger cost for the whole order, plus buying_price for the
       -- lines product config says structurally cannot move. Sales rows are
       -- negative and voids positive, so negating the sum makes a cancelled
       -- sale cost nothing with no special case.
       coalesce((select -sum(sm.cost_change)
                   from stock_movements sm
                  where sm.order_id = ${orderId}
                    and sm.cost_change is not null
                    and sm.reason in ('sales', 'void')), 0)
       + ${nonMovingLinesFallback(orderId)}
     else
       -- No ledger cost at all: an order placed before the ledger existed, or
       -- one that never moved stock (app orders don't). The whole order falls
       -- back, non-moving lines included — adding them again here would double
       -- count them.
       ${allLinesFallback(orderId)}
   end)
`;


// Cost of goods sold for ONE LINE, for a caller that groups by something
// narrower than an order — currently the dashboard's top-products table, which
// groups by product.
//
// This is the same per-line coalesce perLineCogs applies inside an order,
// pointed at the caller's own columns instead of at `od2`/`p2`. It can exist at
// all only because of 0066: before the tag, a composition's movements were
// written against its INGREDIENTS with nothing linking them back to the dish,
// so cost could attach to an order and no finer. With the tag, "what did THIS
// line cost" is a question history answers.
//
// No era gate, unlike orderCogsSql. The gate there earns its keep by letting a
// pre-0066 order still use its order-level ledger sum; there is no line-level
// equivalent to fall back to, so a pre-0066 line simply takes its frozen price
// — which is exactly what this caller did for EVERY line before today. Those
// orders therefore read slightly lower here than in the order-level total, and
// age out as pre-0066 history does.
//
// Deliberately NOT matching pre-0066 movements on (order_id, product_id). For a
// tracked product that would work, and grouping by product would even absorb an
// order that lists the same product twice. But a composition's movements carry
// the INGREDIENT's product_id, so a nasi goreng's cost would land on beras and
// the dish itself would show a 100% margin. The uniform fallback is wrong by an
// amount the owner can reason about; that would be wrong in a way that reads as
// a discovery about the business.
export const lineCogsSql = (line: {
  id: Ref;
  unitCost: Ref;
  quantity: Ref;
  buyingPrice: Ref;
}) => sql`
  coalesce(
    ${ledgerCostOf(line.id)},
    ${unitCostOf(line.unitCost, line.buyingPrice)} * ${line.quantity}
  )
`;
