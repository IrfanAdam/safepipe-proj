// tests/ring2-ground-detail.test.js — seam DETAIL law (src/ring2/ground-detail.js).
// The tone law lands the ground's MEAN on the photo; it cannot land its
// CONTRAST, which is why the dissolve endpoint read as a washed flat film
// (measured lap 1.23 vs the photo's 20.25 over the same disc). These tests pin
// the mechanism, not a look:
//   - the field is deterministic, bounded, and its mean is MEASURED (so the
//     shader can subtract it and the mean stays zero — the seam law's number);
//   - the amplitude is SOLVED from the photo's measured high-pass, monotone in
//     that target, clamped only by real headroom, and never rewrites the
//     palette;
//   - the emitted GLSL modulates the ALBEDO only (never alpha — the ground's
//     alpha is the one property that owns the crossfade), is band-limited by
//     the world footprint (no aliasing / shimmer), and gives back the sRGB
//     sag so detail cannot spend the mean.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detailWavelengths, detailField, fieldStats, octaveAmplitudes,
  solveDetailAmplitude, groundDetailFragmentPars, groundDetailFragmentBody,
  DETAIL_RIDGE_FROM, SRGB_MEAN_SAG, DETAIL_AMP_MAX,
} from '../src/ring2/ground-detail.js';
import { photoStats, srgb255ToLinear, meanIrradiance, deriveGroundPalette, linearToSrgb, relLuma } from '../src/ring2/tone.js';

const SEED = [49.48127, 40.201262];
const R = 10000;

/* A palette + irradiance the way overlays builds them (real solve, not a
 * fixture of made-up numbers). */
function liveSolve(detailSd = 12) {
  const photo = { meanLuma: 120.9, meanColor: [116.4, 123.8, 105.4], p10: 33, p50: 141, p90: 176, detailSd };
  const base = { sea: srgb255ToLinear([0x23, 0x2f, 0x38]), low: srgb255ToLinear([0x2a, 0x30, 0x36]), high: srgb255ToLinear([0x6f, 0x70, 0x69]) };
  const irr = meanIrradiance({ normals: [0, 1, 0, 0, 1, 0, 0, 1, 0], sunDir: [-35000, 52000, 22000], ambientIntensity: 0.85, sunIntensity: 1.5 });
  const weights = { sea: 0.4, low: 0.35, high: 0.25 };
  const derived = deriveGroundPalette({ base, weights, irr, photo });
  return { photo, irr, weights, palette: derived.palette, derived };
}

test('detail wavelengths are derived from the disc, largest first', () => {
  const lam = detailWavelengths(R);
  assert.equal(lam.length, 4);
  for (let i = 1; i < lam.length; i++) assert.ok(lam[i] < lam[i - 1], 'descending');
  assert.ok(Math.abs(lam[0] - R / 12) < 0.2, `coarse octave is a twelfth of the disc: ${lam[0]}`);
  assert.ok(lam[3] > 40 && lam[3] < 120, `finest octave is tens of metres: ${lam[3]}`);
  // Scale-free: a bigger disc gets proportionally bigger feature wavelengths.
  const big = detailWavelengths(R * 2);
  for (let i = 0; i < lam.length; i++) assert.ok(Math.abs(big[i] - lam[i] * 2) < 0.5);
  assert.equal(detailWavelengths(0), null);
});

test('the field is deterministic, bounded, and site-seeded', () => {
  const a = detailField(1234, -567, { discR: R, seed: SEED });
  const b = detailField(1234, -567, { discR: R, seed: SEED });
  assert.equal(a, b, 'same position + seed ⇒ same value');
  const other = detailField(1234, -567, { discR: R, seed: [0, 0] });
  assert.notEqual(a, other, 'a different site paints a different ground');
  let maxAbs = 0;
  for (let i = 0; i < 4000; i++) {
    const x = ((i % 63) - 31) * 137;
    const z = (Math.floor(i / 63) - 31) * 149;
    maxAbs = Math.max(maxAbs, Math.abs(detailField(x, z, { discR: R, seed: SEED })));
  }
  assert.ok(maxAbs <= 1.0000001, `field stays within ±1 (got ${maxAbs})`);
});

