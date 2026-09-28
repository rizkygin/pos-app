/**
 * How a counter sale was paid for — the cashier's side of
 * apps/backend/src/lib/pos-payment.ts. Keep the two lists in step: the value
 * chosen here is what the backend stores in orders.note.paymentMethod and what
 * every payment report groups on.
 *
 * 'non_cash' is not offered. It is what the POS wrote before this split
 * existed, when every card, QRIS and transfer sale was one undifferentiated
 * bucket. Old orders keep it and still report under it; nothing new writes it.
 */
export const POS_PAYMENT_METHODS = [
  'cash',
  'qris',
  'debit',
  'credit',
  'transfer',
] as const;

export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];

/**
 * Three names per method, because they are read in three different widths:
 *   label — the full cashier-facing name, used wherever there is room
 *   chip  — fits a fifth of the 350px cart panel without truncating
 *   short — fits a 32-char thermal receipt line
 */
export const POS_PAYMENT_OPTIONS: {
  value: PosPaymentMethod;
  label: string;
  chip: string;
  short: string;
}[] = [
  { value: 'cash', label: 'Tunai', chip: 'Tunai', short: 'TUNAI' },
  { value: 'qris', label: 'QRIS', chip: 'QRIS', short: 'QRIS' },
  { value: 'debit', label: 'Debit (EDC)', chip: 'Debit', short: 'DEBIT' },
  { value: 'credit', label: 'Kredit (EDC)', chip: 'Kredit', short: 'KREDIT' },
  { value: 'transfer', label: 'Transfer', chip: 'Transfer', short: 'TRANSFER' },
];

/**
 * Bayar Campuran: one sale paid several ways. The order's paymentMethod reads
 * 'mixed' and note.payments lists what each method covered. Never offered as
 * a chip — the cashier builds the tender list instead. See the backend's
 * lib/pos-payment.ts for how each tender is booked.
 */
export const MIXED_PAYMENT = 'mixed';

/** What one method covered of a mixed sale. Amounts sum to the bill. */
export type PosTender = { method: PosPaymentMethod; amount: number };

/** The most rows one sale takes; the backend refuses more (MAX_TENDERS there). */
export const MAX_TENDERS = 10;

const LABELS: Record<string, string> = {
  ...Object.fromEntries(POS_PAYMENT_OPTIONS.map((o) => [o.value, o.label])),
  // Legacy rows, still readable.
  non_cash: 'Non-Tunai',
  [MIXED_PAYMENT]: 'Campuran',
};

export const posPaymentLabel = (v: string) => LABELS[v] ?? v;

/** Everything that isn't physical money in the drawer. */
export const isCashMethod = (v: string) => v === 'cash';

/**
 * A bill in N equal shares, as the pre-bill prints them: everyone but the last
 * pays the rounded-up share ("Rp X/org"), the last pays what is left, so the
 * shares sum to the bill exactly and match the slip the table was handed.
 */
export function evenShares(total: number, n: number): number[] {
  if (!(n > 1) || !(total > 0)) return [Math.max(0, total)];
  const share = Math.ceil(total / n);
  // Greedy, so a tiny bill split many ways (Rp 5 among 4: 2, 2, 1) runs out
  // of money before it runs out of people instead of handing out a zero or a
  // negative tender.
  const shares: number[] = [];
  for (let left = total; left > 0; left -= share) shares.push(Math.min(share, left));
  return shares;
}
