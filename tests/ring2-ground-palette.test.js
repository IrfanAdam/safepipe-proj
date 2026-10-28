// tests/ring2-ground-palette.test.js — the derived palette is APPLIED.
// The solve (tone.js deriveGroundPalette) is only a prediction until the
// ground mesh renders it: appliedGroundPalette() selects derived-when-solved
// (applied:true) and keeps the authored shape only with no sample yet
// (applied:false — never a guessed dark). The probe surfaces `applied` so
// verification reads the rendered truth. A source pin keeps the HOLD from
// recurring: no constant may gate the selection ever again.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  srgb255ToLinear, meanIrradiance, deriveGroundPalette, appliedGroundPalette,
} from '../src/ring2/tone.js';

const here = dirname(fileURLToPath(import.meta.url));
const overlaysSrc = readFileSync(join(here, '..', 'src', 'ring2', 'overlays.js'), 'utf8');

const AUTHORED = {
  sea: srgb255ToLinear([0x23, 0x2f, 0x38]),
  low: srgb255ToLinear([0x2a, 0x30, 0x36]),
  high: srgb255ToLinear([0x6f, 0x70, 0x69]),
};
const IRR = meanIrradiance({ normals: [0, 1, 0], sunDir: [-35000, 52000, 22000] });
const PHOTO = { meanLuma: 120.9, meanColor: [116.4, 123.8, 105.4], p10: 33, p50: 141, p90: 176 };

test('appliedGroundPalette renders the solved derivation when one exists', () => {
  const derived = deriveGroundPalette({ base: AUTHORED, weights: { sea: 0.35, low: 0.5, high: 0.15 }, irr: IRR, photo: PHOTO });
  assert.ok(derived?.palette, 'fixture solves');
  const pick = appliedGroundPalette(AUTHORED, derived);
  assert.equal(pick.applied, true);
  assert.equal(pick.palette, derived.palette, 'renders the solved palette, not the authored shape');
});

test('appliedGroundPalette keeps the authored shape only with no solve', () => {
  for (const bad of [null, undefined, {}, { palette: null }, { palette: { sea: [1, 1, 1] } }]) {
    const pick = appliedGroundPalette(AUTHORED, bad);
    assert.equal(pick.applied, false, `withholds on ${JSON.stringify(bad)?.slice(0, 40)}`);
    assert.equal(pick.palette, AUTHORED, 'falls back to the authored shape object');
  }
});

test('no HOLD constant gates the ground derivation anymore', () => {
  assert.ok(!/APPLY_DERIVED_GROUND/.test(overlaysSrc), 'the derivation hold must stay gone — the solve is the render');
  assert.ok(/appliedGroundPalette\(palette, derived\)/.test(overlaysSrc), 'buildTwinGround selects through the pure helper');
  assert.ok(/getTone[\s\S]{0,400}applied/.test(overlaysSrc), 'the tone probe reports the applied flag');
});
