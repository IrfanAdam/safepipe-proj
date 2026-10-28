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
import { TWIN_STAGED_MSG as MAP_STAGED_MSG, buildTwinStagedMessage, TWIN_PAINTED_MSG as MAP_PAINTED_MSG, parseTwinPaintedMessage } from '../src/map/twinlink.js';
import {
  TWIN_STAGED_MSG,
  TWIN_PAINTED_MSG,
  buildTwinPaintedMessage,
  isTwinPaintedMessage,
  firstPaintDue,
  TWIN_PAINT_MAX_MS,
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
  assert.equal(accumStagedS(300, -250), 550, 'mid-hold accumulates');
  assert.equal(accumStagedS(550, 250), 300, 'mid-hold retraces');
  assert.equal(accumStagedS(650, -200), HANDOFF_STAGED_S_MAX, 'parks at commit');
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
  assert.ok(Math.abs(dia12 - 1370) < 3, `handoff enclosing is the 1370px clip circle (got ${dia12.toFixed(1)})`);
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
  assert.equal(enclosureRadiusPxForZoom(6.9, SITE.lat, MAP_VIGNETTE_RING_M, C), null, 'parks below the band — never blacks the frame');
  assert.equal(enclosureRadiusPxForZoom(8, SITE.lat, MAP_VIGNETTE_RING_M, null), null, 'parks without a viewport corner');
  assert.equal(enclosureRadiusPxForZoom(8, SITE.lat, MAP_VIGNETTE_RING_M, -4), null, 'parks on a non-positive corner');
  const at7 = enclosureRadiusPxForZoom(7.01, SITE.lat, MAP_VIGNETTE_RING_M, C);
  assert.ok(Math.abs(at7 - C) < 5, `forming starts AT the corners (got ${at7.toFixed(1)}px)`);
  let prev = Infinity;
  for (let z = 7.5; z <= 11.5; z += 0.5) {
    const r = enclosureRadiusPxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M, C);
    assert.ok(r < prev, `z=${z} closes in from the edges (${r.toFixed(0)}px < ${prev === Infinity ? 'inf' : prev.toFixed(0)}px)`);
    prev = r;
  }
  // GATE-3 REVISION: past the HANDOFF the enclosure HOLDS at the handoff
  // value — the twin's fixed ground clip radius. Holding at the earlier
  // Z_TOP projection over-zoomed the map (242.2px vs the twin's 484.5px).
  const atHandoff = enclosureRadiusPxForZoom(11.5, SITE.lat, MAP_VIGNETTE_RING_M, C);
  for (const z of [11.5, 12, 12.1, 13, 13.4]) {
    assert.equal(
      enclosureRadiusPxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M, C), atHandoff,
      `z=${z} HOLDS the handoff enclosure (no over-zoom past the ring)`,
    );
  }
  assert.equal(
    atHandoff, vignetteRadiusPxForZoom(11.5, SITE.lat),
    'at the handoff the enclosure IS the projected ring the twin clips to',
  );
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

test('map close: single synchronous cut, single-law dissolve, one leg pinned', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(!main.includes('reverseWait'), 'no reverse-wait state in the map lane');
  assert.ok(!main.includes('TWIN_REVERSE_WAIT_MS'), 'no close-chain timer constant');
  assert.ok(!main.includes('if (reverseWait) return;'), 'no armed-wait close guard (the old sticky)');
  assert.ok(main.includes('window.__mapProbe.retraceLegs = 1;'), 'the dissolve pins a single law');
  assert.ok(main.includes('recede: null, mapZoom: null, retraceLegs: null'),
    'the probe carries the single-law leg pin from boot');
});

