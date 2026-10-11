// tests/ring2-zoomsync.test.js — zoom catch-up lag regression guard.
// The satellite photo visibly trailed the twin while zooming. Root causes:
//   1. Frame order: twin.update() painted FIRST, then jumpTo ran — the map
//      painted the fresh pose on its own async rAF, exactly one frame behind.
//   2. Map-side smoothing would re-lag even a same-frame jumpTo (easeTo/flyTo
//      or tile fade). Sync must use jumpTo only; mapbase runs fadeDuration 0.
// The contract pinned here: damped controls settle -> jumpTo (+ redraw while
// moving) -> twin paint, all in one frame, never easeTo/flyTo.
// [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-4]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyTwinToMap,
  mapPoseForTwin,
  zoomForRange,
  rangeForZoom,
} from '../src/ring2/sync.js';
import { VEX } from '../src/ring2/site.js';
import { MAP_TRUE_FOV_DEG } from '../src/ring2/sync.js';

const FOV = MAP_TRUE_FOV_DEG;
const VPX = 600;

function fakeMap(log) {
  return {
    getTerrain: () => ({ exaggeration: VEX }),
    jumpTo: (opts) => log.push({ op: 'jumpTo', opts }),
    redraw: () => log.push({ op: 'redraw' }),
  };
}

const poseAt = (rangeM) => ({
  eye: { x: 0, y: rangeM, z: 0.01 },
  target: { x: 0, y: 0, z: 0 },
});

test('zoom tracks twin range with no dead zone (dolly in => zoom up)', () => {
  const zFar = mapPoseForTwin(poseAt(20000), { viewportPx: VPX, fovDeg: FOV }).zoom;
  const zNear = mapPoseForTwin(poseAt(5000), { viewportPx: VPX, fovDeg: FOV }).zoom;
  assert.ok(zNear > zFar, `dolly-in must raise zoom (far ${zFar}, near ${zNear})`);
  // Halving range at nadir is ~+1 zoom (ground footprint halves).
  const zHalf = mapPoseForTwin(poseAt(10000), { viewportPx: VPX, fovDeg: FOV }).zoom;
  assert.ok(Math.abs(zHalf - zFar - 1) < 1e-9, `halving range must add ~1 zoom (got ${zHalf - zFar})`);
});

test('zoomForRange/rangeForZoom round-trip (parity math is invertible)', () => {
  for (const r of [800, 5000, 12000, 26000, 32000]) {
    const z = zoomForRange(r, undefined, { viewportPx: VPX, fovDeg: FOV });
    const back = rangeForZoom(z, undefined, { viewportPx: VPX, fovDeg: FOV });
    assert.ok(Math.abs(back - r) / r < 1e-9, `range ${r} round-trips (got ${back})`);
  }
});

test('applyTwinToMap drives the map with jumpTo only — never eased', () => {
  const log = [];
  const mp = applyTwinToMap(fakeMap(log), poseAt(12000), { viewportPx: VPX, fovDeg: FOV });
  const jumps = log.filter((e) => e.op === 'jumpTo');
  assert.equal(jumps.length, 1, 'exactly one jumpTo per sync');
  assert.deepEqual(
    Object.keys(jumps[0].opts).sort(),
    ['bearing', 'center', 'pitch', 'zoom'],
    'jumpTo carries the full camera',
  );
  assert.equal(jumps[0].opts.zoom, mp.zoom, 'applied zoom is the twin-derived zoom');
  const src = readFileSync(new URL('../src/ring2/sync.js', import.meta.url), 'utf8');
  assert.ok(!/\beaseTo\b/.test(src), 'sync.js must not easeTo (async easing re-lags zoom)');
  assert.ok(!/\bflyTo\b/.test(src), 'sync.js must not flyTo (animated flight re-lags zoom)');
  assert.ok(!/\bsetZoom\b/.test(src), 'sync.js must not setZoom (partial update splits the camera)');
});

test('applyTwinToMap forces map paint in the SAME task while moving', () => {
  const log = [];
  const map = fakeMap(log);
  applyTwinToMap(map, poseAt(12000), { viewportPx: VPX, fovDeg: FOV });
  const order = log.map((e) => e.op);
  assert.deepEqual(order, ['jumpTo', 'redraw'], `redraw must follow jumpTo synchronously (got ${order})`);
});

test('idle map keeps its own pace — no forced redraw when the pose rests', () => {
  const log = [];
  const map = fakeMap(log);
  const opts = { viewportPx: VPX, fovDeg: FOV };
  applyTwinToMap(map, poseAt(12000), opts);
  log.length = 0;
  applyTwinToMap(map, poseAt(12000), opts);
  assert.deepEqual(
    log.map((e) => e.op),
    ['jumpTo'],
    'resting pose re-applies the camera but must not force redraw',
  );
});

test('main.js frame loop is sync-first: controls -> jumpTo -> paint', () => {
  const src = readFileSync(new URL('../src/ring2/main.js', import.meta.url), 'utf8');
  const loop = src.slice(src.indexOf('const loop ='));
  const iCtl = loop.indexOf('twin.updateControls()');
  const iSync = loop.indexOf('applyTwinToMap(');
  const iPaint = loop.indexOf('twin.renderTwin()');
  assert.ok(iCtl !== -1 && iSync !== -1 && iPaint !== -1, 'loop must call all three phases');
  assert.ok(iCtl < iSync && iSync < iPaint,
    'same-frame order: damped controls settle, map jumpTo, twin paint LAST');
});
