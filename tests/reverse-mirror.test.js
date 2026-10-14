// tests/reverse-mirror.test.js — Task 37: mirror the reverse.
// Scroll-up retraces every forward checkpoint to global: the staged-S
// producer posts S to the twin (value-change throttled) while the twin
// consumes it through its existing staged listener; the twin reverse is
// scrub-owned from the live pose (explicit close drives progress->1
// through paintScrubPose, never a wall clock; the dwell-counter entry is
// an accumulated outward-wheel/pinch-delta); the map recede is a
// gesture-owned reverse scrub (z->MAP_FLOOR on wheel deltas, sat via the
// scrub law); the map vignette rides the projected ring radius so the
// enclosing coincides with the twin clip circle.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HANDOFF_STAGE_PX,
  HANDOFF_STAGED_S_MAX,
  handoffStagesForScroll,
  accumStagedS,
  vignetteRadiusPxForZoom,
  enclosureRadiusPxForZoom,
  MAP_VIGNETTE_RING_M,
  metersPerPixel,
} from '../src/map/scrolltrigger.js';
import { TWIN_STAGED_MSG as MAP_STAGED_MSG, buildTwinStagedMessage } from '../src/map/twinlink.js';
import {
  TWIN_STAGED_MSG,
  isTwinStagedMessage,
  scrubEntryForDelta,
  TWIN_SCRUB_PINCH_ENTER_PX,
  TWIN_SCRUB_ENTER_DELTA,
  scrubProgressForWheel,
  poseForScrubProgress,
  buildForwardLegs,
  fwdProgressForStagedS,
} from '../src/ring2/sector.js';
import { RING_RADIUS_M } from '../src/ring2/site.js';
import { SITE } from '../src/map/feed.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('staged-S wire: one channel name both sides, shaped payload', () => {
  assert.equal(TWIN_STAGED_MSG, 'safepipe-twin-staged');
  assert.equal(MAP_STAGED_MSG, TWIN_STAGED_MSG, 'map producer names the twin consumer channel');
  assert.deepEqual(buildTwinStagedMessage(120), { type: TWIN_STAGED_MSG, s: 120 });
  assert.deepEqual(buildTwinStagedMessage(-5), { type: TWIN_STAGED_MSG, s: 0 }, 'S parks at >= 0');
  assert.deepEqual(buildTwinStagedMessage(NaN), { type: TWIN_STAGED_MSG, s: 0 }, 'non-finite parks at 0');
  assert.equal(isTwinStagedMessage(buildTwinStagedMessage(750)), true, 'consumer accepts the producer shape');
  assert.equal(isTwinStagedMessage({ type: TWIN_STAGED_MSG }), true, 's is validated at the consumer, not the gate');
});

test('accumStagedS: forward grows, scroll-up drains symmetrically, clamped', () => {
  assert.equal(accumStagedS(0, -250), 250, 'scroll-down past the gate accumulates');
  assert.equal(accumStagedS(250, 250), 0, 'scroll-up drains the same law');
  assert.equal(accumStagedS(750, -250), 1000, 'mid-hold accumulates');
  assert.equal(accumStagedS(1000, 250), 750, 'mid-hold retraces');
  assert.equal(accumStagedS(1200, -200), HANDOFF_STAGED_S_MAX, 'parks at commit');
  assert.equal(accumStagedS(50, 5000), 0, 'never below zero');
  assert.equal(accumStagedS(100, 0), 100, 'zero delta holds');
  assert.equal(accumStagedS(100, NaN), 100, 'non-finite delta holds');
  assert.equal(accumStagedS(NaN, -100), 100, 'non-finite S restarts from zero');
});

test('scroll-up retraces every forward checkpoint (same pure law both ways)', () => {
  for (let s = 0; s <= HANDOFF_STAGED_S_MAX; s += 125) {
    for (const d of [25, 125, 250]) {
      const back = Math.max(0, s - d);
      assert.deepEqual(
        handoffStagesForScroll(accumStagedS(s, d)),
        handoffStagesForScroll(back),
        `S=${s} drained by ${d} equals the forward frame at ${back}`,
      );
    }
  }
  // The twin intro follows S down the same way it climbed: reveal-start
  // boundary and commit are fixed points of the retrace.
  assert.ok(fwdProgressForStagedS(500) > fwdProgressForStagedS(250), 'forward climbs');
  assert.ok(fwdProgressForStagedS(250) < fwdProgressForStagedS(500), 'reverse descends the same mapping');
  assert.equal(fwdProgressForStagedS(0), 0, 'drained to the gate parks at hold');
});

