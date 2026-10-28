// tests/ring2-staged-live-scale.test.js — the staged band's ground scale.
//
// DEFECT (owner, 2026-10-28): the twin is not exactly behind the zoomed map
// while the terrain dissolves — an offset the eye catches mid-band and that
// vanishes at both ends. The endpoints were already green because the error
// was SCALE: the twin sized the whole band from the Z_HANDOFF constant while
// the map's live zoom was still travelling (10.666 -> 11.5 across S 0..700 on
// the 1280x800 harness). At the release that put the twin's ground scale 1.78x
// inside the map's, unwinding to 1.0 only at the commit — zero at the
// boresight, 44 px at 3 km / ~110 px at the frame edge, peaking near overlay
// 0.4.
//
// THE LAW these tests pin (sector.js):
//   stagedLiveZoom — the freshest live zoom wins (the parent rides it along
//   with every staged post), the handed frame zoom is the fallback, and with
//   neither the answer is null (withhold, never a canned zoom);
//   stagedRangeLock — that zoom through frameRange (the exact inverse of the
//   map's metres-per-pixel, 512-px tile convention) and the shared orbit
//   rails, so the lock is the map's footprint projected through THIS camera.
// And the wiring: the band's scale comes from the live posted zoom on every
// tick (hold pin + staged legs), never from the gate constant.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  stagedLiveZoom,
  stagedRangeLock,
  frameRange,
  holdPolarForFrame,
} from '../src/ring2/sector.js';
import { rangeForZoom, groundResForZoom, MAP_TRUE_FOV_DEG } from '../src/ring2/sync.js';
import { Z_HANDOFF, ISO_PITCH_DEG } from '../src/map/scrolltrigger.js';

const VP = 800; // measured twin/map viewport on the align harness
const LAT = 40.201262; // Sangachal parallel
const FOV = MAP_TRUE_FOV_DEG;

const MAIN = readFileSync(new URL('../src/ring2/main.js', import.meta.url), 'utf8');

test('stagedLiveZoom: the freshest live zoom wins, the handed frame is the fallback', () => {
  // The parent posts the LIVE zoom with every staged S tick; it is the truth.
  assert.equal(stagedLiveZoom({ zStaged: 10.666, zFrame: 10.4 }), 10.666);
  assert.equal(stagedLiveZoom({ zStaged: 11.5, zFrame: 10.4 }), 11.5);
  // No staged post yet (boot / click path): the handed frame owns the scale.
  assert.equal(stagedLiveZoom({ zStaged: null, zFrame: 10.4 }), 10.4);
  assert.equal(stagedLiveZoom({ zFrame: 10.4 }), 10.4);
  // Number(null) is 0 and Number('') is 0 — neither may be read as a zoom.
  assert.equal(stagedLiveZoom({ zStaged: null, zFrame: null }), null);
  assert.equal(stagedLiveZoom({ zStaged: '', zFrame: undefined }), null);
  assert.equal(stagedLiveZoom({ zStaged: -3, zFrame: 0 }), null);
  assert.equal(stagedLiveZoom(), null, 'no input withholds');
});

test('stagedRangeLock is the map footprint projected through this camera', () => {
  const r = stagedRangeLock({ zStaged: 11.5, viewportPx: VP, lat: LAT });
  const want = rangeForZoom(11.5, LAT, { viewportPx: VP, fovDeg: FOV });
  assert.ok(Math.abs(r - want) < 1e-6, `lock ${r} must equal frameRange ${want}`);
  // frameRange is the exact inverse of the map's metres-per-pixel: projecting
  // that range back through the camera reproduces the map's ground scale.
  const mpp = groundResForZoom(11.5, LAT);
  const projected = (r * 2 * Math.tan((FOV * Math.PI) / 180 / 2)) / VP;
  assert.ok(Math.abs(projected - mpp) < 1e-9, `range ${r} must project back to ${mpp} m/px`);
});

