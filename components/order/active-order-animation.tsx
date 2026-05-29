'use client';

import { motion, AnimatePresence } from 'motion/react';
import { cancelOrderbyCustomer } from '@/app/dashboard/activeorder/actions';
import { useTransition, useState, useEffect, useCallback } from 'react';
import QRCode from 'react-qr-code';
import { QrCode, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'on_delivery'
  | 'delivered';

const STATUS_CONFIG: Record<
  OrderStatus,
  {
    label: string;
    sublabel: string;
    color: string;
    bg: string;
    ring: string;
    emoji: string;
  }
> = {
  pending: {
    label: 'Menunggu Konfirmasi',
    sublabel: 'Pesanan kamu sedang menunggu dikonfirmasi oleh outlet.',
    color: 'text-amber-600',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    ring: 'bg-amber-400',
    emoji: '⏳',
  },
  confirmed: {
    label: 'Mencari Kurir',
    sublabel: 'Outlet sudah konfirmasi! Sedang mencari kurir terdekat.',
    color: 'text-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    ring: 'bg-blue-400',
    emoji: '🔍',
  },
  preparing: {
    label: 'Sedang Dipersiapkan',
    sublabel: 'Kurir ditemukan! Outlet sedang menyiapkan pesananmu.',
    color: 'text-orange-600',
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    ring: 'bg-orange-400',
    emoji: '👨‍🍳',
  },
  ready: {
    label: 'Pesanan Siap',
    sublabel: 'Pesananmu sudah siap dan menunggu dijemput kurir.',
    color: 'text-green-600',
    bg: 'bg-green-50 dark:bg-green-950/30',
    ring: 'bg-green-400',
    emoji: '✅',
  },
  on_delivery: {
    label: 'Dalam Perjalanan',
    sublabel: 'Kurir sedang dalam perjalanan menuju lokasimu. Tunggu sebentar!',
    color: 'text-cyan-600',
    bg: 'bg-cyan-50 dark:bg-cyan-950/30',
    ring: 'bg-cyan-400',
    emoji: '🛵',
  },
  delivered: {
    label: 'Pesanan Tiba!',
    sublabel: 'Pesananmu sudah tiba. Selamat menikmati! 🎉',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    ring: 'bg-emerald-400',
    emoji: '🎊',
  },
};

/* ── individual animations ──────────────────────────────────── */

function PendingAnimation() {
  return (
    <div className="relative flex items-center justify-center w-32 h-32">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute rounded-full border-2 border-amber-400/60"
          style={{ width: 48 + i * 28, height: 48 + i * 28 }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.7, 0.2, 0.7] }}
          transition={{
            duration: 2,
            delay: i * 0.4,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
      <motion.span
        className="text-4xl select-none z-10"
        animate={{ rotate: [0, 10, -10, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        ⏳
      </motion.span>
    </div>
  );
}

function ConfirmedAnimation() {
  return (
    <div className="relative flex items-center justify-center w-32 h-32">
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="absolute rounded-full border border-blue-400"
          style={{ width: 24 + i * 26, height: 24 + i * 26 }}
          animate={{ scale: [0.8, 1.3, 0.8], opacity: [0, 0.6, 0] }}
          transition={{
            duration: 2.5,
            delay: i * 0.5,
            repeat: Infinity,
            ease: 'easeOut',
          }}
        />
      ))}
      <motion.span
        className="text-4xl select-none z-10"
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        🔍
      </motion.span>
    </div>
  );
}

function PreparingAnimation() {
  return (
    <div className="flex flex-col items-center gap-3">
      <motion.span
        className="text-5xl select-none"
        animate={{ y: [0, -8, 0], rotate: [0, -5, 5, 0] }}
        transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
      >
        👨‍🍳
      </motion.span>
      <div className="flex items-end gap-1.5 h-6">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-2 rounded-full bg-orange-400"
            animate={{ height: ['6px', '22px', '6px'] }}
            transition={{
              duration: 0.8,
              delay: i * 0.2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            style={{ display: 'inline-block' }}
          />
        ))}
      </div>
    </div>
  );
}

