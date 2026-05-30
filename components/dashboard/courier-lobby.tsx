'use client';

import { useEffect, useState, useCallback, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShoppingBag,
  Clock,
  User,
  Package,
  ChevronRight,
  QrCode,
  X,
  Bike,
  ScanLine,
  Camera,
  CameraOff,
  ExternalLink,
} from 'lucide-react';
import QRCode from 'react-qr-code';
import { acceptOrder } from '@/app/dashboard/lobby/actions';
import { markOrderDelivered } from '@/app/dashboard/activeorder/actions';

type OrderItem = {
  productName: string;
  quantity: number;
  noteProduct: string | null;
  summaryPrice: string;
};

type Order = {
  orderId: string;
  customerName: string;
  customerPhone: string | null;
  deliveryFee: string | null;
  note: {
    customer_note: string;
    customer_ratings: string;
    customer_review_count: number;
    location?: {
      pick_up: { lat: string; long: string; label: string };
      drop_off: { lat: string; long: string; label: string };
    };
  } | null;
  createdAt: string;
  status?: string;
  outletName: string;
  outletAddress: string;
  items: OrderItem[];
  totalAmount: number;
};

type Tab = 'available' | 'mine';

function fmtIDR(amount: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}d lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m lalu`;
  return `${Math.floor(m / 60)}j lalu`;
}

function noteStr(note: unknown): string | null {
  if (note == null) return null;
  const s = typeof note === 'string' ? note : JSON.stringify(note);
  if (s === '{}' || s === 'null' || s === '') return null;
  return s;
}

function LocationSection({ order }: { order: Order }) {
  const pickup = order.note?.location?.pick_up;
  const dropoff = order.note?.location?.drop_off;

  const pickupUrl = pickup?.lat
    ? `https://www.google.com/maps/dir/?api=1&destination=${pickup.lat},${pickup.long}&travelmode=driving`
    : null;
  const dropoffUrl = dropoff?.lat
    ? `https://www.google.com/maps/dir/?api=1&destination=${dropoff.lat},${dropoff.long}&travelmode=driving`
    : null;

  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center pt-0.5">
          <div className="h-2.5 w-2.5 rounded-full bg-blue-500 shrink-0" />
          <div className="w-px flex-1 my-1 bg-gradient-to-b from-blue-400 to-emerald-400 min-h-[20px]" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
        </div>
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5 min-w-0">
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                Pickup
              </p>
              <p className="text-xs font-semibold truncate">
                {order.outletName}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {order.outletAddress}
              </p>
            </div>
            {pickupUrl && (
              <a
                href={pickupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Maps
              </a>
            )}
          </div>
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5 min-w-0">
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                Dropoff
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {dropoff?.label ?? '—'}
              </p>
            </div>
            {dropoffUrl && (
              <a
                href={dropoffUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Maps
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemList({ items }: { items: OrderItem[] }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-widest">
        <Package className="h-3 w-3" />
        <span>{items.length} Item</span>
      </div>
      <div className="rounded-xl bg-muted/30 divide-y divide-border/50">
        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-start justify-between px-3 py-2 text-sm"
          >
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-bold text-foreground/60 tabular-nums w-5 text-right shrink-0">
                {item.quantity}×
              </span>
              <div className="min-w-0">
                <span className="font-medium truncate block">
                  {item.productName}
                </span>
                {item.noteProduct && (
                  <p className="text-xs text-muted-foreground mt-0.5 italic">
                    {item.noteProduct}
                  </p>
                )}
              </div>
            </div>
            <span className="text-xs font-semibold tabular-nums text-muted-foreground shrink-0 ml-3">
              {fmtIDR(parseInt(item.summaryPrice || '0'))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QrModal({ value, onClose }: { value: string; onClose: () => void }) {
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
              Tunjukkan QR ini ke Outlet untuk Verifikasi
            </p>
            <p className="text-lg font-black text-gray-900">QR Pengambilan</p>
          </div>

          <div className="p-4 rounded-2xl bg-white border-2 border-gray-100 shadow-inner">
            <QRCode value={value} size={200} />
          </div>

          <p className="text-[10px] text-gray-400 font-mono break-all text-center max-w-[240px]">
            {value}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function AvailableOrderCard({
  order,
  index,
  onAccept,
}: {
  order: Order;
  index: number;
  onAccept: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const note = noteStr(order.note?.customer_note ?? '');
  const rating = noteStr(order.note?.customer_ratings ?? '');
  const review_count = noteStr(String(order.note?.customer_review_count ?? ''));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, y: -10 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="rounded-2xl border bg-background shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-3 bg-violet-50 dark:bg-violet-950/20 border-b border-violet-100 dark:border-violet-900/30">
        <div className="flex items-center gap-2">
          <span className="font-mono font-black text-sm text-violet-700 dark:text-violet-400">
            #{order.orderId.slice(-8).toUpperCase()}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 text-[10px] font-bold uppercase tracking-wider">
            Tersedia
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{timeAgo(order.createdAt)}</span>
        </div>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-semibold">{order.customerName}</span>
          {order.customerPhone && (
            <span className="text-muted-foreground text-xs">
              · {order.customerPhone}
            </span>
          )}
          {rating && (
            <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-3 leading-relaxed">
              {`Rating pelanggan ${rating}⭐ dari ${review_count} ulasan`}
            </p>
          )}
        </div>

        <LocationSection order={order} />

        <ItemList items={order.items} />

        {note && (
          <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-3 leading-relaxed">
            {note}
          </p>
        )}

        <div className="flex items-end justify-between mt-auto pt-4 border-t border-border/50">
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-black tabular-nums">
              {fmtIDR(order.totalAmount)}
            </p>
            {order.deliveryFee && parseInt(order.deliveryFee) > 0 && (
              <p className="text-xs text-muted-foreground">
                +{fmtIDR(parseInt(order.deliveryFee))} ongkir
              </p>
            )}
          </div>
          <button
            disabled={isPending}
            onClick={() => startTransition(() => onAccept(order.orderId))}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-violet-500 text-white hover:bg-violet-600 transition-colors shadow-sm shadow-violet-200 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending ? 'Memproses...' : 'Ambil Order'}
            {!isPending && <ChevronRight className="h-3 w-3" />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

const MY_STATUS_MAP: Record<
  string,
  {
    label: string;
    headerBg: string;
    headerBorder: string;
    textColor: string;
    badgeBg: string;
  }
> = {
  preparing: {
    label: 'Diproses',
    headerBg: 'bg-blue-50 dark:bg-blue-950/20',
    headerBorder: 'border-blue-100 dark:border-blue-900/30',
    textColor: 'text-blue-700 dark:text-blue-400',
    badgeBg: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400',
  },
  ready: {
    label: 'Siap Ambil',
    headerBg: 'bg-emerald-50 dark:bg-emerald-950/20',
    headerBorder: 'border-emerald-100 dark:border-emerald-900/30',
    textColor: 'text-emerald-700 dark:text-emerald-400',
    badgeBg:
      'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400',
  },
  on_delivery: {
    label: 'Diantar',
    headerBg: 'bg-orange-50 dark:bg-orange-950/20',
    headerBorder: 'border-orange-100 dark:border-orange-900/30',
    textColor: 'text-orange-700 dark:text-orange-400',
    badgeBg:
      'bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400',
  },
  confirmed: {
    label: 'Dikonfirmasi',
    headerBg: 'bg-amber-50 dark:bg-amber-950/20',
    headerBorder: 'border-amber-100 dark:border-amber-900/30',
    textColor: 'text-amber-700 dark:text-amber-400',
    badgeBg:
      'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400',
  },
};

function MyOrderCard({
  order,
  index,
  courierId,
}: {
  order: Order;
  index: number;
  courierId: number;
}) {
  const [qrOpen, setQrOpen] = useState(false);
  const note = noteStr(order.note?.customer_note ?? '');
  const rating = noteStr(order.note?.customer_ratings ?? '');
  const review_count = noteStr(String(order.note?.customer_review_count ?? ''));
  const s = MY_STATUS_MAP[order.status ?? ''] ?? MY_STATUS_MAP.confirmed;

  //SEARCH:: qr code generated value
  const qrValue = `COURIER:${courierId}|ORDER:${order.orderId}`;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.3, delay: index * 0.05 }}
        className="rounded-2xl border bg-background shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
      >
        <div
          className={`flex items-center justify-between px-5 py-3 ${s.headerBg} border-b ${s.headerBorder}`}
        >
          <div className="flex items-center gap-2">
            <span className={`font-mono font-black text-sm ${s.textColor}`}>
              #{order.orderId.slice(-8).toUpperCase()}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${s.badgeBg}`}
            >
              {s.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{timeAgo(order.createdAt)}</span>
            </div>
            <button
              onClick={() => setQrOpen(true)}
              title="Generate QR Pengambilan"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-gray-900 text-white hover:bg-gray-700 transition-colors"
            >
              <QrCode className="h-3 w-3" />
              QR
            </button>
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-semibold">{order.customerName}</span>
            {order.customerPhone && (
              <span className="text-muted-foreground text-xs">
                · {order.customerPhone}
              </span>
            )}
            {rating && (
              <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-3 leading-relaxed">
                {`Rating pelanggan ${rating}⭐ dari ${review_count} ulasan`}
              </p>
            )}
          </div>

          <LocationSection order={order} />

          <ItemList items={order.items} />

          {note && (
            <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-3 leading-relaxed">
              {note}
            </p>
          )}

          <div className="mt-auto pt-4 border-t border-border/50">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-black tabular-nums">
              {fmtIDR(order.totalAmount)}
            </p>
            {order.deliveryFee && parseInt(order.deliveryFee) > 0 && (
              <p className="text-xs text-muted-foreground">
                +{fmtIDR(parseInt(order.deliveryFee))} ongkir
              </p>
            )}
          </div>
        </div>
      </motion.div>

      {qrOpen && <QrModal value={qrValue} onClose={() => setQrOpen(false)} />}
    </>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const config = {
    available: {
      icon: <Bike className="h-8 w-8 text-violet-400" />,
      bg: 'bg-violet-50 dark:bg-violet-950/30',
      ring: 'border-violet-300/50',
      title: 'Tidak Ada Order Tersedia',
      desc: 'Belum ada pesanan yang menunggu kurir.',
    },
    mine: {
      icon: <ShoppingBag className="h-8 w-8 text-blue-400" />,
      bg: 'bg-blue-50 dark:bg-blue-950/30',
      ring: 'border-blue-300/50',
      title: 'Belum Ada Pesanan Aktif',
      desc: 'Ambil order untuk mulai mengantarkan.',
    },
  }[tab];

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6 text-muted-foreground">
      <div className="relative flex items-center justify-center w-28 h-28">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className={`absolute rounded-full border ${config.ring}`}
            style={{ width: 36 + i * 26, height: 36 + i * 26 }}
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.15, 0.5] }}
            transition={{
              duration: 2.5,
              delay: i * 0.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ))}
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className={`z-10 rounded-full p-5 ${config.bg}`}
        >
          {config.icon}
        </motion.div>
      </div>
      <div className="text-center space-y-1">
        <p className="font-bold text-foreground text-lg">{config.title}</p>
        <p className="text-sm">{config.desc}</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Halaman diperbarui otomatis setiap 2 detik.
        </p>
      </div>
    </div>
  );
}

//SEARCH:: courier scan qustomer qr code for the order
function DeliveryScannerBar({
  orders,
  onDelivered,
}: {
  orders: Order[];
  onDelivered: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const resolve = async (raw: string): Promise<boolean> => {
    const trimmed = raw.trim();
    const match = orders.find(
      (o) =>
        o.orderId === trimmed ||
        o.orderId.slice(-8).toUpperCase() === trimmed.toUpperCase(),
    );
    if (!match) {
      setError('Order tidak ditemukan atau bukan milikmu.');
      return false;
    }
    setError(null);
    setInput('');
    setSuccess(
      `#${match.orderId.slice(-8).toUpperCase()} dikonfirmasi terkirim!`,
    );
    await onDelivered(match.orderId);
    router.push(`/dashboard/ratings/submit/courier/${match.orderId}`);
    return true;
  };

  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  const releaseTracks = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    releaseTracks();
    setScanning(false);
  }, [releaseTracks]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(t);
  }, [success]);

  useEffect(() => {
    if (!scanning) return;
    setError(null);
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          /* autoPlay handles it */
        }

        if (!('BarcodeDetector' in window)) {
          if (!cancelled)
            setError(
              'Browser ini tidak mendukung kamera QR scan. Gunakan input manual.',
            );
          releaseTracks();
          setScanning(false);
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({
          formats: ['qr_code'],
        });

        const tick = async () => {
          if (cancelled) return;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const codes: any[] = await detector.detect(video);
            if (codes.length > 0) {
              const found = await resolveRef.current(codes[0].rawValue);
              if (found) {
                stopCamera();
                return;
              }
            }
          } catch {
            /* ignore frame errors */
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) {
          const name = err instanceof Error ? err.name : '';
          if (name === 'NotAllowedError') setError('Izin kamera ditolak.');
          else if (name === 'NotFoundError')
            setError('Kamera tidak ditemukan.');
          else setError('Tidak dapat mengakses kamera.');
          setScanning(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      releaseTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const handleSubmit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!input.trim()) return;
    resolve(input);
  };

  const onDeliveryOrders = orders.filter((o) => o.status === 'on_delivery');
  if (onDeliveryOrders.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border bg-background shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 bg-cyan-50 dark:bg-cyan-950/20 border-b border-cyan-100 dark:border-cyan-900/30">
        <ScanLine className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
        <span className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
          Konfirmasi Pengiriman
        </span>
        <span className="text-xs text-muted-foreground ml-1">
          — scan QR pelanggan
        </span>
      </div>
      <div className="px-5 py-4 space-y-3">
        {scanning && (
          <div className="relative w-full h-48 rounded-xl overflow-hidden bg-black">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              muted
              playsInline
              autoPlay
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.div
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="w-40 h-40 border-2 border-white/80 rounded-xl"
              />
            </div>
            <button
              onClick={stopCamera}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <CameraOff className="h-4 w-4" />
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            placeholder="Ketik Order ID atau 8 karakter terakhir…"
            className="flex-1 px-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-2 focus:ring-cyan-400/50 focus:border-cyan-400 transition-all"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-cyan-500 text-white hover:bg-cyan-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Konfirmasi
          </button>
          <button
            type="button"
            onClick={() => setScanning((v) => !v)}
            className={`px-3 py-2 rounded-lg border text-sm font-bold transition-colors ${
              scanning
                ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 dark:bg-red-950/20 dark:border-red-900/30'
                : 'bg-muted/30 border-border hover:bg-muted/60 text-foreground'
            }`}
          >
            {scanning ? (
              <CameraOff className="h-4 w-4" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
          </button>
        </form>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs text-red-500 font-medium"
          >
            {error}
          </motion.p>
        )}
        {success && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs text-cyan-600 font-medium"
          >
            {success}
          </motion.p>
        )}
      </div>
    </div>
  );
}

function useOrdersPolling(endpoint: string) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders);
        setLastUpdated(new Date());
      }
    } catch {
      // silently retry
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 2000);
    return () => clearInterval(id);
  }, [fetch_]);

  return { orders, setOrders, loading, lastUpdated };
}

