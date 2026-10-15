'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  CreditCard,
  Loader2,
  CheckCircle2,
  XCircle,
  ImageIcon,
  RefreshCw,
  BadgePercent,
  UsersRound,
  TrendingUp,
  CalendarClock,
  Clock,
  Wallet,
  Store,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LocalDateTime } from '@/components/local-datetime';
import { API_URL } from '@/lib/api-url';

type PaymentRow = {
  id: number;
  user_name: string;
  user_email: string;
  plan_name: string;
  tier: string;
  interval: 'monthly' | 'yearly';
  amount: string;
  unique_code: number;
  amount_due: string;
  status: 'pending' | 'paid' | 'rejected' | 'expired' | 'failed' | 'refunded';
  proof_image: string | null;
  sender_bank: string | null;
  sender_name: string | null;
  transfer_date: string | null;
  merchant_note: string | null;
  review_note: string | null;
  expires_at: string | null;
  paid_at: string | null;
  period_end: string | null;
  created_at: string;
};

const rupiah = (v: number | string) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);

const tgl = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const STATUS_STYLE: Record<PaymentRow['status'], string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  rejected: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300',
  expired: 'bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-400',
  failed: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300',
  refunded: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
};
const STATUS_LABEL: Record<PaymentRow['status'], string> = {
  pending: 'Menunggu',
  paid: 'Lunas',
  rejected: 'Ditolak',
  expired: 'Kedaluwarsa',
  failed: 'Gagal',
  refunded: 'Refund',
};

// 'pending' = proof sent, the admin's to-do. 'unpaid' = a bill with no proof
// yet (backend splits them) — not a task, kept apart so it never pads the count.
const FILTERS = [
  { key: 'pending', label: 'Perlu Dicek' },
  { key: 'unpaid', label: 'Belum Bayar' },
  { key: 'paid', label: 'Lunas' },
  { key: 'rejected', label: 'Ditolak' },
  { key: 'all', label: 'Semua' },
] as const;

// One period's takings. plan_total + addon_total === total: the split is of the
// same money, not an extra on top (the 3-digit unique code rides the plan side).
type RevenueBucket = {
  period: string; // 'YYYY-MM' for monthly, 'YYYY' for yearly
  total: number;
  plan_total: number;
  addon_total: number;
  count: number;
};

type RevenueSummary = {
  all_time: number;
  all_time_count: number;
  this_month: number;
  this_month_count: number;
  last_month: number;
  active_subscribers: number;
  trialing: number;
  monthly: RevenueBucket[]; // last 12 months, zero-filled
  yearly: RevenueBucket[]; // every year on record
};

// One renewal the forecast expects: amount = plan after the deal + add-on, the
// same quote the merchant would get (no unique code — that is picked at payment).
type ForecastRow = {
  user_name: string;
  user_email: string;
  plan_name: string;
  tier: string;
  due_at: string;
  discount_pct: number;
  plan_amount: number;
  addon_seats: number;
  addon_amount: number;
  amount: number;
};

type RenewalForecastData = {
  month: string; // 'YYYY-MM'
  total: number;
  plan_total: number;
  addon_total: number;
  owners: number;
  due: ForecastRow[];
  prepaid: number;
  lapsed: { total: number; rows: ForecastRow[] };
};

// Compact rupiah for the bar column — twelve full-length figures stacked up
// read as a wall of digits. The exact number stays one hover away.
const rupiahShort = (v: number) => {
  const n = Math.round(v);
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (n >= 1_000) return `Rp ${Math.round(n / 1_000)} rb`;
  return rupiah(n);
};

const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_PANJANG = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// 'YYYY-MM' -> 'Sep 26'; 'YYYY' -> '2026'. Parsed as plain strings, never
// through new Date(), which would drag the viewer's clock into a label that is
// already a settled calendar bucket from the server.
const periodLabel = (period: string) => {
  const [y, m] = period.split('-');
  return m ? `${BULAN_PENDEK[Number(m) - 1]} ${y.slice(2)}` : y;
};
const monthLabelLong = (month: string) => {
  const [y, m] = month.split('-');
  return `${BULAN_PANJANG[Number(m) - 1]} ${y}`;
};

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            {icon}
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const selectCls =
  'h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

