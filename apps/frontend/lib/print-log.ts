import { API_URL } from '@/lib/api-url';

/**
 * The server's copy of a slip printed before its sale is booked — the
 * cashier's pre-checkout struk, a table's Cetak Bill. Checkout later stamps
 * the order on it; one left without is a slip that was handed over and never
 * paid. See print_logs in the backend's db/schema.ts.
 */
export type PrintLogLine = {
  /** The cart line (a table line's id on a table) — what checkout matches on. */
  lineId: string;
  name: string;
  variant: string | null;
  qty: number;
  /** Unit price as printed, before add-ons. */
  price: number;
  addons: { name: string; qty: number; price: number }[];
};

export type PrintLog = {
  kind: 'receipt' | 'table_bill';
  /** The till tab — required for the cashier's struk. */
  tabKey?: string;
  sessionId?: string;
  billNo?: number | null;
  /** Table labels or the pager number, as printed. */
  label?: string;
  customer?: string;
  lines: PrintLogLine[];
  total: number;
};

/**
 * A product's price as the slip prints it: the markdown when there is one. 0
 * for a price that doesn't parse — the print must still be logged.
 */
export const printedUnitPrice = (p: { price: string; price_mark_down?: string | null }) => {
  const n = p.price_mark_down && p.price_mark_down !== '0' ? parseFloat(p.price_mark_down) : parseFloat(p.price);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Fire and forget: printing never waits on it or fails over it. keepalive so
 * the request survives the page being backgrounded — on Android, printing
 * hands off to the print app the same moment this is sent. A keepalive body is
 * capped at 64 KB, so an outsized cart goes without it rather than not at all.
 */
export function logPrint(log: PrintLog) {
  if (!log.lines.length) return;
  const body = JSON.stringify(log);
  fetch(`${API_URL}/api/print-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    keepalive: body.length < 60_000,
    body,
  }).catch(() => {});
}

// ─── Laporan: Struk Belum Dibayar ───────────────────────────────────────────

/** How a printed slip ended up. See printLogReport in the backend's lib/print-log.ts. */
export type SlipStatus = 'unpaid' | 'pending' | 'cancelled' | 'short' | 'paid';

/**
 * Words and colours for each status, shared by the report and its Panduan
 * guide so a badge read in one is recognised in the other.
 */
export const SLIP_STATUS: Record<SlipStatus, { label: string; className: string }> = {
  unpaid: { label: 'Belum dibayar', className: 'bg-destructive/10 text-destructive' },
  short: { label: 'Kurang ditagih', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  cancelled: { label: 'Dibatalkan', className: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
  pending: { label: 'Menunggu checkout', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  paid: { label: 'Lunas', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
};

/** Mirrors PRINT_PENDING_MINUTES in the backend. */
export const PRINT_PENDING_MINUTES = 60;

export const PRINT_LOG_GUIDE = '/dashboard/panduan/struk-belum-dibayar';
export const PRINT_LOG_REPORT = '/dashboard/reports/struk';
