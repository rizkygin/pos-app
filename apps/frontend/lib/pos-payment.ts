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

const LABELS: Record<string, string> = {
  ...Object.fromEntries(POS_PAYMENT_OPTIONS.map((o) => [o.value, o.label])),
  // Legacy rows, still readable.
  non_cash: 'Non-Tunai',
};

export const posPaymentLabel = (v: string) => LABELS[v] ?? v;

/** Everything that isn't physical money in the drawer. */
export const isCashMethod = (v: string) => v === 'cash';
