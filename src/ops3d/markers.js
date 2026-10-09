/* Safepipe Ops 3D — src/ops3d/markers.js · hatched infrastructure markers.
 * Pure module (no DOM at import, no three.js): one hatch signature per
 * surface infrastructure type — diagonal-line fill inside a chamfered
 * circle/rect. Distinct (shape, angle, spacing) per type so type reads at
 * TOP without color (color stays reserved for health: alarms lead).
 *
 * Reality note: asset positions are schematic/seeded (real geo is Phase-2
 * Overpass work) — markers denote TYPE, not surveyed sites.
 * Contract: HATCH_SIGNATURES, markerForAsset(assetId), chamferPath(ctx,…),
 *   paintHatch(ctx, W, H, sig). Canvas creation stays with the caller so
 *   this module imports cleanly in node tests.
 * [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 */

export const HATCH_SIGNATURES = {
  // Chamfered RECT, 45°, dense — the big built footprint.
  compressor: { shape: 'rect', angle: 45, spacing: 9, label: 'COMPRESSOR' },
  // CIRCLE, 135° (−45°), finest — reads against the compressor at a glance.
  valve: { shape: 'circle', angle: 135, spacing: 6, label: 'VALVE' },
  // Chamfered RECT, 30°, sparse — same family as compressor, looser fill.
  terminal: { shape: 'rect', angle: 30, spacing: 13, label: 'TERMINAL' },
  // CIRCLE, 60°, medium — pads / wellheads / sensor masts.
  wellhead: { shape: 'circle', angle: 60, spacing: 10, label: 'WELLHEAD · SENSOR' },
};

const KNOWN = new Set(Object.keys(HATCH_SIGNATURES));

/* assetId → marker type. Pipelines return null: buried runs stay dashed
 * ground lines by design (no hatch). Unknown ids return null. */
export function markerForAsset(assetId) {
  if (assetId === 'FAC-01') return 'compressor';
  if (assetId === 'FAC-02') return 'valve';
  if (assetId === 'FAC-03') return 'terminal';
  if (typeof assetId === 'string' && assetId.startsWith('SEN-')) return 'wellhead';
  return null;
}

export function isMarkerType(t) {
  return KNOWN.has(t);
}

/* Cyberpunk chamfer path: sharp corners, diagonal cut top-right.
 * Same cut language as labels.js chamferPlate + HUD clip-path boxes. */
export function chamferPath(ctx, x, y, w, h) {
  const cut = Math.min(w, h) * 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

function circlePath(ctx, W, H) {
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, Math.min(W, H) / 2 - 2, 0, Math.PI * 2);
  ctx.closePath();
}

/* Diagonal-line hatch fill clipped to the signature shape.
 * Neutral bone ink on transparent — health color lives on outlines/lamps,
 * never in the hatch, so alarms keep leading. */
export const HATCH_INK = 'rgba(230,232,232,0.9)';
export const HATCH_EDGE = 'rgba(230,232,232,0.95)';
/* World-space hatch pitch: line spacing is derived from the pad's world
 * size (see structures.js hatchMarkerAt) so the signature holds ~5–20
 * lines at every view level — a fixed px spacing would subpixel out at TOP
 * or turn to soup at NEAR. */
export const HATCH_PITCH_WORLD = 0.055; // km between hatch lines

export function paintHatch(ctx, W, H, sig) {
  const { shape, angle, spacing } = sig;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shape === 'circle') circlePath(ctx, W, H);
  else chamferPath(ctx, 2, 2, W - 4, H - 4);
  ctx.clip();
  ctx.strokeStyle = HATCH_INK;
  ctx.lineWidth = Math.max(2.5, spacing / 5); // bold enough to survive TOP downsample at fit zoom
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const nx = -dy, ny = dx;
  const diag = Math.hypot(W, H);
  ctx.beginPath();
  for (let d = -diag; d <= diag; d += spacing) {
    const cx = W / 2 + nx * d, cy = H / 2 + ny * d;
    ctx.moveTo(cx - dx * diag, cy - dy * diag);
    ctx.lineTo(cx + dx * diag, cy + dy * diag);
  }
  ctx.stroke();
  ctx.restore();
  // Edge stroke: the silhouette reads even where hatch lines clip out.
  ctx.strokeStyle = HATCH_EDGE;
  ctx.lineWidth = 3.5;
  if (shape === 'circle') circlePath(ctx, W, H);
  else chamferPath(ctx, 2, 2, W - 4, H - 4);
  ctx.stroke();
}
