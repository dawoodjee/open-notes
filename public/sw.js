/**
 * The offline shell.
 *
 * ── WHAT THIS DOES AND DOES NOT CACHE ─────────────────────────────────────
 *
 * The app SHELL only -- the HTML entry, the JS bundle, the icons and the
 * PowerSync worker with its wasm. Notes are not here and must never be: they
 * already live in the encrypted OPFS database, and a service worker cache is
 * PLAINTEXT storage readable by any script on the origin. Caching a note
 * response would quietly undo Stage 13a's whole point.
 *
 * ── WHY THE POWERSYNC ASSETS ARE LISTED EXPLICITLY ────────────────────────
 *
 * `/@powersync/worker.js` and its 1.3 MB ciphers wasm are fetched by the worker
 * itself, not by the page, so a naive "cache what the page requested" strategy
 * misses them -- and without them the database cannot open at all. An app that
 * launches offline and then cannot read its own notes is worse than one that
 * says it is offline.
 *
 * ── STRATEGY ─────────────────────────────────────────────────────────────
 *
 * Network-first for navigations, so a deployed update is picked up rather than
 * pinned forever by a cached HTML entry; cache falls in only when the network
 * fails. Cache-first for hashed static assets, which never change under a given
 * URL and are the bulk of the bytes.
 *
 * Bump CACHE_VERSION to evict everything on the next activate.
 */

const CACHE_VERSION = 'notes-shell-v1';

const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/@powersync/worker.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // `reload` so an install never re-uses a stale HTTP cache entry, and
      // allSettled so one 404 during a rename does not abort the whole install
      // and leave the app with no shell at all.
      Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
  // Take over as soon as installed rather than waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Same-origin only. A cross-origin response here would be an opaque entry
  // taking up quota and telling us nothing.
  if (url.origin !== self.location.origin) return;

  // Never touch the database. OPFS is not fetched, but be explicit so nobody
  // later adds a rule that would.
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_VERSION).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached ?? Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Only cache what actually succeeded; a cached 404 is a bug that
        // survives a redeploy.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
