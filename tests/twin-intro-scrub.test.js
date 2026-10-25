// tests/twin-intro-scrub.test.js — Task 36: the twin forward intro
// (hold -> swoop -> push) is a 0..1 scrub progress driving range/polar/
// target/mix through the shared poseForScrubProgress law — never wall
// clocks. The staged-scroll consumer maps the map-side S contract
// ([0,250,500,750,1250] ring/blend/tilt/reveal) onto that progress with the
// swoop/push boundary pinned to reveal start; enclosing + clip agree on one
// radius (RING_RADIUS_M); the DEM auto-redrape waits for flight-idle.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HANDOFF_SWOOP_MS,
  HANDOFF_PUSH_MS,
  HANDOFF_MORPH_MS,
  HANDOFF_START_MIX,
  HANDOFF_END_MIX,
  HANDOFF_ISO_POLAR_DEG,
  poseForScrubProgress,
  scrubTotalMs,
  easeInOutSmoother,
  buildForwardLegs,
  fwdProgressForStagedS,
  forwardRingPForProgress,
  isTwinStagedMessage,
  twinContentFromRgba,
  twinContentPass,
  fwdStagedOwnsIntro,
  fwdAutoplayHeld,
  TWIN_CONTENT_SAMPLE_N,
  TWIN_RGBA_STRIDE,
  TWIN_BYTE_MAX,
  TWIN_CONTENT_DARK_FLOOR,
  TWIN_CONTENT_MIN_COVERAGE,
  TWIN_CONTENT_MIN_SPREAD,
  TWIN_STAGED_MSG,
  TWIN_FWD_REVEAL_START_PX,
  TWIN_FWD_STAGED_MAX_PX,
} from '../src/ring2/sector.js';
import { SANGACHAL, RING_RADIUS_M } from '../src/ring2/site.js';
import { RIM_FADE_IN, rimFadeAlpha } from '../src/ring2/drape.js';
import { HANDOFF_STAGE_PX, HANDOFF_STAGED_S_MAX, stagedIntroProgressForS } from '../src/map/scrolltrigger.js';

register('./css-stub-loader.mjs', import.meta.url);
const { shouldDeferRedrape, REDRAPE_MAX_DEFERS } = await import('../src/ring2/overlays.js');

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

// Synthetic anchors: R0 top-down ring frame -> R0 iso-45 ring frame ->
// 18 km iso-45 terminal at a new center (proves target travel).
const R0 = 40000;
const C = Math.SQRT1_2;
const START_POSE = { eye: { x: 0, y: R0, z: 0.01 }, target: { x: 0, y: 0, z: 0 } };
const MID = { eye: { x: 0, y: R0 * C, z: R0 * C }, target: { x: 0, y: 0, z: 0 } };
const TERM = { eye: { x: 1000, y: 18000 * C, z: 500 + 18000 * C }, target: { x: 1000, y: 0, z: 500 } };
const SWOOP_W = HANDOFF_SWOOP_MS / (HANDOFF_SWOOP_MS + HANDOFF_PUSH_MS + HANDOFF_MORPH_MS);
const PUSH_W = (HANDOFF_SWOOP_MS + HANDOFF_PUSH_MS) / (HANDOFF_SWOOP_MS + HANDOFF_PUSH_MS + HANDOFF_MORPH_MS);
const PUSH_END_S = TWIN_FWD_REVEAL_START_PX
  + ((TWIN_FWD_STAGED_MAX_PX - TWIN_FWD_REVEAL_START_PX) * HANDOFF_PUSH_MS) / (HANDOFF_PUSH_MS + HANDOFF_MORPH_MS);

const rangeOf = (eye, target) => Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z);
const polarDegOf = (eye, target) => {
  const h = Math.hypot(eye.x - target.x, eye.z - target.z);
  return (Math.atan2(h, eye.y - target.y) * 180) / Math.PI;
};
const legs = () => buildForwardLegs({ startPose: START_POSE, mid: MID, to: TERM });

test('iso pole verified at 45 (map holds 45 through the cut — no snap)', () => {
  assert.equal(HANDOFF_ISO_POLAR_DEG, 45);
});

