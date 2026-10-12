// tests/ring2-tiltfade.test.js — b60linefade regression pins.
// Owner verdict on b65vecfade: the floating-lines issue persisted AND the
// twin dissolved at closer/moderate angles, because the 50°-start tilt fade
// hit the ENTIRE emphasis registry (ground/water fills included) instead of
// draped linework. These pins fail on that code and pass on the fix:
// last-resort 60–65 band, EXACT full opacity below 60 at every mix,
// ground+water pitch-invariance at all angles, 65→0 for linework ONLY.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tiltFadeForPitch, TILT_FADE_START_DEG, MAP_MAX_PITCH_DEG } from '../src/ring2/sync.js';
import { emphasisOpacity, tiltFadeApplies, matOpacity } from '../src/ring2/overlays.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('fade band is last-resort: start 60, clamp 65', () => {
  assert.equal(TILT_FADE_START_DEG, 60, 'fade starts at 60deg, not 50');
  assert.equal(MAP_MAX_PITCH_DEG, 65, 'clamp stays 65');
});

test('every registered mat is EXACTLY base below 60deg at mix 0/50/100', () => {
  for (const pitch of [0, 15, 30, 45, 59, 59.9, 60]) {
    assert.equal(tiltFadeForPitch(pitch), 1, `pitch ${pitch} must be exactly 1`);
    for (const t of [0, 0.5, 1]) {
      for (const base of [0.4, 0.55, 0.85, 0.95, 1]) {
        assert.equal(
          emphasisOpacity(base, t, tiltFadeForPitch(pitch)),
          base * t,
          `base ${base} mix ${t} pitch ${pitch}`,
        );
      }
    }
  }
});

test('twin ground + water opacity invariant to pitch at ALL angles', () => {
  for (const kind of ['ground', 'water']) {
    assert.equal(tiltFadeApplies(kind), false, `${kind} must be mix-only`);
    for (const t of [0, 0.5, 1]) {
      for (const pitch of [0, 30, 59, 60, 62.5, 64, 65, 90]) {
        assert.equal(matOpacity(0.55, t, pitch, kind), 0.55 * t, `${kind} t=${t} pitch=${pitch}`);
      }
    }
  }
});

test('tilt 65 -> 0 for linework ONLY; 60 -> full', () => {
  for (const kind of ['contour', 'vector']) {
    assert.equal(tiltFadeApplies(kind), true, `${kind} must ride tilt`);
    assert.equal(matOpacity(0.85, 1, 65, kind), 0, `${kind} gone at clamp`);
    assert.equal(matOpacity(0.85, 1, 60, kind), 0.85, `${kind} full at band start`);
  }
  for (const kind of ['ground', 'water', 'ring', 'label', 'leader', 'schematic', 'marker', 'mask', 'rim', 'other']) {
    assert.equal(tiltFadeApplies(kind), false, `${kind} must be mix-only`);
    assert.equal(matOpacity(0.85, 1, 65, kind), 0.85, `${kind} survives the clamp`);
  }
});

test('mid-ramp is ~0.5 smoothstep; monotonic 60 -> 65', () => {
  const mid = tiltFadeForPitch((TILT_FADE_START_DEG + MAP_MAX_PITCH_DEG) / 2);
  assert.ok(mid > 0.4 && mid < 0.6, `mid-ramp must be ~0.5 smoothstep (got ${mid})`);
  let prev = 1;
  for (let p = 60; p <= 65; p += 0.5) {
    const k = tiltFadeForPitch(p);
    assert.ok(k <= prev + 1e-12, `fade must be monotonic (pitch ${p}: ${k} > ${prev})`);
    prev = k;
  }
  assert.equal(tiltFadeForPitch(90), 0, 'past-clamp stays zero');
});

test('membership audit: water regged mix-only, contours as linework, ground never regged', () => {
  const overlays = srcOf('../src/ring2/overlays.js');
  assert.ok(/WATER_MAX_OPACITY,\s*'water'/.test(overlays), 'water must reg with kind water');
  assert.ok(/'contour'\)\)/.test(overlays), 'contours must reg with kind contour');
  assert.ok(/tiltFadeApplies\('vector'\)/.test(overlays), 'externals must stamp vector');
  assert.ok(!/reg\([^)]*\)\)\)?;?\s*$/.test(overlays.split('\n').filter((l) => l.includes('reg(') && !l.includes('addEmphasisMats') && !l.includes('tiltFadeApplies') && !l.includes('//') && !/reg\(.*'/.test(l)).join('\n')), 'every reg() call must carry an explicit kind');
  const g0 = overlays.indexOf('function buildTwinGround');
  const g1 = overlays.indexOf('function setTakeover');
  const groundBody = overlays.slice(g0, g1);
  assert.ok(g0 > 0 && g1 > g0, 'ground/takeover bodies found');
  assert.ok(!/reg\(/.test(groundBody), 'twin ground must never enter the emphasis registry');
});
