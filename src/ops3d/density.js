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

/* Local-km → lon/lat at the site (equirectangular, same math as dem.js).
 * Phase 2 Overpass contract: real facility coordinates arrive as lon/lat;
 * geoQuadrant(lon, lat) must agree with quadrantOf(x, z) for every asset
 * once the import lands — this test locks the agreement on the current
 * representative layout so drift shows up immediately. */
export function localToLonLat(x, z, site = { lat: 57.03, lon: -111.68 }) {
  const lon = site.lon + x / (111.32 * Math.cos((site.lat * Math.PI) / 180));
  const lat = site.lat - z / 111.32;
  return [lon, lat];
}

/* Inverse: lon/lat → local km. Round-trips with localToLonLat to <1 m. */
export function lonLatToLocal(lon, lat, site = { lat: 57.03, lon: -111.68 }) {
  const x = (lon - site.lon) * (111.32 * Math.cos((site.lat * Math.PI) / 180));
  const z = (site.lat - lat) * 111.32;
  return [x, z];
}

/* Geographic quadrant: same role split, expressed in lon/lat so Overpass
 * imports land in the right quadrant without touching layout code. North
 * of site = far side (z<0 in local, where +z points south toward the river
 * town); the split parallels quadrantOf exactly. */
export function geoQuadrant(lon, lat, site = { lat: 57.03, lon: -111.68 }) {
  const [x, z] = lonLatToLocal(lon, lat, site);
  return quadrantOf(x, z);
}

/* roleOf(assetId, [x, z]) → { quadrant, role }. Facilities inherit their
 * quadrant role; pipelines are always corridor carriers through it. */
export function roleOf(assetId, at) {
  const [x, z] = at ?? [0, 0];
  const quadrant = quadrantOf(x, z);
  const kind = assetId.startsWith('PIPE-') ? 'transmission corridor' : AUDIT_ROLES[quadrant];
  return { quadrant, role: `${kind} · ${quadrant}` };
}
