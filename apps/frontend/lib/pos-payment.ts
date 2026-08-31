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

/** Cashier-facing name, and the short one that fits a 32-char receipt line. */
export const POS_PAYMENT_OPTIONS: {
  value: PosPaymentMethod;
  label: string;
  short: string;
}[] = [
  { value: 'cash', label: 'Tunai', short: 'TUNAI' },
  { value: 'qris', label: 'QRIS', short: 'QRIS' },
  { value: 'debit', label: 'Debit (EDC)', short: 'DEBIT' },
  { value: 'credit', label: 'Kredit (EDC)', short: 'KREDIT' },
  { value: 'transfer', label: 'Transfer', short: 'TRANSFER' },
];

const LABELS: Record<string, string> = {
  ...Object.fromEntries(POS_PAYMENT_OPTIONS.map((o) => [o.value, o.label])),
  // Legacy rows, still readable.
  non_cash: 'Non-Tunai',
};

export const posPaymentLabel = (v: string) => LABELS[v] ?? v;

/** Everything that isn't physical money in the drawer. */
export const isCashMethod = (v: string) => v === 'cash';
