import { sql, type SQL } from "drizzle-orm";
import { money } from "./money-sql";

// Cost of goods sold for ONE order, read from the cost ledger with a fallback.
//
// Two sources, in priority order, and the fallback is not optional:
//
//   1. The ledger. stock_movements.cost_change carries the money side of every
//      movement, frozen at the moment it happened, so this is what the goods
//      actually cost when they left — not what a price list says today. Sales
//      rows are negative and void rows positive, so negating the sum makes a
//      cancelled sale cost nothing without any special case.
//   2. products.buying_price * quantity, the old live join. Needed because two
//      whole classes of order have no ledger rows at all:
//        * orders placed before migration 0063,
//        * orders from the customer app, which have never moved stock (only the
//          POS and invoice paths call applySaleStockOut).
//      Dropping the fallback would silently report those as pure profit.
//
// `orderId` is whatever SQL expression identifies the order in the caller's
// query. Both readers share this so the dashboard and the reports page can never
// answer the same question differently.
//
// The fallback goes through money() for the same reason every other read of
// buying_price does: it is a varchar that is routinely blank, and an unguarded
// cast aborts the whole statement, not just its own row. See lib/money-sql.ts.
export const orderCogsSql = (orderId: SQL | string) => sql`
  coalesce(
    (select -sum(sm.cost_change)
       from stock_movements sm
      where sm.order_id = ${orderId}
        and sm.cost_change is not null
        and sm.reason in ('sales', 'void')),
    (select coalesce(sum(${money(sql`p2.buying_price`)} * od2.quantity), 0)
       from "orderDetails" od2
       join products p2 on p2.id = od2.product_id
      where od2.order_id = ${orderId}),
    0
  )
`;