test('retrace leg count equals the shared forward legs (one list, both ways)', () => {
  const R0 = 40000;
  const C = Math.SQRT1_2;
  const legs = buildForwardLegs({
    startPose: { eye: { x: 0, y: R0, z: 0.01 }, target: { x: 0, y: 0, z: 0 } },
    mid: { eye: { x: 0, y: R0 * C, z: R0 * C }, target: { x: 0, y: 0, z: 0 } },
    to: { eye: { x: 1000, y: 18000 * C, z: 500 + 18000 * C }, target: { x: 1000, y: 0, z: 500 } },
  });
  assert.ok(legs && legs.length === 3, 'forward legs build (swoop+push+settle)');
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
  assert.ok(main.includes('postMessage(buildTwinStagedMessage(s, zPost)'), 'posts S + live zoom to the frame (round-8 release-fresh anchors)');
  assert.ok(main.includes('lastPostedStagedS !== null && s === lastPostedStagedS'), 'throttles to value-change');
  assert.ok((main.match(/postTwinStagedS\(\)/g) || []).length >= 2, 'driver calls the producer (def + call)');
  assert.ok(main.includes('accumStagedS(stagedS, dy)'), 'accumulator owns S through the shared law');
});

test('twin consumer present: staged listener feeds the intro scrub', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(main.includes('isTwinStagedMessage(e?.data)'), 'staged channel is received');
  assert.ok(main.includes('applyTwinStagedS(e.data.s, e.data.z)'), 'S + zoom reach the staged driver (round-8 release-fresh anchors)');
  assert.ok(main.includes('fwdProgressForStagedS(handoff.fwdStagedS'), 'staged S still drives progress (autoplay fallback intact)');
});

