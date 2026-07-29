'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BellRing, X } from 'lucide-react';
import { usePushSubscription } from '@/lib/use-push-subscription';

const DISMISSED_KEY = 'pos_push_nudge_dismissed';

/**
 * One-time prompt asking the owner to enable background order notifications.
 * Only shows for `state === 'default'` (permission never asked) — once
 * answered either way (granted, denied, or dismissed) it never reappears, so
 * this is not a nag banner. The permanent on/off control lives in Settings
 * (push-notification-card.tsx) for whenever the owner wants to change it later.
 */
export function PushNotificationNudge() {
  const { state, busy, subscribe } = usePushSubscription();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  const visible = !dismissed && state === 'default';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="mx-3 mt-2 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/30"
        >
          <BellRing className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="min-w-0 flex-1 text-sm font-semibold text-blue-900 dark:text-blue-200">
            Aktifkan notifikasi biar tau pesanan baru walau aplikasi ditutup.
          </p>
          <button
            onClick={async () => {
              await subscribe();
              dismiss();
            }}
            disabled={busy}
            className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? 'Mengaktifkan...' : 'Aktifkan'}
          </button>
          <button
            onClick={dismiss}
            aria-label="Tutup"
            className="shrink-0 rounded-lg p-1.5 text-blue-700 transition-colors hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/40"
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
