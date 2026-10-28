// tests/twin-write-dedupe.test.js — one camera writer per tick (stutter).
//
// DEFECT (owner: "transition seems a bit stuttery again"): the twin's hold
// pin and flight pose writers re-issued the same absolute camera pose EVERY
// frame — pinHold set target + position + updateControls on each hold frame
// even when the rescale inputs (staged S, viewport) had not moved, and
// applyFlightPose re-set eye + target every swoop/push/reverse frame even
// with settled progress. Each rewrite re-runs OrbitControls + damping
// against the pose they just seated: the per-tick fight that reads as
// stutter, worst exactly when the frame should be still.
//
// THE FIX pinned here:
//   poseWriteFp (sector.js, pure) — exact-render fingerprint of the
//   commanded (eye, target); the writers share one last-applied fingerprint
//   (lastCamFp) and skip the set when it matches, so a rescale is a no-op
//   when the zoom is unchanged. No epsilon: inputs are deterministic
//   functions of (S, posts, viewport), so identical inputs render
//   identically and any real change still writes. lastCamFp resets on every
//   new flight (beginHandoffFlight), so a coincidentally identical pose from
//   an older handoff still seats.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  poseWriteFp,
  poseAtRangePure,
  stagedLiveZoom,
  stagedRangeLock,
} from '../src/ring2/sector.js';

const MAIN = readFileSync(new URL('../src/ring2/main.js', import.meta.url), 'utf8');

test('poseWriteFp: same pose renders the same fingerprint', () => {
  const eye = { x: 100.5, y: 200.25, z: -50.125 };
  const target = { x: 0, y: 12.5, z: 0 };
  assert.equal(poseWriteFp(eye, target), poseWriteFp({ ...eye }, { ...target }),
    'value-identical poses match (fresh objects, same numbers)');
  assert.equal(poseWriteFp(eye, target), '100.5|200.25|-50.125|0|12.5|0', 'exact float rendering, pipe-joined');
});

test('poseWriteFp: any change flips the fingerprint (no epsilon to swallow motion)', () => {
  const eye = { x: 100.5, y: 200.25, z: -50.125 };
  const target = { x: 0, y: 12.5, z: 0 };
  const base = poseWriteFp(eye, target);
  assert.notEqual(poseWriteFp({ ...eye, x: 100.5000001 }, target), base, 'a sub-pixel eye change still writes');
  assert.notEqual(poseWriteFp(eye, { ...target, y: 12.5000001 }), base, 'a sub-pixel target change still writes');
  assert.equal(poseWriteFp({ y: 1, z: 2 }, target), null, 'a missing component never matches (writes through)');
  assert.equal(poseWriteFp(eye, null), null, 'a missing target never matches');
  assert.equal(poseWriteFp({ ...eye, x: NaN }, target), null, 'NaN never matches (writes through, never skips blind)');
  assert.equal(poseWriteFp({ ...eye, x: Infinity }, target), null, 'Infinity never matches');
});

test('the commanded pose is deterministic, so exact-match skipping is stable', () => {
  // poseAtRangePure feeds the staged rescale: same inputs must render the
  // same floats, or the fingerprint would flap and the skip would never hit.
  const pose = { eye: { x: 10, y: 20, z: 30 }, target: { x: 1, y: 2, z: 3 } };
  const a = poseAtRangePure(pose, 18000);
  const b = poseAtRangePure({ eye: { ...pose.eye }, target: { ...pose.target } }, 18000);
  assert.deepEqual(a, b, 'same inputs render the same pose');
  assert.equal(poseWriteFp(a.eye, a.target), poseWriteFp(b.eye, b.target), 'so the fingerprint is stable at rest');
  const c = poseAtRangePure(pose, 18000.5);
  assert.notEqual(poseWriteFp(c.eye, c.target), poseWriteFp(a.eye, a.target), 'and a real rescale still writes');
});

test('rescale is a no-op when the zoom is unchanged', () => {
  // The staged live-scale lock reads the freshest posted zoom: with no new
  // post and a steady frame the range is identical, so the pin has nothing
  // new to seat — this is the premise the write skip rests on.
  const a = stagedRangeLock({ zStaged: 11.2, zFrame: 10.6, viewportPx: 800, lat: 40.201262 });
  const b = stagedRangeLock({ zStaged: 11.2, zFrame: 10.6, viewportPx: 800, lat: 40.201262 });
  assert.ok(Number.isFinite(a) && a > 0, 'the lock resolves a range');
  assert.equal(a, b, 'unchanged zoom renders the identical range');
  assert.equal(stagedLiveZoom({ zStaged: 11.2, zFrame: 10.6 }), stagedLiveZoom({ zStaged: 11.2, zFrame: 10.6 }),
    'unchanged posts pick the identical zoom');
  const moved = stagedRangeLock({ zStaged: 11.4, zFrame: 10.6, viewportPx: 800, lat: 40.201262 });
  assert.notEqual(moved, a, 'a fresh post moves the range (the pin still seats real travel)');
});

test('the hold pin and the flight writer share one applied fingerprint', () => {
  assert.ok(MAIN.includes('let lastCamFp = null;'), 'one shared last-applied fingerprint exists');
  const pin = MAIN.slice(MAIN.indexOf('function pinHold('), MAIN.indexOf('/* Reverse end pin'));
  assert.ok(pin.includes('poseWriteFp(e, { x: tx, y: ty, z: tz })'), 'the hold pin fingerprints the commanded pose');
  assert.ok(pin.includes('fp !== lastCamFp'), 'the hold pin skips an identical rescale');
  const flight = MAIN.slice(MAIN.indexOf('function applyFlightPose('), MAIN.indexOf('/* FRAME-MATCH read'));
  assert.ok(flight.includes('poseWriteFp(eye, target)'), 'the flight writer fingerprints the commanded pose');
  assert.ok(flight.includes('fp !== lastCamFp'), 'the flight writer skips a settled frame');
  assert.ok(MAIN.includes('lastCamFp = null; // new flight, new anchor'), 'a new flight re-arms the fingerprint');
  // The staged-leg rescale still flows through the same writer (no bypass).
  assert.ok(/const fsp = fwd\.staged \? stagedLegScale\(fs, handoff\.frame\) : fs;/.test(MAIN),
    'the staged legs still rescale through the deduped writer');
});
