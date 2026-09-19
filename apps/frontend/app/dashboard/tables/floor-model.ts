import type { TaxConfig } from '@/lib/tax';

/**
 * Manajemen Meja — the shapes GET /api/floor answers with, and the pure
 * derivations every part of the floor screen shares (what state a table is
 * in, what colour that is, how long it has been sat). Kept free of React so
 * the canvas, the side panel and the status strip can never disagree.
 */

/** The layout editor's fixed canvas. Mirrors CANVAS_W/H in routes/tables.ts. */
export const CANVAS_W = 900;
export const CANVAS_H = 620;
export const GRID = 20;

export type Wall = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'wall' | 'bar';
};

export type Zone = { id: number; name: string; sortOrder: number; walls: Wall[] };

export type FloorTable = {
  id: number;
  zoneId: number;
  label: string;
  capacity: number;
  shape: 'square' | 'round';
  x: number;
  y: number;
  w: number;
  h: number;
  sessionId: string | null;
  blockedAt: string | null;
  blockedReason: string | null;
  /** The booking holding this table right now, if any. */
  reservation: { id: number; guestName: string; pax: number; reservedAt: string } | null;
};

export type BillLine = {
  id: string;
  billNo: number;
  productId: string;
  name: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  addons: string[];
  note: string | null;
  sentQty: number;
};

export type FloorSession = {
  id: string;
  guestName: string | null;
  pax: number;
  status: 'open' | 'paid';
  version: number;
  seatedAt: string;
  billRequestedAt: string | null;
  alertAt: string | null;
  alertNote: string | null;
  splitCount: number | null;
  paidAt: string | null;
  tableIds: number[];
  /** Unpaid lines only. */
  lines: BillLine[];
  total: number;
  paidTotal: number;
  unsentQty: number;
};

export type Reservation = {
  id: number;
  guestName: string;
  phone: string | null;
  pax: number;
  reservedAt: string;
  tableId: number | null;
  tableLabel: string | null;
  note: string | null;
  status: 'booked' | 'seated' | 'cancelled' | 'no_show';
};

export type WaitEntry = {
  id: number;
  queueNo: number;
  guestName: string;
  phone: string | null;
  pax: number;
  note: string | null;
  calledAt: string | null;
  createdAt: string;
};

/**
 * The kitchen's Recall: a waiter is wanted at the pass for this ticket. Stays
 * until someone answers it (POST /api/kitchen/tickets/:id/ack).
 */
export type KitchenCall = {
  ticketId: number;
  ticketNo: number;
  source: 'table' | 'counter';
  /** The seating the ticket came from; null for a counter ticket. */
  sessionId: string | null;
  /** Table labels ("5+6") or the pager number. */
  label: string | null;
  customer: string | null;
  /** Why the kitchen called, when it said. */
  note: string | null;
  callAt: string;
  callCount: number;
  status: string;
  itemCount: number;
};

export type Floor = {
  serverTime: string;
  entitled: boolean;
  permissions: { tables: boolean; cashier: boolean; owner: boolean };
  outlet: {
    id: number;
    name: string;
    address: string;
    phone: string;
    avatar: string;
    overtimeMinutes: number;
    tax: TaxConfig;
  };
  shift: { cashierName: string; openedAt: string } | null;
  today: { dineIn: number; takeAway: number };
  zones: Zone[];
  tables: FloorTable[];
  sessions: FloorSession[];
  reservations: Reservation[];
  waitlist: WaitEntry[];
  kitchenCalls: KitchenCall[];
};

// ── Table state ──────────────────────────────────────────────────────────────

export type TableState =
  | 'available'
  | 'seated'
  | 'merged'
  | 'reserved'
  | 'overtime'
  | 'paid'
  | 'blocked';

export function isOvertime(session: FloorSession, now: number, overtimeMinutes: number) {
  return (
    session.status === 'open' &&
    now - new Date(session.seatedAt).getTime() > overtimeMinutes * 60_000
  );
}

/**
 * One state per table, in priority order: out of service beats everything,
 * then who is sitting there, then who is about to.
 */
export function tableState(
  table: FloorTable,
  session: FloorSession | undefined,
  now: number,
  overtimeMinutes: number,
): TableState {
  if (table.blockedAt) return 'blocked';
  if (session) {
    if (session.status === 'paid') return 'paid';
    if (isOvertime(session, now, overtimeMinutes)) return 'overtime';
    if (session.tableIds.length > 1) return 'merged';
    return 'seated';
  }
  if (table.reservation) return 'reserved';
  return 'available';
}

