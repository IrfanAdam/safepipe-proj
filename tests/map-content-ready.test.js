// tests/map-content-ready.test.js — CONTENT-READY lane (D2): the twin is
// content-ready BY the staged arm, not seconds after it. The v2 eval
// measured arm→grant ~8.4s wall headless with S frozen + TWIN LOADING pill,
// readyByArm=true while readyMs=0 (the flag meant booted-early, not
// content-ready), and paintedMs=0 the whole run (the paint gate never
// fired). Root causes, all in the grant path: the twin streams its own
// arrival-zoom tiles only from the arm (map-side prefetches warm just the
// HTTP cache); the once-per-shell-life paint posts pre-open and is dropped
// parent-side, then never re-posts on reuse; the arm stamp called
// boot-earliness readiness. Fixes pinned here: progressive retarget during
// the climb, paint-log adoption on warm reuse, honest arm verdict sampled
// from the live content gate.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  Z_FAR_INTENT,
  Z_HANDOFF,
  TWIN_RETARGET_RETRY_MS,
  progressiveRetargetDue,
} from '../src/map/scrolltrigger.js';

const MAIN = readFileSync(new URL('../src/map/main.js', import.meta.url), 'utf8');
const RING2 = readFileSync(new URL('../src/ring2/main.js', import.meta.url), 'utf8');

test('progressive retarget schedule: fires in the climb band on integer crossings', () => {
  assert.equal(progressiveRetargetDue({ z: 7, lastZ: -1, lastT: 0, nowT: 10000 }), true, 'first in-band tick fires');
  assert.equal(progressiveRetargetDue({ z: 7.4, lastZ: 7, lastT: 0, nowT: 100 }), false, 'same integer, no retry beat yet');
  assert.equal(progressiveRetargetDue({ z: 8.1, lastZ: 7, lastT: 0, nowT: 100 }), true, 'integer crossing fires');
  assert.equal(
    progressiveRetargetDue({ z: 8.1, lastZ: 8, lastT: 0, nowT: TWIN_RETARGET_RETRY_MS }),
    true,
    'same integer fires once the retry beat elapses (slow-loading shell re-pinned)',
  );
});

test('progressive retarget schedule: withholds outside the band and on bad input', () => {
  assert.equal(progressiveRetargetDue({ z: Z_FAR_INTENT - 0.5, lastZ: -1, lastT: 0, nowT: 99999 }), false, 'below far intent never fires');
  assert.equal(progressiveRetargetDue({ z: Z_HANDOFF, lastZ: 10, lastT: 0, nowT: 99999 }), false, 'at the handoff never fires (deep frame would spend the hold pre-arm)');
  assert.equal(progressiveRetargetDue({ z: Z_HANDOFF + 1, lastZ: -1, lastT: 0, nowT: 99999 }), false, 'past the handoff never fires');
  for (const bad of [{}, { z: NaN }, { z: 8, lastZ: 8, lastT: NaN, nowT: 5000 }, { z: 8, lastZ: 8, lastT: 0, nowT: NaN }]) {
    assert.equal(progressiveRetargetDue(bad), false, `withholds for ${JSON.stringify(bad)}`);
  }
  assert.equal(TWIN_RETARGET_RETRY_MS, 500, 'the keepalive beat is a named constant (under the 900ms hold floor)');
});

