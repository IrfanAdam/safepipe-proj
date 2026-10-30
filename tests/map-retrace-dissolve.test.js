// tests/map-retrace-dissolve.test.js — the gesture reverse retraces through
// the phases instead of cutting to the full map, and the grant-time re-hand
// adopts the live frame instead of yanking the camera.
// Guards two measured failures on the gallery dive:
//   (a) COMMIT NEVER LANDS: the per-tick staged pin jumpTo({center}) called
//       MapLibre's stop() on every armed tick, killing the native zoom ease
//       (700px of S for 0.15 levels, limit cycle z 10.511<->10.663), and the
//       grant-time re-hand jumpTo({zoom: entry}) pinned depth at the entry
//       zoom — S saturated under an opaque overlay, then the release watch
//       ejected the dive (release-starved, 2.6s) to z 1.13.
//   (b) REVERSE ONE-FRAME CUT: wheel-out hid the overlay 1.0->0.0 in one
//       frame (z 11.47->11.24, unwindCount 0, recede null) because the
//       gesture close hid synchronously instead of retracing.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  retraceOpacityForZoom,
  Z_TOP,
  Z_HANDOFF,
} from '../src/map/scrolltrigger.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const main = () => srcOf('../src/map/main.js');

/* ---------- the reverse dissolve law (pure) ---------- */

test('retrace law: 1 at the gate, 0 at/below the checkpoint, monotone', () => {
  assert.equal(retraceOpacityForZoom(Z_HANDOFF), 1, 'the committed frame starts opaque');
  assert.equal(retraceOpacityForZoom(Z_TOP), 0, 'the checkpoint lands at 0 (teardown snaps nothing)');
  assert.equal(retraceOpacityForZoom(Z_TOP - 2), 0, 'below the checkpoint parks at 0');
  assert.equal(retraceOpacityForZoom(Z_HANDOFF + 1), 1, 'above the gate parks at 1');
  assert.equal(retraceOpacityForZoom(NaN), 0, 'non-numeric parks at 0');
  let prev = 2;
  for (let z = Z_HANDOFF; z >= Z_TOP - 0.001; z -= 0.05) {
    const v = retraceOpacityForZoom(z);
    assert.ok(v <= prev + 1e-9, `z=${z.toFixed(2)} must not rise on the way out (${prev} -> ${v})`);
    assert.ok(v >= 0 && v <= 1, `z=${z.toFixed(2)} stays in [0,1]`);
    prev = v;
  }
  const mid = retraceOpacityForZoom((Z_TOP + Z_HANDOFF) / 2);
  assert.ok(mid > 0.3 && mid < 0.7, `the mid-band fade is gradual, not a cut (got ${mid})`);
  // No single-frame cut: the steepest per-tick step at wheel-notch cadence
  // (0.25 zoom/tick) stays well under the full-range cut.
  let worst = 0;
  for (let z = Z_TOP; z <= Z_HANDOFF; z += 0.25) {
    worst = Math.max(worst, Math.abs(retraceOpacityForZoom(z + 0.25) - retraceOpacityForZoom(z)));
  }
  assert.ok(worst < 0.5, `max per-tick step is a fade (${worst.toFixed(3)}), never a cut`);
});

test('retrace law starts and ends at rest (smoothstep, no snap at either end)', () => {
  const e = 1e-3;
  const startSlope = (retraceOpacityForZoom(Z_TOP + e) - retraceOpacityForZoom(Z_TOP)) / e;
  const endSlope = (retraceOpacityForZoom(Z_HANDOFF) - retraceOpacityForZoom(Z_HANDOFF - e)) / e;
  assert.ok(Math.abs(startSlope) < 0.05, `zero slope at the teardown end (got ${startSlope})`);
  assert.ok(Math.abs(endSlope) < 0.05, `zero slope at the gate end (got ${endSlope})`);
});

/* ---------- the grant-time re-hand adopts, never yanks ---------- */

