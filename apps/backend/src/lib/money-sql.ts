import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Money in this schema is stored as TEXT, not numeric: orderDetails.summary_price
 * is varchar(10), products.buying_price is varchar(15), and neither carries a
 * CHECK constraint. So every arithmetic use of them is a cast that can throw.
 *
 * The failure mode is what makes this worth a shared helper. `''::numeric`
 * raises "invalid input syntax for type numeric", and because that fires during
 * evaluation it aborts the ENTIRE statement — one blank purchase price on one
 * product takes down a whole three-month report, not just its own line. The
 * product form posts an empty string when the owner leaves the purchase-price
 * field blank (see addproducts/products-manager.tsx), so this is a routine data
 * state, not a corruption.
 *
 * Note that NULL is NOT the hazard and never was: `null::numeric` yields NULL
 * and sum() skips it. Only non-numeric TEXT throws. Both columns are NOT NULL
 * anyway.
 *
 * This is a crash guard, NOT a correctness check, and it cannot be made into
 * one. '1.000' is a valid numeric literal meaning ONE, so a row where somebody
 * meant "seribu" passes through and is reported as 1. No regex can distinguish
 * that from a genuine decimal. The real fix for bad values is validation at the
 * write path plus a CHECK constraint; this only ensures reads never 500.
 */
export const money = (col: AnyColumn | SQL) =>
  sql`(case when ${col} ~ '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$' then cast(${col} as numeric) else 0 end)`;

/**
 * Everything taken off a counter sale at the ORDER level: the cashier's manual
 * discount, an outlet promo code, and points redeemed. Lines (summary_price)
 * never know about any of it, so revenue read off the lines alone is gross of
 * every discount and profit is overstated by exactly that amount — for a
 * heavily points-paid sale, by the whole bill.
 *
 * One definition, used by the shift close, the owner dashboard and the sales
 * report, so a day can never show three different revenues. It reads
 * note.discountAmount, which the checkout handler writes as the TOTAL
 * (manual + promo + points; see routes/mutations.ts) — the frozen breakdown
 * columns on orders exist for receipts and audits, not for this.
 *
 * `o` is the SQL alias of the orders row (e.g. sql`o`). Same crash guard as
 * `money` above, applied to a JSON value: note is untyped and a non-numeric
 * string would abort the whole statement rather than just its own row.
 */
export const orderDiscount = (o: SQL) =>
  sql`(case when (${o}.note ->> 'discountAmount') ~ '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$'
            then (${o}.note ->> 'discountAmount')::numeric else 0 end)`;

/**
 * One line's revenue NET of its share of the order-level discount.
 *
 * `orderDiscount` is a fact about the order; anything that aggregates LINES
 * (a product ranking, an hourly chart, a per-day trend) cannot subtract it
 * once per order without a second pass. So each line gives up its proportional
 * share — price × discount ÷ order gross — and the shares sum back to exactly
 * the order's discount. A 100%-discounted sale therefore contributes zero to
 * every product it contained, which is what "no omzet" has to mean per product
 * as well as per order.
 *
 * `line` is the line's price column, `orderId` its order_id, `o` the orders
 * alias joined in the query (sql`${ordersTable}` in the query builder). The
 * correlated sum is per line; every reader that uses this is already windowed
 * to a period, so the cost is bounded by the report, not the table.
 */
export const netLineRevenue = (line: AnyColumn | SQL, orderId: AnyColumn | SQL, o: SQL) => sql`(
  ${money(line)} - case when ${orderDiscount(o)} > 0
    then ${money(line)} * ${orderDiscount(o)}
         / nullif((select sum(${money(sql`d2.summary_price`)}) from "orderDetails" d2 where d2.order_id = ${orderId}), 0)
    else 0 end)`;
