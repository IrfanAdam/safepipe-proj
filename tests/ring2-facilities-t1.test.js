// tests/ring2-facilities-t1.test.js — Phase 02 T1 structures gate.
// Geometry math ONLY (dims.js, no WebGL/three import): T1 seeds, flare
// height, hall/stack counts, clearance spacing, and tier stamps pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER,
  HALLS, TURBINE_STACK, turbineStacksPerHall,
  FLARE, flareClearanceHa,
  ADMIN_BLOCK, CAMP, campUnitCount,
  PERIMETER, dykeAreaHa,
  CONDENSATE_TANK, OFFSPEC_TANK,
} from '../src/ring2/facilities/dims.js';

const withinPct = (got, want, pct, label) => {
  const err = Math.abs(got - want) / want;
  assert.ok(err <= pct, `${label}: got ${got}, want ${want} ±${pct * 100}% (err ${(err * 100).toFixed(2)}%)`);
};

test('halls: 5 F1 candidate footprints, derived shells, approx functions', () => {
  assert.equal(HALLS.items.length, 5);
  assert.equal(HALLS.tierFootprint, TIER.DERIVED);
  assert.equal(HALLS.tierFunction, TIER.APPROXIMATED);
  const want = [
    [101.7, 74.3], [81.7, 65.2], [77.1, 62.1], [70.2, 56], [68.9, 54],
  ];
  HALLS.items.forEach((h, i) => {
    withinPct(h.w, want[i][0], 0.001, `${h.name} width`);
    withinPct(h.d, want[i][1], 0.001, `${h.name} depth`);
    assert.ok(h.lat > 40.19 && h.lat < 40.21 && h.lon > 49.47 && h.lon < 49.5, `${h.name} seed in terminal bbox`);
  });
  assert.equal(HALLS.wallH, 12);
});

test('turbine stacks: 7 total, per-hall split sums to 7', () => {
  assert.equal(TURBINE_STACK.count, 7);
  assert.equal(TURBINE_STACK.tier, TIER.APPROXIMATED);
  const per = turbineStacksPerHall();
  assert.equal(per.length, HALLS.items.length);
  assert.equal(per.reduce((a, b) => a + b, 0), TURBINE_STACK.count);
  assert.ok(TURBINE_STACK.h > HALLS.wallH, 'stacks clear hall roofs');
});

test('flare: 107 m derived stack, KO ≤100 m, clearance ≥ stack height', () => {
  assert.equal(FLARE.stackH, 107); // SD2 ESIA [board:F5]
  assert.equal(FLARE.tierHeight, TIER.DERIVED);
  assert.ok(FLARE.koDist <= 100, `KO drum within 100 m (got ${FLARE.koDist})`);
  assert.ok(FLARE.clearanceR >= FLARE.stackH, 'sterile ring ≥ stack height');
  withinPct(flareClearanceHa(), (Math.PI * 175 ** 2) / 1e4, 0.001, 'clearance area');
  // Flare anchor stands off the SD tank anchors (safety spacing).
  for (const t of [CONDENSATE_TANK, OFFSPEC_TANK]) {
    const d = Math.hypot(FLARE.anchor.x - t.anchor.x, FLARE.anchor.z - t.anchor.z);
    assert.ok(d >= FLARE.clearanceR, `flare clears tank anchor (got ${d.toFixed(0)} m)`);
  }
});

test('admin/camp: generic massing, all indicative (approximated)', () => {
  assert.equal(ADMIN_BLOCK.tier, TIER.APPROXIMATED);
  assert.equal(CAMP.tier, TIER.APPROXIMATED);
  assert.equal(campUnitCount(), 10);
  assert.ok(CAMP.anchor.x >= 2000 && CAMP.anchor.x <= 2400, 'camp on east row (lon 49.505–49.509)');
});

test('perimeter: dyke ring area ≈688 ha ±5%, ditch outside berm', () => {
  withinPct(dykeAreaHa(), 688, 0.05, 'dyke area vs bp F2 688 ha');
  assert.ok(PERIMETER.ditchR > PERIMETER.dykeR + PERIMETER.dykeW, 'ditch outside berm');
  assert.equal(PERIMETER.tier, TIER.APPROXIMATED);
});
