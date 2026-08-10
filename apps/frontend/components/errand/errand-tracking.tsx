'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion } from 'motion/react';
import {
  Loader2,
  MapPin,
  MessageCircle,
  Star,
  UserRound,
  X,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { resolveUploadImage } from '@/lib/image-src';
import { fmtIDR } from '@/lib/utils/format';
import { DeliveryTrackingMapClient } from '@/components/order/delivery-tracking-map-client';

type Errand = {
  id: string;
  status: 'pending' | 'on_delivery';
  note: string | null;
  price: string | null;
  /**
   * Where the courier is headed. The server still spells these pickup* on the
   * wire for the installed courier app; the columns are destination_*.
   */
  pickupAddress: string | null;
  pickupLat: string | null;
  pickupLon: string | null;
  courierName: string;
  courierPhone: string | null;
  courierAvatar: string | null;
  courierPlate: string | null;
  courierRating: string | null;
  courierLat: string | null;
  courierLon: string | null;
  cancellableInSeconds: number;
  canCancel: boolean;
};

const POLL_MS = 4000;

export function ErrandTracking({ initial }: { initial: Errand }) {
  const router = useRouter();
  const [errand, setErrand] = useState<Errand>(initial);
  const [cancelling, setCancelling] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticks locally between polls so the countdown moves every second instead of
  // jumping in four-second steps.
  const [secondsLeft, setSecondsLeft] = useState(initial.cancellableInSeconds);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/errands/active`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) return;
      if (!data.errand) {
        // Finished, rejected or cancelled while this screen was open. The
        // server decides what comes next; a refresh re-runs its guards rather
        // than this component guessing which of the three happened.
        router.refresh();
        return;
      }
      setErrand(data.errand);
      setSecondsLeft(data.errand.cancellableInSeconds);
    } catch {
      // Keep the last known state on a blip.
    }
  }, [router]);

  useEffect(() => {
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  async function cancel() {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/errands/${errand.id}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        router.push('/dashboard/order');
        return;
      }
      setError(data.error ?? 'Gagal membatalkan.');
      if (typeof data.secondsLeft === 'number') setSecondsLeft(data.secondsLeft);
    } catch {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setCancelling(false);
    }
  }

  async function rejectPrice() {
    setRejecting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/errands/${errand.id}/reject-price`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        // Straight back to the courier list: no cooldown follows a refused
        // price, so hiring someone else is available immediately.
        router.push('/dashboard/suruh-kurir');
        return;
      }
      setError(data.error ?? 'Gagal menolak harga.');
      void load();
    } catch {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setRejecting(false);
    }
  }

  const courierLat = errand.courierLat !== null ? Number(errand.courierLat) : null;
  const courierLon = errand.courierLon !== null ? Number(errand.courierLon) : null;
  const destLat = errand.pickupLat !== null ? Number(errand.pickupLat) : null;
  const destLon = errand.pickupLon !== null ? Number(errand.pickupLon) : null;
  // No outlet means no pickup marker — the map shows the courier and where the
  // customer is, and nothing else. A third point would be inventing a leg of
  // the trip nobody recorded.
  const canMap =
    courierLat !== null &&
    courierLon !== null &&
    destLat !== null &&
    destLon !== null &&
    Number.isFinite(courierLat) &&
    Number.isFinite(courierLon) &&
    Number.isFinite(destLat) &&
    Number.isFinite(destLon);

  const waiting = errand.status === 'pending';
  const waLink = errand.courierPhone
    ? `https://wa.me/${errand.courierPhone}`
    : null;

  return (
    <div className="mx-auto max-w-2xl pt-4">
      <div className="mb-4 flex items-center gap-3">
        <motion.div
          animate={waiting ? { scale: [1, 1.12, 1] } : { scale: 1 }}
          transition={{ repeat: waiting ? Infinity : 0, duration: 1.6 }}
          className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl ${
            waiting ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-emerald-50 dark:bg-emerald-950/30'
          }`}
        >
          {waiting ? '⏳' : '🛵'}
        </motion.div>
        <div>
          <h1 className="text-xl font-black">
            {waiting ? 'Menunggu Jawaban Kurir' : 'Kurir Dalam Perjalanan'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {waiting
              ? 'Kurir sedang memutuskan. Hubungi lewat WhatsApp buat menyepakati harga.'
              : 'Kurir sudah menerima dan sedang menuju lokasi pian.'}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
            {errand.courierAvatar ? (
              <Image
                src={resolveUploadImage(errand.courierAvatar)}
                alt={errand.courierName}
                fill
                // Same as every other uploaded image in this app: the optimizer
                // 400s on the backend's own /uploads origin.
                unoptimized
                sizes="48px"
                className="object-cover"
              />
            ) : (
              <UserRound className="m-3 h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{errand.courierName}</p>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {Number(errand.courierRating ?? 5).toFixed(1)}
              </span>
              {errand.courierPlate && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{errand.courierPlate}</span>
                </>
              )}
            </p>
          </div>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-600"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp
            </a>
          )}
        </div>

        {errand.price && (
          <div className="mt-3 rounded-xl bg-muted px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Harga dari kurir</span>
              <span className="font-black">{fmtIDR(Number(errand.price))}</span>
            </div>
            {/* A quote the customer never agreed to needs an answer other than
                the cancel button below, which waits out a timer meant for a
                courier who hasn't replied — this one has. */}
            <button
              type="button"
              onClick={rejectPrice}
              disabled={rejecting || cancelling}
              className="mt-2.5 w-full rounded-full border border-border bg-background px-4 py-2 text-xs font-bold transition-colors hover:bg-muted disabled:opacity-50"
            >
              {rejecting ? 'Menolak…' : 'Harga Kemahalan, Cari Kurir Lain'}
            </button>
          </div>
        )}

        {errand.note && (
          <p className="mt-3 rounded-xl bg-muted px-3 py-2.5 text-sm">
            <span className="font-semibold">Suruhan: </span>
            {errand.note}
          </p>
        )}

        {errand.pickupAddress && (
          <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            {errand.pickupAddress}
          </p>
        )}
      </div>

      {canMap && (
        <div className="mt-4 h-64 overflow-hidden rounded-2xl border">
          <DeliveryTrackingMapClient
            courier={{ lat: courierLat, lon: courierLon }}
            destination={{ lat: destLat, lon: destLon }}
            className="h-full w-full"
          />
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={cancel}
        disabled={cancelling || rejecting || secondsLeft > 0}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-red-200 px-4 py-3 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/30"
      >
        {cancelling ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <X className="h-4 w-4" />
        )}
        {secondsLeft > 0
          ? `Bisa dibatalkan dalam ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
          : 'Batalkan Pesanan'}
      </button>
      {secondsLeft > 0 && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Beri kurir waktu buat menjawab dulu sebelum membatalkan.
        </p>
      )}
    </div>
  );
}
