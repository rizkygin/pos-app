'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Loader2, Lock, Settings2 } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import {
  PRINT_LOG_GUIDE,
  SLIP_STATUS,
  type PrintLogLine,
  type SlipStatus,
} from '@/lib/print-log';

/**
 * Laporan Struk Belum Dibayar: every slip printed before its sale was booked —
 * the cashier's pre-checkout struk and Manajemen Meja's Cetak Bill — and how it
 * ended up. A slip that never became a sale is money a customer handed over
 * that the books never saw.
 *
 * Nothing is judged here: status, grouping and the missing units all come from
 * printLogReport (backend lib/print-log.ts). Owner only — it names the cashier.
 * The rules are explained to the owner in the Panduan guide linked at the top.
 */

type Slip = {
  kind: 'receipt' | 'table_bill';
  status: SlipStatus;
  printedAt: string;
  firstPrintedAt: string;
  printCount: number;
  printedBy: string[];
  label: string | null;
  customer: string | null;
  total: number;
  lines: PrintLogLine[];
  order: { id: string; createdAt: string; cancelledAt: string | null } | null;
  missing: { name: string; qty: number }[];
  missingAmount: number;
};

/** One answer from the server, tagged with the range it was asked for. */
type Result =
  | { range: string; kind: 'ok'; slips: Slip[]; totals: Totals; capped: boolean }
  | { range: string; kind: 'forbidden' }
  | { range: string; kind: 'error'; message: string };

type Totals = {
  prints: number;
  slips: number;
  unpaid: { count: number; amount: number };
  pending: { count: number; amount: number };
  cancelled: { count: number; amount: number };
  short: { count: number; amount: number };
  paid: { count: number };
};

const FILTERS = [
  { key: 'check', label: 'Perlu dicek', statuses: ['unpaid', 'short', 'cancelled'] },
  { key: 'pending', label: 'Menunggu', statuses: ['pending'] },
  { key: 'paid', label: 'Lunas', statuses: ['paid'] },
  { key: 'all', label: 'Semua', statuses: ['unpaid', 'short', 'cancelled', 'pending', 'paid'] },
] as const satisfies readonly { key: string; label: string; statuses: readonly SlipStatus[] }[];

const fmtIDR = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

