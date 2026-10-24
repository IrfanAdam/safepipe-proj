// tests/map-handoff-scrub.test.js — Task 35: the outbound handoff is a
// zoom-scrubbed staged crossfade, never a timed flight. The twin dissolve is
// a ZOOM law across Z_TOP..Z_HANDOFF (S maps onto the reveal band, so it
// reaches full at the handoff without extra scrolling); the wheel S owns the
// clamped post-gate hold and the reverse retrace. Sat rides the scrub law
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
  STAGED_HOLD_PITCH_DEG,
  STAGED_HOLD_RING_CLOSE,
  stagedHoldPitchForS,
  stagedHoldRingCloseForS,
  SEAM_HOLD_RX_PX,
  seamHoldEllipseForS,
  vignetteRadiusPxForZoom,
} from '../src/map/scrolltrigger.js';
import { HANDOFF_ISO_POLAR_DEG } from '../src/ring2/sector.js';
import { SITE } from '../src/map/feed.js';

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

test('stage gates: ring -> blend -> tilt in order, reveal spans the hold', () => {
  assert.equal(HANDOFF_STAGE_PX, 250, 'one stage per 250px of scroll');
  assert.equal(HANDOFF_REVEAL_LEN_PX, 500, 'reveal band constant still sizes the staged band');
  assert.equal(HANDOFF_STAGED_S_MAX, 1250, 'full commit at 1250px past the gate');
  const zero = handoffStagesForScroll(0);
  assert.deepEqual(zero, { ring: 0, blend: 0, tilt: 0, reveal: 0 }, 'gate entry starts every stage at 0');
  const mid1 = handoffStagesForScroll(125);
  assert.ok(mid1.ring > 0 && mid1.ring < 1, 'ring dissolves first');
  assert.equal(mid1.blend, 0, 'blend waits for its gate');
  assert.equal(mid1.tilt, 0, 'tilt waits for its gate');
  // MASK-SYNC: the reveal has no gate — the overlay moves on the first
  // post-gate tick together with the hold-ring, so mask and twin stay one
  // motion. Ring/blend/tilt keep their gates (twin-intro pacing).
  assert.ok(mid1.reveal > 0 && mid1.reveal < mid1.ring, 'reveal dissolves across the whole hold');
  const atRing = handoffStagesForScroll(HANDOFF_STAGE_PX);
  assert.equal(atRing.ring, 1, 'ring holds complete at its gate');
  assert.equal(atRing.blend, 0, 'blend still gated');
  const midReveal = handoffStagesForScroll(1000);
  assert.equal(midReveal.ring, 1, 'ring holds');
  assert.equal(midReveal.blend, 1, 'blend holds');
  assert.equal(midReveal.tilt, 1, 'tilt holds');
  assert.ok(midReveal.reveal > 0 && midReveal.reveal < 1, 'reveal still dissolving near commit');
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

test('accumulator-owned reveal: S seeds from live zoom at entry, wheel owns it after; hold extras are zero', () => {
  // GATE-3 REVISION: the S-driven tilt/ring extras are gone. Starting the
  // reveal at Z_TOP and driving it by zoom is what carries the motion; an
  // extra hold tilt would overshoot the 45deg pole and an extra ring close
  // would shrink the enclosure past the twin's clip.
  assert.equal(STAGED_HOLD_PITCH_DEG, 0, 'no extra hold tilt — the zoom band carries the motion');
  assert.equal(STAGED_HOLD_RING_CLOSE, 0, 'no extra ring close — the enclosure lands on the twin clip');
  for (const s of [0, HANDOFF_STAGE_PX, 3 * HANDOFF_STAGE_PX, 1000, HANDOFF_STAGED_S_MAX, NaN]) {
    assert.equal(stagedHoldPitchForS(s), 0, `S=${s} adds no tilt`);
    assert.equal(stagedHoldRingCloseForS(s), 0, `S=${s} adds no ring close`);
  }
  // MASK-SYNC: no reveal sub-band — the seed spans the full S band (0 at the
  // iso checkpoint, S_MAX at the gate) so the first staged tick already
  // paints the matching partial dissolve instead of jumping 0->0.74.
  // The staged band still stages ring/blend/tilt pacing + full-span reveal.
  assert.equal(3 * HANDOFF_STAGE_PX + HANDOFF_REVEAL_LEN_PX, HANDOFF_STAGED_S_MAX, 'S band stages pacing + full-span reveal');
  const main = srcOf('../src/map/main.js');
  // S OWNERSHIP: the wheel accumulator owns S after entry (KEEP +100/tick).
  // No per-step zoom re-derivation may exist: the clamp freezes zoom
  // post-gate, so a zoom law cannot express finger progress, and every zoom
  // event would silently discard accumulated wheel intent.
  assert.ok(
    !main.includes('stagedS = revealStart + (HANDOFF_STAGED_S_MAX - revealStart) * tBand'),
    'no per-step zoom re-derivation of S — the accumulator is the sole writer',
  );
  assert.ok(
    main.includes('stagedS = HANDOFF_STAGED_S_MAX * smooth01(tSeed);'),
    'the staged entry seeds S across the full band from the live zoom (no reveal sub-band)',
  );
  assert.ok(
    main.includes('((Number.isFinite(liveZ) ? liveZ : Z_TOP) - Z_TOP) / (Z_HANDOFF - Z_TOP)'),
    'the staged entry seeds S from the LIVE zoom (fast wheel bursts already at the handoff)',
  );
  assert.ok(
    main.includes('if (!twinOpen && !busyNow && z >= Z_TOP)'),
    'the handoff/twin prewarm begins at the iso checkpoint',
  );
  assert.ok(
    main.includes('mapRef.getZoom() < Z_TOP'),
    'the deferred trigger aborts if the zoom dropped below the checkpoint',
  );
});

test('reveal continuity: S flows from entry, never parks at the reveal gate', () => {
  // Fast wheel bursts must dissolve continuously into the twin: every tick
  // paints. The old contract parked both the prewarm seed and the wheel feed
  // at the reveal gate (750) while the twin booted, so ticks painted nothing
  // (the stutter) and the later resume jumped. Now the seed stands, the feed
  // accumulates freely, and the overlay is a pure function of S — scroll-up
  // still retraces symmetrically through accumStagedS, and the Lane B
  // grant-time re-emit replays the live S to the twin so both sides match.
  const main = srcOf('../src/map/main.js');
  assert.ok(
    !main.includes('if (!grantedSeed && stagedS > revealStart) stagedS = revealStart;'),
    'no prewarm seed park — the live-zoom seed stands',
  );
  assert.ok(
    !main.includes('if (!releasedFeed && stagedS > gateS && (releaseKnown || !grantedFeed)) stagedS = gateS;'),
    'no wheel-feed gate clamp — S accumulates on every tick during boot',
  );
  assert.ok(
    main.includes('stagedS = accumStagedS(stagedS, dy);'),
    'the feed still accumulates through the symmetric law (scroll-up retraces)',
  );
  assert.ok(
    main.includes('lastPostedStagedS = null;'),
    'grants still re-emit the live S to the twin (boot-raced seeds replay)',
  );
});

test('round-8 sync audit: twin release re-derives mid from grant-time zoom', () => {
  // Measured: arrival at z~10.8, grant at the 11.5 ceiling — the frozen
  // arrival mid (10.8-scale iso) dissolved over an 11.5 map = the unsynced
  // seam after the parked state. The release must re-derive the ring iso
  // from the freshest posted zoom (grant-time re-emit), falling back to the
  // handed frame, then the frozen anchor — never a canned pose.
  const twin = srcOf('../src/ring2/main.js');
  assert.ok(
    twin.includes('let midPose = releaseFreshMid(handoff.mid);') && twin.includes('mid: midPose,'),
    'the release builds legs from a grant-fresh mid',
  );
  // Scale lock (eval-scale lane): the staged release must pin BOTH anchors to
  // the gate scale, otherwise the twin's image drifts against the map it
  // dissolves over (measured -0.76z -> +0.46z across the reveal band).
  assert.ok(
    twin.includes('lockStagedRange(handoff.frame?.cy)')
      && twin.includes('poseAtRange(midPose, rLock)')
      && twin.includes('poseAtRange(toPose, rLock)'),
    'the staged release locks mid + terminal to the held gate scale',
  );
  assert.ok(
    !/let z = Number\(handoff\.fwdStagedZ\);/.test(twin),
    'a null staged-z is never coerced to zoom 0 (Number(null) === 0 -> 42 km rail)',
  );
  assert.ok(
    twin.includes('handoff.fwdStagedZ = zz;'),
    'the staged driver stamps the posted zoom',
  );
  assert.ok(
    twin.includes('function releaseFreshMid(fallback)'),
    'the re-derivation helper exists with a frozen-anchor fallback',
  );
  assert.ok(
    twin.includes('frameRange(z, { viewportPx: viewportPxNow()'),
    'the re-derivation mirrors the boot anchor math (range -> rails -> iso)',
  );
  assert.ok(
    twin.includes('if (fwdStagedOwnsIntro({ stagedS: preStagedS, deepFrame: frameDeep })) holdFloor = 0;'),
    'round-9: a staged release skips the 900ms hold floor (unstaged keeps it)',
  );
  const link = srcOf('../src/map/twinlink.js');
  assert.ok(
    link.includes('msg.z = zz;'),
    'the staged wire carries the live zoom when finite, omits it otherwise',
  );
});
test('readiness-hold: overlay ramp waits for twin tiles, law stays pure', () => {
  // Owner diagnosis: the dissolve revealed the twin before its tiles were
  // ready (ghosting). The ramp now gates on TILE readiness
  // (twinFrameHasContent), not on the ready/painted listener grants — those
  // only prove the twin is alive. The S law itself stays a pure function of
  // scroll (probe .reveal still reports it); only the WRITTEN opacity is
  // gated (probe .eff): 0 while tileless, the law once granted. Past
  // STAGED_TILES_HOLD_MS the hold releases anyway, flagged, so a dead frame
  // can never stall the fingers; the commit still requires content and the
  // silent-twin unwind chain still owns the dead-frame exit. The commit
  // pre-write and the blank/near guards hold the EFFECTIVE ramp, and
  // revealTwin's timed leg is still barred mid-hold (single writer).
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('function twinReleased()'),
    'a release signal exists (fwd allocated / phase past hold)',
  );
  assert.ok(
    main.includes('const effReveal = tilesHold ? 0 : st.reveal;'),
    'the effective ramp is the law when granted, 0 while the tiles hold',
  );
  assert.ok(
    main.includes("scrubWrite(effReveal <= 0 ? '0' : String(+effReveal.toFixed(4)));"),
    'the dissolve writes the effective ramp, never the raw law',
  );
  assert.ok(
    main.includes('const HARD_STOP_HOLD_MS = 30000;'),
    'the hard stop holds forward scroll up to 30 s while the twin loads (owner override: stall + loading state, not release-to-law)',
  );
  assert.ok(
    main.includes('const STAGED_TILES_HOLD_MS = HARD_STOP_HOLD_MS;'),
    'the overlay ramp shares the same long bound',
  );
  assert.ok(
    main.includes('stagedTilesT0 = 0; // HARD-STOP: unwind disarms the hold'),
    'unwind disarms the tiles hold',
  );
  assert.ok(
    main.includes('stagedTilesT0 = 0; // HARD-STOP: commit disarms the hold'),
    'commit disarms the tiles hold',
  );
  assert.ok(
    main.includes('if (stagedActive && !stagedCommitted && !instant) {'),
    'revealTwin routes mid-hold timed reveals through the driver (single writer)',
  );
  assert.ok(
    main.includes('tilesFallback,'),
    'the staged probe publishes the fallback release flag',
  );
  assert.ok(
    !main.includes("|| ph === 'done'"),
    "'done' (cancelled/failed flight, camera still top-down) must not authorize a dissolve",
  );
});
test('round-7 sync audit: parked pre-grant entry tracks the live zoom', () => {
  // Measured: zoom 10.94->11.48 over 3 ticks with the ring frozen at the
  // arrival entry (286px) — static circle, zooming terrain. The ceiling
  // clamps at 11.5 but zoom still travels under it while S is parked, so
  // the blend's rev-0 endpoint must be the live law, not the stale entry.
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('if (!grantedHold) {'),
    'the hold refreshes its entry while the twin is still booting',
  );
  assert.ok(
    main.includes('entryRx = +e.rx.toFixed(1); entryRy = +e.ry.toFixed(1);'),
    'the near entry refreshes from the live enclosure law (blend==driver)',
  );
  assert.ok(
    main.includes('with the spot clamped to the viewport'),
    'the off-centre entry refreshes from a viewport-clamped law (no 100x blowup), center untouched',
  );
});