/**
 * Colours per state. Tailwind classes, not hex, so dark mode comes for free;
 * the occupied states are saturated fills that read the same on either theme.
 */
export const STATE_STYLE: Record<
  TableState,
  { label: string; fill: string; chair: string; ink: string; badge: string; pill: string }
> = {
  available: {
    label: 'Tersedia',
    fill: 'bg-card border-border',
    chair: 'bg-muted-foreground/25',
    ink: 'text-foreground',
    badge: 'bg-muted text-muted-foreground',
    pill: 'border-border text-foreground',
  },
  seated: {
    label: 'Terisi',
    fill: 'bg-blue-600 border-blue-700',
    chair: 'bg-blue-300 dark:bg-blue-400/70',
    ink: 'text-white',
    badge: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
    pill: 'border-blue-700 text-blue-700 dark:text-blue-300',
  },
  merged: {
    label: 'Gabung',
    fill: 'bg-cyan-600 border-cyan-700',
    chair: 'bg-cyan-200 dark:bg-cyan-400/70',
    ink: 'text-white',
    badge: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300',
    pill: 'border-cyan-700 text-cyan-700 dark:text-cyan-300',
  },
  reserved: {
    label: 'Reservasi',
    fill: 'bg-violet-600 border-violet-700',
    chair: 'bg-violet-300 dark:bg-violet-400/70',
    ink: 'text-white',
    badge: 'bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
    pill: 'border-violet-700 text-violet-700 dark:text-violet-300',
  },
  overtime: {
    label: 'Lewat Waktu',
    fill: 'bg-rose-600 border-rose-700',
    chair: 'bg-rose-300 dark:bg-rose-400/70',
    ink: 'text-white',
    badge: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
    pill: 'border-rose-700 text-rose-700 dark:text-rose-300',
  },
  paid: {
    label: 'Lunas',
    fill: 'bg-emerald-600 border-emerald-700',
    chair: 'bg-emerald-300 dark:bg-emerald-400/70',
    ink: 'text-white',
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    pill: 'border-emerald-700 text-emerald-700 dark:text-emerald-300',
  },
  blocked: {
    label: 'Diblokir',
    fill: 'bg-neutral-400 border-neutral-500 dark:bg-neutral-600 dark:border-neutral-500',
    chair: 'bg-neutral-300 dark:bg-neutral-500',
    ink: 'text-white',
    badge: 'bg-muted text-muted-foreground',
    pill: 'border-neutral-500 text-neutral-600',
  },
};

// ── Formatting ───────────────────────────────────────────────────────────────

/** Time seated: "12:05" under an hour, "1j 05m" past it. */
export function fmtElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}j ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Viewer-local 24h clock. */
export const clock = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

/** YYYY-MM-DD of a date in the viewer's own zone. */
export const localDateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * A guest's number for a screen other guests may be able to see: 0813••••2211.
 * Stored canonical (628…), shown local (08…).
 */
export function maskPhone(phone: string | null) {
  if (!phone) return '—';
  const local = phone.startsWith('62') ? `0${phone.slice(2)}` : phone;
  if (local.length < 8) return local;
  return `${local.slice(0, 4)}••••${local.slice(-4)}`;
}

/** wa.me wants the canonical 628… form; anything else gets no link. */
export const waLink = (phone: string | null, message: string) =>
  phone && /^62\d{8,13}$/.test(phone)
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : null;

/** "A", "B", … for bill numbers — how a split bill is read out at the table. */
export const billLetter = (n: number) => String.fromCharCode(64 + Math.min(Math.max(n, 1), 26));

/** The tables a seating holds, as staff say it: "05+06". */
export function tablesLabel(tableIds: number[], tables: FloorTable[]) {
  return tableIds
    .map((id) => tables.find((t) => t.id === id)?.label)
    .filter(Boolean)
    .join('+');
}

/** The next free number: one past the highest numeric label, zero-padded. */
export function nextTableLabel(labels: string[]) {
  const nums = labels.map((l) => parseInt(l, 10)).filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  let candidate = String(next).padStart(2, '0');
  const taken = new Set(labels.map((l) => l.toLowerCase()));
  let n = next;
  while (taken.has(candidate.toLowerCase())) candidate = String(++n).padStart(2, '0');
  return candidate;
}

export const snap = (v: number) => Math.round(v / GRID) * GRID;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