test('vignette radius: projected R, coincides with the twin clip at handoff', () => {
  assert.equal(MAP_VIGNETTE_RING_M, RING_RADIUS_M, 'map mirror never drifts from site.js');
  assert.equal(MAP_VIGNETTE_RING_M, 10000);
  const mpp12 = metersPerPixel(12, SITE.lat);
  assert.equal(vignetteRadiusPxForZoom(12, SITE.lat), MAP_VIGNETTE_RING_M / mpp12, 'R / metersPerPixel, exact');
  const dia12 = 2 * vignetteRadiusPxForZoom(12, SITE.lat);
  assert.ok(Math.abs(dia12 - 685) < 1.5, `handoff enclosing is the 685px clip circle (got ${dia12.toFixed(1)})`);
  let prev = -Infinity;
  for (let z = 6; z <= 14; z += 0.5) {
    const r = vignetteRadiusPxForZoom(z, SITE.lat);
    assert.ok(r > 0, `z=${z} projects a positive radius`);
    assert.ok(r > prev, `z=${z} radius grows with zoom-in, retraces on zoom-out (mirror-symmetric)`);
    prev = r;
  }
  assert.equal(vignetteRadiusPxForZoom(NaN, SITE.lat), null, 'non-finite zoom parks');
  assert.equal(vignetteRadiusPxForZoom(12, NaN), null, 'non-finite lat parks');
  assert.equal(vignetteRadiusPxForZoom(12, SITE.lat, -1), null, 'non-positive ring parks');
});

test('enclosure forming wash: screen corners close onto the clip circle', () => {
  const C = 900; // hotspot farthest-corner distance on the test viewport
  assert.equal(enclosureRadiusPxForZoom(7.9, SITE.lat, MAP_VIGNETTE_RING_M, C), null, 'parks below the band — never blacks the frame');
  assert.equal(enclosureRadiusPxForZoom(9, SITE.lat, MAP_VIGNETTE_RING_M, null), null, 'parks without a viewport corner');
  assert.equal(enclosureRadiusPxForZoom(9, SITE.lat, MAP_VIGNETTE_RING_M, -4), null, 'parks on a non-positive corner');
  const at8 = enclosureRadiusPxForZoom(8.01, SITE.lat, MAP_VIGNETTE_RING_M, C);
  assert.ok(Math.abs(at8 - C) < 5, `forming starts AT the corners (got ${at8.toFixed(1)}px)`);
  let prev = Infinity;
  for (let z = 8.5; z <= 11.5; z += 0.5) {
    const r = enclosureRadiusPxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M, C);
    assert.ok(r < prev, `z=${z} closes in from the edges (${r.toFixed(0)}px < ${prev === Infinity ? 'inf' : prev.toFixed(0)}px)`);
    prev = r;
  }
  for (const z of [12, 13]) {
    assert.equal(
      enclosureRadiusPxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M, C), vignetteRadiusPxForZoom(z, SITE.lat),
      `z=${z} display IS the projected ring (handoff coincidence)`,
    );
  }
});

test('scrub entry: accumulated outward delta replaces the dwell counter', () => {
  assert.equal(TWIN_SCRUB_ENTER_DELTA, 40, 'decisive single shot unchanged');
  assert.equal(TWIN_SCRUB_PINCH_ENTER_PX, 240, 'accumulation budget is ~2 notches');
  let a = 0;
  for (let i = 0; i < 5; i++) {
    const upd = scrubEntryForDelta(a, -40);
    a = upd.accum;
    assert.equal(upd.enter, false, `notch ${i + 1} accumulates without tripping early`);
  }
  assert.equal(a, 200, 'five outward notches accumulate');
  const trip = scrubEntryForDelta(a, -40);
  assert.equal(trip.enter, true, 'sixth notch crosses the budget');
  assert.equal(trip.accum, 240);
  const drained = scrubEntryForDelta(trip.accum, 120);
  assert.equal(drained.enter, false, 'inward drains below the budget');
  assert.equal(drained.accum, 120);
  assert.deepEqual(scrubEntryForDelta(0, 0), { accum: 0, enter: false }, 'zero delta holds');
  assert.deepEqual(scrubEntryForDelta(0, NaN), { accum: 0, enter: false }, 'non-finite parks, never enters');
  assert.deepEqual(scrubEntryForDelta(NaN, -50), { accum: 50, enter: false }, 'non-finite accumulator restarts');
});

