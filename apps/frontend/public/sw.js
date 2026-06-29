// Bump this version whenever the caching logic changes. The `activate` handler
// deletes every cache that isn't the current one, so bumping it also purges
// stale entries (e.g. previously-cached error responses).
const CACHE_NAME = "ulun-pesan-v2";

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

  // Only handle same-origin requests. Never intercept the backend API (a
  // different origin) — those are authenticated/per-user and must always hit
  // the network so we never serve one user's data (or a stale error) to another.
  if (url.origin !== self.location.origin) return;

  // Never cache API/auth routes even if same-origin.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful, same-origin ("basic") responses — never errors
        // (4xx/5xx) or opaque cross-origin responses.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
