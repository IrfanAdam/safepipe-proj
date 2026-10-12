// tests/ring2-vectors-far-context.test.js — far-context arterials gate.
// Regional motorway/trunk/primary ways (extended NW bbox, classified
// only) ride in the boot asset as far_context: clamped to FAR_BBOX,
// clipped to the 25 km ring, mounted muted + strongly faded.
// Pins: live-fetch counts (2026-10-12), 25 km containment with 10 km
// overshoot proof, fade-curve shape, mount wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RING_RADIUS_M } from '../src/ring2/site.js';
import {
  FAR_R, FAR_MAX_ALPHA, farContextFadeAlpha, PROVENANCE, LAYER_LIFT,
  mountVectors,
} from '../src/ring2/vectors.js';
import { FAR_R as PIPE_FAR_R, FAR_TOL, DISC_R } from '../scripts/data-pipe/clip.mjs';
import { classifyFar } from '../scripts/data-pipe/classify.mjs';

const asset = JSON.parse(readFileSync('public/data/sangachal-vectors.json', 'utf8'));

test('far_context matches the live far sweep (10 features / 117 vertices)', () => {
  assert.equal(asset.layers.far_context.length, 10);
  assert.equal(asset.meta.far_src, 10);
  const vtx = asset.layers.far_context.reduce((n, f) => n + f.pts.length, 0);
  assert.equal(vtx, 117);
  for (const f of asset.layers.far_context) {
    assert.ok(typeof f.id === 'number' && Array.isArray(f.pts) && f.pts.length >= 2, `id=${f?.id} well-formed`);
  }
});

test('far_context stays inside the 25 km ring and reaches past the 10 km ring', () => {
  let max = 0;
  for (const f of asset.layers.far_context) {
    for (const [x, z] of f.pts) {
      assert.ok(Number.isFinite(x) && Number.isFinite(z), `id=${f.id} finite`);
      const rr = Math.hypot(x, z);
      if (rr > max) max = rr;
    }
  }
  assert.ok(max <= FAR_R + FAR_TOL, `max far rr ${max.toFixed(2)} m within 25 km ring`);
  assert.ok(max > RING_RADIUS_M, `max far rr ${max.toFixed(0)} m proves extension past 10 km`);
  assert.equal(asset.meta.far_r_m, FAR_R);
  assert.equal(asset.meta.far_r_m, PIPE_FAR_R);
  assert.ok(Math.abs(asset.meta.max_far_rr_m - Math.round(max * 10) / 10) < 0.2);
});

test('far meta carries bbox + fetch provenance for the manifest lane', () => {
  assert.deepEqual(asset.meta.far_bbox, { S: 40.111431, N: 40.45, W: 49.25, E: 49.598884 });
  assert.ok(asset.meta.far_osm_base_timestamp, 'far osm_base present');
  assert.ok(asset.meta.far_fetched, 'far fetch date present');
  assert.deepEqual(asset.meta.far_out_of_scope, {});
});

test('far fade is capped muted, flat to the ring, gone at 25 km', () => {
  assert.equal(FAR_MAX_ALPHA, 0.45);
  assert.equal(farContextFadeAlpha(0), FAR_MAX_ALPHA);
  assert.equal(farContextFadeAlpha(DISC_R), FAR_MAX_ALPHA);
  assert.equal(farContextFadeAlpha(RING_RADIUS_M), FAR_MAX_ALPHA);
  const mid = farContextFadeAlpha((RING_RADIUS_M + FAR_R) / 2);
  assert.ok(mid > 0 && mid < FAR_MAX_ALPHA, `mid-band alpha ${mid}`);
  assert.equal(farContextFadeAlpha(FAR_R), 0);
  assert.equal(farContextFadeAlpha(FAR_R + 5000), 0);
  // Monotone fade past the ring — never brightens with distance.
  let prev = FAR_MAX_ALPHA;
  for (let rr = RING_RADIUS_M; rr <= FAR_R; rr += 1000) {
    const a = farContextFadeAlpha(rr);
    assert.ok(a <= prev + 1e-12, `fade monotone at ${rr}: ${a} <= ${prev}`);
    prev = a;
  }
});

test('far_context mounts muted with osm provenance and a MINOR lift', async () => {
  assert.equal(PROVENANCE.far_context, 'osm');
  assert.equal(LAYER_LIFT.far_context, 'MINOR');
  const fakeScene = () => ({ children: [], add(o) { this.children.push(o); } });
  const scene = fakeScene();
  const h = await mountVectors(scene, {
    layers: { far_context: [{ id: 9, pts: [[0, 0], [0, -12000], [0, -20000]] }] },
  });
  const seg = h.group.children.find((o) => o.name === 'vectors:far_context');
  assert.ok(seg, 'far_context LineSegments mounted');
  assert.equal(seg.userData.provenance, 'osm');
  assert.equal(seg.geometry.userData.lift, 2); // DRAPE_LIFTS.MINOR
  const col = seg.geometry.getAttribute('color');
  let maxA = 0;
  let minA = 1;
  for (let i = 0; i < col.count; i++) {
    const a = col.array[i * 4 + 3];
    if (a > maxA) maxA = a;
    if (a < minA) minA = a;
  }
  assert.ok(maxA <= FAR_MAX_ALPHA + 1e-6, `far vertex alpha capped at ${FAR_MAX_ALPHA}, got ${maxA}`);
  assert.ok(minA < maxA, 'beyond-ring vertices fade below the cap');
});

test('classifyFar assigns arterials-only and dedups main-sweep ids', () => {
  const geom = [{ lon: 49.4, lat: 40.3 }];
  const els = [
    { type: 'way', id: 1, tags: { highway: 'motorway' }, geometry: geom },
    { type: 'way', id: 2, tags: { highway: 'trunk' }, geometry: geom },
    { type: 'way', id: 3, tags: { highway: 'primary' }, geometry: geom },
    { type: 'way', id: 4, tags: { highway: 'secondary' }, geometry: geom },
    { type: 'way', id: 5, tags: { highway: 'motorway' }, geometry: geom },
    { type: 'node', id: 6 },
  ];
  const out = classifyFar(els, new Set([5]));
  assert.deepEqual(out.layers.far_context.map((e) => e.id), [1, 2, 3]);
  assert.equal(out.dups, 1);
  assert.equal(out.skippedNonWay, 1);
  assert.deepEqual(out.outOfScope, { 'highway=secondary': 1 });
});
