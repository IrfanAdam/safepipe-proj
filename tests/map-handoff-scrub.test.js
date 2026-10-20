// tests/map-handoff-scrub.test.js — Task 35: the outbound handoff is a
// zoom-scrubbed staged crossfade, never a timed flight. Past Z_HANDOFF the
// map holds z (maxZoom clamp) and further scroll ticks accumulate as stage
// scroll S (px): ring -> blend -> tilt holds, then the twin dissolve — each
// a pure function of S, symmetric on scroll-up. Sat rides the scrub law
// (pure fn of z); map pitch carries 45 through the cut to meet the twin
// iso pole at 45 under the shared 36.87deg FOV.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Z_MIN,
  Z_HANDOFF,
  Z_MAX,
  Z_TWIN_COMMIT,
  handoffScrubForZoom,
  HANDOFF_STAGE_PX,
  HANDOFF_REVEAL_LEN_PX,
  HANDOFF_STAGED_S_MAX,
  handoffStagesForScroll,
  satOpacityForZoom,
  pitchTargetForZoom,
  ISO_PITCH_DEG,
} from '../src/map/scrolltrigger.js';
import { HANDOFF_ISO_POLAR_DEG } from '../src/ring2/sector.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('handoff scrub law: 0 at/below gate, 1 at/above commit, smooth inside', () => {
  assert.equal(Z_TWIN_COMMIT, 13.0, 'dissolve band ends one level past handoff');
  assert.ok(Z_TWIN_COMMIT > Z_HANDOFF && Z_TWIN_COMMIT <= Z_MAX, 'commit sits inside the zoom cap');
  assert.equal(handoffScrubForZoom(Z_HANDOFF), 0, 'gate starts at 0');
  assert.equal(handoffScrubForZoom(Z_HANDOFF - 3), 0, 'below gate parks at 0');
  assert.equal(handoffScrubForZoom(Z_TWIN_COMMIT), 1, 'commit arrives at 1');
  assert.equal(handoffScrubForZoom(Z_MAX), 1, 'cap holds at 1');
  assert.equal(handoffScrubForZoom((Z_HANDOFF + Z_TWIN_COMMIT) / 2), 0.5, 'band midpoint is 0.5');
  assert.equal(handoffScrubForZoom(NaN), 0, 'non-numeric parks at 0');
});

test('handoff scrub law is monotonic non-decreasing', () => {
  let prev = -1;
  for (let z = Z_MIN; z <= Z_MAX + 1; z += 0.25) {
    const p = handoffScrubForZoom(z);
    assert.ok(p >= prev - 1e-9, `z=${z} must not step back (${prev} -> ${p})`);
    assert.ok(p >= 0 && p <= 1, `z=${z} stays in [0,1]`);
    prev = p;
  }
});

test('stage gates: ring -> blend -> tilt -> reveal in order, isolated', () => {
  assert.equal(HANDOFF_STAGE_PX, 250, 'one stage per 250px of scroll');
  assert.equal(HANDOFF_REVEAL_LEN_PX, 500, 'reveal dissolves over 500px');
  assert.equal(HANDOFF_STAGED_S_MAX, 1250, 'full commit at 1250px past the gate');
  const zero = handoffStagesForScroll(0);
  assert.deepEqual(zero, { ring: 0, blend: 0, tilt: 0, reveal: 0 }, 'gate entry starts every stage at 0');
  const mid1 = handoffStagesForScroll(125);
  assert.ok(mid1.ring > 0 && mid1.ring < 1, 'ring dissolves first');
  assert.equal(mid1.blend, 0, 'blend waits for its gate');
  assert.equal(mid1.tilt, 0, 'tilt waits for its gate');
  assert.equal(mid1.reveal, 0, 'reveal waits for its gate');
  const atRing = handoffStagesForScroll(HANDOFF_STAGE_PX);
  assert.equal(atRing.ring, 1, 'ring holds complete at its gate');
  assert.equal(atRing.blend, 0, 'blend still gated');
  const midReveal = handoffStagesForScroll(1000);
  assert.equal(midReveal.ring, 1, 'ring holds');
  assert.equal(midReveal.blend, 1, 'blend holds');
  assert.equal(midReveal.tilt, 1, 'tilt holds');
  assert.ok(midReveal.reveal > 0 && midReveal.reveal < 1, 'reveal dissolves last');
  const full = handoffStagesForScroll(HANDOFF_STAGED_S_MAX);
  assert.deepEqual(full, { ring: 1, blend: 1, tilt: 1, reveal: 1 }, 'commit holds every stage at 1');
  const over = handoffStagesForScroll(HANDOFF_STAGED_S_MAX + 9999);
  assert.deepEqual(over, full, 'past commit parks at full');
});