test('the band is sized from the LIVE zoom, not the gate constant', () => {
  // The measured band: arm z 10.666, commit z 11.5 (S 0..700, 1280x800).
  const atArm = stagedRangeLock({ zStaged: 10.666, viewportPx: VP, lat: LAT });
  const atGate = stagedRangeLock({ zStaged: Z_HANDOFF, viewportPx: VP, lat: LAT });
  assert.ok(atArm > atGate, 'the arm zoom is shallower than the gate: a smaller zoom owns a WIDER range');
  // The arm range wants to be wider than the orbit rail, so it saturates; the
  // unclamped part of the travel must still be 2x per zoom level, which is the
  // 1.78x mid-band error the constant lock ignored.
  const rawArm = rangeForZoom(10.666, LAT, { viewportPx: VP, fovDeg: FOV });
  assert.ok(rawArm > atArm, 'the arm frame clamps onto the rail rather than inventing a wider orbit');
  const inner = stagedRangeLock({ zStaged: 11.0, viewportPx: VP, lat: LAT });
  const ratio = inner / atGate;
  assert.ok(Math.abs(ratio - Math.pow(2, Z_HANDOFF - 11.0)) < 1e-6,
    `inner/gate range ratio ${ratio} must be 2^dZ`);
  // Monotone in zoom: no inversion, no oscillation as the parent wheels.
  let prev = Infinity;
  for (let z = 10.4; z <= Z_HANDOFF; z += 0.05) {
    const lock = stagedRangeLock({ zStaged: z, viewportPx: VP, lat: LAT });
    assert.ok(lock <= prev + 1e-9, `deeper zoom must never widen the lock (z=${z.toFixed(2)})`);
    prev = lock;
  }
});

test('the lock stays inside the shared orbit rails', () => {
  // Extreme zooms clamp to the rails instead of inventing a camera pose.
  const wide = stagedRangeLock({ zStaged: 1, viewportPx: VP, lat: LAT });
  const wideRaw = rangeForZoom(1, LAT, { viewportPx: VP, fovDeg: FOV });
  assert.ok(wideRaw > wide, 'a country-wide frame clamps down to the rail');
  const close = stagedRangeLock({ zStaged: 22, viewportPx: VP, lat: LAT });
  const closeRaw = rangeForZoom(22, LAT, { viewportPx: VP, fovDeg: FOV });
  assert.ok(close > closeRaw, 'a street-level frame clamps up to the rail');
});

test('no zoom known means no lock (the caller keeps its anchor)', () => {
  assert.equal(stagedRangeLock({ viewportPx: VP, lat: LAT }), null);
  assert.equal(stagedRangeLock({ zStaged: NaN, zFrame: Infinity }), null);
  assert.equal(stagedRangeLock({ zStaged: 0 }), null, 'z=0 is not a frame');
});

test('the handoff still meets the iso pole at the commit zoom', () => {
  // Endpoint guard: the pole and the lock at the gate are untouched by the
  // live-scale law — the commit frame must stay exactly where it was.
  assert.equal(holdPolarForFrame({ z: Z_HANDOFF }), ISO_PITCH_DEG);
  assert.equal(holdPolarForFrame({ z: Z_HANDOFF, pitch: ISO_PITCH_DEG }), ISO_PITCH_DEG);
});

test('wiring: every staged pose is sized from the posted live zoom', () => {
  // lockStagedRange must read the staged post (stagedRangeLock), never a
  // zoom constant — the Z_HANDOFF literal is what produced the shear.
  const lock = MAIN.slice(MAIN.indexOf('function lockStagedRange'), MAIN.indexOf('function lockStagedRange') + 900);
  assert.ok(lock.includes('stagedRangeLock('), 'the lock delegates to the one pure law');
  assert.ok(lock.includes('zStaged: handoff.fwdStagedZ'), 'the lock reads the parent\'s live posted zoom');
  assert.ok(lock.includes('zFrame: handoff.frame?.z'), 'the handed frame zoom is the documented fallback');
  assert.ok(!/frameRange\(Z_HANDOFF/.test(lock), 'the gate constant no longer sizes the band');
  // The staged leg driver re-ranges the pose every tick…
  assert.ok(/const fsp = fwd\.staged \? stagedLegScale\(fs, handoff\.frame\) : fs;/.test(MAIN),
    'the swoop/push tick applies the live scale');
  assert.ok(MAIN.includes('applyFlightPose(fsp.eye, fsp.target)'), 'the live-scaled pose is the one applied');
  // …and the hold window (the overlay is S-driven, not release-gated) too.
  assert.ok(MAIN.includes('pinHold(s.tx, s.tz, rPin, s.bearing, s.polar ?? 0)'),
    'the hold pin rides the live scale as well');
  // Non-staged flights (click/autoplay intro) keep their frozen legs.
  assert.ok(/let rPin = s\.range;/.test(MAIN), 'no staged post keeps the handed range exactly');
});
