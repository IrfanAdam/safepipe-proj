// src/ring2/sector.js — Phase 03 Tasks 18+19: ?sector=<h3> preselect hook.
// Minimal, dependency-light: resolves the map's sector param against the
// shared feed fixture (same SECTORS/H3_RES the rings derive from) and picks
// the sector's worst asset. Camera/selection wiring lives in main.js.
import { latLngToCell } from 'h3-js';
import { H3_RES, SECTORS, worstHealth, HEALTH_RANK } from '../map/feed.js';
import { geoToWorld } from './site.js';
import { rangeForZoom, MAP_TRUE_FOV_DEG } from './sync.js';

export const SECTOR_PARAM = 'sector';
export const EMBED_PARAM = 'embed';
/* Twinlink handoff frame params (LANE 3): the map overlay opens the twin as
 * ?sector=<h3>&cx=<lng>&cy=<lat>&z=<zoom>[&bearing=<deg>] at vertical
 * top-down. Bearing defaults to 0 (map north-up). */
export const CX_PARAM = 'cx';
export const CY_PARAM = 'cy';
export const ZOOM_PARAM = 'z';
export const BEARING_PARAM = 'bearing';
export const TWIN_CLOSE_MSG = 'safepipe-twin-close';

/* Handoff flight timing (ms): hold a beat top-down, slow ease to the iso
 * terminal view; close plays the exact reverse, slightly quicker. */
export const HANDOFF_HOLD_MS = 900;
export const HANDOFF_SWOOP_MS = 2800;
export const HANDOFF_REVERSE_MS = 1400;
/* Slider drive: overlay opens at full satellite, swoops to full twin. */
export const HANDOFF_START_MIX = 0;
export const HANDOFF_END_MIX = 100;
/* Iso terminal view (matches the sector reframe in main.js). */
export const HANDOFF_ISO_RANGE_M = 4500;
export const HANDOFF_ISO_POLAR_DEG = 50;

/** Raw ?sector= / ?embed= values from a search string. Frame params
 * (cx/cy/z/bearing) ride along when the map overlay opens the twin. */
export function parseSectorQuery(search = '') {
  let sector = null;
  let embed = false;
  let frame = null;
  try {
    const q = new URLSearchParams(String(search).replace(/^[?]/, ''));
    sector = q.get(SECTOR_PARAM);
    embed = q.get(EMBED_PARAM) === '1';
    frame = parseFrameParams(q);
  } catch { /* no query — standalone boot */ }
  return { sector, embed, frame };
}

/** Pure: read handoff frame params from a URLSearchParams (or search
 * string). Returns { cx, cy, z, bearing } with finite numbers, or null
 * when cx/cy/z are absent/invalid. Bearing accepts `bearing` or `b`,
 * default 0 (map north-up). */
export function parseFrameParams(q) {
  try {
    const p = typeof q?.get === 'function' ? q
      : new URLSearchParams(String(q ?? '').replace(/^[?]/, ''));
    const rawCx = p.get(CX_PARAM);
    const rawCy = p.get(CY_PARAM);
    const rawZ = p.get(ZOOM_PARAM);
    if (rawCx === null || rawCy === null || rawZ === null) return null;
    if (rawCx.trim() === '' || rawCy.trim() === '' || rawZ.trim() === '') return null;
    const cx = Number(rawCx);
    const cy = Number(rawCy);
    const z = Number(rawZ);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(z)) return null;
    if (cx < -180 || cx > 180 || cy < -90 || cy > 90) return null;
    if (z < 0 || z > 24) return null;
    const rawB = p.get(BEARING_PARAM) ?? p.get('b');
    let bearing = rawB === null ? 0 : Number(rawB);
    if (!Number.isFinite(bearing)) bearing = 0;
    bearing = ((bearing % 360) + 360) % 360;
    return { cx, cy, z, bearing };
  } catch {
    return null;
  }
}

/** Pure: handoff frame -> twin orbit target { x, z } (world metres). */
export function frameTarget(frame) {
  if (!frame || !Number.isFinite(frame.cx) || !Number.isFinite(frame.cy)) return null;
  try {
    return geoToWorld(frame.cy, frame.cx);
  } catch {
    return null;
  }
}

/** Pure: map zoom -> twin camera range (m) for the handoff footprint.
 * viewportPx/fovDeg must match the twin camera for scale parity. */
export function frameRange(z, { viewportPx = 600, fovDeg = MAP_TRUE_FOV_DEG, lat = null } = {}) {
  if (!Number.isFinite(z)) return null;
  try {
    const vp = Number.isFinite(viewportPx) && viewportPx > 0 ? viewportPx : 600;
    // site.js is the lat source of truth; dynamic import avoided — caller
    // passes cy, fallback is the Sangachal parallel in sync.js default.
    return rangeForZoom(z, Number.isFinite(lat) ? lat : undefined, { viewportPx: vp, fovDeg });
  } catch {
    return null;
  }
}

/** Pure: easeInOutCubic flight easing (0..1 -> 0..1). */
export function easeInOutCubic(t) {
  const x = Math.min(1, Math.max(0, Number(t) ?? 0));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Twin close message with the recede flag (LANE 3): the parent map fades
 * sat->flat + zooms back out on recede:true. Plain object — structured
 * clone safe. */
export function buildTwinCloseMessage(recede = true) {
  return { type: TWIN_CLOSE_MSG, recede: !!recede };
}

/** True for either close payload: the legacy bare string (current parent)
 * or the extended { type, recede } object. */
export function isTwinCloseMessage(data) {
  if (data === TWIN_CLOSE_MSG) return true;
  try {
    return !!data && typeof data === 'object' && data.type === TWIN_CLOSE_MSG;
  } catch {
    return false;
  }
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
