'use client';

import React, { useState, useTransition, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { DashboardHeader } from '@/components/dashboard-header';
import { goOnline, goOffline } from '@/app/dashboard/courier-sessions/actions';

type Props = {
  dashboardValue: {
    earningToday: string;
    completion: string;
    rating: string;
  };
  currentPickUp: {
    id: string;
    name_customer: string;
    pickup: string;
    dropoff: string;
    items: number;
    amount: string;
    status: string;
  } | null;
  initialIsOnline: boolean;
  todayOnlineSeconds: number;
};

function formatSeconds(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s}d`;
}

function OnlineTimer({ initialSeconds }: { initialSeconds: number }) {
  const [seconds, setSeconds] = useState(initialSeconds);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
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
  currentPickUp,
  initialIsOnline,
  todayOnlineSeconds,
}: Props) => {
  const [isOnline, setIsOnline] = useState(initialIsOnline);
  const [isPending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    fetch('/api/get-courier-history')
      .then((r) => r.json())
      .then((data) => { if (data.success) setHistory(data.history); });
  }, []);

  const handleToggle = () => {
    if (isOnline) {
      // Ask for confirmation before going offline
      setShowConfirm(true);
      confirmTimeoutRef.current = setTimeout(() => setShowConfirm(false), 4000);
    } else {
      startTransition(async () => {
        await goOnline();
        setIsOnline(true);
      });
    }
  };

  const handleConfirmOffline = () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setShowConfirm(false);
    startTransition(async () => {
      await goOffline();
      setIsOnline(false);
    });
  };

  const stats = [
    {
      label: 'Earnings Today',
      value: dashboardValue.earningToday,
      icon: Wallet,
      color: 'text-emerald-600',
      bg: 'bg-emerald-100',
    },
    {
      label: 'Rating',
      value: dashboardValue.rating,
      icon: Star,
      color: 'text-amber-600',
      bg: 'bg-amber-100',
    },
    {
      label: 'Completion',
      value: dashboardValue.completion,
      icon: CheckCircle2,
      color: 'text-blue-600',
      bg: 'bg-blue-100',
    },
    {
      label: 'Online Today',
      value: <OnlineTimer initialSeconds={todayOnlineSeconds} />,
      icon: Clock,
      color: 'text-purple-600',
      bg: 'bg-purple-100',
      hidden: !isOnline,
    },
  ];


  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <DashboardHeader
          title="Courier Dashboard"
          description="Keep moving and keep earning. Track your deliveries in real-time."
        />

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
              {showConfirm ? (
                <motion.div
                  key="confirm"
                  initial={{ opacity: 0, scale: 0.85, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.85, y: 4 }}
                  className="absolute right-0 bottom-12 z-50 flex items-center gap-2 bg-rose-600 text-white text-xs font-bold rounded-2xl px-4 py-2.5 shadow-xl shadow-rose-600/30 whitespace-nowrap"
                >
                  <WifiOff className="h-3.5 w-3.5 shrink-0" />
                  <span>Go offline?</span>
                  <button
                    onClick={handleConfirmOffline}
                    className="ml-1 underline underline-offset-2 hover:no-underline"
                  >
                    Yes
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
              disabled={isPending}
              onClick={handleToggle}
              className={`relative flex items-center gap-2 px-5 py-2.5 rounded-full font-black text-sm shadow-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed
                                ${
                                  isOnline
                                    ? 'bg-rose-500 text-white shadow-rose-500/30 hover:bg-rose-600'
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
              {isPending
                ? 'Please wait...'
                : isOnline
                  ? 'Go Offline'
                  : 'Go Online'}
            </motion.button>
          </div>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="p-4 rounded-2xl border bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg ${stat.bg} ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                {stat.label}
              </span>
            </div>
            <h2 className="text-xl font-extrabold">{stat.value}</h2>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Active Delivery Section */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold tracking-tight">
              Active Delivery
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs font-bold text-blue-600 hover:text-blue-700"
            >
              View Map
            </Button>
          </div>

          <AnimatePresence mode="wait">
            {isOnline && currentPickUp ? (
              <motion.div
                key="active-order"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="group relative overflow-hidden rounded-[2.5rem] border bg-gradient-to-br from-blue-600/5 to-transparent p-8 shadow-xl border-blue-100/50"
              >
                <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Bike className="h-32 w-32 -rotate-12" />
                </div>

                <div className="relative z-10 space-y-8">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-full bg-blue-600 text-white text-[10px] font-black uppercase tracking-tighter">
                          Current Order
                        </span>
                        <span className="text-sm font-bold text-blue-600">
                          #{currentPickUp.id.slice(-6).toUpperCase()}
                        </span>
                      </div>
                      <h4 className="text-3xl font-black">
                        {currentPickUp.name_customer}
                      </h4>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                        Delivery Fee
                      </p>
                      <p className="text-2xl font-black text-emerald-600">
                        {currentPickUp.amount}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className="h-6 w-6 rounded-full bg-blue-600 flex items-center justify-center">
                          <MapPin className="h-3 w-3 text-white" />
                        </div>
                        <div className="w-0.5 h-12 bg-gradient-to-b from-blue-600 to-emerald-600" />
                        <div className="h-6 w-6 rounded-full bg-emerald-600 flex items-center justify-center">
                          <Navigation className="h-3 w-3 text-white" />
                        </div>
                      </div>
                      <div className="flex flex-col justify-between py-0.5">
                        <div className="space-y-0.5">
                          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                            Pickup
                          </p>
                          <p className="text-sm font-bold line-clamp-1">
                            {currentPickUp.pickup}
                          </p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                            Delivery To
                          </p>
                          <p className="text-sm font-bold line-clamp-1">
                            {currentPickUp.dropoff}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col justify-end gap-3">
                      <div className="flex gap-2">
                        <Button className="flex-1 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20">
                          Arrived at Pickup
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="rounded-xl aspect-square h-12"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="rounded-xl aspect-square h-12"
                        >
                          <Phone className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 rounded-xl font-bold border-rose-200 text-rose-600 hover:bg-rose-50"
                        >
                          Cancel
                        </Button>
                      </div>
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
                className="relative overflow-hidden rounded-[2.5rem] border border-blue-100 bg-gradient-to-br from-blue-600/5 to-indigo-600/5 p-12 flex flex-col items-center justify-center text-center space-y-6"
              >
                <motion.div
                  animate={{ scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="p-5 rounded-full bg-blue-100"
                >
                  <Bike className="h-12 w-12 text-blue-600" />
                </motion.div>
                <div className="space-y-1">
                  <h4 className="text-xl font-bold">No active delivery</h4>
                  <p className="text-sm text-muted-foreground">
                    Head to the lobby to pick up waiting orders.
                  </p>
                </div>
                <a href="/dashboard/lobby">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    whileHover={{ scale: 1.04 }}
                    className="flex items-center gap-2 px-8 py-3 rounded-full font-black text-sm bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors"
                  >
                    <Navigation className="h-4 w-4" />
                    Go to Lobby
                  </motion.button>
                </a>
              </motion.div>
            ) : (
              <motion.div
                key="offline"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="rounded-[2.5rem] border border-dashed border-muted p-20 flex flex-col items-center justify-center text-center space-y-4"
              >
                <motion.div
                  animate={{ scale: [1, 1.08, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{
                    duration: 2.5,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="p-4 rounded-full bg-muted/50"
                >
                  <Power className="h-12 w-12 text-muted-foreground" />
                </motion.div>
                <div className="space-y-1">
                  <h4 className="text-xl font-bold">
                    You are currently offline
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Go online to start receiving delivery requests.
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
                  Go Online Now
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Delivery History */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold tracking-tight">
                Recent Deliveries
              </h3>
              <a href="/dashboard/activeorder">
                <Button variant="link" className="text-xs font-bold">
                  See All History
                </Button>
              </a>
            </div>
            <div className="space-y-3">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No deliveries yet.
                </p>
              ) : (
                history.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-center justify-between p-4 rounded-2xl border bg-card/50 hover:bg-card transition-all"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${statusBg(item.status)}`}>
                        {statusIcon(item.status)}
                      </div>
                      <div>
                        <p className="text-sm font-bold">{item.dropoff ?? item.outletName}</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                          {item.status} • {item.timestamp ? relativeTime(item.timestamp) : '—'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
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
        <div className="space-y-6">
          {/* Performance Card */}
          <div className="rounded-[2rem] border bg-gradient-to-br from-purple-600 to-indigo-700 p-6 text-white shadow-xl shadow-indigo-600/20">
            <div className="flex items-center justify-between mb-8">
              <h4 className="font-black uppercase tracking-widest text-xs opacity-80">
                This Week
              </h4>
              <TrendingUp className="h-4 w-4 opacity-80" />
            </div>
            <div className="space-y-2 mb-8">
              <p className="text-xs font-bold opacity-60">Total Earnings</p>
              <h2 className="text-4xl font-black">Rp 2.450.000</h2>
              <p className="text-[10px] font-bold bg-white/20 w-fit px-2 py-0.5 rounded-full">
                +18.5% from last week
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-6">
              <div>
                <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest mb-1">
                  Orders
                </p>
                <p className="text-xl font-black">42</p>
              </div>
              <div>
                <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest mb-1">
                  Incentives
                </p>
                <p className="text-xl font-black">Rp 120k</p>
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="rounded-2xl border bg-card/50 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black uppercase tracking-widest">
                Notifications
              </h4>
              <Bell className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="h-2 w-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold">Bonus period active!</p>
                  <p className="text-[10px] text-muted-foreground">
                    Get extra 2k for every delivery between 5-7 PM.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="h-2 w-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold">Rating updated</p>
                  <p className="text-[10px] text-muted-foreground">
                    Your performance rating increased to 4.9. Good job!
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Support */}
          <Button
            variant="outline"
            className="w-full rounded-2xl py-8 border-dashed flex flex-col gap-1 hover:border-blue-500 hover:bg-blue-50 transition-all"
          >
            <span className="text-xs font-black uppercase tracking-widest">
              Need Help?
            </span>
            <span className="text-[10px] text-muted-foreground">
              Contact support agent
            </span>
          </Button>
        </div>
      </div>
    </main>
  );
};
