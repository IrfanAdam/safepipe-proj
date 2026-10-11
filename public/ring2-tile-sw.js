/* Safepipe Ops3D Ring-2 tile Service Worker (Phase 1, tile arrival).
 * CacheFirst for satellite TILES ONLY — Esri imagery/reference + Terrarium
 * elevation, matched by URL prefix. Same-origin navigations, the app shell,
 * /src, and every other request pass straight through, never cached.
 * Mirror of src/ring2/tilecache.js (TILE_CACHE_NAME + TILE_URL_PREFIXES) —
 * keep the two in sync; tests/ring2-tilecache.test.js enforces it.
 * Dependency-free on purpose (no imports): a worker that fails to parse
 * must never break boot — registration is best-effort with try/catch.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
'use strict';

var TILE_CACHE_NAME = 'ring2-tiles-v1';
var TILE_URL_PREFIXES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/',
  'https://services.arcgisonline.com/ArcGIS/rest/services/',
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/',
];

function isTileUrl(s) {
  if (!s || typeof s !== 'string') return false;
  for (var i = 0; i < TILE_URL_PREFIXES.length; i++) {
    // Strictly longer than the prefix: the bare service root itself is not
    // a tile and must never match.
    if (s.length > TILE_URL_PREFIXES[i].length && s.indexOf(TILE_URL_PREFIXES[i]) === 0) return true;
  }
  return false;
}

self.addEventListener('install', function (event) {
  // Take over without waiting: tile caching is advisory, not versioned app code.
  event.waitUntil(Promise.resolve().then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  // Drop stale tile caches, leave every other cache (not ours) alone.
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== TILE_CACHE_NAME && k.indexOf('ring2-tiles-') === 0) return caches.delete(k);
          return Promise.resolve(false);
        }),
      );
    }).then(function () { return self.clients.claim(); }),
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  // Tile scope ONLY: non-GET, navigations, same-origin, and non-tile
  // cross-origin requests pass through untouched — never cached.
  try {
    if (!req || req.method !== 'GET') return;
    if (req.mode === 'navigate') return;
    if (!isTileUrl(req.url)) return;
  } catch (e) {
    return;
  }
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // Cache healthy tile responses only; opaque/error responses pass through.
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(TILE_CACHE_NAME).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      });
    }),
  );
});
