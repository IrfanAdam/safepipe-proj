// tests/map-gesture-handover.test.js — LANE-GESTURE: the wheel handover is
// seamless in BOTH directions, with one owner per tick.
//
// Measured on the frozen snapshot (pin-aim dive -> commit -> reverse, per-tick
// wheel ownership traced in both documents), before:
//   way in  : 8 ticks at 0.089 zoom/tick (OrbitControls' ratio dolly) while the
//             map sat frozen 0.71 zoom behind the twin (its ceiling stayed
//             clamped at the gate) -> a 3x speed cliff plus a silent desync.
//   way back: tick 1 snapped -0.710 zoom (the scrub re-pinned to the frozen
//             gate pose), then 3 dead ticks, then 1 tick swallowed while the
//             iframe was blanked under the pointer. The retrace dissolve never
//             ran: postTwinClose posted BOTH the object and the legacy string,
//             so the parent's single close listener began the dissolve on the
//             first message and instant-cut it on the second.
// After: 1 dead tick total (the commit tick, where the dissolve completes and
// no camera moves), 0.267/tick both ways (the law's step at a 120px notch),
// no jump, no swallowed tick, retrace legs still 1.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  wheelZoomRate,
  zoomAfterWheel,
  WHEEL_ZOOM_RATE,
  WHEEL_ZOOM_RATE_FINE,
  WHEEL_FINE_PX,
  Z_HANDOFF,
  Z_TOP,
} from '../src/map/scrolltrigger.js';
import { zoomForRange, rangeForZoom, MAP_TRUE_FOV_DEG } from '../src/ring2/sync.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const mapMain = () => srcOf('../src/map/main.js');
const twinMain = () => srcOf('../src/ring2/main.js');

/* ---------- the one wheel-zoom law (pure) ---------- */

test('wheel-zoom law: a 120px notch is 0.267 zoom, mirrored exactly both ways', () => {
  const step = 120 * WHEEL_ZOOM_RATE;
  assert.ok(Math.abs(step - 0.2666667) < 1e-6, `notch step is ${step}`);
  assert.ok(Math.abs(zoomAfterWheel(Z_HANDOFF, 120) - (Z_HANDOFF + step)) < 1e-12, 'inward adds the step');
  assert.ok(Math.abs(zoomAfterWheel(Z_HANDOFF, -120) - (Z_HANDOFF - step)) < 1e-12, 'outward subtracts it');
  // One notch in then one notch out returns EXACTLY to where it started: the
  // law is a pure increment, not a ratio (a ratio drifts with depth).
  let z = Z_TOP;
  for (let i = 0; i < 12; i++) z = zoomAfterWheel(z, 120);
  for (let i = 0; i < 12; i++) z = zoomAfterWheel(z, -120);
  assert.ok(Math.abs(z - Z_TOP) < 1e-9, `12 notches in and out round-trips (${z})`);
});

test('wheel-zoom law: gesture-shaped rates only, non-finite holds', () => {
  assert.equal(wheelZoomRate(0), 0, 'a zero delta is not a tick');
  assert.equal(wheelZoomRate(WHEEL_FINE_PX - 1), WHEEL_ZOOM_RATE_FINE, 'sub-notch dust runs the fine rate');
  assert.equal(wheelZoomRate(WHEEL_FINE_PX), WHEEL_ZOOM_RATE, 'a notch runs the coarse rate');
  assert.equal(zoomAfterWheel(9, NaN), 9, 'non-finite delta holds the zoom');
  assert.equal(zoomAfterWheel(NaN, 120), NaN, 'no zoom in, no zoom out (caller fails open)');
  assert.equal(zoomAfterWheel(9, 0), 9, 'zero delta holds');
});

test('the twin dolly is the SAME law in range space (parity at the seam)', () => {
  // What the map does in zoom, the twin must do in range: one notch, one step,
  // at the live viewport/fov. Before the fix the twin moved by a RATIO, which
  // measured 0.089 zoom/tick against the map's 0.267.
  const spec = { viewportPx: 800, fovDeg: MAP_TRUE_FOV_DEG };
  const lat = 40.201262;
  const r0 = rangeForZoom(Z_HANDOFF, lat, spec);
  const r1 = rangeForZoom(zoomAfterWheel(Z_HANDOFF, 120), lat, spec);
  const back = zoomForRange(r1, lat, spec);
  assert.ok(r1 < r0, 'inward shortens the range');
  assert.ok(Math.abs(back - (Z_HANDOFF + 120 * WHEEL_ZOOM_RATE)) < 1e-6, `range round-trip keeps the step (${back})`);
  const rOut = rangeForZoom(zoomAfterWheel(Z_HANDOFF, -120), lat, spec);
  assert.ok(rOut > r0, 'outward lengthens it');
  // The band end is the gate the map is pinned to: the handover tick lands on
  // the frame the map holds, so the two sides cannot disagree at the switch.
  assert.ok(Math.abs(zoomForRange(rangeForZoom(Z_HANDOFF, lat, spec), lat, spec) - Z_HANDOFF) < 1e-9);
});