const isoDay = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function Page() {
  // Local calendar days. Default: the last 7 days — a week of shifts is the
  // span an owner checks a cashier over.
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('check');
  // The last answer, kept while the next range loads so the page doesn't blank.
  // Loading = the answer on screen is for another range.
  const [result, setResult] = useState<Result | null>(null);
  const range = `${from}|${to}`;
  const loading = result?.range !== range;

  useEffect(() => {
    let stale = false;
    const p = new URLSearchParams({
      from: new Date(`${from}T00:00:00`).toISOString(),
      // Exclusive end, so the last day is included in full.
      to: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString(),
    });
    fetch(`${API_URL}/api/print-logs/report?${p}`, { credentials: 'include', cache: 'no-store' })
      .then(async (r): Promise<Result> => {
        if (r.status === 403) return { range, kind: 'forbidden' };
        const j = await r.json();
        if (!j.success) return { range, kind: 'error', message: j.error ?? 'Gagal memuat laporan' };
        return { range, kind: 'ok', slips: j.slips, totals: j.totals, capped: !!j.capped };
      })
      .catch((): Result => ({ range, kind: 'error', message: 'Gagal memuat laporan' }))
      // A reply for a range the owner has already moved off is dropped.
      .then((next) => {
        if (!stale) setResult(next);
      });
    return () => {
      stale = true;
    };
  }, [from, to, range]);

  const slips = result?.kind === 'ok' ? result.slips : null;
  const totals = result?.kind === 'ok' ? result.totals : null;
  const capped = result?.kind === 'ok' && result.capped;
  const error = result?.kind === 'error' ? result.message : null;
  const forbidden = result?.kind === 'forbidden';

  const shown = useMemo(() => {
    const statuses: readonly SlipStatus[] = FILTERS.find((f) => f.key === filter)!.statuses;
    return (slips ?? []).filter((s) => statuses.includes(s.status));
  }, [slips, filter]);

  if (forbidden) {
    return (
      <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-bold">Struk Belum Dibayar</p>
            <p className="mt-1 text-sm text-muted-foreground">Laporan ini hanya bisa dibuka pemilik outlet.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight md:text-2xl">Struk Belum Dibayar</h1>
          <p className="text-xs text-muted-foreground">
            Struk yang dicetak sebelum Checkout, dan apakah penjualannya tercatat
          </p>
          <Link
            href={PRINT_LOG_GUIDE}
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            <BookOpen className="size-3.5" />
            Panduan: cara membaca laporan ini
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 rounded-xl border border-border/60 bg-card px-2.5 text-xs font-bold shadow-sm"
            aria-label="Dari tanggal"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 rounded-xl border border-border/60 bg-card px-2.5 text-xs font-bold shadow-sm"
            aria-label="Sampai tanggal"
          />
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && !slips && (
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {totals && (
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Belum Dibayar"
            value={fmtIDR(totals.unpaid.amount)}
            sub={`${totals.unpaid.count} struk`}
            tone={totals.unpaid.count ? 'bad' : 'ok'}
          />
          <Stat
            label="Kurang Ditagih"
            value={fmtIDR(totals.short.amount)}
            sub={`${totals.short.count} struk`}
            tone={totals.short.count ? 'warn' : 'ok'}
          />
          <Stat
            label="Dibatalkan"
            value={fmtIDR(totals.cancelled.amount)}
            sub={`${totals.cancelled.count} struk sudah dibayar lalu dibatalkan`}
            tone={totals.cancelled.count ? 'warn' : 'ok'}
          />
          <Stat
            label="Struk Dicetak"
            value={`${totals.slips}`}
            sub={`${totals.paid.count} lunas · ${totals.pending.count} menunggu · ${totals.prints} kali cetak`}
          />
        </div>
      )}

      {slips && (
        <section className="mt-6 rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Saring status">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                    filter === f.key
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border/60 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] font-bold text-muted-foreground">{shown.length} struk</span>
          </div>

          {capped && (
            <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              Terlalu banyak cetakan pada rentang ini — hanya 2.000 cetakan terbaru yang dibaca. Persempit
              tanggalnya.
            </p>
          )}

          {shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {filter === 'check' ? 'Tidak ada struk yang perlu dicek pada rentang ini.' : 'Tidak ada struk.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                    <th className="py-2 pr-3 font-bold">Dicetak</th>
                    <th className="py-2 pr-3 font-bold">Status</th>
                    <th className="py-2 pr-3 font-bold">Oleh</th>
                    <th className="py-2 pr-3 font-bold">Pelanggan</th>
                    <th className="py-2 pr-3 font-bold">Isi struk</th>
                    <th className="py-2 pr-3 text-right font-bold">Total</th>
                    <th className="py-2 font-bold">Pesanan</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s, i) => (
                    <tr key={`${s.printedAt}-${i}`} className="border-b border-border/40 align-top last:border-0">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="font-semibold tabular-nums">{fmtDateTime(s.printedAt)}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {s.kind === 'table_bill' ? 'Cetak Bill meja' : 'Struk kasir'}
                          {s.printCount > 1 && ` · dicetak ${s.printCount}×`}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="py-2.5 pr-3 font-semibold">{s.printedBy.join(', ') || '—'}</td>
                      <td className="py-2.5 pr-3">
                        {s.customer || <span className="text-muted-foreground">—</span>}
                        {s.label && (
                          <span className="block text-[10px] text-muted-foreground">
                            {s.kind === 'table_bill' ? 'Meja' : 'No.'} {s.label}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        {s.lines.map((l) => (
                          <span key={l.lineId} className="block">
                            {l.qty}× {l.name}
                            {l.addons.length > 0 && (
                              <span className="text-muted-foreground"> + {l.addons.map((a) => a.name).join(', ')}</span>
                            )}
                          </span>
                        ))}
                        {s.missing.length > 0 && (
                          <span className="mt-1 block font-semibold text-amber-700 dark:text-amber-400">
                            Tidak ditagih: {s.missing.map((m) => `${m.qty}× ${m.name}`).join(', ')} ·{' '}
                            {fmtIDR(s.missingAmount)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-black tabular-nums">{fmtIDR(s.total)}</td>
                      <td className="py-2.5 whitespace-nowrap text-xs">
                        {s.order ? (
                          <>
                            <span className="font-mono font-semibold">#{s.order.id.split('-')[0].toUpperCase()}</span>
                            <span className="block text-[10px] text-muted-foreground">
                              {s.order.cancelledAt
                                ? `dibatalkan ${fmtDateTime(s.order.cancelledAt)}`
                                : `checkout ${fmtTime(s.order.createdAt)}`}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Settings2 className="mt-px size-3.5 shrink-0" />
            <span>
              Tombol struk sebelum Checkout bisa disembunyikan dari kasir di{' '}
              <Link href="/dashboard/setting#struk-awal" className="font-bold text-foreground underline underline-offset-2">
                Pengaturan Outlet → Struk Sebelum Checkout
              </Link>
              .
            </span>
          </p>
        </section>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: SlipStatus }) {
  const s = SLIP_STATUS[status];
  return (
    <span className={`inline-block rounded-sm px-1.5 py-0.5 text-[0.72rem] font-semibold whitespace-nowrap ${s.className}`}>
      {s.label}
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'bad'
      ? 'text-destructive'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'ok'
          ? 'text-emerald-600 dark:text-emerald-400'
          : '';
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-black tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
