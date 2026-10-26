// tests/ring2-tone.test.js — seam tone law (src/ring2/tone.js).
// The twin's ground albedo is DERIVED from the satellite basemap it
// dissolves from, so the base swap has no exposure step. These tests pin the
// derivation's math (not a look): a photo mean goes in, a palette whose LIT
// output lands on that mean comes out, without blowing the bright band out.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  srgbToLinear, linearToSrgb, relLuma, srgb255ToLinear, linearToSrgb255,
  photoStats, meanIrradiance, deriveGroundPalette, lumaDelta,
  TONE_BG_RGB, RESIDUAL_GAIN_MAX,
} from '../src/ring2/tone.js';

test('sRGB transfer functions round-trip', () => {
  for (const v of [0, 0.01, 0.04045, 0.2, 0.5, 0.9, 1]) {
    assert.ok(Math.abs(linearToSrgb(srgbToLinear(v)) - v) < 1e-6, `round trip ${v}`);
  }
  assert.equal(linearToSrgb255([0, 0, 0]).join(), '0,0,0');
  assert.equal(linearToSrgb255([1, 1, 1]).join(), '255,255,255');
});

test('relLuma uses the composite-probe weights', () => {
  // Same Rec.709 weights the luma measurement uses — the law and the
  // verification must not disagree about what "luma" means.
  assert.ok(Math.abs(relLuma([1, 0, 0]) - 0.2126) < 1e-12);
  assert.ok(Math.abs(relLuma({ r: 0, g: 1, b: 0 }) - 0.7152) < 1e-12);
});

test('photoStats measures the photo and ignores the masked background', () => {
  const w = 16, h = 16;
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const isBg = i % 2 === 0;
    const [r, g, b] = isBg ? TONE_BG_RGB : [150, 140, 120];
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255;
  }
  const s = photoStats(buf, w, h, { stride: 1 });
  assert.ok(s, 'sample lands');
  assert.ok(Math.abs(s.coverage - 0.5) < 0.01, `coverage ${s.coverage}`);
  assert.ok(Math.abs(s.meanLuma - (0.2126 * 150 + 0.7152 * 140 + 0.0722 * 120)) < 0.5);
  assert.deepEqual(s.meanColor, [150, 140, 120]);
  // Percentiles come off the same histogram (a flat photo has flat ones).
  assert.equal(s.p10, s.p90);
});

test('photoStats returns null when there is nothing but mask', () => {
  const w = 8, h = 8;
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = TONE_BG_RGB[0]; buf[i * 4 + 1] = TONE_BG_RGB[1]; buf[i * 4 + 2] = TONE_BG_RGB[2]; buf[i * 4 + 3] = 255;
  }
  assert.equal(photoStats(buf, w, h, { stride: 1 }), null);
  assert.equal(photoStats(null, 0, 0), null);
});

test('meanIrradiance: a level plain sees the sun elevation alone', () => {
  // Flat normals (+Y) -> N·L = L.y, and the per-channel factor is
  // (amb*ambI + sun*sunI*dotNL)/PI — three's BRDF_Lambert shape.
  const irr = meanIrradiance({
    normals: [0, 1, 0, 0, 1, 0],
    sunDir: [0, 1, 0],
    ambientColor: [0.5, 0.5, 0.5],
    ambientIntensity: 1,
    sunColor: [1, 1, 1],
    sunIntensity: 1,
  });
  assert.ok(Math.abs(irr.meanDotNL - 1) < 1e-9);
  assert.ok(Math.abs(irr.r - 1.5 / Math.PI) < 1e-9, `irr ${irr.r}`);
  // No normals at all falls back to the flat reference, never NaN.
  const flat = meanIrradiance({ sunDir: [0, 2, 0] });
  assert.ok(Number.isFinite(flat.r) && flat.r > 0);
});

const BASE = { sea: srgb255ToLinear([0x23, 0x2f, 0x38]), low: srgb255ToLinear([0x2a, 0x30, 0x36]), high: srgb255ToLinear([0x6f, 0x70, 0x69]) };
const IRR = meanIrradiance({ normals: [0, 1, 0], sunDir: [-35000, 52000, 22000] });
const W = { sea: 0.35, low: 0.5, high: 0.15 };
const PHOTO = { meanLuma: 95, meanColor: [90, 98, 84], p10: 33, p50: 109, p90: 144 };

test('deriveGroundPalette lands the LIT output on the photo mean (the seam law)', () => {
  const d = deriveGroundPalette({ base: BASE, weights: W, irr: IRR, photo: PHOTO });
  assert.ok(d, 'derivation lands');
  // The whole point: predicted lit luma within a couple of % of the photo —
  // the 10% seam bar is met by construction, not by tuning.
  assert.ok(d.delta < 0.02, `delta ${d.delta} (lit ${d.litLuma} vs photo ${d.targetLuma})`);
  // Each band takes its luminance key from the photo's own distribution.
  assert.equal(d.keys.sea, PHOTO.p10);
  assert.equal(d.keys.low, PHOTO.p50);
  assert.equal(d.keys.high, PHOTO.p90);
});