export function CourierLobby({ courierId }: { courierId: number }) {
  const [activeTab, setActiveTab] = useState<Tab>('available');

  const available = useOrdersPolling('/api/get-available-orders');
  const mine = useOrdersPolling('/api/get-courier-orders');

  const handleAccept = useCallback(
    async (orderId: string) => {
      available.setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
      await acceptOrder(orderId);
    },
    [available],
  );

  const handleDelivered = useCallback(
    async (orderId: string) => {
      //DONE:: db catch the delivered state and insert into CashInDetailTables

      mine.setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
      await markOrderDelivered(orderId);
    },
    [mine],
  );

  const current = activeTab === 'available' ? available : mine;

  const tabs = [
    {
      id: 'available' as Tab,
      label: 'Tersedia',
      count: available.orders.length,
      badgeColor: 'bg-violet-500',
    },
    {
      id: 'mine' as Tab,
      label: 'Pesanan Saya',
      count: mine.orders.length,
      badgeColor: 'bg-blue-500',
    },
  ];

  return (
    <div>
      <div className="flex items-start justify-between mb-6 py-4 border-b">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-2xl font-black tracking-tight">Lobby Kurir</h1>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                Live
              </span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {available.orders.length > 0
              ? `${available.orders.length} pesanan menunggu kurir`
              : 'Belum ada pesanan yang tersedia'}
          </p>
        </div>
        {current.lastUpdated && (
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">
              {current.lastUpdated.toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </p>
            <p className="text-[10px] text-muted-foreground/50">
              refresh / 2 detik
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-muted/50 w-fit mb-6">
        {tabs.map(({ id, label, count, badgeColor }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
              {count > 0 && (
                <motion.span
                  key={count}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className={`flex items-center justify-center h-5 min-w-5 px-1 rounded-full text-[10px] font-black text-white ${badgeColor}`}
                >
                  {count}
                </motion.span>
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {current.loading ? (
            <div className="flex items-center justify-center py-32">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="h-6 w-6 rounded-full border-2 border-violet-400 border-t-transparent"
              />
            </div>
          ) : current.orders.length === 0 ? (
            <EmptyState tab={activeTab} />
          ) : (
            <>
              {activeTab === 'mine' && (
                <DeliveryScannerBar
                  orders={mine.orders}
                  onDelivered={handleDelivered}
                />
              )}
              <AnimatePresence mode="popLayout">
                {activeTab === 'available' ? (
                  <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    {available.orders.map((order, i) => (
                      <AvailableOrderCard
                        key={order.orderId}
                        order={order}
                        index={i}
                        onAccept={handleAccept}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {mine.orders.map((order, i) => (
                      <MyOrderCard
                        key={order.orderId}
                        order={order}
                        index={i}
                        courierId={courierId}
                      />
                    ))}
                  </div>
                )}
              </AnimatePresence>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
