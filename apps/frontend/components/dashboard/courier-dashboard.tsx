'use client';

import React, { useCallback, useState, useTransition, useEffect, useRef } from 'react';
import {
  Wallet,
  MapPin,
  Navigation,
  Star,
  Clock,
  CheckCircle2,
  TrendingUp,
  Bike,
  Bell,
  Power,
  MessageSquare,
  Phone,
  Loader2,
  WifiOff,
  Wifi,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { goOnline, goOffline } from '@/app/dashboard/courier-sessions/actions';
import { API_URL } from '@/lib/api-url';
import { useCourierLocationReporting } from '@/hooks/use-courier-location-reporting';
import { getCurrentPosition, geolocationMessage } from '@/lib/geolocation';

type Props = {
  dashboardValue: {
    earningToday: string;
    completion: string;
    rating: string;
  };
  weeklyPerformance: {
    totalEarnings: string;
    percentageChange: number;
    orders: number;
    avgPerOrder: string;
    daily?: { label: string; amount: number }[];
  };
  currentPickUp: {
    id: string;
    name_customer: string;
    customer_phone: string | null;
    pickup: string;
    dropoff: string;
    dropoffCoords: { lat: number; lon: number } | null;
    items: number;
    amount: string;
    status: string;
  } | null;
  initialIsOnline: boolean;
  todayOnlineSeconds: number;
  ratingStatus: 'good_standing' | 'probation';
  delaySeconds: number;
  verificationStatus?: 'pending' | 'approved' | 'rejected';
  verificationNote?: string | null;
};

function formatSeconds(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s}d`;
}

// The running total lives in the parent (see CourierDashboard): the tile is
// hidden while offline, so state held here would be destroyed on unmount and
// restart from a stale page-load value the next time the courier goes online.
function OnlineTimer({ seconds }: { seconds: number }) {
  return <span>{formatSeconds(seconds)}</span>;
}

type HistoryItem = {
  id: string;
  status: string;
  deliveryFee: string | null;
  timestamp: string | null;
  customerName: string;
  outletName: string;
  dropoff: string | null;
};

function statusIcon(status: string) {
  if (status === 'delivered')
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (status === 'cancelled')
    return <XCircle className="h-5 w-5 text-rose-500" />;
  if (status === 'on_delivery')
    return <Navigation className="h-5 w-5 text-blue-600" />;
  return <Clock className="h-5 w-5 text-amber-500" />;
}

function statusBg(status: string) {
  if (status === 'delivered') return 'bg-emerald-50';
  if (status === 'cancelled') return 'bg-rose-50';
  if (status === 'on_delivery') return 'bg-blue-50';
  return 'bg-amber-50';
}

// Google Maps turn-by-turn to the drop-off. Coordinates when we have them —
// an address string is whatever the customer typed, and Maps will happily land
// on the wrong end of town with it. Origin is left out so Maps routes from
// wherever the rider actually is.
function mapsDirectionsUrl(
  coords: { lat: number; lon: number } | null,
  address: string,
) {
  const destination = coords ? `${coords.lat},${coords.lon}` : address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

// Earnings per day for the week so far. Bars rather than a line: seven points
// where several are legitimately zero read as gaps in a line chart, but as
// "no orders that day" in bars, which is what they mean.
function WeeklyEarningsChart({
  daily,
}: {
  daily: { label: string; amount: number }[];
}) {
  // Resolved after mount, never during render: the server and the browser can
  // sit on opposite sides of midnight, and a mismatched highlight is a
  // hydration error.
  const [todayIndex, setTodayIndex] = useState<number | null>(null);
  useEffect(() => setTodayIndex((new Date().getDay() + 6) % 7), []);

  const peak = Math.max(...daily.map((d) => d.amount), 0);

  return (
    <div className="mb-8 flex h-24 items-stretch gap-1.5">
      {daily.map((day, i) => {
        // Floored so a day with earnings always shows something; a 1px sliver
        // next to a big day would otherwise be indistinguishable from zero.
        const height = peak > 0 && day.amount > 0
          ? Math.max((day.amount / peak) * 100, 8)
          : 2;
        const isToday = i === todayIndex;
        return (
          <div key={day.label} className="flex h-full flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full flex-1 items-end">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${height}%` }}
                transition={{ duration: 0.5, delay: i * 0.05, ease: 'easeOut' }}
                title={`${day.label}: ${new Intl.NumberFormat('id-ID', {
                  style: 'currency',
                  currency: 'IDR',
                  minimumFractionDigits: 0,
                }).format(day.amount)}`}
                className={`w-full rounded-t-md ${isToday ? 'bg-white' : 'bg-white/30'}`}
              />
            </div>
            <span
              className={`text-[9px] font-bold ${isToday ? 'opacity-100' : 'opacity-50'}`}
            >
              {day.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const CourierDashboard = ({
  dashboardValue,
  weeklyPerformance,
  currentPickUp,
  initialIsOnline,
  todayOnlineSeconds,
  ratingStatus,
  delaySeconds,
  verificationStatus = 'approved',
  verificationNote = null,
}: Props) => {
  const [isOnline, setIsOnline] = useState(initialIsOnline);
  const [isPending, startTransition] = useTransition();

  // Defaults to approved so a courier whose payload predates this feature (or
  // any caller that omits the field) is never locked out by a missing value —
  // the backend is the actual gate, and it reads the column directly.
  const isVerified = verificationStatus === 'approved';

  // Today's accumulated online time. Ticks only while actually on shift —
  // previously it counted up regardless, so an offline courier's total kept
  // growing and was wrong the moment they came back online.
  const [onlineSeconds, setOnlineSeconds] = useState(todayOnlineSeconds);
  useEffect(() => setOnlineSeconds(todayOnlineSeconds), [todayOnlineSeconds]);
  useEffect(() => {
    if (!isOnline) return;
    const id = setInterval(() => setOnlineSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isOnline]);
  const [showConfirm, setShowConfirm] = useState(false);
  // Why the last go-offline attempt was refused. Shown in place of the confirm
  // bubble so the courier gets the reason where they tapped.
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirrors the backend rule in /api/courier/go-offline: a courier carrying an
  // order stays on shift until it is done.
  const hasActiveOrder = !!currentPickUp;
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // The device stopped producing positions mid-shift — GPS switched off, or the
  // permission revoked. Being online without a position is the worst of both
  // worlds: the courier believes they are working while dispatch ranks them
  // last on every offer, so the shift ends rather than limps on.
  //
  // Not while carrying an order: go-offline would be refused anyway, and the
  // customer still needs whatever ETA we can give. They get told instead.
  const handleLocationLost = useCallback(
    (message: string) => {
      setOfflineError(`${message} Silakan online lagi setelah lokasi aktif.`);
      if (hasActiveOrder) return;
      void goOffline()
        .then(() => setIsOnline(false))
        .catch(() => {});
    },
    [hasActiveOrder],
  );

  // Report position for the whole shift, not just mid-delivery: dispatch offers
  // orders nearest-first, so an online courier with no known position is ranked
  // behind everyone who has one. Stops at go-offline, which also clears the
  // stored point server-side.
  useCourierLocationReporting(isOnline, handleLocationLost);

  useEffect(() => {
    fetch(`${API_URL}/api/get-courier-history`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => { if (data.success) setHistory(data.history); });
  }, []);

  const handleToggle = () => {
    // The backend refuses go-online for an unverified courier anyway; this stops
    // them making the request only to be told no.
    if (!isVerified) return;
    if (isOnline) {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
      // Don't even offer the confirmation while an order is in flight — the
      // request would only come back refused.
      if (hasActiveOrder) {
        setShowConfirm(false);
        setOfflineError(
          'Selesaikan pengantaran yang sedang berjalan dulu sebelum offline.',
        );
        confirmTimeoutRef.current = setTimeout(() => setOfflineError(null), 4000);
        return;
      }
      // Ask for confirmation before going offline
      setOfflineError(null);
      setShowConfirm(true);
      confirmTimeoutRef.current = setTimeout(() => setShowConfirm(false), 4000);
    } else {
      // Prove the device can locate before opening a shift. Going online with
      // the GPS off produces a courier who looks available, is offered nothing,
      // and has no way to tell why — cheaper to refuse here and say so.
      setOfflineError(null);
      getCurrentPosition(
        () => {
          startTransition(async () => {
            try {
              await goOnline();
              setIsOnline(true);
            } catch {
              setOfflineError('Gagal online. Coba lagi.');
            }
          });
        },
        (err) => {
          setOfflineError(geolocationMessage(err));
          if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
          confirmTimeoutRef.current = setTimeout(() => setOfflineError(null), 6000);
        },
      );
    }
  };

  const handleConfirmOffline = () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setShowConfirm(false);
    startTransition(async () => {
      try {
        await goOffline();
        setIsOnline(false);
      } catch (err) {
        // Covers the race the local check can't: an order accepted between this
        // page's render and the tap. The backend's wording wins.
        setOfflineError(err instanceof Error ? err.message : 'Gagal offline');
        confirmTimeoutRef.current = setTimeout(() => setOfflineError(null), 5000);
      }
    });
  };

  // `.filter` matters: the online-time tile carried a `hidden` flag that the
  // grid never read, so it rendered a frozen 0s counter while offline.
  const stats = [
    {
      label: 'Pendapatan Hari Ini',
      value: dashboardValue.earningToday,
      icon: Wallet,
      color: 'text-emerald-600',
      bg: 'bg-emerald-100 dark:bg-emerald-950/50',
    },
    {
      label: 'Rating',
      value: dashboardValue.rating,
      icon: Star,
      color: 'text-amber-600',
      bg: 'bg-amber-100 dark:bg-amber-950/50',
    },
    {
      label: 'Penyelesaian',
      value: dashboardValue.completion,
      icon: CheckCircle2,
      color: 'text-blue-600',
      bg: 'bg-blue-100 dark:bg-blue-950/50',
    },
    {
      label: 'Online Hari Ini',
      value: <OnlineTimer seconds={onlineSeconds} />,
      icon: Clock,
      color: 'text-purple-600',
      bg: 'bg-purple-100 dark:bg-purple-950/50',
      hidden: !isOnline,
    },
  ].filter((s) => !s.hidden);


  return (
    <main className="mx-auto w-full max-w-7xl px-4 pt-5 pb-12 space-y-5 md:px-6">
      {/* Verification gate. Sits above everything: until an admin says yes there
          is no going online, so leading with the earnings panel would be
          describing a job this person cannot start. */}
      {!isVerified && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex flex-col gap-3 rounded-2xl border-2 px-5 py-4 sm:flex-row sm:items-center ${
            verificationStatus === 'rejected'
              ? 'border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30'
              : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
          }`}
        >
          <ShieldAlert
            className={`h-6 w-6 shrink-0 ${
              verificationStatus === 'rejected' ? 'text-rose-600' : 'text-amber-600'
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="font-black">
              {verificationStatus === 'rejected'
                ? 'Verifikasi ditolak'
                : 'Menunggu verifikasi admin'}
            </p>
            <p className="text-sm text-muted-foreground">
              {verificationStatus === 'rejected'
                ? verificationNote || 'Perbaiki dokumen pian, lalu unggah ulang.'
                : 'Pian belum bisa online sampai dokumen diverifikasi admin.'}
            </p>
          </div>
          <Link
            href="/dashboard/courier-verification"
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700"
          >
            Lengkapi Dokumen <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      )}
      {/* Command bar: identity on the left, shift controls on the right. One
          card so the page opens on a single object rather than loose text. */}
      {/* relative z-10: backdrop-blur makes this card its own stacking context,
          so the popovers' z-50 only ranks them INSIDE it. Without lifting the
          card itself, the later KPI cards paint over the bubble. */}
      <div className="relative z-10 flex flex-col gap-4 rounded-2xl border bg-card/50 p-4 backdrop-blur-sm md:flex-row md:items-center md:justify-between md:p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-600/25">
            <Bike className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight sm:text-2xl">
              Dashboard Kurir
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Terus jalan, terus cuan. Pantau pengantaran pian real-time.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Status badge */}
          <motion.div
            animate={
              isOnline
                ? {
                    backgroundColor: 'rgb(240 253 244)',
                    borderColor: 'rgb(167 243 208)',
                    color: 'rgb(4 120 87)',
                  }
                : {
                    backgroundColor: 'rgb(255 241 242)',
                    borderColor: 'rgb(254 205 211)',
                    color: 'rgb(190 18 60)',
                  }
            }
            transition={{ duration: 0.4 }}
            className="relative flex items-center gap-2 px-4 py-2 rounded-full border overflow-hidden"
          >
            {/* Ripple ring when online */}
            {isOnline && (
              <>
                <motion.span
                  className="absolute inset-0 rounded-full bg-emerald-400/20"
                  animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                  transition={{
                    duration: 1.8,
                    repeat: Infinity,
                    ease: 'easeOut',
                  }}
                />
              </>
            )}
            <motion.div
              animate={
                isOnline
                  ? { backgroundColor: 'rgb(16 185 129)' }
                  : { backgroundColor: 'rgb(244 63 94)' }
              }
              transition={{ duration: 0.4 }}
              className="relative h-2.5 w-2.5 rounded-full"
            >
              {isOnline && (
                <motion.span
                  className="absolute inset-0 rounded-full bg-emerald-400"
                  animate={{ scale: [1, 2], opacity: [1, 0] }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: 'easeOut',
                  }}
                />
              )}
            </motion.div>
            <motion.span
              layout
              className="text-sm font-black tracking-widest uppercase"
            >
              {isPending ? '...' : isOnline ? 'Online' : 'Offline'}
            </motion.span>
          </motion.div>

          {/* Toggle button */}
          <div className="relative">
            <AnimatePresence mode="wait">
              {offlineError ? (
                <motion.div
                  key="offline-error"
                  initial={{ opacity: 0, scale: 0.85, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.85, y: -4 }}
                  className="absolute right-0 top-12 z-50 flex max-w-[16rem] items-start gap-2 rounded-2xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-white shadow-xl shadow-amber-500/30"
                >
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{offlineError}</span>
                </motion.div>
              ) : showConfirm ? (
                <motion.div
                  key="confirm"
                  initial={{ opacity: 0, scale: 0.85, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.85, y: -4 }}
                  className="absolute right-0 top-12 z-50 flex items-center gap-2 bg-rose-600 text-white text-xs font-bold rounded-2xl px-4 py-2.5 shadow-xl shadow-rose-600/30 whitespace-nowrap"
                >
                  <WifiOff className="h-3.5 w-3.5 shrink-0" />
                  <span>Offline sekarang?</span>
                  <button
                    onClick={handleConfirmOffline}
                    className="ml-1 underline underline-offset-2 hover:no-underline"
                  >
                    Ya
                  </button>
                  <button
                    onClick={() => {
                      setShowConfirm(false);
                      if (confirmTimeoutRef.current)
                        clearTimeout(confirmTimeoutRef.current);
                    }}
                    className="opacity-70 hover:opacity-100"
                  >
                    ✕
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <motion.button
              whileTap={{ scale: 0.93 }}
              whileHover={{ scale: 1.04 }}
              disabled={isPending || !isVerified}
              onClick={handleToggle}
              // Not `disabled` while carrying an order: a dead button explains
              // nothing. It stays tappable and answers with the reason.
              title={
                isOnline && hasActiveOrder
                  ? 'Selesaikan pengantaran yang sedang berjalan dulu'
                  : undefined
              }
              className={`relative flex items-center gap-2 px-5 py-2.5 rounded-full font-black text-sm shadow-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed
                                ${
                                  isOnline
                                    ? hasActiveOrder
                                      ? 'bg-muted text-muted-foreground shadow-none cursor-not-allowed'
                                      : 'bg-rose-500 text-white shadow-rose-500/30 hover:bg-rose-600'
                                    : 'bg-emerald-500 text-white shadow-emerald-500/30 hover:bg-emerald-600'
                                }`}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isOnline ? (
                <WifiOff className="h-4 w-4" />
              ) : (
                <Wifi className="h-4 w-4" />
              )}
              {isPending ? 'Tunggu...' : isOnline ? 'Offline-kan' : 'Online-kan'}
            </motion.button>
          </div>
        </div>
      </div>

      {/* Rating awareness banner */}
      {ratingStatus === 'probation' && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 dark:border-amber-900/30 dark:bg-amber-950/20"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
              Kamu sedang tidak menjadi prioritas
            </p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
              Rating kamu di bawah 3.0, jadi order baru muncul {Math.round(delaySeconds)} detik lebih lambat untukmu dibanding kurir lain. Selesaikan order dengan baik untuk meningkatkan rating dan kembali jadi prioritas.
            </p>
          </div>
        </motion.div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="rounded-2xl border bg-card/50 p-4 backdrop-blur-sm transition-shadow hover:shadow-md"
          >
            <div className="mb-3 flex items-center gap-2.5">
              <div className={`rounded-lg p-2 ${stat.bg} ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                {stat.label}
              </span>
            </div>
            <p className="text-2xl font-black tabular-nums">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        {/* Active Delivery Section */}
        <div className="space-y-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
              Pengantaran Aktif
            </h2>
          </div>

          <AnimatePresence mode="wait">
            {isOnline && currentPickUp ? (
              <motion.div
                key="active-order"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="group relative overflow-hidden rounded-2xl border border-blue-100/60 bg-linear-to-br from-blue-600/5 to-transparent p-5 shadow-sm sm:p-6 dark:border-blue-900/40"
              >
                <div className="absolute top-0 right-0 p-6 opacity-[0.07] transition-opacity group-hover:opacity-15">
                  <Bike className="h-28 w-28 -rotate-12" />
                </div>

                <div className="relative z-10 space-y-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-full bg-blue-600 text-white text-[10px] font-black uppercase tracking-tighter">
                          Pesanan Aktif
                        </span>
                        <span className="text-sm font-bold text-blue-600">
                          #{currentPickUp.id.slice(-6).toUpperCase()}
                        </span>
                      </div>
                      <h3 className="truncate text-2xl font-black">
                        {currentPickUp.name_customer}
                      </h3>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Ongkos Kirim
                      </p>
                      <p className="text-2xl font-black text-emerald-600">
                        {currentPickUp.amount}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-6 border-t pt-5 md:grid-cols-2">
                    {/* Timeline. Each stop owns its own marker row, and the
                        connector stretches to whatever that row's height turns
                        out to be — the old fixed-height rail drifted out of
                        alignment as soon as a stop grew an extra line. */}
                    <div>
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600">
                            <MapPin className="h-3 w-3 text-white" />
                          </div>
                          <div className="w-0.5 flex-1 bg-linear-to-b from-blue-600 to-emerald-600" />
                        </div>
                        <div className="min-w-0 flex-1 pb-5">
                          <p className="text-[10px] font-black leading-6 text-muted-foreground uppercase tracking-widest">
                            Pengambilan
                          </p>
                          <p className="text-sm font-bold line-clamp-1">
                            {currentPickUp.pickup}
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600">
                          <Navigation className="h-3 w-3 text-white" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-black leading-6 text-muted-foreground uppercase tracking-widest">
                            Pengiriman ke
                          </p>
                          <p className="text-sm font-bold line-clamp-1">
                            {currentPickUp.dropoff}
                          </p>
                          <a
                            href={mapsDirectionsUrl(
                              currentPickUp.dropoffCoords,
                              currentPickUp.dropoff,
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600 transition-colors hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/40"
                          >
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            Lihat Peta
                          </a>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col justify-end gap-3">
                      {/* Not an action: there is no "arrived" order status for a
                          courier to set, so this is a prompt, not a control. */}
                      <p className="text-sm font-bold text-muted-foreground">
                        Sudah sampai? Hubungi customer:
                      </p>
                      {/* Hidden when the customer has no usable number: a
                          wa.me link built from a bad one opens a dead chat. */}
                      {currentPickUp.customer_phone && (
                        <div className="flex gap-2">
                          <Button
                            asChild
                            className="flex-1 rounded-xl h-12 font-bold bg-[#25D366] text-white hover:bg-[#1DA851] shadow-lg shadow-[#25D366]/20"
                          >
                            <a
                              href={`https://wa.me/${currentPickUp.customer_phone}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <MessageSquare className="h-4 w-4" />
                              Chat WhatsApp
                            </a>
                          </Button>
                          <Button
                            asChild
                            className="flex-1 rounded-xl h-12 font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20"
                          >
                            <a href={`tel:+${currentPickUp.customer_phone}`}>
                              <Phone className="h-4 w-4" />
                              Telepon Pulsa
                            </a>
                          </Button>
                        </div>
                      )}

                      {/* Outside the phone gate: handing the order over is the
                          courier's next step whether or not we hold a number
                          for this customer. */}
                      <Button
                        asChild
                        variant="outline"
                        className="w-full rounded-xl h-12 font-bold"
                      >
                        <Link href="/dashboard/lobby">
                          <CheckCircle2 className="h-4 w-4" />
                          Sudah terkirim?
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : isOnline ? (
              <motion.div
                key="waiting"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative flex flex-col items-center justify-center space-y-4 overflow-hidden rounded-2xl border border-blue-100/60 bg-linear-to-br from-blue-600/5 to-indigo-600/5 p-10 text-center dark:border-blue-900/40"
              >
                <motion.div
                  animate={{ scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="rounded-full bg-blue-100 p-4 dark:bg-blue-950/50"
                >
                  <Bike className="h-10 w-10 text-blue-600" />
                </motion.div>
                <div className="space-y-1">
                  <h3 className="text-lg font-black">Belum ada pengiriman aktif</h3>
                  <p className="text-sm text-muted-foreground">
                    Pergi ke lobby kurir untuk mendapatkan pesanan.
                  </p>
                </div>
                <Link
                  href="/dashboard/lobby"
                  className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700"
                >
                  <Navigation className="h-4 w-4" />
                  Ke Ruang Tunggu Orderan
                </Link>
              </motion.div>
            ) : (
              <motion.div
                key="offline"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center justify-center space-y-4 rounded-2xl border border-dashed p-10 text-center"
              >
                <motion.div
                  animate={{ scale: [1, 1.08, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{
                    duration: 2.5,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="rounded-full bg-muted/50 p-4"
                >
                  <Power className="h-10 w-10 text-muted-foreground" />
                </motion.div>
                <div className="space-y-1">
                  <h3 className="text-lg font-black">
                    Pian Sedang Offline Sekarang
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Buat online agar dapat menerima orderan
                  </p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  whileHover={{ scale: 1.04 }}
                  disabled={isPending}
                  onClick={handleToggle}
                  className="flex items-center gap-2 px-8 py-2.5 rounded-full font-black text-sm bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-600 transition-colors disabled:opacity-60"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wifi className="h-4 w-4" />
                  )}
                  Go Online
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Delivery History */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
                Pengantaran Terakhir
              </h2>
              <Button asChild variant="link" className="h-auto p-0 text-xs font-bold">
                <Link href="/dashboard/activeorder">Lihat Semua</Link>
              </Button>
            </div>
            <div className="divide-y rounded-2xl border bg-card/50 backdrop-blur-sm">
              {history.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Belum ada pengantaran.
                </p>
              ) : (
                history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${statusBg(item.status)}`}>
                        {statusIcon(item.status)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{item.dropoff ?? item.outletName}</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                          {item.status} • {item.timestamp ? relativeTime(item.timestamp) : '—'}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums">
                        {item.deliveryFee
                          ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(parseFloat(item.deliveryFee))
                          : '—'}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-bold">
                        {item.customerName}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Stats */}
        <div className="space-y-5">
          {/* Performance Card */}
          <div className="rounded-2xl bg-linear-to-br from-purple-600 to-indigo-700 p-5 text-white shadow-lg shadow-indigo-600/20">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[10px] font-black uppercase tracking-widest opacity-80">
                Minggu Ini
              </h2>
              <TrendingUp className="h-4 w-4 opacity-80" />
            </div>
            <div className="mb-5 space-y-2">
              <p className="text-xs font-bold opacity-60">Total Pendapatan</p>
              <p className="text-3xl font-black tabular-nums">{weeklyPerformance.totalEarnings}</p>
              <p className="w-fit rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">
                {(weeklyPerformance.percentageChange ?? 0) >= 0 ? '+' : ''}
                {(weeklyPerformance.percentageChange ?? 0).toFixed(1)}% dari minggu lalu
              </p>
            </div>
            {weeklyPerformance.daily && weeklyPerformance.daily.length > 0 && (
              <WeeklyEarningsChart daily={weeklyPerformance.daily} />
            )}

            <div className="grid grid-cols-2 gap-4 border-t border-white/15 pt-5">
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest opacity-60">
                  Jumlah Pesanan
                </p>
                <p className="text-xl font-black tabular-nums">{weeklyPerformance.orders}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest opacity-60">
                  Rata Rata Pesanan
                </p>
                <p className="text-xl font-black tabular-nums">{weeklyPerformance.avgPerOrder}</p>
              </div>
            </div>
          </div>

          

          {/* Quick Support */}
          <Button
            variant="outline"
            className="flex h-auto w-full flex-col gap-1 rounded-2xl border-dashed py-6 transition-colors hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30"
          >
            <span className="text-[10px] font-black uppercase tracking-widest">
              Butuh Bantuan?
            </span>
            <span className="text-[10px] text-muted-foreground">
              Hubungi agen dukungan
            </span>
          </Button>
        </div>
      </div>
    </main>
  );
};
