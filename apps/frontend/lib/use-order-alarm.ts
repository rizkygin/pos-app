'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Gap between chimes while an order is still waiting. Short enough to nag,
// long enough not to drown out someone talking to a customer at the counter.
const REPEAT_MS = 2000;
const MUTED_KEY = 'pos_order_alarm_muted';

// The chime is synthesised rather than loaded from an mp3: no asset to ship or
// cache, and a pure tone cuts through counter noise better than most stock
// notification sounds.
const NOTES = [880, 1174.66]; // A5 -> D6, a rising "ding-dong"

function playChime(ctx: AudioContext) {
  NOTES.forEach((freq, i) => {
    const at = ctx.currentTime + i * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    // Ramp instead of a hard start/stop — a square-edged gate produces an
    // audible click on most speakers.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(2, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.55);
  });
}

/**
 * Rings a repeating chime for as long as `active` is true.
 *
 * Browsers refuse to start audio until the user has interacted with the page,
 * and a page restored in a background tab may never have been touched. When
 * that happens the hook reports `blocked` so the UI can offer a tap-to-enable
 * button — the tap is the gesture that unlocks the AudioContext.
 */
export function useOrderAlarm(active: boolean) {
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      setMuted(localStorage.getItem(MUTED_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((v) => {
      const next = !v;
      try {
        localStorage.setItem(MUTED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const getContext = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      ctxRef.current = new Ctor();
    }
    return ctxRef.current;
  }, []);

  // Called from a click handler, so the resume() is inside a user gesture and
  // the context stays unlocked for every later chime.
  const enableSound = useCallback(() => {
    const ctx = getContext();
    if (!ctx) return;
    ctx.resume().then(
      () => {
        setBlocked(false);
        playChime(ctx);
      },
      () => setBlocked(true),
    );
  }, [getContext]);

  useEffect(() => {
    if (!active || muted) return;

    let stopped = false;
    const ring = () => {
      if (stopped) return;
      const ctx = getContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        // Try to resume — this succeeds if the owner has clicked anywhere on
        // the page already, and fails silently if the tab was never touched.
        ctx.resume().then(
          () => {
            if (!stopped) playChime(ctx);
            setBlocked(false);
          },
          () => setBlocked(true),
        );
        return;
      }
      setBlocked(false);
      playChime(ctx);
    };

    ring();
    const id = setInterval(ring, REPEAT_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, muted, getContext]);

  // Close the context on unmount so a navigated-away page doesn't hold an
  // audio device open.
  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  return { muted, toggleMuted, blocked, enableSound };
}
