// tests/ring2-vectors-new-layers.test.js — Phase 02 Task 12 gate.
// The 7 context layers (arterials/streets/landuse/water/power/barriers/
// buildings) ride in the boot asset unmounted; the mount lane wires them.
// Pins: per-layer clipped feature counts, source (pre-clip) counts, totals,
// disc containment, and the unique-assignment accounting ledger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DISC_R, DISC_TOL } from '../scripts/data-pipe/clip.mjs';

const asset = JSON.parse(readFileSync('public/data/sangachal-vectors.json', 'utf8'));
const NEW_LAYERS = ['arterials', 'streets', 'landuse', 'water', 'power', 'barriers', 'buildings'];

test('context layers match the disc-clipped build (1861 features)', () => {
  assert.deepEqual(
    Object.fromEntries(NEW_LAYERS.map((k) => [k, asset.layers[k].length])),
    {
      arterials: 97, streets: 476, landuse: 167, water: 23,
      power: 4, barriers: 12, buildings: 1082,
    },
  );
  const feats = NEW_LAYERS.reduce((n, k) => n + asset.layers[k].length, 0);
  assert.equal(feats, 1861);
  assert.equal(asset.meta.elements, 883 + 1861);
});

test('context layer sources match the board sweep (pre-clip inputs)', () => {
  assert.deepEqual(
    Object.fromEntries(NEW_LAYERS.map((k) => [k, asset.meta.layer_src[k]])),
    {
      arterials: 109, streets: 501, landuse: 182, water: 26,
      power: 4, barriers: 12, buildings: 1123,
    },
  );
});

test('no context-layer vertex lies past the twin disc', () => {
  let max = 0;
  for (const id of NEW_LAYERS) {
    for (const f of asset.layers[id]) {
      assert.ok(typeof f.id === 'number' && Array.isArray(f.pts) && f.pts.length >= 2, `${id} well-formed`);
      for (const [x, z] of f.pts) {
        assert.ok(Number.isFinite(x) && Number.isFinite(z), `${id} id=${f.id} finite`);
        const rr = Math.hypot(x, z);
        if (rr > max) max = rr;
      }
    }
  }
  assert.ok(max <= DISC_R + DISC_TOL, `max rr ${max.toFixed(2)} m within disc`);
});

test('unique-assignment accounting sums back to the merged input', () => {
  const a = asset.meta.accounting;
  assert.equal(a.assigned_unique + a.filtered_only + a.oos_only + a.skipped_ways, a.input_ways);
  assert.equal(a.input_ways, 2774); // 2773 board-sweep ways + 1 coastline supplement
  assert.equal(a.assigned_unique, asset.meta.src_elements);
  assert.equal(a.skipped_non_way, asset.meta.skipped_non_way);
});

test('spot checks: arterial motorway + town street + terminal fence + substation', () => {
  assert.ok(asset.layers.arterials.some((f) => f.pts.length > 2), 'arterial polyline present');
  assert.ok(asset.layers.streets.length > asset.layers.arterials.length, 'streets outnumber arterials');
  // All 12 terminal fences double-enter barriers (shared refs, not copies).
  const fenceInTerminal = asset.layers.terminal.filter((f) =>
    asset.layers.barriers.some((b) => b.id === f.id));
  assert.equal(fenceInTerminal.length, 12);
  assert.equal(asset.layers.power.length, 4); // 1 plant + 3 substations, 0 power=line in sweep
});