test('the field mean is measured, and removing it leaves a zero-mean modulation', () => {
  const s = fieldStats({ discR: R, seed: SEED });
  assert.ok(s && s.sigma > 0.05, `measured sigma ${s?.sigma}`);
  // The ridged octaves give the field a real DC; the shader subtracts the
  // MEASURED mean, so the modulation cannot move the seam law's number.
  assert.ok(Math.abs(s.mean) > 1e-4, `ridging has a measurable DC (${s.mean})`);
  let sum = 0, n = 0;
  const span = 4 * detailWavelengths(R)[0];
  for (let j = 0; j < 60; j++) {
    for (let i = 0; i < 60; i++) {
      sum += detailField(((i + 0.5) / 60) * span, ((j + 0.5) / 60) * span, { discR: R, seed: SEED }) - s.mean;
      n++;
    }
  }
  assert.ok(Math.abs(sum / n) < 0.02 * s.sigma, `residual mean ${(sum / n).toFixed(5)} vs sigma ${s.sigma}`);
});

test('octave amplitudes normalise and share out to a unit-norm field', () => {
  const a = octaveAmplitudes();
  assert.equal(a.length, 4);
  assert.ok(Math.abs(a.reduce((x, y) => x + y, 0) - 1) < 1e-12, 'amplitudes sum to 1');
  for (let i = 1; i < a.length; i++) assert.ok(a[i] < a[i - 1], 'each octave carries less than the one before');
  assert.ok(DETAIL_RIDGE_FROM >= 1 && DETAIL_RIDGE_FROM < 4, 'at least one smooth octave carries mass');
});

test('solveDetailAmplitude needs a measured photo texture and a real rig', () => {
  const live = liveSolve();
  const stats = fieldStats({ discR: R, seed: SEED });
  const ok = solveDetailAmplitude({ ...live, sigmaN: stats.sigma });
  assert.ok(ok && ok.amp > 0, 'solves with a sampled photo');
  assert.equal(solveDetailAmplitude({ photo: {}, palette: live.palette, irr: live.irr, weights: live.weights, sigmaN: stats.sigma }), null, 'no detailSd ⇒ null');
  assert.equal(solveDetailAmplitude({ photo: { detailSd: 0 }, palette: live.palette, irr: live.irr, weights: live.weights, sigmaN: stats.sigma }), null, 'zero texture ⇒ null');
  assert.equal(solveDetailAmplitude({ photo: { detailSd: 12 }, palette: null, irr: live.irr, weights: live.weights, sigmaN: stats.sigma }), null, 'no palette ⇒ null');
  assert.equal(solveDetailAmplitude({ photo: { detailSd: 12 }, palette: live.palette, irr: null, weights: live.weights, sigmaN: stats.sigma }), null, 'no rig ⇒ null');
  assert.equal(solveDetailAmplitude({ photo: { detailSd: 12 }, palette: live.palette, irr: live.irr, weights: live.weights, sigmaN: 0 }), null, 'no field ⇒ null');
});

test('a more textured photo buys more detail, monotonically', () => {
  const stats = fieldStats({ discR: R, seed: SEED });
  let prev = -1;
  for (const target of [1, 2, 4, 8]) {
    const live = liveSolve(target);
    const s = solveDetailAmplitude({ ...live, sigmaN: stats.sigma });
    assert.ok(s && s.amp >= prev, `amp rises with target (${target})`);
    prev = s.amp;
  }
});

test('the solve lands on the photo detail it was given, and clamps on headroom only', () => {
  const stats = fieldStats({ discR: R, seed: SEED });
  const easy = solveDetailAmplitude({ ...liveSolve(4), sigmaN: stats.sigma });
  assert.ok(!easy.capped, 'a modest target is not clamped');
  // predictedDetailSd is the analytic (a·σ·L·s') response the frame should show.
  assert.ok(Math.abs(easy.predictedDetailSd - 4) / 4 < 0.02, `predicted ${easy.predictedDetailSd} vs target 4`);

  // An absurd target (a blown-out white photo) must clamp, not blow the ground.
  const hot = solveDetailAmplitude({ ...liveSolve(120), sigmaN: stats.sigma });
  assert.ok(hot.capped, 'an impossible target is clamped');
  assert.ok(hot.amp <= DETAIL_AMP_MAX + 1e-9, `amp ${hot.amp} stays inside the palette-bound ceiling`);
  const live = liveSolve(120);
  for (const b of ['sea', 'low', 'high']) {
    for (let i = 0; i < 3; i++) {
      assert.ok(live.palette[b][i] * live.irr[['r', 'g', 'b'][i]] * (1 + hot.amp) <= 1.0001, `lit ${b}[${i}] cannot blow out`);
    }
  }
});

