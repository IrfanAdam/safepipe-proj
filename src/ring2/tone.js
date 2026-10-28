/* Safepipe Ops3D Ring-2 — src/ring2/tone.js (Phase 03 rev, seam tone).
 *
 * SEAM TONE LAW (pure, node-testable — no DOM, no three, no map):
 * the twin's schematic ground is the ONLY thing that replaces the satellite
 * photo at the base swap, and it is authored from a fixed hypsometric
 * palette. That palette is ~2.5x darker than the Esri photo it dissolves
 * from, so the swap reads as an exposure pop (measured at the handoff pose:
 * basemap mean luma 95.1 vs twin ground 53.4 over the same disc = a 44%
 * step, and a 60% dip mid-band once the photo's own fade is counted twice).
 *
 * This module derives the ground's ALBEDO from the photo instead of
 * guessing it: sample what the basemap is actually showing over the disc
 * (photoStats), then solve the palette so the Lambert-lit output lands on
 * the photo's own luminance and hue (deriveGroundPalette). Nothing here is
 * a metre/value literal — every number comes from the live sample plus the
 * scene's real light rig, so a brighter acquisition, a different time of
 * day, or a re-lit rig all re-derive the same way.
 *
 * Honesty note: the twin stays a schematic reconstruction (hypsometric
 * relief + linework), not a photo copy — it is graded to the photo's tone,
 * not textured with it. The palette keeps its semantic bands (sea / low
 * ground / high ground); only their exposure + tint follow the photo.
 *
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
 */

/* Page/map background (#0b0c0c): the twin's outside-ring mask and the
 * MapLibre ground background. Pixels this close to it in a basemap readback
 * are MASK, not photo — excluded from the tone sample. */
export const TONE_BG_RGB = Object.freeze([11, 12, 12]);
export const TONE_BG_TOL = 10;

