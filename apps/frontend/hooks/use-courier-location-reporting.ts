'use client';

import { useEffect, useRef } from 'react';
import { API_URL } from '@/lib/api-url';
import { GEOLOCATION_OPTIONS, geolocationMessage } from '@/lib/geolocation';

/**
 * How often the courier's position is sent up.
 *
 * Not watchPosition(): that fires on every GPS fix — many per minute while
 * moving — and each one would be a database write and a wakeup on a phone that
 * has to survive a whole shift. A delivery ETA does not get meaningfully better
 * between 30-second samples, so it polls instead.
 */
const REPORT_INTERVAL_MS = 30_000;

/**
 * Consecutive failed fixes tolerated before the shift is treated as untrackable.
 *
 * Not 1: a courier riding through a tunnel or a concrete basement loses the fix
 * for a moment all the time, and ending their shift over that would be worse
 * than the bug it fixes. Three ticks is ~90 seconds of no position at all,
 * which is longer than the 5-minute staleness window matters for but short
 * enough that they find out while they can still do something about it.
 * A permission denial skips the count entirely — retrying it changes nothing.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Reports the courier's position while they are ON SHIFT.
 *
 * This used to run only during an active delivery, on the reasoning that an idle
 * courier's position served nobody. Dispatch changed that: orders are now
 * offered nearest-first, so a courier whose position is unknown is ranked last
 * and quietly loses the good orders. Being trackable is now the thing that gets
 * you work, which makes on-shift reporting part of the job rather than
 * surveillance of someone's day.
 *
 * The boundary is the shift, and it is enforced on both ends: this stops the
 * moment they go offline, and go-offline clears the stored point server-side.
 * Nothing is recorded outside a shift, and no trail is kept during one — the
 * column is overwritten in place.
 *
 * A failed *upload* is silent — the customer's ETA just falls back to the
 * outlet-based estimate, which is not worth interrupting someone riding a
 * motorcycle to tell them. A failed *fix* is not: with no position the courier
 * is still "online" but ranked last on every offer, quietly earning nothing.
 * That case calls onUntrackable so the caller can end the shift.
 *
 * @param onUntrackable Called once per outage when the device stops producing
 *   positions at all (GPS switched off, permission revoked mid-shift).
 */
export function useCourierLocationReporting(
  active: boolean,
  onUntrackable?: (message: string) => void,
) {
  // Held in a ref so the interval callback never closes over a stale value.
  const activeRef = useRef(active);
  activeRef.current = active;

  // Same reason: the callback identity changes on every render of the caller,
  // and re-running the effect for that would restart the interval each time.
  const onUntrackableRef = useRef(onUntrackable);
  onUntrackableRef.current = onUntrackable;

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.geolocation) return;

    let cancelled = false;
    let failures = 0;
    // One report per outage, not one per tick — otherwise a courier parked in a
    // basement gets the same banner every 30 seconds.
    let reported = false;

    const report = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled || !activeRef.current) return;
          failures = 0;
          reported = false;
          fetch(`${API_URL}/api/courier/location`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
            }),
            // Best-effort: a dropped report costs one stale ETA cycle, and the
            // backend treats anything older than 5 minutes as unusable anyway.
            keepalive: true,
          }).catch(() => {});
        },
        (err) => {
          if (cancelled || !activeRef.current || reported) return;
          const fatal = err.code === err.PERMISSION_DENIED;
          failures += 1;
          if (!fatal && failures < MAX_CONSECUTIVE_FAILURES) return; // Next tick retries.
          reported = true;
          onUntrackableRef.current?.(geolocationMessage(err));
        },
        GEOLOCATION_OPTIONS,
      );
    };

    report(); // Don't make the customer wait a full interval for the first point.
    const id = setInterval(report, REPORT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
      // Delivery finished, or the courier navigated away: drop the stored point.
      // Collected for a live ETA, so it should not outlive one.
      fetch(`${API_URL}/api/courier/location/clear`, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
      }).catch(() => {});
    };
  }, [active]);
}
