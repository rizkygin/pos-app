'use client';

import { useEffect, useRef } from 'react';
import { API_URL } from '@/lib/api-url';
import { GEOLOCATION_OPTIONS } from '@/lib/geolocation';

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
 * Reports the courier's position while a delivery is in flight.
 *
 * Deliberately gated on `active`: location is collected only while there is a
 * customer waiting who benefits from it, and the position is cleared the moment
 * that stops being true. A courier who is online but idle is not tracked.
 *
 * Silent by design — a failed report just means the customer's ETA falls back to
 * the outlet-based estimate, which is not worth interrupting someone riding a
 * motorcycle to tell them.
 */
export function useCourierLocationReporting(active: boolean) {
  // Held in a ref so the interval callback never closes over a stale value.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.geolocation) return;

    let cancelled = false;

    const report = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled || !activeRef.current) return;
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
        () => {
          /* No fix this round — the next tick tries again. */
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
