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
 * top-down. The frame is the RING bounds (wider than the terminal) at
 * satellite; bearing defaults to 0 (map north-up). Forward flight is
 * three stages: hold top-down at the ring frame, ease to iso at the
 * attached angle (same ring center/range, mix stays 0), then a tiny
 * push-in to the terminal while the slider drives satellite->twin
 * (0->100) — the push-in and the slider move together. Reverse mirrors
 * exactly: pull back to the ring frame + slider->0 + pitch->0, then post
 * the close with {recede:true}. */
export const CX_PARAM = 'cx';
export const CY_PARAM = 'cy';
export const ZOOM_PARAM = 'z';
export const BEARING_PARAM = 'bearing';
export const TWIN_CLOSE_MSG = 'safepipe-twin-close';
/* Handoff-4 Lane B ready (twin->parent): posted ONCE when the top-down
 * satellite start frame matches the staged map end-frame and the first
 * matched sat frame has painted. Lane A reveals the overlay on this
 * (pre-warm hold + ~600 ms crossfade are map-side owned). */
export const TWIN_READY_MSG = 'safepipe-twin-ready';
/* Delegated fullscreen (twin-side): when embedded (?embed=1) the twin
 * FULLSCREEN button must NOT fullscreen its own document (that would hide
 * the parent's CLOSE chrome). It posts { type, on } to the parent instead
 * and syncs its label from the parent's echoed state. Standalone keeps
 * native self-fullscreen. Map-side receipt + fullscreen target are
 * Lane-1 owned — this file only names the wire format. */
export const TWIN_FULLSCREEN_MSG = 'safepipe-twin-fullscreen';

/* Handoff flight timing (ms) — GATE-3 REVISION tempo: the full transition
 * must read as ONE continuous gesture, so holds are short and legs overlap
 * end-to-end with zero end-acceleration easing (see easeInOutSmoother):
 * hold a beat top-down at the ring frame, ease to iso at the attached angle
 * (ring center/range, slider stays 0), then push in to the terminal with the
 * slider driving 0->100. Reverse mirrors exactly: pull back (push reversed)
 * + pitch back (swoop reversed) with the slider ->0, then the {recede:true}
 * close posts. Forward total 3850ms; reverse 3300ms. */
export const HANDOFF_HOLD_MS = 550;
export const HANDOFF_SWOOP_MS = 1700;
export const HANDOFF_PUSH_MS = 1600;
/* Reverse is the exact two-segment mirror: pull (PUSH_MS) then pitch-back
 * (SWOOP_MS). Single source of truth for the total so the flight and any
 * probe margin agree. */
export const HANDOFF_REVERSE_MS = HANDOFF_PUSH_MS + HANDOFF_SWOOP_MS;
/* Slider drive: overlay opens at full satellite, swoops to full twin. */
export const HANDOFF_START_MIX = 0;
export const HANDOFF_END_MIX = 100;
/* Iso terminal view (matches the sector reframe in main.js): two zoom levels
 * out from the old 4500 m stance — ~12 km footprint holds the ~3 km facility
 * + margin in frame at the same iso angle. Slider still drives to 100. */
export const HANDOFF_ISO_RANGE_M = 18000;
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

/** Pure: easeInOutCubic flight easing (0..1 -> 0..1). Kept as the static
 * contract — existing callers/tests import this name. */
