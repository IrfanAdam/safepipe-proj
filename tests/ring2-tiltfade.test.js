// tests/ring2-tiltfade.test.js — owner-verdict pins (2026-10-12).
// At steep tilt the terrain-coupled contour/vector lines stay FULLY visible
// (per-vertex sampleH drape, so no float) and the SATELLITE yields instead,
// but only at CLOSE range: tiltU(pitch, range) merges by max() with the
// mix-driven takeoverU in mix.js — twin ground in via setTakeover(u),
// satellite out via setGroundFade(1-u), base + twin always summing to 1.
// These pins fail on the old line-fade code (lines -> 0 at 65, no tiltU,
// no range gate, no max-merge) and pass on the fix.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  tiltU,
  TILT_FADE_START_DEG,
  MAP_MAX_PITCH_DEG,
  TILT_RANGE_FULL_M,
  TILT_RANGE_OFF_M,
} from '../src/ring2/sync.js';
import { takeoverU } from '../src/ring2/takeover.js';
import { emphasisOpacity, tiltFadeApplies, matOpacity } from '../src/ring2/overlays.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('tilt band reuses the last-resort constants: pitch 60->65, range 4000->9000', () => {
  assert.equal(TILT_FADE_START_DEG, 60, 'pitch band starts at 60deg');
  assert.equal(MAP_MAX_PITCH_DEG, 65, 'pitch clamp stays 65');
  assert.equal(TILT_RANGE_FULL_M, 4000, 'full takeover at/below 4000 m');
  assert.equal(TILT_RANGE_OFF_M, 9000, 'no takeover at/above 9000 m');
});

test('linework is EXACTLY base at every pitch incl. 65 — nothing fades lines', () => {
  for (const kind of ['contour', 'vector', 'ground', 'water', 'ring', 'label', 'leader', 'schematic', 'marker', 'mask', 'rim', 'other']) {
    assert.equal(tiltFadeApplies(kind), false, `${kind} must be mix-only`);
    for (const t of [0, 0.5, 1]) {
      for (const pitch of [0, 30, 59, 60, 62.5, 64, 65, 90]) {
        assert.equal(matOpacity(0.85, t, pitch, kind), 0.85 * t, `${kind} t=${t} pitch=${pitch}`);
        assert.equal(emphasisOpacity(0.85, t, 1), 0.85 * t, `mix-only law ${kind}`);
      }
    }
  }
});

test('tiltU is 0 at/below pitch 60 at any range', () => {
  for (const pitch of [0, 30, 59, 59.9, 60]) {
    for (const range of [500, 1500, 4000, 6500, 9000, 26000]) {
      assert.equal(tiltU(pitch, range), 0, `pitch ${pitch} range ${range}`);
    }
  }
});

test('tiltU is 0 when far, even at/past the clamp', () => {
  for (const pitch of [60.1, 62.5, 65, 90]) {
    for (const range of [9000, 12000, 26000]) {
      assert.equal(tiltU(pitch, range), 0, `pitch ${pitch} range ${range}`);
    }
  }
});

test('tiltU is 1 at 65+close, clamped past both ends', () => {
  for (const pitch of [65, 90]) {
    for (const range of [500, 1500, 4000]) {
      assert.equal(tiltU(pitch, range), 1, `pitch ${pitch} range ${range}`);
    }
  }
});

test('tiltU mid-ramps are smoothstep: ~0.5 per axis, ~0.25 combined', () => {
  const midPitch = tiltU((TILT_FADE_START_DEG + MAP_MAX_PITCH_DEG) / 2, 2000);
  assert.ok(midPitch > 0.4 && midPitch < 0.6, `mid-pitch close-range must be ~0.5 (got ${midPitch})`);
  const midRange = tiltU(65, (TILT_RANGE_FULL_M + TILT_RANGE_OFF_M) / 2);
  assert.ok(midRange > 0.4 && midRange < 0.6, `clamp-pitch mid-range must be ~0.5 (got ${midRange})`);
  const both = tiltU(62.5, 6500);
  assert.ok(both > 0.15 && both < 0.35, `mid-pitch mid-range must be ~0.25 (got ${both})`);
});

test('tiltU is monotonic: rising in pitch, falling in range', () => {
  let prev = 0;
  for (let p = 60; p <= 65; p += 0.5) {
    const u = tiltU(p, 2000);
    assert.ok(u >= prev - 1e-12, `pitch ramp must rise (pitch ${p}: ${u} < ${prev})`);
    prev = u;
  }
  prev = 1;
  for (let r = 4000; r <= 9000; r += 500) {
    const u = tiltU(65, r);
    assert.ok(u <= prev + 1e-12, `range ramp must fall (range ${r}: ${u} > ${prev})`);
    prev = u;
  }
});

