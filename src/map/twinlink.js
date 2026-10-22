// src/map/twinlink.js — Phase 03 Tasks 18+19: ring click -> twin overlay link.
// Pure helpers (node-checkable, no DOM): sector<->H3 resolution, twin URL,
// ?sector= parse, worst-asset pick. DOM/history wiring lives in main.js.
import { latLngToCell, cellToBoundary } from 'h3-js';
import { H3_RES, HEALTH_RANK, worstHealth } from './feed.js';

export const TWIN_PAGE = './ops3d-ring2.html';
export const SECTOR_PARAM = 'sector';
export const TWIN_CLOSE_MSG = 'safepipe-twin-close';
// Handoff-3 Lane 1: twin->parent fullscreen protocol. The twin iframe posts
// { type: TWIN_FS_MSG, on: true/false }; the parent fullscreen-toggles the
// #twin-overlay element ITSELF so the CLOSE bar stays visible. Pure.
export const TWIN_FS_MSG = 'safepipe-twin-fullscreen';
// Handoff-4 Lane A / Lane B agreement: the twin posts
// { type: TWIN_READY_MSG } when its top-down satellite frame matches the
// staged map end-frame and is ready to be revealed. Pure.
export const TWIN_READY_MSG = 'safepipe-twin-ready';
// Task-36/37 staged-scroll contract (parent -> twin): the map posts
// { type: TWIN_STAGED_MSG, s, z } as stage scroll S (px past the handoff gate)
// accumulates. z is the map's live zoom at post time (round-8: the twin's
// release anchors must be grant-time fresh — the park ride moves zoom under
// a parked S, so arrival-time anchors stale-date the dissolve). This module
// OWNS the wire string; src/ring2/sector.js imports
// + re-exports it (and derives the S->progress law anchors from the
// scrolltrigger journey laws), so the channel name can never drift between
// the producer and the consumer. Pure.
export const TWIN_STAGED_MSG = 'safepipe-twin-staged';

/** Build the staged-scroll post payload. S parks at >= 0; z rides along
 * when finite, else omitted (the twin falls back to the handed frame). Pure. */
export function buildTwinStagedMessage(s, z) {
  const v = Number(s);
  const msg = { type: TWIN_STAGED_MSG, s: Number.isFinite(v) ? Math.max(0, v) : 0 };
  try {
    const zz = Number(z);
    if (Number.isFinite(zz)) msg.z = zz;
  } catch { /* z is best-effort */ }
  return msg;
}

/** Parse a twin ready message. { ready:true } when matched, else null. */
export function parseTwinReadyMessage(d) {
  try {
    if (!d || typeof d !== 'object' || d.type !== TWIN_READY_MSG) return null;
    return { ready: true };
  } catch {
    return null;
  }
}

// First-painted protocol (twin->parent): the twin posts
// { type: TWIN_PAINTED_MSG } once its render loop has painted PREWARM
// frames — no pose/cam match, so off-site arrivals report too. Mirrors
// src/ring2/sector.js (owner); the node suite pins them equal. Pure.
export const TWIN_PAINTED_MSG = 'safepipe-twin-painted';

/** Parse a twin painted message. { painted:true } when matched, else null. */
export function parseTwinPaintedMessage(d) {
  try {
    if (!d || typeof d !== 'object' || d.type !== TWIN_PAINTED_MSG) return null;
    return { painted: true };
  } catch {
    return null;
  }
}

/** Parse a twin fullscreen message. { on } when matched, else null. */
export function parseTwinFsMessage(d) {
  try {
    if (!d || typeof d !== 'object' || d.type !== TWIN_FS_MSG) return null;
    return { on: !!d.on };
  } catch {
    return null;
  }
}

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
