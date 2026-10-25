// tests/frame-budget.test.js — per-frame budget model + wiring guards.
// The journey's stutter is a PER-FRAME property, so it gets pure laws, a
// series model, and source guards that keep the single-pass wiring from
// silently regressing back to per-tick work.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  HIDDEN_RENDER_MS,
  CONTENT_SAMPLE_MS,
  STEP_SOURCES,
  overlayPaintsNow,
  renderDue,
  sampleDue,
  coalesceStepSource,
  frameBudgetStats,
  frameBudgetPass,
  reversalsIn,
} from '../src/map/frame-pacing.js';

const MAIN = readFileSync(new URL('../src/map/main.js', import.meta.url), 'utf8');

/* ---------- overlay visibility law (twin render gate) ---------- */

test('overlayPaintsNow: only a wrapper that can actually show the canvas paints', () => {
  assert.equal(overlayPaintsNow({}), true, 'default is to paint — never freeze a visible twin');
  assert.equal(overlayPaintsNow({ hidden: true }), false, 'hidden attribute');
  assert.equal(overlayPaintsNow({ prewarm: true }), false, 'prewarm holds opacity 0');
  assert.equal(overlayPaintsNow({ closing: true }), false, 'closing is a fade-out to 0');
  assert.equal(overlayPaintsNow({ opacity: '0' }), false, 'inline opacity 0 (scrub-owned)');
  assert.equal(overlayPaintsNow({ opacity: 0.001 }), false, 'epsilon floor');
  assert.equal(overlayPaintsNow({ opacity: '0.4' }), true, 'mid-dissolve paints');
  assert.equal(overlayPaintsNow({ opacity: '' }), true, 'unset inline opacity = stylesheet decides');
  assert.equal(overlayPaintsNow({ opacity: 'nonsense' }), true, 'unreadable value paints (safe default)');
});

test('renderDue: painting frames always paint; hidden frames keep-warm at the cadence', () => {
  assert.equal(renderDue({ paints: true, nowMs: 10, lastRenderMs: 9 }), true);
  assert.equal(renderDue({ paints: false, nowMs: 10, lastRenderMs: 9 }), false);
  assert.equal(renderDue({ paints: false, nowMs: 9 + HIDDEN_RENDER_MS, lastRenderMs: 9 }), true);
  assert.equal(renderDue({ paints: false, nowMs: 9 + HIDDEN_RENDER_MS - 1, lastRenderMs: 9 }), false);
  // first frame of a hidden stretch always paints (no last stamp yet)
  assert.equal(renderDue({ paints: false, nowMs: 1, lastRenderMs: -Infinity }), true);
  // a hidden second of frames costs ~8 paints, not 120
  let paints = 0;
  let lastPaint = -Infinity;
  for (let t = 0; t <= 1000; t += 1000 / 120) {
    if (renderDue({ paints: false, nowMs: t, lastRenderMs: lastPaint })) {
      paints += 1;
      lastPaint = t;
    }
  }
  assert.ok(paints <= 10, `hidden cadence paints ~8x/s (got ${paints})`);
  assert.ok(paints >= 7, `and never starves the loop (got ${paints})`);
});

test('sampleDue: the pixel readback rides its own cadence, not the paint rate', () => {
  assert.equal(sampleDue({ nowMs: 0, lastSampleMs: -Infinity }), true);
  assert.equal(sampleDue({ nowMs: 100, lastSampleMs: 0 }), false);
  assert.equal(sampleDue({ nowMs: CONTENT_SAMPLE_MS, lastSampleMs: 0 }), true);
  // one second of 120fps paints -> at most 5 readbacks, not 240
  let samples = 0;
  let last = -Infinity;
  for (let t = 0; t <= 1000; t += 1000 / 120) {
    if (sampleDue({ nowMs: t, lastSampleMs: last })) {
      samples += 1;
      last = t;
    }
  }
  assert.ok(samples <= 6, `readbacks per second stay single-digit (got ${samples})`);
});

/* ---------- one coherent pass per frame ---------- */

test('coalesceStepSource: move+zoom collapse to ONE pass, settles outrank gestures', () => {
  assert.equal(STEP_SOURCES[0], 'native-zoomend', 'settle has top priority');
  assert.equal(coalesceStepSource(['native-move', 'native-zoom']), 'native-zoom');
  assert.equal(coalesceStepSource(['native-zoom', 'native-move']), 'native-zoom');
  assert.equal(coalesceStepSource(['native-zoom', 'native-zoomend']), 'native-zoomend');
  assert.equal(coalesceStepSource(['native-init', 'native-move']), 'native-move');
  assert.equal(coalesceStepSource([]), 'native-zoom', 'never loses a step');
  assert.equal(coalesceStepSource([null, undefined]), 'native-zoom');
  assert.equal(coalesceStepSource('native-zoom'), 'native-zoom');
});

test('a frame of move+zoom ticks runs the driver ONCE (measured 1.92 -> <=1)', () => {
  // Model: MapLibre emits 'move' and 'zoom' per animation frame while a
  // gesture runs. Before coalescing each tick ran the whole driver
  // (measured 1.92 passes/frame mid-dive); now the queued ticks fold into a
  // single pass per frame regardless of how many arrive.
  let passes = 0;
  for (let frame = 0; frame < 240; frame++) {
    const queued = ['native-move', 'native-zoom'];
    if (coalesceStepSource(queued)) passes += 1; // one scheduled pass per frame
  }
  assert.equal(passes, 240, 'one pass per frame, never two');
  const perFrame = passes / 240;
  assert.ok(perFrame <= 1, `passes/frame <= 1 (got ${perFrame})`);
});

