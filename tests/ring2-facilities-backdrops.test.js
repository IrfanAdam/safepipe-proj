// tests/ring2-facilities-backdrops.test.js — Phase 02 Task 12 backdrops gate.
// Geometry math ONLY: shore bay curve, offsite distances, hillock spots,
// and tier stamps pinned. No rendering; three.js builders stay unexercised.
// [board:§Gaps-6 (naval ~10.4 km S, quarries 9–12 km, M2 east, coast)]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIER } from '../src/ring2/facilities/dims.js';
import {
  SHORE, shoreXAt, shoreSlopeAt, coastSegFrame,
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

test('shore: 14 segments tile z -3000..9700 with water+sand frames', () => {
  assert.equal(SHORE.segs, 14);
  const segLen = (SHORE.zTo - SHORE.zFrom) / SHORE.segs;
  for (let i = 0; i < SHORE.segs; i++) {
    const f = coastSegFrame(i);
    withinPct(f.zmid, SHORE.zFrom + i * segLen + segLen / 2, 1e-9, `seg ${i} zmid`);
    withinPct(f.waterW, SHORE.waterReach, 1e-9, `seg ${i} water width`);
    withinPct(f.sandW, SHORE.sandW, 1e-9, `seg ${i} sand width`);
    assert.ok(f.waterX > f.sandX, `seg ${i} water east of sand`);
    assert.ok(Number.isFinite(f.rotY) && Math.abs(f.rotY) < 0.3, `seg ${i} yaw small`);
  }
  assert.equal(SHORE.tierShape, TIER.APPROXIMATED);
  assert.equal(SHORE.tierDatum, TIER.DERIVED);
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
  assert.ok(M2.x > 4000, 'M2 corridor east of site');
  withinPct(m2LengthM(), 16000, 0.001, 'M2 ribbon length');
  assert.equal(M2.tier, TIER.APPROXIMATED);
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
