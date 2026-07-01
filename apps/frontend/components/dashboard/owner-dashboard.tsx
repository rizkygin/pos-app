'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
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
  Sparkles,
} from 'lucide-react';

type RecentOrder = {
  orderId: string;
  itemCount: number;
  totalAmount: number;
  status: 'addToChart' | 'checkout' | null;
};

type Total6MonthsSales = { totalSales: number; percentage: number };
type TopProduct = { name: string; category: string; totalSold: number } | null;

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

export const OwnerDashboard = ({
  activeOrdersCount,
  recentOrders,
  total6monthsSales,
  topProduct,
}: {
  activeOrdersCount: number;
  recentOrders: RecentOrder[];
  total6monthsSales: Total6MonthsSales;
  topProduct: TopProduct;
}) => {
  const isPositive = total6monthsSales.percentage >= 0;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
      {/* ── Gradient Hero ─────────────────────────────────────────── */}
      <div className="relative mt-4 overflow-hidden rounded-3xl bg-linear-to-br from-indigo-600 via-blue-600 to-violet-600 p-6 text-white shadow-xl shadow-indigo-500/20 md:p-8">
        <div className="absolute -right-10 -top-12 size-48 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-16 -left-10 size-48 rounded-full bg-white/10 blur-3xl" />

        <div className="relative">
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

          {/* Headline metric */}
          <div className="mt-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/60">
              Penjualan 6 Bulan
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-black tracking-tight md:text-4xl">
                {fmtIDR(total6monthsSales.totalSales)}
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${
                  isPositive ? 'bg-emerald-400/90 text-emerald-950' : 'bg-rose-400/90 text-rose-950'
                }`}
              >
                {isPositive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                {isPositive ? '+' : ''}
                {total6monthsSales.percentage.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Mini stats */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/10 p-3 backdrop-blur">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">
                <ShoppingBag className="size-3" /> Pesanan Aktif
              </div>
              <p className="mt-0.5 text-xl font-black">{activeOrdersCount}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 backdrop-blur">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">
                <Sparkles className="size-3" /> Produk Terlaris
              </div>
              <p className="mt-0.5 truncate text-sm font-black">{topProduct ? topProduct.name : '-'}</p>
              {topProduct && (
                <p className="text-[11px] text-white/70">{topProduct.totalSold} terjual · {topProduct.category}</p>
              )}
            </div>
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