test('driver: live hold drives visible travel on every staged tick, pre-grant', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('driveStagedHold(st)'), 'staged driver paints hold travel before the grant check');
  assert.ok(main.includes('stagedHoldPitchForS(stagedS)'), 'hold tilt rides the S law');
  assert.ok(main.includes('stagedHoldRingCloseForS(stagedS)'), 'hold ring rides the S law');
  assert.ok(main.includes('holdOwned'), 'tilt pump carries the hold instead of parking on the prewarm');
  assert.ok(main.includes('pumpIsoPitch(); // live-hold carry'), 'staged entry restarts the tilt pump under the clamp');
  assert.ok(main.includes('seamHoldEllipseForS(stagedS)'), 'hold ring parks the V7 seam ellipse, finger-driven');
});

test('V7 seam hold: the ellipse parks on the handoff radius, identical at/above the gate', () => {
  // rx is the ring ground radius projected at Z_HANDOFF over the site
  // parallel — the same value the forming law converges to (to 0.1px).
  assert.equal(SEAM_HOLD_RX_PX, 484.5, 'seam rx pins the handoff radius (10km ring at Z_HANDOFF on the 512 grid)');
  assert.equal(
    +vignetteRadiusPxForZoom(Z_HANDOFF, SITE.lat).toFixed(1),
    SEAM_HOLD_RX_PX,
    'seam rx matches the projected ring at the handoff',
  );
  const seam = seamHoldEllipseForS(0);
  assert.equal(seam.rx, SEAM_HOLD_RX_PX, 'rx is the seam constant');
  assert.ok(
    Math.abs(seam.ry - SEAM_HOLD_RX_PX * Math.cos(ISO_PITCH_DEG * (Math.PI / 180))) < 1e-9,
    `ry is rx times cos45 (got ${seam.ry})`,
  );
  assert.equal(+seam.rx.toFixed(1), 484.5, 'written --vr reads 484.5px');
  assert.equal(+seam.ry.toFixed(1), 342.6, 'written --vr-y reads 342.6px');
  // Pure fn of S with no zoom input: identical from Z_HANDOFF up, constant
  // across the whole staged band (a hold, not travel), parks on non-finite.
  for (const s of [0, 125, 250, 500, 750, 1000, HANDOFF_STAGED_S_MAX, HANDOFF_STAGED_S_MAX + 9999, NaN]) {
    assert.deepEqual(seamHoldEllipseForS(s), seam, `S=${s} holds the same seam ellipse`);
  }
});

