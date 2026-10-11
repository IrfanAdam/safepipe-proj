// tests/ring2-shore.test.js — Phase 1 P0 shoreline fix.
// The Caspian surface sits at -28 m but Terrarium clamps near-shore water
// at ~-27, so the RENDER key is CASPIAN_SHORE_H (-24 m): a 0 m key floods
// the coastal plain (-10 m reads wet) while a -28 m key erases the sea
// (-27 m reads dry). field.js proceduralH keeps its own -28 anchor (datum,
// not render key).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CASPIAN_SHORE_H, WATER_COL } from '../src/ring2/overlays.js';
import { proceduralH } from '../src/ring2/field.js';

/* Render-side classifier, mirroring alphaAt/colAt in overlays.js. */
const isWater = (h) => h < CASPIAN_SHORE_H;

test('shoreline datum exported at -24 m', () => {
  assert.equal(CASPIAN_SHORE_H, -24);
  const [r, g, b] = [(WATER_COL >> 16) & 255, (WATER_COL >> 8) & 255, WATER_COL & 255];
  assert.ok(b > r + 20, 'WATER_COL still reads blue (import surface intact)');
});

test('near-shore -10 m reads dry, clamped sea -27 m reads wet', () => {
  assert.equal(isWater(-10), false, '-10 m shore flat must be DRY (0 m key flooded it)');
  assert.equal(isWater(-27), true, '-27 m Terrarium-clamped sea must be WATER (-28 m key erased it)');
  assert.equal(isWater(-28), true, 'open Caspian -28 m must be WATER');
  assert.equal(isWater(0), false, '0 m must stay DRY (no flooded plain)');
  assert.equal(isWater(-24), false, 'datum boundary itself reads dry (depth 0 -> alpha 0)');
});

test('overlays.js keys water on CASPIAN_SHORE_H at every lane', () => {
  const src = readFileSync(new URL('../src/ring2/overlays.js', import.meta.url), 'utf8');
  assert.ok(
    src.includes('CASPIAN_SHORE_H - sampleH(x, z)'),
    'alphaAt depth keys off the datum',
  );
  assert.ok(
    src.includes('h >= CASPIAN_SHORE_H'),
    'takeover colAt keys off the datum',
  );
  assert.ok(!src.includes('depth = -sampleH'), 'stale 0 m alphaAt key is gone');
  assert.ok(!src.includes('if (!(h >= 0))'), 'stale 0 m takeover key is gone');
  assert.ok(!/sampleH\(x, z\)\s*<\s*0/.test(src), 'no stale sampleH<0 water key remains');
});

test('field.js proceduralH keeps the -28 m sea anchor (datum untouched)', () => {
  const src = readFileSync(new URL('../src/ring2/field.js', import.meta.url), 'utf8');
  assert.ok(src.includes('-28 * sea'), 'procedural sea anchor still -28');
  assert.equal(proceduralH(20000, 0), -28, 'far-east procedural surface is exactly -28 m');
  assert.ok(proceduralH(0, 0) > CASPIAN_SHORE_H, 'pin high ground stays dry under the new key');
});
