// src/map/twinlink.js — Phase 03 Tasks 18+19: ring click -> twin overlay link.
// Pure helpers (node-checkable, no DOM): sector<->H3 resolution, twin URL,
// ?sector= parse, worst-asset pick. DOM/history wiring lives in main.js.
import { latLngToCell, cellToBoundary } from 'h3-js';
import { H3_RES, HEALTH_RANK, worstHealth } from './feed.js';

export const TWIN_PAGE = './ops3d-ring2.html';
export const SECTOR_PARAM = 'sector';
export const TWIN_CLOSE_MSG = 'safepipe-twin-close';

/** Sectors -> { sectorId: h3index } (H3 derived live, same res as rings). */
export function sectorH3Map(sectors) {
  const out = {};
  for (const s of sectors) out[s.id] = latLngToCell(s.lat, s.lon, H3_RES);
  return out;
}

/** Twin overlay URL for a sector H3 index (embed=1 => posts close msg on Esc).
 * Optional handoff frame {cx,cy,z} (map center lng/lat + zoom at bounds) is
 * appended as &cx=&cy=&z= so the twin opens on the staged view. */
export function twinUrl(h3, frame = null) {
  let url = `${TWIN_PAGE}?sector=${encodeURIComponent(h3)}&embed=1`;
  if (
    frame &&
    Number.isFinite(+frame.cx) &&
    Number.isFinite(+frame.cy) &&
    Number.isFinite(+frame.z)
  ) {
    url +=
      `&cx=${encodeURIComponent(frame.cx)}` +
      `&cy=${encodeURIComponent(frame.cy)}` +
      `&z=${encodeURIComponent(frame.z)}`;
  }
  return url;
}

/** H3 cell -> LngLatBoundsLike [[minLng,minLat],[maxLng,maxLat]] for fitBounds.
 * Pure (throws on invalid index; caller falls back to a direct open). */
export function h3Bounds(h3) {
  const ring = cellToBoundary(h3); // [[lat,lng], ...]
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const pt of ring) {
    const lat = pt[0];
    const lng = pt[1];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** Parse ?sector=<h3-or-id> from a search string. Null when absent. */
export function parseSectorParam(search = '') {
  try {
    const q = new URLSearchParams(String(search).replace(/^[?]/, ''));
    return q.get(SECTOR_PARAM);
  } catch {
    return null;
  }
}

/** Resolve a ?sector= value (h3 index or sector id) to a sector. Null when no match. */
export function findSector(sectors, key) {
  if (!key) return null;
  const direct = sectors.find((s) => s.id === key);
  if (direct) return direct;
  const h3map = sectorH3Map(sectors);
  return sectors.find((s) => h3map[s.id] === key) ?? null;
}

/** Worst-health asset id of a sector (first asset at the worst rank). */
export function worstAssetId(sector) {
  if (!sector || !sector.assets || !sector.assets.length) return null;
  const w = worstHealth(sector.assets);
  const rank = HEALTH_RANK[w] ?? 0;
  const hit = sector.assets.find((a) => (HEALTH_RANK[a.health] ?? 0) === rank);
  return hit ? hit.id : sector.assets[0].id;
}
