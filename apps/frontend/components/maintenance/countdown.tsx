'use client';

import { useEffect, useState } from 'react';

/**
 * "2 jam 5 menit", "45 detik", or null once the target has passed. Deliberately
 * coarse above an hour — nobody needs seconds of precision on a two-hour wait,
 * and a ticking seconds digit next to "maintenance" reads as panic.
 */
export function formatRemaining(ms: number): string | null {
  if (ms <= 0) return null;

  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return minutes > 0 ? `${hours} jam ${minutes} menit` : `${hours} jam`;
  if (totalMinutes > 0) return `${totalMinutes} menit`;
  return `${Math.max(1, Math.floor(ms / 1000))} detik`;
}

/**
 * Counts down to `target` on the client. The value is computed from the ISO
 * string on every tick rather than decremented, so a laptop waking from sleep
 * shows the truth instead of however far the interval got.
 */
export function useRemaining(target: string | null) {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setRemaining(null);
      return;
    }
    const at = Date.parse(target);
    const tick = () => setRemaining(formatRemaining(at - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  // null on the server and the first paint, so nothing hydrates mismatched.
  return remaining;
}
