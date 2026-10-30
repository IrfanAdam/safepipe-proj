// tests/ring2-seam-release.test.js — the seam's MOTION half.
// The sat->twin dissolve opens over a map held at the gate (static, one
// ground scale). These tests pin the two laws that used to move the twin
// under the eye while it dissolved:
//   1. stagedReleaseAnchors: release pose + ring-iso mid + push terminal all
//      sit on the map's locked range, so the swoop carries ZERO scale travel
//      (the old build slid 34.8 km -> 24.8 km at 13-40% overlay opacity).
//   2. the commit lands on the pose the scrub law ENDS on — never on a
//      stale boot terminal, which was a measured 24.8 -> 18.0 km one-frame
//      pop at the exact seam frame. The terminal itself now rides the SAME
//      handoff range as the mid (sector.js handoffRangeForFrame), so there is
//      no scale step left to snap to.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stagedReleaseAnchors, poseAtRangePure, poseAtIsoPolar, buildForwardLegs,
  poseForScrubProgress, handoffRangeForFrame, terminalPoseForAnchor,
  HANDOFF_ISO_POLAR_DEG,
} from '../src/ring2/sector.js';

// ONE handoff range, derived from the handed gate frame at an 800 px viewport
// (the retired constant-metre terminal is a fixture value below, used only to
// prove the lift/commit laws would still catch a divergent anchor).
const GATE = { cx: 49.48127, cy: 40.201262, z: 11.5, bearing: 0, pitch: 45 };
const R_LOCK = handoffRangeForFrame(GATE, { viewportPx: 800 });
const R_STALE = 18000;  // fixture: a stale constant-metre anchor
const dist = (p) => Math.hypot(p.eye.x - p.target.x, p.eye.y - p.target.y, p.eye.z - p.target.z);
const polar = (p) => (Math.atan2(Math.hypot(p.eye.x - p.target.x, p.eye.z - p.target.z), p.eye.y - p.target.y) * 180) / Math.PI;

/** A pose at `range` looking at (tx,ty,tz) from bearing 0 at `polarDeg`. */
function poseAt(tx, ty, tz, range, polarDeg) {
  const p = (polarDeg * Math.PI) / 180;
  return { eye: { x: tx, y: ty + range * Math.cos(p), z: tz + range * Math.sin(p) }, target: { x: tx, y: ty, z: tz } };
}

test('stagedReleaseAnchors lifts every anchor onto the locked gate range', () => {
  // The lagging live pose: the boot/retarget pin never converged onto the
  // arrival frame (the measured 34.8 km start), and the ring-iso mid is at
  // the handed range while the terminal is still the boot 18 km.
  const live = poseAt(0, 0, 0, 34786, 0);           // top-down, stale pin
  const mid = poseAt(0, 0, 0, R_LOCK, HANDOFF_ISO_POLAR_DEG);
  const to = poseAt(0, 0, 0, R_STALE, HANDOFF_ISO_POLAR_DEG);
  const locked = stagedReleaseAnchors({ startPose: live, mid, to, range: R_LOCK });
  assert.ok(locked, 'anchors derive');
  assert.equal(locked.range, R_LOCK);
  for (const k of ['start', 'mid', 'to']) {
    assert.ok(Math.abs(dist(locked[k]) - R_LOCK) < 1e-6, `${k} range ${dist(locked[k])}`);
  }
  // The release pose also lands on the iso pole — the map is held at 45.
  assert.ok(Math.abs(polar(locked.start) - HANDOFF_ISO_POLAR_DEG) < 1e-6, `start polar ${polar(locked.start)}`);
  // ... and the start is where the mid is (same ground scale, same anchor):
  // the swoop leg carries no scale travel at all.
  assert.ok(Math.abs(dist(locked.start) - dist(locked.mid)) < 1e-6);
});

test('the forward legs carry zero scale travel through the visible band', () => {
  const live = poseAt(0, 0, 0, 34786, 0);
  const mid = poseAt(0, 0, 0, R_LOCK, HANDOFF_ISO_POLAR_DEG);
  const to = poseAt(0, 0, 0, R_STALE, HANDOFF_ISO_POLAR_DEG);
  const locked = stagedReleaseAnchors({ startPose: live, mid, to, range: R_LOCK });
  const legs = buildForwardLegs({ startPose: locked.start, mid: locked.mid, to: locked.to });
  assert.ok(legs && legs.length, 'legs build');
  // Sample the scrub law across the whole reveal: the ground scale must not
  // move (the old build changed 1.4x inside it).
  const ranges = [];
  for (let i = 0; i <= 20; i++) {
    const s = poseForScrubProgress(legs, i / 20);
    assert.ok(s, `pose at ${i / 20}`);
    ranges.push(dist(s));
  }
  const dev = Math.max(...ranges) - Math.min(...ranges);
  assert.ok(dev < 1e-6, `scale travel ${dev} m across the band`);
});

