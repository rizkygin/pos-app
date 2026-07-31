'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, Truck, MapPin, Navigation, ExternalLink, AlertTriangle } from 'lucide-react';
import {
  confirmMaterialsOrder,
  getMaterialsQuote,
  type MaterialsQuote,
} from '@/app/dashboard/activeorder/actions';

function fmtIDR(amount: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Owner accepts a pending bahan-bangunan order by quoting the haul.
 *
 * Deliberately NOT the service modal with different labels. Two things differ in
 * kind: the goods already have fixed prices, so the only number in play is the
 * delivery fee; and there is no appointment to schedule — the load goes out when
 * it is ready, not at a booked time.
 *
 * The ceiling comes from the API rather than being computed here. The same value
 * is re-derived server-side on submit, so a stale or tampered figure is rejected;
 * fetching it means the owner sees the real limit instead of hitting it blind.
 */
export function MaterialsConfirmModal({
  orderId,
  goodsTotal,
  onClose,
  onDone,
}: {
  orderId: string;
  goodsTotal: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [quote, setQuote] = useState<MaterialsQuote | null>(null);
  const [fee, setFee] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const cap = quote?.cap ?? null;

  useEffect(() => {
    let cancelled = false;
    getMaterialsQuote(orderId)
      .then((value) => {
        if (cancelled) return;
        setQuote(value);
        setFee(value.cap); // Most owners charge the full band; they can dial it down.
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Gagal memuat data');
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const submit = async () => {
    setError('');
    if (cap === null) return;
    if (fee < 0 || fee > cap) {
      setError(`Ongkos angkut maksimal ${fmtIDR(cap)}.`);
      return;
    }
    setSubmitting(true);
    try {
      await confirmMaterialsOrder(orderId, fee);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memproses order');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-background p-5 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
              <Truck className="h-4 w-4" />
            </span>
            <div>
              <p className="font-black text-sm">Terima &amp; Tetapkan Ongkos Angkut</p>
              <p className="text-xs text-muted-foreground">Diantar sopir toko, tanpa kurir</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Where it's going is the whole reason this step exists. An address
            alone doesn't price a haul — the distance is the number the owner
            actually reasons about, so it leads. */}
        {quote && (
          quote.dropoff ? (
            // An information card with a real button in it, rather than one big
            // anchor: a whole clickable panel reads as a panel, and the owner
            // never finds the tap target. The route is a distinct action, so it
            // gets a control that looks like one.
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="flex items-start justify-between gap-3 px-3.5 pt-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Tujuan pengantaran
                  </p>
                  {quote.dropoff.label && (
                    <p className="text-sm font-bold leading-tight">{quote.dropoff.label}</p>
                  )}
                </div>
                {/* Distance is the number the haul is priced on, so it gets the
                    weight of a headline figure rather than a line of body text. */}
                {quote.distanceKm !== null && (
                  <div className="shrink-0 text-right">
                    <p className="text-xl font-black leading-none tabular-nums text-amber-600">
                      {quote.distanceKm}
                      <span className="text-xs font-bold"> km</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {quote.distanceSource === 'road'
                        ? quote.driveMinutes !== null
                          ? `lewat jalan · ±${quote.driveMinutes} menit`
                          : 'lewat jalan'
                        : 'garis lurus'}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-start gap-2 px-3.5 py-2.5">
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-rose-500" />
                <div className="min-w-0 space-y-1">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {quote.dropoff.address}
                  </p>
                  {quote.dropoff.note && (
                    <p className="text-xs italic text-muted-foreground/80 border-l-2 border-border pl-2">
                      {quote.dropoff.note}
                    </p>
                  )}
                  {/* Say which number this is. A straight-line figure reads
                      short — around here roads run ~1.75x — so an owner pricing
                      off it without knowing would undercharge badly. */}
                  <p className="text-[10px] text-muted-foreground/70">
                    {quote.distanceKm === null
                      ? 'Jarak tidak bisa dihitung.'
                      : quote.distanceSource === 'road'
                        ? 'Jarak rute mengemudi sebenarnya.'
                        : 'Rute jalan tidak tersedia — ini jarak garis lurus, aslinya lebih jauh.'}
                  </p>
                  {/* ODbL attribution, required whenever OpenStreetMap-derived
                      routing is shown. Only on the 'road' branch: the
                      straight-line fallback is pure trigonometry and uses no
                      OSM data, so crediting them there would be false. */}
                  {quote.distanceSource === 'road' && (
                    <p className="text-[10px] text-muted-foreground/60">
                      Rute via OSRM · data ©{' '}
                      <a
                        href="https://www.openstreetmap.org/copyright"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        OpenStreetMap
                      </a>{' '}
                      contributors
                    </p>
                  )}
                </div>
              </div>

              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${quote.dropoff.lat},${quote.dropoff.lon}&travelmode=driving`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 border-t border-border bg-amber-600 px-3.5 py-3 text-xs font-black text-white transition-colors hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
              >
                <Navigation className="h-3.5 w-3.5" />
                Buka Rute di Maps
                <ExternalLink className="h-3 w-3 opacity-80" />
              </a>
            </div>
          ) : (
            // Without a saved address the owner has nothing to price against,
            // and the driver has nowhere to go. Say so instead of showing a
            // slider that implies the information is there.
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-rose-500" />
              <p className="text-xs text-rose-700 dark:text-rose-400">
                Pelanggan belum menyimpan alamat utama, jadi tujuan pengantaran belum
                diketahui. Hubungi pelanggan dulu, atau tolak order ini.
              </p>
            </div>
          )
        )}

        {quote === null ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat tujuan &amp; batas…
          </div>
        ) : cap === 0 ? (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
            Produk di order ini tidak punya jatah ongkos angkut (harga barang &amp; harga
            diantar sama), jadi ongkosnya nol. Terima saja kalau pian setuju mengantar
            tanpa tambahan biaya.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="haul-fee"
                className="text-xs font-bold text-muted-foreground uppercase tracking-wider"
              >
                Ongkos angkut
              </label>
              <span className="text-lg font-black text-amber-600 tabular-nums">
                {fmtIDR(fee)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={quote.cap}
              step={Math.max(1, Math.round(quote.cap / 100))}
              value={fee}
              onChange={(e) => setFee(Number(e.target.value))}
              className="w-full accent-amber-600"
              aria-label="Ongkos angkut"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>{fmtIDR(0)}</span>
              <span>maks {fmtIDR(quote.cap)}</span>
            </div>
            <input
              id="haul-fee"
              type="number"
              value={fee}
              min={0}
              max={quote.cap}
              onChange={(e) => setFee(Number(e.target.value))}
              className="w-full h-11 rounded-xl border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        )}

        <div className="space-y-1 rounded-xl bg-muted/50 px-3 py-2.5 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>Barang</span>
            <span className="tabular-nums">{fmtIDR(goodsTotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Ongkos angkut</span>
            <span className="tabular-nums">{fmtIDR(fee)}</span>
          </div>
          <div className="flex justify-between font-black pt-1 border-t border-border">
            <span>Total ditagih</span>
            <span className="tabular-nums text-rose-600">{fmtIDR(goodsTotal + fee)}</span>
          </div>
        </div>

        {error && (
          <p className="text-xs font-medium text-rose-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 h-12 rounded-xl border border-input text-sm font-bold hover:bg-muted disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={submit}
            // Blocked without a drop-off: accepting would commit the outlet to
            // delivering somewhere nobody knows.
            disabled={submitting || quote === null || quote.dropoff === null}
            className="flex-1 h-12 rounded-xl bg-amber-600 text-white text-sm font-black hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Memproses…' : 'Terima Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
