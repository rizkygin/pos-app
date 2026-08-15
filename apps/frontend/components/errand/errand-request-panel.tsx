'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  Check,
  Copy,
  Loader2,
  MapPin,
  MessageCircle,
  RotateCw,
  Star,
  X,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { fmtIDR, formatNumberInput, parseNumberInput } from '@/lib/utils/format';
import {
  GEOLOCATION_OPTIONS,
  geolocationMessage,
  getCurrentPosition,
} from '@/lib/geolocation';

type Errand = {
  id: string;
  status: 'pending' | 'on_delivery';
  note: string | null;
  price: string | null;
  /**
   * The customer's own location — where the courier rides TO. The server still
   * spells these pickup* on the wire for the installed courier app; the columns
   * behind them are errand_orders.destination_*.
   */
  pickupAddress: string | null;
  pickupLat: string | null;
  pickupLon: string | null;
  createdAt: string;
  customerName: string;
  customerPhone: string | null;
  customer: { rating: number; reviewCount: number };
  arrivalRadiusM: number;
};

const POLL_MS = 4000;

/** Fallback only — the server sends the real radius with the errand. */
const DEFAULT_RADIUS_M = 20;

function distanceMetres(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const fmtDistance = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

/**
 * The courier's side of "Tugaskan Kurir".
 *
 * Mounted alongside the regular lobby rather than inside it: an errand is not
 * an offer, has no countdown, and is aimed at this courier alone, so none of
 * the lobby's queue machinery applies to it. Keeping it separate also means the
 * lobby's polling and offer clock stay untouched.
 *
 * With no errand this renders `children` untouched — couriers who never receive
 * one see no change to their screen. With one, the children (the open-queue
 * lobby) are REPLACED rather than pushed down: an errand holds this courier
 * exclusively, so every offer below it is one he cannot take, and leaving the
 * queue on screen only invites him to tap an offer that will be refused.
 */
export function ErrandRequestPanel({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const [errand, setErrand] = useState<Errand | null>(null);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState<
    { lat: number; lon: number; accuracy: number } | null
  >(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/courier/errands/pending`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) setErrand(data.errand);
    } catch {
      // Keep the last known state.
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // A live fix, not a one-shot on press: the courier watches the distance count
  // down as he rides, so arriving and the button unlocking are the same moment
  // rather than a press that fails and has to be repeated. Only runs on a job
  // already under way — a courier reading a new request is not being tracked.
  const tracking = errand?.status === 'on_delivery';
  useEffect(() => {
    if (!tracking) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      // Silence here would read as "still searching…" forever, on a job the
      // courier cannot finish until a fix arrives.
      setGeoError('Browser ini tidak mendukung lokasi. Buka lewat Chrome di HP.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoError(null);
        setPosition({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        setGeoError(geolocationMessage(err));
        // Drop the last fix too. Keeping it would leave a stale distance on
        // screen that the courier reads as live while he is still riding.
        setPosition(null);
      },
      // maximumAge 0: a cached fix from the start of the trip would say he is
      // still far away — or worse, that he has arrived when he has left.
      { ...GEOLOCATION_OPTIONS, enableHighAccuracy: true, maximumAge: 0 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // Recovery from a dead watch is CourierGpsGuard's job (dashboard layout):
    // it modals the courier and starts a fresh watch, and this one picks the
    // fix back up on the next status poll.
  }, [tracking]);

  async function post(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/courier/errands/${errand!.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? 'Gagal.');
        // 'gone' means the customer cancelled while this was open — reload so
        // the panel stops showing a job that no longer exists.
        if (data.code === 'gone') await load();
        return false;
      }
      await load();
      router.refresh();
      return true;
    } catch {
      setError('Tidak bisa menghubungi server.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!errand) return <>{children}</>;

  const waLink = errand.customerPhone ? `https://wa.me/${errand.customerPhone}` : null;
  const pending = errand.status === 'pending';

  const radiusM = errand.arrivalRadiusM ?? DEFAULT_RADIUS_M;
  const pinLat = errand.pickupLat !== null ? Number(errand.pickupLat) : NaN;
  const pinLon = errand.pickupLon !== null ? Number(errand.pickupLon) : NaN;
  const hasPin = Number.isFinite(pinLat) && Number.isFinite(pinLon);
  const distance =
    position && hasPin
      ? distanceMetres(position.lat, position.lon, pinLat, pinLon)
      : null;
  const arrived = distance !== null && distance <= radiusM;
  // No pin means nothing to measure against, and the server skips the check for
  // the same reason — an errand with broken coordinates must not strand a
  // courier who has genuinely finished the job.
  const canDeliver = !hasPin || arrived;
  // The pin is what the courier actually has to ride to; the typed address is
  // only a fallback for errands whose coordinates never came through.
  const mapsLink = hasPin
    ? `https://www.google.com/maps/search/?api=1&query=${pinLat},${pinLon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        errand.pickupAddress ?? '',
      )}`;
  // The rating link the courier shares after delivering. Absolute, because it
  // is pasted into WhatsApp and opened outside the app.
  const ratingLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/dashboard/ratings/errand/${errand.id}`
      : '';

  return (
    // Full-bleed on a phone: the card IS the screen when an errand is live, and
    // a 448px cap left it visibly narrower than the lobby it replaces. The cap
    // returns from sm up, where full width would stretch absurdly.
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto mt-6 mb-4 w-full sm:max-w-md overflow-hidden rounded-2xl border-2 border-rose-300 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20"
    >
      <div className="flex items-center gap-2 bg-rose-500 px-4 py-2 text-white">
        <span className="text-sm font-black">
          {pending ? 'Tugas Baru' : 'Tugas Berjalan'}
        </span>
        <span className="ml-auto text-xs opacity-90">Tanpa outlet</span>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-bold">{errand.customerName}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              {errand.customer.rating.toFixed(1)}
              <span className="opacity-70">
                ({errand.customer.reviewCount} penilaian)
              </span>
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
              Chat
            </a>
          )}
        </div>

        {errand.note && (
          <p className="mt-3 rounded-xl bg-background px-3 py-2.5 text-sm">
            <span className="font-semibold">Tugas: </span>
            {errand.note}
          </p>
        )}

        {/* Same card shape as the note above it: address and the map button are
            one thing the courier acts on, not two stray lines. */}
        {errand.pickupAddress && (
          <div className="mt-2 rounded-xl bg-background px-3 py-2.5">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-semibold">Tujuan akhir: </span>
                  {errand.pickupAddress}
                </p>
              </div>
            </div>
            <a
              href={mapsLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-600"
            >
              <MapPin className="h-3.5 w-3.5" />
              Buka Peta Gmaps
            </a>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-xl bg-red-100 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        {pending ? (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground">
              Sepakati harga lewat WhatsApp dulu, baru isi di sini.
            </p>
            <div className="mt-2 flex gap-2">
              {/* Text, not number: the separators are part of what the courier
                  reads back, and a number input would reject them. `price`
                  itself stays raw digits, so the POST body is unaffected. */}
              <input
                type="text"
                inputMode="numeric"
                value={formatNumberInput(price)}
                onChange={(e) => setPrice(parseNumberInput(e.target.value))}
                placeholder="Harga (Rp)"
                className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-rose-400"
              />
              <button
                type="button"
                disabled={busy || price === '' || Number(price) < 0}
                onClick={() => post('accept', { price: Number(price) })}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Terima
              </button>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting((v) => !v)}
              className="mt-2 w-full rounded-xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/30"
            >
              Tolak
            </button>

            <AnimatePresence>
              {rejecting && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 flex gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={255}
                      placeholder="Alasan (opsional)"
                      className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-rose-400"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => post('reject', { reason })}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                      Kirim
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="mt-4">
            {errand.price && (
              <div className="flex items-center justify-between rounded-xl bg-background px-3 py-2.5">
                <span className="text-sm font-medium">Harga disepakati</span>
                <span className="font-black">{fmtIDR(Number(errand.price))}</span>
              </div>
            )}
            {/* The rule, stated before the button rather than as an error
                after it: a courier who reads "masih 300 m" knows to keep
                riding, where a disabled button alone reads as a bug. */}
            <div className="mt-2 rounded-xl border border-dashed px-3 py-2.5 text-xs">
              <p className="font-bold">
                {geoError
                  ? 'Lokasi belum terbaca'
                  : distance === null
                    ? 'Mencari lokasi pian…'
                    : arrived
                      ? `Pian sudah di lokasi pelanggan (${fmtDistance(distance)})`
                      : `Masih ${fmtDistance(distance)} dari pelanggan`}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {geoError ??
                  `Tombol "Tandai Sudah Sampai" kebuka otomatis kalau pian sudah dalam ${radiusM} meter dari titik pelanggan. Biarkan GPS nyala selama antar.`}
              </p>
              {position && !geoError && position.accuracy > radiusM * 3 && (
                <p className="mt-1 text-amber-600 dark:text-amber-500">
                  Akurasi GPS ±{Math.round(position.accuracy)} m — masih kasar. Tunggu
                  sebentar di tempat biar sinyalnya mengunci.
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={busy || !canDeliver}
              onClick={async () => {
                const ok = await post('delivered', position ?? {});
                if (ok) {
                  // Copy the rating link straight away — the courier is
                  // standing in front of the customer at this exact moment,
                  // which is the only time asking for a rating actually works.
                  try {
                    await navigator.clipboard.writeText(ratingLink);
                    setCopied(true);
                  } catch {
                    // Clipboard permission denied; the button below still works.
                  }
                }
              }}
              className="mt-2 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : canDeliver ? (
                'Tandai Sudah Sampai'
              ) : distance === null ? (
                'Menunggu Lokasi…'
              ) : (
                `Dekati Dulu — Masih ${fmtDistance(distance)}`
              )}
            </button>

            {/* Manual escape hatch for the moment the watch has gone quiet —
                GPS switched back on, a tunnel left behind — and the courier is
                standing at the door waiting for the button above to unlock.
                Asks for one fresh fix and re-reads the errand in one press. */}
            <button
              type="button"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                void load();
                getCurrentPosition(
                  (pos) => {
                    setGeoError(null);
                    setPosition({
                      lat: pos.coords.latitude,
                      lon: pos.coords.longitude,
                      accuracy: pos.coords.accuracy,
                    });
                    setRefreshing(false);
                  },
                  (err) => {
                    setGeoError(geolocationMessage(err));
                    setRefreshing(false);
                  },
                  // Same as the watch: a cached fix is exactly the wrong answer
                  // to "am I there yet".
                  { ...GEOLOCATION_OPTIONS, enableHighAccuracy: true, maximumAge: 0 },
                );
              }}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-60"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
              {refreshing ? 'Menyegarkan…' : 'Segarkan Lokasi'}
            </button>

            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(ratingLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setError('Tidak bisa menyalin. Salin manual dari alamat berikut: ' + ratingLink);
                }
              }}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-bold"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Link Tersalin' : 'Salin Link Penilaian'}
            </button>
            <p className="mt-1.5 text-center text-xs text-muted-foreground">
              Kirim ke pelanggan lewat WhatsApp biar bisa kasih rating.
            </p>
          </div>
        )}
      </div>
    </motion.section>
  );
}
