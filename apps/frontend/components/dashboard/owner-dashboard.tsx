'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import {
  ShoppingBag,
  ShoppingCart,
  History,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Store,
  LayoutGrid,
  Book,
  BarChart3,
  Megaphone,
  Calculator,
  Receipt,
  Boxes,
  Truck,
  Star,
  Settings,
  ClipboardList,
  Download,
  Printer,
} from 'lucide-react';

type RecentOrder = {
  orderId: string;
  itemCount: number;
  totalAmount: number;
  status: 'addToChart' | 'checkout' | null;
};

type SalesPeriod = { totalSales: number; percentage: number };
// Today's Kasir vs Online split.
type TodayChannels = { pos: number; app: number; revenue: number; aov: number };
// Rolling 30-day counts for the rotating counter card.
type Counts30d = { orders: number; invoices: number };

function fmtIDR(amount: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const STATUS_MAP = {
  addToChart: { label: 'Diproses', color: 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400' },
  checkout: { label: 'Selesai', color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400' },
} as const;

// Every owner feature, grouped for the shortcut grid.
const FEATURES: {
  name: string;
  icon: typeof Store;
  href: string;
  grad: string;
}[] = [
  { name: 'Kasir', icon: Store, href: '/dashboard/cashier', grad: 'from-cyan-400 to-blue-500' },
  { name: 'Produk', icon: LayoutGrid, href: '/dashboard/addproducts', grad: 'from-emerald-400 to-green-500' },
  { name: 'Buku Kas', icon: Book, href: '/dashboard/cashflow', grad: 'from-rose-400 to-pink-500' },
  { name: 'Laporan', icon: BarChart3, href: '/dashboard/reports', grad: 'from-violet-400 to-purple-500' },
  { name: 'Pasang Iklan', icon: Megaphone, href: '/dashboard/promote', grad: 'from-fuchsia-400 to-pink-500' },
  { name: 'Kalkulator HPP', icon: Calculator, href: '/dashboard/hpp-calculator', grad: 'from-amber-400 to-orange-500' },
  { name: 'Faktur Jual', icon: Receipt, href: '/dashboard/invoice/sales', grad: 'from-sky-400 to-indigo-500' },
  { name: 'Faktur Beli', icon: ShoppingBag, href: '/dashboard/invoice/purchase', grad: 'from-indigo-400 to-blue-500' },
  { name: 'Stok', icon: Boxes, href: '/dashboard/invoice/stock', grad: 'from-teal-400 to-emerald-500' },
  { name: 'Supplier', icon: Truck, href: '/dashboard/invoice/supplier', grad: 'from-orange-400 to-red-500' },
  { name: 'Ratings', icon: Star, href: '/dashboard/ratings', grad: 'from-yellow-400 to-amber-500' },
  { name: 'Pengaturan', icon: Settings, href: '/dashboard/setting', grad: 'from-slate-400 to-gray-500' },
];

const ROTATE_MS = 3500;
// Deliberately not a multiple of ROTATE_MS: the two rotating blocks would
// otherwise swap on the same frame forever, which reads as the whole hero
// twitching instead of two facts taking turns.
const COUNTER_ROTATE_MS = 4700;

export const OwnerDashboard = ({
  activeOrdersCount,
  recentOrders,
  total6monthsSales,
  total7daysSales,
  totalTodaySales,
  todayChannels,
  counts30d,
}: {
  activeOrdersCount: number;
  recentOrders: RecentOrder[];
  total6monthsSales: SalesPeriod;
  total7daysSales?: SalesPeriod;
  totalTodaySales?: SalesPeriod;
  todayChannels?: TodayChannels;
  counts30d?: Counts30d;
}) => {
  // The headline cycles through three windows so the hero says something new
  // on every glance. A stale cached response (this is a PWA) can omit the two
  // newer fields, so anything missing simply drops out of the rotation.
  const periods = [
    { label: 'Penjualan Hari Ini', hint: 'vs kemarin', data: totalTodaySales },
    { label: 'Penjualan 7 Hari', hint: 'vs 7 hari sebelumnya', data: total7daysSales },
    { label: 'Penjualan 6 Bulan', hint: 'vs 6 bulan sebelumnya', data: total6monthsSales },
  ].filter((p): p is { label: string; hint: string; data: SalesPeriod } => Boolean(p.data));

  const [tick, setTick] = useState(0);
  // Paused while the owner is interacting, so a tap-to-read never gets yanked.
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || periods.length < 2) return;
    const timer = setInterval(() => setTick((i) => (i + 1) % periods.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, periods.length]);

  // The left mini-stat rotates through 30-day counts on its own cadence (see
  // COUNTER_ROTATE_MS). Active orders live in the header pill, so they're not
  // repeated here.
  const counters = counts30d
    ? [
        {
          label: 'Order 30 Hari',
          icon: ShoppingCart,
          value: counts30d.orders,
          hint: 'Kasir + Online',
        },
        {
          label: 'Faktur Jual',
          icon: Receipt,
          value: counts30d.invoices,
          hint: 'terbit 30 hari',
        },
      ]
    : [];

  const [countTick, setCountTick] = useState(0);

  useEffect(() => {
    if (paused || counters.length < 2) return;
    const timer = setInterval(
      () => setCountTick((i) => (i + 1) % counters.length),
      COUNTER_ROTATE_MS,
    );
    return () => clearInterval(timer);
  }, [paused, counters.length]);

  const counter = counters.length > 0 ? counters[countTick % counters.length] : null;

  const active = periods[tick % periods.length];
  const salesPct = active.data.percentage ?? 0;
  const isPositive = salesPct >= 0;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
      {/* ── Gradient Hero ─────────────────────────────────────────── */}
      <div className="relative mt-4 overflow-hidden rounded-3xl bg-linear-to-br from-indigo-600 via-blue-600 to-violet-600 p-6 text-white shadow-xl shadow-indigo-500/20 md:p-8">
        <div className="absolute -right-10 -top-12 size-48 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-16 -left-10 size-48 rounded-full bg-white/10 blur-3xl" />

        <div
          className="relative"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white/70">Halo, Juragan 👋</p>
              <h1 className="text-xl font-black tracking-tight md:text-2xl">Ringkasan Bisnismu</h1>
            </div>
            <Link
              href="/dashboard/activeorder"
              className="flex items-center gap-2 rounded-2xl bg-white/15 px-3.5 py-2 text-sm font-bold backdrop-blur transition-colors hover:bg-white/25"
            >
              <ClipboardList className="size-4" />
              <span className="hidden sm:inline">Pesanan Aktif</span>
              <span className="flex size-5 items-center justify-center rounded-full bg-white text-[11px] font-black text-indigo-600">
                {activeOrdersCount}
              </span>
            </Link>
          </div>

          {/* Headline metric — rotates today → 7 days → 6 months. The min-height
              reserves the tallest state so mode="wait" (which unmounts the old
              value before mounting the new) can't collapse the hero mid-swap. */}
          <div className="mt-6 min-h-[84px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/60">
                  {active.label}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h2 className="text-3xl font-black tracking-tight md:text-4xl">
                    {fmtIDR(active.data.totalSales)}
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${
                      isPositive ? 'bg-emerald-400/90 text-emerald-950' : 'bg-rose-400/90 text-rose-950'
                    }`}
                  >
                    {isPositive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    {isPositive ? '+' : ''}
                    {salesPct.toFixed(1)}%
                  </span>
                  <span className="text-[11px] font-semibold text-white/60">{active.hint}</span>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Dots double as controls: rotation is a nudge, not a lock-out. */}
            {periods.length > 1 && (
              <div className="mt-3 flex items-center gap-1.5">
                {periods.map((p, i) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setTick(i)}
                    aria-label={p.label}
                    aria-current={i === tick % periods.length}
                    className={`h-1.5 rounded-full transition-all ${
                      i === tick % periods.length ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Mini stats */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            {/* Rotates: 30-day order count → 30-day invoice count. Same
                min-height trick as the headline so the grid row never jumps. */}
            <div className="min-h-[76px] rounded-2xl bg-white/10 p-3 backdrop-blur">
              <AnimatePresence mode="wait" initial={false}>
                {counter ? (
                  <motion.div
                    key={counter.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">
                      <counter.icon className="size-3" /> {counter.label}
                    </div>
                    <p className="mt-0.5 text-xl font-black">{counter.value}</p>
                    <p className="truncate text-[11px] text-white/70">{counter.hint}</p>
                  </motion.div>
                ) : (
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">
                      <ShoppingCart className="size-3" /> Order 30 Hari
                    </div>
                    <p className="mt-0.5 text-xl font-black">-</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
            {/* Kasir vs Online today — the one cut of the day's trade that
                isn't visible anywhere else in the app, and it fills itself in
                just by selling (no HPP, no faktur, no manual entry needed). */}
            <Link
              href="/dashboard/order-outlet"
              className="group rounded-2xl bg-white/10 p-3 backdrop-blur transition-colors hover:bg-white/20"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">
                <Store className="size-3" /> Transaksi Hari Ini
              </div>
              {todayChannels ? (
                <>
                  <p className="mt-0.5 flex items-baseline gap-1.5 text-sm font-black">
                    <span className="text-xl">{todayChannels.pos}</span>
                    <span className="text-[11px] font-bold text-white/70">Kasir</span>
                    <span className="text-white/40">·</span>
                    <span className="text-xl">{todayChannels.app}</span>
                    <span className="text-[11px] font-bold text-white/70">Online</span>
                  </p>
                  <p className="truncate text-[11px] text-white/70">
                    {todayChannels.aov > 0
                      ? `${fmtIDR(todayChannels.aov)} rata-rata`
                      : 'Belum ada transaksi hari ini'}
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-xl font-black">-</p>
              )}
            </Link>
          </div>
        </div>
      </div>

      {/* ── Feature Shortcuts ─────────────────────────────────────── */}
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black tracking-tight">Kelola Bisnis</h3>
          <span className="text-xs font-bold text-muted-foreground">{FEATURES.length} fitur</span>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.name}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.03 }}
            >
              <Link
                href={f.href}
                className="group flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-card p-3 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
              >
                <div className={`flex size-12 items-center justify-center rounded-2xl bg-linear-to-br ${f.grad} text-white shadow-lg transition-transform group-hover:scale-110`}>
                  <f.icon className="size-5" />
                </div>
                <span className="text-center text-[11px] font-bold leading-tight text-muted-foreground group-hover:text-foreground">
                  {f.name}
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── App Downloads ─────────────────────────────────────────── */}
      <section className="mt-8">
        <h3 className="mb-4 text-lg font-black tracking-tight">Aplikasi Pendukung Printer</h3>
        {/* Served from GitHub Releases (CDN, resumable) — not self-hosted:
            Railway's single origin made the 29MB download slow and flaky. */}
        <a
          href="https://github.com/rizkygin/thermalbridge-releases/releases/latest/download/thermalbridge.apk"
          className="group flex items-center gap-4 rounded-3xl border border-border/60 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-slate-700 to-slate-900 text-white shadow-lg">
            <Printer className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black">ThermalBridge</p>
            <p className="text-xs text-muted-foreground">
              Cetak struk ke printer thermal Bluetooth/USB dari HP kasir
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground/80">
              ±29 MB — disarankan unduh lewat Wi&#8209;Fi
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-muted px-3.5 py-2 text-xs font-bold text-foreground transition-colors group-hover:bg-blue-600 group-hover:text-white">
            <Download className="size-3.5" />
            APK
          </div>
        </a>
      </section>

      {/* ── Recent Orders ─────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black tracking-tight">Pesanan Terbaru</h3>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
            </p>
          </div>
          <Link
            href="/dashboard/order-outlet"
            className="flex items-center gap-1 rounded-2xl border border-border/60 px-3 py-1.5 text-xs font-bold transition-colors hover:bg-muted/50"
          >
            Lihat Semua <ArrowRight className="size-3.5" />
          </Link>
        </div>

        <div className="rounded-3xl border border-border/60 bg-card p-3 shadow-sm">
          {!recentOrders || recentOrders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <History className="size-8 opacity-20" />
              <p className="text-sm font-semibold">Belum ada pesanan</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentOrders.map((order, i) => {
                const s = order.status
                  ? STATUS_MAP[order.status]
                  : { label: 'Pending', color: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400' };
                const Icon = order.status === 'checkout' ? ShoppingBag : order.status === 'addToChart' ? ShoppingCart : History;
                return (
                  <motion.div
                    key={order.orderId}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: i * 0.03 }}
                  >
                    <Link
                      href={`/dashboard/order-outlet/${order.orderId}`}
                      className="group flex items-center justify-between rounded-2xl p-3 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex size-9 items-center justify-center rounded-xl ${s.color}`}>
                          <Icon className="size-4" />
                        </div>
                        <div>
                          <p className="text-sm font-black group-hover:text-blue-600 transition-colors">
                            #{order.orderId.slice(-8).toUpperCase()}
                          </p>
                          <p className="text-xs text-muted-foreground">{order.itemCount} item</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <span className="text-sm font-black tabular-nums">{fmtIDR(order.totalAmount)}</span>
                        <span className={`hidden rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider sm:inline-block ${s.color}`}>
                          {s.label}
                        </span>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
};
