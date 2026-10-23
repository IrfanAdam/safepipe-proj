// tests/ring2-zoomsync.test.js — zoom catch-up lag regression guard.
// The satellite photo visibly trailed the twin while zooming. Root causes:
//   1. Frame order: twin.update() painted FIRST, then jumpTo ran — the map
//      painted the fresh pose on its own async rAF, exactly one frame behind.
//   2. Map-side smoothing would re-lag even a same-frame jumpTo (easeTo/flyTo
//      or tile fade). Sync must use jumpTo only; mapbase runs a soft
//      per-tile fadeDuration (250ms) — per-TILE paint dissolve, not camera
//      easing: jumpTo+redraw still force the paint synchronously, the fade
//      only softens each new tile's first frames (see mapbase.js).
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

test('applyTwinToMap forces map paint in the SAME task — resting or moving', () => {
  const log = [];
  const map = fakeMap(log);
  applyTwinToMap(map, poseAt(12000), { viewportPx: VPX, fovDeg: FOV });
  const order = log.map((e) => e.op);
  assert.deepEqual(order, ['jumpTo', 'redraw'], `redraw must follow jumpTo synchronously (got ${order})`);
});

test('authoritative re-assertion: resting pose skips the re-push, read-back still guards', () => {
  const log = [];
  const map = fakeMap(log);
  const opts = { viewportPx: VPX, fovDeg: FOV };
  applyTwinToMap(map, poseAt(12000), opts);
  log.length = 0;
  const mp = applyTwinToMap(map, poseAt(12000), opts);
  // R11-TWIN dedupe: the rest fingerprint matches the last push to the same
  // instance, so the redundant re-push + repaint are skipped — but the
  // read-back still runs, so a map-side-only nudge snaps back on the next
  // frame exactly as before (pinned by the snap-back test below).
  assert.deepEqual(
    log.map((e) => e.op),
    [],
    'resting pose must not re-push + repaint (rest fingerprint)',
  );
  assert.equal(mp.snapped, undefined, 'agreeing map must not snap-back');
});

test('snap-back: map-side drift is re-pushed with authoritative values', () => {
  const log = [];
  const pose = poseAt(12000);
  const expect = mapPoseForTwin(pose, { viewportPx: VPX, fovDeg: FOV });
  // A map that reports a drifted camera (stray gesture remnant, remount
  // default, programmatic nudge) no matter what it was told.
  const drifted = {
    getTerrain: () => ({ exaggeration: VEX }),
    jumpTo: (opts) => log.push({ op: 'jumpTo', opts }),
    redraw: () => log.push({ op: 'redraw' }),
    getCenter: () => ({ lng: expect.center[0] + 0.01, lat: expect.center[1] }),
    getZoom: () => expect.zoom,
    getBearing: () => expect.bearing,
    getPitch: () => expect.pitch,
  };
  const mp = applyTwinToMap(drifted, pose, { viewportPx: VPX, fovDeg: FOV });
  const jumps = log.filter((e) => e.op === 'jumpTo');
  assert.equal(jumps.length, 2, 'drift must trigger a snap-back re-push');
  assert.deepEqual(jumps[1].opts.center, expect.center, 'snap-back carries the twin-authoritative center');
  assert.equal(mp.snapped, true, 'snap-back must flag .snapped');
});

test('mapDisagrees: agreeing camera passes, bearing wraps on the circle', async () => {
  const { mapDisagrees } = await import('../src/ring2/sync.js');
  const pose = poseAt(12000);
  const expect = mapPoseForTwin(pose, { viewportPx: VPX, fovDeg: FOV });
  const agree = {
    getCenter: () => ({ lng: expect.center[0], lat: expect.center[1] }),
    getZoom: () => expect.zoom,
    getBearing: () => expect.bearing - 360, // wrap form agrees on the circle
    getPitch: () => expect.pitch,
  };
  assert.equal(mapDisagrees(agree, expect), false, 'agreeing camera (wrapped bearing) must pass');
  assert.equal(
    mapDisagrees({ ...agree, getZoom: () => expect.zoom + 0.5 }, expect),
    true,
    'zoom drift beyond tolerance must flag',
  );
  assert.equal(mapDisagrees({}, expect), false, 'getter-less stub can never disagree');
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
