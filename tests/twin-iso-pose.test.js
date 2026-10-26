// tests/twin-iso-pose.test.js — iso-pose lane: the twin camera must track the
// terrain iso transform through the whole pitch ramp — same progress law,
// same anchor, zero lateral/rotational offset at every S tick — so the
// dissolve superimposes instead of throwing the twin off once the map
// turns iso. Pins the fix for the owner verdict (map enters iso -> twin
// diverges, pitch 0->45 replayed under a map held at 45).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HANDOFF_ISO_POLAR_DEG,
  poseAtIsoPolar,
  buildForwardLegs,
  poseForScrubProgress,
  fwdProgressForStagedS,
} from '../src/ring2/sector.js';
import {
  ISO_PITCH_DEG,
  Z_HANDOFF,
  HANDOFF_STAGED_S_MAX,
  pitchTargetForZoom,
  stagedIntroProgressForS,
  stagedHoldPitchForS,
  seamHoldEllipseForS,
} from '../src/map/scrolltrigger.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

const rangeOf = (eye, target) => Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z);
const polarDegOf = (eye, target) => {
  const h = Math.hypot(eye.x - target.x, eye.z - target.z);
  return (Math.atan2(h, eye.y - target.y) * 180) / Math.PI;
};
const bearingOf = (eye, target) => (
  ((-Math.atan2(eye.x - target.x, eye.z - target.z) * 180) / Math.PI % 360 + 360) % 360
);

// Synthetic staged release, post-fix shape: live hold lifted onto the iso
// pole (the release backstop), ring-iso mid + terminal at the gate scale.
const ANCHOR = { x: 1000, z: 500 };
const AZ = 0.3;
const eyeAt = (r, polarDeg) => {
  const p = (polarDeg * Math.PI) / 180;
  return {
    x: ANCHOR.x + r * Math.sin(p) * Math.sin(AZ),
    y: r * Math.cos(p),
    z: ANCHOR.z + r * Math.cos(p) * Math.cos(AZ),
  };
};
const TGT = { x: ANCHOR.x, y: 0, z: ANCHOR.z };
const R_START = 30000; // handed hold range (arrival zoom)
const R_LOCK = 25000; // gate scale (lockStagedRange)

test('iso pole identity: twin pole is the shared law value, 45deg', () => {
  assert.equal(HANDOFF_ISO_POLAR_DEG, 45);
  assert.equal(ISO_PITCH_DEG, 45);
  assert.equal(HANDOFF_ISO_POLAR_DEG, ISO_PITCH_DEG);
  assert.equal(pitchTargetForZoom(Z_HANDOFF), 45);
});

test('shared progress law: twin intro and map reveal read one S law', () => {
  for (let s = 0; s <= HANDOFF_STAGED_S_MAX; s += 25) {
    assert.equal(
      fwdProgressForStagedS(s), stagedIntroProgressForS(s),
      `S=${s}: twin intro must read the shared S law`,
    );
  }
});

test('map holds the iso pole through the whole staged band', () => {
  for (let s = 0; s <= HANDOFF_STAGED_S_MAX; s += 25) {
    assert.equal(stagedHoldPitchForS(s), 0, `S=${s}: S-owned tilt extra must be 0`);
    const mapPitch = pitchTargetForZoom(Z_HANDOFF) + stagedHoldPitchForS(s);
    assert.equal(mapPitch, 45, `S=${s}: map pitch must sit at the iso pole`);
  }
});

test('poseAtIsoPolar: polar-only lift, same target/range/bearing', () => {
  const topDown = { eye: { x: TGT.x, y: R_START, z: TGT.z + 0.01 }, target: { ...TGT } };
  const lifted = poseAtIsoPolar(topDown);
  assert.ok(lifted, 'lifts a top-down pose');
  assert.deepEqual(lifted.target, TGT, 'same anchor');
  assert.ok(Math.abs(rangeOf(lifted.eye, lifted.target) - R_START) < 1e-6, 'same range');
  assert.ok(Math.abs(polarDegOf(lifted.eye, lifted.target) - 45) < 1e-9, 'iso pole');
  assert.ok(
    Math.abs(bearingOf(lifted.eye, lifted.target) - bearingOf(topDown.eye, topDown.target)) < 1e-9,
    'same bearing',
  );
  const iso = { eye: eyeAt(R_LOCK, 45), target: { ...TGT } };
  const same = poseAtIsoPolar(iso);
  assert.ok(Math.abs(same.eye.x - iso.eye.x) < 1e-9, 'already-iso eye x unchanged');
  assert.ok(Math.abs(same.eye.y - iso.eye.y) < 1e-9, 'already-iso eye y unchanged');
  assert.ok(Math.abs(same.eye.z - iso.eye.z) < 1e-9, 'already-iso eye z unchanged');
  assert.equal(poseAtIsoPolar(null), null);
  assert.equal(poseAtIsoPolar({}), null);
  assert.equal(
    poseAtIsoPolar({ eye: { x: 1, y: 2, z: NaN }, target: { ...TGT } }), null,
    'non-finite input withholds, never a canned pose',
  );
});

