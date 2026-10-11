/* Safepipe Ops3D Ring-2 — src/ring2/drape.js (Phase 4 polish).
 * Superimpose budget + periphery rim-fade math, dependency-free so node
 * tests can pin the numbers (same pattern as takeover.js).
 *
 * SUPERIMPOSE: every twin drape sits at sampleH * VEX + lift while the map
 * photo (MapLibre Terrarium terrain, exaggeration VEX) sits at h * VEX over
 * the same DEM. The lift IS the vertical offset — at oblique pitch it reads
 * as parallax separation between photo and overlay. Nothing in the twin
 * scene writes depth, so paint order alone composites: the lifts only need
 * to break ties, not clear terrain. Budget: twin ground 2 m over the photo
 * (photo drapes just under the twin surface), nothing above 8 m. At 12 km
 * range and 65° pitch the worst shift is 8*sin65 ≈ 7 m — subpixel against
 * zoom-11 ground resolution (~tens of m/px) — while top-down (nadir)
 * parallax is exactly 0, so the mid-range composite is pixel-identical
 * from the top.
 *
 * PERIPHERY: RIM_FADE_IN matches the overlay ring-clip fade start (0.9 R in
 * overlays.js) so the photo vignette, the overlay clip fade, and the rim
 * dissolve all agree on one radius.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-4]
 */
import { VEX, RING_RADIUS_M } from './site.js';

/* Vertical offsets (m) of each twin drape above the shared DEM surface. */
export const DRAPE_LIFTS = Object.freeze({
  GROUND: 2, // twin takeover ground: photo drapes just under the twin surface
  WATER: 3,
  MINOR: 3,
  MAJOR: 4,
  RING: 6,
  RIM: 7, // periphery vignette ring (inside the disc, under nothing)
  MASK: 8, // outside-ring cover: hides satellite beneath at any pitch
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
