// src/map/twinlink.js — Phase 03 Tasks 18+19: ring click -> twin overlay link.
// Pure helpers (node-checkable, no DOM): sector<->H3 resolution, twin URL,
// ?sector= parse, worst-asset pick. DOM/history wiring lives in main.js.
import { latLngToCell } from 'h3-js';
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

/** Twin overlay URL for a sector H3 index (embed=1 => posts close msg on Esc). */
export function twinUrl(h3) {
  return `${TWIN_PAGE}?sector=${encodeURIComponent(h3)}&embed=1`;
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
