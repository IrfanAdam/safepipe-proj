/* Safepipe Ops 3D — src/ops3d/density.js · audit density-grammar roles (Phase 1, Task 9).
 * Seed positions stay RNG until the Phase 2 Overpass import; this layer tags
 * every asset with its audit quadrant role so the spot map reads correctly
 * now and the real import has a role contract to fill later.
 * Quadrants over the 44 km extent (R_MAP 20): NW = mine benches, CENTER =
 * tailings complex, SE = SAGD pads on DLS lines, else transmission corridor.
 * [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 */

export const AUDIT_ROLES = Object.freeze({
  NW: 'mine benches (NW)',
  CENTER: 'tailings complex (center)',
  SE: 'SAGD pads (SE)',
  NE: 'transmission corridor (NE)',
  SW: 'transmission corridor (SW)',
});

export function quadrantOf(x, z) {
  const c = Math.hypot(x, z) < 7;
  if (c) return 'CENTER';
  if (x < 0 && z > 0) return 'NW';
  if (x > 0 && z < 0) return 'SE';
  if (x > 0 && z > 0) return 'NE';
  return 'SW';
}

/* roleOf(assetId, [x, z]) → { quadrant, role }. Facilities inherit their
 * quadrant role; pipelines are always corridor carriers through it. */
export function roleOf(assetId, at) {
  const [x, z] = at ?? [0, 0];
  const quadrant = quadrantOf(x, z);
  const kind = assetId.startsWith('PIPE-') ? 'transmission corridor' : AUDIT_ROLES[quadrant];
  return { quadrant, role: `${kind} · ${quadrant}` };
}