test('twin-vs-mask offset ~0 at every S tick across the full ramp', () => {
  // The fixed release shape: live pose lifted to iso (backstop) + gate-scale
  // iso mid/terminal. Start range differs from the lock (range glide at a
  // fixed pole); every eye sits on one ray from the anchor, so polar,
  // bearing and lateral offset hold exactly through the sweep.
  const eps = { x: 0.01 * Math.sin(AZ), z: 0.01 * Math.cos(AZ) };
  const topDownLive = { eye: { x: TGT.x + eps.x, y: R_START, z: TGT.z + eps.z }, target: { ...TGT } };
  const startPose = poseAtIsoPolar(topDownLive, HANDOFF_ISO_POLAR_DEG);
  const legs = buildForwardLegs({
    startPose,
    mid: { eye: eyeAt(R_LOCK, 45), target: { ...TGT } },
    to: { eye: eyeAt(R_LOCK, 45), target: { ...TGT }, mix: 100 },
  });
  assert.ok(legs, 'legs build from the lifted start');
  let worstPolar = 0;
  let worstLateral = 0;
  let worstBearing = 0;
  for (let s = 0; s <= HANDOFF_STAGED_S_MAX; s += 25) {
    const pose = poseForScrubProgress(legs, fwdProgressForStagedS(s));
    assert.ok(pose, `S=${s}: scrub pose exists`);
    const pol = polarDegOf(pose.eye, pose.target);
    const lat = Math.hypot(pose.target.x - ANCHOR.x, pose.target.z - ANCHOR.z);
    const brg = Math.abs(bearingOf(pose.eye, pose.target) - bearingOf(startPose.eye, startPose.target));
    worstPolar = Math.max(worstPolar, Math.abs(pol - 45));
    worstLateral = Math.max(worstLateral, lat);
    worstBearing = Math.max(worstBearing, brg);
    assert.ok(Math.abs(pol - 45) < 1e-6, `S=${s}: twin polar ${pol} must hold 45`);
    assert.ok(lat < 1e-9, `S=${s}: lateral offset ${lat} must be 0`);
    assert.ok(brg < 1e-9, `S=${s}: bearing drift ${brg} must be 0`);
  }
  assert.ok(worstPolar < 1e-6, `worst polar dev ${worstPolar}`);
  assert.ok(worstLateral < 1e-9, `worst lateral ${worstLateral}`);
  assert.ok(worstBearing < 1e-9, `worst bearing ${worstBearing}`);
});

test('mask squash agrees with the twin pole at every S tick', () => {
  const squash = Math.cos((45 * Math.PI) / 180);
  for (let s = 0; s <= HANDOFF_STAGED_S_MAX; s += 25) {
    const seam = seamHoldEllipseForS(s);
    assert.ok(seam && seam.rx > 0, `S=${s}: seam exists`);
    assert.ok(Math.abs(seam.ry / seam.rx - squash) < 1e-12, `S=${s}: mask squash is cos45`);
  }
});

test('pre-fix shape diverges: a top-down start replays the ramp (why the lift exists)', () => {
  const stale = buildForwardLegs({
    startPose: { eye: { x: TGT.x, y: R_START, z: TGT.z + 0.01 }, target: { ...TGT } },
    mid: { eye: eyeAt(R_LOCK, 45), target: { ...TGT } },
    to: { eye: eyeAt(R_LOCK, 45), target: { ...TGT }, mix: 100 },
  });
  const p0 = poseForScrubProgress(stale, fwdProgressForStagedS(0));
  assert.ok(Math.abs(polarDegOf(p0.eye, p0.target) - 0) < 1, 'stale start sits top-down vs the iso map');
});

test('wiring: hold converges + release lifts through the shared anchor law', () => {
  const main = srcOf('../src/ring2/main.js');
  const sector = srcOf('../src/ring2/sector.js');
  assert.ok(
    main.includes('handoff.start = pinHold(s0.tx, s0.tz, s0.range, s0.bearing, HANDOFF_ISO_POLAR_DEG)'),
    'hold convergence re-pins at the iso pole (polar-only, same anchor/range/bearing)',
  );
  /* SEAM MOTION (Phase-03 rev): the iso lift + the range lock now live in
   * ONE law (sector.js stagedReleaseAnchors), which main.js calls — so the
   * release pose, the ring-iso mid and the push terminal can never be lifted
   * on different ranges (that mismatch was the visible swoop inside the
   * reveal). */
  assert.ok(
    main.includes('stagedReleaseAnchors({'),
    'staged release derives its anchors from the shared law',
  );
  assert.ok(
    sector.includes('poseAtIsoPolar(start, polar)') && sector.includes('poseAtRangePure('),
    'the shared law lifts the release pose onto the iso pole AND the locked range',
  );
  assert.ok(
    main.includes('poseAtIsoPolar, isTwinStagedMessage'),
    'iso lane appends poseAtIsoPolar to the sector import only',
  );
});