test('the commit pose is the scrub law terminal, not a stale anchor', () => {
  const locked = stagedReleaseAnchors({
    startPose: poseAt(0, 0, 0, R_LOCK, HANDOFF_ISO_POLAR_DEG),
    mid: poseAt(0, 0, 0, R_LOCK, HANDOFF_ISO_POLAR_DEG),
    to: poseAt(0, 0, 0, R_STALE, HANDOFF_ISO_POLAR_DEG),
    range: R_LOCK,
  });
  const legs = buildForwardLegs({ startPose: locked.start, mid: locked.mid, to: locked.to });
  const end = poseForScrubProgress(legs, 1);
  // What the commit must use (fs at progress 1) ...
  assert.ok(Math.abs(dist(end) - R_LOCK) < 1e-6, `commit range ${dist(end)}`);
  // ... against the stale terminal the old code snapped to.
  const unlockedTerminal = poseAt(0, 0, 0, R_STALE, HANDOFF_ISO_POLAR_DEG);
  assert.ok(Math.abs(dist(end) - dist(unlockedTerminal)) > 1000, 'the two differ — the law must pick the legs');
  // The last frame of the dissolve and the first frame after it are the SAME
  // pose: no one-frame scale jump at the seam.
  const nearEnd = poseForScrubProgress(legs, 0.999);
  assert.ok(Math.abs(dist(nearEnd) - dist(end)) < 1e-6);
});

test('stagedReleaseAnchors refuses to invent a lock', () => {
  const mid = poseAt(0, 0, 0, R_LOCK, HANDOFF_ISO_POLAR_DEG);
  assert.equal(stagedReleaseAnchors({ startPose: mid, mid, to: mid, range: NaN }), null);
  assert.equal(stagedReleaseAnchors({ startPose: mid, mid, to: mid, range: 0 }), null);
  assert.equal(stagedReleaseAnchors({ startPose: mid, mid: null, to: mid, range: R_LOCK }), null);
  // A missing start/terminal falls back to the mid — never a canned pose.
  const only = stagedReleaseAnchors({ mid, range: R_LOCK });
  assert.ok(only && only.start === null);
  assert.ok(Math.abs(dist(only.to) - R_LOCK) < 1e-6);
});

test('poseAtRangePure keeps bearing/polar and is idempotent', () => {
  const p = poseAt(100, 5, -50, 30000, 30);
  const q = poseAtRangePure(p, R_LOCK);
  assert.ok(Math.abs(dist(q) - R_LOCK) < 1e-6);
  assert.ok(Math.abs(polar(q) - polar(p)) < 1e-9, 'polar preserved');
  assert.deepEqual(q.target, p.target);
  assert.deepEqual(poseAtRangePure(q, R_LOCK).eye, q.eye);
  // Non-finite range never moves the camera.
  assert.equal(poseAtRangePure(p, NaN), p);
  assert.equal(poseAtRangePure(p, -1), p);
});

test('poseAtIsoPolar on a top-down pose keeps the anchor and the range', () => {
  const top = poseAt(10, 0, 20, R_LOCK, 0);
  const iso = poseAtIsoPolar(top, HANDOFF_ISO_POLAR_DEG);
  assert.ok(iso, 'derives');
  assert.ok(Math.abs(dist(iso) - R_LOCK) < 1e-6);
  assert.ok(Math.abs(polar(iso) - HANDOFF_ISO_POLAR_DEG) < 1e-6);
  assert.deepEqual(iso.target, top.target);
});

test('the terminal the refit builds rides the locked gate range (no commit step)', () => {
  const term = terminalPoseForAnchor(0, 0, 0, 0, R_LOCK);
  assert.ok(term && term.eye && term.target, 'terminal builds on the gate range');
  assert.ok(Math.abs(dist(term) - R_LOCK) < 1e-6, `terminal range ${dist(term)}`);
  assert.equal(term.mix, 100);
  // A terminal without a range is refused — no constant-metre fallback.
  assert.equal(terminalPoseForAnchor(0, 0, 0, 0), null);
});