/* ---------- one owner per tick, both directions ---------- */

test('way in: the twin moves by the shared law, the gate clamp is released at commit', () => {
  const t = twinMain();
  assert.ok(t.includes('function dollyByWheelLaw(e, dY, bandEnd)'), 'the dolly law exists');
  assert.ok(t.includes('const zNext = zoomAfterWheel(zEq, Number(dY));'), 'it reads the one wheel-zoom law');
  assert.ok(t.includes('zoomForRange(r0, lat, spec)'), 'range->zoom uses the parity law');
  assert.ok(t.includes('let r1 = rangeForZoom(zNext, lat, spec);'), 'and the inverse for the write');
  assert.ok(t.includes("law: 'dolly'"), 'the tick is claimed (no fall-through swallow)');
  const m = mapMain();
  assert.ok(
    m.includes('restoreMaxZoom();') && m.includes('COMMIT RELEASES THE GATE CLAMP'),
    'the commit releases the stale gate clamp (the twin owns the wheel from that tick; the pin protected nothing)',
  );
  assert.ok(
    !m.includes('The ceiling stays clamped while the twin owns the frame'),
    'the frozen-ceiling contract is gone with its measured desync',
  );
});

test('way back: every outward tick moves until the gate, then one handover tick', () => {
  const t = twinMain();
  assert.ok(t.includes('const holdR = holdRangeNow();'), 'the band end is derived from the shared legs (no constant)');
  assert.ok(t.includes('liveR < holdR * (1 - DOLLY_BAND_EPS)'), 'deeper than the gate still dollies');
  assert.ok(t.includes('if (dollyByWheelLaw(e, dY, holdR)) {'), 'the outward dolly clamps to the gate: no overshoot');
  assert.ok(t.includes('if (handBackToMap()) {'), 'the gate tick hands the frame to the map on that same tick');
  assert.ok(t.includes('if (!enterScrubReverse()) { twinFlipToOrbit(e); return; }'), 'the staged-leg walk survives as the fallback only');
});

test('one close post: the dissolve is never cut by a duplicate protocol message', () => {
  const t = twinMain();
  const post = t.slice(t.indexOf('function postTwinClose()'), t.indexOf('/* Close entry:'));
  assert.ok(post.includes('postMessage(buildTwinCloseMessage(true)'), 'the object payload is posted');
  assert.ok(!post.includes('postMessage(TWIN_CLOSE_MSG'), 'the legacy bare string is NOT posted (it double-fired the close)');
  const m = mapMain();
  assert.ok(m.includes("if (d === TWIN_CLOSE_MSG) return true;"), 'the parent still accepts the legacy string (older twins)');
});

test('the retrace dissolve starts at the gate and holds 1 there (no re-open on the first drive)', () => {
  const m = mapMain();
  assert.ok(
    m.includes('if (z > Z_HANDOFF + RETRACE_REOPEN_EPS) {'),
    'the re-open edge is a crossing, not the parked gate pose (>= re-opened one frame after the handover)',
  );
  assert.ok(m.includes('const RETRACE_REOPEN_EPS = 1e-6;'), 'the edge is a named float guard');
  assert.ok(
    m.includes("root.style.pointerEvents = 'none'"),
    'while the dissolve owns the overlay the wheels reach the map (one owner per tick)',
  );
});

/* ---------- the reverse is one law, and the count is pinned ---------- */

test('retrace legs are pinned: ONE law on the map side, no stage walk on the wheel path', () => {
  const m = mapMain();
  assert.ok(m.includes('window.__mapProbe.retraceLegs = 1;'), 'the map reverse is a single zoom-keyed law');
  const t = twinMain();
  // The wheel-path handover must post the close WITHOUT touching the staged
  // scrub: a re-added stage boundary (a leg list to replay) fails loudly here.
  const hand = t.slice(t.indexOf('function handBackToMap()'), t.indexOf('function twinFlipToOrbit('));
  assert.ok(!hand.includes('handoff.fwd'), 'the handover replay reads no leg list');
  assert.ok(!hand.includes('scrubProgressForWheel'), 'and advances no scrub progress');
  assert.ok(hand.includes('postTwinClose();'), 'it is one message: hand the frame over');
  // The staged-leg counter still exists for the pinch/defensive entry, so the
  // shared-legs law cannot silently disappear.
  assert.ok(t.includes('window.__ring2retraceLegs = legs.length;'), 'the legs law is still counted when it IS used');
});
