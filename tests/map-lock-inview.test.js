// tests/map-lock-inview.test.js — in-view lock-in (owner rev: the site
// takes too long to center and drifts OUT of view while zooming in).
//
// DEFECT (measured headless, 1280x800, cursor parked at 90,710, site in view
// at 816,400): the lock armed only on `near` (cursor within 140px of the
// site OR site within 90px of centre), so a cursor sitting elsewhere vetoed
// the glide for the whole dive — the site drifted 176px -> 992px off-centre
// and out of the frame in 6 wheel ticks, `near` never true, the mask never
// armed, the settle never ran.
//
// THE FIX pinned here:
//   siteInView (scrolltrigger.js, pure) — the site projects inside the
//   viewport expanded by the near radius as margin, so the arm region is
//   continuous with `near` (no new constant, no cliff at the frame edge);
//   and the journey predicates (maskArmed, band-takeover gate + settle,
//   driver settle + enclosure + vignette, intent precache + retarget) arm on
//   near OR in-view, so the takeover claims every armed tick with the settle
//   centre and the site glides to the middle early instead of out of frame.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CENTER_SETTLE_SPAN_Z,
  centerSettleOffsetPx,
  siteInView,
} from '../src/map/scrolltrigger.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const PROX_CURSOR_PX = 140; // the near radius main.js passes as the margin
const W = 1280, H = 800;

test('siteInView: inside the frame arms, outside never does', () => {
  assert.equal(siteInView(816, 400, W, H, PROX_CURSOR_PX), true, 'the measured repro frame (816,400) is in view');
  assert.equal(siteInView(640, 400, W, H, PROX_CURSOR_PX), true, 'dead centre is in view');
  assert.equal(siteInView(0, 0, W, H, PROX_CURSOR_PX), true, 'the corner is in view');
  assert.equal(siteInView(2000, 400, W, H, PROX_CURSOR_PX), false, 'far outside never arms');
  assert.equal(siteInView(-500, -500, W, H, PROX_CURSOR_PX), false, 'far outside on any side never arms');
});

test('siteInView: the margin is continuous with near (no cliff at the edge)', () => {
  assert.equal(siteInView(W + PROX_CURSOR_PX, H / 2, W, H, PROX_CURSOR_PX), true, 'exactly at the margin arms');
  assert.equal(siteInView(W + PROX_CURSOR_PX + 0.5, H / 2, W, H, PROX_CURSOR_PX), false, 'past the margin releases');
  assert.equal(siteInView(W + 1, H / 2, W, H, 0), false, 'a zero margin is the bare frame');
  assert.equal(siteInView(W + 1, H / 2, W, H, PROX_CURSOR_PX), true, 'the near radius covers the edge');
});

test('siteInView: garbage never arms', () => {
  assert.equal(siteInView(NaN, 400, W, H, PROX_CURSOR_PX), false, 'NaN x never arms');
  assert.equal(siteInView(640, NaN, W, H, PROX_CURSOR_PX), false, 'NaN y never arms');
  assert.equal(siteInView(640, 400, 0, H, PROX_CURSOR_PX), false, 'a zero-width viewport never arms');
  assert.equal(siteInView(640, 400, W, H, -5), true, 'a negative margin falls back to the bare frame');
  assert.equal(siteInView(640, 400, W, H, NaN), true, 'an unreadable margin falls back to the bare frame');
});

