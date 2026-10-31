// tests/map-click-flight.test.js — owner rev 2026-10-30 (click arrival, fast
// exit, parent fullscreen). Three measured complaints, one law each:
//   (1) CLICK — the hotspot click jumped to a wide ring fit in ONE frame
//       (duration-0 jumpTo), so the owner "never saw the map zooming in", and
//       the twin only appeared after a 4s paint-gated timer. The click is
//       explicit intent: it now flies ONE continuous camera move from the live
//       pose to the site at the gate, with the prewarm booting underneath it.
//   (2) EXIT — a fast flick out of the gate skipped both the zoomend reconcile
//       (gated on isoRestoreDue) and the home arrival flatten, so the large
//       plane stayed skewed below the band. One terminal flatten law now ends
//       every below-band settle flat (pitch 0, bearing 0, instant).
//   (3) FULLSCREEN — the twin posts {type:'safepipe-twin-fullscreen'}, but a
//       message event carries no user activation, so the parent's
//       requestFullscreen from that handler is rejected (Safari). The overlay
//       bar now owns a parent button, styled with the close chrome, whose
//       pressed state mirrors the real fullscreen element.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFlattenDue, FLATTEN_TOL_DEG, Z_ISO_START, pitchTargetForZoom, Z_HANDOFF } from '../src/map/scrolltrigger.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcOf = (rel) => readFileSync(join(here, rel), 'utf8');
const main = () => srcOf('../src/map/main.js');
const html = () => srcOf('../ops3d-map.html');

/** Slice one function body out of a source file (brace counting, no regex
 * fragility): the click-entry assertions must be about THAT branch. */