function ReadyAnimation() {
  return (
    <div className="relative flex items-center justify-center w-32 h-32">
      <motion.div
        className="absolute inset-0 rounded-full bg-green-100 dark:bg-green-900/40"
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        className="text-5xl select-none z-10"
        initial={{ scale: 0 }}
        animate={{ scale: [0.8, 1.15, 1] }}
        transition={{ duration: 0.6, ease: 'backOut' }}
      >
        ✅
      </motion.span>
      {[...Array(5)].map((_, i) => (
        <motion.span
          key={i}
          className="absolute w-2 h-2 rounded-full bg-green-400"
          animate={{
            x: [0, Math.cos((i / 5) * Math.PI * 2) * 44],
            y: [0, Math.sin((i / 5) * Math.PI * 2) * 44],
            opacity: [1, 0],
            scale: [1, 0],
          }}
          transition={{
            duration: 1,
            delay: i * 0.1,
            repeat: Infinity,
            repeatDelay: 1.5,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
}

function OnDeliveryAnimation() {
  return (
    <div className="flex flex-col items-center gap-3 overflow-hidden w-48">
      <motion.span
        className="text-5xl select-none"
        animate={{ x: [-60, 60], scaleX: [1, 1] }}
        transition={{
          duration: 1.8,
          repeat: Infinity,
          repeatType: 'reverse',
          ease: 'easeInOut',
        }}
      >
        🛵
      </motion.span>
      <div className="flex gap-1 w-full justify-center">
        {[...Array(6)].map((_, i) => (
          <motion.span
            key={i}
            className="h-0.5 flex-1 rounded-full bg-cyan-300 dark:bg-cyan-700"
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 0.6, delay: i * 0.1, repeat: Infinity }}
          />
        ))}
      </div>
    </div>
  );
}

function DeliveredAnimation() {
  const particles = [...Array(12)];
  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      {particles.map((_, i) => (
        <motion.span
          key={i}
          className={`absolute w-2 h-2 rounded-full ${['bg-emerald-400', 'bg-yellow-400', 'bg-pink-400', 'bg-blue-400'][i % 4]}`}
          animate={{
            x: [0, Math.cos((i / 12) * Math.PI * 2) * 52],
            y: [0, Math.sin((i / 12) * Math.PI * 2) * 52],
            opacity: [1, 0],
            scale: [1.5, 0],
          }}
          transition={{
            duration: 1.2,
            delay: i * 0.05,
            repeat: Infinity,
            repeatDelay: 1.2,
            ease: 'easeOut',
          }}
        />
      ))}
      <motion.span
        className="text-5xl select-none z-10"
        animate={{ scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        🎊
      </motion.span>
    </div>
  );
}

const ANIMATION_MAP: Record<OrderStatus, React.ReactNode> = {
  pending: <PendingAnimation />,
  confirmed: <ConfirmedAnimation />,
  preparing: <PreparingAnimation />,
  ready: <ReadyAnimation />,
  on_delivery: <OnDeliveryAnimation />,
  delivered: <DeliveredAnimation />,
};

const STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'pending', label: 'Konfirmasi' },
  { key: 'confirmed', label: 'Cari Kurir' },
  { key: 'preparing', label: 'Persiapan' },
  { key: 'ready', label: 'Siap' },
  { key: 'on_delivery', label: 'Perjalanan' },
  { key: 'delivered', label: 'Selesai' },
];

function ProgressStepper({ current }: { current: OrderStatus }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="flex items-center justify-between relative">
        <div className="absolute top-3 left-0 right-0 h-0.5 bg-muted z-0" />
        <motion.div
          className="absolute top-3 left-0 h-0.5 bg-emerald-500 z-0 origin-left"
          animate={{ width: `${(currentIdx / (STEPS.length - 1)) * 100}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
        {STEPS.map((step, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <div
              key={step.key}
              className="relative z-10 flex flex-col items-center gap-1"
            >
              <motion.div
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-colors ${
                  done
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : active
                      ? 'bg-background border-emerald-500 text-emerald-600'
                      : 'bg-background border-muted-foreground/30 text-muted-foreground/40'
                }`}
                animate={active ? { scale: [1, 1.2, 1] } : {}}
                transition={{ duration: 1.2, repeat: Infinity }}
              >
                {done ? '✓' : idx + 1}
              </motion.div>
              <span
                className={`text-[9px] font-medium whitespace-nowrap ${active ? 'text-foreground' : 'text-muted-foreground/50'}`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

//SEARCH:: customer qr code
function CustomerQrModal({
  orderId,
  onClose,
}: {
  orderId: string;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.85, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="relative bg-white rounded-3xl p-8 shadow-2xl flex flex-col items-center gap-5 mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>
          <div className="text-center">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
              Tunjukkan ke Kurir
            </p>
            <p className="text-lg font-black text-gray-900">
              QR Konfirmasi Pengiriman
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-white border-2 border-gray-100 shadow-inner">
            <QRCode value={orderId} size={200} />
          </div>
          <p className="text-[10px] text-gray-400 font-mono break-all text-center max-w-[240px]">
            {orderId}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function ActiveOrderAnimation({
  orderId,
  status,
  orderRef,
  outletName,
}: {
  orderId: string;
  status: OrderStatus;
  orderRef: string;
  outletName: string;
}) {
  const router = useRouter();
  const [liveStatus, setLiveStatus] = useState<OrderStatus>(status);
  const cfg = STATUS_CONFIG[liveStatus];
  const [pending, startTransition] = useTransition();
  const [qrOpen, setQrOpen] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/get-active-order', { cache: 'no-store' });
      const data = await res.json();
      if (!data.success) return;
      const next = data.order.status as OrderStatus;
      if (next !== liveStatus) setLiveStatus(next);
      if (next === 'delivered')
        router.push(`/dashboard/ratings/submit/customer/${data.order.id}`);
    } catch {
      /* silently retry */
    }
  }, [liveStatus, router]);

  useEffect(() => {
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [poll]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 py-12 gap-8">
      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className={`w-full max-w-sm rounded-3xl border border-border/60 shadow-lg p-8 flex flex-col items-center gap-6 ${cfg.bg}`}
      >
        {/* Animation */}
        <div className="flex items-center justify-center h-36">
          {ANIMATION_MAP[liveStatus]}
        </div>

        {/* Labels */}
        <div className="text-center space-y-1.5">
          <motion.p
            key={liveStatus}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`text-xl font-black ${cfg.color}`}
          >
            {cfg.label}
          </motion.p>
          <p className="text-sm text-muted-foreground leading-snug">
            {cfg.sublabel}
          </p>
        </div>

        {/* Order meta */}
        <div className="w-full rounded-xl bg-background/60 border border-border/40 px-4 py-3 space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span className="font-semibold">Order</span>
            <span className="font-mono font-bold text-foreground">
              #{orderRef}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">Outlet</span>
            <span className="font-bold text-foreground truncate max-w-[140px] text-right">
              {outletName}
            </span>
          </div>
        </div>

        {/* Cancel button — only on pending/confirmed */}
        {(liveStatus === 'pending' || liveStatus === 'confirmed') && (
          <motion.form
            action={() => startTransition(() => cancelOrderbyCustomer(orderId))}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="w-full"
          >
            <button
              type="submit"
              disabled={pending}
              className="w-full py-2.5 rounded-xl border border-red-300 text-red-600 text-sm font-bold hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pending ? 'Membatalkan...' : 'Batalkan Pesanan'}
            </button>
          </motion.form>
        )}

        {/* QR button — shown when courier is on the way */}
        {liveStatus === 'on_delivery' && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            onClick={() => setQrOpen(true)}
            className="w-full py-2.5 rounded-xl bg-cyan-500 text-white text-sm font-bold hover:bg-cyan-600 transition-colors flex items-center justify-center gap-2"
          >
            <QrCode className="h-4 w-4" />
            Tampilkan QR Konfirmasi
          </motion.button>
        )}
      </motion.div>

      {/* Stepper */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="w-full max-w-sm"
      >
        <ProgressStepper current={liveStatus} />
      </motion.div>

      {qrOpen && (
        <CustomerQrModal orderId={orderId} onClose={() => setQrOpen(false)} />
      )}
    </div>
  );
}
