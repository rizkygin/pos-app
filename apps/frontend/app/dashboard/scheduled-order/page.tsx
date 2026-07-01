'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { format, formatDistanceToNowStrict, isPast } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  CalendarClock,
  Wrench,
  Loader2,
  Sparkles,
  BellRing,
  ArrowRight,
  MapPin,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { acceptServiceOrder } from '@/app/dashboard/activeorder/actions';

function fmtIDR(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

// The customer-visible journey of a service order.
const STEPS = [
  { key: 'pending', label: 'Diajukan' },
  { key: 'confirmed', label: 'Diterima' },
  { key: 'preparing', label: 'Dijadwal' },
  { key: 'ready', label: 'Dikerjakan' },
  { key: 'on_delivery', label: 'Konfirmasi' },
] as const;

const STATUS_META: Record<
  string,
  { label: string; accent: string; ring: string; dot: string; text: string }
> = {
  pending: { label: 'Menunggu penyedia', accent: 'from-amber-400 to-orange-500', ring: 'ring-amber-300/50', dot: 'bg-amber-500', text: 'text-amber-600' },
  confirmed: { label: 'Dikonfirmasi', accent: 'from-sky-400 to-blue-500', ring: 'ring-sky-300/50', dot: 'bg-sky-500', text: 'text-sky-600' },
  preparing: { label: 'Terjadwal', accent: 'from-indigo-400 to-blue-600', ring: 'ring-indigo-300/50', dot: 'bg-indigo-500', text: 'text-indigo-600' },
  ready: { label: 'Sedang dikerjakan', accent: 'from-violet-400 to-purple-600', ring: 'ring-violet-300/50', dot: 'bg-violet-500', text: 'text-violet-600' },
  on_delivery: { label: 'Selesai — konfirmasi pian', accent: 'from-emerald-400 to-teal-500', ring: 'ring-emerald-300/60', dot: 'bg-emerald-500', text: 'text-emerald-600' },
};

type ScheduledOrder = {
  id: string;
  status: string;
  createdAt: string;
  scheduledAt: string | null;
  discountAmount: string | null;
  outletName: string;
  serviceName: string | null;
  totalAmount: number;
};

function Stepper({ status }: { status: string }) {
  const currentIdx = Math.max(0, STEPS.findIndex((s) => s.key === status));
  return (
    <div className="flex items-center">
      {STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={step.key} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <div className={`h-0.5 flex-1 rounded ${i === 0 ? 'opacity-0' : done || active ? 'bg-blue-500' : 'bg-muted'}`} />
              <motion.div
                className={`relative flex size-4 shrink-0 items-center justify-center rounded-full ${
                  done ? 'bg-blue-500' : active ? 'bg-blue-600' : 'bg-muted'
                }`}
                animate={active ? { scale: [1, 1.25, 1] } : {}}
                transition={{ duration: 1.3, repeat: Infinity }}
              >
                {done ? (
                  <svg viewBox="0 0 24 24" className="size-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={4}>
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className={`size-1.5 rounded-full ${active ? 'bg-white' : 'bg-muted-foreground/40'}`} />
                )}
                {active && <span className="absolute -inset-1 rounded-full bg-blue-500/25 animate-ping" />}
              </motion.div>
              <div className={`h-0.5 flex-1 rounded ${i === STEPS.length - 1 ? 'opacity-0' : done ? 'bg-blue-500' : 'bg-muted'}`} />
            </div>
            <span className={`mt-1 text-[9px] font-semibold ${active ? 'text-blue-600' : done ? 'text-foreground/70' : 'text-muted-foreground/50'}`}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function OrderCard({
  order,
  index,
  accepting,
  onAccept,
}: {
  order: ScheduledOrder;
  index: number;
  accepting: boolean;
  onAccept: (id: string) => void;
}) {
  const meta = STATUS_META[order.status] ?? STATUS_META.pending;
  const needsAction = order.status === 'on_delivery';
  const discount = order.discountAmount ? parseInt(order.discountAmount) : 0;
  const when = order.scheduledAt ? new Date(order.scheduledAt) : null;
  const rel = when
    ? isPast(when)
      ? 'sedang berlangsung / lewat'
      : `dalam ${formatDistanceToNowStrict(when, { locale: idLocale })}`
    : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className={`relative overflow-hidden rounded-3xl border bg-card shadow-sm ${
        needsAction ? 'border-emerald-300 ring-2 ring-emerald-200/60 dark:ring-emerald-900/40' : 'border-border/60'
      }`}
    >
      {/* Accent bar */}
      <div className={`h-1.5 w-full bg-gradient-to-r ${meta.accent}`} />

      <div className="p-4 space-y-4">
        {/* Head */}
        <div className="flex items-start gap-3">
          <div className={`flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.accent} text-white shadow-lg`}>
            <Wrench className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black">{order.serviceName ?? 'Layanan'}</p>
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="size-3" /> {order.outletName}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-[10px] font-bold ${meta.text}`}>
            <span className={`size-1.5 rounded-full ${meta.dot} ${needsAction ? 'animate-pulse' : ''}`} />
            {meta.label}
          </span>
        </div>

        {/* Progress */}
        <Stepper status={order.status} />

        {/* Schedule + price */}
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-3.5 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <CalendarClock className="size-3" /> Jadwal
            </p>
            {when ? (
              <>
                <p className="truncate text-xs font-bold text-foreground">
                  {format(when, "EEE, d MMM • HH:mm", { locale: idLocale })}
                </p>
                <p className={`text-[11px] font-semibold ${meta.text}`}>{rel}</p>
              </>
            ) : (
              <p className="text-xs font-medium text-muted-foreground">Menunggu jadwal dari penyedia</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-base font-black tabular-nums">{fmtIDR(order.totalAmount ?? 0)}</p>
            {discount > 0 && <p className="text-[11px] font-semibold text-emerald-600">hemat {fmtIDR(discount)}</p>}
          </div>
        </div>

        {/* Action */}
        {needsAction && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => onAccept(order.id)}
            disabled={accepting}
            className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/30 transition-all hover:shadow-emerald-500/50 disabled:opacity-60"
          >
            {accepting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Memproses...
              </>
            ) : (
              <>
                <BellRing className="size-4" /> Terima &amp; Selesaikan
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </motion.button>
        )}
        <p className="text-center text-[10px] text-muted-foreground/70">
          #{order.id.slice(-8).toUpperCase()}
        </p>
      </div>
    </motion.div>
  );
}

// A pure-CSS 3D floating tile (perspective tilt + layered depth shadows +
// levitation) — a lightweight "3D image" that needs no binary asset.
function FloatingIcon3D() {
  return (
    <div
      className="relative mb-1 flex flex-col items-center"
      style={{ perspective: '900px' }}
    >
      <motion.div
        animate={{ y: [-7, 7, -7], rotateZ: [-3, 3, -3] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d' }}
        className="relative"
      >
        {/* depth / side face */}
        <div
          className="absolute inset-0 rounded-[1.7rem] bg-indigo-950/50"
          style={{ transform: 'translateX(9px) translateY(12px)' }}
        />
        {/* front face */}
        <div
          style={{ transform: 'rotateX(20deg) rotateY(-24deg)' }}
          className="relative flex size-24 items-center justify-center rounded-[1.7rem] bg-gradient-to-br from-white via-indigo-50 to-indigo-200 text-indigo-600 shadow-[0_22px_50px_-12px_rgba(49,46,129,0.65),inset_0_3px_7px_rgba(255,255,255,0.95),inset_0_-10px_16px_rgba(99,102,241,0.3)]"
        >
          <span className="absolute right-3 top-3 size-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
          <CalendarClock className="size-12 drop-shadow-sm" strokeWidth={2.2} />
        </div>
      </motion.div>
      {/* ground shadow */}
      <motion.div
        animate={{ scaleX: [1, 0.78, 1], opacity: [0.45, 0.22, 0.45] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        className="mt-3 h-3 w-16 rounded-[50%] bg-black/50 blur-md"
      />
    </div>
  );
}

export default function ScheduledOrderPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<ScheduledOrder[] | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/get-scheduled-orders`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await res.json();
      setOrders(data.success ? (data.orders as ScheduledOrder[]) : []);
    } catch {
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const accept = (orderId: string) => {
    setAccepting(orderId);
    startTransition(async () => {
      try {
        await acceptServiceOrder(orderId);
        router.push(`/dashboard/ratings/submit/service/${orderId}`);
      } catch {
        setAccepting(null);
        await load();
      }
    });
  };

  const needsAction = (orders ?? []).filter((o) => o.status === 'on_delivery').length;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 md:px-6">
      {/* Hero */}
      <div className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 p-6 text-white shadow-xl shadow-indigo-500/20">
        <div className="absolute -right-8 -top-10 size-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-12 -left-6 size-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col items-center text-center">
          <FloatingIcon3D />
          <div className="mb-2 flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold backdrop-blur">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-300" /> LIVE
          </div>
          <h1 className="text-2xl font-black tracking-tight">Layanan Terjadwal</h1>
          <p className="mt-1 text-sm text-white/80">
            {orders === null
              ? 'Memuat...'
              : orders.length === 0
                ? 'Belum ada layanan berjalan'
                : `${orders.length} layanan berjalan`}
            {needsAction > 0 && (
              <span className="ml-1 font-bold text-emerald-200">
                • {needsAction} menunggu konfirmasimu
              </span>
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
            <div className="relative">
              <div className="flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-950 dark:to-indigo-950">
                <Sparkles className="size-8 text-blue-500" />
              </div>
            </div>
            <div>
              <p className="font-bold">Belum ada layanan terjadwal</p>
              <p className="text-sm text-muted-foreground">Ajukan layanan & pantau jadwalnya di sini</p>
            </div>
            <Link
              href="/dashboard/order/service"
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700"
            >
              <Wrench className="size-4" /> Ajukan Layanan
            </Link>
          </motion.div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {orders.map((order, i) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  index={i}
                  accepting={accepting === order.id}
                  onAccept={accept}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </main>
  );
}