test('the climb re-pins the warm shell onto the live frame (tiles stream pre-arm)', () => {
  const at = MAIN.indexOf('// CONTENT-READY: stream the twin');
  assert.ok(at !== -1, 'the progressive block exists');
  const block = MAIN.slice(at, MAIN.indexOf('window.__mapProbe.intentPrewarm', at));
  assert.ok(block.includes('progressiveRetargetDue({ z, lastZ: lastRetargetZ'), 'the pure schedule owns the throttle');
  assert.ok(block.includes('earlyTwinArmed || twinBootKey === h3'), 'armed and idle shells both re-pin');
  assert.ok(block.includes('!twinOpen') && block.includes('!stagedActive'), 'never posts once open or staged');
  assert.ok(block.includes("if (phase === 'hold')"), 'hold pre-release only — matched shells re-arm twin-side, so the pin keeps tracking');
  assert.ok(block.includes('buildTwinRetargetMessage(pf)'), 're-pins onto the predicted arrival frame');
  assert.ok(block.includes('SITE_LNGLAT'), 'pins the SITE center the arm seats, not the travelling center');
  assert.ok(block.includes('keepalive'), 'same-frame pins are the hold-floor keepalive, never skipped');
  assert.ok(block.includes('lastRetargetZ = Math.floor(z)'), 'stamps the crossing on post');
  const code = block.replace(/\/\/[^\n]*/g, '');
  for (const flip of ['earlyBootTwin', 'prewarmThenReveal', 'twinOpen = true', 'setMaxZoom', 'pendingReveal = {']) {
    assert.ok(!code.includes(flip), `progressive retarget never ${flip} — posts only, no state flips`);
  }
});

test('warm reuse adopts the pre-open paint so the paint gate fires', () => {
  const arrival = MAIN.slice(MAIN.indexOf('function prewarmThenReveal('), MAIN.indexOf('/* Unstaged + staged fallback reveal'));
  assert.ok(arrival.includes('if (warmReused && !window.__mapProbe.twinPainted)'), 'adoption runs on warm reuse only');
  assert.ok(arrival.includes('__ring2paintOut'), 'adoption reads the shell paint log read-only');
  assert.ok(arrival.includes("stampGrant('painted')"), 'adoption stamps the painted grant');
});

test('the arm stamp means content-ready, not booted-early', () => {
  const at = MAIN.indexOf('function stampArm()');
  assert.ok(at !== -1, 'stampArm exists');
  const body = MAIN.slice(at, MAIN.indexOf('}', MAIN.indexOf('if (content) bt.readyByArm = true;')) + 1);
  assert.ok(body.includes('twinFrameHasContent() === true'), 'the verdict samples the live content gate');
  assert.ok(!body.includes('__ring2paintOut'), 'no paint-log poll stands in for content');
  assert.ok(!body.includes('bt.paintedMs') && !body.includes('bt.readyMs'), 'no timestamp-earliness stands in for content');
  assert.ok(MAIN.includes("stampGrant('painted')"), 'painted grants still stamp');
  assert.ok(MAIN.includes("stampGrant('ready')"), 'ready grants still stamp');
});

test('a retarget re-arms the twin hold (no pre-arm grant seal)', () => {
  const at = RING2.indexOf('Boot-once retarget (parent -> twin)');
  assert.ok(at !== -1, 'the retarget handler exists');
  const body = RING2.slice(at, RING2.indexOf('window.addEventListener', RING2.indexOf('twinFlipToOrbit')));
  assert.ok(!body.includes('handoff.readyPosted) return'), 'a posted ready no longer seals the shell');
  assert.ok(body.includes('handoff.readyPosted = false'), 'the retarget resets the post');
  assert.ok(body.includes('handoff.readyHits = 0'), 'the retarget restarts the settle count');
  assert.ok(body.includes('handoff.t0 = handoffNow()'), 'the retarget restarts the hold floor — pins never mature a pre-arm exit');
});

test('the hold never releases pre-arm: arrival flips the twin gate', () => {
  assert.ok(RING2.includes('arrived: true'), 'fresh boots carry arrival semantics');
  assert.ok(RING2.includes("if (e?.data?.arrival === true) handoff.arrived = true;"), 'the arrival pin flips the gate');
  assert.ok(RING2.includes('&& handoff.arrived;'), 'both release legs require arrival');
  const reuse = MAIN.slice(MAIN.indexOf('function reuseWarmTwin('), MAIN.indexOf('function abortEarlyBootTwin'));
  assert.ok(reuse.includes('msg.arrival = true'), 'arrival reuse pins carry the arrival flag');
  assert.ok(!reuse.includes('buildTwinRetargetMessage(frame, '), 'the builder signature is untouched (flag rides alongside)');
});
