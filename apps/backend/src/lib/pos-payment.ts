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

/**
 * One sale paid several ways (Bayar Campuran): a table splitting its bill,
 * half cash and half QRIS. Written as orders.note.paymentMethod ONLY alongside
 * orders.note.payments — the list of what each method actually covered — and
 * never handed to posCashflowTypeFor: every tender books its own cash-in row
 * with its own type, which is what keeps the drawer honest.
 *
 * A single-tender sale never carries `payments`, so every order written before
 * this, and every till that doesn't send it, reads exactly as it always did.
 */
export const MIXED_PAYMENT = 'mixed';

export type PosTender = { method: PosPaymentMethod; amount: number };

export const MAX_TENDERS = 10;

/**
 * The `payments` field of a checkout body. `null` when there is none (a
 * single-method sale — the path every existing till takes), 'invalid' when it
 * is there but unusable, otherwise the tenders in the order given.
 *
 * Amounts are each tender's SHARE of the bill, not the cash handed over: the
 * change on a cash tender stays in amountPaid/changeDue like any cash sale.
 * Whether they add up to the bill can only be checked once the server has
 * priced it — see the checkout route.
 */
export function parsePosTenders(raw: unknown): PosTender[] | null | 'invalid' {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TENDERS) return 'invalid';
  const tenders: PosTender[] = [];
  for (const t of raw) {
    const method = (t as any)?.method;
    const amount = Math.round(Number((t as any)?.amount) * 100) / 100;
    if (!(POS_PAYMENT_METHODS as readonly string[]).includes(method)) return 'invalid';
    if (!Number.isFinite(amount) || amount <= 0) return 'invalid';
    tenders.push({ method, amount });
  }
  return tenders;
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
  [MIXED_PAYMENT]: 'CAMPURAN',
};

export const posPaymentLabel = (v: string) =>
  POS_PAYMENT_LABELS[v] ?? v.toUpperCase();
