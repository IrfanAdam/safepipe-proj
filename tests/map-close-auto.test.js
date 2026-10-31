// tests/map-close-auto.test.js — owner rev 2026-10-30: the X close must
// retrace the SAME world->twin geometry as the scroll reverse, and the staged
// enclosure must own depth from its first frame (no final-level map zoom under
// the mask). These are source laws: the behaviour is exercised in the WebKit
// close probe, while the invariants live here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/map/main.js'), 'utf8');
const fn = (name, end) => {
  const a = SRC.indexOf('function ' + name);
  const b = end ? SRC.indexOf(end, a + 1) : SRC.length;
  assert.ok(a >= 0 && b > a, `${name} body exists`);
  return SRC.slice(a, b);
};

test('staging starts at the gate, so a held mask never owns map depth', () => {
  const fly = fn('flyToSectorThenTwin', 'function lockStagedZoomAtGate(');
  assert.ok(fly.includes('liveZ >= Z_HANDOFF - 0.01'), 'the staged entry threshold is the gate');
  assert.ok(!fly.includes('liveZ >= Z_TOP'), 'the old iso-checkpoint staging is gone');
  assert.ok(SRC.includes('z >= Z_HANDOFF - 0.01 && deepIntent'), 'the deep latch fires at the gate');
  const step = fn('onNativeZoomStep', 'function resetScrubJourney(');
  assert.ok(step.includes('(stagedActive || clickStagedPending)'), 'a landing click seals before the timed arm');
  assert.ok(step.includes('lockStagedZoomAtGate()'), 'every live frame reaching the gate seals');
});

test('the click flight is long enough to read the world->plate sweep', () => {
  const ms = +(/const CLICK_FLIGHT_MS = (\d+);/.exec(SRC) || [])[1];
  assert.ok(ms >= 1000 && ms <= 2000, `click flight ms (${ms}) reads the journey`);
  assert.ok(SRC.includes('const CLICK_DISSOLVE_MS = 560;'), 'the dissolve pump keeps its own beat');
  assert.ok(SRC.includes('durationMs: CLICK_DISSOLVE_MS'), 'the pump does not inherit the slower camera');
});

test('X/Esc/back auto-retrace the gesture reverse instead of cutting', () => {
  const close = fn('doCloseTwin', 'function holdHandoffPoseForReverse(');
  assert.ok(close.includes('let autoReverse = false;'), 'the auto path is an explicit close intent');
  assert.ok(close.includes('autoReverseTargetFrame()'), 'the pre-dive frame is captured before teardown');
  assert.ok(close.includes('stagedActive && !stagedCommitted && !autoReverse'), 'an uncommitted visible twin keeps its frame for the retrace');
  assert.ok(close.includes('startAutoReverseWheelDrive(autoTarget)'), 'the explicit close feeds the same outward wheel lane');
  assert.ok(close.includes('autoReverseCloseFlight(autoTarget)'), 'the one-shot ease remains the lane fallback');
  assert.ok(close.includes('beginRetraceDissolve()'), 'the fade is the shared zoom-keyed dissolve');
  assert.ok(close.includes('stopStagedAutoPump()'), 'the staged commit pump cannot re-park the gate under the auto flight');
  assert.ok(close.includes('stagedActive = false;'), 'the auto flight stops staged ownership before driving z');
  const drive = fn('startAutoReverseWheelDrive', 'function doCloseTwin(');
  assert.ok(drive.includes('deltaY: -tickDelta'), 'raw negative = outward under the owner up-out convention');
  assert.ok(drive.includes('host.dispatchEvent(ev)'), 'the event enters the same map wheel lane as a finger');
  assert.ok(drive.includes('AUTO_REVERSE_FADE_DELTA'), 'the overlay band gets readable smaller ticks');
  assert.ok(SRC.includes("mode: 'wheel'"), 'the probe names the gesture-shaped close');
  const recede = fn('recedeToHome', 'function mountChrome(');
  assert.ok(recede.includes('autoReverseLandingTarget'), 'the home landing defers to the wider auto destination');
  assert.ok(SRC.includes('finishTwinClose({ autoReverse: true })'), 'the explicit close entries pass the intent through');
  assert.ok(SRC.includes("explicitClose ? { autoReverse: true } : { gestureReverse: true }"), 'a recede reply distinguishes explicit close from a wheel reverse');
});
