// tests/ring2-vectors.test.js — Phase 01, Tasks 7+10 gate; Phase 02 Task 11 refresh.
// OSM pipeline: source sweep (958 elements / 10065 vtx) -> disc-clipped asset
// (counts recorded in meta) + sample projection in ring + no out-of-disc
// vertex + segment-circle split unit cases.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geoToWorld, isWithinRing } from '../src/ring2/site.js';
import {
  countFeatures, countVertices, PROVENANCE, vectorFadeAlpha,
} from '../src/ring2/vectors.js';
import { DISC_R, DISC_TOL, clipPolylineToDisc } from '../scripts/data-pipe/clip.mjs';

const asset = JSON.parse(readFileSync('public/data/sangachal-vectors.json', 'utf8'));

test('vector asset counts match the disc-clipped build (2744 / 25473)', () => {
  assert.equal(countFeatures(asset), 2744);
  assert.equal(countVertices(asset), 25473);
  // Legacy 5 layers are byte-pinned; the 7 context layers (Phase 02 Task 12)
  // are pinned here too (feature detail lives in
  // ring2-vectors-new-layers.test.js — do not duplicate it, just pin).
  assert.deepEqual(
    Object.fromEntries(
      ['roads', 'tracks', 'paths', 'coastline', 'terminal'].map((k) => [k, asset.layers[k].length]),
    ),
    { roads: 649, tracks: 46, paths: 97, coastline: 2, terminal: 89 },
  );
  assert.deepEqual(
    Object.fromEntries(
      ['arterials', 'streets', 'landuse', 'water', 'power', 'barriers', 'buildings']
        .map((k) => [k, asset.layers[k].length]),
    ),
    {
      arterials: 97, streets: 476, landuse: 167, water: 23,
      power: 4, barriers: 12, buildings: 1082,
    },
  );
  assert.equal(asset.meta.src_elements, 2592);
  assert.equal(asset.meta.src_vertices, 25319);
});

test('no asset vertex lies past the twin disc (max rr <= DISC_R + 0.11)', () => {
  let max = 0;
  for (const id of Object.keys(asset.layers)) {
    for (const f of asset.layers[id]) {
      for (const [x, z] of f.pts) {
        const rr = Math.hypot(x, z);
        if (rr > max) max = rr;
      }
    }
  }
  assert.ok(max <= DISC_R + DISC_TOL, `max rr ${max.toFixed(2)} m within disc ${DISC_R} + ${DISC_TOL}`);
  assert.equal(asset.meta.disc_r_m, DISC_R);
});

test('clipPolylineToDisc splits at crossings and drops outside runs', () => {
  // In -> out: exit point lands on the circle.
  let runs = clipPolylineToDisc([[0, 0], [20000, 0]]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].length, 2);
  assert.ok(Math.abs(runs[0][1][0] - DISC_R) < 1e-6 && Math.abs(runs[0][1][1]) < 1e-6);
  // Out -> in: entry point lands on the circle.
  runs = clipPolylineToDisc([[-20000, 0], [0, 0]]);
  assert.equal(runs.length, 1);
  assert.ok(Math.abs(runs[0][0][0] + DISC_R) < 1e-6);
  // Through: one chord across the disc.
  runs = clipPolylineToDisc([[-20000, 0], [20000, 0]]);
  assert.equal(runs.length, 1);
  assert.ok(Math.abs(runs[0][0][0] + DISC_R) < 1e-6);
  assert.ok(Math.abs(runs[0][1][0] - DISC_R) < 1e-6);
  // Fully outside: dropped.
  assert.deepEqual(clipPolylineToDisc([[15000, 15000], [16000, 16000]]), []);
  // Fully inside: untouched.
  assert.deepEqual(clipPolylineToDisc([[0, 0], [100, 0]]), [[[0, 0], [100, 0]]]);
});

test('vector rim fade is opaque in-disc, transparent at the ring', () => {
  assert.equal(vectorFadeAlpha(0), 1);
  assert.equal(vectorFadeAlpha(DISC_R), 1);
  const mid = vectorFadeAlpha((DISC_R + 10000) / 2);
  assert.ok(mid > 0 && mid < 1, `mid-band alpha ${mid}`);
  assert.equal(vectorFadeAlpha(10000), 0);
  assert.equal(vectorFadeAlpha(14000), 0);
});

test('sample road point (way 20878167) projects within the ring', () => {
  const way = asset.layers.roads.find((f) => f.id === 20878167);
  assert.ok(way, 'way 20878167 present');
  const [x, z] = way.pts[0];
  assert.ok(isWithinRing(x, z), `first vertex [${x},${z}] inside 10 km ring`);
  // Cross-check the stored projection against a live geoToWorld call.
  const g = JSON.parse(readFileSync('/tmp/phase01-roads.json', 'utf8'))
    .elements.find((e) => e.id === 20878167).geometry[0];
  const live = geoToWorld(g.lat, g.lon);
  assert.ok(Math.abs(live.x - x) < 0.1 && Math.abs(live.z - z) < 0.1);
});

test('every mounted layer carries an osm|parametric|indicated provenance tier', () => {
  // All 12 boot-mounted layers have PROVENANCE entries (Phase 02 Task 12
  // wired the 7 context layers into the mount lane).
  for (const id of Object.keys(PROVENANCE)) {
    assert.match(PROVENANCE[id] ?? '', /^(osm|parametric|indicated)$/, id);
    assert.ok(Array.isArray(asset.layers[id]), `mounted layer ${id} present in asset`);
  }
  assert.equal(Object.keys(PROVENANCE).length, 12);
});

test('new context layers mount with osm provenance and known drape lifts', async () => {
  const { PROVENANCE: PROV, LAYER_LIFT } = await import('../src/ring2/vectors.js');
  assert.deepEqual(
    Object.fromEntries(
      ['arterials', 'streets', 'landuse', 'water', 'power', 'barriers', 'buildings']
        .map((k) => [k, PROV[k]]),
    ),
    {
      arterials: 'osm', streets: 'osm', landuse: 'osm', water: 'osm',
      power: 'osm', barriers: 'osm', buildings: 'osm',
    },
  );
  assert.deepEqual(
    Object.fromEntries(
      ['arterials', 'streets', 'landuse', 'water', 'power', 'barriers', 'buildings']
        .map((k) => [k, LAYER_LIFT[k]]),
    ),
    {
      arterials: 'MAJOR', streets: 'MINOR', landuse: 'MINOR', water: 'WATER',
      power: 'MINOR', barriers: 'MINOR', buildings: 'MINOR',
    },
  );
});

test('source manifest has the ODbL entry with dates and bbox', () => {
  const m = JSON.parse(readFileSync('docs/source-manifest.json', 'utf8'));
  const e = m.datasets[0];
  assert.match(e.license, /ODbL/);
  assert.match(e.attribution, /OpenStreetMap/);
  assert.ok(e.osm_base_timestamp);
  assert.ok(e.query_bbox.includes('40.111431'));
});