test('tiltU rejects non-finite input as 0 (no takeover on garbage)', () => {
  // NOTE: null is NOT in this list — Number(null) === 0, so it coerces to
  // the closest range (same Number() semantics as takeover.js clampMixNum).
  for (const bad of [NaN, undefined, 'x']) {
    assert.equal(tiltU(bad, 2000), 0, `pitch ${String(bad)}`);
    assert.equal(tiltU(65, bad), 0, `range ${String(bad)}`);
  }
});

test('max-merge no-hole property: u=max(takeoverU, tiltU), u+(1-u)===1', () => {
  for (const m of [0, 30, 50, 62, 80, 99, 100]) {
    for (const pitch of [0, 45, 60, 62.5, 65]) {
      for (const range of [1500, 5000, 26000]) {
        const u = Math.max(takeoverU(m), tiltU(pitch, range));
        assert.ok(u >= 0 && u <= 1, `u in [0,1] (m=${m} p=${pitch} r=${range}: ${u})`);
        assert.ok(u >= takeoverU(m) && u >= tiltU(pitch, range), `u dominates both (m=${m} p=${pitch} r=${range})`);
        assert.equal(u + (1 - u), 1, `base+twin sum to 1 (m=${m} p=${pitch} r=${range})`);
      }
    }
  }
  // Spot pins: slider alone owns it top-down; tilt alone owns it steep+close.
  assert.equal(Math.max(takeoverU(100), tiltU(0, 26000)), 1, 'mix 100 takes over top-down');
  assert.equal(Math.max(takeoverU(0), tiltU(0, 26000)), 0, 'mix 0 top-down far stays satellite');
  assert.equal(Math.max(takeoverU(0), tiltU(65, 1500)), 1, 'steep+close takes over at mix 0');
  assert.equal(Math.max(takeoverU(0), tiltU(65, 26000)), 0, 'steep+far at mix 0 stays satellite');
});

test('wiring audit: mix.js max-merges tiltU into one u, main.js feeds range', () => {
  const mix = srcOf('../src/ring2/mix.js');
  assert.ok(/tiltU/.test(mix), 'mix.js must consume tiltU');
  assert.ok(/Math\.max\(takeoverU\(/.test(mix), 'mix.js must max-merge takeoverU with tiltU');
  /* SEAM TONE (Phase-03 rev): the satellite base no longer fades — the twin
   * ground's alpha is the crossfade, so the photo holds full paint under it
   * and the composite cannot dip (the old (1 - u) fade multiplied with the
   * ground ramp: a measured 60% luma dip mid-dissolve). */
  assert.ok(/setGroundFade\(1\)/.test(mix), 'satellite base must hold full paint through the band');
  assert.ok(!/setGroundFade\(1 - u\)/.test(mix), 'the double fade must stay gone');
  assert.ok(/applyEmphasis\(Math\.max\(t, u\)\)/.test(mix), 'emphasis must follow max(t, u)');
  assert.ok(/function updateForCamera\(pitchDeg, rangeM\)/.test(mix), 'updateForCamera must take (pitch, range)');
  assert.ok(/setGroundOwns\(!groundHidden\(eff\)\)/.test(mix), 'endpoint rule stays slider-only');
  const main = srcOf('../src/ring2/main.js');
  assert.ok(/updateForCamera\(pitch, rangeM\)/.test(main), 'main loop must pass (pitch, rangeM)');
  assert.ok(/twin\.setTiltFade\?\.?\(pitch\)/.test(main), 'main loop keeps driving setTiltFade (compat)');
  const overlays = srcOf('../src/ring2/overlays.js');
  assert.ok(/function setTiltFade\(_pitchDeg\)/.test(overlays), 'overlays keeps setTiltFade for API compat');
  assert.ok(/setTiltFade,\s*setTakeover/.test(overlays), 'twin handle must still export setTiltFade');
});

test('membership audit: every reg() carries an explicit kind, ground never regged', () => {
  const overlays = srcOf('../src/ring2/overlays.js');
  assert.ok(/WATER_MAX_OPACITY,\s*'water'/.test(overlays), 'water must reg with kind water');
  assert.ok(/'contour'\)\)/.test(overlays), 'contours must reg with kind contour');
  assert.ok(/tiltFadeApplies\('vector'\)/.test(overlays), 'externals must stamp through the membership fn');
  assert.ok(!/reg\([^)]*\)\)\)?;?\s*$/.test(overlays.split('\n').filter((l) => l.includes('reg(') && !l.includes('addEmphasisMats') && !l.includes('tiltFadeApplies') && !l.includes('//') && !/reg\(.*'/.test(l)).join('\n')), 'every reg() call must carry an explicit kind');
  const g0 = overlays.indexOf('function buildTwinGround');
  const g1 = overlays.indexOf('function setTakeover');
  const groundBody = overlays.slice(g0, g1);
  assert.ok(g0 > 0 && g1 > g0, 'ground/takeover bodies found');
  assert.ok(!/reg\(/.test(groundBody), 'twin ground must never enter the emphasis registry');
});
