// tests/map-stall-harden.test.js — stall-hardening: forward swallows in ALL
// lanes including stagedActive below-gate, preventive touch/key guard, pill
// grace (fallback-only), pinch gain dip. Guards the eval findings:
// (a) zoom leaked 10.5->11.5 under the hold via the stagedActive exemptions,
// the takeover early-return, and a gate-only ceiling; (b) the pill showed
// from z~7 on every dive; (c) the pinch lane skipped the maskGain dip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('all three wheel lanes swallow forward with no stagedActive exemption', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    !main.includes('!stagedActive && stallSwallowForward'),
    'no lane exempts stagedActive from the stall swallow (flip 4018 / pinch 4077 fixed)',
  );
  const swallows = main.match(/stallSwallowForward\(\)/g) || [];
  assert.ok(swallows.length >= 4, `forward stall gate consulted in every lane (found ${swallows.length})`);
});

test('takeover stalls staged holds instead of early-returning past them', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('if (twinOpen || transitId || pendingReveal || reverseWait) return;'),
    'the takeover early-return no longer skips stagedActive',
  );
  assert.ok(
    main.includes('HARD-STOP staged hold: staging never drives here'),
    'a staged branch in the takeover still swallows forward under the hold',
  );
});

test('swallowed staged ticks repaint the frozen hold inline', () => {
  const main = srcOf('../src/map/main.js');
  const hits = main.match(/driveStagedOverlay\(\); \} catch \{ \/\* frozen repaint is best-effort \*\/ \}/g) || [];
  assert.ok(
    hits.length >= 3,
    `flip + pinch + takeover swallow branches repaint the frozen hold (found ${hits.length})`,
  );
});

test('pill is fallback-only behind a grace delay', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('const STALL_PILL_GRACE_MS = 2000;'),
    'the pill grace delay is pinned',
  );
  assert.ok(
    main.includes('el.hidden = !(hold && stallWaitMs() >= STALL_PILL_GRACE_MS);'),
    'pill visibility waits out the grace — fast-grant dives never flash it',
  );
});

test('depth ceiling pins live zoom in every phase, releases to the phase owner', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    !main.includes('if (stagedActive) return; // staged clamp owns the ceiling'),
    'no staged exemption in the ceiling: the gate-only cap let zoom travel below it',
  );
  assert.ok(
    main.includes('if (stagedActive && !stagedCommitted) {') && main.includes('mapRef.setMaxZoom(Z_HANDOFF)'),
    'release while staged re-hands the staged clamp, never the native cap',
  );
});

test('pinch stall gate runs before the mask predicate (staged twinOpen bypass)', () => {
  const main = srcOf('../src/map/main.js');
  const gate = main.indexOf('HARD-STOP FIRST: forward pinch stalls whenever the hold owns the');
  assert.ok(gate !== -1, 'the pinch stall gate is hoisted above the mask check');
  const guardFn = main.indexOf('function installAnchorGuard()');
  assert.ok(guardFn !== -1 && gate > guardFn, 'the hoisted gate lives in the pinch guard');
  const armedAfter = main.indexOf('let armed = false;', gate);
  assert.ok(armedAfter > gate, 'maskArmed is consulted only after the stall gate passes');
});

test('pinch lane carries the mask-anchored dip gain', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('maskGainForBlend(centerBlendForZoom(pz), true)'),
    'the pinch guard derives the same mask-anchored dip as the wheel lanes',
  );
  assert.ok(
    main.includes('deltaY: (+e.deltaY || 0) * pinchDip,'),
    'the centered pinch clone scales deltaY by the dip gain',
  );
});

test('preventive touch/keyboard guard swallows forward only, never traps reverse', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('function installStallForwardGuards()'), 'the guard installer exists');
  assert.ok(
    main.includes('try { installStallForwardGuards(); } catch { /* guards best-effort */ }'),
    'the guards are boot-wired beside the other lane guards',
  );
  assert.ok(main.includes("const fwd = k === '+' || k === '=' || k === 'Add';"), 'keyboard + is forward');
  assert.ok(!main.includes('applyStallInputLock'), 'no disable-lock survives (reverse retreat stays free)');
  assert.ok(main.includes('spreading = reverse, always free'), 'pinch-out passes through untouched');
  assert.ok(main.includes('stallPinchD'), 'the touch pinch tracker exists');
  assert.ok(main.includes("window.addEventListener('dblclick'"), 'double-click forward is guarded');
});
