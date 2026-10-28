/* Safepipe Ops3D Ring-2 — src/ring2/ground-detail.js (Phase 03 rev, ground detail).
 *
 * SEAM DETAIL LAW (pure — no DOM, no three, no map; the GLSL is emitted as a
 * string so overlays.js owns the material wiring and this module stays
 * node-testable):
 *
 * The seam TONE law (tone.js) makes the twin ground's MEAN land on the
 * satellite photo it replaces. It cannot make its CONTRAST land there: the
 * photo is a texture — field parcel edges, tracks, scrub, drainage — while
 * the twin ground is a smooth hypsometric albedo over a coarse DEM. Measured
 * over the central disc at the handoff pose with every overlay hidden, so
 * only the fills are compared (Playwright, 1280×800, z 11.5 / pitch 45):
 *
 *   photo        mean 136.7   sd 43.4   lap 20.25
 *   twin ground  mean 122.1   sd 36.8   lap  1.23
 *
 * i.e. the dissolve endpoint keeps ~94% of the photo's tone and loses ~94%
 * of its LOCAL contrast. That is the owner's "washed flat film", and it is a
 * detail deficit, not an exposure one — which is why darkening the gain
 * (2026-10-26) broke the seam and had to be reverted. This module buys the
 * contrast back on the DETAIL axis only: a ZERO-MEAN modulation of the
 * albedo, so the mean — the number the seam law owns — is untouched by
 * construction.
 *
 * The modulation is band-limited value noise in WORLD x,z, seeded from the
 * site's own coordinates:
 *   - world-anchored, so the pattern sticks to the ground when the camera
 *     moves (nothing crawls in screen space);
 *   - every octave fades out by its screen footprint (fwidth), so no octave
 *     is ever sampled below ~2 px — that is what stops shimmer and aliasing,
 *     and the fade is continuous, so a moving camera cannot pop it.
 *
 * AMPLITUDE IS SOLVED, NEVER DIALED. The target is the photo's own measured
 * high-pass deviation (tone.js photoStats `detailSd`), converted through the
 * sRGB transfer curve at each band's own lit luminance — the same analytic
 * shape as deriveGroundPalette's luminance solve, so a brighter acquisition
 * or a re-lit rig re-derives it. No photo texture, no ground texture; no
 * sample at all, no modulation (never a guessed grain).
 *
 * One modulation law on purpose: no second, hand-weighted detail term. The
 * DEM already contributes through the geometry (Lambert relief) and through
 * the palette solve's irradiance — adding a curvature term on top would need
 * a weight nobody can derive.
 *
 * Honesty note: depiction, not duplication — no imagery is copied, only the
 * photo's measured contrast ENERGY is matched, at the ground's own scales.
 *
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
 */
import { relLuma } from './tone.js';

/** Octave count of the noise field (4 covers ~12:1 of scale). */
export const DETAIL_OCTAVES = 4;
/** Octave amplitude falloff (pink-ish: each octave carries less contrast). */
export const DETAIL_OCTAVE_GAIN = 0.62;
/**
 * Feature wavelengths as fractions of the ring radius, largest first.
 * DERIVED from the disc the ground actually is: the biggest octave is a
 * twelfth of the disc (structure you read at the handoff pose), the smallest
 * is a hundred-and-fiftieth (≈ 65 m at R = 10 km) — tens of metres, the
 * finest thing a schematic twin can honestly claim at this zoom.
 */
export const DETAIL_WAVELENGTH_DIVISORS = Object.freeze([12, 28, 65, 150]);
/** Modulation clamp: beyond ±3σ the value noise's rare extremes read as
 * pinholes rather than texture. */
export const DETAIL_FIELD_CLAMP = 3;
/** Amplitude ceiling, in albedo-fraction units. a = 1 means the modulation can
 * swing a pixel across the palette's whole band separation — beyond that the
 * "detail" is rewriting the hypsometric bands, not texturing them. It is the
 * palette's own contrast that bounds it; nothing here is a look. */
export const DETAIL_AMP_MAX = 1;
/** sRGB curvature sag, as a magnitude: for out = sRGB(L·(1+ε)) with E[ε]=0 the
 * mean falls by |(1/2)·(1/2.4 − 1)|·a²σ² relative to sRGB(L). Derived from the
 * transfer curve's exponent — the DC the modulation gives back so the seam
 * law's mean survives the texture (detail must not spend the tone). */
