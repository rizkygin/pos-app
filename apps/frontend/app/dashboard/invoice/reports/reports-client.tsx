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
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';

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
type Report = {
  sales: Side;
  purchase: Side;
  trend: { month: string; sales: number; purchase: number }[];
};

const PERIODS = [
  { key: 'today', label: 'Hari ini' },
  { key: '7d', label: '7 Hari' },
  { key: '30d', label: '30 Hari' },
  { key: 'month', label: 'Bulan Ini' },
] as const;

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
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className={`flex size-9 items-center justify-center rounded-xl bg-linear-to-br ${grad} text-white shadow-md`}>
        <Icon className="size-4" />
      </div>
      <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-black tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Receipt}
          label="Faktur Terbit"
          value={fmtIDR(side.billed_total)}
          sub={`${side.billed_count} faktur pada periode ini`}
          grad={grad}
        />
        <KpiCard
          icon={HandCoins}
          label="Dibayar"
          value={fmtIDR(side.paid_total)}
          sub="dari faktur periode ini"
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

      <div className="mt-4 rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
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
                  className="flex items-center gap-3 rounded-2xl p-2.5 hover:bg-muted/40"
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
                    <p className="text-sm font-black tabular-nums">{fmtIDR(remaining)}</p>
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

export default function InvoiceReportsPage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('30d');
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`${API_URL}/api/invoices/report?period=${period}`, { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => j?.success && setData(j as Report))
      .catch(() => {});
  }, [period]);

  const hasTrend = (data?.trend ?? []).some((t) => t.sales > 0 || t.purchase > 0);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
      {/* Hero */}
      <div className="relative mt-4 overflow-hidden rounded-3xl bg-linear-to-br from-teal-600 via-teal-500 to-emerald-600 p-6 text-white shadow-xl shadow-teal-500/20">
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
          <div className="flex gap-1 rounded-2xl bg-white/15 p-1 backdrop-blur">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                  period === p.key ? 'bg-white text-teal-600' : 'text-white/80 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!data ? (
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <div className="mt-6 space-y-8">
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

          {/* 6-month billed trend, both types */}
          <section className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
            <div className="mb-4">
              <h3 className="text-lg font-black tracking-tight">Tren 6 Bulan</h3>
              <p className="text-xs text-muted-foreground">Nilai faktur terbit per bulan (di luar draft &amp; batal)</p>
            </div>
            {!hasTrend ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                Belum ada faktur pada 6 bulan terakhir
              </div>
            ) : (
              <ChartContainer config={trendConfig} className="h-56 w-full">
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
    </main>
  );
}