function fnBody(src, name) {
  const at = src.indexOf('function ' + name);
  assert.ok(at >= 0, `${name} exists`);
  // The body opener is the `{` AFTER the parameter list closes — never the
  // `{` of a defaulted object param (`opts = {}`).
  const open = src.indexOf(') {', at) + 2;
  assert.ok(open > 2, `${name} has a body opener`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${name} body is unbalanced`);
}

/* ---------- (1) the click is a continuous flight, never a cut ---------- */

test('click arrival flies: one easeTo with a real duration, no wide-fit cut', () => {
  const m = main();
  const flight = fnBody(m, 'startClickFlight');
  assert.match(flight, /mapRef\.easeTo\(\{/, 'the arrival is a camera ease');
  assert.match(flight, /duration: CLICK_FLIGHT_MS/, 'the ease has a named duration');
  assert.match(flight, /essential: true/, 'the flight runs regardless of the OS motion query');
  const ms = +(/const CLICK_FLIGHT_MS = (\d+);/.exec(m) || [])[1];
  assert.ok(Number.isFinite(ms) && ms >= 1000 && ms <= 2000,
    `the flight is long enough to read the world->site sweep (got ${ms})`);
  // The old one-frame cut and its wide-fit helpers are gone from the file.
  assert.ok(!m.includes('wideZoomForBounds'), 'the wide ring-fit jump target is deleted');
  assert.ok(!m.includes('wideFitPadding'), 'the wide-fit padding helper is deleted');
  assert.ok(!m.includes('jumpTo({ center: w.center'), 'no duration-0 jump to a wide fit remains');
  // Reduced motion keeps ONE honest cut — to the SAME arrival pose, never a
  // different (wide) frame.
  const reduced = /if \(reduced\) \{[\s\S]{0,400}?mapRef\.jumpTo\(\{[\s\S]{0,160}?zoom: dest\.z[\s\S]{0,80}?pitch: dest\.pitch/.exec(flight);
  assert.ok(reduced, 'reduced motion cuts to the same arrival pose (zoom + pitch), not a wide fit');
});

test('the click entry flies before it reads proximity (explicit intent, no cursor gate)', () => {
  const m = main();
  const body = fnBody(m, 'flyToSectorThenTwin');
  const fly = body.indexOf('clickFlying = startClickFlight(');
  const prox = body.indexOf('const proxNow = proximityInfo();');
  assert.ok(fly > 0 && prox > 0, 'both the flight and the proximity read are in the entry');
  assert.ok(fly < prox, 'the flight is issued before any proximity predicate is read');
  assert.match(body, /clickDest = clickArrivalPose\(\);/, 'the entry derives the arrival pose');
  assert.match(body, /prewarmThenReveal\(id, clickFrame, \{ \.\.\.opts, staged: true \}\)/,
    'the twin boots staged under the flight — no timed unstaged reveal');
  assert.match(body, /scheduleClickStagedArm\(id, clickFrame, opts\)/,
    'the same staged enclosure hold is promoted on the landing frame');
  assert.match(body, /clickStagedPending = true/, 'a mid-flight grant cannot open an unenclosed twin');
});

test('the arrival pose rides the shared pitch law at the gate', () => {
  const pose = fnBody(main(), 'clickArrivalPose');
  assert.match(pose, /const z = Z_HANDOFF;/, 'the gate is the destination zoom');
  assert.match(pose, /pitch: pitchTargetForZoom\(z\)/, 'the tilt is the ONE pitch law, not a literal');
  assert.match(pose, /bearing: 0/, 'the arrival is flat in bearing');
  assert.match(pose, /cx: SITE_LNGLAT\[0\],\s*cy: SITE_LNGLAT\[1\]/s, 'the arrival is centred on the site');
  // Sanity on the law itself: the gate pose is the iso tilt the scroll path
  // meets the twin with.
  assert.equal(pitchTargetForZoom(Z_HANDOFF), 45, 'the gate pose carries the 45deg iso tilt');
});

test('the timed reveal waits for the flight to land (and only the fade)', () => {
  const m = main();
  const reveal = fnBody(m, 'revealTwin');
  assert.match(reveal, /if \(!instant && clickFlightActive\(\)\) \{[\s\S]{0,140}?deferRevealToFlightLand\(\);/,
    'the crossfade is deferred to the landing, so it never fades over a moving camera');
  assert.match(reveal, /return false;[\s\S]{0,80}?\}/, 'a deferred reveal is not marked revealed');
  const defer = fnBody(m, 'deferRevealToFlightLand');
  assert.match(defer, /if \(!pendingReveal \|\| pendingReveal\.revealed\) return;/, 'the deferral is idempotent');
  assert.match(defer, /revealTwin\(false\);/, 'the deferral re-enters the same reveal');
  // Re-entrant clicks during the flight are ignored (the move owns the camera).
  assert.match(fnBody(m, 'flyToSectorThenTwin'), /if \(transitId \|\| clickFlightActive\(\)\) return false;/,
    'a second entry during the flight is ignored');
});

/* ---------- (2) the terminal flatten law (pure) ---------- */

test('a below-band settle with any tilt owes a flatten', () => {
  const below = Z_ISO_START - 1.5;
  assert.equal(settleFlattenDue({ z: below, pitch: 45, bearing: 0 }), true, 'pitch 45 below the band');
  assert.equal(settleFlattenDue({ z: below, pitch: 0, bearing: 32 }), true, 'bearing only still flattens');
  assert.equal(settleFlattenDue({ z: below, pitch: 45, bearing: -90 }), true, 'both out');
  assert.equal(settleFlattenDue({ z: below, pitch: 12.5, bearing: 0.2 }), true, 'a mid-retrace strand');
});

test('inside the band, with the twin open, or already flat: no write', () => {
  assert.equal(settleFlattenDue({ z: Z_ISO_START, pitch: 45, bearing: 0 }), false, 'the band start still owns its law');
  assert.equal(settleFlattenDue({ z: Z_HANDOFF, pitch: 45, bearing: 0 }), false, 'the gate pose is the law pose');
  assert.equal(settleFlattenDue({ z: Z_ISO_START - 1, pitch: 45, bearing: 0, twinOpen: true }), false,
    'the twin owns the frame — never write under it');
  assert.equal(settleFlattenDue({ z: Z_ISO_START - 1, pitch: 0, bearing: 0 }), false, 'flat arrivals no-op');
  assert.equal(settleFlattenDue({ z: Z_ISO_START - 1, pitch: FLATTEN_TOL_DEG, bearing: 0 }), false,
    'inside tolerance counts as flat');
  assert.equal(settleFlattenDue({ z: Z_ISO_START - 1, pitch: NaN, bearing: NaN }), false,
    'an unreadable pose never triggers a camera write');
  assert.equal(settleFlattenDue({}), false, 'no arguments is never a flatten');
});

test('every reverse settle and home arrival writes the flat pose instantly', () => {
  const m = main();
  const step = fnBody(m, 'onNativeZoomStep');
  assert.match(step, /source === 'native-zoomend'[\s\S]{0,220}?settleFlattenDue\(\{ z, pitch: pSettle, bearing: bSettle, twinOpen \}\)/,
    'the settle reads the live pose through the pure predicate');
  const writes = (m.match(/mapRef\.jumpTo\(\{ pitch: 0, bearing: 0 \}\)/g) || []).length;
  assert.ok(writes >= 2, `the settle and the home arrival both write pitch 0 + bearing 0 (found ${writes})`);
  // No timer owns the flatten: it is a jumpTo inside the settle pass.
  assert.ok(!/setTimeout\([^)]*flatten/i.test(m), 'no timer owns the flatten');
  const recede = fnBody(m, 'recedeToHome');
  assert.match(recede, /settleFlattenDue\(\{[\s\S]{0,220}?z: cHome && cHome\.zoom,[\s\S]{0,220}?bearing: cHome && cHome\.bearing/,
    'the home arrival uses the same law (pitch AND bearing)');
});

/* ---------- (3) parent-owned fullscreen button ---------- */

test('the overlay bar carries the parent fullscreen button and its click path', () => {
  const m = main();
  const overlay = fnBody(m, 'ensureOverlay');
  assert.match(overlay, /id="twin-fs" type="button" aria-pressed="false"/, 'the button exists, unpressed by default');
  assert.ok(overlay.indexOf('id="twin-fs"') < overlay.indexOf('id="twin-close"'),
    'the fullscreen control sits beside CLOSE, before it in the bar');
  assert.match(overlay, /fsBtn\.addEventListener\('click', \(\) => \{[\s\S]{0,320}?setTwinFs\(!isFs\)/,
    'the click toggles through setTwinFs (the parent gesture is the activation)');
  assert.match(overlay, /document\.fullscreenElement === root/, 'the toggle reads the real fullscreen element');
  assert.match(overlay, /overlayEls = \{ root, frame, closeBtn, fsBtn, label \}/, 'the button is part of the overlay refs');
  const sync = fnBody(m, 'syncFsProbe');
  assert.match(sync, /const fb = \(overlayEls && overlayEls\.fsBtn\) \|\| document\.getElementById\('twin-fs'\)/,
    'syncFsProbe finds the button');
  assert.match(sync, /fb\.setAttribute\('aria-pressed', String\(fsEl === \(overlayEls && overlayEls\.root\)\)\)/,
    'aria-pressed mirrors the actual fullscreen element');
});

test('the button is styled with the bar chrome and stays visible in fullscreen', () => {
  const h = html();
  assert.match(h, /#twin-close, #twin-fs \{/, 'the fullscreen button shares the close chrome');
  assert.match(h, /#twin-fs:hover/, 'it has the same hover affordance');
  assert.match(h, /#twin-fs\[aria-pressed="true"\] \{/, 'the pressed state is styled');
  assert.match(h, /#twin-overlay:fullscreen \.twin-overlay__bar \{ display: flex; \}/,
    'the bar (both controls) stays visible in overlay-fullscreen');
  // Tokens only: no raw hex in the new rules.
  const rules = h.slice(h.indexOf('#twin-close, #twin-fs {'), h.indexOf('#twin-fs[aria-pressed="true"]'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(rules), 'no raw hex outside the token layer');
});
