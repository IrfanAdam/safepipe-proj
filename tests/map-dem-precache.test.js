// tests/map-dem-precache.test.js — lane perf: the map warms the Terrarium DEM
// patches the twin's terrain stages read, the vector style's own MVT templates
// are warmed when the style exposes them, and every host the page talks to
// preconnects in <head>. Guards: the DEM URL is the twin's own template (no
// second host), the warm keeps the satellite warm's discipline (dedupe, stepped
// cap, hard per-trigger budget, CORS fetch), and it hangs off the EXISTING
// intent/level-crossing triggers rather than a new predicate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terrariumTileUrl, TERRARIUM_COARSE_ZOOM, TERRARIUM_MAXZOOM as DEM_MAXZOOM } from '../src/ops3d/dem.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const main = srcOf('../src/map/main.js');
const html = srcOf('../ops3d-map.html');

function block(open, close) {
  const a = main.indexOf(open);
  assert.ok(a !== -1, `${open} exists`);
  const b = main.indexOf(close, a);
  assert.ok(b > a, `${open} closes before ${close}`);
  return main.slice(a, b);
}
const demBlock = () => block('/* DEM-PRECACHE:', '/* VECTOR-TILE WARM:');
const vectorBlock = () => block('/* VECTOR-TILE WARM:', '/** Track journey velocity');

test('the DEM warm uses the twin terrain module\u2019s own tile template', () => {
  const m = main.match(/const TERRARIUM_TILE = '([^']+)'/);
  assert.ok(m, 'the Terrarium template is a named source constant');
  const template = m[1];
  assert.equal(
    template.replace('{z}', 12).replace('{x}', 2610).replace('{y}', 1547),
    terrariumTileUrl(12, 2610, 1547),
    'the map warms the exact URL src/ops3d/dem.js fetches (one host, no copy drift)',
  );
  assert.ok(demBlock().includes('TERRARIUM_TILE.replace'), 'every warmed URL comes from the constant');
  const hosts = demBlock().match(/elevation-tiles-prod/g) || [];
  assert.equal(hosts.length, 0, 'the DEM block names no host of its own (constant only)');
});

test('the DEM warm keeps the twin stage band and the Terrarium ceiling', () => {
  const coarse = main.match(/const DEM_COARSE_ZOOM = (\d+)/);
  assert.ok(coarse, 'DEM_COARSE_ZOOM is a constant, not a bare literal at a call site');
  assert.equal(+coarse[1], TERRARIUM_COARSE_ZOOM, 'it mirrors dem.js TERRARIUM_COARSE_ZOOM (the first stage)');
  const ceiling = main.match(/const TERRARIUM_MAXZOOM = (\d+)/);
  assert.ok(ceiling, 'the Terrarium ceiling is a constant');
  assert.equal(+ceiling[1], DEM_MAXZOOM, 'it mirrors dem.js TERRARIUM_MAXZOOM (z16 404s)');
  assert.ok(demBlock().includes('Math.min(TERRARIUM_MAXZOOM'), 'the warm clamps to the ceiling');
  assert.ok(demBlock().includes('if (z < DEM_COARSE_ZOOM) return;'), 'below the coarse stage no stage can read the tiles');
});

test('the DEM warm dedupes, steps its cap, and budgets per trigger', () => {
  const b = demBlock();
  assert.ok(b.includes('const demTileSeen = new Set()'), 'a warm-set dedupes URLs');
  assert.ok(b.includes('if (demTileSeen.has(url))'), 'a repeat is a hit, not a fetch');
  assert.ok(b.includes('DEM_CAP_STEPS = Object.freeze(['), 'the cap is stepped, not a bare literal');
  assert.ok(b.includes('while (demTileSeen.size > demCapNow())'), 'oldest-first eviction beyond the rung');
  assert.ok(b.includes('DEM_TRIGGER_MAX_URLS'), 'a hard per-trigger URL budget exists');
  assert.ok(b.includes('if (demTriggerAttempts >= DEM_TRIGGER_MAX_URLS) break;'), 'the budget is enforced in the loop');
  assert.ok(b.includes('function demCapNow()'), 'the cap is read through one helper');
  // The twin reads these tiles with fetch(): a no-cors <img> warm would not be
  // the cache entry its fetch reuses.
  assert.ok(b.includes("mode: 'cors'"), 'the warm is a CORS fetch, matching the twin reader');
  assert.ok(!b.includes('new Image()'), 'no image preload for the DEM (wrong cache entry)');
  assert.ok(b.includes('probe.dem.fetched'), 'the probe publishes the DEM counters');
});