test('in-view glide converges to SITE inside the span with no snap', () => {
  // The repro arm: z 7.04, site 176px off centre, cursor elsewhere. Step the
  // zoom in takeover-sized ticks (+0.2) and ride the pure offset law — the
  // same numbers the takeover writes into correctTo every tick.
  const ARM_Z = 7.04;
  const ARM_PX = 176;
  let prev = centerSettleOffsetPx(ARM_PX, ARM_Z, ARM_Z, CENTER_SETTLE_SPAN_Z);
  assert.equal(prev, ARM_PX, 'the arm frame keeps its offset');
  let z = ARM_Z;
  while (z < ARM_Z + CENTER_SETTLE_SPAN_Z - 1e-9) {
    z = Math.min(z + 0.2, ARM_Z + CENTER_SETTLE_SPAN_Z);
    const cur = centerSettleOffsetPx(ARM_PX, z, ARM_Z, CENTER_SETTLE_SPAN_Z);
    assert.ok(cur <= prev, `z ${z.toFixed(2)}: the offset never grows (${prev.toFixed(1)} -> ${cur.toFixed(1)})`);
    prev = cur;
  }
  assert.equal(centerSettleOffsetPx(ARM_PX, ARM_Z + CENTER_SETTLE_SPAN_Z, ARM_Z, CENTER_SETTLE_SPAN_Z), 0,
    'dead centre exactly at arm+span (z ~7.5 — early, not at the gate)');
  assert.equal(centerSettleOffsetPx(ARM_PX, ARM_Z + CENTER_SETTLE_SPAN_Z + 1, ARM_Z, CENTER_SETTLE_SPAN_Z), 0,
    'pinned through the rest of the dive');
  // No snap: smoothstep rests at both ends, so the first and last steps are
  // the smallest — a yank would show up here first.
  const step = 0.05;
  const first = ARM_PX - centerSettleOffsetPx(ARM_PX, ARM_Z + step, ARM_Z, CENTER_SETTLE_SPAN_Z);
  const mid = centerSettleOffsetPx(ARM_PX, ARM_Z + 0.15, ARM_Z, CENTER_SETTLE_SPAN_Z)
    - centerSettleOffsetPx(ARM_PX, ARM_Z + 0.15 + step, ARM_Z, CENTER_SETTLE_SPAN_Z);
  const last = centerSettleOffsetPx(ARM_PX, ARM_Z + CENTER_SETTLE_SPAN_Z - step, ARM_Z, CENTER_SETTLE_SPAN_Z);
  assert.ok(first < mid, 'the glide eases in (no yank off the arm)');
  assert.ok(last < mid, 'the glide eases out (no snap onto centre)');
});

test('in-view glide converges from a frame-edge arm too', () => {
  // Worst case: the arm fires with the site at the very margin edge.
  const ARM_Z = 7.04;
  const EDGE_PX = Math.hypot(W / 2 + PROX_CURSOR_PX, H / 2 + PROX_CURSOR_PX);
  assert.equal(centerSettleOffsetPx(EDGE_PX, ARM_Z + CENTER_SETTLE_SPAN_Z, ARM_Z, CENTER_SETTLE_SPAN_Z), 0,
    'even a corner arm lands dead centre inside the span');
});

test('the journey predicates arm on near OR in-view', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('function maskArmed('), 'the single zoom-anchor gate exists');
  const mask = main.slice(main.indexOf('function maskArmed('), main.indexOf('function proximityInfo('));
  assert.ok(mask.includes('prox.near || prox.inView'), 'maskArmed locks on near OR in-view');
  const prox = main.slice(main.indexOf('function proximityInfo('), main.indexOf('function noteCenterArm('));
  assert.ok(prox.includes('siteInView(pt.x, pt.y, box.w, box.h, PROX_CURSOR_PX)'), 'proximity reports in-view with the near radius as margin');
  const takeover = main.slice(main.indexOf('function installBandTakeover('), main.indexOf('function installWheelFlip('));
  assert.ok(takeover.includes('prox.near || prox.inView'), 'the takeover claims in-view ticks with the settle centre');
  assert.ok(!takeover.includes('stagedHold'), 'no dead second centre writer in the takeover');
  const dStart = main.indexOf('function onNativeZoomStep(');
  const driver = main.slice(dStart, dStart + 8000);
  assert.ok(driver.includes('(prox.near || prox.inView) && blend > 0'), 'the driver settles in-view sites, not just near ones');
});

test('the enclosure follows the lock, not just nearness', () => {
  const main = srcOf('../src/map/main.js');
  const dStart = main.indexOf('function onNativeZoomStep(');
  const driver = main.slice(dStart, dStart + 8000);
  assert.ok(driver.includes('if (proxUse.near || proxUse.inView) {'), 'the ring tracks an in-view site instead of parking');
  assert.ok(driver.includes('showVignette((proxUse.near || proxUse.inView) && blend > 0)'), 'the mask feedback follows the same predicate');
});