test('driver: twin-open keeps hook ownership until the overlay is opaque', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('function twinOverlayOpaque()'), 'opacity guard exists');
  assert.ok(main.includes('TWIN_OVERLAY_OPAQUE'), 'opaque threshold is a named constant');
  assert.ok(main.includes('twinOverlayOpaque()'), 'the hook consults the guard');
  assert.ok(
    main.includes('if (!dissolving && (twinOpen && !hookRevThrough)) return next;'),
    'the hook owns the pitch law everywhere except under an opaque twin; dissolving keeps ownership, flights/prewarm/recede keep the law',
  );
  assert.ok(main.includes('TWIN_READY_MSG'), 'twin-ready wire still owned by twinlink');
  assert.ok(main.includes('parseTwinPaintedMessage'), 'twin-painted wire still owned by twinlink');
});

test('driver: commit requires near-and-non-blank (scale-seeded S, gated landing)', () => {
  const main = srcOf('../src/map/main.js');
  // Preserved shapes: the S producer throttle and the content sampling.
  // Round-8: the live zoom rides the staged post (release-fresh anchors).
  assert.ok(main.includes('win.postMessage(buildTwinStagedMessage(s, zPost)'), 'staged post carries S + live zoom');
  assert.ok(main.includes('const hasContent = twinFrameHasContent();'), 'content sampled once');
  assert.ok(main.includes('if (!hasContent)'), 'blank twin still holds the commit');
  assert.ok(
    main.includes('if (!c || typeof c !== \'object\') return false;'),
    'content-gate shape untouched (unreadable twin never commits)',
  );
  assert.ok(main.includes('c.frames >= TWIN_MIN_CONTENT_FRAMES'), 'frame-floor threshold untouched');
  // The near gates: proximity-near (spot reads near) and scale-near (live
  // zoom still at the handoff gate — S was seeded from that scale).
  assert.ok(main.includes('STAGED_COMMIT_Z_TOL'), 'scale nearness is a named tolerance');
  assert.ok(main.includes('proxNear'), 'proximity nearness sampled at the commit');
  assert.ok(main.includes('scaleNear'), 'scale nearness sampled at the commit');
  assert.ok(main.includes('if (!proxNear || !scaleNear)'), 'off-frame holds the commit, retries next tick');
  assert.ok(main.includes('staged.notNear'), 'off-frame probe reports which gate held');
  assert.ok(main.includes('staged.scaleFar'), 'off-scale probe reports which gate held');
});