test('stage law is pure: same S, same stages; monotonic; non-finite parks', () => {
  assert.deepEqual(handoffStagesForScroll(777), handoffStagesForScroll(777), 'pure function of S');
  for (const k of ['ring', 'blend', 'tilt', 'reveal']) {
    let prev = -1;
    for (let s = 0; s <= HANDOFF_STAGED_S_MAX + 250; s += 25) {
      const v = handoffStagesForScroll(s)[k];
      assert.ok(v >= prev - 1e-9, `S=${s} ${k} must not step back`);
      assert.ok(v >= 0 && v <= 1, `S=${s} ${k} stays in [0,1]`);
      prev = v;
    }
  }
  assert.deepEqual(
    handoffStagesForScroll(NaN),
    { ring: 0, blend: 0, tilt: 0, reveal: 0 },
    'non-numeric parks every stage at 0',
  );
});

test('forward sat is full at the gate (pure fn of z, never a timed ramp)', () => {
  assert.equal(satOpacityForZoom(Z_HANDOFF), 1, 'sat already full where the hold starts');
  assert.equal(satOpacityForZoom(Z_HANDOFF + 2), 1, 'sat holds full past the gate');
});

test('map pitch 45 meets twin polar: carry-through, no 5deg snap', () => {
  assert.equal(ISO_PITCH_DEG, 45, 'map iso tilt ends at 45deg');
  assert.equal(HANDOFF_ISO_POLAR_DEG, 45, 'twin iso pole meets it at 45deg');
  assert.equal(HANDOFF_ISO_POLAR_DEG, ISO_PITCH_DEG, 'endpoints coincide');
  assert.equal(pitchTargetForZoom(Z_HANDOFF), 45, 'gate arrives at iso');
  assert.equal(pitchTargetForZoom(Z_MAX), 45, 'hold carries 45 through the cut');
});

test('driver: timed flight gone, staged scrub owns the outbound path', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(!main.includes('duration: 650'), '650ms handoff flight is gone');
  assert.ok(!main.includes('warmSatTiles'), 'flight-time sat pre-warm is gone');
  assert.ok(!main.includes('setTimeout(finish, 3500)'), 'moveend fallback is gone');
  assert.ok(main.includes('setSatScrubbed(satOpacityForZoom'), 'forward sat rides the scrub law');
  assert.ok(main.includes('setMaxZoom(Z_HANDOFF)'), 'scroll-as-zoom clamps at the gate');
  assert.ok(main.includes('installStagedAccum'), 'stage-scroll accumulator is wired');
  assert.ok(main.includes('prewarmThenReveal(id, liveFrame(), { ...opts, staged: true })'), 'near-gate arrival stages');
  assert.ok(main.includes('grant slides the same paint-gated fallback'), 'staged grants slide the fallback window — S owns the dissolve');
  assert.ok(main.includes('driveStagedOverlay'), 'twin-ready routes through the staged driver');
  assert.ok(main.includes('exitStaged()'), 'zoomend settle unwinds the hold');
  // The timed ramp survives ONLY on the reverse path (Task 37 owns it).
  const forcedOn = (main.match(/setSatForced\(true\)/g) || []).length;
  assert.equal(forcedOn, 1, 'one setSatForced(true) left — the twin recede:true reverse handler');
});
