// tests/map-ghost-lock.test.js — ghost-twin + late-lock-in regression.
// Owner verdict 5/10 after 795ae3f: (a) the twin flashed then vanished —
// the pre-gate stall parked the journey BELOW the staging gate (sub-gate
// ceiling pin + mid-climb swallow) so the twin never arrived; (b) the lock
// engaged at the late staged arm (t43/z10.74) instead of at intent (z~7).
// Guards: the stall ceiling never pins below Z_TOP, the mask-armed hold
// swallows only on the gate approach, a set ceiling always re-evaluates,
// and the intent-lock freezes the SITE anchor + pan at the mask arm with no
// center snap (seating stays at the staged arm, drift ~0 by then).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Z_TOP,
  Z_HANDOFF,
  REARM_DOWN_BELOW,
  stallCeilingPin,
  preStallSwallowDue,
} from '../src/map/scrolltrigger.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('stall ceiling never pins below the staging-arm threshold', () => {
  assert.equal(stallCeilingPin(Z_TOP - 3), Z_TOP, 'a mid-climb live zoom pins at the gate, not below it');
  assert.equal(stallCeilingPin(7.0), Z_TOP, 'the mask-arm freeze parks at the gate');
  assert.equal(stallCeilingPin(Z_TOP), Z_TOP, 'at the gate the pin is identity');
  assert.equal(stallCeilingPin(Z_TOP + 0.4), Z_TOP + 0.4, 'past the gate the pin tracks live zoom');
  assert.equal(stallCeilingPin(14), 14, 'deep pins track live zoom');
  assert.equal(stallCeilingPin(NaN), Z_TOP, 'non-finite reads fall back to the gate');
  assert.equal(stallCeilingPin(undefined), Z_TOP, 'missing reads fall back to the gate');
});

test('staged stall pins at the commit gate, not the iso checkpoint', () => {
  // The same trap one level later: a stall landing at the staged arm pinned
  // the ceiling at Z_TOP (10.5) while commit needs Z_HANDOFF (11.5) — the
  // dive parked at z10.59 under a 100% opaque overlay for 61s with every
  // forward input dead (measured). The staged floor is the gate itself.
  assert.equal(stallCeilingPin(10.59, Z_HANDOFF), Z_HANDOFF, 'a staged hold can still reach the gate');
  assert.equal(stallCeilingPin(Z_HANDOFF - 0.01, Z_HANDOFF), Z_HANDOFF, 'short of the gate pins at the gate');
  assert.equal(stallCeilingPin(7.0, Z_HANDOFF), Z_HANDOFF, 'a deep staged stall still reaches the gate');
  assert.equal(stallCeilingPin(13, Z_HANDOFF), 13, 'past the gate the pin tracks live zoom');
  assert.equal(stallCeilingPin(9.0, Z_TOP), Z_TOP, 'the pre-gate lanes keep the iso floor');
  assert.equal(stallCeilingPin(9.0, 1), Z_TOP, 'a floor below the arm is raised to Z_TOP');
  assert.equal(stallCeilingPin(9.0, undefined), Z_TOP, 'no floor means the iso floor');
  assert.equal(stallCeilingPin(NaN, Z_HANDOFF), Z_HANDOFF, 'non-finite reads fall back to the given floor');
});

test('pre-phase stall swallows only on the gate approach', () => {
  assert.equal(
    preStallSwallowDue({ phase: 'pre', z: REARM_DOWN_BELOW }),
    true,
    'at the approach the mask-armed hold still stops forward',
  );
  assert.equal(
    preStallSwallowDue({ phase: 'pre', z: REARM_DOWN_BELOW + 0.5 }),
    true,
    'inside the approach the stop holds',
  );
  assert.equal(
    preStallSwallowDue({ phase: 'pre', z: REARM_DOWN_BELOW - 0.01 }),
    false,
    'below the approach the climb flows — never frozen mid-gesture',
  );
  assert.equal(
    preStallSwallowDue({ phase: 'pre', z: 7.0 }),
    false,
    'at the mask arm the climb flows (mask forms, tilt glides, tiles warm)',
  );
  assert.equal(
    preStallSwallowDue({ phase: 'pre', z: NaN }),
    false,
    'unreadable zoom never swallows',
  );
  assert.equal(
    preStallSwallowDue({ phase: 'staged', z: 7.0 }),
    true,
    'the staged S stall is zoom-independent and untouched',
  );
  assert.equal(
    preStallSwallowDue({ phase: null, z: 11 }),
    true,
    'no phase means no gate to apply',
  );
});

test('stall ceiling + swallow gates are wired in the driver', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('stallCeilingPin(z, floorZ)') && main.includes('mapRef.setMaxZoom(pin)'),
    'the depth freeze pins through the gate-floor law, never the raw live zoom',
  );
  assert.ok(
    main.includes('if (hold || stallCeilingOn)'),
    'a set ceiling re-evaluates on the poll chain even with zero input (no frozen-frame deadlock)',
  );
  assert.ok(
    main.includes('preStallSwallowDue({ phase, z: zNow })'),
    "the mask-armed hold consults the approach gate before swallowing",
  );
  assert.ok(
    main.includes('try { armed = stallArmed(); } catch { armed = false; }'),
    'the hold presentation/ceiling runs on the single stallArmed gate (no bypass re-arming the hold below the approach)',
  );
  assert.ok(
    main.includes("import {") && main.includes('stallCeilingPin,') && main.includes('preStallSwallowDue,'),
    'both laws are imported (single source, no restated literals)',
  );
});

test('intent-lock freezes anchor + pan at the mask arm, never seats', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('INTENT-LOCK'), 'the intent-lock block is marker-pinned');
  assert.ok(
    main.includes('freezeStagedFrame(false)'),
    'intent engages a snapshot-only freeze (seat=false)',
  );
  const freeze = main.slice(main.indexOf('function freezeStagedFrame(seat = true)'), main.indexOf('function reassertStagedAnchor('));
  assert.ok(
    freeze.includes('if (seat)'),
    'seating is gated on the seat flag',
  );
  assert.ok(
    freeze.includes('mapRef.jumpTo({ center: SITE_LNGLAT })'),
    'the staged arm still seats onto SITE',
  );
  // The intent engage block itself must carry no center write: seating a
  // fresh ~175px drift at the mask arm would snap.
  const intentAt = main.indexOf('freezeStagedFrame(false)');
  const intentBlock = main.slice(Math.max(0, intentAt - 1200), intentAt + 400);
  assert.ok(!intentBlock.includes('jumpTo'), 'no seating write on the intent path (glide owns the center, no snap)');
  assert.ok(
    main.includes('} else if (stagedFrozen && !stagedActive) {'),
    'intent loss releases the lock so pan restores when the journey is abandoned',
  );
});

test('staged reveal still owns overlay visibility end to end (no second writer)', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('finalizeStagedReveal(root)'),
    'the commit still runs the staged reveal finalize path',
  );
  assert.ok(
    main.includes('window.__mapProbe.staged.blankTwin = true'),
    'the blank-twin guard still holds the map instead of committing blind',
  );
  assert.ok(
    main.includes("root.classList.add('scrubbing')"),
    'S-owned opacity still suspends the transition (single writer, no lag snap)',
  );
});
