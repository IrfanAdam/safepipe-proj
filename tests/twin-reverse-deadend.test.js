// tests/twin-reverse-deadend.test.js — LANE-REV: zoom-out trapped after handover.
//
// Owner regression (evals 8bf1397/37980fe): all the way in, scrolling back up
// (outward) to zoom out dead-ended. Root cause, traced in src/ring2/main.js:
// the done-phase outward tick at the gate called handBackToMap(), which posted
// the close (closePosted=true) and returned true forever after; the wheel
// handler then consumed EVERY later outward tick on `if (handBackToMap())`
// (preventDefault + stopPropagation, no motion), while enterScrubReverse —
// gated on !closePosted — could never start the scrub walk. Meanwhile the
// parent's retrace dissolve (beginRetraceDissolve, src/map/main.js) only sets
// overlay-root pointer-events:none, which does not release the fullscreen
// child iframe, so wheels stayed trapped in the twin document flipping to
// orbit while the map zoom never moved and the zoom-keyed dissolve never
// advanced: full deadlock.
//
// Fix: close-posts-only-at-END-of-twin-owned-reverse. The done-phase outward
// tick enters the scrub at progress 0 (entry pose == live pose, no snap),
// walks the shared legs to progress 1 (gate pose), and finishScrubReverse
// posts the single close there. The handover block is deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scrubProgressForWheel,
  scrubEntryForDelta,
  TWIN_SCRUB_WHEEL_PX,
} from '../src/ring2/sector.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const twinMain = () => srcOf('../src/ring2/main.js');

test('deadlock shape: no mid-walk close, no consume-forever idempotent re-post', () => {
  const t = twinMain();
  assert.ok(!t.includes('function handBackToMap('), 'the handover poster is deleted');
  assert.ok(!t.includes('handBackToMap'), 'no handover call remains anywhere on the wheel path');
  assert.ok(!t.includes('function holdRangeNow('), 'the gate-range band end is deleted with it');
  assert.ok(!t.includes('liveR < holdR'), 'no deeper-than-gate dolly branch survives');
});

test('outward at the gate enters the scrub instead of posting a close', () => {
  const t = twinMain();
  const wheelStart = t.indexOf('function onTwinScrubWheel(e)');
  assert.ok(wheelStart > 0, 'wheel handler exists');
  const doneStart = t.indexOf("if (handoff.phase === 'done') {", wheelStart);
  assert.ok(doneStart > wheelStart, 'done phase owns the wheel');
  const doneBlock = t.slice(doneStart, t.indexOf("} else if (handoff.phase === 'reverse'"));
  assert.ok(doneBlock.includes('if (!enterScrubReverse()) { twinFlipToOrbit(e); return; }'),
    'outward enters the scrub (orbit is the fallback, not the default)');
  assert.ok(!doneBlock.includes('postTwinClose'), 'no close posts anywhere in the done-phase wheel block');
});

test('post-close twin never swallows the reverse: the guard returns before any post', () => {
  const t = twinMain();
  assert.ok(
    t.includes('if (!handoff.start || handoff.closePosted) { if (!pinch) twinFlipToOrbit(e); return; }'),
    'post-close ticks flip to orbit and return — no re-post, no swallow',
  );
  assert.ok(
    t.includes('if (!handoff.start || handoff.closePosted) return false;'),
    'the scrub entry stays shut after the close (no zombie walk re-opens)',
  );
});

test('close fires exactly once, at the walk end', () => {
  const t = twinMain();
  // The only walk-end poster is finishScrubReverse, reached only at progress 1.
  const consumeStart = t.indexOf('const sc = handoff.scrub;');
  assert.ok(consumeStart > 0, 'shared consume block exists');
  assert.ok(t.includes('if (sc.progress >= 1) {'), 'the walk end is gated on progress reaching 1');
  const walkEnd = t.slice(t.indexOf('if (sc.progress >= 1) {'), t.indexOf('if (sc.progress >= 1) {') + 400);
  assert.ok(walkEnd.includes('finishScrubReverse()'), 'progress 1 finishes through the single walk-end exit');
  const fin = t.slice(t.indexOf('function finishScrubReverse()'), t.indexOf('function finishScrubReverse()') + 400);
  assert.ok(fin.includes('postTwinClose();'), 'the walk end posts the close');
  assert.equal((fin.match(/postTwinClose\(\);/g) || []).length, 1, 'exactly one post at the walk end');
});

test('wheel-flow: five outward notches walk the scrub 0 -> 1, inward undoes it', () => {
  // Headless flow of the shared consume block (scrubProgressForWheel is the
  // exact law the handler folds each tick's delta through): entry at 0,
  // outward advances on the same tick (notch-1 alive), progress 1 ends the walk.
  let p = 0;
  const enter = scrubEntryForDelta(0, -120);
  assert.equal(enter.enter, false, 'a single notch accumulates (pinch budget path needs the clamp)');
  p = scrubProgressForWheel(p, -120);
  assert.ok(p > 0, 'the entering notch leaves progress 0');
  let ticks = 1;
  while (p < 1 && ticks < 20) {
    const next = scrubProgressForWheel(p, -120);
    assert.ok(next >= p, `tick ${ticks + 1} never moves backward (${p} -> ${next})`);
    p = next;
    ticks++;
  }
  assert.equal(p, 1, 'the walk completes (no dead tick stalls it)');
  assert.ok(ticks <= Math.ceil(TWIN_SCRUB_WHEEL_PX / 120) + 1, `completes within the journey budget (${ticks} ticks)`);
  assert.equal(scrubProgressForWheel(1, 120 * ticks), 0, 'the same notches inward undo the walk (symmetric exit)');
  assert.equal(scrubProgressForWheel(0.5, -60, { pinch: true }), 0.5, 'pinch never counts toward progress');
});