test('grant-time re-hand adopts the live zoom; no camera write survives in it', () => {
  const m = main();
  const re = m.slice(m.indexOf('function reassertStagedAnchor('), m.indexOf('function unfreezeStagedFrame('));
  assert.ok(re.length > 500, 'reassertStagedAnchor body is intact');
  assert.ok(!re.includes('mapRef.jumpTo'), 'adopt-only: no depth/center yank at grant (every jumpTo here stop()s the travelling ease)');
  assert.ok(!re.includes('mapRef.easeTo'), 'adopt-only: no eased yank either');
  assert.ok(re.includes('stagedAnchor.z = z;'), 'the anchor adopts the live depth');
  assert.ok(re.includes('ADOPT-ONLY'), 'the adopt-only contract is marker-pinned');
});

/* ---------- the gesture reverse dissolves, never hides ---------- */

test('gesture close keeps the overlay mounted and dissolves it by zoom', () => {
  const m = main();
  const close = m.slice(m.indexOf('function doCloseTwin('), m.indexOf('function flattenJourneyTiltToLaw('));
  assert.ok(close.includes('if (!gestureReverse) {'), 'the instant hide is skipped on a gesture reverse');
  assert.ok(close.includes('beginRetraceDissolve()'), 'the gesture path begins the zoom-keyed dissolve');
  assert.ok(close.includes('if (!retraced)'), 'a begin with nothing to dissolve falls back to the instant hide');
  assert.ok(m.includes('function beginRetraceDissolve('), 'begin owns the mount check');
  assert.ok(m.includes('function driveRetraceDissolve('), 'drive repaints the fade per zoom step');
  assert.ok(m.includes('function endRetraceDissolve('), 'end lands the teardown at Z_TOP');
  assert.ok(m.includes('retraceOpacityForZoom(z)'), 'the fade reads the one shared law');
  assert.ok(m.includes("root.style.pointerEvents = 'none'"), 'wheels pass through to the map canvas while the fade owns the overlay');
  assert.ok(m.includes('if (retraceDissolve) driveRetraceDissolve();'), 'every native zoom step repaints the fade');
});

test('the reverse dissolve moves no camera and arms the way home', () => {
  const m = main();
  for (const fn of ['beginRetraceDissolve', 'driveRetraceDissolve', 'endRetraceDissolve']) {
    const body = m.slice(m.indexOf(`function ${fn}(`), m.indexOf('\n}\n', m.indexOf(`function ${fn}(`)));
    assert.ok(body.length > 200, `${fn} body is intact`);
    assert.ok(!body.includes('mapRef.jumpTo') && !body.includes('mapRef.easeTo'), `${fn} moves no camera (fingers own every pixel)`);
  }
  const hold = m.slice(m.indexOf('function holdHandoffPoseForReverse('), m.indexOf('/* GESTURE-REVERSE DISSOLVE'));
  assert.ok(hold.includes('diveCam = null;'), 'the retrace still consumes the dive record');
  assert.ok(!hold.includes('jumpTo') && !hold.includes('easeTo'), 'the retrace hand-off still moves no camera');
  assert.ok(hold.includes('recedeToHome()'), 'the landing is re-armed when disarmed (an un-armed retrace would sit at out forever)');
});

test('recede reports out through the retrace and home at the landing', () => {
  const m = main();
  assert.ok(!m.includes("window.__mapProbe.recede = 'retrace'"), 'no third recede state: the contract is out/home');
  const hold = m.slice(m.indexOf('function holdHandoffPoseForReverse('), m.indexOf('/* GESTURE-REVERSE DISSOLVE'));
  assert.ok(hold.includes("window.__mapProbe.recede = 'out'"), 'the retrace holds recede at out');
  assert.ok(m.includes('recedeLandHome = landHome;'), 'the landing closure is still armed');
  assert.ok(m.includes('if (receding && recedeLandHome)'), 'the zoom-step home check still lands it');
});