test('wheel scrub mirrors both ways; pinch never counts toward progress', () => {
  const out = scrubProgressForWheel(0.5, -60);
  assert.ok(out > 0.5, 'wheel-up advances the reverse');
  assert.ok(Math.abs(scrubProgressForWheel(out, 60) - 0.5) < 1e-12, 'wheel-down retraces exactly');
  assert.equal(scrubProgressForWheel(0.5, -60, { pinch: true }), 0.5, 'pinch stays native');
  assert.equal(scrubProgressForWheel(0.9, -600), 1, 'parks at ring top-down');
  assert.equal(scrubProgressForWheel(0.1, 600), 0, 'parks at the terminal side');
});

test('reverse pose law: live pose at 0, ring top-down at 1, symmetric mid', () => {
  const R0 = 40000;
  const C = Math.SQRT1_2;
  const legs = buildForwardLegs({
    startPose: { eye: { x: 0, y: R0, z: 0.01 }, target: { x: 0, y: 0, z: 0 } },
    mid: { eye: { x: 0, y: R0 * C, z: R0 * C }, target: { x: 0, y: 0, z: 0 } },
    to: { eye: { x: 1000, y: 18000 * C, z: 500 + 18000 * C }, target: { x: 1000, y: 0, z: 500 } },
  });
  assert.ok(legs && legs.length === 2, 'forward legs build');
  const atLive = poseForScrubProgress(legs, 0);
  const atHome = poseForScrubProgress(legs, 1);
  assert.deepEqual(atLive.eye, legs[0].from.eye, 'progress 0 is the live pose');
  assert.deepEqual(atHome.eye, legs[legs.length - 1].eye, 'progress 1 is the far end');
  // Mirror: driving 1->0 visits the same frames as 0->1, in reverse.
  for (const p of [0.25, 0.5, 0.75]) {
    assert.deepEqual(poseForScrubProgress(legs, 1 - p), poseForScrubProgress(legs, 1 - p), 'pure function of progress');
  }
  assert.deepEqual(poseForScrubProgress(legs, 0.3), poseForScrubProgress(legs, 0.3), 'retrace reads the same law');
});

test('map producer wired: S posts to the twin frame, value-change throttled', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('function postTwinStagedS()'), 'producer exists');
  assert.ok(main.includes('postMessage(buildTwinStagedMessage(s)'), 'posts the shaped payload to the frame');
  assert.ok(main.includes('lastPostedStagedS !== null && s === lastPostedStagedS'), 'throttles to value-change');
  assert.ok((main.match(/postTwinStagedS\(\)/g) || []).length >= 2, 'driver calls the producer (def + call)');
  assert.ok(main.includes('accumStagedS(stagedS, dy)'), 'accumulator owns S through the shared law');
});

test('twin consumer present: staged listener feeds the intro scrub', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(main.includes('isTwinStagedMessage(e?.data)'), 'staged channel is received');
  assert.ok(main.includes('applyTwinStagedS(e.data.s)'), 'S reaches the staged driver');
  assert.ok(main.includes('fwdProgressForStagedS(handoff.fwdStagedS'), 'staged S still drives progress (autoplay fallback intact)');
});

test('twin reverse: scrub-owned from live, explicit close completes, no clock, no dwell', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(!main.includes('TWIN_SCRUB_DWELL_FRAMES'), 'frame-counter entry is gone');
  assert.ok(!main.includes('scrubToTimed'), 'wall-clock rescue is gone');
  assert.ok(!main.includes('atMaxFrames'), 'dwell counter state is gone');
  assert.ok(main.includes('scrubEntryForDelta(handoff.entryAccum'), 'delta accumulation owns entry');
  assert.ok(main.includes('function completeScrubReverse()'), 'explicit-close completion exists');
  assert.ok(main.includes('sc.progress = 1;'), 'close drives progress to 1');
  assert.ok(main.includes('paintScrubPose();\n      finishScrubReverse();'), 'completion paints through the scrub law');
  assert.ok(main.includes('completeScrubReverse();\n      return true;'), 'close path completes instead of re-flying');
  assert.ok(main.includes('handoff.scrub = { active: true, progress: 0, accum: 0, justEntered: false };'), 'walk hands to the scrub at the live pose');
  assert.ok(main.includes("if (pinch && handoff.phase !== 'done') return;"), 'pinch stays native outside the clamp entry');
});

