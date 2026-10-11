/* Safepipe Ops3D Ring-2 — src/ring2/takeover.js (Phase 4, Issue 2).
 * True-endpoint crossfade math. The slider fades overlay emphasis over a
 * live satellite base through the mid-range; only at the very top does the
 * twin take over: an opaque twin ground ramps in over mix 98->100 and the
 * satellite ground hides exactly at 100 (same condition both sides, so a
 * black hole is impossible). Mix <= 98 is pixel-identical to the old
 * overlay-strength composite.
 * Dependency-free so node tests can pin the thresholds.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-4]
 */

/** Twin-ground ramp starts here (below: pure overlay composite, as before). */
export const TAKEOVER_START = 98;
/** Full takeover here: twin ground opaque AND satellite ground hidden. */
export const TAKEOVER_FULL = 100;

function clampMixNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/* 0 below TAKEOVER_START, ramps to 1 at TAKEOVER_FULL. Drives the twin
 * ground mesh opacity (overlays/mix.js feed it straight to the twin). */
export function takeoverU(mix) {
  const m = clampMixNum(mix);
  if (m <= TAKEOVER_START) return 0;
  if (m >= TAKEOVER_FULL) return 1;
  return (m - TAKEOVER_START) / (TAKEOVER_FULL - TAKEOVER_START);
}

/* Satellite ground (imagery, backup, hillshade, reference) hides only at
 * full takeover — the same step the twin ground reaches opaque. */
export function groundHidden(mix) {
  return clampMixNum(mix) >= TAKEOVER_FULL;
}
