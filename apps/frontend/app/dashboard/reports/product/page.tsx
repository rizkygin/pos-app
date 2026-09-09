'use client';

/**
 * Laporan per Produk: one row per product sold, in its own unit of measure.
 *
 * "Produk Terlaris" on the reports home is the eight-row leaderboard of the
 * same data; this is the full ledger — every product that moved in a range the
 * owner chose, sortable, with the transactions it appeared in and the margin it
 * earned beside it.
 *
 * Two rules it shares with the segmented reports next door, for the same
 * reasons: nothing is fetched until the filter popup is answered, and paging is
 * server-side. Sorting is server-side too — the page only ever holds one page,
 * so re-ranking it in the browser would rank 25 rows out of 400.
 */

import { useCallback, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import {
  ReportFilterDialog,
  type ReportFilterLabels,
  type ReportFilters,
  defaultFilters,
} from '@/components/reports/report-filter-dialog';

type Row = {
  productId: string;
  name: string;
  unit: string;
  category: string;
  isVariant: boolean;
  qty: number;
  orders: number;
  revenue: number;
  // Cost of goods sold, from the cost ledger where the sale moved stock and
  // from the price frozen on the line where it structurally could not. The
  // server derives it once (lib/cogs.ts), so profit is always revenue minus
  // THIS number, never a second opinion computed here.
  cogs: number;
  profit: number;
};

type Totals = {
  products: number;
  orders: number;
  qty: number;
  revenue: number;
  cogs: number;
  profit: number;
};

type SortKey = 'revenue' | 'profit' | 'qty' | 'orders' | 'name';

const PAGE_SIZE = 25;

const fmtIDR = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
// Quantities are not always whole: a unit can be kg or liter.
const fmtQty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
const margin = (revenue: number, profit: number) => (revenue > 0 ? (profit / revenue) * 100 : 0);

/** Query string shared by every fetch, so the header and the table agree. */
function params(f: ReportFilters, sort: SortKey, dir: 'asc' | 'desc', page: number) {
  const p = new URLSearchParams({
    // Local calendar days, sent as instants: `to` is exclusive, so the end date
    // itself is included in full.
    from: new Date(`${f.from}T00:00:00`).toISOString(),
    to: new Date(`${f.to}T00:00:00`).toISOString(),
    sort,
    dir,
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (f.productId) p.set('productId', f.productId);
  if (f.menuGroupId) p.set('menuGroupId', f.menuGroupId);
  if (f.rating) p.set('rating', f.rating);
  return p;
}

export default function Page() {
  const [filterOpen, setFilterOpen] = useState(true);
  const [filters, setFilters] = useState<ReportFilters | null>(null);
  // The names behind filters.productId / menuGroupId, so the header can say
  // "Grup: Minuman" rather than "menuGroupId=7". Comes from the popup, which
  // already holds the option lists.
  const [labels, setLabels] = useState<ReportFilterLabels>({});

  const [rows, setRows] = useState<Row[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sort, setSort] = useState<SortKey>('revenue');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (f: ReportFilters, nextSort: SortKey, nextDir: 'asc' | 'desc', nextPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${API_URL}/api/reports/products?${params(f, nextSort, nextDir, nextPage)}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error ?? 'Gagal memuat laporan');
        setRows(j.rows);
        setTotals(j.totals);
        setPage(j.page);
        setTotalPages(j.totalPages);
        setSort(j.sort);
        setDir(j.dir);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Gagal memuat laporan');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const apply = useCallback(
    (f: ReportFilters, applied?: ReportFilterLabels) => {
      setFilters(f);
      setLabels(applied ?? {});
      setFilterOpen(false);
      setRows(null);
      setTotals(null);
      void load(f, sort, dir, 1);
    },
    [load, sort, dir],
  );

  // Clicking a column re-ranks the WHOLE report, not the page on screen, so it
  // goes back to the server and starts again at page 1.
  const sortBy = (key: SortKey) => {
    if (!filters || loading) return;
    const nextDir: 'asc' | 'desc' = sort === key ? (dir === 'desc' ? 'asc' : 'desc') : key === 'name' ? 'asc' : 'desc';
    void load(filters, key, nextDir, 1);
  };

  const thProps = { sort, dir, onSort: sortBy };

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight md:text-2xl">Laporan per Produk</h1>
          <p className="text-xs text-muted-foreground">Terjual, transaksi, dan laba tiap produk</p>
        </div>
        <button
          onClick={() => setFilterOpen(true)}
          className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-card px-3 py-2 text-xs font-bold shadow-sm hover:bg-muted/50"
        >
          <SlidersHorizontal className="size-4" />
          Ubah Filter
        </button>
      </div>

      {/* What this report is actually showing. The numbers below are only
          readable if the range and the narrowing that produced them are on
          screen beside them — a filtered report that looks like an unfiltered
          one is how an owner concludes their sales collapsed. */}
      {filters && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip icon={<CalendarRange className="size-3" />}>
            {filters.from} → {filters.to}
          </Chip>
          {filters.menuGroupId && (
            <Chip tone="accent">Grup: {labels.menuGroup ?? filters.menuGroupId}</Chip>
          )}
          {filters.productId && (
            <Chip tone="accent">Produk: {labels.product ?? filters.productId}</Chip>
          )}
          {filters.rating && <Chip tone="accent">Rating {filters.rating}★</Chip>}
        </div>
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

      {filters && !totals && !error && (
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {totals && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Produk" value={`${totals.products}`} sub={`${fmtQty(totals.qty)} unit terjual`} />
            <Stat label="Transaksi" value={`${totals.orders}`} />
            <Stat label="Omzet" value={fmtIDR(totals.revenue)} />
            <Stat label="HPP" value={fmtIDR(totals.cogs)} />
            <Stat
              label="Laba Kotor"
              value={fmtIDR(totals.profit)}
              sub={totals.revenue > 0 ? `margin ${margin(totals.revenue, totals.profit).toFixed(1)}%` : undefined}
            />
          </div>

          <section className="mt-6 rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-black tracking-tight">Rincian Produk</h3>
              <span className="text-[11px] font-bold text-muted-foreground">{totals.products} produk</span>
            </div>

            {loading ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : !rows || rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Tidak ada produk terjual pada rentang ini.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] text-muted-foreground">
                      <SortableTh label="Produk" sortKey="name" align="left" {...thProps} />
                      <SortableTh label="Terjual" sortKey="qty" {...thProps} />
                      <SortableTh label="Transaksi" sortKey="orders" {...thProps} />
                      <SortableTh label="Omzet" sortKey="revenue" {...thProps} />
                      {/* HPP is the one column with nothing to rank by that
                          Laba does not already rank better. */}
                      <th className="py-2 pr-3 text-right font-bold uppercase tracking-widest">HPP</th>
                      <SortableTh label="Laba" sortKey="profit" {...thProps} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.productId} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3 font-semibold">
                          {r.name}
                          {/* An add-on option is a product of its own, so it
                              earns a row here — the chip is what stops that
                              reading as a mystery item on the menu. */}
                          {r.category === 'tambahan' && (
                            <span className="ml-1.5 rounded border border-amber-300 px-1 py-px text-[10px] font-black uppercase text-amber-700 dark:border-amber-800 dark:text-amber-400">
                              tambahan
                            </span>
                          )}
                          {r.isVariant && (
                            <span className="ml-1.5 rounded border border-indigo-300 px-1 py-px text-[10px] font-black uppercase text-indigo-700 dark:border-indigo-800 dark:text-indigo-400">
                              varian
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {fmtQty(r.qty)}
                          <span className="ml-1 text-[11px] text-muted-foreground">{r.unit}</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.orders}</td>
                        <td className="py-2 pr-3 text-right font-black tabular-nums">{fmtIDR(r.revenue)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{fmtIDR(r.cogs)}</td>
                        {/* Red only when the sale actually lost money — a
                            zero-cost line is not a loss, it is an unpriced one. */}
                        <td
                          className={`py-2 text-right font-black tabular-nums ${
                            r.profit < 0 ? 'text-destructive' : ''
                          }`}
                        >
                          {fmtIDR(r.profit)}
                          {r.revenue > 0 && (
                            <span className="block text-[10px] font-bold text-muted-foreground">
                              {margin(r.revenue, r.profit).toFixed(0)}%
                            </span>
                          )}
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
                  disabled={page <= 1 || loading}
                  onClick={() => filters && load(filters, sort, dir, page - 1)}
                  className="inline-flex items-center gap-1 rounded-xl border border-border/60 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" /> Sebelumnya
                </button>
                <span className="text-xs font-bold text-muted-foreground">
                  Hal {page} / {totalPages}
                </span>
                <button
                  disabled={page >= totalPages || loading}
                  onClick={() => filters && load(filters, sort, dir, page + 1)}
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
        // Closes even before a report has been run: the empty state behind it
        // says what to do and the "Ubah Filter" button reopens this. Guarding
        // on `filters` here is what made the X look broken on first open.
        onClose={() => setFilterOpen(false)}
        onApply={apply}
      />
    </main>
  );
}

/** One applied filter, shown above the results it produced. */
function Chip({
  children,
  icon,
  tone,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'accent';
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${
        tone === 'accent'
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300'
          : 'border-border/60 text-muted-foreground'
      }`}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * A column header that ranks the WHOLE report by its column.
 *
 * Module scope, not a closure inside the page, so React sees one component type
 * across renders instead of a new one every keystroke.
 */
function SortableTh({
  label,
  sortKey,
  align = 'right',
  sort,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  align?: 'left' | 'right';
  sort: SortKey;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const active = sort === sortKey;
  return (
    <th className={`py-2 pr-3 font-bold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-widest hover:text-foreground ${
          active ? 'text-foreground' : ''
        }`}
      >
        {label}
        {active && (dir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-black tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
