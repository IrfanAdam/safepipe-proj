// tests/map-click-staged.test.js — owner feedback 2026-10-29 (second review):
// a click still bypassed the enclosure and parked at z11.5 for 9s with an
// empty overlay; a scroll arrival parked at the gate at S=0 with no loader
// (slow dive => the fast-intent gate hid the pill) and demanded another wheel
// notch after the twin released. These tests pin the two laws that fix that:
//   (1) CLICK enters the SAME staged enclosure hold as scroll on the landing.
//   (2) AUTO-ARRIVAL S finishes the dissolve once the twin releases, paused by
//       active fingers and stopped by reverse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoStagedSForDt, HANDOFF_STAGED_S_MAX } from '../src/map/scrolltrigger.js';

const here = dirname(fileURLToPath(import.meta.url));
const main = () => readFileSync(join(here, '../src/map/main.js'), 'utf8');

function fnBody(src, name) {
  const at = src.indexOf('function ' + name);
  assert.ok(at >= 0, `${name} exists`);
  const open = src.indexOf(') {', at) + 2;
  assert.ok(open > 2, `${name} has a body opener`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${name} body is unbalanced`);
}

test('auto S is a pure dt law: half time half travel, clamped at S_MAX', () => {
  assert.equal(autoStagedSForDt(0, 0), 0, 'no time, no travel');
  assert.equal(autoStagedSForDt(0, 560), HANDOFF_STAGED_S_MAX, 'the shared flight beat reaches the gate');
  const half = autoStagedSForDt(0, 280);
  assert.ok(Math.abs(half - HANDOFF_STAGED_S_MAX / 2) < 1e-9, `half the beat reaches half S (got ${half})`);
  assert.equal(autoStagedSForDt(HANDOFF_STAGED_S_MAX, 100), HANDOFF_STAGED_S_MAX, 'clamped at the end');
  const a = autoStagedSForDt(10, 16);
  const b = autoStagedSForDt(a, 16);
  assert.ok(b > a, 'strictly monotone while below the clamp');
  assert.equal(autoStagedSForDt(-50, 16), autoStagedSForDt(0, 16), 'negative seeds clamp to zero');
});

test('click entry boots staged and arms the enclosure on the landing frame', () => {
  const m = main();
  const body = fnBody(m, 'flyToSectorThenTwin');
  assert.match(body, /clickStagedPending = true/, 'mid-flight grants are held');
  assert.match(body, /prewarmThenReveal\(id, clickFrame, \{ \.\.\.opts, staged: true \}\)/,
    'click prewarm is staged (no timed unstaged fallback)');
  assert.match(body, /scheduleClickStagedArm\(id, clickFrame, opts\)/,
    'the gate hold is promoted on the flight landing');

  const arm = fnBody(m, 'armStagedHoldAtGate');
  assert.match(arm, /stagedActive = true/, 'the landing enters the staged hold');
  assert.match(arm, /prewarmThenReveal\(id, stagedFrame \|\| liveFrame\(\), \{ \.\.\.opts, staged: true \}\)/,
    'reuses the same staged reveal law');
  assert.match(arm, /writeEnclosureEllipse\(proxNow, Z_HANDOFF\)/, 'paints the gate seam enclosure');
  assert.match(arm, /showVignette\(true\)/, 'the enclosure chrome is on at the click gate');
  assert.match(arm, /startStagedAutoPump\(\)/, 'the click arrival can finish without a second gesture');
});

test('revealTwin refuses any non-instant open while the click hold is pending', () => {
  const reveal = fnBody(main(), 'revealTwin');
  assert.match(reveal, /if \(clickStagedPending && !instant\) return false;/,
    'a ready/paint grant mid-flight cannot open an unenclosed twin');
});

test('the loader is visible for any loading hold after the grace', () => {
  const m = main();
  assert.ok(m.includes('const STALL_PILL_GRACE_MS = 2000;'), 'the grace is a named constant');
  assert.ok(m.includes('const show = hold && loading && stallWaitMs() >= STALL_PILL_GRACE_MS;'),
    'the pill no longer hides slow arrivals behind the fast-intent gate');
  const pump = fnBody(m, 'startStagedAutoPump');
  assert.match(pump, /stallArmed\(\)/, 'the pump holds while the twin is not released');
  assert.match(pump, /autoStagedSForDt\(stagedS, dt, \{ durationMs: CLICK_FLIGHT_MS \}\)/,
    'the pump advances through the shared flight beat');
  assert.match(pump, /lastStagedInputMs/, 'active fingers pause the pump');
});

test('reverse stops the auto pump; commit and unwind stop it too', () => {
  const m = main();
  const feed = fnBody(m, 'feedStagedScroll');
  assert.match(feed, /if \(!stagedFeedFwd\) stopStagedAutoPump\(\);/,
    'a reverse tick ends the auto arrival for this hold');
  assert.match(fnBody(m, 'finalizeStagedReveal'), /stopStagedAutoPump\(\);/, 'commit stops the pump');
  assert.match(fnBody(m, 'exitStaged'), /stopStagedAutoPump\(\);/, 'unwind stops the pump');
  assert.match(fnBody(m, 'quiesceTwinLayers'), /clickStagedPending = false;/, 'teardown drops a pending click arm');
});
