// tests/map-unwind-law.test.js — Phase-03 resilience (the escape laws).
// Guards two measured failures on the owner's gallery dive:
//   (1) NO ESCAPE — Esc answered nothing from a staged/stalled state
//       (staged.active + twinOpen still true after Esc; page only recoverable
//       by reload). Root causes pinned here: the handler was gated on
//       twinOpen, and a superseded reverse-wait returned WITHOUT disarming, so
//       closeTwin() bailed forever after one timed-out close.
//   (2) STALEMATE — the staged ramp waits on a twin release while the twin's
//       intro waits on the map's S. The long HARD_STOP_HOLD_MS (30s) bound was
//       the only exit; the release-impossible law names it at ~2.6s.
// The runtime proof (per-state Esc + auto-unwind latencies, camera deltas) is
// measured in a headless harness; these tests pin the laws that make it hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseImpossibleReason, RELEASE_WAIT_BOUND_MS } from '../src/map/scrolltrigger.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const main = () => srcOf('../src/map/main.js');

/* ---------- the release-impossible law (pure) ---------- */

test('release bound sits an order of magnitude under the hard stop', () => {
  const m = main();
  const hard = /const HARD_STOP_HOLD_MS = (\d+);/.exec(m);
  assert.ok(hard, 'the long hard-stop bound is still declared');
  const hardMs = +hard[1];
  assert.ok(RELEASE_WAIT_BOUND_MS >= 2000 && RELEASE_WAIT_BOUND_MS <= 3000,
    `the release bound is ~2-3s (got ${RELEASE_WAIT_BOUND_MS})`);
  assert.ok(RELEASE_WAIT_BOUND_MS * 5 < hardMs,
    `the release bound is well under the hard stop (${RELEASE_WAIT_BOUND_MS} vs ${hardMs})`);
});

test('a missing frame is impossible immediately, never waited out', () => {
  assert.equal(
    releaseImpossibleReason({ iframeAlive: false, readable: false, waitMs: 0 }),
    'iframe-gone',
    'no frame means no arrival — no need to burn the bound',
  );
});

test('a live, readable, released twin inside the bound is still legitimate', () => {
  for (const shape of [
    { readable: true, released: false, phase: 'hold' },
    { readable: true, released: true, phase: 'swoop' },
    { readable: false, released: null, phase: null },
  ]) {
    assert.equal(
      releaseImpossibleReason({ iframeAlive: true, waitMs: RELEASE_WAIT_BOUND_MS - 1, ...shape }),
      null,
      `still loading at ${RELEASE_WAIT_BOUND_MS - 1}ms: ${JSON.stringify(shape)}`,
    );
  }
});

test('each circular shape unwinds with its own named reason', () => {
  const at = (o) => releaseImpossibleReason({ iframeAlive: true, waitMs: RELEASE_WAIT_BOUND_MS, ...o });
  assert.equal(at({ readable: false }), 'twin-unreadable', 'twin JS never came up');
  assert.equal(at({ readable: true, released: false, phase: 'hold' }), 'intro-held', 'parked in hold: its intro only starts on the S we hold');
  assert.equal(at({ readable: true, released: true, phase: 'swoop' }), 'release-starved', 'released but never idle: tiles only settle when the camera stops, and the camera only moves on S');
  assert.equal(at({ readable: true, released: false, phase: 'settle' }), 'release-timeout', 'unknown un-released state gets the same escape');
});

test('the law tolerates junk input instead of throwing', () => {
  assert.equal(releaseImpossibleReason(), null, 'no arguments = still within the bound');
  assert.equal(releaseImpossibleReason({ waitMs: NaN }), null, 'non-finite wait is not an impossibility');
  assert.equal(releaseImpossibleReason({ iframeAlive: true, waitMs: 9000, boundMs: 0, readable: false }), 'twin-unreadable',
    'a junk bound falls back to the law default rather than firing instantly');
});

/* ---------- one escape path (source contract) ---------- */

test('Esc is not gated on twinOpen any more', () => {
  const m = main();
  assert.ok(!m.includes("if (e.key === 'Escape' && twinOpen)"), 'the twinOpen-only Esc gate is gone (it answered nothing in a staged hold)');
  assert.ok(m.includes("window.addEventListener('keydown', (e) => { escapeKeyDown(e, 'map'); }, true);"),
    'Esc is routed through the one escape path in the capture phase');
  assert.ok(m.includes("unwindDive('esc-' + source, { source: 'esc' });"),
    'every non-healthy Esc state takes the one unwind');
  assert.ok(m.includes('if (!healthy && !diveInProgress()) return false;'),
    'Esc is consumed only while a dive is live (a plain Esc on the map stays inert)');
});

test('the escape covers the focus hole: the same-origin parent document is hooked', () => {
  const m = main();
  assert.ok(m.includes('function installParentEscapeHook()'), 'parent-document hook exists');
  assert.ok(m.includes("pdoc.addEventListener('keydown', (e) => { escapeKeyDown(e, 'parent'); }, true);"),
    'a key pressed over the embedding page reaches the same escape path');
  assert.ok(m.includes('try { installParentEscapeHook(); } catch { /* parent hook best-effort */ }'),
    'the hook is boot-wired');
});

