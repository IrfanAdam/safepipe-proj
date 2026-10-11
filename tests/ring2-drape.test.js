/* Ring-2 drape polish (Phase 4): superimpose budget + periphery rim fade.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-4] */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VEX, RING_RADIUS_M } from '../src/ring2/site.js';
import { DRAPE_LIFTS, maxDrapeLift, drapeY, RIM_FADE_IN, rimFadeAlpha, RIM_TILT_GAIN, rimWidthMult } from '../src/ring2/drape.js';

describe('superimpose budget: twin drapes hug the photo plane', () => {
  it('twin ground sits a hair over the photo (photo drapes just under)', () => {
    assert.equal(DRAPE_LIFTS.GROUND, 2);
    // Offset between twin ground (sampleH*VEX+lift) and map terrain (h*VEX):
    assert.equal(drapeY(120, DRAPE_LIFTS.GROUND) - 120 * VEX, 2);
  });
  it('no drape floats high enough to separate at oblique pitch', () => {
    assert.ok(maxDrapeLift() <= 8, `max lift ${maxDrapeLift()} m`);
    // Worst parallax at a 65° tilt stays subpixel vs zoom-11 ground res:
    assert.ok(maxDrapeLift() * Math.sin((65 * Math.PI) / 180) < 8);
  });
  it('drape ordering preserved: ground < water <= contours < ring < rim < mask', () => {
    const L = DRAPE_LIFTS;
    assert.ok(L.GROUND < L.WATER);
    assert.ok(L.WATER <= L.MINOR && L.MINOR <= L.MAJOR);
    assert.ok(L.MAJOR < L.RING && L.RING < L.RIM && L.RIM < L.MASK);
  });
  it('top-down composite invariant: lifts vanish at nadir', () => {
    // Parallax shift = lift * sin(pitch-from-nadir); pitch 0 => 0 for any lift.
    for (const lift of Object.values(DRAPE_LIFTS)) {
      assert.equal(lift * Math.sin(0), 0);
    }
  });
});

describe('periphery rim fade: disc dissolves, no cut edge', () => {
  it('fade starts at 0.9 R — the same radius as the overlay clip fade', () => {
    assert.equal(RIM_FADE_IN, 0.9);
  });
  it('alpha 0 inside the fade start, 1 exactly at the rim', () => {
    assert.equal(rimFadeAlpha(0), 0);
    assert.equal(rimFadeAlpha(RING_RADIUS_M * 0.89), 0);
    assert.equal(rimFadeAlpha(RING_RADIUS_M * 0.9), 0);
    assert.equal(rimFadeAlpha(RING_RADIUS_M), 1);
    assert.equal(rimFadeAlpha(RING_RADIUS_M * 1.5), 1);
  });
  it('alpha ramps monotonically 0 -> 1 across the band (smoothstep, mid = 0.5)', () => {
    const R = RING_RADIUS_M;
    const mid = rimFadeAlpha(R * 0.95);
    assert.ok(Math.abs(mid - 0.5) < 1e-12, `mid=${mid}`);
    let prev = 0;
    for (let f = 0.9; f <= 1.0001; f += 0.01) {
      const a = rimFadeAlpha(R * f);
      assert.ok(a >= prev - 1e-12, `non-monotonic at f=${f}`);
      prev = a;
    }
    assert.ok(rimFadeAlpha(R * 0.99) > 0.9, 'nearly opaque just inside the rim');
    assert.ok(rimFadeAlpha(R * 0.91) < 0.1, 'barely started just outside the fade start');
  });
});

describe('rim tilt compensation: near/far screen softness matches at tilt', () => {
  it('nadir is exactly the uniform band whatever the alignment', () => {
    for (const s of [-1, -0.3, 0, 0.5, 1]) assert.equal(rimWidthMult(s, 0), 1);
  });
  it('tilt widens the camera side and narrows the far side', () => {
    assert.ok(rimWidthMult(1, 0.5) > 1);
    assert.ok(rimWidthMult(-1, 0.5) < 1);
    assert.equal(rimWidthMult(0, 0.5), 1);
  });
  it('calibration meets near/far in the middle at 60° pitch', () => {
    // Pixel-measured pre-fix: far ~7 px, near ~3.5 px for the same band.
    const t = 1 - Math.cos((60 * Math.PI) / 180);
    const q = rimWidthMult(1, t) / rimWidthMult(-1, t);
    assert.ok(Math.abs(q - 2) < 0.05, `near/far width ratio ${q}`);
  });
  it('width never collapses: clamped floor survives extreme tilt', () => {
    assert.ok(rimWidthMult(-1, 1, 10) === 0.15);
  });
  it('gain is the calibrated constant', () => {
    assert.equal(RIM_TILT_GAIN, 0.67);
  });
});
