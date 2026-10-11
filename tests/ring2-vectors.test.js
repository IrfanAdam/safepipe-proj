// tests/ring2-vectors.test.js — Phase 01, Tasks 7+10 gate.
// OSM pipeline counts (946 elements / 9859 vtx) + sample projection in ring.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geoToWorld, isWithinRing } from '../src/ring2/site.js';
import { countFeatures, countVertices, PROVENANCE } from '../src/ring2/vectors.js';

const asset = JSON.parse(readFileSync('public/data/sangachal-vectors.json', 'utf8'));

test('vector asset counts match the Overpass cache (946 / 9859)', () => {
  assert.equal(countFeatures(asset), 946);
  assert.equal(countVertices(asset), 9859);
  assert.deepEqual(
    Object.fromEntries(Object.entries(asset.layers).map(([k, v]) => [k, v.length])),
    { roads: 680, tracks: 61, paths: 113, coastline: 1, terminal: 91 },
  );
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

test('every layer carries an osm|parametric|indicated provenance tier', () => {
  for (const id of Object.keys(asset.layers)) {
    assert.match(PROVENANCE[id] ?? '', /^(osm|parametric|indicated)$/, id);
  }
});

test('source manifest has the ODbL entry with dates, bbox, counts', () => {
  const m = JSON.parse(readFileSync('docs/source-manifest.json', 'utf8'));
  const e = m.datasets[0];
  assert.match(e.license, /ODbL/);
  assert.match(e.attribution, /OpenStreetMap/);
  assert.ok(e.osm_base_timestamp);
  assert.ok(e.query_bbox.includes('40.111431'));
  assert.deepEqual(e.counts_total, { elements: 946, vertices: 9859 });
});
