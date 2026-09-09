'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Receipt,
  ShoppingBag,
  Wallet,
  HandCoins,
  AlertTriangle,
  Loader2,
  FileBarChart,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { methodMeta } from '../_components/payment-method';
import {
  ReportFilterDialog,
  defaultFilters,
  type ReportFilters,
} from '@/components/reports/report-filter-dialog';

type OpenInvoice = {
  id: number;
  number: string;
  party_name: string | null;
  due_date: string | null;
  total: string;
  amount_paid: string;
  status: 'posted' | 'partial';
};
type Side = {
  billed_count: number;
  billed_total: number;
  paid_total: number;
  outstanding_count: number;
  outstanding: number;
  late_count: number;
  late_outstanding: number;
  top_outstanding: OpenInvoice[];
};
// One bucket of the segmented breakdown. `amount` is money received for the
// payment dimension and money billed for the other two — the UI labels which.
type Group = {
  key: string;
  label: string;
  count: number;
  invoices?: number;
  amount: number;
  paid?: number;
  outstanding?: number;
  // Item dimensions only: how many units, in the product's own unit of measure.
  qty?: number;
  unit?: string;
};
// Item dimensions only. `amount` here is net of the invoice-level discount and
// of tax, so it does NOT equal the "Nilai Faktur" KPI — amount + tax does. The
// server returns the tax precisely so this page can show that sum instead of
// leaving an unexplained gap between two numbers on one screen.
type ItemTotals = {
  buckets: number;
  invoices: number;
  qty: number;
  amount: number;
  tax: number;
  discount: number;
};
type Dimension = 'payment' | 'staff' | 'customer' | 'product' | 'menugroup';
/** Which invoice type the item dimensions are reading. NOT the KPI `Side` above. */
type InvoiceSide = 'sales' | 'purchase';

/** One row of the drill-down. Which fields are set depends on the dimension. */
type DetailRow = {
  invoiceId: number;
  number: string;
  date: string;
  party: string;
  product?: string;
  unit?: string;
  qty?: number;
  unitPrice?: number;
  amount?: number;
  method?: string;
  staff?: string;
  status?: string;
  total?: number;
  paid?: number;
  outstanding?: number;
};

// The two item dimensions group invoice_items, not invoices, so they carry a
// side toggle and their own columns. See the note in routes/invoices.ts.
const ITEM_DIMENSIONS: readonly Dimension[] = ['product', 'menugroup'];
const isItemDimension = (d: Dimension) => ITEM_DIMENSIONS.includes(d);

const DIMENSIONS = [
  { key: 'product', label: 'Produk', heading: 'Per Produk', note: 'Nilai barang/jasa yang tertagih, per produk' },
  { key: 'menugroup', label: 'Grup Menu', heading: 'Per Grup Menu', note: 'Nilai barang/jasa yang tertagih, per grup menu' },
  { key: 'payment', label: 'Metode Bayar', heading: 'Per Metode Pembayaran', note: 'Uang yang benar-benar diterima pada rentang ini' },
  { key: 'staff', label: 'Sales', heading: 'Per Sales', note: 'Nilai faktur terbit, dikelompokkan per penerbit faktur' },
  { key: 'customer', label: 'Pelanggan', heading: 'Per Pelanggan', note: 'Nilai faktur terbit, dikelompokkan per pelanggan' },
] as const satisfies readonly { key: Dimension; label: string; heading: string; note: string }[];

const DETAIL_PAGE_SIZE = 20;

const fmtQty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' });

type Report = {
  sales: Side;
  purchase: Side;
  trend: { month: string; sales: number; purchase: number }[];
};

// Every request carries the answers from the filter popup: an explicit range
// (max 3 months, enforced by the popup and again by the API) plus the optional
// product / menu-group narrowing.
function filterParams(f: ReportFilters) {
  const p = new URLSearchParams({ from: f.from, to: f.to });
  p.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (f.productId) p.set('productId', f.productId);
  else if (f.menuGroupId) p.set('menuGroupId', f.menuGroupId);
  return p;
}

