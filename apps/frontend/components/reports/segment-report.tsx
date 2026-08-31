'use client';

/**
 * The shared body of the four segmented reports (payment method, cashier,
 * customer, online order).
 *
 * Two rules shape this component:
 *
 * 1. Nothing is fetched until the owner answers the filter popup. These reports
 *    group by free text inside orders.note, which is expensive enough that
 *    firing a default query on every page visit is not acceptable — the popup
 *    IS the guard, not a convenience.
 * 2. Paging is server-side. `rows` only ever holds the current page; the page
 *    buttons refetch. The bucket summary is fetched once per filter and is not
 *    re-requested when the page changes.
 */

import { useCallback, useState } from 'react';
import { Loader2, SlidersHorizontal, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { ReportFilterDialog, type ReportFilters, defaultFilters } from './report-filter-dialog';

export type Dimension = 'payment' | 'cashier' | 'customer' | 'online';

// `cogs` is the cost of goods sold, from the cost ledger where the sale moved
// stock and from the price frozen on the line where it structurally could not
// (a service, a fee). The server derives it once — see lib/cogs.ts — so profit
// is always revenue minus THIS number, never a second opinion computed here.
type Group = {
  key: string;
  label: string;
  orders: number;
  revenue: number;
  cogs: number;
  profit: number;
  qty: number;
};

type Row = {
  id: string;
  createdAt: string;
  status: string;
  fulfillment: string;
  label: string;
  customerName: string | null;
  cashierName: string | null;
  paymentMethod: string | null;
  revenue: number;
  cogs: number;
  profit: number;
  qty: number;
};

const PAGE_SIZE = 20;

function fmtIDR(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// The stored values are machine keys; these are what an owner reads.
const PRETTY: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  debit: 'Debit (EDC)',
  credit: 'Kredit (EDC)',
  transfer: 'Transfer',
  // Pre-split rows: every non-cash sale was one bucket before the POS learned
  // the difference. Nothing backfills them — the information to tell a QRIS
  // sale from a card swipe was never captured — so they keep their own name.
  non_cash: 'Non-Tunai (lama)',
  delivery: 'Antar Kurir',
  service: 'Layanan Jasa',
  materials: 'Bahan Bangunan',
  '-': 'Tanpa Nama',
};
const pretty = (v: string) => PRETTY[v] ?? v;

/** Query string shared by the summary and the row list, so they always agree. */
function filterParams(dimension: Dimension, f: ReportFilters) {
  const p = new URLSearchParams({
    dimension,
    // Local calendar days, sent as instants: `to` is exclusive, so the end date
    // itself is included in full.
    from: new Date(`${f.from}T00:00:00`).toISOString(),
    to: new Date(`${f.to}T00:00:00`).toISOString(),
  });
  if (f.productId) p.set('productId', f.productId);
  if (f.menuGroupId) p.set('menuGroupId', f.menuGroupId);
  if (f.rating) p.set('rating', f.rating);
  return p;
}

export function SegmentReport({
  dimension,
  title,
  subtitle,
  groupHeading,
}: {
  dimension: Dimension;
  title: string;
  subtitle: string;
  groupHeading: string;
}) {
  const [filterOpen, setFilterOpen] = useState(true);
  const [filters, setFilters] = useState<ReportFilters | null>(null);

  const [groups, setGroups] = useState<Group[] | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  // Drill-down: which bucket the row list is narrowed to (null = all).
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);

  const loadRows = useCallback(
    async (f: ReportFilters, nextPage: number, key: string | null) => {
      setLoadingRows(true);
      const p = filterParams(dimension, f);
      p.set('page', String(nextPage));
      p.set('pageSize', String(PAGE_SIZE));
      if (key) p.set('key', key);
      try {
        const r = await fetch(`${API_URL}/api/reports/breakdown/orders?${p}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error ?? 'Gagal memuat data');
        setRows(j.rows);
        setTotal(j.total);
        setTotalPages(j.totalPages);
        setPage(j.page);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Gagal memuat data');
      } finally {
        setLoadingRows(false);
      }
    },
    [dimension],
  );

  const apply = useCallback(
    async (f: ReportFilters) => {
      setFilters(f);
      setFilterOpen(false);
      setError(null);
      setGroups(null);
      setRows(null);
      setActiveKey(null);

      try {
        const r = await fetch(`${API_URL}/api/reports/breakdown?${filterParams(dimension, f)}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error ?? 'Gagal memuat laporan');
        setGroups(j.groups);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Gagal memuat laporan');
        return;
      }
      await loadRows(f, 1, null);
    },
    [dimension, loadRows],
  );

  // Clicking a bucket re-pages the list from 1 under that key.
  const drill = (key: string | null) => {
    if (!filters) return;
    setActiveKey(key);
    void loadRows(filters, 1, key);
  };

  const summaryTotals = groups?.reduce(
    (a, g) => ({
      orders: a.orders + g.orders,
      revenue: a.revenue + g.revenue,
      cogs: a.cogs + g.cogs,
      profit: a.profit + g.profit,
    }),
    { orders: 0, revenue: 0, cogs: 0, profit: 0 },
  );

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight md:text-2xl">{title}</h1>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <button
          onClick={() => setFilterOpen(true)}
          className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-card px-3 py-2 text-xs font-bold shadow-sm hover:bg-muted/50"
        >
          <SlidersHorizontal className="size-4" />
          Ubah Filter
        </button>
      </div>

      {filters && (
        <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
          {filters.from} → {filters.to}
          {filters.rating ? ` · rating ${filters.rating}★` : ''}
        </p>
      )}

      {error && (
        <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!filters && !error && (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <Inbox className="size-8" />
          <p className="text-sm">Pilih rentang tanggal dan filter untuk memuat laporan.</p>
        </div>
      )}

      {filters && !groups && !error && (
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {groups && (
        <>
          {summaryTotals && (
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Transaksi</p>
                <p className="mt-0.5 text-lg font-black tabular-nums">{summaryTotals.orders}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Omzet</p>
                <p className="mt-0.5 text-lg font-black tabular-nums">{fmtIDR(summaryTotals.revenue)}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">HPP</p>
                <p className="mt-0.5 text-lg font-black tabular-nums">{fmtIDR(summaryTotals.cogs)}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Laba Kotor</p>
                <p className="mt-0.5 text-lg font-black tabular-nums">{fmtIDR(summaryTotals.profit)}</p>
              </div>
            </div>
          )}

          <section className="mt-6 rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
            <h3 className="mb-3 text-lg font-black tracking-tight">{groupHeading}</h3>
            {groups.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada data pada rentang ini.</p>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={() => drill(null)}
                  className={`w-full rounded-2xl px-3 py-2 text-left text-xs font-bold ${
                    activeKey === null ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'hover:bg-muted/40'
                  }`}
                >
                  Semua
                </button>
                {groups.map((g) => (
                  <button
                    key={g.key}
                    onClick={() => drill(g.key)}
                    className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-left ${
                      activeKey === g.key ? 'bg-indigo-50 dark:bg-indigo-950' : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{pretty(g.label)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {g.orders} transaksi · {g.qty} item · HPP {fmtIDR(g.cogs)} · laba{' '}
                        {fmtIDR(g.profit)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-black tabular-nums">{fmtIDR(g.revenue)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="mt-6 rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-black tracking-tight">Rincian Transaksi</h3>
              <span className="text-[11px] font-bold text-muted-foreground">{total} baris</span>
            </div>

            {loadingRows ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : !rows || rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada transaksi.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-170 text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                      <th className="py-2 pr-3 font-bold">Waktu</th>
                      <th className="py-2 pr-3 font-bold">{groupHeading}</th>
                      <th className="py-2 pr-3 text-right font-bold">Item</th>
                      <th className="py-2 pr-3 text-right font-bold">Omzet</th>
                      <th className="py-2 pr-3 text-right font-bold">HPP</th>
                      <th className="py-2 text-right font-bold">Laba</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDateTime(r.createdAt)}
                        </td>
                        <td className="py-2 pr-3 font-semibold">{pretty(r.label)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.qty}</td>
                        <td className="py-2 pr-3 text-right font-black tabular-nums">{fmtIDR(r.revenue)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {fmtIDR(r.cogs)}
                        </td>
                        {/* Red only when the sale actually lost money — a
                            zero-cost line is not a loss, it is an unpriced one. */}
                        <td
                          className={`py-2 text-right font-black tabular-nums ${
                            r.profit < 0 ? 'text-destructive' : ''
                          }`}
                        >
                          {fmtIDR(r.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Server-side paging: each button is a request, never a slice. */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <button
                  disabled={page <= 1 || loadingRows}
                  onClick={() => filters && loadRows(filters, page - 1, activeKey)}
                  className="inline-flex items-center gap-1 rounded-xl border border-border/60 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" /> Sebelumnya
                </button>
                <span className="text-xs font-bold text-muted-foreground">
                  Hal {page} / {totalPages}
                </span>
                <button
                  disabled={page >= totalPages || loadingRows}
                  onClick={() => filters && loadRows(filters, page + 1, activeKey)}
                  className="inline-flex items-center gap-1 rounded-xl border border-border/60 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                >
                  Berikutnya <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </section>
        </>
      )}

      <ReportFilterDialog
        open={filterOpen}
        initial={filters ?? defaultFilters()}
        onClose={() => filters && setFilterOpen(false)}
        onApply={apply}
      />
    </main>
  );
}
