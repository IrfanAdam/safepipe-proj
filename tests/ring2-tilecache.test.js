// tests/ring2-tilecache.test.js — smooth tile arrival: soft fade + tile-only SW cache.
// Pins: (1) mapbase fadeDuration is the soft ~250ms dissolve (not 0 pop-in,
// not camera easing); (2) the tile-cache URL scope is a pure allowlist of
// tile hosts ONLY (Esri imagery/reference + Terrarium S3 — never app shell,
// /src, or same-origin navigations); (3) the SW file mirrors the allowlist
// + versioned cache name and is CacheFirst; (4) boot registers it best-effort.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TILE_CACHE_NAME, TILE_URL_PREFIXES, isTileUrl } from '../src/ring2/tilecache.js';

const mapbaseSrc = readFileSync(new URL('../src/ring2/mapbase.js', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/ring2/main.js', import.meta.url), 'utf8');
const swSrc = readFileSync(new URL('../public/ring2-tile-sw.js', import.meta.url), 'utf8');

test('mapbase softens tile arrival: fadeDuration ~250ms (no instant pop-in)', () => {
  const m = mapbaseSrc.match(/fadeDuration:\s*(\d+)/);
  assert.ok(m, 'mapbase must set fadeDuration on the Map constructor');
  const ms = Number(m[1]);
  assert.ok(ms >= 100 && ms <= 500, `fadeDuration must be a soft dissolve ~250ms (got ${ms})`);
});

test('tile fade cannot re-lag the camera: sync still uses jumpTo+redraw only', () => {
  const syncSrc = readFileSync(new URL('../src/ring2/sync.js', import.meta.url), 'utf8');
  assert.ok(!/\beaseTo\b/.test(syncSrc), 'sync must not easeTo');
  assert.ok(!/\bflyTo\b/.test(syncSrc), 'sync must not flyTo');
  assert.ok(syncSrc.includes('map.redraw()'), 'forced redraw still forces the paint each moving frame');
});

test('cache name is versioned (bump invalidates all cached tiles)', () => {
  assert.match(TILE_CACHE_NAME, /^ring2-tiles-v\d+$/, 'cache name carries an explicit version');
});

test('allowlist covers every tile host mapbase uses — and nothing else', () => {
  // Every tile template in mapbase must resolve cacheable. (Tile templates
  // carry {z}/{x}/{y} — the glyphs font URL is not a satellite tile and is
  // deliberately OUT of scope: tile hosts only, per the binding spec.)
  const urls = [...mapbaseSrc.matchAll(/https:\/\/[^\s'")]+/g)].map((m) => m[0]).filter((u) => u.includes('{z}'));
  assert.ok(urls.length > 0, 'mapbase must contain tile URLs to cover');
  for (const u of urls) {
    const host = new URL(u.replace(/\{[xyz]\}/g, '0')).origin + '/';
    const covered = TILE_URL_PREFIXES.some((p) => host.startsWith(new URL(p).origin + '/'));
    assert.ok(covered, `tile host must be allowlisted: ${host}`);
  }
  // The allowlist itself holds cross-origin tile hosts ONLY.
  for (const p of TILE_URL_PREFIXES) {
    const u = new URL(p);
    assert.ok(u.protocol === 'https:', `tile prefix must be https: (got ${p})`);
    assert.ok(
      u.hostname.endsWith('arcgisonline.com') || u.hostname === 's3.amazonaws.com',
      `only Esri + Terrarium S3 hosts may be cached (got ${p})`,
    );
  }
  // Spot-checks: real tile URLs match; app shell / src / navigations never do.
  assert.ok(isTileUrl('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/2/3'));
  assert.ok(isTileUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/2/3'));
  assert.ok(isTileUrl('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/8/1/2'));
  assert.ok(isTileUrl('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/300/400.png'));
  assert.ok(!isTileUrl('/ring2-tile-sw.js'), 'SW file itself is never cached');
  assert.ok(!isTileUrl('/src/ring2/main.js'), 'app src is never cached');
  assert.ok(!isTileUrl('https://safepipe.example/ops3d-ring2.html'), 'same-origin navigations never match');
  assert.ok(!isTileUrl('https://server.arcgisonline.com/ArcGIS/rest/services/'), 'bare service root is not a tile');
  assert.ok(!isTileUrl(''), 'empty url never matches');
  assert.ok(!isTileUrl(null), 'null url never matches');
});

test('SW mirrors the allowlist + versioned name and stays dependency-free', () => {
  assert.ok(swSrc.includes(`'${TILE_CACHE_NAME}'`), 'SW must use the same versioned cache name');
  for (const p of TILE_URL_PREFIXES) {
    assert.ok(swSrc.includes(p), `SW must mirror allowlist prefix ${p}`);
  }
  assert.ok(!/\bimport\b/.test(swSrc) || /'use strict'/.test(swSrc), 'SW must not import app modules');
  assert.ok(!/addAll/.test(swSrc), 'SW must not precache an app shell (no addAll)');
  assert.ok(!/\/src\//.test(swSrc), 'SW must never reference /src');
});

test('SW is CacheFirst on tile scope and passes everything else through', () => {
  assert.ok(swSrc.includes('caches.match'), 'CacheFirst: serve from cache on hit');
  assert.ok(swSrc.includes('caches.open'), 'CacheFirst: populate the versioned cache on miss');
  assert.ok(swSrc.includes("req.mode === 'navigate'"), 'navigations pass through, never cached');
  assert.ok(swSrc.includes("req.method !== 'GET'"), 'only GET tile requests are cacheable');
  assert.ok(swSrc.includes("ring2-tiles-"), 'activate purges stale versioned tile caches');
});

test('boot registers the SW best-effort: guarded, promise-caught, boot never breaks', () => {
  const i = mainSrc.lastIndexOf('ring2-tile-sw.js');
  assert.ok(i !== -1, 'main.js must register /ring2-tile-sw.js');
  const window = mainSrc.slice(Math.max(0, i - 400), i + 200);
  assert.ok(window.includes("'serviceWorker' in navigator"), 'registration is feature-checked');
  assert.ok(window.includes('catch'), 'registration failure is swallowed, never breaks boot');
  assert.ok(/try\s*\{/.test(window), 'registration sits inside try/catch');
});
