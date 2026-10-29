// tests/map-staged-apply-order.test.js — the two measured forward defects of
// the staged dissolve, pinned as laws:
//
//  (1) SEAM POP (apply order): the twin frame's own satellite base applied the
//      handed frame a beat late (measured on 4ebde07: base z10.908 inside the
//      z11.5 clip on the first VISIBLE dissolve tick, corrected two S ticks
//      later). stagedBaseParity() is the verdict the written overlay now waits
//      on — same zoom within 0.05, same centre within 1.5px at the handed z —
//      and the map is wired to hold the ramp (and the commit) on it, forward
//      only, bounded by the pixel verdict's patience.
//
//  (2) STAIR STEPS: the twin melt reads the S the map POSTS. Posting the raw
//      per-notch S stepped the forward mix 0,35,50,75,75,87,100 over seven
//      wheel ticks while the reverse retraced continuously. stagedPostStep()
//      is the per-frame ease the pump posts; stagedS itself stays the exact
//      law (probe/commit), and the commit waits for the posted value to land.
//
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stagedBaseParity,
  STAGED_BASE_Z_TOL,
  STAGED_BASE_CENTER_PX,
  stagedPostStep,
  stagedPostSettled,
  STAGED_POST_FOLLOW,
  STAGED_POST_EPS_PX,
  HANDOFF_STAGED_S_MAX,
  Z_HANDOFF,
  stagedIntroProgressForS,
} from '../src/map/scrolltrigger.js';
import { SITE } from '../src/map/feed.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

// The measured frozen base: 4ebde07 handed z11.5 over SITE, the twin's base
// still at 10.908 on the first visible dissolve tick.
const HANDED = { z: Z_HANDOFF, lng: SITE.lon, lat: SITE.lat };
const LATE_BASE = { z: 10.908074239332047, lng: SITE.lon, lat: SITE.lat };

const parity = (handed, base, extra = {}) => stagedBaseParity({
  handedZ: handed.z, handedLng: handed.lng, handedLat: handed.lat,
  baseZ: base.z, baseLng: base.lng, baseLat: base.lat,
  ...extra,
});

test('base parity: the measured one-zoom-late base is NOT parity', () => {
  const v = parity(HANDED, LATE_BASE);
  assert.equal(v.readable, true, 'a live base is readable');
  assert.equal(v.ok, false, 'z10.908 does not equal the handed z11.5');
  assert.ok(Math.abs(v.dz + 0.591925760667953) < 1e-6, `dz is the measured lag (${v.dz})`);
  assert.ok(v.centerM !== null && v.centerM < 0.01, 'the centre matched; the zoom is what lagged');
});

test('base parity: applied frame passes at the tolerance edge', () => {
  assert.equal(parity(HANDED, { ...HANDED }).ok, true, 'exact handed pose is parity');
  assert.equal(parity(HANDED, { ...HANDED, z: Z_HANDOFF + STAGED_BASE_Z_TOL }).ok, true, 'z tolerance edge passes');
  assert.equal(parity(HANDED, { ...HANDED, z: Z_HANDOFF + STAGED_BASE_Z_TOL + 0.01 }).ok, false, 'past the tolerance fails');
  assert.equal(parity(HANDED, { ...HANDED, z: Z_HANDOFF - 0.6 }).ok, false, 'one zoom behind fails');
});

test('base parity: centre epsilon is pixels at the handed zoom, not a degree literal', () => {
  const mpp = parity(HANDED, { ...HANDED }).mpp;
  assert.ok(Number.isFinite(mpp) && mpp > 0, 'the metres-per-pixel law resolves the handed zoom');
  const epsM = mpp * STAGED_BASE_CENTER_PX;
  const dLat = (epsM * 0.5) / 111320; // half the budget, north
  const atEdge = parity(HANDED, { ...HANDED, lat: SITE.lat + dLat });
  assert.equal(atEdge.ok, true, 'half the centre budget passes');
  assert.ok(Math.abs(atEdge.centerM - epsM * 0.5) < 0.05, 'the published centre error is in metres');
  const outside = parity(HANDED, { ...HANDED, lat: SITE.lat + (epsM * 2) / 111320 });
  assert.equal(outside.ok, false, 'twice the budget fails — the seam would offset by >3px');
});