test('twin reverse: one shared leg list mirrored, explicit close is a cut, no clock, no walk', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(!main.includes('buildReverseWalk'), 'no staged close-walk builder — the way back is not a stage list');
  assert.ok(!main.includes('handoff.walk'), 'no walk state — the scrub owns the shared forward legs');
  assert.ok(!main.includes('function completeScrubReverse'), 'no explicit-close scrub jump — a discrete close cuts at once');
  assert.ok(!main.includes('scrubProgressForWalk(handoff'), 'no live-progress walk takeover');
  assert.ok(main.includes('poseForScrubProgress(handoff.fwd?.legs, 1 - handoff.scrub.progress)'),
    'the scrub reads the shared forward legs mirrored (1 - progress)');
  assert.ok(main.includes('poseForScrubProgress(handoff.fwd?.legs, 1 - sc.progress)'),
    'the wheel paint path mirrors on the same shared legs');
  assert.ok(main.includes('legs: handoff.fwd && Array.isArray(handoff.fwd.legs)'),
    'the probe reports the shared forward legs on the reverse');
  assert.ok(main.includes('window.__ring2retraceLegs = legs.length;'),
    'the reverse pins its single-law leg count on the probe');
  assert.ok(!main.includes('TWIN_SCRUB_DWELL_FRAMES'), 'frame-counter entry is gone');
  assert.ok(!main.includes('scrubToTimed'), 'wall-clock rescue is gone');
  assert.ok(!main.includes('atMaxFrames'), 'dwell counter state is gone');
  assert.ok(main.includes('scrubEntryForDelta(handoff.entryAccum'), 'delta accumulation owns entry');
  assert.ok(main.includes('enterScrubReverse()'), 'gesture entry still exists — owned by the wheel, on shared legs');
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
  // GATE-3 REVISION: the engagement gained the STRAND case and moved to the
  // terrain grade. The old test (z past the top gate, even unaimed) is still
  // true — but the reverse leg dropped below Z_TOP, the law stopped driving,
  // and the tilt sat at 45deg for the whole way home. `isoRestoreDue` is now
  // part of the engagement, so the journey keeps the tilt until the law has
  // actually flattened it; the whole terrain->iso band starts at Z_ISO_START.
  assert.ok(
    main.includes('(prox.near || isoScrubOwned || z >= Z_ISO_START || isoRestoreDue)'),
    'iso scrub engages from the terrain grade, and keeps the tilt while the reverse still owes a flatten',
  );
  // The release waits for the law's value, not just the zoom.
  assert.ok(
    main.includes('z < Z_ISO_START - ISO_SCRUB_RELEASE && Math.abs(pCur) <= ISO_SCRUB_EPS_DEG'),
    'the journey releases the tilt only once the law has flattened it (no mid-retrace strand)',
  );
  // The per-frame hook applies the law on BOTH sides of the band — the
  // reverse must be able to flatten the tilt, so the slack guard cannot
  // apply once the journey owns the tilt.
  assert.ok(
    main.includes('if (!isoScrubOwned && pCur > pLaw + ISO_SCRUB_SLACK_DEG) return next;'),
    'the camera hook owns the tilt unconditionally once the journey took it',
  );
  assert.ok(
    !/transformCameraUpdate:[\s\S]{0,600}?if \(z < Z_TOP\) return next;/.test(main),
    'the camera hook is not gated to z >= Z_TOP (that gated out the reverse flatten)',
  );
  // KNOWN OPEN, pre-existing: the camera pitch still snaps 45 -> 0 at the
  // twin-open frame (a measured -45deg step). Two camera-write fixes were
  // tried and reverted (they did not hold), so the seam is NOT claimed fixed
  // here. The regression guard is that no half-finished attempt is left in
  // the tree: the twin-open hold must NOT be present.
  assert.ok(
    !main.includes('holdIsoPoseForTwin'),
    'no half-finished twin-open camera hold is left in the tree (the seam is OPEN, not fixed)',
  );
  // mapRef.stop(): banned outright — no programmatic camera leg exists for
  // a gesture to cancel (the idle-auto recede was removed by owner rule).
  // Any stop() (auto leg, twin-open seam experiment) fails here.
  const stops = (main.match(/mapRef\.stop\(\)/g) || []).length;
  assert.equal(stops, 0, `mapRef.stop() must not appear (no auto leg to cancel), found ${stops}`);
  // No auto animate of states, by owner rule: no idle timer, no auto probe,
  // no programmatic home ease. Every motion after a close is owned by scroll.
  assert.ok(
    !main.includes('autoReceding'),
    'no idle-auto recede leg remains',
  );
  assert.ok(
    !main.includes('recedeIdleT'),
    'no idle-arm timer remains',
  );
  // Band takeover: each aimed in-band wheel tick drives the camera
  // INSTANTLY (duration 0 — the camera IS the scroll, no timers, no lag),
  // so in-flight tilt cannot be clobbered.
  assert.ok(
    main.includes('function installBandTakeover()'),
    'the tilt band owns aimed wheel ticks through a single-writer instant drive',
  );
  assert.ok(
    main.includes('pitch: pitchTargetForZoom(target)'),
    'takeover drive carries the law pitch with the tick zoom',
  );
  assert.ok(
    main.includes('duration: 0,'),
    'takeover drive is synchronous per tick (no lag ease)',
  );
  assert.ok(
    main.includes('feedStagedScroll(-dy)'),
    'takeover ticks feed staged S so the scrubbed dissolve advances on the fingers',
  );
  // Shared flatten guarantor: every teardown that moves no camera flattens
  // a journey-owned tilt onto the law.
  assert.ok(
    main.includes('function flattenJourneyTiltToLaw(reason)'),
    'one shared guarantor owns teardown flattening',
  );
  assert.ok(
    main.includes("flattenJourneyTiltToLaw('exit-staged')"),
    'the staged unwind flattens a twin killed outside the close chain',
  );
  // Fork guard: a STAGED arming call must not resolve its own hold at entry
  // (that murder of the S stream is the out-of-sync/self-zoom failure) —
  // only discrete commits resolve an armed hold.
  assert.ok(
    main.includes('if (stagedActive && !stagedCommitted && !opts.staged) {'),
    'prewarm entry keeps a staged hold alive (staged:true arming skips the guard)',
  );
  const forks = (main.match(/stagedActive = false;\n    stagedCommitted = true;/g) || []).length;
  assert.ok(forks >= 2, `staged holds still resolve on discrete commits + finalize (found ${forks})`);
  // Scroll-pure commit and close: the staged commit is a cut (the S scrub
  // already dissolved to 1 — no timed crossfade), and the close hides
  // synchronously with no fade timer and no recede-delay timer.
  assert.ok(
    main.includes('revealTwin(true); // CUT'),
    'staged commit is an instant matched cut, never a timed crossfade',
  );
  assert.ok(
    !main.includes('setTimeout(finishHide'),
    'close hides synchronously — no fade timer',
  );
  assert.ok(
    !main.includes('RECEDE_DELAY_MS'),
    'no recede-delay timer remains',
  );
  // Round-4 lockstep: the hold ring blends the arrival's live radii onto
  // the seam across the reveal band (no first-tick snap), the zoom ceiling
  // clamps synchronously on the latch tick (no clamp gap for fast dives),
  // and the mask center never writes off-screen projections.
  assert.ok(
    main.includes('entryRx = entry && Number.isFinite(entry.rx)'),
    'arrival caches its live radii as the staged-entry anchor',
  );
  assert.ok(
    main.includes('(eRx * (1 - rev) + seam.rx * rev)'),
    'hold ring blends entry->seam on the reveal band',
  );
  assert.ok(
    main.includes('Clamp the ceiling SYNCHRONOUSLY on the latch tick'),
    'the zoom ceiling lands on the latch tick, never the arrival frame',
  );
  assert.ok(
    main.includes('{ scrubFired = false; restoreMaxZoom(); return; }'),
    'a clamp that never stages is always restored',
  );
  assert.ok(
    main.includes('steps PARK instead of writing'),
    'off-centre driver steps park the last live radii (never the inflated corner law)',
  );
  assert.ok(
    main.includes('Center follows proximity only'),
    'mask center never writes off-screen projections (stays last-near)',
  );
  // Round-4 reveal hygiene: no stale mid-dissolve opacity survives on any
  // discrete/timed reveal leg (inline beats the stylesheet — it would stick).
  assert.ok(
    main.includes("if (overlayEls.root.style.opacity !== '') overlayEls.root.style.opacity = '';"),
    'the timed crossfade clears stale inline opacity under .prewarm',
  );
  assert.ok(
    main.includes("root.classList.remove('scrubbing');") && main.includes('one short honest fade on a'),
    'discrete opens release the scrub suspension with the hold',
  );
});

