// tests/twin-arrival-terminal.test.js — reused-shell arrival lane: a warm twin
// shell booted at the home frame is retargeted onto the SITE frame; both pins
// clamp to the SAME rail range, so a range-only refit guard never rebuilt the
// hold and the commit landed on the boot world (eye/target ~-3.2e6, coverage 0)
// — the "blank, only the controls" state the owner reported after the iso
// stage. Pins the anchor-aware refit + terminal re-derivation on the arrival
// frame, now on the ONE handoff range derived from the handed gate frame (the
// retired 18 km constant-metre terminal is gone: hold, mid and terminal share
// the gate frame's ground scale).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handoffRefitDue,
  terminalPoseForAnchor,
  poseAtAnchor,
  handoffRangeForFrame,
  HANDOFF_ISO_POLAR_DEG,
} from '../src/ring2/sector.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const MAIN = srcOf('../src/ring2/main.js');

// The handed gate frame (deep scroll arrival) and the ONE range it owns.
const FRAME = { cx: 49.48127, cy: 40.201262, z: 11.5, bearing: 0, pitch: 45 };
const GATE_RANGE = handoffRangeForFrame(FRAME, { viewportPx: 700 });

// The boot shell is pinned at the home frame; the arrival pin is the SITE.
// callee shapes: handoffRefitDue takes the pin {tx,tz} and the anchor {x,z}.
const HOME = { tx: 10.898, tz: 40.15 };
const HOME_A = { x: 10.898, z: 40.15 };
const SITE = { tx: 49.68, tz: 40.19 };
const SITE_A = { x: 49.68, z: 40.19 };

test('anchor-aware refit: a moved pin rebuilds even at identical rail range', () => {
  const range = GATE_RANGE;
  assert.ok(Number.isFinite(range) && range > 0, 'the gate frame owns a finite range');
  // Boot pin on the home frame, same clamped range as the arrival pin.
  const bootPin = { tx: HOME.tx, tz: HOME.tz, range };
  assert.equal(
    handoffRefitDue(bootPin, SITE_A, range),
    true,
    'arrival pin must be due at identical range — this is the blank-HUD bug',
  );
  // Same anchor + same range = no work (per-frame hold pin stays cheap).
  assert.equal(handoffRefitDue(bootPin, { ...HOME_A }, range), false);
  // Range motion alone still triggers (historic behaviour preserved).
  assert.equal(handoffRefitDue(bootPin, { ...HOME_A }, range + 50), true);
  // No pin yet => build one.
  assert.equal(handoffRefitDue(null, SITE_A, range), true);
  // Non-finite inputs withhold (never guess).
  assert.equal(handoffRefitDue(bootPin, { x: NaN, z: 1 }, range), false);
  assert.equal(handoffRefitDue(bootPin, SITE_A, NaN), false);
});

test('terminal re-derived on the arrival anchor lands on the SITE world, not home', () => {
  const azim = -0.42;
  const homeTerm = terminalPoseForAnchor(HOME.tx, 120, HOME.tz, azim, GATE_RANGE);
  const siteTerm = terminalPoseForAnchor(SITE.tx, 120, SITE.tz, azim, GATE_RANGE);
  assert.ok(homeTerm?.eye && homeTerm?.target, 'home terminal builds');
  assert.ok(siteTerm?.eye && siteTerm?.target, 'site terminal builds');

  // The bug signature: the commit pose must sit INSIDE the site world, i.e.
  // near the arrival target, not near the boot home target.
  const dSite = Math.hypot(
    siteTerm.target.x - SITE.tx,
    siteTerm.target.y - 120,
    siteTerm.target.z - SITE.tz,
  );
  assert.ok(dSite < 1e-9, `terminal target sits on the arrival anchor (got ${dSite})`);
  const dHome = Math.hypot(
    siteTerm.target.x - HOME.tx,
    siteTerm.target.y - 120,
    siteTerm.target.z - HOME.tz,
  );
  assert.ok(dHome > 30, 'terminal target is not the boot home frame');

  // Same iso law as boot: the handed gate range + iso pole, so the push is a
  // pure recentre (zero scale travel) off the arrival ring iso.
  const hand = poseAtAnchor(SITE.tx, 120, SITE.tz, GATE_RANGE, HANDOFF_ISO_POLAR_DEG, azim);
  assert.ok(hand?.eye, 'reference pose builds');
  const dEye = Math.hypot(
    siteTerm.eye.x - hand.eye.x,
    siteTerm.eye.y - hand.eye.y,
    siteTerm.eye.z - hand.eye.z,
  );
  assert.ok(dEye < 1e-6, `terminal eye matches the gate-frame derivation (got ${dEye})`);

  // The commit range IS the hold range: no ground-scale step at the seam.
  const rTerm = Math.hypot(
    siteTerm.eye.x - siteTerm.target.x,
    siteTerm.eye.y - siteTerm.target.y,
    siteTerm.eye.z - siteTerm.target.z,
  );
  assert.ok(Math.abs(rTerm - GATE_RANGE) < 1e-6, `terminal range ${rTerm} === gate range ${GATE_RANGE}`);

  // A terminal without a range is refused (no constant-metre fallback).
  assert.equal(terminalPoseForAnchor(SITE.tx, 120, SITE.tz, azim), null);
  // Non-finite anchor/range withholds — the caller keeps the boot pose instead
  // of committing on a guess.
  assert.equal(terminalPoseForAnchor(NaN, 0, 0, azim, GATE_RANGE), null);
  assert.equal(terminalPoseForAnchor(SITE.tx, 0, SITE.tz, azim, NaN), null);
});

test('refitHandoffRange is anchor-aware and rebuilds the terminal (wiring)', () => {
  assert.match(MAIN, /handoffRefitDue\(handoff\.start, handoff\.anchor, r\)/);
  assert.doesNotMatch(
    MAIN,
    /const old = handoff\.start\?\.range;\s*\n\s*if \(Number\.isFinite\(old\) && Math\.abs\(old - r\) < 1\) return false;/,
    'range-only guard must not come back',
  );
  assert.match(MAIN, /const term = terminalPoseForAnchor\(handoff\.anchor\.x, aty, handoff\.anchor\.z, handoff\.azim, r\)/);
  assert.match(MAIN, /handoff\.to = term/);
});

test('boot terminal comes from the same single derivation (no second law)', () => {
  assert.match(MAIN, /const terminal = terminalPoseForAnchor\(etx, ety, etz, azim, startRange\)/);
  assert.match(MAIN, /eye: terminal\.eye/);
  assert.match(MAIN, /target: terminal\.target/);
  assert.doesNotMatch(MAIN, /eye: isoEye/, 'stale boot-eye reference breaks the tree');
});

test('retarget handler re-pins anchor + azim before the refit runs', () => {
  const idx = MAIN.indexOf('isTwinRetargetMessage(e?.data)');
  assert.ok(idx > 0, 'retarget handler present');
  const body = MAIN.slice(idx, idx + 2600);
  const anchorAt = body.indexOf('handoff.anchor = { x: a.x, z: a.z }');
  const azimAt = body.indexOf('handoff.azim =');
  const refitAt = body.indexOf('refitHandoffRange()');
  assert.ok(anchorAt > 0 && azimAt > 0 && refitAt > 0, 'all three steps present');
  assert.ok(anchorAt < refitAt, 'anchor set before refit');
  assert.ok(azimAt < refitAt, 'azim set before refit');
});