test('buildForwardLegs: swoop+push+settle legs, ms weights, from-chained, mix 0->0->0->100', () => {
  const l = legs();
  assert.equal(l.length, 3);
  assert.deepEqual(l.map((x) => x.name), ['swoop', 'push', 'settle']);
  assert.equal(l[0].ms, HANDOFF_SWOOP_MS);
  assert.equal(l[1].ms, HANDOFF_PUSH_MS);
  assert.equal(l[2].ms, HANDOFF_MORPH_MS);
  assert.equal(scrubTotalMs(l), HANDOFF_SWOOP_MS + HANDOFF_PUSH_MS + HANDOFF_MORPH_MS);
  assert.deepEqual(l[0].from, { eye: START_POSE.eye, target: START_POSE.target });
  assert.deepEqual(l[0].eye, MID.eye);
  assert.deepEqual(l[1].from, { eye: MID.eye, target: MID.target });
  assert.deepEqual(l[1].eye, TERM.eye);
  assert.deepEqual(l[2].from, { eye: TERM.eye, target: TERM.target });
  assert.deepEqual(l[2].eye, TERM.eye);
  assert.equal(l[0].mix, HANDOFF_START_MIX);
  assert.equal(l[0].fromMix, HANDOFF_START_MIX);
  assert.equal(l[1].fromMix, HANDOFF_START_MIX);
  assert.equal(l[1].mix, HANDOFF_START_MIX);
  assert.equal(l[2].fromMix, HANDOFF_START_MIX);
  assert.equal(l[2].mix, HANDOFF_END_MIX);
});

test('buildForwardLegs: null on missing/non-finite anchors (never a canned pose)', () => {
  assert.equal(buildForwardLegs({ startPose: START_POSE, mid: MID }), null);
  assert.equal(buildForwardLegs({}), null);
  assert.equal(buildForwardLegs(), null);
  const bad = { eye: { x: NaN, y: 1, z: 2 }, target: { x: 0, y: 0, z: 0 } };
  assert.equal(buildForwardLegs({ startPose: bad, mid: MID, to: TERM }), null);
});

test('scrub pose law endpoints: hold frame at 0, terminal at 1', () => {
  const l = legs();
  const s0 = poseForScrubProgress(l, 0);
  assert.deepEqual(s0.eye, START_POSE.eye);
  assert.deepEqual(s0.target, START_POSE.target);
  assert.equal(s0.mix, HANDOFF_START_MIX);
  assert.ok(Math.abs(rangeOf(s0.eye, s0.target) - R0) < 1, 'hold range is the handed range');
  assert.ok(polarDegOf(s0.eye, s0.target) < 0.5, 'hold is top-down');
  const s1 = poseForScrubProgress(l, 1);
  assert.deepEqual(s1.eye, TERM.eye);
  assert.deepEqual(s1.target, TERM.target);
  assert.equal(s1.mix, HANDOFF_END_MIX);
  assert.ok(Math.abs(rangeOf(s1.eye, s1.target) - 18000) < 1, 'terminal range 18 km');
  assert.ok(Math.abs(polarDegOf(s1.eye, s1.target) - 45) < 1e-6, 'terminal polar 45');
});

test('scrub pose law: swoop holds range, carries 0->45deg; push holds 45, dives range', () => {
  const l = legs();
  const sw = poseForScrubProgress(l, SWOOP_W);
  assert.ok(Math.abs(rangeOf(sw.eye, sw.target) - R0) < 1, 'swoop end keeps the handed range');
  assert.ok(Math.abs(polarDegOf(sw.eye, sw.target) - 45) < 1e-6, 'swoop end sits at iso 45');
  let prevPolar = -1;
  for (let p = 0; p <= SWOOP_W + 1e-9; p += SWOOP_W / 8) {
    const s = poseForScrubProgress(l, p);
    const pol = polarDegOf(s.eye, s.target);
    assert.ok(pol >= prevPolar - 1e-9, `p=${p} polar must not step back`);
    // Chord dip: the law lerps eye vectors (same lerp as the retired timed
    // engine, so scrub and timed agree pose-for-pose) — mid-swoop range
    // sags up to ~8% below R0, exact again at the leg boundary.
    assert.ok(Math.abs(rangeOf(s.eye, s.target) - R0) / R0 < 0.1, `p=${p} swoop holds range within the chord dip`);
    prevPolar = pol;
  }
  let prevRange = Infinity;
  let prevMix = -1;
  for (let p = SWOOP_W; p <= 1.0001; p += (1 - SWOOP_W) / 8) {
    const s = poseForScrubProgress(l, Math.min(1, p));
    assert.ok(Math.abs(polarDegOf(s.eye, s.target) - 45) < 1e-6, `p=${p} push holds polar 45`);
    const r = rangeOf(s.eye, s.target);
    assert.ok(r <= prevRange + 1e-6, `p=${p} push range must not grow`);
    assert.ok(s.mix >= prevMix - 1e-9, `p=${p} mix must not step back`);
    prevRange = r;
    prevMix = s.mix;
  }
  assert.deepEqual(poseForScrubProgress(l, 0.37), poseForScrubProgress(l, 0.37), 'pure function of progress');
});