function fmtRange(f: ReportFilters) {
  const d = (v: string) =>
    new Date(`${v}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  // `to` is exclusive; show the last day actually included.
  const last = new Date(new Date(`${f.to}T00:00:00`).getTime() - 86_400_000);
  return `${d(f.from)} – ${d(last.toISOString().slice(0, 10))}`;
}

function fmtIDR(n: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}
function fmtCompact(n: number) {
  return new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

// Palette validated (dataviz six checks, light+dark): teal #0d9488 / violet #8b5cf6.
const trendConfig = {
  sales: { label: 'Penjualan', color: '#0d9488' },
  purchase: { label: 'Pembelian', color: '#8b5cf6' },
} satisfies ChartConfig;

const isLate = (inv: OpenInvoice) => {
  if (!inv.due_date) return false;
  const due = new Date(inv.due_date);
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now();
};

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  grad,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub?: string;
  grad: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:p-4">
      <div className={`flex size-8 items-center justify-center rounded-xl bg-linear-to-br ${grad} text-white shadow-md sm:size-9`}>
        <Icon className="size-4" />
      </div>
      <p className="mt-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:tracking-widest">{label}</p>
      <p className="mt-0.5 truncate text-base font-black tracking-tight tabular-nums sm:text-lg" title={value}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

/* KPI row + open-invoice list for one side (sales = piutang, purchase = hutang). */
function SideSection({
  side,
  title,
  icon: Icon,
  openLabel,
  listTitle,
  listHref,
  grad,
}: {
  side: Side;
  title: string;
  icon: typeof Receipt;
  openLabel: string;
  listTitle: string;
  listHref: string;
  grad: string;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-teal-600 dark:text-teal-400" />
        <h3 className="text-lg font-black tracking-tight">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Receipt}
          label="Faktur Terbit"
          value={fmtIDR(side.billed_total)}
          sub={`${side.billed_count} faktur pada rentang ini`}
          grad={grad}
        />
        <KpiCard
          icon={HandCoins}
          label="Dibayar"
          value={fmtIDR(side.paid_total)}
          sub="dari faktur rentang ini"
          grad="from-emerald-400 to-teal-500"
        />
        <KpiCard
          icon={Wallet}
          label={openLabel}
          value={fmtIDR(side.outstanding)}
          sub={`${side.outstanding_count} faktur belum lunas (total berjalan)`}
          grad="from-amber-400 to-orange-500"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Terlambat"
          value={fmtIDR(side.late_outstanding)}
          sub={`${side.late_count} faktur lewat jatuh tempo`}
          grad="from-rose-400 to-red-500"
        />
      </div>

      <div className="mt-4 rounded-3xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
        <h4 className="text-sm font-black tracking-tight">{listTitle}</h4>
        {side.top_outstanding.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Tidak ada faktur berjalan 🎉
          </div>
        ) : (
          <div className="mt-2 space-y-1">
            {side.top_outstanding.map((inv) => {
              const remaining = Number(inv.total) - Number(inv.amount_paid);
              const late = isLate(inv);
              return (
                <Link
                  key={inv.id}
                  href={listHref}
                  className="flex items-center gap-2 rounded-2xl p-2.5 hover:bg-muted/40 sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">
                      <span className="font-mono">{inv.number}</span>
                      {inv.party_name ? ` · ${inv.party_name}` : ''}
                    </p>
                    <p className={`text-[11px] ${late ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                      {inv.due_date
                        ? `${late ? 'Terlambat — jatuh tempo' : 'Jatuh tempo'} ${new Date(inv.due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : 'Tanpa jatuh tempo'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-black tabular-nums sm:text-sm">{fmtIDR(remaining)}</p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">dari {fmtIDR(Number(inv.total))}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/* Segmented breakdown of the same period: per payment method, per sales, per
   customer. Follows the same filter answers as the KPIs above — one popup, one
   window. Sales invoices only; the purchase side has no salesperson or customer. */
function BreakdownSection({ filters }: { filters: ReportFilters }) {
  const [dimension, setDimension] = useState<Dimension>('product');
  const [side, setSide] = useState<InvoiceSide>('sales');
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [itemTotals, setItemTotals] = useState<ItemTotals | null>(null);
  // Which bucket the drill-down is narrowed to. null = "Semua", so the rows
  // always cover exactly what the bucket list above them summed.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [rows, setRows] = useState<DetailRow[] | null>(null);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowPages, setRowPages] = useState(1);
  const [rowPage, setRowPage] = useState(1);
  const [loadingRows, setLoadingRows] = useState(false);
  const meta = DIMENSIONS.find((d) => d.key === dimension)!;
  const item = isItemDimension(dimension);

  const loadRows = useCallback(
    (key: string | null, page: number) => {
      setLoadingRows(true);
      setRows(null);
      const p = filterParams(filters);
      p.set('dimension', dimension);
      p.set('page', String(page));
      p.set('pageSize', String(DETAIL_PAGE_SIZE));
      if (isItemDimension(dimension)) p.set('side', side);
      if (key !== null) p.set('key', key);
      fetch(`${API_URL}/api/invoices/report/breakdown/rows?${p}`, {
        credentials: 'include',
        cache: 'no-store',
      })
        .then((r) => r.json())
        .then((j) => {
          if (!j?.success) return;
          setRows(j.rows as DetailRow[]);
          setRowTotal(j.total);
          setRowPages(j.totalPages);
          setRowPage(j.page);
        })
        .catch(() => {})
        .finally(() => setLoadingRows(false));
    },
    [filters, dimension, side],
  );

  // Buckets. Re-fetched when the question changes, never when the row page does.
  useEffect(() => {
    setGroups(null);
    setItemTotals(null);
    setActiveKey(null);
    const ctl = new AbortController();
    const p = filterParams(filters);
    p.set('dimension', dimension);
    if (isItemDimension(dimension)) p.set('side', side);
    fetch(`${API_URL}/api/invoices/report/breakdown?${p}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: ctl.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) return;
        setGroups(j.groups as Group[]);
        setItemTotals((j.totals as ItemTotals) ?? null);
      })
      .catch(() => {});
    // The rows start at "Semua", page 1, from the same trigger — so they can
    // never be left describing a different question than the buckets above.
    loadRows(null, 1);
    return () => ctl.abort();
  }, [filters, dimension, side, loadRows]);


  const drill = (key: string | null) => {
    setActiveKey(key);
    loadRows(key, 1);
  };

  const total = itemTotals ? itemTotals.amount : (groups?.reduce((a, g) => a + g.amount, 0) ?? 0);
  const activeLabel =
    activeKey === null
      ? 'Semua'
      : (groups?.find((g) => g.key === activeKey)?.label ?? activeKey);

  return (
    <section className="rounded-3xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-black tracking-tight">
            {item ? 'Rincian Faktur' : 'Rincian Faktur Penjualan'}
          </h3>
          <p className="text-xs text-muted-foreground">{meta.note}</p>
        </div>
        {/* Only the item dimensions have a purchase side — "per sales" and
            "per pelanggan" are meaningless on a supplier bill. */}
        {item && (
          <div className="flex gap-1 rounded-xl bg-muted p-1">
            {([
              { k: 'sales', label: 'Jual' },
              { k: 'purchase', label: 'Beli' },
            ] as const).map((o) => (
              <button
                key={o.k}
                onClick={() => setSide(o.k)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  side === o.k
                    ? 'bg-card text-teal-600 shadow-sm dark:text-teal-400'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1 sm:grid-cols-5">
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            onClick={() => setDimension(d.key)}
            className={`rounded-xl px-2 py-1.5 text-[11px] font-bold transition-colors sm:text-xs ${
              dimension === d.key
                ? 'bg-card text-teal-600 shadow-sm dark:text-teal-400'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {!groups ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        /* The tabs answer two different date questions, and an empty one beside
           a populated "Metode Bayar" reads as a bug unless it says so: payments
           are windowed on WHEN THE MONEY MOVED, everything else on WHEN THE
           INVOICE WAS ISSUED. An outlet whose old invoices were settled this
           month lands in exactly that gap. */
        <div className="flex h-32 flex-col items-center justify-center gap-1 px-4 text-center text-sm text-muted-foreground">
          {dimension === 'payment' ? (
            <p>Tidak ada pembayaran diterima pada rentang ini.</p>
          ) : (
            <>
              <p>Tidak ada faktur terbit pada rentang ini.</p>
              <p className="text-[11px]">
                Tab ini mengelompokkan faktur berdasarkan <b>tanggal terbit</b>. Faktur lama yang baru
                dibayar bulan ini muncul di tab <b>Metode Bayar</b> — coba lebarkan rentang tanggalnya.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          {groups.map((g) => {
            // Share of the period, so the biggest bucket is obvious without a chart.
            const pct = total > 0 ? Math.round((g.amount / total) * 100) : 0;
            const label = dimension === 'payment' ? methodMeta(g.key).label : g.label;
            const active = activeKey === g.key;
            return (
              <button
                key={g.key}
                onClick={() => drill(active ? null : g.key)}
                className={`w-full rounded-2xl p-2.5 text-left transition-colors ${
                  active ? 'bg-teal-50 dark:bg-teal-950/40' : 'hover:bg-muted/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-bold">{label}</p>
                  <span className="shrink-0 text-[13px] font-black tabular-nums sm:text-sm">
                    {fmtIDR(g.amount)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-9 shrink-0 text-right text-[10px] font-bold tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {item
                    ? `${fmtQty(g.qty ?? 0)} ${g.unit || 'unit'} · ${g.invoices ?? 0} faktur`
                    : dimension === 'payment'
                      ? `${g.count} pembayaran · ${g.invoices ?? 0} faktur`
                      : `${g.count} faktur · dibayar ${fmtIDR(g.paid ?? 0)} · sisa ${fmtIDR(g.outstanding ?? 0)}`}
                </p>
              </button>
            );
          })}
          <div className="flex items-center justify-between border-t pt-2 text-sm font-black">
            <span>Total</span>
            <span className="tabular-nums">{fmtIDR(total)}</span>
          </div>
          {/* The item tabs total the LINES, which are net of the invoice-level
              discount and of tax — so this figure is deliberately lower than the
              "Nilai Faktur" card above. Spelling the identity out is what stops
              that reading as a bug. */}
          {itemTotals && (itemTotals.tax > 0 || itemTotals.discount > 0) && (
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              Di luar pajak {fmtIDR(itemTotals.tax)}
              {itemTotals.discount > 0 && <> dan setelah diskon faktur {fmtIDR(itemTotals.discount)}</>}. Nilai
              faktur = {fmtIDR(itemTotals.amount + itemTotals.tax)}.
            </p>
          )}
        </div>
      )}

      {/* ------------------------------------------------ drill-down rows */}
      {groups && groups.length > 0 && (
        <div className="mt-5 border-t pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-black tracking-tight">
              Rincian · <span className="text-teal-600 dark:text-teal-400">{activeLabel}</span>
            </h4>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-muted-foreground">{rowTotal} baris</span>
              {activeKey !== null && (
                <button
                  onClick={() => drill(null)}
                  className="rounded-lg border border-border/60 px-2 py-0.5 text-[11px] font-bold hover:bg-muted/50"
                >
                  Semua
                </button>
              )}
            </div>
          </div>

          {loadingRows ? (
            <div className="flex h-28 items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : !rows || rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada rincian.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                    <th className="py-2 pr-3 font-bold">Tanggal</th>
                    <th className="py-2 pr-3 font-bold">No. Faktur</th>
                    <th className="py-2 pr-3 font-bold">{side === 'purchase' && item ? 'Supplier' : 'Pelanggan'}</th>
                    {item && <th className="py-2 pr-3 font-bold">Produk</th>}
                    {item && <th className="py-2 pr-3 text-right font-bold">Qty</th>}
                    {item && <th className="py-2 pr-3 text-right font-bold">Harga</th>}
                    {dimension === 'payment' && <th className="py-2 pr-3 font-bold">Metode</th>}
                    {dimension === 'staff' && <th className="py-2 pr-3 font-bold">Sales</th>}
                    {!item && dimension !== 'payment' && (
                      <th className="py-2 pr-3 text-right font-bold">Dibayar</th>
                    )}
                    {!item && dimension !== 'payment' && (
                      <th className="py-2 pr-3 text-right font-bold">Sisa</th>
                    )}
                    <th className="py-2 text-right font-bold">
                      {item ? 'Total' : dimension === 'payment' ? 'Jumlah' : 'Nilai'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.invoiceId}-${i}`} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDate(r.date)}
                      </td>
                      {/* The number opens the invoice itself. There is no
                          detail page in this app — [id]/print IS the document
                          view — so that is the honest target for a click. */}
                      <td className="py-2 pr-3 font-semibold">
                        <Link
                          href={`/dashboard/invoice/${side === 'purchase' && item ? 'purchase' : 'sales'}/${r.invoiceId}/print`}
                          className="hover:text-teal-600 hover:underline dark:hover:text-teal-400"
                        >
                          {r.number}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 max-w-40 truncate">{r.party}</td>
                      {item && <td className="py-2 pr-3 max-w-44 truncate font-semibold">{r.product}</td>}
                      {item && (
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {fmtQty(r.qty ?? 0)}
                          <span className="ml-1 text-[11px] text-muted-foreground">{r.unit}</span>
                        </td>
                      )}
                      {item && (
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {fmtIDR(r.unitPrice ?? 0)}
                        </td>
                      )}
                      {dimension === 'payment' && (
                        <td className="py-2 pr-3">{methodMeta(r.method ?? '').label}</td>
                      )}
                      {dimension === 'staff' && <td className="py-2 pr-3">{r.staff}</td>}
                      {!item && dimension !== 'payment' && (
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {fmtIDR(r.paid ?? 0)}
                        </td>
                      )}
                      {!item && dimension !== 'payment' && (
                        <td
                          className={`py-2 pr-3 text-right tabular-nums ${
                            (r.outstanding ?? 0) > 0 ? 'font-bold text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                          }`}
                        >
                          {fmtIDR(r.outstanding ?? 0)}
                        </td>
                      )}
                      <td className="py-2 text-right font-black tabular-nums">
                        {fmtIDR(item || dimension === 'payment' ? (r.amount ?? 0) : (r.total ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Server-side paging: each button is a request, never a slice. */}
          {rowPages > 1 && (
            <div className="mt-3 flex items-center justify-between">
              <button
                disabled={rowPage <= 1 || loadingRows}
                onClick={() => loadRows(activeKey, rowPage - 1)}
                className="inline-flex items-center gap-1 rounded-xl border border-border/60 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
              >
                <ChevronLeft className="size-4" /> Sebelumnya
              </button>
              <span className="text-xs font-bold text-muted-foreground">
                Hal {rowPage} / {rowPages}
              </span>
              <button
                disabled={rowPage >= rowPages || loadingRows}
                onClick={() => loadRows(activeKey, rowPage + 1)}
                className="inline-flex items-center gap-1 rounded-xl border border-border/60 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
              >
                Berikutnya <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function InvoiceReportsPage() {
  // Nothing is fetched until the owner answers the popup — the range is the
  // question, exactly as on /dashboard/reports.
  const [filterOpen, setFilterOpen] = useState(true);
  const [filters, setFilters] = useState<ReportFilters | null>(null);
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => {
    if (!filters) return;
    setData(null);
    const ctl = new AbortController();
    fetch(`${API_URL}/api/invoices/report?${filterParams(filters)}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: ctl.signal,
    })
      .then((r) => r.json())
      .then((j) => j?.success && setData(j as Report))
      .catch(() => {});
    return () => ctl.abort();
  }, [filters]);

  const hasTrend = (data?.trend ?? []).some((t) => t.sales > 0 || t.purchase > 0);

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl overflow-x-hidden px-4 pb-16 md:px-6">
      {/* Hero */}
      <div className="relative mt-4 overflow-hidden rounded-3xl bg-linear-to-br from-teal-600 via-teal-500 to-emerald-600 p-4 text-white shadow-xl shadow-teal-500/20 sm:p-6">
        <div className="absolute -right-10 -top-12 size-48 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-16 -left-10 size-48 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
              <FileBarChart className="size-5" />
            </span>
            <div>
              <h1 className="text-xl font-black tracking-tight md:text-2xl">Laporan Faktur</h1>
              <p className="text-xs text-white/75">Penjualan (piutang) &amp; pembelian (hutang)</p>
            </div>
          </div>
          <button
            onClick={() => setFilterOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-white/15 px-3 py-2 text-xs font-bold backdrop-blur hover:bg-white/25"
          >
            <SlidersHorizontal className="size-4" />
            {filters ? fmtRange(filters) : 'Pilih Rentang'}
          </button>
        </div>
      </div>

      {!filters ? (
        <div className="mt-8 flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center">
          <SlidersHorizontal className="size-8 text-muted-foreground" />
          <p className="max-w-xs text-sm text-muted-foreground">
            Pilih rentang tanggal (maksimal 3 bulan) untuk menampilkan laporan.
          </p>
          <button
            onClick={() => setFilterOpen(true)}
            className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-teal-500/25 hover:bg-teal-700"
          >
            Atur Filter
          </button>
        </div>
      ) : !data ? (
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <div className="mt-6 space-y-6 sm:space-y-8">
          <SideSection
            side={data.sales}
            title="Faktur Penjualan"
            icon={Receipt}
            openLabel="Piutang Berjalan"
            listTitle="Piutang Terbesar"
            listHref="/dashboard/invoice/sales"
            grad="from-teal-400 to-teal-600"
          />
          <SideSection
            side={data.purchase}
            title="Faktur Pembelian"
            icon={ShoppingBag}
            openLabel="Hutang Berjalan"
            listTitle="Hutang Terbesar"
            listHref="/dashboard/invoice/purchase"
            grad="from-violet-400 to-purple-500"
          />

          <BreakdownSection filters={filters} />

          {/* 6-month billed trend, both types */}
          <section className="rounded-3xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-4">
              <h3 className="text-lg font-black tracking-tight">Tren 6 Bulan</h3>
              <p className="text-xs text-muted-foreground">Nilai faktur terbit per bulan (di luar draft &amp; batal)</p>
            </div>
            {!hasTrend ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                Belum ada faktur pada 6 bulan terakhir
              </div>
            ) : (
              <ChartContainer config={trendConfig} className="h-56 w-full min-w-0">
                <BarChart data={data.trend} margin={{ left: 4, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} tickFormatter={(v) => fmtCompact(Number(v))} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v, name) => `${trendConfig[name as keyof typeof trendConfig].label} ${fmtIDR(Number(v))}`} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="sales" fill="var(--color-sales)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="purchase" fill="var(--color-purchase)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ChartContainer>
            )}
          </section>
        </div>
      )}

      <ReportFilterDialog
        open={filterOpen}
        initial={filters ?? defaultFilters()}
        // Closes even before a report has been run: the empty state behind
        // it offers "Atur Filter" to reopen. Guarding on `filters` here is what
        // made the X look broken on first open.
        onClose={() => setFilterOpen(false)}
        onApply={(f) => {
          setFilters(f);
          setFilterOpen(false);
        }}
        showRating={false}
      />
    </main>
  );
}
