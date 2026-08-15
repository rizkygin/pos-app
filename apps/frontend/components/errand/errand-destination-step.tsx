'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  Crosshair,
  Loader2,
  Map as MapIcon,
  MapPin,
  Star,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import {
  FALLBACK_COORDS,
  GEOLOCATION_OPTIONS,
  geolocationMessage,
  getCurrentPosition,
} from '@/lib/geolocation';

const LocationPicker = dynamic(
  () => import('@/components/dashboard/location-picker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-80 items-center justify-center rounded-2xl border">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

export type ErrandDestination = {
  address: string;
  lat: number;
  lon: number;
};

type SavedLocation = {
  id: number;
  label: string;
  address: string;
  lat: string;
  lon: string;
  note: string | null;
  is_default: boolean;
};

/** Which of the three sources the customer is answering with. Exactly one. */
type Mode = 'saved' | 'current' | 'map';

const MODES: { id: Mode; label: string; hint: string; icon: typeof MapPin }[] = [
  { id: 'saved', label: 'Alamat Tersimpan', hint: 'Pilih dari daftar alamat pian', icon: Star },
  { id: 'current', label: 'Lokasi Sekarang', hint: 'Pakai GPS di HP pian', icon: Crosshair },
  { id: 'map', label: 'Tunjuk di Peta', hint: 'Geser pin + tulis patokan', icon: MapIcon },
];

/**
 * Where the errand ends — asked BEFORE the courier list, not after.
 *
 * The old flow silently used the saved default address, which is wrong the
 * moment the customer is not at home: the whole list is then sorted by distance
 * to the wrong end of the trip, and the courier is sent there too. Destination
 * first also means the distances beside each courier finally mean something.
 *
 * Three sources, and the customer commits to one of them: a saved address, the
 * phone's current fix, or a pin dropped on the map with typed directions. They
 * all resolve to the same {address, lat, lon} — nothing downstream cares which
 * one it came from.
 */
export function ErrandDestinationStep({
  onConfirm,
  onCancel,
  cancelLabel = 'Batal',
}: {
  onConfirm: (destination: ErrandDestination) => void;
  /** Leaves the step without a destination — see the footer. */
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const [mode, setMode] = useState<Mode>('saved');

  // --- saved ---------------------------------------------------------------
  const [saved, setSaved] = useState<SavedLocation[] | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/locations`, {
          cache: 'no-store',
          credentials: 'include',
        });
        const data = await res.json();
        if (cancelled) return;
        const rows: SavedLocation[] = data.success ? data.data : [];
        setSaved(rows);
        // Pre-select the default so the common case is one tap, not two.
        setSavedId(rows.find((r) => r.is_default)?.id ?? rows[0]?.id ?? null);
      } catch {
        if (!cancelled) setSaved([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- current -------------------------------------------------------------
  const [fix, setFix] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [currentNote, setCurrentNote] = useState('');

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Browser ini tidak mendukung lokasi. Buka lewat Chrome di HP.');
      return;
    }
    setLocating(true);
    setGeoError(null);
    getCurrentPosition(
      (pos) => {
        setFix({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLocating(false);
      },
      (err) => {
        setGeoError(geolocationMessage(err));
        setFix(null);
        setLocating(false);
      },
      // A fix from an hour ago could be a different neighbourhood — this one
      // decides where a courier is sent.
      { ...GEOLOCATION_OPTIONS, maximumAge: 30_000 },
    );
  }, []);

  // --- map -----------------------------------------------------------------
  // Null until the customer actually moves the pin, so the starting point stays
  // derived: their own street if the phone knows it, else their saved address,
  // else the town centre. Dragging from the fallback is a treasure hunt.
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [pinAddress, setPinAddress] = useState('');

  const savedDefault = saved?.find((r) => r.is_default) ?? saved?.[0];
  const savedCoords =
    savedDefault && Number.isFinite(Number(savedDefault.lat)) && Number.isFinite(Number(savedDefault.lon))
      ? { lat: Number(savedDefault.lat), lon: Number(savedDefault.lon) }
      : null;
  const activePin = pin ??
    (fix ? { lat: fix.lat, lon: fix.lon } : null) ??
    savedCoords ?? { lat: FALLBACK_COORDS.lat, lon: FALLBACK_COORDS.lon };

  // --- confirm -------------------------------------------------------------
  const chosen: ErrandDestination | null =
    mode === 'saved'
      ? (() => {
          const row = saved?.find((r) => r.id === savedId);
          if (!row) return null;
          const lat = Number(row.lat);
          const lon = Number(row.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          return {
            address: row.note ? `${row.address} (${row.note})` : row.address,
            lat,
            lon,
          };
        })()
      : mode === 'current'
        ? fix
          ? {
              address: currentNote.trim() || 'Lokasi pelanggan saat ini',
              lat: fix.lat,
              lon: fix.lon,
            }
          : null
        : pinAddress.trim()
          ? { address: pinAddress.trim(), lat: activePin.lat, lon: activePin.lon }
          : null;

  return (
    // Deliberately not dismissible — no backdrop click, no X. This is a step,
    // not a suggestion: as a panel on the page it read as optional decoration
    // above the courier list and customers scrolled straight past it into a
    // list sorted for an address they were not standing at.
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="errand-destination-title"
    >
      <motion.div
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 24, scale: 0.98 }}
        // dvh, not vh: on a phone the mobile browser's collapsing address bar
        // makes vh taller than what is actually on screen, which pushed the
        // sticky footer under the chrome.
        className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-background"
      >
        <div className="bg-rose-500 px-5 py-4 text-white">
          <p className="text-[10px] font-black uppercase tracking-widest opacity-90">
            Langkah 1 dari 2 — wajib
          </p>
          <h2 id="errand-destination-title" className="mt-0.5 text-xl font-black">
            Tentukan tujuan akhir kurir !
          </h2>
          <p className="mt-1 text-sm text-white/90">
            Tentukan titik tujuan dulu. lalu pilih kurir yang tersedia
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="grid grid-cols-3 gap-2">
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                // Ask on the tap, not on render: the permission prompt is the
                // slow part, so starting it here means the fix is usually
                // already in by the time they finish reading the panel.
                if (m.id === 'current' && !fix && !locating) locate();
              }}
              className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 p-3 text-center transition-colors ${
                active
                  ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/30'
                  : 'border-transparent bg-muted hover:bg-accent'
              }`}
            >
              <m.icon className={`h-5 w-5 ${active ? 'text-rose-500' : 'text-muted-foreground'}`} />
              <span className="text-xs font-bold leading-tight">{m.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        {MODES.find((m) => m.id === mode)!.hint}
      </p>

      <div className="mt-4">
        {mode === 'saved' && (
          saved === null ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : saved.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-6 text-center">
              <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 font-bold">Belum Ada Alamat Tersimpan</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Pian bisa simpan alamat dulu, atau pakai lokasi sekarang / tunjuk
                langsung di peta.
              </p>
              <Link
                href="/dashboard/users/locations/setting"
                className="mt-3 inline-flex rounded-full bg-rose-500 px-4 py-2 text-sm font-bold text-white hover:bg-rose-600"
              >
                Tambah Alamat
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {saved.map((row) => {
                const active = row.id === savedId;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSavedId(row.id)}
                      className={`flex w-full items-start gap-3 rounded-2xl border-2 p-3 text-left transition-colors ${
                        active ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/20' : 'hover:bg-accent'
                      }`}
                    >
                      <MapPin
                        className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-rose-500' : 'text-muted-foreground'}`}
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="font-bold">{row.label}</span>
                          {row.is_default && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">
                              Utama
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">
                          {row.address}
                          {row.note ? ` — ${row.note}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}

        {mode === 'current' && (
          <div className="rounded-2xl border p-4">
            {locating ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Mencari lokasi pian…
              </p>
            ) : geoError ? (
              <>
                <p className="text-sm text-red-600 dark:text-red-400">{geoError}</p>
                <button
                  type="button"
                  onClick={locate}
                  className="mt-3 rounded-full border px-4 py-2 text-sm font-bold"
                >
                  Coba Lagi
                </button>
              </>
            ) : fix ? (
              <>
                <p className="flex items-center gap-2 text-sm font-bold">
                  <Crosshair className="h-4 w-4 text-rose-500" />
                  Lokasi terbaca (±{Math.round(fix.accuracy)} m)
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {fix.lat.toFixed(5)}, {fix.lon.toFixed(5)}
                </p>
                {/* Coordinates alone leave the courier standing in the street
                    guessing which gate. One line of directions costs nothing
                    here and saves a phone call later. */}
                <label className="mt-3 block text-sm font-semibold" htmlFor="errand-current-note">
                  Patokan / nama tempat (opsional)
                </label>
                <input
                  id="errand-current-note"
                  value={currentNote}
                  onChange={(e) => setCurrentNote(e.target.value)}
                  maxLength={255}
                  placeholder="Contoh: depan Indomaret, pagar hijau"
                  className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-rose-400"
                />
                <button
                  type="button"
                  onClick={locate}
                  className="mt-2 text-xs font-bold text-rose-600 hover:underline"
                >
                  Segarkan lokasi
                </button>
              </>
            ) : null}
          </div>
        )}

        {mode === 'map' && (
          <div className="space-y-3">
            <LocationPicker
              lat={activePin.lat}
              lon={activePin.lon}
              onChange={(lat, lon) => setPin({ lat, lon })}
            />
            <p className="text-xs text-muted-foreground">
              Ketuk atau geser pin ke titik tujuan. {activePin.lat.toFixed(5)},{' '}
              {activePin.lon.toFixed(5)}
            </p>
            <div>
              {/* Required in this mode, unlike the GPS one: a hand-dropped pin
                  has no story attached to it, so the typed line is the only
                  thing telling the courier what he is looking for. */}
              <label className="block text-sm font-semibold" htmlFor="errand-pin-address">
                Alamat / patokan
              </label>
              <input
                id="errand-pin-address"
                value={pinAddress}
                onChange={(e) => setPinAddress(e.target.value)}
                maxLength={255}
                placeholder="Contoh: Jl. Iskandar No. 12, rumah cat biru"
                className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>
          </div>
        )}
          </div>
        </div>

        {/* Sticky footer rather than a button at the bottom of a scroll: with
            the map open the confirm would otherwise sit below the fold. */}
        <div className="flex gap-2 border-t bg-background p-4">
          {/* An escape, but a leaving one — there is no version of this screen
              that works without a destination, so "cancel" means cancel the
              errand, not skip the step. */}
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border px-4 py-3 text-sm font-bold"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={!chosen}
            onClick={() => chosen && onConfirm(chosen)}
            className="flex-1 rounded-full bg-rose-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-rose-600 disabled:opacity-50"
          >
            {mode === 'map' && !pinAddress.trim()
              ? 'Isi Alamat Dulu'
              : mode === 'current' && !fix
                ? 'Menunggu Lokasi…'
                : 'Lanjut Pilih Kurir'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
