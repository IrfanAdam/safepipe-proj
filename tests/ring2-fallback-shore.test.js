// tests/ring2-fallback-shore.test.js — fallback shoreline calibration pin.
//
// Accuracy audit 2026-10-11 (site-parallel transect 40.201262N, Open-Meteo
// elevation + Terrarium z12 tiles, see /tmp/ring2-accuracy-audit.md):
//   real  0 m contour: lon 49.44377E -> x ≈ -3185 m
//   real -24 m contour (render datum): lerp between -21 (49.51127E) and
//     -28 (49.53127E) -> lon ≈ 49.51984E -> x ≈ +3276 m
//   real -28 m contour: lon 49.53127E -> x ≈ +4246 m
// The old fallback (base 30-0.006x, circular N-hill, ramp [4000,9000])
// crossed 0 at x≈+4687 (+7.9 km east error) and -24 at x≈+7295 (+4.0 km).
//
// Gates below pin the retuned fallback (base -16-0.0035x, elliptical
// N-hill σz 1600, ramp [2800,4200]) to ±500 m of the audited positions.
// FALLBACK-ONLY: the live Terrarium/SRTM ladder is asserted untouched.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { METERS_PER_DEG_LON } from '../src/ring2/site.js';
import { CASPIAN_SHORE_H } from '../src/ring2/overlays.js';
import {
  proceduralH,
  sampleH,
  sampleSource,
  resetField,
} from '../src/ring2/field.js';

/* Audited real contour positions (world x, metres east of pin). */
const X0_REAL = (49.44377 - 49.48127) * METERS_PER_DEG_LON; // ≈ -3185
const X24_REAL = (49.51984 - 49.48127) * METERS_PER_DEG_LON; // ≈ +3276
const X28_REAL = (49.53127 - 49.48127) * METERS_PER_DEG_LON; // ≈ +4246
const TOL_M = 500;

/* Bisection crossing of proceduralH(x, 0) with `level`, x in [-10k, +20k]. */
function crossing(level) {
  const f = (x) => proceduralH(x, 0) - level;
  let lo = -10000;
  let hi = 20000;
  const flo = f(lo);
  assert.ok(
    (flo < 0) !== (f(hi) < 0),
    `no ${level} m crossing brackets on the site parallel`,
  );
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if ((flo < 0) === (f(m) < 0)) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

test('fallback 0-contour lands within 500 m of the audited x≈-3185', () => {
  assert.ok(Math.abs(X0_REAL + 3185) < 5, `audit anchor drift: ${X0_REAL}`);
  const x0 = crossing(0);
  console.log(`  fallback 0-contour x=${x0.toFixed(0)} m vs real ${X0_REAL.toFixed(0)} m`);
  assert.ok(
    Math.abs(x0 - X0_REAL) <= TOL_M,
    `0-contour error ${Math.abs(x0 - X0_REAL).toFixed(0)} m exceeds ${TOL_M} m`,
  );
});

test('fallback -24-contour lands within 500 m of the audited x≈+3276', () => {
  assert.ok(Math.abs(X24_REAL - 3276) < 5, `audit anchor drift: ${X24_REAL}`);
  const x24 = crossing(CASPIAN_SHORE_H);
  console.log(`  fallback -24-contour x=${x24.toFixed(0)} m vs real ${X24_REAL.toFixed(0)} m`);
  assert.ok(
    Math.abs(x24 - X24_REAL) <= TOL_M,
    `-24-contour error ${Math.abs(x24 - X24_REAL).toFixed(0)} m exceeds ${TOL_M} m`,
  );
});

test('fallback sea is full at the audited -28 position x≈+4246', () => {
  assert.ok(Math.abs(X28_REAL - 4246) < 5, `audit anchor drift: ${X28_REAL}`);
  const h = proceduralH(X28_REAL, 0);
  console.log(`  fallback h(x=+4246) = ${h.toFixed(1)} m (sea-full = -28)`);
  assert.ok(h < CASPIAN_SHORE_H, 'audited open-water point must read wet');
  assert.ok(Math.abs(h + 28) <= 2, `sea must be ~full at x≈+4246, got ${h}`);
});

test('fallback 0-contour is unique on the site parallel (no rolling islands)', () => {
  let prev = proceduralH(-10000, 0);
  const hits = [];
  for (let x = -9900; x <= 10000; x += 100) {
    const h = proceduralH(x, 0);
    if (prev > 0 !== h > 0) hits.push(x);
    prev = h;
  }
  assert.deepEqual(hits.length, 1, `expected one 0-crossing, saw ${hits}`);
});

test('fallback pin reads dry lowland (matches surveyed -11 m band)', () => {
  const pin = proceduralH(0, 0);
  console.log(`  fallback pin h = ${pin.toFixed(1)} m (surveyed -11 m)`);
  assert.ok(pin > CASPIAN_SHORE_H, 'pin must stay dry under the render key');
  assert.ok(pin < 0, 'pin must sit below 0 m like the surveyed plain');
});

test('fallback-only: live ladder order untouched, fresh field is procedural', () => {
  const src = readFileSync(new URL('../src/ring2/field.js', import.meta.url), 'utf8');
  const iTer = src.indexOf('sampleTerrarium(x, z)');
  const iSrtm = src.indexOf('sampleSrtm(x, z)');
  const iPro = src.indexOf('return proceduralH(x, z)');
  assert.ok(iTer > 0 && iSrtm > 0 && iPro > 0, 'ladder samplers present');
  assert.ok(iTer < iSrtm && iSrtm < iPro, 'ladder still terrarium -> srtm -> procedural');
  assert.ok(src.includes('-28 * sea'), 'procedural -28 sea anchor kept');
  resetField();
  assert.equal(sampleSource(0, 0), 'procedural');
  assert.ok(Number.isFinite(sampleH(0, 0)));
  resetField();
});
