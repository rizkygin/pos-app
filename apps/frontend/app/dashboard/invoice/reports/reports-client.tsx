'use client';

import { useEffect, useState } from 'react';
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
};
type Dimension = 'payment' | 'staff' | 'customer';

const DIMENSIONS = [
  { key: 'payment', label: 'Metode Bayar', heading: 'Per Metode Pembayaran', note: 'Uang yang benar-benar diterima pada rentang ini' },
  { key: 'staff', label: 'Sales', heading: 'Per Sales', note: 'Nilai faktur terbit, dikelompokkan per penerbit faktur' },
  { key: 'customer', label: 'Pelanggan', heading: 'Per Pelanggan', note: 'Nilai faktur terbit, dikelompokkan per pelanggan' },
] as const satisfies readonly { key: Dimension; label: string; heading: string; note: string }[];

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
  const [dimension, setDimension] = useState<Dimension>('payment');
  const [groups, setGroups] = useState<Group[] | null>(null);
  const meta = DIMENSIONS.find((d) => d.key === dimension)!;

  useEffect(() => {
    setGroups(null);
    const ctl = new AbortController();
    fetch(`${API_URL}/api/invoices/report/breakdown?${filterParams(filters)}&dimension=${dimension}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: ctl.signal,
    })
      .then((r) => r.json())
      .then((j) => j?.success && setGroups(j.groups as Group[]))
      .catch(() => {});
    return () => ctl.abort();
  }, [filters, dimension]);

  const total = groups?.reduce((a, g) => a + g.amount, 0) ?? 0;

  return (
    <section className="rounded-3xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3">
        <h3 className="text-lg font-black tracking-tight">Rincian Faktur Penjualan</h3>
        <p className="text-xs text-muted-foreground">{meta.note}</p>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1">
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
        <div className="flex h-32 items-center justify-center text-center text-sm text-muted-foreground">
          Belum ada data pada rentang ini.
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          {groups.map((g) => {
            // Share of the period, so the biggest bucket is obvious without a chart.
            const pct = total > 0 ? Math.round((g.amount / total) * 100) : 0;
            const label = dimension === 'payment' ? methodMeta(g.key).label : g.label;
            return (
              <div key={g.key} className="rounded-2xl p-2.5 hover:bg-muted/40">
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
                  {dimension === 'payment'
                    ? `${g.count} pembayaran · ${g.invoices ?? 0} faktur`
                    : `${g.count} faktur · dibayar ${fmtIDR(g.paid ?? 0)} · sisa ${fmtIDR(g.outstanding ?? 0)}`}
                </p>
              </div>
            );
          })}
          <div className="flex items-center justify-between border-t pt-2 text-sm font-black">
            <span>Total</span>
            <span className="tabular-nums">{fmtIDR(total)}</span>
          </div>
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
        onClose={() => filters && setFilterOpen(false)}
        onApply={(f) => {
          setFilters(f);
          setFilterOpen(false);
        }}
        showRating={false}
      />
    </main>
  );
}
