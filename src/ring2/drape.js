/* Safepipe Ops3D Ring-2 — src/ring2/drape.js (Phase 4 polish).
 * Superimpose budget + periphery rim-fade math, dependency-free so node
 * tests can pin the numbers (same pattern as takeover.js).
 *
 * SUPERIMPOSE: every twin drape sits at sampleH * VEX + lift while the map
 * photo (MapLibre Terrarium terrain, exaggeration VEX) sits at h * VEX over
 * the same DEM. The lift IS the vertical offset — at oblique pitch it reads
 * as parallax separation between photo and overlay. Nothing in the twin
 * scene writes depth (every material sets depthWrite:false; paint order
 * alone composites), so lifts NEVER fight in a depth buffer — there is no
 * z-fighting to clear and no near/far-plane precision trade applies
 * (camera near 10 / far 600000 exists only to bound the 300 km mask mesh).
 * The lifts' only job is preserving the visual stack order (distinct,
 * ordered values) with the smallest possible photo parallax.
 *
 * MINIMUM (2026-10-12 audit, VEX=1.0 so metres map 1:1): ground 1 m over
 * the photo, linework 2–4 m, rim/mask 5–6 m. Worst photo parallax at the
 * 65° clamp is 4·sin65° ≈ 3.6 m — subpixel against far-range ground
 * resolution (≈7 m/px at 12 km range, ≈16 m/px at the 26 km start range).
 * Measured live-Terrarium far-rim gap, twin-z12 (29 m cells) vs map-z15
 * (3.6 m cells), 72 pts @ R=10 km: max 16.7 m, mean 1.19 m over 286 m
 * relief. The LOD gap dominates the float on relief by ~5× over any lift,
 * so geometry (drape on sampleH) is left alone and lifts sit at the floor
 * that keeps every layer distinct.
 *
 * PERIPHERY: RIM_FADE_IN matches the overlay ring-clip fade start (0.9 R in
 * overlays.js) so the photo vignette, the overlay clip fade, and the rim
 * dissolve all agree on one radius. rimFadeAlpha() is the tested CPU
 * reference for that curve; the rim mesh evaluates the identical smoothstep
 * per-pixel in its fragment shader (see buildRimFade), so tilt and bearing
 * can't skew the falloff.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-4]
 */
import { VEX, RING_RADIUS_M } from './site.js';

/* Vertical offsets (m) of each twin drape above the shared DEM surface.
 * Floor values (2026-10-12): smallest distinct ordered set; see header for
 * the no-depth-writes reasoning and the measured LOD-gap numbers. */
export const DRAPE_LIFTS = Object.freeze({
  GROUND: 1, // twin takeover ground: photo drapes just under the twin surface
  WATER: 2,
  MINOR: 2,
  MAJOR: 3,
  RING: 4,
  RIM: 5, // periphery vignette ring (inside the disc, under nothing)
  MASK: 6, // outside-ring cover: hides satellite beneath at any pitch
});

/** Largest drape offset above the photo plane (m). */
export function maxDrapeLift() {
  return Math.max(...Object.values(DRAPE_LIFTS));
}

/** Twin drape height for DEM height h (m) and a DRAPE_LIFTS lift. */
export function drapeY(h, lift) {
  return h * VEX + lift;
}

/** Fraction of R where the periphery fade starts (1 = rim). */
export const RIM_FADE_IN = 0.9;

/* Vignette cover alpha at world radius rr: 0 inside the fade start,
 * smoothstepping to 1 (fully MASK_COL) exactly at R, where the opaque
 * outside mask takes over — one continuous dissolve, no step. */
export function rimFadeAlpha(rr, r = RING_RADIUS_M, fadeIn = RIM_FADE_IN) {
  const inner = r * fadeIn;
  if (!(rr > inner)) return 0;
  if (rr >= r) return 1;
  const u = (rr - inner) / (r - inner);
  return u * u * (3 - 2 * u);
}

/* Tilt compensation for the rim band (owner call: at tilt the near rim
 * read hard while the far rim stayed soft — pixel-measured ~3.5 px near
 * vs ~7 px far at 60° pitch for the same 1 km disc-space band).
 * rimWidthMult scales the disc-space band width by view alignment:
 * sideAlign = +1 on the camera (near) side, -1 far side, tilt = 0 at
 * nadir (no compensation) rising with pitch. Calibrated so near/far meet
 * in the middle: (1+g·t)/(1-g·t) = farPx/nearPx at 60° pitch.
 * The fragment shader in overlays.js buildRimFade evaluates this same
 * expression per pixel (CPU mirror here so node tests pin the numbers). */
export const RIM_TILT_GAIN = 0.67;
export function rimWidthMult(sideAlign, tilt, gain = RIM_TILT_GAIN) {
  return Math.max(1 + gain * tilt * sideAlign, 0.15);
}