test('the DEM warm hangs off the existing intent / level-crossing triggers', () => {
  const intent = block('// INTENT-PRECACHE: earliest reliable lock-intent', '// Deep warm for the dissolve:');
  assert.ok(intent.includes('prefetchDemTiles(SITE_LNGLAT, DEM_COARSE_ZOOM)'), 'intent warms the twin coarse stage');
  assert.ok(intent.includes('prefetchDemTiles(SITE_LNGLAT, TERRARIUM_MAXZOOM)'), 'intent warms the fine ceiling');
  assert.ok(intent.includes('prefetchSatTiles(SITE_LNGLAT, 11)'), 'the satellite warms are untouched');
  const deep = block('// Deep warm for the dissolve:', 'try {\n      window.__mapProbe.scrub');
  assert.ok(deep.includes('prefetchDemTiles(SITE_LNGLAT, zl)'), 'the deep band warms DEM alongside the sat levels');
  const crossing = block('} else if (crossed && intentOn', '} else {\n        prefetchSatTiles(predCenter');
  assert.ok(crossing.includes('warmDemLadder(SITE_LNGLAT, levelNow'), 'an integer crossing ladders DEM too');
  assert.ok(crossing.includes("warmSatLadder(SITE_LNGLAT, levelNow"), 'the sat ladder is untouched');
  const boot = block('// Handoff-11-A DEFECT 3: seed the sat precache', 'map.on(\'error\'');
  assert.ok(boot.includes('prefetchDemTiles(SITE_LNGLAT, DEM_COARSE_ZOOM)'), 'the journey start seeds the DEM patch');
});

test('the vector warm reads the live style templates and reports a blocker', () => {
  const b = vectorBlock();
  assert.ok(b.includes('mapRef.getStyle()'), 'it reads the LIVE style (versioned paths are never hardcoded)');
  assert.ok(b.includes("src.type !== 'vector'"), 'only vector sources are warmed');
  assert.ok(b.includes('live.tiles'), 'a url-only TileJSON source resolves its templates at runtime');
  assert.ok(b.includes('{z}') && b.includes('{x}') && b.includes('{y}'), 'only real tile templates are used');
  assert.ok(b.includes('probe.vector.blocker'), 'a style with no template records the exact blocker');
  assert.ok(b.includes("mode: 'cors'"), 'the warm matches the vector source reader');
  assert.ok(b.includes('if (liveZ > Math.ceil(Z_FADE1))'), 'no vector bytes under full satellite');
  const hold = block('/** Hold the vector style/tiles warm', '/** Scrubbed sat opacity');
  assert.ok(hold.includes('warmVectorTiles(reason)'), 'the vector hold triggers the tile warm');
});

test('every host the page talks to preconnects and dns-prefetches', () => {
  const hosts = [
    'https://server.arcgisonline.com', // Esri World Imagery (primary)
    'https://services.arcgisonline.com', // Esri World Imagery (backup)
    'https://basemaps.cartocdn.com', // CARTO style.json
    'https://tiles.basemaps.cartocdn.com', // CARTO MVT + glyphs + sprite
    'https://s3.amazonaws.com', // Terrarium DEM
  ];
  for (const h of hosts) {
    assert.ok(html.includes(`<link rel="preconnect" href="${h}"`), `${h} preconnects`);
    assert.ok(html.includes(`<link rel="dns-prefetch" href="${h}"`), `${h} dns-prefetches`);
  }
  // The preconnected hosts are the ones the source constants actually name.
  assert.ok(main.includes("'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery"), 'sat constant matches');
  assert.ok(main.includes("'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'"), 'style constant matches');
  assert.ok(main.includes("'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/"), 'DEM constant matches');
});