/** sRGB 0..1 -> linear 0..1 (three's working space, exact IEC curve). */
export function srgbToLinear(v) {
  const c = Number(v);
  if (!Number.isFinite(c)) return 0;
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/** linear 0..1 -> sRGB 0..1. */
export function linearToSrgb(v) {
  const c = Number(v);
  if (!Number.isFinite(c)) return 0;
  const x = Math.max(0, c);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** Relative luminance of a LINEAR rgb triple (Rec.709, same weights as the
 * composite-luma probe, so the derivation and the measurement agree). */
export function relLuma(rgb) {
  const r = Number(rgb?.[0] ?? rgb?.r) || 0;
  const g = Number(rgb?.[1] ?? rgb?.g) || 0;
  const b = Number(rgb?.[2] ?? rgb?.b) || 0;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** sRGB 0..255 triple -> linear triple. */
export function srgb255ToLinear(rgb) {
  return [srgbToLinear((Number(rgb?.[0]) || 0) / 255), srgbToLinear((Number(rgb?.[1]) || 0) / 255), srgbToLinear((Number(rgb?.[2]) || 0) / 255)];
}

/** linear triple -> sRGB 0..255 triple (rounded, clamped). */
export function linearToSrgb255(rgb) {
  const f = (v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
  return [f(rgb?.[0]), f(rgb?.[1]), f(rgb?.[2])];
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/* Photo tone sample from an RGBA byte buffer (a MapLibre canvas readback, or
 * any imagery buffer). `stride` skips pixels for cost; `bg`/`tol` drop the
 * masked background so only the ring's photo is measured.
 *
 * Returns null when nothing usable was sampled (all background / empty
 * buffer) — callers keep the previous tone rather than guessing a dark one. */
export function photoStats(rgba, width, height, { stride = 4, bg = TONE_BG_RGB, tol = TONE_BG_TOL } = {}) {
  const w = Math.max(0, Math.floor(Number(width) || 0));
  const h = Math.max(0, Math.floor(Number(height) || 0));
  const st = Math.max(1, Math.floor(Number(stride) || 1));
  if (!rgba || !w || !h || rgba.length < 4) return null;
  const [br, bgc, bb] = bg;
  let n = 0;
  let sr = 0, sg = 0, sb = 0, sl = 0;
  const hist = new Uint32Array(256);
  const px = (x, y) => {
    const i = ((y * w) + x) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2]];
  };
  for (let y = 0; y < h; y += st) {
    for (let x = 0; x < w; x += st) {
      const i = ((y * w) + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      // Mask/background (and near-black void): not photo, never sampled.
      if (Math.abs(r - br) <= tol && Math.abs(g - bgc) <= tol && Math.abs(b - bb) <= tol) continue;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (!(l > 1)) continue;
      n++;
      sr += r; sg += g; sb += b; sl += l;
      hist[Math.min(255, Math.max(0, Math.round(l)))]++;
    }
  }
  const total = Math.ceil(w / st) * Math.ceil(h / st);
  if (!n || !total) return null;
  const coverage = n / total;
  if (coverage < 0.05) return null; // nothing but mask: no usable photo tone
  const meanColor = [sr / n, sg / n, sb / n];
  const meanLuma = sl / n;
  // Percentiles from the histogram (cheap, exact enough for a palette range).
  const sorted = [];
  for (let v = 0; v < 256; v++) if (hist[v]) sorted.push([v, hist[v]]);
  const at = (p) => {
    const want = n * p;
    let acc = 0;
    for (const [v, c] of sorted) {
      acc += c;
      if (acc >= want) return v;
    }
    return sorted.length ? sorted[sorted.length - 1][0] : 0;
  };
  return {
    samples: n,
    coverage: +coverage.toFixed(3),
    meanLuma: +meanLuma.toFixed(2),
    meanColor: meanColor.map((v) => +v.toFixed(1)),
    p10: at(0.1), p50: at(0.5), p90: at(0.9),
  };
}

/* Mean Lambert irradiance for a set of ground normals under the twin's real
 * light rig, per channel, already divided by PI (three's BRDF_Lambert).
 *
 * three (physically-correct lights) computes
 *   outgoing = diffuseColor / PI * (ambientColor*ambI + Σ sunColor*sunI*max(N·L,0))
 * so this vector is exactly the factor the palette is multiplied by. Passing
 * the SAME numbers the renderer uses is what makes the derivation analytic
 * instead of a guess. */
export function meanIrradiance({ normals, sunDir, ambientColor, ambientIntensity, sunColor, sunIntensity } = {}) {
  const amb = ambientColor ?? [0.55, 0.60, 0.63];
  const sun = sunColor ?? [1, 0.88, 0.72];
  const ai = Number.isFinite(Number(ambientIntensity)) ? Number(ambientIntensity) : 0.85;
  const si = Number.isFinite(Number(sunIntensity)) ? Number(sunIntensity) : 1.5;
  const L = sunDir ?? [-35000, 52000, 22000];
  const ll = Math.hypot(L[0], L[1], L[2]) || 1;
  const lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll;
  let dotSum = 0;
  let cnt = 0;
  if (normals && normals.length >= 3) {
    for (let i = 0; i + 2 < normals.length; i += 3) {
      const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
      const nl = Math.hypot(nx, ny, nz);
      if (!(nl > 0)) continue;
      const d = (nx * lx + ny * ly + nz * lz) / nl;
      dotSum += Math.max(0, d);
      cnt++;
    }
  }
  // No normals (or a degenerate mesh): the flat-ground reference — the sun
  // elevation alone, which is what a level plain sees.
  const meanDotNL = cnt ? dotSum / cnt : Math.max(0, ly);
  const inv = 1 / Math.PI;
  return {
    meanDotNL: +meanDotNL.toFixed(4),
    r: (amb[0] * ai + sun[0] * si * meanDotNL) * inv,
    g: (amb[1] * ai + sun[1] * si * meanDotNL) * inv,
    b: (amb[2] * ai + sun[2] * si * meanDotNL) * inv,
  };
}

/* Palette gain limits. Wide enough to bridge a dusk-vs-noon photo, tight
 * enough that a bad sample can never blow the ground out or invert it. */
export const RESIDUAL_GAIN_MIN = 0.5;
export const RESIDUAL_GAIN_MAX = 2;
/* Albedo ceiling. NOT 1.0: this rig is a physically-shaped Lambert setup
 * (irradiance/PI ~ 0.5 for a sunlit plain), so a pixel can only reach white
 * with an albedo near 2. Clipping at 1.0 would cap every bright photo's
 * hills at half white. What must never happen is a LIT pixel above 1.0 —
 * that is the blowout the owner warned about, and it is what `clipped`
 * reports. */
export const ALBEDO_MAX = 2;
/* Hue blend: how much of the photo's mean chromaticity the ground adopts
 * (the rest keeps each band's authored hue identity — the Caspian still
 * reads as water, the hills still read as ground). Luminance is set
 * explicitly per band, so the blend can never break the tone match. */
export const PHOTO_CHROMA_WEIGHT = 0.55;

/* Solve the ground palette so its LIT output matches the photo's tone.
 *
 *   base    linear palette bands { sea, low, high } (authored albedo/hue)
 *   weights area weights per band (from the built mesh — real ground cover)
 *   irr     meanIrradiance() of the same mesh under the live rig
 *   photo   photoStats() of the basemap over the same disc
 *
 * TONE TRANSFER BY QUANTILE (not a single gain — a single gain cannot work:
 * the authored sea:hill ratio is ~1:9 in linear light, so lifting the dark
 * mean to a daylight mean saturates the hills to white first. Measured: a
 * flat gain clipped the high band at 254 while the mean still sat 15% low).
 *
 *   1. LUMINANCE — each band takes its own key from the photo's own
 *      distribution over the same disc: sea <- p10, plain <- p50,
 *      high ground <- p90. The ground's tonal SHAPE is the photo's shape.
 *   2. HUE — each band keeps its authored chromaticity blended with the
 *      photo's mean chromaticity (warm sand + olive scrub here), luminance
 *      normalized so step 2 cannot undo step 1.
 *   3. RESIDUAL — one small scalar so the weighted LIT mean lands exactly
 *      on the photo's mean luminance (the band cover is not the photo's
 *      pixel distribution, so a few % always remains).
 *
 * Returns null when the inputs can't support a derivation (caller keeps the
 * authored palette — never a guessed one). */
export function deriveGroundPalette({ base, weights, irr, photo } = {}) {
  try {
    if (!base || !base.sea || !base.low || !base.high) return null;
    if (!irr || !(relLuma([irr.r, irr.g, irr.b]) > 0)) return null;
    const target = Number(photo?.meanLuma);
    if (!Number.isFinite(target) || target <= 1) return null;
    const wRaw = weights ?? { sea: 1, low: 1, high: 1 };
    const wSum = ['sea', 'low', 'high'].reduce((a, k) => a + Math.max(0, Number(wRaw[k]) || 0), 0);
    if (!(wSum > 0)) return null;
    const w = { sea: Math.max(0, Number(wRaw.sea) || 0) / wSum, low: Math.max(0, Number(wRaw.low) || 0) / wSum, high: Math.max(0, Number(wRaw.high) || 0) / wSum };
    const bands = ['sea', 'low', 'high'];

    /* 1. Band luminance keys from the photo's distribution. Percentiles are
     *    the photo's own answer to "how bright is water / plain / hill", so
     *    the palette's range is the photo's range by construction. */
    const hasPct = [photo?.p10, photo?.p50, photo?.p90].every((v) => Number.isFinite(Number(v)));
    const keys = hasPct
      ? { sea: Number(photo.p10), low: Number(photo.p50), high: Number(photo.p90) }
      // No percentiles (a caller-supplied mean only): spread around it.
      : { sea: target * 0.35, low: target, high: Math.min(255, target * 1.6) };
    // Order is physical: water darker than plain, plain darker than hills.
    keys.low = Math.max(keys.low, keys.sea + 2);
    keys.high = Math.max(keys.high, keys.low + 2);

    /* 2. Hue: photo mean chromaticity blended with each band's authored one. */
    const photoC = Array.isArray(photo?.meanColor) && photo.meanColor.length === 3 ? photo.meanColor : null;
    const pLin = photoC ? srgb255ToLinear(photoC) : [target / 255, target / 255, target / 255];
    const pY = relLuma(pLin);
    const pChroma = pY > 1e-6 ? pLin.map((v) => v / pY) : [1, 1, 1];
    const normChroma = (c) => {
      const y = relLuma(c);
      if (!(y > 1e-6)) return [1, 1, 1];
      return c.map((v) => v / y);
    };
    const k = Math.min(1, Math.max(0, PHOTO_CHROMA_WEIGHT));

    const out = {};
    let clipped = false;
    for (const b of bands) {
      const authored = base[b];
      const aY = relLuma(authored);
      const aChroma = aY > 1e-6 ? authored.map((v) => v / aY) : [1, 1, 1];
      const chroma = normChroma(aChroma.map((v, i) => v * (1 - k) + pChroma[i] * k));
      // Luminance the photo asks for, converted back into albedo through the
      // mesh's own irradiance — so the LIT pixel lands on the key exactly.
      const yT = srgbToLinear(keys[b] / 255);
      const litUnit = relLuma([chroma[0] * irr.r, chroma[1] * irr.g, chroma[2] * irr.b]);
      if (!(litUnit > 1e-9)) return null;
      const s = yT / litUnit;
      const albedo = chroma.map((v) => v * s);
      // Albedo ceiling (see ALBEDO_MAX): the rig, not the material, is what
      // limits the top end; a lit pixel above 1.0 is the real blowout.
      out[b] = albedo.map((v) => Math.min(ALBEDO_MAX, Math.max(0, v)));
    }

    /* 3. Residual: land the weighted lit MEAN on the photo's mean. */
    const litOf = (pal) => {
      const acc = [0, 0, 0];
      for (const b of bands) {
        acc[0] += w[b] * pal[b][0] * irr.r;
        acc[1] += w[b] * pal[b][1] * irr.g;
        acc[2] += w[b] * pal[b][2] * irr.b;
      }
      return acc;
    };
    const yT = srgbToLinear(target / 255);
    const lit0 = litOf(out);
    const y0 = relLuma(lit0);
    let gain = 1;
    if (y0 > 1e-9) gain = Math.min(RESIDUAL_GAIN_MAX, Math.max(RESIDUAL_GAIN_MIN, yT / y0));
    const palette = {};
    for (const b of bands) palette[b] = out[b].map((v) => Math.min(ALBEDO_MAX, v * gain));
    const lit = litOf(palette);
    // Blowout verdict on the LIT output (what the eye sees), per band.
    for (const b of bands) {
      for (let i = 0; i < 3; i++) {
        if (palette[b][i] * (i === 0 ? irr.r : i === 1 ? irr.g : irr.b) > 1.0001) clipped = true;
      }
    }
    return {
      palette,
      gain: +gain.toFixed(3),
      keys,
      chroma: pChroma.map((v) => +v.toFixed(3)),
      clipped,
      // The numbers the verification reads back: predicted lit tone vs the
      // photo it is matched to. `delta` is the law's own honesty check.
      litLuma: +(linearToSrgb(relLuma(lit)) * 255).toFixed(1),
      litColor: linearToSrgb255(lit),
      targetLuma: +target.toFixed(1),
      delta: +(Math.abs(linearToSrgb(relLuma(lit)) * 255 - target) / Math.max(1, target)).toFixed(4),
    };
  } catch {
    return null;
  }
}

/* Relative luma delta between two 0..255 means (the seam criterion the
 * verification drives under 10%). */
export function lumaDelta(a, b) {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const den = Math.max(1e-6, (Math.abs(x) + Math.abs(y)) / 2);
  return Math.abs(x - y) / den;
}

/* Palette selection (pure): the solved basemap derivation wins whenever it
 * exists — the ground RENDERS the photo it replaces, so the swap has no
 * exposure step by construction. The authored albedo stands only with no
 * sample yet (a shape fallback, never a guessed dark). Returns { palette,
 * applied } so the probe reports the rendered truth, not the solve's
 * prediction. */
export function appliedGroundPalette(authored, derived) {
  try {
    if (derived && derived.palette && derived.palette.sea && derived.palette.low && derived.palette.high) {
      return { palette: derived.palette, applied: true };
    }
  } catch { /* fall through to the authored shape */ }
  return { palette: authored, applied: false };
}

/* ── PHOTO-TONE REGISTRY ─────────────────────────────────────────────────
 * The measured basemap tone, in the pure module that owns tone math: the
 * sampler (mapbase.js, which owns the live MapLibre canvas) publishes here,
 * and the ground palette derivation (overlays.js) subscribes. Deliberately
 * NOT in mapbase.js — overlays must not import the map module (it pulls
 * maplibre + its CSS into every node test that touches the overlay stack).
 */
let _photoTone = null;
const _toneSubs = new Set();

/** Last measured basemap tone (null until a sample lands). */
export function getPhotoTone() {
  return _photoTone;
}

/** Publish a new photo-tone sample (mapbase.sampleBasemapTone feeds this). */
export function setPhotoTone(stats) {
  if (!stats || !Number.isFinite(Number(stats.meanLuma))) return null;
  _photoTone = { ...stats, at: Number(stats.at) || Date.now() };
  for (const cb of _toneSubs) {
    try {
      cb(_photoTone);
    } catch { /* a subscriber error never breaks the sample */ }
  }
  return _photoTone;
}

/** Subscribe to new tone samples. Returns an unsubscribe fn. */
export function onPhotoTone(cb) {
  if (typeof cb !== 'function') return () => {};
  _toneSubs.add(cb);
  return () => _toneSubs.delete(cb);
}
