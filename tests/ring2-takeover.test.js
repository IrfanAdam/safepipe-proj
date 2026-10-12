// tests/ring2-takeover.test.js — smooth base crossfade band.
// The base swap (satellite photo <-> twin ground) dissolves across mix
// 40->100 on BOTH sides via one smoothstep: twin ground ramps 0->1
// (takeoverU) while the satellite base fades 1->0 (satBaseV) as paint
// opacity. Only the visibility endpoint stays binary (hidden at exactly
// 100, where the twin ground is opaque — never a black hole).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TAKEOVER_START,
  TAKEOVER_FULL,
  takeoverU,
  satBaseV,
  groundHidden,
} from '../src/ring2/takeover.js';

test('thresholds: smooth band 40->100, full at 100', () => {
  assert.equal(TAKEOVER_START, 40);
  assert.equal(TAKEOVER_FULL, 100);
});

test('takeoverU: zero below the band (overlay composite untouched)', () => {
  for (const m of [0, 25, 39, 40]) {
    assert.equal(takeoverU(m), 0, `mix ${m}`);
  }
});

test('takeoverU: smoothstep endpoints exact, midpoint halves', () => {
  assert.equal(takeoverU(100), 1);
  assert.equal(takeoverU(250), 1);
  // Band midpoint (40+100)/2 = 70: smoothstep(0.5) = 0.5 exactly.
  assert.equal(takeoverU(70), 0.5);
});

test('takeoverU: smoothstep values across the band', () => {
  const sstep = (t) => t * t * (3 - 2 * t);
  for (const m of [41, 50, 60, 80, 90, 95, 99]) {
    const t = (m - 40) / (100 - 40);
    assert.ok(
      Math.abs(takeoverU(m) - sstep(t)) < 1e-12,
      `mix ${m}: got ${takeoverU(m)}, want smoothstep(${t})`,
    );
  }
});

test('takeoverU: per-step delta bounded (no jump anywhere)', () => {
  let worst = 0;
  for (let m = 0; m < 100; m++) {
    worst = Math.max(worst, Math.abs(takeoverU(m + 1) - takeoverU(m)));
  }
  // Smoothstep peak slope is 1.5/60 = 0.025/step; linear would allow
  // 1/60 ≈ 0.0167. Anything near 0.5/step would be the old 2-step jump.
  assert.ok(worst < 0.035, `max per-step delta ${worst} must stay < 0.035`);
  assert.ok(worst > 0.015, `band must actually move (worst ${worst})`);
});

test('takeoverU: monotone non-decreasing over the whole slider', () => {
  for (let m = 0; m < 100; m++) {
    assert.ok(takeoverU(m + 1) >= takeoverU(m), `mix ${m}->${m + 1} must not step back`);
  }
});

test('satBaseV: mirror of the ramp across the same band', () => {
  assert.equal(satBaseV(0), 1);
  assert.equal(satBaseV(40), 1);
  assert.equal(satBaseV(70), 0.5);
  assert.equal(satBaseV(100), 0);
  for (let m = 0; m <= 100; m++) {
    assert.ok(Math.abs(satBaseV(m) - (1 - takeoverU(m))) < 1e-12, `mix ${m}: base+twin must sum to 1`);
  }
  let worst = 0;
  for (let m = 0; m < 100; m++) {
    worst = Math.max(worst, Math.abs(satBaseV(m + 1) - satBaseV(m)));
  }
  assert.ok(worst < 0.035, `satellite per-step delta ${worst} must stay < 0.035`);
});

test('groundHidden: only at full takeover (never a black hole)', () => {
  for (const m of [0, 39, 40, 50, 70, 99]) {
    assert.equal(groundHidden(m), false, `mix ${m}`);
  }
  assert.equal(groundHidden(100), true);
});

test('takeover pair: satellite hides exactly where twin ground is opaque', () => {
  for (let m = 0; m <= 100; m++) {
    if (groundHidden(m)) assert.equal(takeoverU(m), 1, `mix ${m}: hidden ground needs opaque twin`);
  }
});

test('clamping: garbage in, bounded out', () => {
  assert.equal(takeoverU(-5), 0);
  assert.equal(takeoverU(250), 1);
  assert.equal(satBaseV(-5), 1);
  assert.equal(satBaseV(250), 0);
  assert.equal(groundHidden(250), true);
  assert.equal(takeoverU('nope'), takeoverU(50)); // garbage defaults to mid-slider 50, now in-band
  assert.equal(satBaseV('nope'), satBaseV(50));
  assert.ok(takeoverU('nope') > 0 && takeoverU('nope') < 1, 'garbage must land bounded in-band');
});

test('wiring: mix.js drives BOTH sides of the dissolve from one merged law', () => {
  const mix = readFileSync(new URL('../src/ring2/mix.js', import.meta.url), 'utf8');
  assert.ok(
    /Math\.max\(takeoverU\(effMixNow\(\)\), tiltU\(lastPitch, lastRange\)\)/.test(mix),
    'mix.js must merge slider ramp + tilt takeover via effUNow (max, single source of truth)',
  );
  assert.ok(/setTakeover\(u\)/.test(mix), 'mix.js must ramp the twin ground from the merged u');
  assert.ok(/setGroundFade\(1 - u\)/.test(mix), 'mix.js must fade the satellite base to (1 - u) so base+twin sum to 1');
  assert.ok(
    /setGroundOwns\(!groundHidden\(/.test(mix),
    'mix.js must keep the visibility endpoint on groundHidden',
  );
  assert.ok(!/forceGroundLayers/.test(mix), 'binary visibility pusher must be gone');
});

test('wiring: mapbase exposes the fade + keeps the endpoint API', () => {
  const mb = readFileSync(new URL('../src/ring2/mapbase.js', import.meta.url), 'utf8');
  assert.ok(/export function setGroundFade/.test(mb), 'mapbase must export setGroundFade');
  assert.ok(/export function setGroundOwns/.test(mb), 'mapbase must keep the setGroundOwns endpoint API');
  assert.ok(/export function getGroundFade/.test(mb), 'mapbase must export getGroundFade');
  assert.ok(/raster-opacity/.test(mb), 'fade must ride on raster-opacity paint');
  assert.ok(/hillshade-exaggeration/.test(mb), 'hillshade must fade via exaggeration (it has no opacity paint)');
});