test('a superseded reverse-wait disarms instead of leaking armed forever', () => {
  const m = main();
  assert.ok(
    m.includes('if (reverseWait && reverseWait.timer === timerHandle) clearReverseWait();'),
    'the seq-guard branch clears the wait it owns — the old bare `return` left reverseWait armed with no timer, and closeTwin() bails while it is armed (Esc dead for the session)',
  );
  const close = m.slice(m.indexOf('function closeTwin()'), m.indexOf("window.addEventListener('popstate'"));
  assert.ok(close.includes('if (reverseWait) return;'), 'the reverse-first guard still exists — it just can no longer leak');
});

test('the unwind clears every wait a dive can own', () => {
  const u = main().slice(main().indexOf('function unwindDive('), main().indexOf('function escapeKeyDown('));
  assert.ok(u.length > 1200, 'unwindDive body is intact');
  for (const [needle, why] of [
    ['clearReverseWait()', 'the reverse-first timer'],
    ['releaseWatchDisarm()', 'the release-impossible watch'],
    ['clearTimeout(pendingReveal.timer)', 'the prewarm/fallback timer'],
    ['clearTimeout(stallPollT)', 'the stall presentation poll'],
    ['exitStaged()', 'the staged flags + clamp + camera lock'],
    ['finishTwinClose()', 'an open twin'],
    ['quiesceTwinLayers()', 'a mounted overlay with no open twin (fork-resolved hold)'],
    ['restoreDiveCam(reason)', 'the pre-dive camera'],
    ['window.__mapProbe.unwind = rec;', 'the named reason on the probe'],
  ]) {
    assert.ok(u.includes(needle), `unwindDive must clear/handle ${why}`);
  }
});

/* ---------- pre-dive camera record + exact restore ---------- */

test('the dive frame is recorded at forward intent, before any camera write', () => {
  const m = main();
  const flip = m.slice(m.indexOf('function installWheelFlip('), m.indexOf('function installAnchorGuard()'));
  assert.ok(flip.includes("noteDiveFrame('wheel')"), "the wheel flip lane records the frame the dive leaves");
  assert.ok(flip.indexOf("noteDiveFrame('wheel')") < flip.indexOf('flipWheelDelta'),
    'recorded before the lane writes anything');
  assert.ok(m.includes("noteDiveFrame('takeover')"), 'the in-band takeover lane records too');
  assert.ok(m.includes("noteDiveFrame('pinch')"), 'pinch-in records too');
  const click = m.slice(m.indexOf('function flyToSectorThenTwin('), m.indexOf('function flyToSectorThenTwin(') + 1200);
  assert.ok(click.includes("noteDiveFrame('click')"), 'the click/pin entry records before its jump');
  assert.ok(m.includes("if (e && +e.deltaY > 0) noteDiveFrame('wheel-any');"),
    'a window-level capture takes the frame even when the tick lands outside #map');
});

test('mid-dive ticks never overwrite the recorded frame', () => {
  const note = main().slice(main().indexOf('function noteDiveFrame('), main().indexOf('function escapeStateSnapshot('));
  assert.ok(note.includes('if (dz > 0.01 || dc > 1e-4) return false;'),
    'once the camera leaves the recorded frame the dive owns it (a mid-dive pause is not a new dive)');
  assert.ok(note.includes('if (diveInProgress()) return false;'), 'a live dive never re-records');
});

test('the restore writes center + zoom + pitch + bearing in one instant jump', () => {
  const r = main().slice(main().indexOf('function restoreDiveCam('), main().indexOf('function quiesceTwinLayers('));
  for (const part of ['target.center', 'target.zoom', 'target.pitch', 'target.bearing']) {
    assert.ok(r.includes(part), `${part} is restored (pan, depth, tilt, rotation)`);
  }
  assert.ok(r.includes('mapRef.jumpTo(target);'), 'one instant jump — no timer owns camera motion on the escape path');
  assert.ok(r.includes('restoreMaxZoom()'), 'the hold/park ceiling is released');
  assert.ok(r.includes('setSatScrubbed(satOpacityForZoom(zLand))'), 'imagery re-derives from the restored zoom');
  assert.ok(r.includes('resetScrubJourney()'), 'journey flags (iso ownership, ring clip) reset with the frame');
  assert.ok(r.includes('receding = false;') && r.includes('recedeLandHome = null;'),
    'the gesture-owned recede is dropped — the restore IS the landing');
});

