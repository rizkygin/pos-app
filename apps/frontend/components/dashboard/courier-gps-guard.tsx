'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, MapPinOff, RotateCw } from 'lucide-react';
import { GEOLOCATION_OPTIONS, geolocationMessage } from '@/lib/geolocation';

/**
 * Dashboard-wide GPS warning for couriers.
 *
 * Location is not a per-screen nicety for a courier: going online, being
 * dispatched, and marking an errand delivered all fail without a fix, and they
 * fail late — at the customer's door, with a disabled button and no explanation.
 * Catching it here means the courier learns GPS is off while he still has time
 * to switch it on, whatever page he happens to be on.
 *
 * Deliberately a modal and not a banner: a warning a courier can ride past is
 * the same as no warning. It is dismissible all the same — a courier mid-job
 * must never be locked out of his own screen by a permissions dialog — but the
 * check keeps running, so the next failure brings it back.
 */
export function CourierGpsGuard() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // A watch that has errored out stays dead: switching GPS on does not revive
  // it. Bumping this is what starts a fresh one.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setBusy(true);
    setDismissed(false);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Browser ini tidak mendukung lokasi. Buka lewat Chrome di HP.');
      setBusy(false);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      () => {
        // A fix arrived — whatever was wrong is fixed, and the modal goes away
        // on its own without the courier having to close it. Clearing the
        // dismissal here is what re-arms it: "Nanti Dulu" silences the warning
        // he is looking at, not every warning for the rest of the shift.
        setError(null);
        setDismissed(false);
        setBusy(false);
      },
      (err) => {
        setError(geolocationMessage(err));
        setBusy(false);
      },
      GEOLOCATION_OPTIONS,
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [attempt]);

  const open = !!error && !dismissed;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="w-full max-w-sm overflow-hidden rounded-2xl border bg-background shadow-xl"
          >
            <div className="flex items-center gap-2 bg-amber-500 px-4 py-3 text-white">
              <MapPinOff className="h-4 w-4 shrink-0" />
              <span className="text-sm font-black">GPS Pian Mati</span>
            </div>

            <div className="p-4">
              <p className="text-sm font-semibold">
                Nyalakan GPS dulu biar bisa terima dan selesaikan orderan.
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">{error}</p>
              <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                Tanpa lokasi, pian kada bisa online, kada dapat tawaran, dan tombol
                &quot;Tandai Sudah Sampai&quot; kada kebuka waktu antar.
              </p>

              <button
                type="button"
                onClick={retry}
                disabled={busy}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="h-4 w-4" />
                )}
                {busy ? 'Mencari Lokasi…' : 'Sudah Nyala, Coba Lagi'}
              </button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="mt-2 w-full rounded-xl border px-4 py-2.5 text-sm font-bold"
              >
                Nanti Dulu
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