test('ring reveal reads the same progress: 0 at hold, eased in swoop, 1 in push', () => {
  const l = legs();
  assert.equal(forwardRingPForProgress(l, 0), 0);
  assert.equal(forwardRingPForProgress(l, 1), 1);
  const mid = poseForScrubProgress(l, 0.2);
  assert.equal(mid.legIndex, 0);
  assert.equal(forwardRingPForProgress(l, 0.2), easeInOutSmoother(mid.t));
  const r = forwardRingPForProgress(l, 0.2);
  assert.ok(r > 0 && r < 1, 'mid-swoop stroke is mid-draw');
  for (const p of [SWOOP_W + 0.01, 0.75, 0.99]) {
    assert.equal(forwardRingPForProgress(l, p), 1, `p=${p} push holds the settled ring`);
  }
  assert.equal(forwardRingPForProgress(null, 0.5), null);
  assert.equal(forwardRingPForProgress([], 0.5), null);
});

test('staged-S consumer: swoop completes at reveal start, push rigid, settle morphs at commit', () => {
  assert.equal(fwdProgressForStagedS(0), 0);
  assert.equal(fwdProgressForStagedS(TWIN_FWD_REVEAL_START_PX), SWOOP_W);
  assert.ok(Math.abs(fwdProgressForStagedS(PUSH_END_S) - PUSH_W) < 1e-9, 'push band ends exactly on the settle boundary');
  assert.equal(fwdProgressForStagedS(TWIN_FWD_STAGED_MAX_PX), 1);
  assert.ok(Math.abs(fwdProgressForStagedS(375) - SWOOP_W / 2) < 1e-9, 'swoop leg tracks S linearly');
  // Round-6: the visible push carries no imagery change (rigid satellite),
  // the morph rides a static terminal pose.
  const l = legs();
  const atPush = poseForScrubProgress(l, (SWOOP_W + PUSH_W) / 2);
  assert.equal(atPush.mix, HANDOFF_START_MIX);
  assert.equal(atPush.legIndex, 1);
  const atMorph = poseForScrubProgress(l, (PUSH_W + 1) / 2);
  assert.deepEqual(atMorph.eye, TERM.eye);
  assert.ok(atMorph.mix > HANDOFF_START_MIX && atMorph.mix < HANDOFF_END_MIX);
  let prev = -1;
  for (let s = 0; s <= TWIN_FWD_STAGED_MAX_PX + 250; s += 25) {
    const p = fwdProgressForStagedS(s);
    assert.ok(p >= prev - 1e-12 && p >= 0 && p <= 1, `S=${s} monotonic in [0,1]`);
    prev = p;
  }
  assert.equal(fwdProgressForStagedS(-50), 0, 'pre-gate parks at 0');
  assert.equal(fwdProgressForStagedS(99999), 1, 'past commit parks at 1');
  assert.equal(fwdProgressForStagedS(NaN), 0, 'non-finite parks at 0');
});

test('staged anchors mirror the map-side contract (break loudly, never drift)', () => {
  assert.equal(TWIN_FWD_REVEAL_START_PX, 3 * HANDOFF_STAGE_PX, 'swoop boundary = reveal start (750)');
  assert.equal(TWIN_FWD_STAGED_MAX_PX, HANDOFF_STAGED_S_MAX, 'push end = staged commit (1250)');
});

