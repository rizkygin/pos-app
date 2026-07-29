// Bump this version whenever the caching logic changes. The `activate` handler
// deletes every cache that isn't the current one, so bumping it also purges
// stale entries (e.g. previously-cached pages or error responses).
const CACHE_NAME = "ulun-pesan-v5";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin only — never touch the backend API / cross-origin requests.
  if (url.origin !== self.location.origin) return;

  // Never intercept page navigations or RSC fetches. This is an auth-gated app
  // with redirects, so documents must always come from the network — otherwise
  // the SW can serve a stale/redirected page or block navigation entirely.
  if (request.mode === "navigate") return;
  if (request.headers.get("RSC") === "1") return;
  if (url.pathname.startsWith("/api/")) return;

  // Cache only immutable, public static assets (build output, icons, media).
  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:js|css|woff2?|png|jpe?g|svg|gif|webp|ico)$/.test(url.pathname);
  if (!isStaticAsset) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        // Network failed. Serve the cached copy if we have one; otherwise return
        // a real network error (NOT undefined) so the page's error boundary can
        // catch the failed chunk and recover, instead of a silent blank screen.
        const cached = await caches.match(request);
        return cached ?? Response.error();
      })
  );
});

// ── Web Push: the incoming-order alarm's background half ──
//
// The in-tab alarm (lib/use-order-alarm.ts) only rings while a dashboard tab
// is open and focused. This is what fires when the tab is closed, backgrounded,
// or the phone is locked — a real OS-level notification the push service wakes
// the browser for, delivered by the backend's sendPushToUser (lib/push.ts).
self.addEventListener("push", (event) => {
  let data = { title: "Ulun Pesan", body: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload (shouldn't happen — the backend always sends JSON) —
    // fall back to the bare title rather than dropping the notification.
  }

  const url = data.url || "/dashboard/activeorder";

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      // Full-colour brand mark shown as the notification's large icon.
      icon: "/icons/icon-192x192.png",
      // NOT the same file as `icon`: Android masks the badge by its alpha
      // channel and repaints it a flat colour for the status bar, so the opaque
      // app icon rendered as a featureless square. badge-96x96.png is the mark
      // alone, white on transparent, so the silhouette survives the mask.
      badge: "/icons/badge-96x96.png",
      // Same tag as a later push on the same topic (see orders.ts) collapses
      // them into one notification instead of stacking a dozen.
      tag: data.tag || "order",
      // Vibration is 0-effect where unsupported (desktop) and a real nudge on
      // Android — three short buzzes reads as "urgent" without being obnoxious.
      vibrate: [200, 100, 200],
      data: { url },
    })
  );
});

// Clicking the notification should focus an already-open dashboard tab rather
// than piling up a new one — a cashier PC realistically has exactly one tab.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard/activeorder";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