test('the solve never rewrites the palette (detail, never brightness)', () => {
  const live = liveSolve(12);
  const before = JSON.stringify(live.palette);
  const stats = fieldStats({ discR: R, seed: SEED });
  solveDetailAmplitude({ ...live, sigmaN: stats.sigma });
  assert.equal(JSON.stringify(live.palette), before, 'palette is read-only input');
});

test('the emitted GLSL modulates albedo only, and is footprint band-limited', () => {
  const frag = groundDetailFragmentPars() + groundDetailFragmentBody();
  assert.ok(frag.includes('diffuseColor.rgb *='), 'detail multiplies the albedo');
  assert.ok(!/diffuseColor\.a\s*[*+]=/.test(frag), 'NEVER touches alpha: ground alpha owns the crossfade');
  assert.ok(!/gl_FragColor/.test(frag), 'no direct fragment writes');
  assert.ok(frag.includes('fwidth(vGdP'), 'footprint comes from world-space derivatives');
  assert.ok(/smoothstep\(0\.25 \* lam, 0\.50 \* lam, pxm\)/.test(frag), 'octaves fade out at Nyquist (2 px/cycle)');
  assert.ok(frag.includes('uGdMean'), 'the measured mean is subtracted');
  assert.ok(String(SRGB_MEAN_SAG.toFixed(4)) === '0.2917', 'sRGB sag constant is the transfer curve’s own');
  assert.ok(frag.includes(SRGB_MEAN_SAG.toFixed(4)), 'the sag is given back');
  // A world-anchored field is what keeps the grain from crawling: the noise
  // coordinate must be world xz, and the injected varying must carry exactly
  // that (never a screen-space uv).
  assert.ok(/vGdP/.test(frag));
});

test('a flat photo produces no ground detail, and a textured one does', () => {
  const w = 32, h = 32;
  const flat = new Uint8Array(w * h * 4);
  const busy = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    flat[i * 4] = flat[i * 4 + 1] = flat[i * 4 + 2] = 140;
    const v = i % 2 ? 200 : 60;
    busy[i * 4] = busy[i * 4 + 1] = busy[i * 4 + 2] = v;
    flat[i * 4 + 3] = 255; busy[i * 4 + 3] = 255;
  }
  const f = photoStats(flat, w, h, { stride: 1 });
  const b = photoStats(busy, w, h, { stride: 1 });
  assert.ok(f && b);
  assert.ok(f.detailSd < 1e-6, `flat photo has no structure (${f.detailSd})`);
  assert.ok(b.detailSd > 50, `a hard-edged photo measures real structure (${b.detailSd})`);
  const stats = fieldStats({ discR: R, seed: SEED });
  assert.equal(solveDetailAmplitude({ ...liveSolve(0), photo: f, sigmaN: stats.sigma }), null, 'nothing to carry ⇒ no grain');
  assert.ok(solveDetailAmplitude({ ...liveSolve(0), photo: b, sigmaN: stats.sigma })?.amp > 0, 'texture in ⇒ texture out');
});

test('detail cannot spend the tone: the modulated mean is the solved mean', () => {
  // Analytic check of the sRGB sag compensation: the DC the shader adds back
  // is the curvature loss of the modulation, so the expected output luma is
  // unchanged rather than dragged down by the texture.
  const live = liveSolve(12);
  const stats = fieldStats({ discR: R, seed: SEED });
  const s = solveDetailAmplitude({ ...live, sigmaN: stats.sigma });
  const L = relLuma([live.palette.low[0] * live.irr.r, live.palette.low[1] * live.irr.g, live.palette.low[2] * live.irr.b]);
  const a = s.amp;
  const dc = 1 + SRGB_MEAN_SAG * stats.sigma * stats.sigma * a * a;
  // Sample the transfer curve either side of the modulation: the mean of the
  // textured outputs must land within a hair of the untextured one.
  let acc = 0;
  const N = 41;
  for (let i = 0; i < N; i++) {
    const d = -3 + (6 * i) / (N - 1);
    acc += linearToSrgb(L * dc * Math.max(0, 1 + a * d * stats.sigma));
  }
  const texturedMean = acc / N;
  const plain = linearToSrgb(L);
  assert.ok(Math.abs(texturedMean - plain) / plain < 0.03, `mean drift ${((texturedMean - plain) / plain * 100).toFixed(2)}%`);
});