test('base parity: unreadable / non-finite input is never approval', () => {
  const dead = stagedBaseParity({});
  assert.equal(dead.readable, false, 'no values read = unreadable');
  assert.equal(dead.ok, false, 'unreadable is never parity (the caller bounds the wait)');
  const noHanded = stagedBaseParity({ baseZ: Z_HANDOFF, baseLng: SITE.lon, baseLat: SITE.lat });
  assert.equal(noHanded.readable, true, 'the base can still be read');
  assert.equal(noHanded.ok, false, 'a base with no handed pose to compare against is not parity');
  // A NaN tolerance falls back to the shared default — it can only narrow to
  // the shipped law, never widen the gate.
  assert.equal(parity(HANDED, { ...HANDED }, { zTol: NaN }).ok, true, 'NaN tolerance falls back to the default law');
});

test('base parity: pure — same poses, same verdict', () => {
  assert.deepEqual(parity(HANDED, LATE_BASE), parity(HANDED, LATE_BASE), 'no hidden state');
});

test('eased post: seven 100px ticks glide instead of stepping', () => {
  // Reproduce the measured cadence: 100px wheel ticks every 85ms, 60fps frames,
  // the law's S stepping 0,100,...700 while the posted value eases per frame.
  const TICK_MS = 85;
  const FRAME_MS = 1000 / 60;
  let law = 0;
  let post = 0;
  let t = 0;
  const mixAt = (s) => 100 * stagedIntroProgressForS(s);
  const series = [];
  for (let tick = 0; tick < 7; tick += 1) {
    law = Math.min(HANDOFF_STAGED_S_MAX, law + 100);
    const until = t + TICK_MS;
    while (t < until) {
      post = stagedPostStep({ cur: post, target: law });
      series.push(+mixAt(post).toFixed(3));
      t += FRAME_MS;
    }
  }
  // let the follower land after the last tick (the commit waits on exactly this)
  for (let i = 0; i < 40; i += 1) {
    post = stagedPostStep({ cur: post, target: law });
    series.push(+mixAt(post).toFixed(3));
  }
  assert.equal(post, HANDOFF_STAGED_S_MAX, 'the posted S lands exactly on S max');
  const band = series.filter((m) => m > 0 && m < 100);
  assert.ok(band.length > 20, `the glide owns the band (${band.length} in-band frames)`);
  assert.ok(new Set(series).size >= 12, `at least 12 distinct mix values (${new Set(series).size})`);
  // no plateau longer than one tick (85ms = ~5 frames), inside the visible band
  let run = 1;
  let longest = 1;
  for (let i = 1; i < band.length; i += 1) {
    if (band[i] === band[i - 1]) run += 1; else run = 1;
    longest = Math.max(longest, run);
  }
  assert.ok(longest * FRAME_MS <= TICK_MS, `no plateau longer than one tick (${(longest * FRAME_MS).toFixed(0)}ms)`);
  // the raw law it replaces is what stepped: 8 postings, 5 distinct
  const rawSeries = [0, 100, 200, 300, 400, 500, 600, 700].map((s) => +mixAt(s).toFixed(3));
  assert.ok(new Set(rawSeries).size < new Set(series).size, 'the eased stream is strictly richer than the raw stairs');
});

test('eased post: monotonic, parks on target, reduced motion jumps', () => {
  let cur = 0;
  let prev = -1;
  for (let i = 0; i < 30; i += 1) {
    cur = stagedPostStep({ cur, target: 420 });
    assert.ok(cur >= prev - 1e-9, 'the follower never steps back toward a forward target');
    assert.ok(cur <= 420 + 1e-9, 'the follower never overshoots');
    prev = cur;
  }
  assert.equal(cur, 420, 'it parks exactly on the target');
  assert.equal(stagedPostStep({ cur: 0, target: 700, reduce: true }), 700, 'reduced motion jumps (no ease)');
  assert.equal(stagedPostStep({ cur: 300, target: NaN }), 300, 'a non-finite law holds the current value');
  assert.equal(STAGED_POST_FOLLOW > 0 && STAGED_POST_FOLLOW <= 1, true, 'the chase factor is a real fraction');
});

test('eased post: reverse drains symmetrically through the same follower', () => {
  let cur = HANDOFF_STAGED_S_MAX;
  const seen = [];
  for (let i = 0; i < 60 && cur > 0; i += 1) {
    cur = stagedPostStep({ cur, target: 0 });
    seen.push(cur);
  }
  assert.equal(cur, 0, 'scroll-up drains to 0 with no residue');
  assert.ok(seen.length > 3, 'the drain is a glide, not a single jump');
});