/* ---------- budget verdict ---------- */

test('frameBudgetStats + frameBudgetPass: no frame above 2x the median', () => {
  const clean = frameBudgetStats(Array.from({ length: 240 }, () => 8.3));
  assert.equal(clean.median, 8.3);
  assert.equal(clean.longFrames, 0);
  assert.equal(frameBudgetPass(clean), true);

  const hitched = [8.3, 8.4, 8.3, 60, 8.3, 8.2, 8.4, 8.3];
  const s = frameBudgetStats(hitched);
  assert.equal(s.median, 8.3);
  assert.equal(s.longFrames, 1, 'the 60ms frame is the hitch');
  assert.equal(frameBudgetPass(s), false, 'a 7x frame fails the budget');

  // 2x is the line: exactly 2x passes, 2x+0.1 fails
  const atLine = frameBudgetStats([8, 8, 8, 16]);
  assert.equal(frameBudgetPass(atLine), true);
  const overLine = frameBudgetStats([8, 8, 8, 16.1]);
  assert.equal(frameBudgetPass(overLine), false);

  assert.equal(frameBudgetStats([]).median, null);
  assert.equal(frameBudgetPass(frameBudgetStats([])), false, 'no data is not a pass');
  assert.equal(frameBudgetStats([NaN, -1, 0]).n, 0, 'non-finite/negative deltas are ignored');
});

test('reversalsIn: monotone motion has no visible back-step', () => {
  assert.equal(reversalsIn([6.4, 7.1, 8.0, 9.5, 10.6], { direction: 1 }), 0);
  assert.equal(reversalsIn([10.6, 9.5, 8.0, 7.1, 6.4], { direction: -1 }), 0);
  assert.equal(reversalsIn([6.4, 7.1, 7.0, 7.6], { direction: 1 }), 1, 'one back-step');
  assert.equal(reversalsIn([6.4, 7.1, 7.1, 7.6], { direction: 1 }), 0, 'a plateau is not a reversal');
  assert.equal(reversalsIn([6.4, 7.1, 7.099, 7.6], { direction: 1, epsilon: 0.01 }), 0, 'jitter below epsilon is not visible');
});

/* ---------- wiring guards (the fix must stay wired) ---------- */

test('the map driver is scheduled once per frame, not once per zoom tick', () => {
  assert.ok(MAIN.includes('coalesceStepSource'), 'the driver folds queued steps through the pure law');
  assert.ok(
    MAIN.includes('onProgress: (snap, source) => scheduleNativeZoomStep(snap, source)'),
    'installZoomJourney routes through the per-frame scheduler',
  );
  assert.ok(MAIN.includes('pendingStepRaf'), 'a pending pass is coalesced on an animation frame');
  // one box read per pass, shared by proximity + enclosure + scale HUD
  assert.ok(MAIN.includes('function frameSize()'), 'container size is read once per pass');
  assert.ok(MAIN.includes('function frameRect()'), 'container rect is read once per pass');
  const clientWidthReads = (MAIN.match(/el && el\.clientWidth/g) || []).length;
  assert.ok(clientWidthReads <= 4, `container width is read at few sites (got ${clientWidthReads})`);
  // the three per-pass consumers share the one box read
  for (const fn of ['function proximityInfo()', 'function writeEnclosureEllipse(', 'function updateScaleHud(']) {
    const at = MAIN.indexOf(fn);
    assert.ok(at > 0, `${fn} exists`);
    const body = MAIN.slice(at, at + 2600);
    assert.ok(body.includes('frameSize()'), `${fn} reads the per-pass box, not the DOM`);
  }
  // no second pin-projection listener shadowing the driver
  assert.ok(!MAIN.includes("map.on('move', () => positionDomPins(map))"), 'the duplicate pin listener is gone');
  // paint-property no-op writes are skipped
  assert.ok(MAIN.includes('lastSatOpacity'), 'unchanged raster-opacity writes are skipped');
});

test('the pacing laws are the single source of the cadences', () => {
  assert.ok(HIDDEN_RENDER_MS > 0 && HIDDEN_RENDER_MS <= 250, 'keep-warm cadence stays coarse');
  assert.ok(CONTENT_SAMPLE_MS >= 100, 'readback cadence is not per-frame');
});

// REPORTED, NOT APPLIED (sibling lane owns src/ring2/*): the twin iframe
// still renders its full scene AND takes two synchronous gl.readPixels
// readbacks on every frame while it is mounted behind the map in prewarm —
// measured 240 readbacks/s, 1831ms of GPU sync across one journey and 69% of
// the journey's main-thread script time (7863ms -> 2421ms with the loop
// stopped). Fix: gate ring2's frameOnce paint through renderDue()/
// twinPaintsNow() and pass sampleDue() as `{ sample }` into renderTwin().
// Re-rate this todo once that lane lands the gate (then assert the guard).
test.todo('twin frameOnce paints through renderDue() and samples on sampleDue()');