test('reverse: re-arm and home arrival keep tilt ownership until the pitch flattens', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('if (rearmFlat) isoScrubOwned = false;'),
    'the re-arm gate clears tilt ownership on pitch-flat, never on zoom alone',
  );
  assert.ok(
    main.includes('if (homeFlat) {'),
    'the home arrival never parks a tilt at world zoom',
  );
  assert.ok(
    main.includes('const busyFlight = !!transitId;'),
    'pitch drivers park on flights only — prewarm/reverse/recede keep tracking the law',
  );
  assert.ok(
    main.includes('mapRef.jumpTo({ pitch: gLaw });'),
    'teardown snaps a journey-owned tilt onto the law (close-time flatten guarantor, instant — no timers)',
  );
});

test('round-10 dive-start prewarm: early boot fires once per dive with no state flips', () => {
  // The twin boots at first aimed takeover engagement so grant+release land
  // near arrival. The early frame mounts at opacity 0 (still painting —
  // display:none suspends rAF) with zero open-state side effects.
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('function earlyBootTwin()'), 'dive-start boot exists');
  assert.ok(main.includes('if (prox && prox.near)'), 'takeover fires the boot on aimed engagement');
  assert.ok(
    main.includes('earlyTwinArmed || twinOpen'),
    'the boot fires once per dive and never under an open/staged twin',
  );
  const body = main.slice(main.indexOf('function earlyBootTwin()'), main.indexOf('function abortEarlyBootTwin()'));
  for (const flip of ['twinOpen = true', 'pendingReveal = {', 'setMaxZoom', 'pushState', 'setTimeout']) {
    assert.ok(!body.includes(flip), `early boot sets no ${flip} — boot only, no state flips`);
  }
  assert.ok(main.includes('function abortEarlyBootTwin()'), 'retreat abort exists');
  assert.ok(main.includes('abortEarlyBootTwin();'), 'the zoom step aborts a retreated dive-start boot');
  assert.ok(
    main.includes('z < Z_ISO_START - 1'),
    'the abort fires on band exit, before the staged unwind band',
  );
  const abortStart = main.indexOf('function abortEarlyBootTwin()');
  const abortEnd = main.indexOf('Handoff-4 Lane A seeded reveal', abortStart);
  const abort = main.slice(abortStart, abortEnd);
  assert.ok(abort.includes('about:blank'), 'the abort blanks the frame so no boot leaks');
  assert.ok(
    (main.match(/earlyTwinArmed = false/g) || []).length >= 3,
    'arrival, direct open, and abort all consume the armed boot',
  );
});