function ResultNote({ result }: { result: { ok: boolean; msg: string } | null }) {
  if (!result) return null;
  return (
    <p
      role="status"
      className={`mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${
        result.ok
          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/50 dark:text-green-300'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300'
      }`}
    >
      {result.msg}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Headline numbers — what an admin opening this page wants first: is anything
// waiting on me, and how is the money doing.
// ---------------------------------------------------------------------------

function KpiStrip({
  pendingCount,
  unpaidCount,
  summary,
  forecast,
  onOpenPending,
  onOpenRevenue,
}: {
  pendingCount: number;
  unpaidCount: number;
  summary: RevenueSummary | null;
  forecast: RenewalForecastData | null;
  onOpenPending: () => void;
  onOpenRevenue: () => void;
}) {
  const change =
    summary && summary.last_month > 0
      ? ((summary.this_month - summary.last_month) / summary.last_month) * 100
      : null;

  const tile =
    'flex flex-col rounded-xl border bg-card px-3.5 py-3 text-left transition-colors';
  const clickable = 'hover:border-teal-500/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <button
        type="button"
        onClick={onOpenPending}
        className={`${tile} ${clickable} ${
          pendingCount > 0 ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30' : ''
        }`}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Clock className="size-3.5" /> Perlu Dicek
        </span>
        <span className="mt-1 text-xl font-bold tabular-nums">{pendingCount}</span>
        <span className="text-[11px] text-muted-foreground">
          {pendingCount > 0 ? 'bukti transfer masuk' : 'tidak ada bukti baru'}
          {unpaidCount > 0 && ` · ${unpaidCount} belum bayar`}
        </span>
      </button>

      <button type="button" onClick={onOpenRevenue} className={`${tile} ${clickable}`}>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Wallet className="size-3.5" /> Pendapatan Bulan Ini
        </span>
        <span className="mt-1 truncate text-xl font-bold tabular-nums">
          {summary ? rupiah(summary.this_month) : '—'}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {change == null ? (
            `${summary?.this_month_count ?? 0} pembayaran`
          ) : (
            <>
              <span
                className={
                  change >= 0 ? 'font-semibold text-green-600 dark:text-green-400' : 'font-semibold text-red-600 dark:text-red-400'
                }
              >
                {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(0)}%
              </span>{' '}
              dari bulan lalu
            </>
          )}
        </span>
      </button>

      <button type="button" onClick={onOpenRevenue} className={`${tile} ${clickable}`}>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <CalendarClock className="size-3.5" /> Proyeksi {forecast ? monthLabelLong(forecast.month).split(' ')[0] : 'Bulan Depan'}
        </span>
        <span className="mt-1 truncate text-xl font-bold tabular-nums">
          {forecast ? rupiah(forecast.total) : '—'}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {forecast ? `${forecast.due.length} tagihan bulanan` : ' '}
        </span>
      </button>

      <div className={tile}>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Store className="size-3.5" /> Pelanggan Aktif
        </span>
        <span className="mt-1 text-xl font-bold tabular-nums">{summary?.active_subscribers ?? '—'}</span>
        <span className="text-[11px] text-muted-foreground">
          + {summary?.trialing ?? 0} masa percobaan
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payments queue — the page's main job. Cards rather than a table: a seven-
// column table ran off a phone screen with the Konfirmasi button out of reach.
// ---------------------------------------------------------------------------

// The figure the admin hunts for in the bank mutation. When the base is a round
// thousand the unique code IS the last three digits, so those are lit up; after
// an odd deal percentage it is not, and highlighting would point at the wrong
// digits.
function TransferAmount({ row, size = 'base' }: { row: PaymentRow; size?: 'base' | 'lg' }) {
  const base = Number(row.amount_due) - row.unique_code;
  const text = rupiah(row.amount_due);
  const lit = row.unique_code > 0 && base % 1000 === 0;
  return (
    <div>
      <p className={`font-bold tabular-nums ${size === 'lg' ? 'text-2xl' : 'text-base'}`}>
        {lit ? (
          <>
            {text.slice(0, -3)}
            <span className="rounded bg-teal-100 px-0.5 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
              {text.slice(-3)}
            </span>
          </>
        ) : (
          text
        )}
      </p>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {rupiah(base)} + kode unik {row.unique_code}
      </p>
    </div>
  );
}

function ProofInfo({ row }: { row: PaymentRow }) {
  return (
    <div className="min-w-0 text-xs">
      {row.proof_image ? (
        <a
          href={`${API_URL}${row.proof_image}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-teal-600 underline underline-offset-2 hover:text-teal-700 dark:text-teal-400"
        >
          <ImageIcon className="size-3.5" /> Lihat bukti
        </a>
      ) : row.status === 'pending' ? (
        // No proof on a pending bill = the merchant has not transferred yet (or
        // tapped a plan by mistake); usually nothing to match in the bank.
        <span className="font-medium text-amber-600 dark:text-amber-400">Merchant belum kirim bukti</span>
      ) : (
        <span className="text-muted-foreground">Belum ada bukti</span>
      )}
      {(row.sender_bank || row.sender_name) && (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {[row.sender_bank, row.sender_name].filter(Boolean).join(' · ')}
        </p>
      )}
      {row.merchant_note && (
        <p className="mt-0.5 line-clamp-2 text-[11px] italic text-muted-foreground" title={row.merchant_note}>
          “{row.merchant_note}”
        </p>
      )}
    </div>
  );
}

function PaymentCard({
  row,
  busy,
  onConfirm,
  onReject,
}: {
  row: PaymentRow;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <li className="grid gap-3 p-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{row.user_name}</p>
          {row.status === 'pending' && !row.proof_image ? (
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              Belum bayar
            </span>
          ) : (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[row.status]}`}>
              {row.status === 'pending' ? 'Perlu dicek' : STATUS_LABEL[row.status]}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{row.user_email}</p>
        <p className="mt-1 text-xs">
          <span className="font-medium">{row.plan_name}</span>
          <span className="text-muted-foreground"> · {row.interval === 'monthly' ? 'Bulanan' : 'Tahunan'}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Dibuat {tgl(row.created_at)}
          {/* Only an unpaid bill runs out; one with a proof waits for review. */}
          {row.status === 'pending' && !row.proof_image && row.expires_at && (
            <span className="text-amber-600 dark:text-amber-400"> · batal otomatis {tgl(row.expires_at)}</span>
          )}
          {row.status === 'paid' && row.period_end && (
            <span className="text-green-600 dark:text-green-400"> · aktif s/d {tgl(row.period_end)}</span>
          )}
        </p>
        {row.review_note && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">Catatan admin: {row.review_note}</p>
        )}
      </div>

      <TransferAmount row={row} />
      <ProofInfo row={row} />

      <div className="flex gap-2 md:justify-end">
        {row.status === 'pending' &&
          (busy ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : !row.proof_image ? (
            // Unpaid: not a task. Confirm stays possible (money can arrive
            // without a screenshot) but quiet; no Tolak — rejecting a bill
            // nobody paid would tell the owner "pembayaran ditolak".
            <Button
              variant="outline"
              size="lg"
              className="flex-1 border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 md:flex-none dark:border-green-900 dark:text-green-400 dark:hover:bg-green-950/40"
              onClick={onConfirm}
              title="Hanya kalau dana sudah masuk ke rekening"
            >
              <CheckCircle2 className="size-4" /> Dana masuk, konfirmasi
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="lg"
                className="flex-1 text-destructive hover:text-destructive md:flex-none"
                onClick={onReject}
              >
                <XCircle className="size-4" /> Tolak
              </Button>
              <Button
                size="lg"
                className="flex-1 bg-green-600 text-white hover:bg-green-700 md:flex-none"
                onClick={onConfirm}
              >
                <CheckCircle2 className="size-4" /> Konfirmasi
              </Button>
            </>
          ))}
      </div>
    </li>
  );
}

const REJECT_REASONS = [
  'Nominal tidak cocok dengan mutasi',
  'Transfer belum masuk ke rekening',
  'Bukti transfer tidak terbaca',
];

function PaymentsPanel({
  status,
  setStatus,
  rows,
  pendingCount,
  unpaidCount,
  loading,
  busyId,
  onRefresh,
  onAction,
}: {
  status: string;
  setStatus: (s: string) => void;
  rows: PaymentRow[];
  pendingCount: number;
  unpaidCount: number;
  loading: boolean;
  busyId: number | null;
  onRefresh: () => void;
  onAction: (id: number, kind: 'confirm' | 'reject', note?: string) => void;
}) {
  const [confirming, setConfirming] = useState<PaymentRow | null>(null);
  const [rejecting, setRejecting] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                status === f.key
                  ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                  : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {f.label}
              {f.key === 'pending' && pendingCount > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                  {pendingCount}
                </span>
              )}
              {f.key === 'unpaid' && unpaidCount > 0 && (
                <span className="ml-1.5 rounded-full bg-zinc-200 px-1.5 text-[10px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
                  {unpaidCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="size-3.5" /> Muat ulang
        </Button>
      </div>

      {status === 'pending' && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Cocokkan <b>nominal transfer</b> (3 digit terakhir = kode unik) dengan mutasi rekening, lalu
          konfirmasi. Masa langganan merchant langsung diperpanjang.
        </p>
      )}
      {status === 'unpaid' && (
        <p className="text-xs text-muted-foreground">
          Tagihan yang dibuat merchant tapi <b>belum ada bukti transfer</b> — bukan tugas Anda. Batal
          otomatis saat kedaluwarsa, dan merchant diingatkan di dashboard mereka. Kalau dananya ternyata
          sudah masuk ke rekening, cari nominalnya di sini lalu konfirmasi.
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <CreditCard className="h-9 w-9 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">
            {status === 'pending'
              ? 'Tidak ada bukti transfer yang perlu dicek'
              : status === 'unpaid'
                ? 'Tidak ada tagihan yang belum dibayar'
                : `Tidak ada pembayaran ${status !== 'all' ? STATUS_LABEL[status as PaymentRow['status']]?.toLowerCase() : ''}`}
          </p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {rows.map((r) => (
            <PaymentCard
              key={r.id}
              row={r}
              busy={busyId === r.id}
              onConfirm={() => setConfirming(r)}
              onReject={() => {
                setReason('');
                setRejecting(r);
              }}
            />
          ))}
        </ul>
      )}

      {/* Our dialog closes BEFORE the request goes out: confirm/reject are
          step-up routes, and AdminStepUpGuard may open its own password dialog
          on top — two stacked modals fight over focus. */}
      <Dialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Konfirmasi pembayaran?</DialogTitle>
            <DialogDescription>
              Pastikan mutasi rekening menerima tepat nominal ini. Masa langganan{' '}
              {confirming?.user_name} langsung diperpanjang.
            </DialogDescription>
          </DialogHeader>
          {confirming && !confirming.proof_image && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              Merchant belum mengirim bukti. Konfirmasi hanya kalau nominal ini sudah benar-benar masuk
              ke rekening.
            </p>
          )}
          {confirming && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <TransferAmount row={confirming} size="lg" />
              <p className="text-xs">
                <span className="font-medium">{confirming.plan_name}</span>
                <span className="text-muted-foreground">
                  {' '}· {confirming.interval === 'monthly' ? 'Bulanan' : 'Tahunan'} · {confirming.user_email}
                </span>
              </p>
              <ProofInfo row={confirming} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="lg" onClick={() => setConfirming(null)}>
              Batal
            </Button>
            <Button
              size="lg"
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={() => {
                const id = confirming!.id;
                setConfirming(null);
                onAction(id, 'confirm');
              }}
            >
              <CheckCircle2 className="size-4" /> Ya, konfirmasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak pembayaran?</DialogTitle>
            <DialogDescription>
              Alasan dikirim ke {rejecting?.user_name}. Merchant bisa mengunggah bukti lagi dengan
              nominal yang sama.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {REJECT_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    reason === r
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
                      : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Alasan penolakan"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="lg" onClick={() => setRejecting(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              size="lg"
              onClick={() => {
                const id = rejecting!.id;
                setRejecting(null);
                onAction(id, 'reject', reason.trim());
              }}
            >
              <XCircle className="size-4" /> Tolak pembayaran
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

// Earnings per period. One measure (money in), so one hue and no legend — the
// heading says what is plotted. Rows rather than columns: twelve month names
// along an x-axis collide at phone width, and a row list reads as the table it
// effectively is, with every value labelled instead of gated behind the hover.
// The hover adds only the split and the exact figure.
function RevenueHistory({ summary }: { summary: RevenueSummary }) {
  const [mode, setMode] = useState<'monthly' | 'yearly'>('monthly');
  const all = mode === 'monthly' ? summary.monthly ?? [] : summary.yearly ?? [];
  // Months before the first payment ever are not "Rp 0 months", they are
  // before billing existed — eight empty rows only pushed the real ones down.
  const first = all.findIndex((r) => r.total > 0);
  const rows = first === -1 ? [] : all.slice(first);

  // Bars are scaled against the biggest period in view, so switching Bulanan /
  // Tahunan rescales rather than flattening a year against a month.
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const windowTotal = rows.reduce((s, r) => s + r.total, 0);
  const windowCount = rows.reduce((s, r) => s + r.count, 0);
  const addonTotal = rows.reduce((s, r) => s + r.addon_total, 0);

  return (
    <Section
      icon={<TrendingUp className="size-4 text-teal-600 dark:text-teal-400" />}
      title="Pendapatan Aplikasi"
      description="Uang masuk dari pembayaran langganan yang sudah dikonfirmasi."
      action={
        <div className="flex gap-1.5">
          {(
            [
              { key: 'monthly', label: '12 Bulan' },
              { key: 'yearly', label: 'Per Tahun' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setMode(t.key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                mode === t.key
                  ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                  : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <p className="text-2xl font-bold tabular-nums">{rupiah(windowTotal)}</p>
        <p className="text-xs text-muted-foreground">
          {mode === 'monthly' ? '12 bulan terakhir' : 'sepanjang masa'} · {windowCount} pembayaran
          {addonTotal > 0 && ` · termasuk ${rupiah(addonTotal)} akun tambahan`}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          Belum ada pembayaran yang dikonfirmasi.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="w-12 shrink-0">{mode === 'monthly' ? 'Bulan' : 'Tahun'}</span>
            <span className="flex-1" />
            <span className="w-20 shrink-0 text-right">Masuk</span>
            <span className="w-8 shrink-0 text-right">Bayar</span>
          </div>
          {/* gap-y-2 keeps >=2px of surface between neighbouring bars. */}
          <div className="mt-1.5 flex flex-col gap-y-2">
            {rows.map((r) => (
              <div key={r.period} className="group relative flex items-center gap-2">
                <span className="w-12 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {periodLabel(r.period)}
                </span>
                {/* Track is one step off the surface; the fill is the only ink
                    that carries data. Square at the baseline, 4px rounded end. */}
                <span className="h-3 flex-1 overflow-hidden rounded-r-[4px] bg-muted">
                  <span
                    className="block h-full rounded-r-[4px] bg-teal-600 transition-[width]"
                    style={{ width: max > 0 ? `${Math.max(r.total > 0 ? 2 : 0, (r.total / max) * 100)}%` : '0%' }}
                  />
                </span>
                <span className="w-20 shrink-0 text-right text-[11px] font-semibold tabular-nums">
                  {r.total > 0 ? rupiahShort(r.total) : '—'}
                </span>
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {r.count || ''}
                </span>

                {r.total > 0 && (
                  <div className="pointer-events-none absolute right-0 top-full z-10 hidden w-max rounded-lg border bg-background px-2.5 py-1.5 text-[11px] shadow-md group-hover:block">
                    <p className="font-bold tabular-nums">{rupiah(r.total)}</p>
                    <p className="text-muted-foreground">
                      Paket {rupiah(r.plan_total)}
                      {r.addon_total > 0 && ` · Akun tambahan ${rupiah(r.addon_total)}`}
                    </p>
                    <p className="text-muted-foreground">{r.count} pembayaran</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          {mode === 'monthly' && first > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Belum ada pembayaran sebelum {periodLabel(rows[0].period)}.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

// Next month's demand from MONTHLY subscribers only (server:
// forecastMonthlyRenewals). Yearly plans and trials are left out on purpose —
// this is the recurring baseline, not a lump that lands once a year.
function RenewalForecast({ data }: { data: RenewalForecastData }) {
  const monthLabel = monthLabelLong(data.month);

  return (
    <Section
      icon={<CalendarClock className="size-4 text-teal-600 dark:text-teal-400" />}
      title={`Proyeksi ${monthLabel}`}
      description={
        <>
          Perpanjangan langganan <b>bulanan</b> yang jatuh tempo bulan itu, kalau semua membayar tepat
          waktu. Paket tahunan dan masa percobaan tidak dihitung.
        </>
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <p className="text-2xl font-bold tabular-nums">{rupiah(data.total)}</p>
        <p className="text-xs text-muted-foreground">
          {data.due.length} tagihan dari {data.owners} pemilik
          {data.addon_total > 0 && ` · termasuk ${rupiah(data.addon_total)} akun tambahan`}
        </p>
      </div>

      {data.due.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          Tidak ada langganan bulanan yang jatuh tempo di {monthLabel}.
        </p>
      ) : (
        <ul className="mt-4 divide-y rounded-lg border">
          {data.due.map((r) => (
            <li key={`${r.user_email}-${r.due_at}`} className="flex items-center gap-3 px-3 py-2">
              <span className="w-12 shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
                <LocalDateTime value={r.due_at} options={{ day: 'numeric', month: 'short' }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{r.user_name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {r.plan_name}
                  {r.discount_pct > 0 && ` · deal ${r.discount_pct}%`}
                  {r.addon_seats > 0 && ` · +${r.addon_seats} akun`}
                </p>
              </div>
              <span className="shrink-0 text-xs font-bold tabular-nums">{rupiah(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
        {data.prepaid > 0 && (
          <p>
            {data.prepaid} pemilik bulanan sudah membayar melewati {monthLabel}, jadi tidak ditagih
            bulan itu.
          </p>
        )}
        {data.lapsed.rows.length > 0 && (
          <details className="group rounded-lg border border-dashed px-3 py-2">
            <summary className="cursor-pointer select-none">
              <span className="font-medium text-foreground">
                {data.lapsed.rows.length} pemilik bulanan lewat jatuh tempo
              </span>{' '}
              · potensi {rupiah(data.lapsed.total)}, tidak dihitung
            </summary>
            <ul className="mt-2 divide-y">
              {data.lapsed.rows.map((r) => (
                <li key={r.user_email} className="flex items-center gap-3 py-1.5">
                  <span className="w-16 shrink-0 tabular-nums">
                    <LocalDateTime
                      value={r.due_at}
                      options={{ day: 'numeric', month: 'short', year: '2-digit' }}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {r.user_name} · {r.plan_name}
                  </span>
                  <span className="shrink-0 tabular-nums">{rupiah(r.amount)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p>Belum termasuk kode unik transfer (Rp 100–999 per tagihan).</p>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Per-merchant settings
// ---------------------------------------------------------------------------

// Set/clear a marketing deal on one merchant: % off, optionally scoped to a
// single tier and/or interval (kosong = berlaku semua). 0% clears the deal.
function DealForm() {
  const [email, setEmail] = useState('');
  const [pct, setPct] = useState('');
  const [tier, setTier] = useState('');
  const [intervalScope, setIntervalScope] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!email.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/subscription-deals`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          discount_pct: Number(pct || 0),
          tier: tier || null,
          interval: intervalScope || null,
          note,
        }),
      });
      const json = await res.json();
      if (json.success) {
        const scope = [
          tier ? tier : 'semua tier',
          intervalScope ? (intervalScope === 'monthly' ? 'bulanan' : 'tahunan') : 'semua interval',
        ].join(' · ');
        toast.success(
          Number(pct || 0) > 0
            ? `Deal ${pct}% (${scope}) tersimpan untuk ${json.merchant?.name ?? email}`
            : `Deal dihapus untuk ${json.merchant?.name ?? email}`,
        );
        setEmail('');
        setPct('');
        setNote('');
      } else {
        toast.error(json.error || 'Gagal menyimpan deal');
      }
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      icon={<BadgePercent className="size-4 text-teal-600 dark:text-teal-400" />}
      title="Deal Marketing"
      description="Diskon % khusus untuk satu merchant. Isi 0% untuk menghapus deal."
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Email merchant" hint="Merchant harus sudah membuka halaman Langganan." className="sm:col-span-2">
          <Input type="email" placeholder="nama@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" />
        </Field>
        <Field label="Diskon (%)">
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="0"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="h-9"
          />
        </Field>
        <Field label="Catatan">
          <Input placeholder="cth. deal IG Juli" value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
        </Field>
        <Field label="Berlaku untuk tier">
          <select value={tier} onChange={(e) => setTier(e.target.value)} className={selectCls}>
            <option value="">Semua tier</option>
            <option value="basic">Basic</option>
            <option value="pro">Pro</option>
            <option value="max_lite">Max Lite</option>
            <option value="max">Max</option>
            <option value="ultimax">Ultimax</option>
          </select>
        </Field>
        <Field label="Berlaku untuk interval">
          <select value={intervalScope} onChange={(e) => setIntervalScope(e.target.value)} className={selectCls}>
            <option value="">Bulanan & tahunan</option>
            <option value="monthly">Bulanan saja</option>
            <option value="yearly">Tahunan saja</option>
          </select>
        </Field>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" size="lg" disabled={saving || !email.trim()}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Simpan Deal
          </Button>
        </div>
      </form>
    </Section>
  );
}

const SUB_STATUS_LABEL: Record<string, string> = {
  trialing: 'masa percobaan',
  active: 'aktif',
  past_due: 'menunggak',
  expired: 'habis',
  canceled: 'dibatalkan',
};

// One merchant's staff quota: the plan's cap, the admin override on top of it,
// and what each of their outlets has filled. The cap is PER OUTLET — an owner
// with two outlets may fill it twice — so outlets are listed one by one.
type CapInfo = {
  merchant: { id: string; name: string; email: string };
  subscription: {
    status: string;
    tier: string | null;
    plan_name: string | null;
    current_period_end: string | null;
  } | null;
  plan_max_employees: number | null;
  override: number | null;
  effective_max: number;
  // Price side: seats billed and the per-seat MONTHLY rate (yearly plans are
  // charged 12x it). 0 either way = granted but not charged.
  addon_seats: number;
  addon_seat_price: number;
  addon_note: string;
  outlets: { id: number; name: string; active_employees: number }[];
};

// Sell/grant extra staff accounts to ONE merchant without touching the plan
// catalog (editing the seed would hand the same seats to every merchant on
// that tier), and set what they pay for them in the same save — a grant and
// its price are one decision. Kosongkan = merchant follows their plan again
// and the charge goes away with it.
//
// Look up first, edit second: the fields only appear once the admin can see
// whose quota they are about to change and what it is today.
function EmployeeCapForm() {
  const [email, setEmail] = useState('');
  const [info, setInfo] = useState<CapInfo | null>(null);
  const [cap, setCap] = useState('');
  const [seats, setSeats] = useState('');
  const [seatPrice, setSeatPrice] = useState('');
  const [addonNote, setAddonNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const lookup = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setResult(null);
    setInfo(null);
    try {
      const res = await fetch(
        `${API_URL}/api/admin/subscription-employee-cap?email=${encodeURIComponent(email.trim())}`,
        { credentials: 'include' },
      );
      const json = await res.json();
      if (json.success) {
        const d = json.data as CapInfo;
        setInfo(d);
        setCap(d.override != null ? String(d.override) : '');
        setSeatPrice(d.addon_seat_price > 0 ? String(d.addon_seat_price) : '');
        setAddonNote(d.addon_note ?? '');
        // Billed seats default to whatever the grant adds ON TOP of the plan's
        // own cap — the usual sale — but stay editable, because "granted, not
        // charged" is a real case and the admin should see the number they are
        // about to bill rather than have it inferred at payment time.
        setSeats(
          d.addon_seats > 0
            ? String(d.addon_seats)
            : d.override != null && d.plan_max_employees != null
              ? String(Math.max(0, d.override - d.plan_max_employees))
              : '',
        );
      } else {
        setResult({ ok: false, msg: json.error || 'Merchant tidak ditemukan' });
      }
    } catch {
      setResult({ ok: false, msg: 'Gagal terhubung ke server' });
    } finally {
      setLoading(false);
    }
  };

  const save = async (clear: boolean) => {
    if (!email.trim()) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/subscription-employee-cap`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          max_employees: clear ? null : cap,
          addon_seats: clear ? 0 : Number(seats || 0),
          addon_seat_price: clear ? 0 : Number(seatPrice || 0),
          addon_note: clear ? '' : addonNote,
        }),
      });
      const json = await res.json();
      if (json.success) {
        const over = (json.data.over_cap_outlets ?? []) as CapInfo['outlets'];
        const stale = json.data.stale_pending as { amount_due: string } | null;
        const billed = Number(json.data.addon_seats) * Number(json.data.addon_seat_price);
        const name = json.merchant?.name ?? email.trim();
        await lookup();
        setResult({
          ok: true,
          msg:
            (clear
              ? `Kuota khusus dihapus — ${name} kembali mengikuti paket (${json.data.effective_max} karyawan), tagihan tambahan ikut dihapus`
              : `${name} sekarang boleh ${json.data.effective_max} karyawan aktif per outlet` +
                (billed > 0
                  ? ` · ditagih +${rupiah(billed)}/bln (${json.data.addon_seats} akun) di setiap tagihan`
                  : ' · tanpa biaya tambahan')) +
            (over.length
              ? ` · catatan: ${over
                  .map((o) => `${o.name} sudah ${o.active_employees} aktif`)
                  .join(', ')} — karyawan lama tidak dinonaktifkan`
              : '') +
            (stale
              ? ` · ⚠ merchant masih punya tagihan lama ${rupiah(stale.amount_due)} — minta mereka pilih paket lagi supaya harganya diperbarui`
              : ''),
        });
      } else {
        setResult({ ok: false, msg: json.error || 'Gagal menyimpan kuota' });
      }
    } catch {
      setResult({ ok: false, msg: 'Gagal terhubung ke server' });
    } finally {
      setSaving(false);
    }
  };

  const extraMonthly = Number(seats || 0) * Number(seatPrice || 0);

  return (
    <Section
      icon={<UsersRound className="size-4 text-teal-600 dark:text-teal-400" />}
      title="Kuota Karyawan"
      description="Batas karyawan aktif per outlet khusus untuk satu merchant, sekaligus biayanya."
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          lookup();
        }}
      >
        <Input
          type="email"
          placeholder="Email merchant"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setInfo(null);
          }}
          className="h-9 flex-1"
        />
        <Button type="submit" variant="outline" size="lg" disabled={loading || !email.trim()}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />} Cek
        </Button>
      </form>

      {!info && !result && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Cek merchant dulu untuk melihat kuota dan biayanya saat ini.
        </p>
      )}

      {info && (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-sm font-semibold">{info.merchant.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {info.merchant.email} ·{' '}
              {info.subscription
                ? `${info.subscription.plan_name ?? 'Masa percobaan'} · ${SUB_STATUS_LABEL[info.subscription.status] ?? info.subscription.status}${
                    info.subscription.current_period_end
                      ? ` s/d ${tgl(info.subscription.current_period_end)}`
                      : ''
                  }`
                : 'Belum punya data langganan'}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Batas paket', value: info.plan_max_employees ?? 'trial' },
                { label: 'Kuota khusus', value: info.override ?? '—' },
                { label: 'Berlaku', value: info.effective_max, strong: true },
              ].map((s) => (
                <div key={s.label} className="rounded-md bg-background px-2 py-1.5">
                  <p className={`text-base font-bold tabular-nums ${s.strong ? 'text-teal-700 dark:text-teal-300' : ''}`}>
                    {s.value}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
            {info.outlets.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {info.outlets.map((o) => {
                  const full = o.active_employees >= info.effective_max;
                  return (
                    <li key={o.id} className="text-[11px]">
                      <div className="flex justify-between gap-2">
                        <span className="truncate">{o.name}</span>
                        <span className={`shrink-0 tabular-nums ${full ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                          {o.active_employees} / {info.effective_max} aktif
                        </span>
                      </div>
                      <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className={`block h-full rounded-full ${full ? 'bg-amber-500' : 'bg-teal-600'}`}
                          style={{ width: `${Math.min(100, (o.active_employees / Math.max(1, info.effective_max)) * 100)}%` }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-[11px] text-muted-foreground">Belum punya outlet.</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kuota karyawan / outlet">
              <Input type="number" min={0} max={100} placeholder="0" value={cap} onChange={(e) => setCap(e.target.value)} className="h-9" />
            </Field>
            <Field label="Akun yang ditagih">
              <Input type="number" min={0} max={100} placeholder="0" value={seats} onChange={(e) => setSeats(e.target.value)} className="h-9" />
            </Field>
            <Field label="Harga / akun / bulan (Rp)" hint="Tagihan tahunan otomatis ×12. Deal tidak memotong biaya ini.">
              <Input type="number" min={0} step={1000} placeholder="0" value={seatPrice} onChange={(e) => setSeatPrice(e.target.value)} className="h-9" />
            </Field>
            <Field label="Catatan">
              <Input placeholder="cth. 2 kasir tambahan" value={addonNote} onChange={(e) => setAddonNote(e.target.value)} className="h-9" />
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {extraMonthly > 0 ? (
                <>
                  Tambahan per tagihan:{' '}
                  <span className="font-semibold text-teal-700 dark:text-teal-300">{rupiah(extraMonthly)}/bln</span> ·{' '}
                  {rupiah(extraMonthly * 12)}/thn
                </>
              ) : (
                'Tanpa biaya tambahan'
              )}
            </p>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="lg"
                onClick={() => save(true)}
                disabled={saving}
                title="Kembali ke batas paket dan hapus biaya tambahan"
              >
                Ikuti Paket
              </Button>
              <Button size="lg" onClick={() => save(false)} disabled={saving || cap === ''}>
                {saving && <Loader2 className="size-3.5 animate-spin" />} Simpan Kuota
              </Button>
            </div>
          </div>
        </div>
      )}

      <ResultNote result={result} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'payments', label: 'Pembayaran' },
  { key: 'revenue', label: 'Pendapatan' },
  { key: 'merchant', label: 'Atur Merchant' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function SubscriptionClient() {
  const [tab, setTab] = useState<TabKey>('payments');
  const [status, setStatus] = useState<string>('pending');
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [unpaidCount, setUnpaidCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [forecast, setForecast] = useState<RenewalForecastData | null>(null);

  const fetchRows = useCallback(async (s: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/admin/subscription-payments?status=${s}&limit=50`,
        { credentials: 'include' },
      );
      const json = await res.json();
      if (json.success) {
        setRows(json.data);
        setPendingCount(json.pendingCount ?? 0);
        setUnpaidCount(json.unpaidCount ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Loaded here rather than inside the Pendapatan tab: the headline tiles show
  // both numbers on every tab, and a confirmed payment must refresh them.
  const fetchMoney = useCallback(() => {
    fetch(`${API_URL}/api/admin/subscription-revenue`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.success && setSummary(j.data))
      .catch(() => {});
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch(`${API_URL}/api/admin/subscription-forecast?timezone=${encodeURIComponent(tz)}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.success && setForecast(j.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchRows(status);
  }, [status, fetchRows]);

  useEffect(() => {
    fetchMoney();
  }, [fetchMoney]);

  const action = async (id: number, kind: 'confirm' | 'reject', note = '') => {
    const name = rows.find((r) => r.id === id)?.user_name ?? 'merchant';
    setBusyId(id);
    try {
      const res = await fetch(`${API_URL}/api/admin/subscription-payments/${id}/${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'reject' ? { note } : {}),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(
          kind === 'confirm'
            ? `Pembayaran ${name} dikonfirmasi — masa langganan diperpanjang`
            : `Pembayaran ${name} ditolak`,
        );
      } else {
        toast.error(json.error || 'Gagal memproses');
      }
      await fetchRows(status);
      if (kind === 'confirm') fetchMoney();
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <KpiStrip
        pendingCount={pendingCount}
        unpaidCount={unpaidCount}
        summary={summary}
        forecast={forecast}
        onOpenPending={() => {
          setTab('payments');
          setStatus('pending');
        }}
        onOpenRevenue={() => setTab('revenue')}
      />

      <div role="tablist" aria-label="Bagian halaman" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === t.key
                ? 'border-teal-600 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.key === 'payments' && pendingCount > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'payments' && (
          <PaymentsPanel
            status={status}
            setStatus={setStatus}
            rows={rows}
            pendingCount={pendingCount}
            unpaidCount={unpaidCount}
            loading={loading}
            busyId={busyId}
            onRefresh={() => fetchRows(status)}
            onAction={action}
          />
        )}

        {tab === 'revenue' && (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {summary ? (
              <RevenueHistory summary={summary} />
            ) : (
              <div className="flex items-center justify-center rounded-xl border py-16 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )}
            {forecast && <RenewalForecast data={forecast} />}
          </div>
        )}

        {tab === 'merchant' && (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <DealForm />
            <EmployeeCapForm />
          </div>
        )}
      </div>
    </div>
  );
}
