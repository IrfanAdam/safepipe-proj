// tests/map-intent-gate.test.js — lane intent-gate (owner feedback): the
// hotspot journey is reserved for REAL lock-in intent. It used to arm the
// moment the hotspot was anywhere in the frame (`armed = cursorNear ||
// centerNear || inView`), so a hotspot parked on the periphery hijacked
// ordinary scroll-to-zoom exploration — mask up, twin booted, and past Z_TOP
// the ceiling clamped at Z_HANDOFF and the camera flew to Sangachal.
//
// Laws pinned here:
//   1. journeyArmed — intent is CURSOR-NEAR or CENTRE-NEAR. On-screen is not
//      intent: `inView` stays a diagnostic field and can never flip `armed`.
//   2. proximityInfo arms on that one predicate (no `|| inView` door).
//   3. The deep latch (z >= Z_TOP) requires the live arm predicate: no intent
//      means no clamp, no flight; the ceiling is restored and the latch
//      re-arms so a later intended dive still fires.
//   4. The z>=Z_HANDOFF takeover edge (onDown) reads the same predicate, so an
//      unclamped far dive is never captured by the twin one level later.
//   5. No new magic px/zoom literals: the existing proximity radii and the
//      existing Z_* constants carry the change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  journeyArmed,
  Z_TOP,
  Z_HANDOFF,
  Z_MAX,
  Z_CENTER,
} from '../src/map/scrolltrigger.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const mainSrc = () => srcOf('../src/map/main.js');

test('journeyArmed: cursor-near OR centre-near, nothing else', () => {
  assert.equal(journeyArmed({ cursorNear: true, centerNear: false }), true, 'cursor intent arms');
  assert.equal(journeyArmed({ cursorNear: false, centerNear: true }), true, 'centre intent arms');
  assert.equal(journeyArmed({ cursorNear: true, centerNear: true }), true, 'both arms');
  assert.equal(journeyArmed({ cursorNear: false, centerNear: false }), false, 'no intent does not arm');
  assert.equal(journeyArmed({}), false, 'a read with no near flags does not arm');
  assert.equal(journeyArmed(), false, 'no read at all does not arm');
  assert.equal(journeyArmed(null), false, 'a null read cannot throw the journey open');
});

test('on-screen is not intent: inView can never flip armed', () => {
  // The periphery case: the hotspot is on screen, the cursor is elsewhere and
  // the camera centre is elsewhere. Every journey predicate must read false.
  const periphery = {
    cursorNear: false, centerNear: false, inView: true,
    distCursor: 640.2, distCenter: 380.5,
  };
  assert.equal(journeyArmed(periphery), false, 'a periphery hotspot does not arm the journey');
  // ... and a hot spot just outside the frame with the cursor on it still arms.
  assert.equal(journeyArmed({ cursorNear: true, centerNear: false, inView: false }), true,
    'cursor intent arms even from the frame edge');
});

test('proximityInfo arms on the one predicate; inView survives as telemetry only', () => {
  const main = mainSrc();
  assert.ok(main.includes('armed: journeyArmed({ cursorNear, centerNear })'),
    'the arm read is the shared predicate');
  assert.ok(!/armed:\s*cursorNear \|\| centerNear/.test(main),
    'no inline near-or door beside the law');
  const prox = main.slice(
    main.indexOf('function proximityInfo('),
    main.indexOf('/* CENTRE-SETTLE'),
  );
  assert.ok(prox.includes('const inView ='), 'inView is still computed');
  assert.ok(prox.includes('cursorNear, centerNear, inView,'), 'inView is still published (diagnostic)');
  assert.ok(!prox.includes('armed: cursorNear'), 'inView never reaches the armed read');
  assert.ok(prox.includes('near: cursorNear || centerNear'), 'near is unchanged');
});