test('round-10 grant semantics preserved: once-ever paint, per-handoff ready, continuity gates revised', () => {
  // Paint posts once per boot (an early boot eats it) while ready re-arms
  // per handoff — so arrival must reload on the warm cache, never reuse the
  // early frame. Pre-open grants stay dropped. The old round-9 dissolve
  // hold-at-0 and S cap are REPLACED by reveal continuity (pure function of
  // S, single writer) — asserted in the two tests above; this test pins that
  // the rework kept every other grant semantic identical.
  const main = srcOf('../src/map/main.js');
  const twin = srcOf('../src/ring2/main.js');
  assert.equal(
    (twin.match(/paintedPosted = true/g) || []).length,
    1,
    'paint posts once ever per boot — the early boot eats it, arrival reloads',
  );
  assert.ok(twin.includes('handoff.readyPosted = false'), 'ready re-arms per handoff');
  assert.ok(
    (main.match(/staleCloseGuardUntil/g) || []).length >= 4,
    'stale-echo guard declared, armed on early-consume, consulted on close',
  );
  assert.ok(
    (main.match(/if \(!twinOpen\) return;/g) || []).length >= 2,
    'pre-open ready/paint grants stay dropped (early posts never latch)',
  );
  assert.ok(main.includes('setFrameUrl(frameEl, url)'), 'arrival still sets its URL — reload on warm cache, never reuse');
  assert.ok(main.includes('function twinReleased()'), 'release signal intact');
  assert.ok(
    !main.includes('if (!ready || !released) {'),
    'reveal continuity: no hold-at-0 — the dissolve is a pure function of S',
  );
  assert.ok(
    !main.includes('if (!releasedFeed && stagedS > gateS && (releaseKnown || !grantedFeed)) stagedS = gateS;'),
    'reveal continuity: no S cap — the feed accumulates on every tick',
  );
});

test('mask-sync: twin reveal bound to enclosing-mask progress', () => {
  // Owner: the twin faded in stuttery and out of sync with the enclosing
  // mask. The reveal is now a pure function of the same S that drives the
  // hold-ring (mask) from the first post-gate tick, and the timed unstaged
  // path co-fires mask + twin from one tick.
  const main = srcOf('../src/map/main.js');
  const trig = srcOf('../src/map/scrolltrigger.js');
  assert.ok(
    trig.includes('reveal: clamp01(n / HANDOFF_STAGED_S_MAX),'),
    'the overlay reveal spans the full S hold, linear in S — no dead reveal gate, constant scroll rate',
  );
  assert.ok(
    main.includes('stagedS = HANDOFF_STAGED_S_MAX * smooth01(tSeed);'),
    'the staged seed spans the full band (no 0->0.74 first-tick jump)',
  );
  assert.ok(
    main.includes('if (deep && !reducedMotion) showVignette(true);'),
    'staged arrivals wash at arrival; unstaged arrivals defer the wash',
  );
  assert.ok(
    main.includes('MASK-SYNC: the enclosing wash fires on the reveal tick'),
    'revealTwin co-fires the enclosing wash on the reveal tick (one motion)',
  );
});
