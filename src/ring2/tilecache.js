/* Safepipe Ops3D Ring-2 — src/ring2/tilecache.js (Phase 1, tile arrival).
 * Single source of truth for the satellite tile cache scope: versioned
 * cache name + the tile-host URL prefix allowlist. Pure and
 * dependency-free (no maplibre, no DOM) so node --test can pin it.
 * The Service Worker (public/ring2-tile-sw.js) mirrors this list — keep
 * the two in sync; tests/ring2-tilecache.test.js enforces it.
 * NEVER cache the app shell, /src, or same-origin navigations: the
 * allowlist holds cross-origin tile hosts ONLY.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */

/** Versioned tile-cache name. Bump v1 -> v2 (etc.) to invalidate all cached tiles. */
export const TILE_CACHE_NAME = 'ring2-tiles-v1';

/* Tile hosts ONLY: Esri imagery + reference and Terrarium elevation.
 * Full service-path prefixes so a same-host non-tile URL can never match. */
export const TILE_URL_PREFIXES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/',
  'https://services.arcgisonline.com/ArcGIS/rest/services/',
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/',
];

/** True when url (string or URL) is a cacheable satellite tile request. */
export function isTileUrl(url) {
  let s = '';
  try {
    s = typeof url === 'string' ? url : url?.href ?? String(url);
  } catch {
    return false;
  }
  if (!s || typeof s !== 'string') return false;
  for (const p of TILE_URL_PREFIXES) {
    // Strictly longer than the prefix: the bare service root itself is not
    // a tile and must never match.
    if (s.length > p.length && s.startsWith(p)) return true;
  }
  return false;
}