test('the deep latch is gated on live intent: no intent, no clamp, no flight', () => {
  const main = mainSrc();
  assert.ok(main.includes('const deepIntent = !!(prox && prox.armed);'),
    'the latch reads the live arm predicate');
  assert.ok(main.includes('if (!twinOpen && !busyNow && z >= Z_HANDOFF - 0.01 && deepIntent)'),
    'the latch requires intent alongside the handoff gate');
  assert.ok(!main.includes('if (!twinOpen && !busyNow && z >= Z_HANDOFF - 0.01) {'),
    'the zoom-only latch is gone');
  // The clamp + the flight live INSIDE the gated branch: neither can run for
  // an intent-less dive.
  const latch = main.slice(
    main.indexOf('const deepIntent = !!(prox && prox.armed);'),
    main.indexOf('(5) MIRRORED REVERSE'),
  );
  assert.ok(latch.includes('mapRef.setMaxZoom(Z_HANDOFF)'), 'the clamp is still the handoff zoom');
  assert.ok(latch.includes('flyToSectorThenTwin(siteSector)'), 'the flight still starts here');
  const gateAt = latch.indexOf('&& deepIntent)');
  assert.ok(gateAt > 0 && latch.indexOf('mapRef.setMaxZoom(Z_HANDOFF)') > gateAt,
    'the clamp sits after the intent gate');
  assert.ok(latch.indexOf('flyToSectorThenTwin(siteSector)') > gateAt,
    'the flight sits after the intent gate');
});

test('the latch re-reads intent one frame later and re-arms when it is gone', () => {
  const main = mainSrc();
  const latch = main.slice(
    main.indexOf('const deepIntent = !!(prox && prox.armed);'),
    main.indexOf('(5) MIRRORED REVERSE'),
  );
  // The deferred callback can run a frame after the cursor left the hotspot.
  assert.ok(latch.includes('const lateProx = proximityInfo();'),
    'the deferred trigger re-reads proximity live');
  assert.ok(latch.includes('if (!(lateProx && lateProx.armed)) { scrubFired = false; restoreMaxZoom(); return; }'),
    'a stale latch unclamps and re-arms instead of flying');
  assert.ok(latch.includes('frameProxCache = null;'), 'the pass memo is dropped before the re-read');
  // The re-arm branch releases the ceiling and the latch flag together.
  assert.ok(latch.includes('} else if (scrubFired && !twinOpen && !stagedActive && !pendingReveal && (z < REARM_DOWN_BELOW || !deepIntent)) {'),
    'intent loss (or a zoom drop) re-arms the latch');
  const rearm = latch.slice(latch.indexOf('(z < REARM_DOWN_BELOW || !deepIntent)'));
  assert.ok(rearm.includes('scrubFired = false;'), 'the latch flag clears');
  assert.ok(rearm.includes('restoreMaxZoom();'), 'the ceiling returns to the map cap');
});

test('the z>=Z_HANDOFF takeover edge reads the same intent predicate', () => {
  const main = mainSrc();
  const down = main.slice(main.indexOf('onDown: () => {'), main.indexOf('onUp: () => closeTwin()'));
  assert.ok(down.includes('const p = proximityInfo();'), 'the takeover edge reads live proximity');
  assert.ok(down.includes('if (!(p && p.armed)) return;'), 'no intent means no takeover');
  const gateAt = down.indexOf('if (!(p && p.armed)) return;');
  assert.ok(gateAt > 0 && down.indexOf('flyToSectorThenTwin(siteSector)') > gateAt,
    'the takeover flight sits after the intent gate');
});

test('no new magic px/zoom literals: the change reuses the existing constants', () => {
  const main = mainSrc();
  assert.equal(Z_CENTER, 7.0, 'mask band floor unchanged');
  assert.equal(Z_TOP, 10.5, 'iso checkpoint unchanged');
  assert.equal(Z_HANDOFF, 11.5, 'handoff gate unchanged');
  assert.equal(Z_MAX, 14.0, 'map cap unchanged');
  assert.ok(main.includes('const PROX_CURSOR_PX = 140;'), 'cursor radius unchanged');
  assert.ok(main.includes('const PROX_CENTER_PX = 90;'), 'centre radius unchanged');
});