export const SRGB_MEAN_SAG = Math.abs((1 / 2.4 - 1) / 2);
/**
 * SHAPE, not exposure (the amplitude is solved; this decides what the detail
 * LOOKS like, and every number here is geometric):
 *
 *  WARP — the coarse octaves displace the lattice by half a cell of the
 *         second wavelength, so the pattern follows a larger undulation
 *         instead of sitting on a regular grid. Isotropic lattice noise is
 *         what reads as "TV static"; warped noise reads as ground.
 *  RIDGE_FROM — octaves at or above this index are RIDGED (1 − 2|n|), i.e.
 *         creased at the lattice zero crossings. That is what gives the fine
 *         scale the crenellated, drainage-like character of eroded land
 *         instead of soft blobs; the coarse octaves keep carrying mass.
 *         The field's spread and mean are MEASURED afterwards (fieldStats),
 *         so the ridging cannot change the solved amplitude or the mean.
 */
export const DETAIL_WARP_CELLS = 0.5;
export const DETAIL_RIDGE_FROM = 2;
/** Lattice decorrelation offsets for the second warp axis, in cells of the
 * largest wavelength (irrational-ish so the two axes never co-align). */
const WARP_OFFSET_CELLS = [0.3719, 0.7123];
const WARP_OFFSET_CELLS_0 = WARP_OFFSET_CELLS[0].toFixed(4);
const WARP_OFFSET_CELLS_1 = WARP_OFFSET_CELLS[1].toFixed(4);

/** Wavelengths (metres) for a disc of `discR` metres, largest first. */
export function detailWavelengths(discR) {
  const R = Number(discR);
  if (!(R > 0)) return null;
  return DETAIL_WAVELENGTH_DIVISORS.map((d) => +(R / d).toFixed(1));
}

/** Normalised octave amplitudes (largest first, sum 1). */
export function octaveAmplitudes() {
  const a = [];
  let amp = 1, sum = 0;
  for (let i = 0; i < DETAIL_OCTAVES; i++) {
    a.push(amp);
    sum += amp;
    amp *= DETAIL_OCTAVE_GAIN;
  }
  return a.map((v) => v / sum);
}

/* ── deterministic field ──────────────────────────────────────────────────
 * Value noise, hash-on-lattice. The SAME constants are emitted into GLSL, so
 * the statistics measured here are the statistics the fragment shader
 * produces — that is what makes the amplitude solve honest instead of a
 * calibration guess.
 */
const fract = (x) => x - Math.floor(x);

/** 2D lattice hash -> [0,1). Mirrors gdHash() in the emitted GLSL. */
export function hash2(x, y) {
  const p3x = fract(x * 0.1031);
  const p3y = fract(y * 0.1031);
  const p3z = fract(x * 0.1031);
  const dotv = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  return fract((p3x + dotv + p3y + dotv) * (p3z + dotv));
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Value noise in [-1,1) at lattice coordinates (px, py). Mirrors gdVnoise(). */
export function valueNoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = smooth(px - ix), fy = smooth(py - iy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return (top + (bot - top) * fy) * 2 - 1;
}

/**
 * The ground's detail field at world (x, z) metres, for a disc of `discR`:
 * warped multi-octave value noise with the fine octaves ridged (see
 * DETAIL_WARP_CELLS / DETAIL_RIDGE_FROM). `seed` is the site's own position,
 * so two sites never share a pattern.
 *
 * This is the exact function the fragment shader evaluates — the statistics
 * below are measured through it, which is the only reason the solve can be
 * trusted.
 */
export function detailField(x, z, { discR = 10000, seed = [0, 0] } = {}) {
  const lam = detailWavelengths(discR);
  if (!lam) return 0;
  const amps = octaveAmplitudes();
  const oct = (px, pz, l) => valueNoise(px / l + seed[0], pz / l + seed[1]);
  const w1 = oct(x, z, lam[0]);
  const w2 = oct(x + WARP_OFFSET_CELLS[0] * lam[0], z + WARP_OFFSET_CELLS[1] * lam[0], lam[0]);
  const warp = DETAIL_WARP_CELLS * lam[1];
  const px = x + warp * w1;
  const pz = z + warp * w2;
  let s = 0;
  for (let i = 0; i < DETAIL_OCTAVES; i++) {
    const n = oct(px, pz, lam[Math.min(lam.length - 1, i)]);
    const shape = i >= DETAIL_RIDGE_FROM ? 1 - 2 * Math.abs(n) : n;
    s += amps[i] * shape;
  }
  return s;
}

/**
 * Measured statistics of the whole composed field over a patch of the disc
 * (mean + sigma). The patch spans several of the LARGEST wavelengths — which
 * is what makes the warp representative — and is sampled at 4 points per
 * finest wavelength. A value-noise lattice is statistically homogeneous, so
 * the patch stands in for the disc, and both numbers are measured through
 * detailField() so the warp and the ridging are already in them.
 */
export function fieldStats({ discR = 10000, seed = [0, 0], n = 160 } = {}) {
  const lam = detailWavelengths(discR);
  if (!lam) return null;
  const span = 4 * lam[0];
  const N = Math.max(16, Math.floor(n));
  let s = 0, s2 = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = detailField(((i + 0.5) / N) * span, ((j + 0.5) / N) * span, { discR, seed });
      s += v; s2 += v * v;
    }
  }
  const total = N * N;
  const mean = s / total;
  return {
    samples: total,
    mean: +mean.toFixed(5),
    sigma: +Math.sqrt(Math.max(0, s2 / total - mean * mean)).toFixed(5),
  };
}