test('commit waits on the posted value, not the raw law', () => {
  assert.equal(stagedPostSettled({ cur: HANDOFF_STAGED_S_MAX }), true, 'S max settled');
  assert.equal(stagedPostSettled({ cur: HANDOFF_STAGED_S_MAX - STAGED_POST_EPS_PX }), true, 'inside the epsilon');
  assert.equal(stagedPostSettled({ cur: HANDOFF_STAGED_S_MAX - 100 }), false, 'a post still climbing holds the cut');
  assert.equal(stagedPostSettled({ cur: NaN }), false, 'unreadable post never commits');
});

test('map wiring: the ramp and the cut both wait on base parity, reverse never does', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('function twinBasePose()'), 'the twin frame base is read (same-origin __ring2.map)');
  assert.ok(main.includes('win.__ring2'), 'the reader goes through the twin probe surface');
  assert.ok(main.includes('function stagedBaseParityCheck('), 'the verdict + patience wrapper exists');
  assert.ok(
    main.includes('if (inBand && v.readable && !v.ok)'),
    'patience runs in-band and readable; it is bounded whether or not the frame released (the feeder now freezes S on this gate)',
  );
  assert.ok(
    main.includes('stagedBaseParityCheck(true, released)'),
    'the feeder consults the same verdict before advancing S — the law cannot outrun the applied frame',
  );
  assert.ok(
    main.includes('!v.ok && !baseParityIgnored && stagedFeedFwd'),
    'the gate is forward only — reverse never waits on the pose it retreats from',
  );
  assert.ok(
    main.includes('const BASE_PARITY_HOLD_MS = CONTENT_VERDICT_HOLD_MS;'),
    'the gate is bounded by the existing content-verdict patience (a dead frame cannot park the dive)',
  );
  assert.ok(
    main.includes('const effReveal = (tilesHold || parityHold) ? 0 : st.reveal;'),
    'the written ramp stays 0 until the twin base has applied the handed frame',
  );
  assert.ok(main.includes('if (parityHold) {'), 'the commit holds while the base still trails');
  assert.ok(
    main.includes('const st = handoffStagesForScroll(stagedS);'),
    'the S law stays pure and untouched — only the written opacity is gated',
  );
  assert.ok(
    main.includes('baseParity: parity ? !!parity.ok : null,'),
    'the probe publishes the verdict',
  );
  assert.ok(
    main.includes('baseZ: parity && parity.read ? +parity.read.z.toFixed(4) : null,'),
    'the probe publishes the zoom it was read from',
  );
  assert.ok(
    main.includes('stagedHanded = stagedFrame && Number.isFinite(+stagedFrame.z)'),
    'the handed frame is captured at arm, not re-read later',
  );
});

test('map wiring: eased post pump + commit landing are wired, band untouched', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('function pumpStagedPostS(snapToLaw = false)'), 'the per-frame eased pump exists');
  assert.ok(
    main.includes('stagedPostCur = stagedPostStep({ cur: stagedPostCur, target: stagedS, reduce });'),
    'one eased step per animation frame toward the exact law',
  );
  assert.ok(
    main.includes("if (!stagedPostSettled({ cur: stagedPostCur })) {"),
    'the cut waits for the posted melt to finish',
  );
  assert.ok(
    main.includes('if (nowR - stagedCommitRetryT >= STAGED_COMMIT_RETRY_MS)'),
    'the pump retries the commit when the post lands (standing fingers still commit)',
  );
  assert.ok(main.includes('function driveStagedOverlay() {'), 'the re-entrancy wrapper keeps nested drives no-ops');
  assert.ok(main.includes('function driveStagedOverlayInner() {'), 'the drive body is intact behind it');
  assert.ok(main.includes('stagedFeedFwd = dy < 0;'), 'the feeder stamps the tick direction');
  // Band length now the owner-eval short band (560), still one shared constant.
  assert.ok(main.includes('HANDOFF_STAGED_S_MAX'), 'the band length is still the shared constant');
  assert.ok(!main.includes('HANDOFF_STAGED_S_MAX = 8'), 'no re-literal of the band length');
});
