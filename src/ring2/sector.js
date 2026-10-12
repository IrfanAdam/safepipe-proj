// src/ring2/sector.js — Phase 03 Tasks 18+19: ?sector=<h3> preselect hook.
// Minimal, dependency-light: resolves the map's sector param against the
// shared feed fixture (same SECTORS/H3_RES the rings derive from) and picks
// the sector's worst asset. Camera/selection wiring lives in main.js.
import { latLngToCell } from 'h3-js';
import { H3_RES, SECTORS, worstHealth, HEALTH_RANK } from '../map/feed.js';

export const SECTOR_PARAM = 'sector';
export const EMBED_PARAM = 'embed';
export const TWIN_CLOSE_MSG = 'safepipe-twin-close';

/** Raw ?sector= / ?embed= values from a search string. */
export function parseSectorQuery(search = '') {
  let sector = null;
  let embed = false;
  try {
    const q = new URLSearchParams(String(search).replace(/^[?]/, ''));
    sector = q.get(SECTOR_PARAM);
    embed = q.get(EMBED_PARAM) === '1';
  } catch { /* no query — standalone boot */ }
  return { sector, embed };
}

/**
 * Resolve a ?sector= value (h3 index preferred, sector id accepted) to
 * { sector, h3, worstAsset }. Null when absent/unmatched — caller boots
 * normally (never breaks standalone loads).
 */
export function resolveSector(key) {
  if (!key) return null;
  let sector = SECTORS.find((s) => s.id === key) ?? null;
  let h3 = null;
  if (!sector) {
    for (const s of SECTORS) {
      let h = null;
      try {
        h = latLngToCell(s.lat, s.lon, H3_RES);
      } catch { /* skip unprojectable sector */ }
      if (h === key) {
        sector = s;
        h3 = h;
        break;
      }
    }
    if (!sector) return null;
  } else {
    try {
      h3 = latLngToCell(sector.lat, sector.lon, H3_RES);
    } catch { /* h3 stays null, id match still valid */ }
  }
  const w = worstHealth(sector.assets);
  const rank = HEALTH_RANK[w] ?? 0;
  const hit = sector.assets.find((a) => (HEALTH_RANK[a.health] ?? 0) === rank);
  return { sector, h3, worstAsset: hit ? hit.id : (sector.assets[0]?.id ?? null), worst: w };
}