test('map/twin single pacing law: reveal(S) == intro progress(S) at every tick', () => {
  // The map overlay dissolve and the twin intro scrub share one law
  // (stagedIntroProgressForS, scrolltrigger.js single source — the twin
  // delegates). Mid-band knees agree exactly: no linear lead, no lag.
  for (let s = 0; s <= TWIN_FWD_STAGED_MAX_PX + 250; s += 25) {
    const a = stagedIntroProgressForS(s);
    const b = fwdProgressForStagedS(s);
    assert.ok(Math.abs(a - b) < 1e-12, `S=${s} map ${a} == twin ${b}`);
  }
  assert.equal(stagedIntroProgressForS(750), fwdProgressForStagedS(750), 'swoop knee agrees');
  assert.ok(Math.abs(stagedIntroProgressForS(750) - SWOOP_W) < 1e-12, 'swoop knee is the intro weight');
  assert.equal(stagedIntroProgressForS(1250), 1, 'commit agrees at 1');
  assert.equal(stagedIntroProgressForS(NaN), fwdProgressForStagedS(NaN), 'parks agree');
});

test('staged wire format names the channel, matches nothing else', () => {
  assert.equal(isTwinStagedMessage({ type: TWIN_STAGED_MSG, s: 100 }), true);
  assert.equal(isTwinStagedMessage({ type: 'safepipe-twin-close', recede: true }), false);
  assert.equal(isTwinStagedMessage({ type: 'safepipe-twin-ready' }), false);
  assert.equal(isTwinStagedMessage({ type: 'safepipe-twin-fullscreen', on: true }), false);
  assert.equal(isTwinStagedMessage(TWIN_STAGED_MSG), false);
  assert.equal(isTwinStagedMessage(null), false);
});

test('radius unification: one source, three consumers, one fade band', () => {
  assert.equal(RING_RADIUS_M, 10000);
  assert.equal(RING_RADIUS_M, SANGACHAL.radiusKm * 1000, 'site.js is the single source');
  assert.equal(RIM_FADE_IN, 0.9, 'fade band starts at 0.9 R');
  const mapbase = srcOf('../src/ring2/mapbase.js');
  assert.ok(mapbase.includes('const R = RING_RADIUS_M'), 'hard mask reads RING_RADIUS_M');
  assert.ok(!mapbase.includes('radiusKm * 1000'), 'no second radius source in mapbase');
  const overlays = srcOf('../src/ring2/overlays.js');
  assert.ok(overlays.includes('uRingR = { value: RING_RADIUS_M }'), 'clip shader reads RING_RADIUS_M');
  assert.ok(overlays.includes('uFadeIn = { value: RIM_FADE_IN }'), 'clip fade shares the rim band');
  assert.ok(overlays.includes('uRimR = { value: RING_RADIUS_M }'), 'rim vignette reads RING_RADIUS_M');
  // Numeric agreement: the clip shader fades overlays as
  // 1-smoothstep(0.9R,R,rr) (opaque inside, gone at R) while the rim
  // vignette darkens as smoothstep(0.9R,R,rr) (clear inside, MASK_COL at
  // R) — complementary laws on the SAME band edges, so the dissolve hands
  // over with no step.
  const smooth = (a, b, x) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  for (const f of [0.0, 0.5, 0.89, 0.9, 0.92, 0.95, 0.99, 1.0, 1.2]) {
    const rr = RING_RADIUS_M * f;
    const band = smooth(RING_RADIUS_M * RIM_FADE_IN, RING_RADIUS_M, rr);
    assert.ok(Math.abs(rimFadeAlpha(rr) - band) < 1e-12, `rr=${f}R: rim follows the shared band`);
    assert.ok(Math.abs((1 - rimFadeAlpha(rr)) - (1 - band)) < 1e-12, `rr=${f}R: clip is the complement`);
  }
});

test('redrape waits for flight-idle (bounded — a parked hold cannot pin stale drape)', () => {
  assert.equal(
    shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 100, defers: 0, flightIdle: false }),
    true,
    'mid-flight defers even with a settled view',
  );
  assert.equal(
    shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 100, defers: 0, flightIdle: true }),
    false,
    'idle falls through to the slide rule',
  );
  assert.equal(
    shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 999, defers: REDRAPE_MAX_DEFERS, flightIdle: false }),
    false,
    'the defer bound still wins mid-flight',
  );
  assert.equal(shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 900 }), true, 'default stays slide-ruled');
  assert.equal(shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 100 }), false, 'default stays slide-ruled');
});