export function easeInOutCubic(t) {
  const x = Math.min(1, Math.max(0, Number(t) ?? 0));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Pure: quintic smootherstep easing (0..1 -> 0..1) — GATE-3 REVISION tempo
 * curve for the handoff flight legs (swoop/push/reverse). Zero velocity AND
 * zero acceleration at both ends, so consecutive legs join with no staged
 * lurch — the three stages read as one continuous gesture. Same signature
 * and clamping contract as easeInOutCubic. Node-checkable. */
export function easeInOutSmoother(t) {
  const x = Math.min(1, Math.max(0, Number(t) ?? 0));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Twin ready message (LANE 4 Lane B -> Lane A): the matched sat frame has
 * painted and the staged inbound may be revealed. Plain object —
 * structured-clone safe. */
export function buildTwinReadyMessage() {
  return { type: TWIN_READY_MSG };
}

/** True for the twin ready payload { type:'safepipe-twin-ready' }. Never
 * matches the close or fullscreen shapes. */
export function isTwinReadyMessage(data) {
  try {
    return !!data && typeof data === 'object' && data.type === TWIN_READY_MSG;
  } catch {
    return false;
  }
}

/* Ready settle depth (Lane B): the hold posts {type:'safepipe-twin-ready'}
 * only after this many CONSECUTIVE frames agree the live twin camera sits
 * on the requested hold frame (twin pose + map pose both matched). A single
 * agreeing frame withholds — the check re-runs every hold frame and the
 * counter resets on any mismatch, so the post lands exactly when the pose
 * has settled, never on a transient pin. Node-checkable. */
export const READY_SETTLE_FRAMES = 2;

/** Pure: live twin pose { eye:{x,y,z}, target:{x,y,z} } agrees with the
 * pinned hold start { tx, ty, tz, range, bearing } (top-down at the ring
 * frame). Tolerances scale with range and mirror the map-side gates
 * (0.5° pitch/bearing): target within 0.2% of range, range within 1%,
 * pitch ~0, bearing ~start bearing. False on any non-finite input —
 * withhold, never guess. Node-checkable. */
export function twinHoldPoseMatch(pose, start, tol = {}) {
  try {
    const eye = pose?.eye;
    const tgt = pose?.target;
    if (!eye || !tgt) return false;
    const range = Number(start?.range);
    if (!Number.isFinite(range) || range <= 0) return false;
    if (![eye.x, eye.y, eye.z, tgt.x, tgt.z, start.tx, start.tz].every(Number.isFinite)) return false;
    const ty = Number.isFinite(tgt.y) ? tgt.y : start.ty;
    if (!Number.isFinite(ty)) return false;
    const posTol = Number.isFinite(tol.posM) && tol.posM >= 0 ? tol.posM : Math.max(0.5, range * 0.002);
    if (Math.abs(tgt.x - start.tx) > posTol) return false;
    if (Math.abs(tgt.z - start.tz) > posTol) return false;
    const liveRange = Math.hypot(eye.x - tgt.x, eye.y - ty, eye.z - tgt.z);
    if (!Number.isFinite(liveRange)) return false;
    const rngTol = Number.isFinite(tol.rangeM) && tol.rangeM >= 0 ? tol.rangeM : range * 0.01;
    if (Math.abs(liveRange - range) > rngTol) return false;
    const h = Math.hypot(eye.x - tgt.x, eye.z - tgt.z);
    const v = eye.y - ty;
    if (!(v > 0)) return false;
    const pitchTol = Number.isFinite(tol.pitchDeg) ? tol.pitchDeg : 0.5;
    if ((Math.atan2(h, v) * 180) / Math.PI > pitchTol) return false;
    const want = ((Number(start.bearing) || 0) % 360 + 360) % 360;
    const got = ((Math.atan2(-(eye.x - tgt.x), eye.z - tgt.z) * 180) / Math.PI + 360) % 360;
    const bearingTol = Number.isFinite(tol.bearingDeg) ? tol.bearingDeg : 0.5;
    const d = Math.abs((((got - want + 540) % 360) + 360) % 360 - 180);
    if (d > bearingTol) return false;
    return true;
  } catch {
    return false;
  }
}

/** Pure: close-time flight phase -> reverse plan through the stages actually
 * passed (never a jump to a canned start).
 *   hold  -> 'snap'  (still top-down at the ring frame: pin + mix 0, post)
 *   swoop -> 'pitch' (midway to iso: current pose -> ring top-down, mix ->0)
 *   push/done/idle -> 'full' (terminal-side: pull to ring iso with mix ->0,
 *     then pitch-back to ring top-down). Node-checkable. */
export function reversePlanForPhase(phase) {
  const p = String(phase ?? '').toLowerCase();
  if (p === 'hold') return 'snap';
  if (p === 'swoop') return 'pitch';
  return 'full';
}

/** Twin close message with the recede flag (LANE 3): the parent map fades
 * sat->flat + zooms back out on recede:true. Plain object — structured
 * clone safe. */
export function buildTwinCloseMessage(recede = true) {
  return { type: TWIN_CLOSE_MSG, recede: !!recede };
}

/** Delegated-fullscreen request posted to the parent when embedded:
 * { type:'safepipe-twin-fullscreen', on:true/false }. Plain object —
 * structured-clone safe. The parent owns the fullscreen target and echoes
 * the same shape back so the twin can sync its label. */
export function buildTwinFullscreenMessage(on = true) {
  return { type: TWIN_FULLSCREEN_MSG, on: !!on };
}

/** True for the delegated-fullscreen object form (request or parent echo).
 * Never matches the legacy bare close string. */
export function isTwinFullscreenMessage(data) {
  try {
    return !!data && typeof data === 'object' && data.type === TWIN_FULLSCREEN_MSG;
  } catch {
    return false;
  }
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