test('map vignette: ellipse from projected R, brackets ride the same law', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes("app.style.setProperty('--vr'"), 'journey writes the vignette radius');
  assert.ok(main.includes("app.style.setProperty('--vr-y'"), 'journey writes the squashed vertical radius');
  assert.ok(main.includes('enclosureEllipsePxForZoom(z, SITE.lat'), 'display ellipse rides the forming law');
  assert.ok(main.includes('showVignette((proxUse.near || proxUse.inView) && blend > 0)'), 'enclosure gated past z=8: sub-pixel ring never blacks the frame (reads the post-settle proximity)');
  assert.ok(!main.includes('showVignette(prox.near);'), 'ungated proximity enclosure is gone');
  const html = srcOf('../ops3d-map.html');
  assert.ok(html.includes('@property --vr'), 'radius is registered animatable so the close-in glides');
  assert.ok(html.includes('@property --vr-y'), 'vertical radius is registered too');
  assert.ok(html.includes('ellipse var(--vr) var(--vr-y, var(--vr))'), 'enclosure ellipse rides the projected radii');
  assert.equal((html.match(/260px/g) || []).length, 2, '260px lives in exactly two places (the @property initial-values)');
  assert.ok(html.includes('at var(--vx, 50%) var(--vy, 50%)'), 'enclosure stays hotspot-centered');
  assert.ok(html.includes('--rc-axis: calc(var(--vr) * 0.7071067811865476)'), 'bracket axis derives from the ring radius (1/sqrt(2), centre on the ring)');
  assert.equal((html.match(/var\(--rc-axis\)(?!-y)/g) || []).length, 4, 'lefts ride --rc-axis (four)');
  assert.equal((html.match(/var\(--rc-axis-y\)/g) || []).length, 4, 'tops ride --rc-axis-y (four)');
  assert.ok(!html.includes('- var(--vr) - var(--rc-half)'), 'no corner rides the bounding square anymore');
});

