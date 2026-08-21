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