/**
 * SOLVE the detail amplitude.
 *
 *   photo    photoStats() of the basemap over the disc (needs `detailSd`)
 *   palette  the SOLVED ground palette (linear albedo bands) — READ ONLY:
 *            this buys contrast, never exposure
 *   irr      meanIrradiance() of the ground mesh under the live rig
 *   weights  screen-area band weights (the same ones the palette solve used)
 *   sigmaN   measured sigma of the noise field (noiseSigma)
 *
 * A band's lit linear luma is L = relLuma(palette[b] * irr). A zero-mean
 * modulation of amplitude a moves it by a·σ·L, which the sRGB transfer curve
 * turns into a·σ·L·s'(L) in 0..255 units. Setting the weighted sum of that
 * equal to the photo's measured high-pass deviation gives `a` with nothing
 * left to choose.
 *
 * The result is then clamped by real headroom — albedo headroom both ways
 * plus the LIT ceiling (a lit pixel above 1.0 is the blowout that must never
 * happen) — and reports whether the clamp bit.
 *
 * Returns null when the inputs cannot support a solve (caller then leaves the
 * ground undetailed — never a guessed grain).
 */
export function solveDetailAmplitude({ photo, palette, irr, weights, sigmaN, albedoMax = 2 } = {}) {
  try {
    const target = Number(photo?.detailSd);
    if (!Number.isFinite(target) || !(target > 0)) return null;
    if (!palette?.sea || !palette?.low || !palette?.high) return null;
    if (!irr || !(Number(irr.r) > 0) || !(Number(irr.g) > 0) || !(Number(irr.b) > 0)) return null;
    const sg = Number(sigmaN);
    if (!Number.isFinite(sg) || !(sg > 1e-6)) return null;
    const irrC = [Number(irr.r), Number(irr.g), Number(irr.b)];
    const bands = ['sea', 'low', 'high'];
    const wRaw = weights ?? { sea: 1, low: 1, high: 1 };
    const wSum = bands.reduce((a, k) => a + Math.max(0, Number(wRaw[k]) || 0), 0);
    if (!(wSum > 0)) return null;
    const w = {};
    for (const b of bands) w[b] = Math.max(0, Number(wRaw[b]) || 0) / wSum;

    /* d(sRGB)/d(linear) × 255 at the band's own lit level. */
    const slope = (L) => {
      if (!(L > 0)) return 0;
      const d = L <= 0.0031308 ? 12.92 : (1.055 / 2.4) * L ** (1 / 2.4 - 1);
      return d * 255;
    };
    let denom = 0;
    let headroom = Infinity;
    for (const b of bands) {
      const pal = palette[b];
      const lit = [pal[0] * irrC[0], pal[1] * irrC[1], pal[2] * irrC[2]];
      const L = relLuma(lit);
      denom += w[b] * L * slope(L) * sg;
      for (let i = 0; i < 3; i++) {
        const upA = pal[i] > 0 ? albedoMax / pal[i] - 1 : Infinity;
        const upL = lit[i] > 0 ? 1 / lit[i] - 1 : Infinity;
        const up = Math.min(upA, upL);
        if (up < headroom) headroom = up;
      }
    }
    if (!(denom > 1e-9)) return null;
    const solved = target / denom;
    const cap = Math.min(DETAIL_AMP_MAX, Number.isFinite(headroom) ? Math.max(0, headroom) : DETAIL_AMP_MAX);
    const amp = Math.max(0, Math.min(cap, solved));
    return {
      amp: +amp.toFixed(4),
      targetDetailSd: +target.toFixed(2),
      sigmaN: +sg.toFixed(4),
      // What the modulation is predicted to add, in 0..255 luma units — the
      // law's own honesty check against the measured frame.
      predictedDetailSd: +(amp * denom).toFixed(2),
      capped: amp < solved - 1e-9,
      solved: +solved.toFixed(4),
      headroom: Number.isFinite(headroom) ? +headroom.toFixed(3) : null,
    };
  } catch {
    return null;
  }
}

/* ── GLSL ────────────────────────────────────────────────────────────────
 * Emitted as text so the wiring stays in overlays.js (which owns the
 * material) and this module stays free of three. The hash/octave structure is
 * the JS field above, one-for-one — the same constants, so the measured sigma
 * applies unchanged.
 */