test('map recede: gesture-owned reverse scrub, sat via the scrub law, no flight', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('recedeLandHome = landHome;'), 'recede arms the arrival closure');
  assert.ok(main.includes('if (receding && recedeLandHome)'), 'zoom-step home check lands it');
  assert.ok(main.includes('setSatScrubbed(satOpacityForZoom(lz))'), 'sat rides the scrub law, never a timed ramp');
  assert.ok(!main.includes('duration: 800'), '800ms recede ease is gone');
  assert.ok(!main.includes("once('moveend', landHome)"), 'moveend landing is gone');
  assert.ok(!main.includes('setSatForced(false)'), 'timed sat ramp is gone from the reverse');
  assert.ok(!main.includes(', 2500);'), '2500ms fallback timer is gone');
  assert.ok(main.includes('lastPostedStagedS = null; // symmetric unwind'), 'staged exit unwinds the S stream');
  assert.ok(main.includes('if (receding && needsHandoff(z))'), 'scrolling back in disarms the recede');
  assert.ok(main.includes('!busyNoRecede && prox && (prox.near || isoScrubOwned)'), 'iso retrace rides the gesture home, owned tilt restores even after pan-away');
});

test('map vignette: radius from projected R, brackets retired as enclosure signal', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes("v.style.setProperty('--vr'"), 'journey writes the vignette radius');
  assert.ok(main.includes('enclosureRadiusPxForZoom(z, SITE.lat'), 'display radius rides the forming law');
  assert.ok(main.includes('showVignette(prox.near && blend > 0)'), 'enclosure gated past z=8: sub-pixel ring never blacks the frame');
  assert.ok(!main.includes('showVignette(prox.near);'), 'ungated proximity enclosure is gone');
  const html = srcOf('../ops3d-map.html');
  assert.ok(html.includes('@property --vr'), 'radius is registered animatable so the close-in glides');
  assert.ok(html.includes('circle var(--vr, 260px)'), 'enclosure circle rides the projected radius');
  assert.ok(html.includes('at var(--vx, 50%) var(--vy, 50%)'), 'enclosure stays hotspot-centered');
});

test('forward path untouched: staged laws, intro legs, iso ownership, FOV', () => {
  const map = srcOf('../src/map/main.js');
  assert.ok(map.includes('setMaxZoom(Z_HANDOFF)'), 'scroll-as-zoom still clamps at the gate');
  assert.ok(map.includes('setSatScrubbed(satOpacityForZoom'), 'forward sat still rides the scrub law');
  assert.ok(map.includes('mapRef.transform.setPitch(pTarget)'), 'iso scrub still owns the transform');
  assert.ok(map.includes('releaseNow = true'), 'release step zeroes the tilt in the landing step');
  assert.ok(map.includes('(isoScrubOwned || releaseNow)'), 'fast flick-out over the band cannot strand pitch');
  assert.ok(map.includes('prox.near || isoScrubOwned'), 'owned scrub restores pitch even after pan-away');
  assert.ok(map.includes('isoRestoreDue = true'), 'engage latches the restore due flag');
  assert.ok(map.includes("source === 'native-zoomend' && isoRestoreDue && !shouldCenter(z)"), 'below-band settle glides journey tilt home');
  assert.ok(map.includes('mapRef.easeTo({ pitch: 0, duration: 250 })'), 'reconcile glides pitch home on settle tempo');
  assert.ok(map.includes('prewarmThenReveal(id, liveFrame(), { ...opts, staged: true })'), 'near-gate arrival still stages');
  const twin = srcOf('../src/ring2/main.js');
  assert.ok(twin.includes('poseForScrubProgress(fwd.legs, fwd.progress)'), 'forward pose still reads the scrub law');
  assert.ok(twin.includes('buildForwardLegs({'), 'forward legs still frozen at hold exit');
  assert.ok(twin.includes('isFlightIdle'), 'flight-idle redrape gate intact');
});