test('deriveGroundPalette never blows the bright band out', () => {
  // The old flat-gain solve clipped the hills at 254 while the mean was still
  // 15% low — the reason this is a quantile transfer, not a gain.
  for (const meanLuma of [60, 95, 120, 160]) {
    // A photo's percentiles move with its mean — a sample is one distribution.
    const photo = { ...PHOTO, meanLuma, p10: Math.round(meanLuma * 0.30), p50: Math.round(meanLuma * 1.19), p90: Math.round(meanLuma * 1.54) };
    const d = deriveGroundPalette({ base: BASE, weights: W, irr: IRR, photo });
    assert.ok(d, `derives at ${meanLuma}`);
    for (const b of ['sea', 'low', 'high']) {
      // The LIT pixel is what must stay on screen — albedo may exceed 1
      // (this rig's irradiance/PI is ~0.5), the OUTPUT may not.
      const litOut = [d.palette[b][0] * IRR.r, d.palette[b][1] * IRR.g, d.palette[b][2] * IRR.b];
      for (const v of litOut) assert.ok(v <= 1.0001, `${b} lit ${v} at photo ${meanLuma}`);
    }
    assert.equal(d.clipped, false, `no clipping at photo ${meanLuma}`);
    assert.ok(d.delta < 0.02, `delta ${d.delta} at photo ${meanLuma}`);
  }
});

test('deriveGroundPalette keeps band order and adopts the photo hue', () => {
  const d = deriveGroundPalette({ base: BASE, weights: W, irr: IRR, photo: PHOTO });
  const l = (c) => relLuma(c);
  assert.ok(l(d.palette.sea) < l(d.palette.low), 'sea below land');
  assert.ok(l(d.palette.low) < l(d.palette.high), 'land below hills');
  // Authored palette is cool (blue > red); this photo is warm (red > blue).
  const authoredRatio = BASE.low[0] / BASE.low[2];
  const derivedRatio = d.palette.low[0] / d.palette.low[2];
  assert.ok(derivedRatio > authoredRatio, `hue moved warm: ${derivedRatio} > ${authoredRatio}`);
});

test('deriveGroundPalette is exposure-bounded and never guesses', () => {
  const bright = deriveGroundPalette({ base: BASE, weights: W, irr: IRR, photo: { ...PHOTO, meanLuma: 255 } });
  assert.ok(bright.gain <= RESIDUAL_GAIN_MAX, `residual gain capped ${bright.gain}`);
  // Garbage in -> null out (caller keeps the authored palette).
  assert.equal(deriveGroundPalette({ base: BASE, irr: IRR, photo: { meanLuma: 0 } }), null);
  assert.equal(deriveGroundPalette({ base: BASE, irr: null, photo: PHOTO }), null);
  assert.equal(deriveGroundPalette({ base: null, irr: IRR, photo: PHOTO }), null);
  assert.equal(deriveGroundPalette({ base: BASE, irr: IRR, photo: PHOTO, weights: { sea: 0, low: 0, high: 0 } }), null);
  // A mean-only sample (no percentiles) still derives, from the mean spread.
  const noPct = deriveGroundPalette({ base: BASE, weights: W, irr: IRR, photo: { meanLuma: 95, meanColor: [90, 98, 84] } });
  assert.ok(noPct && noPct.delta < 0.02);
});

test('deriveGroundPalette is idempotent under a re-sample of the same photo', () => {
  const a = deriveGroundPalette({ base: BASE, weights: W, irr: IRR, photo: PHOTO });
  const b = deriveGroundPalette({ base: BASE, weights: W, irr: IRR, photo: PHOTO });
  assert.deepEqual(a.palette, b.palette);
  // ... and a brighter photo re-derives brighter, monotonically.
  const c = deriveGroundPalette({ base: BASE, weights: W, irr: IRR, photo: { ...PHOTO, meanLuma: 130 } });
  assert.ok(c.litLuma > a.litLuma, `${c.litLuma} > ${a.litLuma}`);
});

test('deriveGroundPalette follows the ground cover it is given', () => {
  // Same photo, different cover: an all-sea disc must not come out at the
  // same albedo as an all-hill one (the solve is weighted by what is seen).
  const seaHeavy = deriveGroundPalette({ base: BASE, weights: { sea: 0.9, low: 0.1, high: 0 }, irr: IRR, photo: PHOTO });
  const hillHeavy = deriveGroundPalette({ base: BASE, weights: { sea: 0, low: 0.1, high: 0.9 }, irr: IRR, photo: PHOTO });
  assert.ok(seaHeavy.gain > hillHeavy.gain, `${seaHeavy.gain} > ${hillHeavy.gain}`);
});

test('lumaDelta is the seam criterion', () => {
  assert.equal(lumaDelta(95, 95), 0);
  assert.ok(Math.abs(lumaDelta(95, 104.5) - 0.095) < 0.002, 'just inside 10%');
  assert.ok(lumaDelta(95, 53) > 0.5, 'the pre-fix step reads as a failure');
});
