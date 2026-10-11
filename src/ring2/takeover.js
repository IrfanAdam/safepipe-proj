/* Safepipe Ops3D Ring-2 — src/ring2/takeover.js (Phase 4, Issue 2).
 * True-endpoint crossfade math. The slider fades overlay emphasis over a
 * live satellite base through the low/mid-range; across the base band
 * (TAKEOVER_START->TAKEOVER_FULL) the twin ground ramps in AND the
 * satellite base fades out over the SAME steps, so the base swap reads as
 * a smooth dissolve instead of a 2-step jump. At exactly TAKEOVER_FULL the
 * twin ground is opaque and the satellite hides (same condition both
 * sides, so a black hole is impossible).
 * Dependency-free so node tests can pin the thresholds.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
 */

/** Base crossfade band starts here (below: pure overlay composite, as before). */
export const TAKEOVER_START = 62;
/** Full takeover here: twin ground opaque AND satellite ground hidden. */
export const TAKEOVER_FULL = 100;

function clampMixNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/* Smoothstep ramp: 0 at/below TAKEOVER_START, 1 at/above TAKEOVER_FULL.
 * u = t^2*(3-2t) with t the band fraction — zero slope at both ends, so
 * neither the satellite-side fade nor the twin-ground ramp starts or lands
 * with a visible step. Max per-step delta is 1.5/bandWidth ≈ 0.039, far
 * below any perceivable jump. Drives the twin ground mesh opacity
 * (overlays/mix.js feed it straight to the twin). */
export function takeoverU(mix) {
  const m = clampMixNum(mix);
  if (m <= TAKEOVER_START) return 0;
  if (m >= TAKEOVER_FULL) return 1;
  const t = (m - TAKEOVER_START) / (TAKEOVER_FULL - TAKEOVER_START);
  return t * t * (3 - 2 * t);
}

/* Satellite-base visibility factor across the SAME band: 1 below
 * TAKEOVER_START, 0 at TAKEOVER_FULL. mapbase.setGroundFade(v) turns this
 * into raster-opacity / hillshade-exaggeration paint, so the photo base
 * dissolves out exactly as fast as the twin ground dissolves in. */
export function satBaseV(mix) {
  return 1 - takeoverU(mix);
}

/* Satellite ground layers hide only at full takeover — the same step the
 * twin ground reaches opaque. Mid-band they stay layout-visible at fading
 * paint opacity (never a black hole). */
export function groundHidden(mix) {
  return clampMixNum(mix) >= TAKEOVER_FULL;
}
