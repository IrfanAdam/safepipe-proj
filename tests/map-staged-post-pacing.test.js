// tests/map-staged-post-pacing.test.js — lane-smooth-fwd: the forward
// staged band (map terrain -> staged band -> twin commit) must read as one
// continuous gesture. The S producer used a 60ms wall-clock floor beside the
// value-change check; at burst cadence it coalesced several wheel ticks into
// one post, so the twin applied the band in ~0.13-progress jumps at 16Hz
// while the map overlay glided per tick. Delivery is now rAF-coalesced
// (at most one post per frame, flush reads the LIVE S). Laws, predicates,
// endpoints, and the value-change throttle are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stagedIntroProgressForS,
  HANDOFF_STAGED_S_MAX,
  STAGED_SWOOP_END_PX,
  HANDOFF_SWOOP_MS,
  HANDOFF_PUSH_MS,
  HANDOFF_MORPH_MS,
} from '../src/map/scrolltrigger.js';
import {
  buildForwardLegs,
  poseForScrubProgress,
  fwdProgressForStagedS,
  toneGradeForMix,
  HANDOFF_START_MIX,
  HANDOFF_END_MIX,
} from '../src/ring2/sector.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('staged-S delivery is frame-coalesced, not wall-clock floored', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('function postTwinStagedS()'), 'producer exists');
  assert.ok(main.includes('function flushTwinStagedS()'), 'rAF-coalesced flush exists');
  assert.ok(!main.includes('lastStagedPostT'), 'the 60ms wall-clock floor is gone (no timestamp state)');
  assert.ok(!main.includes('< 60'), 'no 60ms gate remains on the staged path');
  assert.ok(main.includes('requestAnimationFrame('), 'bursts coalesce to one post per frame');
  assert.ok(main.includes('stagedPostQueued'), 'a scheduled flush absorbs later ticks');
  assert.ok(
    main.includes('lastPostedStagedS !== null && s === lastPostedStagedS'),
    'value-change throttle intact',
  );
  assert.ok(
    main.includes('win.postMessage(buildTwinStagedMessage(s, zPost)'),
    'the flush still posts S + live zoom to the frame',
  );
});

test('staged law values unchanged: same knees, same commit', () => {
  const total = HANDOFF_SWOOP_MS + HANDOFF_PUSH_MS + HANDOFF_MORPH_MS;
  assert.equal(stagedIntroProgressForS(0), 0, 'parks at 0');
  assert.equal(stagedIntroProgressForS(HANDOFF_STAGED_S_MAX), 1, 'commits at the band end');
  assert.equal(stagedIntroProgressForS(HANDOFF_STAGED_S_MAX + 500), 1, 'parks at 1 past the end');
  const w1 = HANDOFF_SWOOP_MS / total;
  assert.ok(
    Math.abs(stagedIntroProgressForS(STAGED_SWOOP_END_PX) - w1) < 1e-12,
    'swoop knee still lands on the ms-proportional weight',
  );
  // Twin-side delegation reads the same law with the same anchors.
  for (const s of [0, 40, 240, 400, 546, 700]) {
    assert.equal(fwdProgressForStagedS(s), stagedIntroProgressForS(s), `twin progress agrees at S=${s}`);
  }
});

test('gate 1: every driveMix call site gets a finite number on every staged tick', () => {
  const main = srcOf('../src/ring2/main.js');
  const code = main
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  const args = [...code.matchAll(/driveMix\(([^)]*)\)/g)]
    .map((m) => m[1].trim())
    .filter((a) => a !== 'v'); // the definition itself
  assert.ok(args.length >= 9, `all call sites audited (found ${args.length})`);
  assert.ok(Number.isFinite(HANDOFF_START_MIX), 'HANDOFF_START_MIX finite');
  assert.ok(Number.isFinite(HANDOFF_END_MIX), 'HANDOFF_END_MIX finite');
  for (const a of args) {
    assert.ok(
      a === 'HANDOFF_START_MIX' || a === 'HANDOFF_END_MIX' || a === 'fs.mix' || a === 's.mix',
      `unexpected driveMix arg: ${a}`,
    );
  }
  // fs.mix / s.mix are poseForScrubProgress outputs across the forward band:
  // sweep the whole staged S range — no dropped .mix may read non-finite
  // (the retraced mix-50 class: NaN falls back to clampMix 50 mid-dissolve).
  const legs = buildForwardLegs({
    startPose: { eye: { x: 0, y: 100, z: 0 }, target: { x: 0, y: 0, z: 0 } },
    mid: { eye: { x: 10, y: 90, z: 5 }, target: { x: 1, y: 0, z: 1 } },
    to: { eye: { x: 20, y: 80, z: 10 }, target: { x: 2, y: 0, z: 2 } },
  });
  assert.ok(legs, 'forward legs build');
  for (let s = 0; s <= HANDOFF_STAGED_S_MAX; s += 5) {
    const p = stagedIntroProgressForS(s);
    const r = poseForScrubProgress(legs, p);
    assert.ok(r && Number.isFinite(r.mix), `finite mix at S=${s} (progress ${p.toFixed(4)})`);
  }
});

test('gate 2: no early-close handover on the forward path', () => {
  const main = srcOf('../src/ring2/main.js');
  const start = main.indexOf('function stepHandoff() {');
  assert.ok(start >= 0, 'forward flight stepper exists');
  const rev = main.indexOf("if (handoff.phase === 'reverse') {", start);
  assert.ok(rev > start, 'reverse branch follows the forward flight');
  const fwd = main.slice(start, rev);
  assert.ok(!fwd.includes('requestTwinClose()'), 'forward flight never requests a close');
  assert.ok(!fwd.includes('postTwinClose()'), 'forward flight never posts a close');
});

test('gate 3: no dead-code pins on the staged path', () => {
  const map = srcOf('../src/map/main.js');
  assert.ok(!map.includes('lastStagedPostT'), 'removed timestamp leaves no references');
});

test('gate 4: no albedo/ground-tone modulation of any kind', () => {
  const sector = srcOf('../src/ring2/sector.js');
  assert.ok(sector.includes('export const TWIN_TONE_SAT_MATCH = 1;'), 'tone law stays the neutral identity');
  // The per-frame grade plumbing still calls through, but the law is pinned
  // to exactly 1 at every mix — a neutral no-op, never a modulation.
  for (const m of [0, 1, 25, 50, 75, 99, 100, NaN, undefined]) {
    assert.equal(toneGradeForMix(m), 1, `tone grade neutral at mix ${String(m)}`);
  }
});

test('gate 5: lock-in arming predicates unchanged-or-wider', () => {
  const map = srcOf('../src/map/main.js');
  for (const token of ['stallCeilingPin(', 'preStallSwallowDue(', 'twinFrameHasContent()']) {
    assert.ok(map.includes(token), `${token} still arms the hold/commit path`);
  }
  const sector = srcOf('../src/ring2/sector.js');
  assert.ok(sector.includes('export function twinContentPass('), 'twin content gate still owned by sector.js');
  assert.ok(sector.includes('export function twinContentVerdict('), 'commit verdict predicate intact');
});
