import { sql, type SQL } from "drizzle-orm";
import { money } from "./money-sql";

// Cost of goods sold for ONE order.
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
// The third kind has no ledger cost and never will, so its cost has to come from
// buying_price. An earlier version of this coalesced ledger-or-fallback for the
// WHOLE order, which silently dropped exactly those lines whenever the order
// also contained a stock-moving one: a two-line sale reported only the half the
// ledger could see. Hence the split below — the ledger for what it covers, plus
// the fallback for precisely the lines it structurally cannot.
//
// `orderId` is whatever SQL expression identifies the order in the caller's
// query. Both readers share this so the dashboard and the reports page can never
// answer the same question differently.
//
// buying_price goes through money() for the reason every read of it does: it is
// a varchar that is routinely blank, and an unguarded cast aborts the whole
// statement rather than just its own row. See lib/money-sql.ts.

// Lines whose product cannot produce a stock movement, and therefore cannot
// produce a ledger cost. `not exists` over recipe_items rather than a column,
// because "has a recipe" is the thing that decides it.
const nonMovingLinesFallback = (orderId: SQL | string) => sql`
  (select coalesce(sum(${money(sql`p2.buying_price`)} * od2.quantity), 0)
     from "orderDetails" od2
     join products p2 on p2.id = od2.product_id
    where od2.order_id = ${orderId}
      and p2.track_stock = false
      and not exists (select 1 from recipe_items ri where ri.product_id = p2.id))
`;

const allLinesFallback = (orderId: SQL | string) => sql`
  (select coalesce(sum(${money(sql`p2.buying_price`)} * od2.quantity), 0)
     from "orderDetails" od2
     join products p2 on p2.id = od2.product_id
    where od2.order_id = ${orderId})
`;

export const orderCogsSql = (orderId: SQL | string) => sql`
  (case
     when exists (
       select 1 from stock_movements sm
        where sm.order_id = ${orderId}
          and sm.cost_change is not null
          and sm.reason in ('sales', 'void')
     )
     then
       -- Ledger cost for what moved, plus buying_price for the lines that
       -- structurally cannot move. Sales rows are negative and voids positive,
       -- so negating the sum makes a cancelled sale cost nothing with no special
       -- case.
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
