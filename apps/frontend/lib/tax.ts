/**
 * Counter tax arithmetic — the cashier's mirror of
 * apps/backend/src/lib/tax.ts. Keep the two in step.
 *
 * This side exists only to SHOW the customer what they will pay before the
 * order is posted. The figure that gets stored, booked to the drawer and
 * printed on the books is recomputed by the server from the outlet's own
 * settings and never taken from the request — so a drift between these two
 * files shows up as a cashier screen that disagrees with the receipt, not as a
 * wrong amount handed to the tax office.
 *
 * TAX SITS OUTSIDE THE LINE. Nothing here touches a line price.
 */

export type TaxConfig = {
  enabled: boolean;
  /** Percent, e.g. 10 for 10%. */
  rate: number;
  inclusive: boolean;
  label: string;
};

export const NO_TAX: TaxConfig = {
  enabled: false,
  rate: 0,
  inclusive: false,
  label: 'Pajak',
};

/** Read the settings off an outlet row, tolerating the untyped wire shape. */
export function taxConfigFrom(
  outlet:
    | {
        tax_enabled?: boolean | null;
        tax_rate?: string | number | null;
        tax_inclusive?: boolean | null;
        tax_label?: string | null;
      }
    | null
    | undefined,
  /** Plan gate. Below Max Lite there is no counter tax at all. */
  allowed = true,
): TaxConfig {
  if (!outlet || !allowed) return NO_TAX;
  const rate = Number(outlet.tax_rate ?? 0);
  const usable = Number.isFinite(rate) && rate > 0;
  return {
    enabled: outlet.tax_enabled === true && usable,
    rate: usable ? rate : 0,
    inclusive: outlet.tax_inclusive === true,
    label: outlet.tax_label?.trim() || 'Pajak',
  };
}

export type TaxResult = {
  /** Tax on this sale. 0 when the outlet charges none. */
  amount: number;
  /** What the customer pays. */
  total: number;
  /** Sales less the tax office's share — what the business earned. */
  revenue: number;
  /** Whether a tax line should be printed at all. */
  applies: boolean;
};

/**
 * `net` is subtotal minus discount: tax is charged on what the customer
 * actually pays, not on a price they were given a discount off.
 */
export function computeTax(net: number, config: TaxConfig): TaxResult {
  if (!config.enabled || !Number.isFinite(net) || net <= 0) {
    const safe = Math.max(0, net || 0);
    return { amount: 0, total: safe, revenue: safe, applies: false };
  }
  const amount = config.inclusive
    ? // Extract, don't add: an inclusive price already contains the tax, so the
      // share is net * r/(100+r). Using r/100 here is the classic bug and
      // overstates the tax by (100+r)/100.
      Math.round((net * config.rate) / (100 + config.rate))
    : Math.round((net * config.rate) / 100);

  return {
    amount,
    total: config.inclusive ? net : net + amount,
    revenue: config.inclusive ? net - amount : net,
    applies: true,
  };
}

/** Receipt/cart label: "PB1 10%". */
export const taxLineLabel = (config: TaxConfig) =>
  `${config.label} ${Number(config.rate.toFixed(2))}%`;
