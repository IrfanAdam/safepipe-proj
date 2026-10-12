// tests/ring2-facilities-t0.test.js — Phase 02 T0 structures gate.
// Geometry math ONLY (dims.js, no WebGL/three import): built dimensions
// match board seeds within 5%; counts, ranges, and tier stamps pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER,
  BBL_TO_M3,
  CRUDE_TANK, crudeTankVolumeBbl,
  EOP_TANK, eopTankVolumeBbl,
  CONDENSATE_TANK, OFFSPEC_TANK, condensateVolumeBbl,
  GAS_SPHERES,
  OIL_TRAIN, GAS_TRAIN,
  RACK, rackPipeDiaM, rackLengthM,
} from '../src/ring2/facilities/dims.js';

const withinPct = (got, want, pct, label) => {
  const err = Math.abs(got - want) / want;
  assert.ok(err <= pct, `${label}: got ${got}, want ${want} ±${pct * 100}% (err ${(err * 100).toFixed(2)}%)`);
};

test('crude tanks: 3× ~96.5 m dia seeds, volume ≈880k bbl ±5%', () => {
  assert.equal(CRUDE_TANK.count, 3);
  assert.equal(CRUDE_TANK.seeds.length, 3);
  withinPct(CRUDE_TANK.dia, 96.5, 0.05, 'crude dia vs F1 seed');
  assert.equal(CRUDE_TANK.shellH, 20); // Ceyhan anchor [board:S1]
  withinPct(crudeTankVolumeBbl(), 880000, 0.05, 'crude volume vs 880k bbl');
  assert.equal(CRUDE_TANK.tier, TIER.DERIVED);
});

test('EOP tanks: 4× ≈1/3 scale, volume ≈25.5k bbl ±5%', () => {
  assert.equal(EOP_TANK.count, 4);
  withinPct(EOP_TANK.dia / CRUDE_TANK.dia, 1 / 3, 0.15, 'EOP linear scale ≈1/3');
  withinPct(eopTankVolumeBbl(), 25500, 0.05, 'EOP volume vs 25.5k bbl');
});

test('condensate: 165k bbl ±5%; off-spec ≈1/4 volume', () => {
  withinPct(condensateVolumeBbl(), 165000, 0.05, 'condensate vs 165k bbl');
  withinPct(CONDENSATE_TANK.dia, 42, 0.1, 'condensate dia 40–45 m band');
  const off = (Math.PI * (OFFSPEC_TANK.dia / 2) ** 2 * OFFSPEC_TANK.shellH) / BBL_TO_M3;
  withinPct(off, condensateVolumeBbl() / 4, 0.15, 'off-spec ≈1/4 condensate');
});

test('gas spheres: 4× 50 m row + 60 m, F1 seeds', () => {
  assert.equal(GAS_SPHERES.items.length, 5);
  const dias = GAS_SPHERES.items.map((s) => s.dia);
  assert.deepEqual(dias, [50, 50, 50, 50, 60]);
  for (const s of GAS_SPHERES.items) {
    assert.ok(s.lat > 40.19 && s.lat < 40.21 && s.lon > 49.45 && s.lon < 49.49, 'sphere seed in terminal bbox');
  }
});

test('trains: 6 oil + 2 gas, dims inside S3 bands', () => {
  assert.equal(OIL_TRAIN.count, 6);
  assert.equal(GAS_TRAIN.count, 2);
  for (const t of [OIL_TRAIN, GAS_TRAIN]) {
    assert.ok(t.vesselDia >= 2 && t.vesselDia <= 4, 'vessel dia 2–4 m');
    assert.ok(t.vesselLen >= 10 && t.vesselLen <= 20, 'vessel len 10–20 m');
    assert.ok(t.columnDia >= 3 && t.columnDia <= 5, 'column dia 3–5 m');
    assert.ok(t.columnH >= 15 && t.columnH <= 30, 'column h 15–30 m');
    assert.equal(t.tier, TIER.APPROXIMATED);
  }
});

test('racks: spacing 8–12 m, beam 5–6.5 m, 3–6 pipes, 28–42 in mains', () => {
  assert.ok(RACK.frameSpacing >= 8 && RACK.frameSpacing <= 12, 'frame spacing');
  assert.ok(RACK.beamH >= 5 && RACK.beamH <= 6.5, 'beam height');
  assert.ok(RACK.pipeCount >= 3 && RACK.pipeCount <= 6, 'pipe count');
  withinPct(rackPipeDiaM(), 36 * 0.0254, 0.001, 'main dia 36 in');
  assert.ok(RACK.mains.length >= 2, 'spine corridors');
  for (const m of RACK.mains) {
    assert.ok(rackLengthM(m) >= 200, `corridor site-scale (got ${rackLengthM(m).toFixed(0)} m)`);
    assert.equal(m.tier, TIER.DERIVED);
  }
});