test('twin wiring: scrub-owned forward, shelved cap, staged consumer, idle-gated redrape', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(main.includes('poseForScrubProgress(fwd.legs, fwd.progress)'), 'forward pose reads the scrub law');
  assert.ok(main.includes('forwardRingPForProgress(handoff.fwd?.legs'), 'ring reads the same progress');
  assert.ok(main.includes('buildForwardLegs({'), 'legs frozen at hold exit');
  assert.ok(!main.includes('capDue'), '25 s blind-advance cap is shelved');
  assert.ok(main.includes('handoff.capExpired = true'), 'parked hold raises capExpired for the probe');
  assert.ok(main.includes('isTwinStagedMessage(e?.data)'), 'parent staged-scroll channel is received');
  assert.ok(main.includes('fwdProgressForStagedS(handoff.fwdStagedS'), 'staged S drives progress');
  assert.ok(main.includes('isFlightIdle'), 'flight-idle feed passed to the twin');
  const overlays = srcOf('../src/ring2/overlays.js');
  assert.ok(overlays.includes('flightIdle: flightIdle()'), 'redrape consults flight-idle');
  // Round-5 way-back lockstep: every close posts from ring-iso at mix 0
  // (matches the parent cut) — never the top-down hold frame.
  assert.ok(main.includes('function pinReverseEnd()'), 'reverse end pin helper exists');
  assert.ok(
    (main.match(/pinReverseEnd\(\)/g) || []).length >= 4,
    'all three completion sites + helper pin the ring-iso end',
  );
  assert.ok(main.includes("=== 'swoop'"), 'reverse legs truncate at the ring-iso leg');
  assert.ok(main.includes('handoff.mid'), 'reverse end reads the live mid anchor');
});

// Lane T, Part A: the pixel fold. A transparent/blank twin (all zeros —
// exactly what an unpainted RGBA buffer reads) withholds: coverage 0,
// spread 0, ok false. A sparse bright cluster on black (the amber-arc
// case) passes. A flat wash — mid grey everywhere, coverage 1 — still
// fails on spread. Malformed input returns null, never a guess.
test('twin content fold: blank withholds, sparse arc passes, flat wash fails', () => {
  assert.equal(TWIN_CONTENT_SAMPLE_N, 64);
  assert.equal(TWIN_RGBA_STRIDE, 4);
  assert.equal(TWIN_BYTE_MAX, 255);
  const px2 = TWIN_CONTENT_SAMPLE_N * 2; // center cross: row + column
  const blank = new Uint8Array(px2 * TWIN_RGBA_STRIDE);
  const b = twinContentFromRgba(blank);
  assert.deepEqual(b, { coverage: 0, spread: 0, ok: false });
  // Sparse arc: mostly black, one bright amber-ish run.
  const arc = new Uint8Array(px2 * TWIN_RGBA_STRIDE);
  for (let i = 0; i < 8 * TWIN_RGBA_STRIDE; i += TWIN_RGBA_STRIDE) {
    arc[i] = TWIN_BYTE_MAX;
    arc[i + 1] = 180;
    arc[i + 2] = 80;
    arc[i + 3] = TWIN_BYTE_MAX;
  }
  const a = twinContentFromRgba(arc);
  assert.ok(a.coverage >= TWIN_CONTENT_MIN_COVERAGE, `arc coverage ${a.coverage}`);
  assert.ok(a.spread >= TWIN_CONTENT_MIN_SPREAD, `arc spread ${a.spread}`);
  assert.equal(a.ok, true);
  // Flat wash: every pixel mid grey — lit, but zero variation.
  const flat = new Uint8Array(px2 * TWIN_RGBA_STRIDE).fill(128);
  const f = twinContentFromRgba(flat);
  assert.equal(f.coverage, 1);
  assert.ok(f.spread < TWIN_CONTENT_MIN_SPREAD, `flat spread ${f.spread} below the floor`);
  assert.equal(f.ok, false);
  // Dark floor: near-black noise stays dark.
  assert.ok(TWIN_CONTENT_DARK_FLOOR > 8 / TWIN_BYTE_MAX, 'floor sits above near-black noise');
  // Malformed input withholds.
  assert.equal(twinContentFromRgba(null), null);
  assert.equal(twinContentFromRgba(undefined), null);
  assert.equal(twinContentFromRgba(new Uint8Array(0)), null);
  assert.equal(twinContentFromRgba(new Uint8Array(7)), null);
  assert.equal(twinContentFromRgba([0, 0, NaN, 255]), null);
});

