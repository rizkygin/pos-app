/**
 * Counter tax (PB1 / PPN): the one place the arithmetic lives.
 *
 * TAX SITS OUTSIDE THE LINE. Nothing here writes to orderDetails.summary_price
 * and nothing should: that column is the price the line sold at and is the
 * app's revenue column, read from ~47 places. Folding tax into it would restate
 * revenue and profit by the tax rate and make orders either side of the change
 * incomparable — see the note in db/schema.ts on ordersTable.
 *
 * Two modes, and the difference is only which side of the menu price the tax
 * sits on. On a 100.000 sale at 10%:
 *
 *   exclusive  customer pays 110.000 — revenue 100.000, tax 10.000
 *   inclusive  customer pays 100.000 — revenue  90.909, tax  9.091
 *
 * Both collect a real tax; they differ in what counts as income. Which matters
 * downstream, and asymmetrically:
 *
 *   exclusive  summary_price is already net of tax. EVERY existing revenue
 *              reader is correct with no change at all.
 *   inclusive  summary_price contains the tax. Revenue readers must SUBTRACT
 *              orders.tax_amount, or they report the tax office's money as
 *              sales. Readers that show what the CUSTOMER was charged (a
 *              receipt, an order-detail line) are correct as they stand.
 */

export type TaxConfig = {
  enabled: boolean;
  /** Percent, e.g. 10 for 10%. */
  rate: number;
  inclusive: boolean;
  label: string;
};

export type TaxResult = {
  /** null when no tax applied — NOT zero. See the schema note. */
  rate: number | null;
  amount: number | null;
  inclusive: boolean | null;
  /**
   * What the customer actually hands over, and therefore what the cashflow
   * ledger must book. Exclusive adds the tax on top; inclusive was already
   * paying it, so the total is unchanged.
   */
  total: number;
  /**
   * Revenue for this order once the tax office's share is removed. Equals
   * `net` under exclusive (the tax was never in it) and `net - amount` under
   * inclusive.
   */
  revenue: number;
};

/**
 * Read an outlet row's tax settings.
 *
 * A malformed or negative rate is treated as "no tax" rather than throwing: a
 * sale must never fail at the counter because a settings field is wrong. A rate
 * of 0 with tax enabled is also no tax — there is nothing to charge and nothing
 * to print.
 */
export function taxConfigFrom(outlet: {
  tax_enabled?: boolean | null;
  tax_rate?: string | number | null;
  tax_inclusive?: boolean | null;
  tax_label?: string | null;
}): TaxConfig {
  const rate = Number(outlet.tax_rate ?? 0);
  const usable = Number.isFinite(rate) && rate > 0;
  return {
    enabled: outlet.tax_enabled === true && usable,
    rate: usable ? rate : 0,
    inclusive: outlet.tax_inclusive === true,
    label: outlet.tax_label?.trim() || "Pajak",
  };
}

/**
 * Rupiah has no subunit in practice, so every tax figure is rounded to a whole
 * rupiah. Doing it in one place is what keeps the cashier's on-screen total,
 * the printed receipt and the stored order from disagreeing by a rupiah.
 */
const toRupiah = (n: number) => Math.round(n);

/**
 * Tax on an order whose discount has already been applied.
 *
 * `net` is subtotal minus discount — tax is charged on what the customer
 * actually pays, not on a price they were given a discount off.
 */
export function computeTax(net: number, config: TaxConfig): TaxResult {
  if (!config.enabled || !Number.isFinite(net) || net <= 0) {
    return { rate: null, amount: null, inclusive: null, total: Math.max(0, net || 0), revenue: Math.max(0, net || 0) };
  }

  const amount = config.inclusive
    ? // Extract: the price already contains the tax, so it is net * r/(100+r),
      // NOT net * r/100. Using the latter is the classic inclusive-pricing bug
      // and over-reports the tax by a factor of (100+r)/100.
      toRupiah((net * config.rate) / (100 + config.rate))
    : toRupiah((net * config.rate) / 100);

  return {
    rate: config.rate,
    amount,
    inclusive: config.inclusive,
    total: config.inclusive ? net : net + amount,
    revenue: config.inclusive ? net - amount : net,
  };
}
