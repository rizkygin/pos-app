'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShoppingBag,
  CheckCircle2,
  XCircle,
  Clock,
  Bike,
  Package,
  Wrench,
  Star,
  Hourglass,
  Loader2,
  Receipt,
  ArrowRight,
  MapPin,
  Truck,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';

function fmtIDR(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

const STATUS_META: Record<
  string,
  { label: string; icon: typeof Clock; accent: string; text: string; dot: string }
> = {
  pending: { label: 'Menunggu', icon: Clock, accent: 'from-amber-400 to-orange-500', text: 'text-amber-600', dot: 'bg-amber-500' },
  confirmed: { label: 'Dikonfirmasi', icon: Package, accent: 'from-sky-400 to-blue-500', text: 'text-sky-600', dot: 'bg-sky-500' },
  preparing: { label: 'Diproses', icon: Package, accent: 'from-indigo-400 to-blue-600', text: 'text-indigo-600', dot: 'bg-indigo-500' },
  ready: { label: 'Siap Diambil', icon: Package, accent: 'from-violet-400 to-purple-600', text: 'text-violet-600', dot: 'bg-violet-500' },
  on_delivery: { label: 'Dalam Pengiriman', icon: Bike, accent: 'from-cyan-400 to-sky-500', text: 'text-cyan-600', dot: 'bg-cyan-500' },
  delivered: { label: 'Selesai', icon: CheckCircle2, accent: 'from-emerald-400 to-teal-500', text: 'text-emerald-600', dot: 'bg-emerald-500' },
  cancelled: { label: 'Dibatalkan', icon: XCircle, accent: 'from-rose-400 to-red-500', text: 'text-rose-600', dot: 'bg-rose-500' },
};

type HistoryOrder = {
  id: string;
  status: string;
  createdAt: string;
  outletName: string;
  fulfillment: 'delivery' | 'service' | 'materials';
  items: { name: string; quantity: number }[];
  itemCount: number;
  totalAmount: number;
  rated: boolean;
  canRate: boolean;
  ratingExpired: boolean;
};

// Pure-CSS 3D floating tile — matches the scheduled-order hero.
function FloatingReceipt3D() {
  return (
    <div className="relative mb-1 flex flex-col items-center" style={{ perspective: '900px' }}>
      <motion.div
        animate={{ y: [-7, 7, -7], rotateZ: [-3, 3, -3] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d' }}
        className="relative"
      >
        <div
          className="absolute inset-0 rounded-[1.7rem] bg-fuchsia-950/50"
          style={{ transform: 'translateX(9px) translateY(12px)' }}
        />
        <div
          style={{ transform: 'rotateX(20deg) rotateY(-24deg)' }}
          className="relative flex size-24 items-center justify-center rounded-[1.7rem] bg-gradient-to-br from-white via-fuchsia-50 to-fuchsia-200 text-fuchsia-600 shadow-[0_22px_50px_-12px_rgba(112,26,117,0.6),inset_0_3px_7px_rgba(255,255,255,0.95),inset_0_-10px_16px_rgba(217,70,239,0.28)]"
        >
          <span className="absolute right-3 top-3 size-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]" />
          <Receipt className="size-12 drop-shadow-sm" strokeWidth={2.2} />
        </div>
      </motion.div>
      <motion.div
        animate={{ scaleX: [1, 0.78, 1], opacity: [0.45, 0.22, 0.45] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        className="mt-3 h-3 w-16 rounded-[50%] bg-black/50 blur-md"
      />
    </div>
  );
}

function HistoryCard({ order, index }: { order: HistoryOrder; index: number }) {
  const meta = STATUS_META[order.status] ?? STATUS_META.pending;
  const StatusIcon = meta.icon;
  const isService = order.fulfillment === 'service';
  // Bulky goods read as goods, not a service — but the truck says at a glance
  // that the shop brought it, which is the part a customer remembers.
  const LeadIcon = isService ? Wrench : order.fulfillment === 'materials' ? Truck : ShoppingBag;
  const date = order.createdAt
    ? format(new Date(order.createdAt), 'd MMM yyyy • HH:mm', { locale: idLocale })
    : '-';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={`relative overflow-hidden rounded-3xl border bg-card shadow-sm ${
        order.canRate ? 'border-amber-300 ring-2 ring-amber-200/60 dark:ring-amber-900/40' : 'border-border/60'
      }`}
    >
      <div className={`h-1.5 w-full bg-gradient-to-r ${meta.accent}`} />

      <div className="p-4 space-y-3">
        {/* Head */}
        <div className="flex items-start gap-3">
          <div className={`flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.accent} text-white shadow-lg`}>
            <LeadIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black">{order.outletName}</p>
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="size-3" /> #{order.id.slice(-8).toUpperCase()} • {date}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-base font-black tabular-nums">{fmtIDR(order.totalAmount ?? 0)}</p>
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${meta.text}`}>
              <StatusIcon className="size-3" /> {meta.label}
            </span>
          </div>
        </div>

        {/* What they bought */}
        {order.items.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {order.items.map((it, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-lg bg-muted/60 px-2 py-1 text-[11px] font-medium text-foreground/80"
              >
                <span className="max-w-[160px] truncate">{it.name}</span>
                <span className="text-muted-foreground">×{it.quantity}</span>
              </span>
            ))}
          </div>
        )}

        {/* Rating CTA */}
        {order.canRate && (
          <Link
            href={
              isService
                ? `/dashboard/ratings/submit/service/${order.id}`
                : `/dashboard/ratings/submit/customer/${order.id}`
            }
            className="group flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-2.5 text-sm font-black text-white shadow-lg shadow-amber-500/30 transition-all hover:shadow-amber-500/50"
          >
            <Star className="size-4 fill-white" /> Beri Penilaian
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
        {order.rated && (
          <div className="flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 py-2 text-xs font-bold text-emerald-600">
            <CheckCircle2 className="size-3.5" /> Sudah dinilai
          </div>
        )}
        {order.ratingExpired && (
          <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground/70">
            <Hourglass className="size-3.5" /> Masa penilaian berakhir (lewat 7 hari)
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function HistoryOrderPage() {
  const [orders, setOrders] = useState<HistoryOrder[] | null>(null);
  const [notCustomer, setNotCustomer] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/get-customer-history`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) {
        setNotCustomer(true);
        setOrders([]);
        return;
      }
      setOrders(data.orders as HistoryOrder[]);
    } catch {
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rateable = (orders ?? []).filter((o) => o.canRate).length;

  if (notCustomer) {
    return (
      <main className="w-full px-4 pb-12 md:px-6">
        <div className="mx-auto flex min-h-[40vh] w-full max-w-2xl flex-col items-center justify-center gap-3">
          <ShoppingBag className="size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Kamu belum terdaftar sebagai pelanggan.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="w-full px-4 pb-16 md:px-6">
      {/* The column centers on an inner block, not on <main> itself: <main> is a
          direct child of the flex-column sidebar inset, where auto margins on a
          stretched item don't reliably win. */}
      <div className="mx-auto w-full max-w-2xl">
        {/* Hero */}
        <div className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-rose-500 via-fuchsia-600 to-purple-600 p-6 text-white shadow-xl shadow-fuchsia-500/20">
          <div className="absolute -right-8 -top-10 size-40 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-12 -left-6 size-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-col items-center text-center">
            <FloatingReceipt3D />
            <h1 className="text-2xl font-black tracking-tight">Riwayat Pesanan</h1>
            <p className="mt-1 text-sm text-white/80">
              {orders === null
                ? 'Memuat...'
                : orders.length === 0
                  ? 'Belum ada pesanan'
                  : `${orders.length} pesanan`}
              {rateable > 0 && (
                <span className="ml-1 font-bold text-amber-200">• {rateable} bisa dinilai</span>
              )}
            </p>
          </div>
        </div>

        {/* List */}
        <div className="mt-5">
          {orders === null ? (
            <div className="flex min-h-[30vh] items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-border/60 py-16 text-center"
            >
              <div className="flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br from-rose-100 to-fuchsia-100 dark:from-rose-950 dark:to-fuchsia-950">
                <ShoppingBag className="size-8 text-fuchsia-500" />
              </div>
              <div>
                <p className="font-bold">Belum ada pesanan</p>
                <p className="text-sm text-muted-foreground">Pesanan yang kamu buat akan muncul di sini</p>
              </div>
              <Link
                href="/dashboard/order"
                className="inline-flex items-center gap-2 rounded-2xl bg-fuchsia-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-fuchsia-600/25 transition-colors hover:bg-fuchsia-700"
              >
                Mulai pesan sekarang
              </Link>
            </motion.div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence>
                {orders.map((order, i) => (
                  <HistoryCard key={order.id} order={order} index={i} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
