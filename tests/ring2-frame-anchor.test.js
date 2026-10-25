// tests/ring2-frame-anchor.test.js — Phase 03 black-twin laws.
// Pins (1) the anchor law: a handed map frame may own the twin's anchor only
// while its center still sits over the sector, and (2) the mix-visibility
// law: a twin that is transparent BY DESIGN (mix 0) must answer "unknown",
// never "blank", or the parent's commit gate deadlocks the scrub.
//
// Measured defect these pin (gallery.html#ops3d-ring2 → ops3d-map.html
// iframe → twin iframe, 2026-10-25): the early prewarm boots the twin off the
// map's COUNTRY view (cx 10.898437, z1). frameTarget() turns that into
// x = -3276788.4 m, the range law clamps to TWIN_MAX_RANGE_M (42000 m), and
// the twin paints 30 draw calls of off-screen geometry: coverage 0,
// spread 0, contentOk false, frames counting, map idle, scene live.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_ANCHOR_REACH_M,
  TWIN_CONTENT_MIN_MIX,
  frameAnchorOnSite,
  twinContentVerdict,
} from '../src/ring2/sector.js';

// The Sangachal 'processing' sector pin (world metres, twin origin).
const PIN = { x: 400, z: -200 };
// The measured country-view anchor from the black frame.
const COUNTRY_ANCHOR = { x: -3276788.402504524, z: 5700.074329653509 };

test('frameAnchorOnSite: the site/dive anchors are on-site', () => {
  assert.equal(frameAnchorOnSite({ x: 0, z: 0 }, PIN), true, 'twin origin is over the sector');
  assert.equal(frameAnchorOnSite({ x: PIN.x, z: PIN.z }, PIN), true, 'the pin itself');
  assert.equal(frameAnchorOnSite({ x: 9000, z: 8000 }, PIN), true, 'ring-frame corner stays in reach');
});

test('frameAnchorOnSite: the measured country anchor never owns the anchor', () => {
  assert.equal(frameAnchorOnSite(COUNTRY_ANCHOR, PIN), false);
  // 3.27 Mm of standoff — the whole failure in one number.
  assert.ok(Math.hypot(COUNTRY_ANCHOR.x - PIN.x, COUNTRY_ANCHOR.z - PIN.z) > 3e6);
});

test('frameAnchorOnSite: reach is a hard edge, not a slope', () => {
  assert.equal(frameAnchorOnSite({ x: PIN.x + FRAME_ANCHOR_REACH_M, z: PIN.z }, PIN), true);
  assert.equal(frameAnchorOnSite({ x: PIN.x + FRAME_ANCHOR_REACH_M + 1, z: PIN.z }, PIN), false);
  assert.equal(frameAnchorOnSite({ x: PIN.x + 500, z: PIN.z }, PIN, 100), false);
});

test('frameAnchorOnSite: missing/garbage inputs answer false (keep the pin)', () => {
  assert.equal(frameAnchorOnSite(null, PIN), false);
  assert.equal(frameAnchorOnSite({ x: 0, z: 0 }, null), false);
  assert.equal(frameAnchorOnSite({ x: NaN, z: 0 }, PIN), false);
  assert.equal(frameAnchorOnSite({ x: 0, z: 0 }, { x: 0, z: 0 }, NaN), true, 'bad reach falls back to the law');
});

test('twinContentVerdict: a visible twin with pixels passes, a visible blank fails', () => {
  const base = { frames: 200, mapIdle: true, sceneLive: true, visible: true };
  assert.equal(twinContentVerdict({ ...base, coverage: 1, spread: 0.19 }), true);
  assert.equal(twinContentVerdict({ ...base, coverage: 0, spread: 0 }), false, 'real blank frame is refused');
});

test('twinContentVerdict: an intentionally transparent twin withholds, never lies', () => {
  const base = { frames: 200, mapIdle: true, sceneLive: true, coverage: 0, spread: 0 };
  assert.equal(twinContentVerdict({ ...base, visible: false }), null, 'mix-0 twin: unknown, not blank');
  assert.equal(TWIN_CONTENT_MIN_MIX > 0, true);
});

test('twinContentVerdict: signals not in yet withhold', () => {
  assert.equal(twinContentVerdict({ frames: 1, mapIdle: true, sceneLive: true, coverage: 1, spread: 0.2 }), null);
  assert.equal(twinContentVerdict({ frames: 200, mapIdle: false, sceneLive: true, coverage: 1, spread: 0.2 }), null);
  assert.equal(twinContentVerdict({ frames: 200, mapIdle: true, sceneLive: false, coverage: 1, spread: 0.2 }), null);
  assert.equal(twinContentVerdict({ frames: 200, mapIdle: true, sceneLive: true, coverage: null, spread: null }), null);
});
