// Bump this version whenever the caching logic changes. The `activate` handler
// deletes every cache that isn't the current one, so bumping it also purges
// stale entries (e.g. previously-cached pages or error responses).
const CACHE_NAME = "ulun-pesan-v3";

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
      .catch(() => caches.match(request))
  );
});
