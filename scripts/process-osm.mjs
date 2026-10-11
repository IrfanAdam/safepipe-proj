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
// truth — never raw lat/lon as positions) -> DISC clip (segment-circle
// intersection against the twin disc, polylines split at crossings,
// fully-outside ways dropped) -> round to 0.1 m.
//
// The AOI rect corners sit ~14.1 km from the pin while the twin disc is the
// 10 km ring line (RING_RADIUS_M) minus a 150 m inset, so AOI clamping alone
// lets outlines spill past the ring. The DISC clip is the containment fix;
// the runtime vertex-alpha fade in src/ring2/vectors.js is belt-and-braces.
// Source cache holds 946 elements / 9859 vertices; the asset holds whatever
// survives the disc (counts recorded in meta, never asserted fixed).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoToWorld, RING_RADIUS_M } from '../src/ring2/site.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Twin disc: the 10 km ring line minus a 150 m inset so draped lifts and
// oblique-parallax never cross the ring. Derived from site.js
// RING_RADIUS_M (single source of truth) — never a copied literal.
export const DISC_R = RING_RADIUS_M - 150;
// Rounding to 0.1 m can push a boundary vertex a hair past DISC_R
// (<= ~0.071 m); the pipeline asserts max rr stays within this slack.
export const DISC_TOL = 0.11;

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

/**
 * Param t values in (0,1) where segment p0->p1 crosses the circle of
 * radius R about the pin (world metres). 0, 1, or 2 entries, ascending.
 */
export function segmentCircleTs(p0, p1, R = DISC_R) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const a = dx * dx + dy * dy;
  if (a === 0) return [];
  const b = 2 * (p0[0] * dx + p0[1] * dy);
  const c = p0[0] * p0[0] + p0[1] * p0[1] - R * R;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  if (disc === 0) {
    const t = -b / (2 * a);
    return t > 0 && t < 1 ? [t] : [];
  }
  const sq = Math.sqrt(disc);
  const out = [];
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t > 0 && t < 1) out.push(t);
  }
  return out.sort((x, y) => x - y);
}

const insideDisc = (p, R) => p[0] * p[0] + p[1] * p[1] <= R * R;
const lerpPt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * Clip a world-metre polyline to the disc: split at every circle crossing,
 * return the inside runs (each >= 2 points). Fully-outside polylines yield
 * []. Split runs keep vertex order; crossings are exact (unrounded) points.
 */
export function clipPolylineToDisc(pts, R = DISC_R) {
  const runs = [];
  let cur = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const in0 = insideDisc(p0, R);
    const in1 = insideDisc(p1, R);
    if (in0 && in1) {
      if (!cur.length) cur.push(p0);
      cur.push(p1);
    } else if (in0 && !in1) {
      const ts = segmentCircleTs(p0, p1, R);
      if (!cur.length) cur.push(p0);
      cur.push(lerpPt(p0, p1, ts[0] ?? 1));
      runs.push(cur);
      cur = [];
    } else if (!in0 && in1) {
      const ts = segmentCircleTs(p0, p1, R);
      cur = [lerpPt(p0, p1, ts[0] ?? 0), p1];
    } else {
      const ts = segmentCircleTs(p0, p1, R);
      if (ts.length === 2) runs.push([lerpPt(p0, p1, ts[0]), lerpPt(p0, p1, ts[1])]);
    }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}

const r1 = (n) => Math.round(n * 10) / 10;

function processLayer(layer) {
  const raw = JSON.parse(readFileSync(SRC(layer), 'utf8'));
  const out = [];
  let srcElements = 0;
  let srcVertices = 0;
  for (const el of raw.elements ?? []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    srcElements += 1;
    srcVertices += el.geometry.length;
    const world = [];
    let clipped = false;
    for (const p of el.geometry) {
      const [lon, lat, c] = clipToAOI(p.lon, p.lat);
      clipped ||= c;
      const { x, z } = geoToWorld(lat, lon);
      world.push([x, z]);
    }
    // Disc containment: split at ring crossings, drop fully-outside runs.
    for (const run of clipPolylineToDisc(world)) {
      const f = { id: el.id, pts: run.map(([x, z]) => [r1(x), r1(z)]) };
      if (clipped) f.c = 1;
      out.push(f);
    }
  }
  return { features: out, osm3s: raw.osm3s ?? null, srcElements, srcVertices };
}

const layers = {};
let elements = 0;
let vertices = 0;
let clippedFeatures = 0;
let srcElements = 0;
let srcVertices = 0;
let maxRR = 0;
let osmBase = null;
for (const layer of LAYERS) {
  const { features, osm3s, srcElements: se, srcVertices: sv } = processLayer(layer);
  layers[layer] = features;
  srcElements += se;
  srcVertices += sv;
  osmBase ??= osm3s?.timestamp_osm_base ?? null;
  for (const f of features) {
    elements += 1;
    vertices += f.pts.length;
    if (f.c) clippedFeatures += 1;
    for (const [x, z] of f.pts) {
      const rr = Math.hypot(x, z);
      if (rr > maxRR) maxRR = rr;
    }
  }
}

if (maxRR > DISC_R + DISC_TOL) {
  console.error(`DISC OVERFLOW: max rr ${maxRR.toFixed(2)} m > DISC_R ${DISC_R} + ${DISC_TOL}`);
  process.exit(1);
}

const asset = {
  meta: {
    site: { lat: 40.201262, lon: 49.48127 },
    aoi: { ...AOI },
    disc_r_m: DISC_R,
    ring_r_m: RING_RADIUS_M,
    crs: 'EPSG:4326',
    units: 'metres (world: +x east, +z south of site pin)',
    precision_m: 0.1,
    elements,
    vertices,
    clippedFeatures,
    src_elements: srcElements,
    src_vertices: srcVertices,
    max_rr_m: Math.round(maxRR * 10) / 10,
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
        `clip every segment to the twin disc (DISC_R = RING_RADIUS_M - 150 = ${DISC_R} m; split at crossings, drop fully-outside runs)`,
        'round to 0.1 m, emit compact JSON public/data/sangachal-vectors.json',
      ],
      limitations: [
        `${srcElements} source ways / ${srcVertices} source vertices; ${srcElements - elements} fully-outside-disc ways dropped, split ways emit one feature per inside run (flagged c:1 when AOI-clamped)`,
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

console.log(`elements=${elements} vertices=${vertices} clipped=${clippedFeatures} src=${srcElements}/${srcVertices} max_rr=${maxRR.toFixed(1)} osm_base=${osmBase}`);
