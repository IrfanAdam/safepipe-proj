// tests/ring2-facilities-backdrops.test.js — Phase 02 Task 12 backdrops gate.
// Geometry math ONLY: shore bay curve, offsite distances, hillock spots,
// and tier stamps pinned. No rendering; three.js builders stay unexercised.
// [board:§Gaps-6 (naval ~10.4 km S, quarries 9–12 km, M2 east, coast)]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIER } from '../src/ring2/facilities/dims.js';
import {
  SHORE, shoreXAt, shoreSlopeAt, coastSegFrame, REAL_COAST,
} from '../src/ring2/facilities/coast.js';
import {
  NAVAL, navalDistKm, QUARRIES, quarryDistKm, M2, m2LengthM,
} from '../src/ring2/facilities/offsite.js';
import {
  HILL_N, HILL_SW, HILLOCK, hillockSpots, RING_M,
} from '../src/ring2/facilities/landform.js';

const withinPct = (got, want, pct, label) => {
  const err = Math.abs(got - want) / want;
  assert.ok(err <= pct, `${label}: got ${got}, want ${want} ±${pct * 100}% (err ${(err * 100).toFixed(2)}%)`);
};

test('shore: bay curve meets audited -24 crossing far-field, OSM wiggle at pin lat', () => {
  // Far from the bay (|z| >> sigma) the curve relaxes to the audited datum ≈3276.
  withinPct(shoreXAt(9000), SHORE.baseX, 0.02, 'far-field shore ≈ baseX');
  withinPct(SHORE.baseX, 3276, 0.01, 'baseX vs audited -24 crossing');
  // At the pin parallel the bay peaks ≈3850 vs OSM far hit ≈3871 (within 1%).
  withinPct(shoreXAt(0), 3850, 0.001, 'bay peak');
  withinPct(shoreXAt(0), 3871, 0.01, 'bay peak vs OSM wiggle');
  // Symmetric falloff, zero slope at the bay apex.
  assert.ok(Math.abs(shoreSlopeAt(0)) < 1e-12, 'apex slope is zero');
  assert.ok(Math.abs(shoreXAt(2600) - shoreXAt(-2600)) < 1e-9, 'bay symmetric about bayZ');
});

test('shore: sand drape follows the real waterline S→N, straddles it, derived', () => {
  const pts = REAL_COAST.pts;
  assert.ok(pts.length >= 25, 'real-coast waypoint count');
  assert.ok(pts[0][1] > 9000 && pts[pts.length - 1][1] < -2800, 'trace spans S→N');
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const leg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    assert.ok(leg > 1 && leg < 2500, `leg ${i} sane (${Math.round(leg)} m)`);
    assert.ok(Math.hypot(pts[i][0], pts[i][1]) < 10000, `pt ${i} in-ring`);
    L += leg;
  }
  withinPct(L, 18134, 0.01, 'real-coast drape length');
  assert.equal(REAL_COAST.sandW, 80);
  assert.equal(REAL_COAST.tier, TIER.DERIVED);
});

test('offsite: naval massing ~10.4 km S, quarries 9–12 km, M2 ribbon east', () => {
  withinPct(navalDistKm(), 10.4, 0.05, 'naval distance vs board ~10.4 km S');
  assert.ok(NAVAL.z > 9000, 'naval sits at the ring edge, south');
  assert.equal(NAVAL.tier, TIER.APPROXIMATED);
  assert.equal(QUARRIES.items.length, 2);
  for (const q of QUARRIES.items) {
    const d = quarryDistKm(q);
    assert.ok(d >= 9 && d <= 12, `quarry at ${d.toFixed(1)} km inside 9–12 km band`);
  }
  assert.equal(QUARRIES.tier, TIER.APPROXIMATED);
  assert.ok(M2.trace.length >= 20, 'M2 trace follows real waypoints');
  assert.ok(M2.trace[0][1] > 8000 && M2.trace[M2.trace.length - 1][1] < -3000, 'M2 trace spans SW→NE');
  withinPct(m2LengthM(), 18022, 0.01, 'M2 trace length');
  assert.equal(M2.tier, TIER.DERIVED);
  // Never focus-pullers: naval sheds well below the 107 m flare.
  assert.ok(NAVAL.shedH <= 12, 'naval sheds stay low');
});

test('landform: 14 hillocks on DEM highs, inside ring, capped at 25 m', () => {
  const spots = hillockSpots();
  assert.equal(spots.length, HILL_N.count + HILL_SW.count);
  assert.equal(spots.length, 14);
  for (const s of spots) {
    assert.ok(Math.hypot(s.x, s.z) <= RING_M, `spot (${s.x.toFixed(0)},${s.z.toFixed(0)}) inside ring`);
    assert.ok(s.r >= HILLOCK.rMin && s.r <= HILLOCK.rMax, 'hillock radius in band');
    assert.ok(s.h >= HILLOCK.hMin && s.h <= HILLOCK.hMax, 'hillock height in band');
    assert.ok(s.h <= 25, 'furniture cap: never competes with the flare');
  }
  // Deterministic: same spots every load.
  const again = hillockSpots();
  assert.deepEqual(spots, again);
  assert.equal(HILLOCK.tier, TIER.APPROXIMATED);
  assert.ok(HILLOCK.outcrops < spots.length, 'outcrops index into spots safely');
});
