'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '@/lib/api-url';

export type PushState =
  | 'unsupported' // no ServiceWorker/PushManager in this browser
  | 'unconfigured' // browser is fine, backend has no VAPID key set
  | 'default' // never asked
  | 'denied' // user said no — browser will not prompt again
  | 'subscribed'
  | 'unsubscribed'; // permission granted, but not subscribed on this device

// atob(base64url) needs standard base64 with padding restored — the VAPID key
// comes from the backend URL-safe (no +, /, or trailing =).
function urlBase64ToUint8Array(base64Url: string) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Registers this device for background order alerts (see public/sw.js +
 * apps/backend/src/lib/push.ts). Distinct from the in-tab chime in
 * use-order-alarm.ts, which only works while a dashboard tab is open — this is
 * what lets an owner get notified with the tab closed or the phone locked.
 */
export function usePushSubscription() {
  const [state, setState] = useState<PushState>('default');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    if (Notification.permission === 'default') {
      setState('default');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? 'subscribed' : 'unsubscribed');
    } catch {
      setState('unsubscribed');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const subscribe = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unsupported');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'default');
        return;
      }

      const keyRes = await fetch(`${API_URL}/api/push/public-key`);
      const keyData = await keyRes.json().catch(() => null);
      if (!keyData?.success || !keyData.publicKey) {
        setState('unconfigured');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true, // required by Chrome: every push must show a notification
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        });
      }

      const json = sub.toJSON();
      const res = await fetch(`${API_URL}/api/push/subscribe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
        }),
      });
      if (!res.ok) throw new Error('subscribe failed');

      setState('subscribed');
    } catch {
      setState('unsubscribed');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const unsubscribe = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        // Best-effort: if this fails, the row is still harmless — sends to a
        // browser-revoked endpoint 404/410 and get pruned server-side anyway.
        fetch(`${API_URL}/api/push/unsubscribe`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      setState('unsubscribed');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const sendTest = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/push/test`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  }, []);

  return { state, busy, subscribe, unsubscribe, sendTest };
}
