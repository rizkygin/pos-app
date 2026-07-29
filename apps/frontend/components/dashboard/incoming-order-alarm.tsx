'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { BellRing, Volume2, VolumeX, ChevronRight } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { useOrderAlarm } from '@/lib/use-order-alarm';

// Slower than the Order Lobby's own 2s refresh: this runs on every dashboard
// page, and a few seconds of delay on the chime is imperceptible next to the
// time it takes an owner to walk to the screen.
const POLL_MS = 8000;
const LOBBY_PATH = '/dashboard/activeorder';

/**
 * Owner-wide "an order is waiting" alarm. Mounted in the dashboard layout so it
 * rings whatever page the owner happens to be on — an owner ringing up a
 * walk-in at the cashier would otherwise never hear an online order land.
 *
 * The chime repeats until the pending count drops to zero, which happens when
 * the order is confirmed, rejected, or cancelled by the customer.
 */
export function IncomingOrderAlarm() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const { muted, toggleMuted, blocked, enableSound } = useOrderAlarm(count > 0);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/api/get-pending-orders-count`, {
          cache: 'no-store',
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success) setCount(data.count ?? 0);
      } catch {
        // Offline or a blip — keep the last count and retry next tick rather
        // than silencing an alarm that may still be live.
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="sticky top-12 z-30 mx-3 mt-2 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 shadow-sm md:top-10 dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <motion.span
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
            className="shrink-0 text-amber-600 dark:text-amber-400"
          >
            <BellRing className="h-5 w-5" />
          </motion.span>

          <p className="min-w-0 flex-1 text-sm font-bold text-amber-900 dark:text-amber-200">
            {count} pesanan menunggu konfirmasi
            {muted && (
              <span className="ml-2 text-xs font-medium text-amber-700/70 dark:text-amber-300/60">
                (suara dimatikan)
              </span>
            )}
          </p>

          {/* Autoplay is blocked until the page has been interacted with — this
              button is the gesture that unlocks it. */}
          {blocked && !muted && (
            <button
              onClick={enableSound}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-700"
            >
              Aktifkan suara
            </button>
          )}

          <button
            onClick={toggleMuted}
            aria-label={muted ? 'Nyalakan suara' : 'Matikan suara'}
            className="shrink-0 rounded-lg p-1.5 text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
          >
            {muted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>

          {pathname !== LOBBY_PATH && (
            <Link
              href={LOBBY_PATH}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-700"
            >
              Buka
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