test('twin content gate: frames/idle/live/pixels all required, non-finite withholds', () => {
  const good = { frames: 3, mapIdle: true, sceneLive: true, coverage: 0.5, spread: 0.2 };
  assert.equal(twinContentPass(good), true);
  assert.equal(twinContentPass({ ...good, frames: 2 }), false, 'below prewarm floor withholds');
  assert.equal(twinContentPass({ ...good, mapIdle: false }), false);
  assert.equal(twinContentPass({ ...good, sceneLive: false }), false);
  assert.equal(twinContentPass({ ...good, coverage: 0 }), false, 'blank withholds');
  assert.equal(twinContentPass({ ...good, spread: 0 }), false, 'flat wash withholds');
  assert.equal(twinContentPass({ ...good, coverage: null }), false, 'unsampled withholds');
  assert.equal(twinContentPass({ ...good, coverage: NaN }), false, 'non-finite withholds');
  assert.equal(twinContentPass({ ...good, spread: NaN }), false, 'non-finite withholds');
  assert.equal(twinContentPass({ ...good, frames: NaN }), false, 'non-finite withholds');
  assert.equal(twinContentPass(), false);
  assert.equal(twinContentPass({}), false);
});

// Lane T, Part B: ownership of the intro scalar. Any finite staged seed
// (even 0 — the map posts S=0 on first drive) or a deep handed frame
// parks the scalar on the fingers; the shallow click path with no seed
// keeps the autoplay clock.
test('autoplay hold: staged owns the scalar, absent driver releases the clock', () => {
  assert.equal(fwdStagedOwnsIntro({ stagedS: 0, deepFrame: false }), true, 'S=0 seed owns');
  assert.equal(fwdStagedOwnsIntro({ stagedS: 750, deepFrame: false }), true);
  assert.equal(fwdStagedOwnsIntro({ stagedS: null, deepFrame: true }), true, 'deep frame parks without a seed');
  assert.equal(fwdStagedOwnsIntro({ stagedS: null, deepFrame: false }), false, 'shallow click autoplays');
  assert.equal(fwdStagedOwnsIntro({ stagedS: NaN, deepFrame: false }), false, 'non-finite seed is no driver');
  assert.equal(fwdStagedOwnsIntro(), false);
  assert.equal(fwdAutoplayHeld({ staged: true, stagedS: null }), true, 'flagged flight holds');
  assert.equal(fwdAutoplayHeld({ staged: false, stagedS: 375 }), true, 'seed alone holds the clock');
  assert.equal(fwdAutoplayHeld({ staged: false, stagedS: 0 }), true, 'S=0 seed holds');
  assert.equal(fwdAutoplayHeld({ staged: false, stagedS: null }), false, 'no driver releases the clock');
  assert.equal(fwdAutoplayHeld({ staged: false, stagedS: NaN }), false);
  assert.equal(fwdAutoplayHeld(), false);
});

test('twin wiring: pixel sample after render + autoplay hold (Lane T)', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(main.includes('fwdStagedOwnsIntro({ stagedS:'), 'release reads the single ownership law');
  assert.ok(main.includes('fwdAutoplayHeld({ staged:'), 'advance holds the clock while staged owns it');
  assert.ok(main.includes('coverage, spread }'), 'content() exposes the pixel fold');
  assert.ok(main.includes('twin.sampleContent()'), 'content() reads the twin sampler');
  assert.ok(main.includes('isTwinStagedMessage(e?.data)'), 'staged listener still receives the map-side channel');
  assert.ok(main.includes('setStagedS: (s) => applyTwinStagedS(s)'), 'staged probe setter intact');
  const overlays = srcOf('../src/ring2/overlays.js');
  assert.ok(overlays.includes('gl.readPixels'), 'pixels read from the live GL buffer');
  assert.ok(overlays.includes('sampleFreshContent()'), 'sampled synchronously after render');
  assert.ok(overlays.includes('twinContentFromRgba(joined)'), 'sample folded through the pure law');
  assert.ok(overlays.includes('sampleContent,'), 'sampler exposed on the twin object');
  assert.ok(!overlays.includes('preserveDrawingBuffer'), 'no backbuffer retention — sync read is the only honest path');
});
