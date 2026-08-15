'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { useRemaining } from '@/components/maintenance/countdown';
import { MAINTENANCE_OFF, type Maintenance } from '@/lib/maintenance';

// Polled from the browser rather than passed down from the root layout: a
// server-rendered banner would make every page in the app dynamic, and would
// still be stale for anyone who left a tab open — which is exactly the person
// this warning is for.
const POLL_MS = 60_000;

// Dismissal is per scheduled window, not global. Hiding one heads-up must not
// silence the next one.
const dismissKey = (startsAt: string) => `maintenance-dismissed:${startsAt}`;

export function MaintenanceBanner() {
  const [maintenance, setMaintenance] = useState<Maintenance>(MAINTENANCE_OFF);
  const [dismissed, setDismissed] = useState(false);
  const remaining = useRemaining(maintenance.startsAt);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/maintenance`, { cache: 'no-store' });
      if (!res.ok) return;
      const next: Maintenance = await res.json();
      setMaintenance(next);
      setDismissed(
        next.startsAt ? sessionStorage.getItem(dismissKey(next.startsAt)) === '1' : false,
      );
    } catch {
      // Offline or backend down. Keep whatever is on screen; a missing warning
      // is a smaller problem than a banner that flickers on every hiccup.
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // 'active' is handled by the proxy, which rewrites the whole page to
  // /maintenance — a banner would be redundant there.
  if (maintenance.status !== 'upcoming' || dismissed || !remaining) return null;

  const dismiss = () => {
    if (maintenance.startsAt) sessionStorage.setItem(dismissKey(maintenance.startsAt), '1');
    setDismissed(true);
  };

  return (
    <div className="sticky top-0 z-50 flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1 text-xs leading-relaxed sm:text-sm">
        <span className="font-semibold">Pemeliharaan sistem dalam {remaining}.</span>{' '}
        {maintenance.message?.trim() ||
          'Selesaikan transaksi yang sedang berjalan sebelum waktu tersebut.'}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Tutup pemberitahuan"
        className="rounded p-1 transition-colors hover:bg-amber-200/60 dark:hover:bg-amber-500/20"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
