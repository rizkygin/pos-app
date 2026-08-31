/**
 * How a counter sale was paid for.
 *
 * These are the values the cashier writes into orders.note.paymentMethod. That
 * is JSON free text, not a column, so widening this list needs no migration —
 * but it does have consequences in two places, both deliberate:
 *
 *   - routes/reports.ts groups the payment segment report on the raw value via
 *     an expression index (migration 0059). New values simply become new
 *     buckets there; the index still matches because the EXPRESSION is
 *     unchanged. Do not "tidy" that grouping into a CASE over this list —
 *     that is the change that stops the index matching and turns the report
 *     into a sequential scan of every order the outlet ever took.
 *
 *   - LEGACY is what the POS wrote before this existed: every non-cash sale,
 *     of any kind, was one undifferentiated 'non_cash'. Those rows are still
 *     out there and must keep reporting under their own name. Nothing
 *     backfills them, because the information to split them was never
 *     captured — a QRIS sale from last month is not recoverable from a row
 *     that only ever said "not cash".
 */
export const POS_PAYMENT_METHODS = [
  'cash',
  'qris',
  'debit',
  'credit',
  'transfer',
] as const;

export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];

/** The pre-split value. Accepted on read, never written again. */
export const LEGACY_NON_CASH = 'non_cash';

/**
 * Coerce untrusted input to a known method. Anything unrecognised becomes
 * 'cash', which is what every sale was booked as before any of this existed —
 * and 'non_cash' is passed through rather than mapped, so a client that hasn't
 * shipped the new picker yet keeps writing the value its own reports expect.
 */
export function parsePosPaymentMethod(v: unknown): string {
  if (typeof v !== 'string') return 'cash';
  if (v === LEGACY_NON_CASH) return LEGACY_NON_CASH;
  return (POS_PAYMENT_METHODS as readonly string[]).includes(v) ? v : 'cash';
}

/**
 * Which side of the cashflow ledger a sale lands on.
 *
 * The ledger only knows cash vs transfer: what matters to it is whether
 * physical money entered the drawer, because that is the number a cash count
 * has to reconcile against. Everything that isn't notes and coins is
 * 'transfer', however it was actually tendered — the finer label survives on
 * the order itself.
 *
 * This mirrors cashflowTypeFor in routes/invoices.ts, which makes the same
 * split for invoice payments.
 */
export function posCashflowTypeFor(method: string) {
  return method === 'cash' ? ('cash' as const) : ('transfer' as const);
}

/** Report labels. The keys are machine values; these are what a human reads. */
// Kept short on purpose: these print on a 32-character line next to a rupiah
// figure and a transaction count, and the label is the part that gets trimmed
// when they don't all fit.
export const POS_PAYMENT_LABELS: Record<string, string> = {
  cash: 'TUNAI',
  qris: 'QRIS',
  debit: 'DEBIT (EDC)',
  credit: 'KREDIT (EDC)',
  transfer: 'TRANSFER',
  [LEGACY_NON_CASH]: 'NON-TUNAI',
};

export const posPaymentLabel = (v: string) =>
  POS_PAYMENT_LABELS[v] ?? v.toUpperCase();
