/**
 * The offline shell.
 *
 * ── WHAT THIS CACHES, AND WHAT IT MUST NEVER ──────────────────────────────
 *
 * The app SHELL only. Notes are not here and must never be: they live in the
 * encrypted OPFS database, and a service worker cache is PLAINTEXT storage
 * readable by any script on the origin. Caching a note response would quietly
 * undo Stage 13a's whole point.
 *
 * ── WHY THE ASSET LIST IS GENERATED, NOT WRITTEN HERE ─────────────────────
 *
 * The first version precached only the paths a human can name -- `/`, the
 * manifest, the icons, the PowerSync worker -- and relied on cache-first to
 * pick up everything else "as it is requested". That does not work, and Adam's
 * test found it immediately: **install, go offline, reload -> blank screen.**
 *
 * A service worker installs DURING the first page load and does not control
 * that page. So the very requests that matter -- the hashed
 * `_expo/static/js/web/*.js` bundles -- are fetched before the worker exists
 * and are never seen by it. Nothing cached them, and the reload had no bundle
 * to run: the HTML came back from cache (hence a blank page rather than no
 * page) and every script under it failed.
 *
 * Their names contain content hashes, so they cannot be listed by hand either.
 * `scripts/inject-pwa-head.ts` therefore walks `dist/` after the export and
 * writes the real list into the line below.
 *
 * ── AND WHY A FAILED FETCH MUST NOT REJECT ────────────────────────────────
 *
 * `event.respondWith(p)` where `p` rejects produces a network error, not a
 * fallback -- the browser is left with nothing. Offline, `fetch()` rejects for
 * anything uncached, which is exactly what Adam's console showed:
 *
 *   The FetchEvent for "…/entry-….js" resulted in a network error response:
 *   the promise was rejected.
 *
 * So every path below resolves to a Response, even a synthetic one. An honest
 * 504 is debuggable; a rejected promise is a blank screen.
 */

/** Replaced at build time. The literal below is the dev-server fallback. */
const BUILD_ASSETS = ['/'];
/** Replaced at build time with a per-build stamp, so a deploy evicts the old cache. */
const CACHE_VERSION = 'notes-shell-dev';

/**
 * Paths that must be cached even though nothing on the page requests them.
 *
 * The PowerSync worker fetches its own wasm, so those requests never pass
 * through the page and a "cache what the page asked for" strategy misses them.
 * Without them the app launches offline and then cannot open its database,
 * which is worse than saying it is offline.
 */
const ALWAYS = ['/', '/manifest.webmanifest', '/@powersync/worker.js'];

self.addEventListener('install', (event) => {
  const urls = [...new Set([...ALWAYS, ...BUILD_ASSETS])];
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // `reload` so an install never re-uses a stale HTTP cache entry, and
      // allSettled so one 404 during a rename cannot abort the whole install
      // and leave the app with no shell at all.
      Promise.allSettled(urls.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/** Never reject. See the header. */
function offlineResponse() {
  return new Response('Offline and not cached.', {
    status: 504,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain' },
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Same-origin only. A cross-origin response would be an opaque entry taking
  // up quota and telling us nothing.
  if (url.origin !== self.location.origin) return;

  // Never touch the API. Be explicit so nobody later adds a rule that would.
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    // Network-first, so a deployed update is picked up rather than pinned
    // forever by a cached HTML entry.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_VERSION).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached ?? offlineResponse()))
    );
    return;
  }

  // Cache-first for everything else: hashed assets never change under a given
  // URL, and they are the bulk of the bytes.
  event.respondWith(
    caches
      .match(request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            // Only cache what actually succeeded; a cached 404 is a bug that
            // survives a redeploy.
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => offlineResponse());
      })
      .catch(() => offlineResponse())
  );
});