test('a parked retrace never stalls a re-dive behind its own loader', () => {
  const m = main();
  const stall = m.slice(m.indexOf('function stallArmed('), m.indexOf('function stallWaitMs('));
  assert.ok(stall.includes('if (receding) return false;'), 'a recede-owned frame never swallows forward (the retrace teardown lands twinless mid-mask)');
});

test('fresh opens and unwinds never inherit a reverse dissolve', () => {
  const m = main();
  assert.ok(m.includes('try { stopRetraceMode(); } catch { /* mode clear is best-effort */ }'), 'a fresh open clears a stale dissolve (never half-faded or click-dead)');
  const unwind = m.slice(m.indexOf('function unwindDive('), m.indexOf('function escapeKeyDown('));
  assert.ok(unwind.includes('if (retraceDissolve) endRetraceDissolve();'), 'a mid-retrace escape lands the dissolve before the camera restore');
});

/* ---------- slow-reverse freeze (owner 2026-10-30) ---------- */

test('a slow reverse at the gate cannot re-open the twin', () => {
  const m = main();
  const begin = m.slice(m.indexOf('function beginRetraceDissolve('), m.indexOf('function driveRetraceDissolve('));
  const drive = m.slice(m.indexOf('function driveRetraceDissolve('), m.indexOf('function endRetraceDissolve('));
  const stop = m.slice(m.indexOf('function stopRetraceMode('), m.indexOf('function beginRetraceDissolve('));
  assert.ok(begin.includes('retraceLastZ = z;'), 'begin records the gate zoom');
  assert.ok(drive.includes('const movedIn = Number.isFinite(retraceLastZ) && z > retraceLastZ + 0.005;'),
    're-open is gated on a real inward movement, not on a frame that merely stayed at the gate');
  assert.ok(drive.includes('if (!movedIn) {'), 'the no-movement case keeps the retrace armed');
  assert.ok(drive.indexOf('if (!movedIn)') < drive.indexOf('twinOpen = true'),
    'the direction guard runs before the re-open side effects');
  assert.ok(stop.includes('retraceLastZ = NaN;'), 'every mode stop clears the direction sample');
});

test('the retrace owns the pointer and blocks a mid-recede twin boot', () => {
  const m = main();
  const begin = m.slice(m.indexOf('function beginRetraceDissolve('), m.indexOf('function driveRetraceDissolve('));
  const early = m.slice(m.indexOf('function earlyBootTwin()'), m.indexOf('function abortEarlyBootTwin('));
  const idle = m.slice(m.indexOf('function preloadTwinShellIdle()'), m.indexOf('/** Handoff-4 Lane A seeded reveal', m.indexOf('function preloadTwinShellIdle()')));
  assert.ok(begin.includes("fr.style.pointerEvents = 'none'"), 'the frame cannot re-enable pointer ownership over the retrace');
  assert.ok(begin.includes('fr.blur?.()'), 'focus leaves the hidden twin');
  assert.ok(early.includes('if (receding || retraceDissolve || reverseWait) return false;'),
    'a gesture reverse never boots a fresh twin under the fingers');
  assert.ok(idle.includes('if (receding || retraceDissolve || reverseWait) return false;'),
    'the idle shell never races the retrace');
});

test('closing a committed twin clears its staging ownership', () => {
  const m = main();
  const close = m.slice(m.indexOf('function doCloseTwin('), m.indexOf('function holdHandoffPoseForReverse('));
  const reset = m.slice(m.indexOf('function resetStagedOwnership()'), m.indexOf('/** THE ESCAPE.'));
  assert.ok(close.includes('resetStagedOwnership();'), 'the close chain drops the flags after the overlay is handled');
  for (const line of ['stagedActive = false;', 'stagedS = 0;', 'stagedCommitted = false;']) {
    assert.ok(reset.includes(line), `reset clears ${line.trim()}`);
  }
  assert.ok(!reset.includes('root.hidden'), 'the flags-only reset never hides a frame the retrace still owns');
});