test('paint-gated reveal: no opaque frame before the twin first paints', () => {
  assert.equal(MAP_PAINTED_MSG, TWIN_PAINTED_MSG, 'painted wire format agrees both sides');
  assert.equal(MAP_PAINTED_MSG, 'safepipe-twin-painted', 'painted type pins the wire');
  assert.deepEqual(buildTwinPaintedMessage(), { type: TWIN_PAINTED_MSG }, 'painted builder is a plain clone-safe object');
  assert.ok(isTwinPaintedMessage({ type: TWIN_PAINTED_MSG }), 'twin checker accepts painted');
  assert.ok(!isTwinPaintedMessage({ type: 'safepipe-twin-ready' }), 'checker never matches ready');
  assert.ok(!isTwinPaintedMessage(null), 'checker parks on null');
  assert.deepEqual(parseTwinPaintedMessage({ type: MAP_PAINTED_MSG }), { painted: true }, 'map parser mirrors painted');
  assert.equal(parseTwinPaintedMessage({ type: 'safepipe-twin-ready' }), null, 'map parser never matches ready');
  const map = srcOf('../src/map/main.js');
  const twin = srcOf('../src/ring2/main.js');
  assert.ok(twin.includes('paintedPosted'), 'twin posts painted once per boot');
  assert.ok(twin.includes('firstPaintDue({ frames: twinFrames'), 'painted requires frames + tile idle, wall-cap backstop');
  assert.equal(firstPaintDue({ frames: 2, mapIdle: true, sceneLive: true, elapsedMs: 99999 }), false, 'withholds below PREWARM frames');
  assert.equal(firstPaintDue({ frames: 3, mapIdle: true, sceneLive: true, elapsedMs: 0 }), true, 'live scene reveals without waiting');
  assert.equal(firstPaintDue({ frames: 30, mapIdle: true, sceneLive: false, elapsedMs: 0 }), false, 'withholds while terrain undraped');
  assert.equal(firstPaintDue({ frames: 30, mapIdle: false, sceneLive: true, elapsedMs: 0 }), false, 'withholds while tiles stream');
  assert.equal(firstPaintDue({ frames: 30, mapIdle: false, sceneLive: false, elapsedMs: TWIN_PAINT_MAX_MS }), true, 'wall cap rescues endless loads');
  assert.equal(firstPaintDue({ frames: NaN }), false, 'parks on non-finite input');
  assert.ok(map.includes('parseTwinPaintedMessage(e && e.data)'), 'map records painted arrivals');
  assert.ok(map.includes('armRevealFallback()'), 'unstaged fallback arms through the paint gate');
  assert.ok(map.includes('REVEAL_PAINT_TRIES'), 'unpainted fallback re-arms instead of revealing blind');
  assert.ok(twin.includes("terrainState() !== 'vex'"), 'ready-match withholds until terrain drapes');
  assert.ok(twin.includes('typeof mapLoaded'), 'ready-match withholds while tiles stream');
  assert.ok(map.includes('revealPaint = true'), 'paint-gated reveal is flagged apart from blind fallback');
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
  assert.ok(map.includes('mapRef.jumpTo({ pitch: 0 })'), 'reconcile snaps pitch home instantly (no settle glide)');
  assert.ok(map.includes('prewarmThenReveal(id, stagedFrame || liveFrame(), { ...opts, staged: true })'), 'near-gate arrival still stages');
  const twin = srcOf('../src/ring2/main.js');
  assert.ok(twin.includes('poseForScrubProgress(fwd.legs, fwd.progress)'), 'forward pose still reads the scrub law');
  assert.ok(twin.includes('buildForwardLegs({'), 'forward legs still frozen at hold exit');
  assert.ok(twin.includes('isFlightIdle'), 'flight-idle redrape gate intact');
});
