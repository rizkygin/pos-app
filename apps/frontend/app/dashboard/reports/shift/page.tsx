'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ClipboardCheck, Loader2, Lock, Sparkles } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { ShiftReportModal, type ShiftReport } from '@/components/dashboard/shift-report-modal';

/**
 * Laporan Shift: one row per stint at the drawer, with the figures its closing
 * slip printed. The owner's answer to "did the drawer match" across a period,
 * where Laporan per Kasir answers "who sold what".
 *
 * Nothing is computed here. Every number is the backend's, from the same
 * arithmetic that builds the slip, so a row and the slip it opens can never
 * disagree. Max Lite and up, like opening a shift itself.
 */

type Row = {
  id: number;
  cashierName: string;
  openedAt: string;
  closedAt: string | null;
  isOpen: boolean;
  openingFloat: number;
  net: number;
  tax: number;
  collected: number;
  cashCollected: number;
  nonCashCollected: number;
  orderCount: number;
  cancelledCount: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
  closingNote: string | null;
};

type Totals = {
  shifts: number;
  open: number;
  orders: number;
  cancelled: number;
  net: number;
  tax: number;
  collected: number;
  cashCollected: number;
  variance: number;
};

const fmtIDR = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const fmtSigned = (n: number) => (n > 0 ? `+${fmtIDR(n)}` : fmtIDR(n));
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

const isoDay = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function Page() {
  // Local calendar days. Default: this month so far, the range an owner
  // reconciling the cash bag actually wants.
  const [from, setFrom] = useState(() => isoDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({
        from: new Date(`${from}T00:00:00`).toISOString(),
        // Exclusive end, so the last day is included in full.
        to: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString(),
      });
      const r = await fetch(`${API_URL}/api/shifts/report?${p}`, { credentials: 'include', cache: 'no-store' });
      const j = await r.json();
      if (r.status === 403 && j.code === 'PLAN_FEATURE') {
        setLocked(true);
        return;
      }
      if (!j.success) throw new Error(j.error ?? 'Gagal memuat laporan');
      setRows(j.shifts);
      setTotals(j.totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat laporan');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const openSlip = async (id: number) => {
    setOpening(id);
    try {
      const r = await fetch(`${API_URL}/api/shifts/${id}/report`, { credentials: 'include', cache: 'no-store' });
      const j = await r.json();
      if (j.success) setReport(j.shift);
    } finally {
      setOpening(null);
    }
  };

  if (locked) {
    return (
      <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
        <div className="mt-6 rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">Laporan Shift</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Rekap buka-tutup laci per kasir: modal awal, penjualan, uang yang seharusnya ada,
                yang dihitung, dan selisihnya. Tersedia mulai paket Max Lite.
              </p>
            </div>
            <Link
              href="/dashboard/subscription"
              className="flex shrink-0 items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-sm font-bold text-background transition-opacity hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              Upgrade
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight md:text-2xl">Laporan Shift</h1>
          <p className="text-xs text-muted-foreground">Buka-tutup laci per kasir: apakah uangnya cocok</p>
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

      {loading && !rows && (
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {totals && (
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Shift" value={`${totals.shifts}`} sub={totals.open ? `${totals.open} masih buka` : undefined} />
          <Stat label="Penjualan Netto" value={fmtIDR(totals.net)} sub={`${totals.orders} transaksi`} />
          <Stat label="Uang Diterima" value={fmtIDR(totals.collected)} sub={`tunai ${fmtIDR(totals.cashCollected)}`} />
          <Stat
            label="Selisih Laci"
            value={fmtSigned(totals.variance)}
            sub={totals.cancelled ? `${totals.cancelled} order dibatalkan` : undefined}
            tone={totals.variance < 0 ? 'bad' : totals.variance > 0 ? 'warn' : 'ok'}
          />
        </div>
      )}

      {rows && (
        <section className="mt-6 rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-black tracking-tight">Daftar Shift</h3>
            <span className="text-[11px] font-bold text-muted-foreground">{rows.length} shift</span>
          </div>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada shift pada rentang ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                    <th className="py-2 pr-3 font-bold">Shift</th>
                    <th className="py-2 pr-3 font-bold">Kasir</th>
                    <th className="py-2 pr-3 font-bold">Buka → Tutup</th>
                    <th className="py-2 pr-3 text-right font-bold">Modal</th>
                    <th className="py-2 pr-3 text-right font-bold">Netto</th>
                    <th className="py-2 pr-3 text-right font-bold">Diterima</th>
                    <th className="py-2 pr-3 text-right font-bold">Seharusnya</th>
                    <th className="py-2 pr-3 text-right font-bold">Dihitung</th>
                    <th className="py-2 pr-3 text-right font-bold">Selisih</th>
                    <th className="py-2 font-bold" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => openSlip(r.id)}
                      className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40"
                    >
                      <td className="py-2 pr-3 font-black tabular-nums">
                        #{r.id}
                        {r.isOpen && (
                          <span className="ml-1.5 rounded border border-emerald-300 px-1 py-px text-[10px] font-black uppercase text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
                            buka
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-semibold">{r.cashierName}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDateTime(r.openedAt)}
                        {' → '}
                        {r.closedAt ? fmtTime(r.closedAt) : '…'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{fmtIDR(r.openingFloat)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {fmtIDR(r.net)}
                        <span className="block text-[10px] text-muted-foreground">
                          {r.orderCount} trx{r.cancelledCount ? ` · ${r.cancelledCount} batal` : ''}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {fmtIDR(r.collected)}
                        {r.tax > 0 && (
                          <span className="block text-[10px] text-muted-foreground">pajak {fmtIDR(r.tax)}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-black tabular-nums">{fmtIDR(r.expectedCash)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.countedCash === null ? <span className="text-muted-foreground">—</span> : fmtIDR(r.countedCash)}
                      </td>
                      {/* Signed and coloured: a short drawer is the one number
                          on this page the owner is looking for. */}
                      <td
                        className={`py-2 pr-3 text-right font-black tabular-nums ${
                          r.variance === null
                            ? 'text-muted-foreground'
                            : r.variance < 0
                              ? 'text-destructive'
                              : r.variance > 0
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {r.variance === null ? '—' : fmtSigned(r.variance)}
                      </td>
                      <td className="py-2 text-right">
                        {opening === r.id ? (
                          <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />
                        ) : (
                          <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ClipboardCheck className="size-3.5" />
            Klik shift untuk membuka dan mencetak slip penutupannya.
          </p>
        </section>
      )}

      {report && <ShiftReportModal report={report} onClose={() => setReport(null)} />}
    </main>
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