export const GROUND_DETAIL_UNIFORMS = Object.freeze(['uGdAmp', 'uGdSigmaN', 'uGdMean', 'uGdSeed', 'uGdLam']);

export function groundDetailVertexPars() {
  return 'varying vec2 vGdP;';
}

export function groundDetailFragmentPars() {
  return [
    'uniform float uGdAmp;',
    'uniform float uGdSigmaN;',
    'uniform float uGdMean;',
    'uniform vec2 uGdSeed;',
    'uniform vec4 uGdLam;',
    'varying vec2 vGdP;',
    // Hash + value noise: identical constants to hash2() / valueNoise() above.
    'float gdHash(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'float gdVnoise(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = p - i;',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = gdHash(i);',
    '  float b = gdHash(i + vec2(1.0, 0.0));',
    '  float c = gdHash(i + vec2(0.0, 1.0));',
    '  float d = gdHash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * 2.0 - 1.0;',
    '}',
    // One octave. `pxm` is metres per pixel (the world footprint at this
    // fragment, from fwidth). Nyquist: an octave needs 2 px per cycle, so it
    // is gone by pxm = lam/2 and untouched at lam/4. Continuous in the
    // footprint ⇒ a moving camera can neither make it crawl nor pop it.
    'float gdOctave(vec2 p, float lam, float pxm) {',
    '  float fade = 1.0 - smoothstep(0.25 * lam, 0.50 * lam, pxm);',
    '  if (fade <= 0.001) return 0.0;',
    '  return fade * gdVnoise(p / lam + uGdSeed);',
    '}',
    'float gdField(vec2 p, float pxm) {',
    // Shape, not exposure (mirrors detailField() above): the coarse octave
    // warps the lattice by half a cell of the second wavelength, and the fine
    // octaves are ridged (1 - 2|n|) so they crease like eroded ground rather
    // than sit as soft blobs.
    '  float w1 = gdOctave(p, uGdLam.x, pxm);',
    `  float w2 = gdOctave(p + vec2(${WARP_OFFSET_CELLS_0} * uGdLam.x, ${WARP_OFFSET_CELLS_1} * uGdLam.x), uGdLam.x, pxm);`,
    `  vec2 pw = p + (${DETAIL_WARP_CELLS.toFixed(2)} * uGdLam.y) * vec2(w1, w2);`,
    '  float s = 0.0; float w = 0.0; float a = 1.0;',
    `  for (int i = 0; i < ${DETAIL_OCTAVES}; i++) {`,
    '    float lam = i == 0 ? uGdLam.x : i == 1 ? uGdLam.y : i == 2 ? uGdLam.z : uGdLam.w;',
    '    float n = gdOctave(pw, lam, pxm);',
    `    s += a * (i >= ${DETAIL_RIDGE_FROM} ? 1.0 - 2.0 * abs(n) : n);`,
    '    w += a;',
    `    a *= ${DETAIL_OCTAVE_GAIN.toFixed(2)};`,
    '  }',
    '  return w > 0.0 ? s / w : 0.0;',
    '}',
  ].join('\n');
}

/** Fragment body: multiplicative ZERO-MEAN modulation of the ALBEDO only.
 * `diffuseColor.a` is never touched — the ground's alpha is the single
 * property that owns the crossfade (mix.js law), and detail must not touch
 * it. */
export function groundDetailFragmentBody() {
  return [
    '{',
    '  float gdPxm = max(fwidth(vGdP.x), fwidth(vGdP.y));',
    // uGdMean is the field's MEASURED mean (the ridged octaves have a positive
    // one), subtracted here so the modulation is zero-mean in albedo: the
    // seam law's mean survives the texture instead of being spent on it.
    '  float gdD = gdField(vGdP, gdPxm) - uGdMean;',
    // Raw amplitude, clamped at 3σ so a rare lattice extreme cannot punch a
    // hole — never rescaled, or the amplitude the solve derived would be wrong.
    `  gdD = clamp(gdD, -${DETAIL_FIELD_CLAMP.toFixed(1)} * uGdSigmaN, ${DETAIL_FIELD_CLAMP.toFixed(1)} * uGdSigmaN);`,
    // Multiplicative and zero-mean in ALBEDO; the DC term gives back the sRGB
    // curvature sag the modulation would otherwise cost the mean
    // (SRGB_MEAN_SAG), so brightness is preserved, only detail is added.
    `  diffuseColor.rgb *= (1.0 + ${SRGB_MEAN_SAG.toFixed(4)} * uGdSigmaN * uGdSigmaN * uGdAmp * uGdAmp) * max(0.0, 1.0 + uGdAmp * gdD);`,
    '}',
  ].join('\n');
}