test('an aborted close restores the frame it left, not merely home', () => {
  const close = main().slice(main().indexOf('function doCloseTwin('), main().indexOf('function flattenJourneyTiltToLaw('));
  assert.ok(close.includes("if (!unwindActive) {"), 'the close does not double-restore inside unwindDive');
  assert.ok(close.includes("restoreDiveCam('close')"), 'Esc/X close returns to the pre-dive frame');
  // GESTURE REVERSE: a twin-initiated recede (the user scrolling out) keeps
  // the handoff pose instead of teleporting to the frame the dive left, so
  // the way out retraces through the laws and hands over to the native dolly.
  assert.ok(close.includes('if (gestureReverse) {'), 'the close forks on a gesture reverse');
  assert.ok(close.includes('holdHandoffPoseForReverse()'), 'a gesture reverse keeps the handoff pose (no jump home)');
  const holdStart = main().indexOf('function holdHandoffPoseForReverse(');
  const hold = main().slice(holdStart, main().indexOf('\n}\n', holdStart));
  assert.ok(hold.includes('diveCam = null;'), 'the retrace consumes the dive record');
  assert.ok(!hold.includes('jumpTo') && !hold.includes('easeTo'), 'the retrace hand-off moves no camera');
});

/* ---------- the watch is actually sampled ---------- */

test('the release watch is sampled from the drive and the presentation refresh', () => {
  const m = main();
  const drive = m.slice(m.indexOf('function driveStagedOverlay()'), m.indexOf('function twinReleased()'));
  assert.ok(drive.includes('if (releaseWatchTick()) return;'), 'every staged drive samples the watch (and stops once it fired)');
  const refresh = m.slice(m.indexOf('function refreshStallLoading()'), m.indexOf('// Task-37 staged-S producer'));
  assert.ok(refresh.includes('releaseWatchTick()'), 'the 500ms presentation poll samples it — a parked hold with idle fingers is still bounded');
  const watch = m.slice(m.indexOf('function releaseWatchTick()'), m.indexOf('/** Round-10 dive-start prewarm'));
  assert.ok(watch.includes('releaseWatchTimer = setTimeout('), 'the watch self-chains while armed');
  assert.ok(watch.includes('releaseWatchDisarm()'), 'grants and unwinds disarm it');
  assert.ok(watch.includes('unwindDive(reason, { source: \'release-watch\' })'), 'firing unwinds with the named reason');
});

test('reverse drains out of a stalled hold through the same unwind', () => {
  assert.ok(main().includes("unwindDive('reverse-drained', { source: 'reverse' })"),
    'scroll-up from a stalled hold unwinds with a named reason');
});

test('progress beats the clock: a painting twin is never yanked out of its dive', () => {
  // The 2.6s bound must fire on a FREEZE, not on slowness — a heavy device
  // still painting would otherwise have a healthy dive unwound under it.
  const m = main();
  assert.ok(m.includes('function twinFrameCount()'), 'the watch reads the twin frame counter');
  const watch = m.slice(m.indexOf('function releaseWatchTick()'), m.indexOf('function releaseWatchDisarm()') === -1 ? m.length : m.length);
  assert.ok(m.includes('const watchFrames = twinFrameCount()'), 'frames sampled inside the watch');
  assert.ok(
    m.includes('else if (watchFrames > releaseWatchFrames) {') &&
      m.includes('releaseWatchFrames = watchFrames;') &&
      m.includes('releaseWatchHoldT = now;'),
    'a climbing frame count restarts the clock — the reason never fires on progress',
  );
  assert.ok(m.includes('releaseWatchFrames = -1;'), 'state resets when the watch disarms');
});

test('a pause is not a dead end: release reasons need live forward pressure', () => {
  // Stopping to look at the twin ejected the dive home 2.4s later from a
  // granted-but-short hold — measured. Idle fingers mean PAUSED, not stuck.
  assert.equal(releaseImpossibleReason({ iframeAlive: true, readable: true, released: true, waitMs: 9999, driven: false }), null,
    'an idle granted hold is a pause, never an unwind');
  assert.equal(releaseImpossibleReason({ iframeAlive: true, readable: false, waitMs: 9999, driven: false }), null,
    'an unreadable twin with no pressure waits too');
  assert.equal(releaseImpossibleReason({ iframeAlive: false, waitMs: 0, driven: false }), 'iframe-gone',
    'a gone iframe is unrecoverable whatever the fingers do');
  assert.equal(releaseImpossibleReason({ iframeAlive: true, readable: true, released: true, waitMs: 9999, driven: true }), 'release-starved',
    'live pressure still bounds a real starvation');
  const m = main();
  assert.ok(m.includes('lastStagedInputMs = nowMs()'), 'staged input stamps the pressure clock');
  assert.ok(m.includes('const driven = lastStagedInputMs > 0 && now - lastStagedInputMs < STAGED_PRESS_MS'), 'pressure window is explicit');
  assert.ok(m.includes('driven,'), 'the watch passes it to the law');
});

test('no twin re-boot under an opaque overlay + frame epoch resets proof', () => {
  const m = main();
  assert.ok(m.includes('REBOOT LOCK'), 'the navigation gate is documented');
  assert.ok(m.includes('if (!tearing && twinOverlayOpaque() && stagedActive && !stagedCommitted)'),
    'an opaque staged frame may only be torn down, never re-pointed');
  assert.ok(m.includes('FRAME EPOCH'), 'a navigation invalidates the old document proof');
  assert.ok(m.includes('window.__mapProbe.twinReady = false;'), 'proof resets with the epoch');
});
