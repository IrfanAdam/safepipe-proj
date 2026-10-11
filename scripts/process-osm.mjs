// scripts/process-osm.mjs — Phase 01 Tasks 7,10: Overpass cache -> compact browser vectors.
//
// Reads the read-only cached Overpass responses (/tmp/phase01-*.json,
// Overpass JSON with `geometry` per way — never moved, never mutated) and
// emits:
//   public/data/sangachal-vectors.json  compact world-space polylines for the twin
//   docs/source-manifest.json           ODbL source entry (dates, bbox, counts)
//
// Pipeline per way: AOI clip (clamp out-of-range vertices to the AOI rect,
// flag `c:1`) -> geoToWorld project (src/ring2/site.js, single source of
// truth — never raw lat/lon as positions) -> round to 0.1 m.
// Element + vertex counts are preserved exactly (946 / 9859).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoToWorld } from '../src/ring2/site.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Area of interest (delegation brief): S40.111431 N40.291093 W49.363656 E49.598884.
export const AOI = Object.freeze({
  S: 40.111431, N: 40.291093, W: 49.363656, E: 49.598884,
});

const LAYERS = ['roads', 'tracks', 'paths', 'coastline', 'terminal'];
const SRC = (layer) => `/tmp/phase01-${layer}.json`;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Clip a lon/lat point to the AOI rect. Returns [lon, lat, clippedBool]. */
export function clipToAOI(lon, lat) {
  const cLon = clamp(lon, AOI.W, AOI.E);
  const cLat = clamp(lat, AOI.S, AOI.N);
  return [cLon, cLat, cLon !== lon || cLat !== lat];
}

const r1 = (n) => Math.round(n * 10) / 10;

function processLayer(layer) {
  const raw = JSON.parse(readFileSync(SRC(layer), 'utf8'));
  const out = [];
  for (const el of raw.elements ?? []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const pts = [];
    let clipped = false;
    for (const p of el.geometry) {
      const [lon, lat, c] = clipToAOI(p.lon, p.lat);
      clipped ||= c;
      const { x, z } = geoToWorld(lat, lon);
      pts.push([r1(x), r1(z)]);
    }
    const f = { id: el.id, pts };
    if (clipped) f.c = 1;
    if (el.tags && layer === 'terminal') f.tags = el.tags;
    out.push(f);
  }
  return { features: out, osm3s: raw.osm3s ?? null };
}

const layers = {};
let elements = 0;
let vertices = 0;
let clippedFeatures = 0;
let osmBase = null;
for (const layer of LAYERS) {
  const { features, osm3s } = processLayer(layer);
  layers[layer] = features;
  osmBase ??= osm3s?.timestamp_osm_base ?? null;
  for (const f of features) {
    elements += 1;
    vertices += f.pts.length;
    if (f.c) clippedFeatures += 1;
  }
}

const asset = {
  meta: {
    site: { lat: 40.201262, lon: 49.48127 },
    aoi: { ...AOI },
    crs: 'EPSG:4326',
    units: 'metres (world: +x east, +z south of site pin)',
    precision_m: 0.1,
    elements,
    vertices,
    clippedFeatures,
   license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
  },
  layers,
};

mkdirSync(join(ROOT, 'public', 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'public', 'data', 'sangachal-vectors.json'),
  JSON.stringify(asset),
);

const counts = Object.fromEntries(
  LAYERS.map((l) => [l, {
    elements: layers[l].length,
    vertices: layers[l].reduce((n, f) => n + f.pts.length, 0),
  }]),
);

const manifest = {
  generated: new Date().toISOString(),
  datasets: [
    {
      name: 'OpenStreetMap Sangachal AOI vectors (roads/tracks/paths/coastline/terminal)',
      source: 'Overpass API (https://overpass-turbo.eu/, api overpass-api.de)',
      query_bbox: 'S40.111431 N40.291093 W49.363656 E49.598884',
      osm_base_timestamp: osmBase,
      processed: new Date().toISOString().slice(0, 10),
      crs: 'EPSG:4326',
      units: 'degrees in, metres out',
      resolution: 'vector (node geometry as returned by Overpass)',
      license: 'Open Database License (ODbL) 1.0 — https://opendatacommons.org/licenses/odbl/',
      attribution: '© OpenStreetMap contributors',
      counts,
      counts_total: { elements, vertices },
      steps: [
        'read cached Overpass JSON (/tmp/phase01-<layer>.json, geometry per way)',
        'clip each vertex to AOI rect (clamp + clipped flag, features preserved)',
        'project lon/lat -> world metres via src/ring2/site.js geoToWorld',
        'round to 0.1 m, emit compact JSON public/data/sangachal-vectors.json',
      ],
      limitations: [
        '33 of 946 features extend past the AOI edge; edge vertices are clamped to the AOI rect (flagged c:1), not surveyed continuations',
        'terminal layer carries OSM tags only — no verified facility layout (binding spec §1A: ESIA layout is historical)',
        'no elevation in source; twin drape samples the DEM field at render time',
      ],
    },
  ],
};

mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(
  join(ROOT, 'docs', 'source-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`elements=${elements} vertices=${vertices} clipped=${clippedFeatures} osm_base=${osmBase}`);
if (elements !== 946 || vertices !== 9859) {
  console.error(`COUNT MISMATCH: expected 946 elements / 9859 vertices`);
  process.exit(1);
}
