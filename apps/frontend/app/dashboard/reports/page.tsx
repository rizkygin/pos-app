'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Wallet,
  TrendingUp,
  ShoppingCart,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  Trophy,
  Clock,
  Loader2,
  BarChart3,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';

type Summary = {
  kpis: {
    revenue: number;
    cogs: number;
    profit: number;
    orders: number;
    aov: number;
    revenueDeltaPct: number;
    profitDeltaPct: number;
    ordersDeltaPct: number;
  };
  trend: { day: string; revenue: number }[];
  topProducts: { name: string; qty: number; revenue: number; profit: number }[];
  hourly: { hour: number; orders: number; revenue: number }[];
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

const trendConfig = { revenue: { label: 'Omzet', color: 'hsl(221 83% 53%)' } } satisfies ChartConfig;
const hourlyConfig = { orders: { label: 'Order', color: 'hsl(262 83% 58%)' } } satisfies ChartConfig;

function Delta({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-black ${
        up ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400' : 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400'
      }`}
    >
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {up ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  grad,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  delta?: number;
  grad: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className={`flex size-9 items-center justify-center rounded-xl bg-linear-to-br ${grad} text-white shadow-md`}>
          <Icon className="size-4" />
        </div>
        {delta !== undefined && <Delta pct={delta} />}
      </div>
      <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-black tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('30d');
  const [data, setData] = useState<Summary | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setData(null);
    fetch(`${API_URL}/api/reports/summary?period=${period}&timezone=${encodeURIComponent(tz)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          setForbidden(true);
          return null;
        }
        return r.json();
      })
      .then((j) => j?.success && setData(j as Summary))
      .catch(() => {});
  }, [period]);

  const trendData = useMemo(
    () =>
      (data?.trend ?? []).map((d) => ({
        label: new Date(d.day).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
        revenue: d.revenue,
      })),
    [data],
  );
  const hourlyData = useMemo(
    () => (data?.hourly ?? []).map((h) => ({ hour: `${String(h.hour).padStart(2, '0')}`, orders: h.orders })),
    [data],
  );

  if (forbidden) {
    return (
      <div className="flex h-[60vh] w-full items-center justify-center">
        <p className="text-destructive">Kamu tidak berhak melihat halaman ini.</p>
      </div>
    );
  }

  const k = data?.kpis;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
      {/* Hero */}
      <div className="relative mt-4 overflow-hidden rounded-3xl bg-linear-to-br from-indigo-600 via-blue-600 to-violet-600 p-6 text-white shadow-xl shadow-indigo-500/20">
        <div className="absolute -right-10 -top-12 size-48 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-16 -left-10 size-48 rounded-full bg-white/10 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <BarChart3 className="size-5" />
              </span>
              <h1 className="text-xl font-black tracking-tight md:text-2xl">Laporan Pesanan</h1>
            </div>
            {/* Period selector */}
            <div className="flex gap-1 rounded-2xl bg-white/15 p-1 backdrop-blur">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                    period === p.key ? 'bg-white text-indigo-600' : 'text-white/80 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/60">Omzet</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-black tracking-tight md:text-4xl">{k ? fmtIDR(k.revenue) : '—'}</h2>
              {k && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${
                    k.revenueDeltaPct >= 0 ? 'bg-emerald-400/90 text-emerald-950' : 'bg-rose-400/90 text-rose-950'
                  }`}
                >
                  {k.revenueDeltaPct >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                  {k.revenueDeltaPct >= 0 ? '+' : ''}
                  {k.revenueDeltaPct.toFixed(1)}%
                </span>
              )}
            </div>
            {k && (
              <p className="mt-1 text-sm text-white/80">
                Laba kotor <span className="font-black text-emerald-200">{fmtIDR(k.profit)}</span> · vs periode sebelumnya
              </p>
            )}
          </div>
        </div>
      </div>

      {!data ? (
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard icon={Wallet} label="Omzet" value={fmtIDR(k!.revenue)} delta={k!.revenueDeltaPct} grad="from-blue-400 to-indigo-500" />
            <KpiCard icon={TrendingUp} label="Laba Kotor" value={fmtIDR(k!.profit)} delta={k!.profitDeltaPct} grad="from-emerald-400 to-teal-500" />
            <KpiCard icon={ShoppingCart} label="Transaksi" value={`${k!.orders}`} delta={k!.ordersDeltaPct} grad="from-violet-400 to-purple-500" />
            <KpiCard icon={Receipt} label="Rata-rata / Transaksi" value={fmtIDR(k!.aov)} grad="from-amber-400 to-orange-500" />
          </div>

          {/* Sales trend */}
          <section className="mt-8 rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
            <div className="mb-4">
              <h3 className="text-lg font-black tracking-tight">Tren Penjualan</h3>
              <p className="text-xs text-muted-foreground">Omzet per hari</p>
            </div>
            {trendData.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Belum ada penjualan pada periode ini</div>
            ) : (
              <ChartContainer config={trendConfig} className="h-56 w-full">
                <AreaChart data={trendData} margin={{ left: 4, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} tickFormatter={(v) => fmtCompact(Number(v))} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v) => fmtIDR(Number(v))} />} />
                  <Area dataKey="revenue" type="monotone" stroke="var(--color-revenue)" strokeWidth={2.5} fill="url(#revFill)" />
                </AreaChart>
              </ChartContainer>
            )}
          </section>

          {/* Top products + Peak hours */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* Top products */}
            <section className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Trophy className="size-4 text-amber-500" />
                <h3 className="text-lg font-black tracking-tight">Produk Terlaris</h3>
              </div>
              {data.topProducts.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Belum ada data</div>
              ) : (
                <div className="space-y-2">
                  {data.topProducts.map((p, i) => (
                    <motion.div
                      key={p.name + i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-center gap-3 rounded-2xl p-2.5 hover:bg-muted/40"
                    >
                      <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-black ${i < 3 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground">{p.qty} terjual · laba {fmtIDR(p.profit)}</p>
                      </div>
                      <span className="shrink-0 text-sm font-black tabular-nums">{fmtIDR(p.revenue)}</span>
                    </motion.div>
                  ))}
                </div>
              )}
            </section>

            {/* Peak hours */}
            <section className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Clock className="size-4 text-violet-500" />
                <h3 className="text-lg font-black tracking-tight">Jam Ramai</h3>
              </div>
              <ChartContainer config={hourlyConfig} className="h-56 w-full">
                <BarChart data={hourlyData} margin={{ left: 4, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} fontSize={10} interval={2} />
                  <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => `Jam ${l}:00`} />} />
                  <Bar dataKey="orders" fill="var(--color-orders)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
