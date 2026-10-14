// tests/map-iso-scrub.test.js — the iso tilt rides the zoom, never a timer.
// pitchTargetForZoom keys pitch 0 below Z_TOP, smooth 0..45 across the
// TOP..HANDOFF band, held at 45 above; the driver writes it straight into
// the map transform (no latch, no easeTo) so zoom-out retraces it.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pitchTargetForZoom,
  ISO_PITCH_DEG,
  Z_TOP,
  Z_HANDOFF,
} from '../src/map/scrolltrigger.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('iso target pins: 0 at/below TOP, 45 at/above HANDOFF, smooth inside', () => {
  assert.equal(ISO_PITCH_DEG, 45, 'iso tilt ends at 45deg');
  assert.equal(pitchTargetForZoom(Z_TOP), 0, 'checkpoint starts flat');
  assert.equal(pitchTargetForZoom(Z_TOP - 2), 0, 'below checkpoint stays flat');
  assert.equal(pitchTargetForZoom(Z_HANDOFF), 45, 'handoff arrives at iso');
  assert.equal(pitchTargetForZoom(Z_HANDOFF + 2), 45, 'above handoff holds iso');
  assert.equal(pitchTargetForZoom(NaN), 0, 'non-numeric parks at 0');
});

test('iso band midpoint is exactly half tilt (smoothstep symmetry)', () => {
  const mid = (Z_TOP + Z_HANDOFF) / 2;
  assert.equal(pitchTargetForZoom(mid), 22.5, 'band midpoint is 22.5deg');
});

test('iso target is monotonic non-decreasing across the journey', () => {
  let prev = -1;
  for (let z = 4; z <= 16; z += 0.25) {
    const p = pitchTargetForZoom(z);
    assert.ok(p >= prev - 1e-9, `z=${z} must not step back (${prev} -> ${p})`);
    prev = p;
  }
});

test('driver scrub: transform write present, latch ease gone', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('transform.setPitch'), 'pitch rides via transform.setPitch');
  assert.ok(!main.includes('isoBridged'), 'one-shot latch state is gone');
  assert.ok(!main.includes('pitch: 45, bearing: 0, duration: 300'), 'timed iso ease is gone');
});
