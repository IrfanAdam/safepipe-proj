// src/ring2/sector.js — Phase 03 Tasks 18+19: ?sector=<h3> preselect hook.
// Minimal, dependency-light: resolves the map's sector param against the
// shared feed fixture (same SECTORS/H3_RES the rings derive from) and picks
// the sector's worst asset. Camera/selection wiring lives in main.js.
import { latLngToCell } from 'h3-js';
import { H3_RES, SECTORS, worstHealth, HEALTH_RANK } from '../map/feed.js';
import { geoToWorld } from './site.js';
import { rangeForZoom, MAP_TRUE_FOV_DEG, TWIN_MIN_RANGE_M, TWIN_MAX_RANGE_M } from './sync.js';
/* Wire strings: twinlink.js is the single source (map-side link module);
 * re-exported here under the twin-side names so the iframe boundary can
 * never name two channels. S-band anchors + iso pole derive from the
 * scrolltrigger journey laws for the same reason. */
import {
  SECTOR_PARAM as MAP_SECTOR_PARAM,
  TWIN_CLOSE_MSG as MAP_TWIN_CLOSE_MSG,
  TWIN_READY_MSG as MAP_TWIN_READY_MSG,
  TWIN_PAINTED_MSG as MAP_TWIN_PAINTED_MSG,
  TWIN_STAGED_MSG as MAP_TWIN_STAGED_MSG,
  TWIN_FS_MSG as MAP_TWIN_FS_MSG,
} from '../map/twinlink.js';
import { HANDOFF_STAGE_PX, HANDOFF_STAGED_S_MAX, ISO_PITCH_DEG } from '../map/scrolltrigger.js';

export const SECTOR_PARAM = MAP_SECTOR_PARAM;
export const EMBED_PARAM = 'embed';
/* Twinlink handoff frame params (LANE 3): the map overlay opens the twin as
 * ?sector=<h3>&cx=<lng>&cy=<lat>&z=<zoom>[&bearing=<deg>] at vertical
 * top-down. GATE-3 NATIVE-ZOOM (handoff12): the map drives the journey off
 * its NATIVE zoom and hands the twin its ACTUAL current view at the
 * deep-zoom checkpoint (same contract as the click path) — cx/cy/z may sit
 * anywhere in the legal range, never at a fixed hold pose. The twin accepts
 * the handed frame as the hold footprint and eases from it (hold top-down
 * at the handed range, swoop to iso at the same center/range, push in to
 * the terminal); it never snaps the camera to a canned pose on entry. */
export const CX_PARAM = 'cx';
export const CY_PARAM = 'cy';
export const ZOOM_PARAM = 'z';
export const BEARING_PARAM = 'bearing';
export const TWIN_CLOSE_MSG = MAP_TWIN_CLOSE_MSG;
/* Handoff-4 Lane B ready (twin->parent): posted ONCE when the top-down
 * satellite start frame matches the staged map end-frame and the first
 * matched sat frame has painted. Lane A reveals the overlay on this
 * (pre-warm hold + ~600 ms crossfade are map-side owned). */
export const TWIN_READY_MSG = MAP_TWIN_READY_MSG;
/* Delegated fullscreen (twin-side): when embedded (?embed=1) the twin
 * FULLSCREEN button must NOT fullscreen its own document (that would hide
 * the parent's CLOSE chrome). It posts { type, on } to the parent instead
 * and syncs its label from the parent's echoed state. Standalone keeps
 * native self-fullscreen. Map-side receipt + fullscreen target are
 * Lane-1 owned — the wire string is twinlink.js single source (re-exported
 * here). */
export const TWIN_FULLSCREEN_MSG = MAP_TWIN_FS_MSG;

/* Handoff flight timing (ms) — GATE-3 NATIVE-ZOOM tempo (handoff12-B): the
 * full transition must read as ONE slow continuous gesture, so holds are
 * long enough to register top-down and legs overlap end-to-end with zero
 * end-acceleration easing (see easeInOutSmoother): hold a beat top-down at
 * the handed ring frame, slow-ease to iso at the attached angle (ring
 * center/range, slider stays 0), then slow-push in to the terminal with the
 * slider driving 0->100. Reverse mirrors exactly: pull back (push reversed)
 * + pitch back (swoop reversed) with the slider ->0, then the {recede:true}
 * close posts. Forward total 5900ms; reverse 5000ms. */
export const HANDOFF_HOLD_MS = 900;
export const HANDOFF_SWOOP_MS = 2600;
export const HANDOFF_PUSH_MS = 2400;
/* Reverse is the exact two-segment mirror: pull (PUSH_MS) then pitch-back
 * (SWOOP_MS). Single source of truth for the total so the flight and any
 * probe margin agree. */
export const HANDOFF_REVERSE_MS = HANDOFF_PUSH_MS + HANDOFF_SWOOP_MS;
/* Slider drive: overlay opens at full satellite, swoops to full twin. */
export const HANDOFF_START_MIX = 0;
export const HANDOFF_END_MIX = 100;
/* Iso terminal view (matches the sector reframe in main.js): two zoom levels
 * out from the old 4500 m stance — ~12 km footprint holds the ~3 km facility
 * + margin in frame at the same iso angle. Slider still drives to 100.
 * Task-35 angle coincidence: the map-side iso scrub holds pitch at
 * ISO_PITCH_DEG through the handoff cut and carries it (nothing on the
 * forward path resets pitch to 0), so the twin's swoop/terminal iso lands
 * exactly on the map's held tilt under the shared 36.87deg FOV
 * (MAP_TRUE_FOV_DEG, sync.js single source) — the old 5deg snap is gone.
 * Derived from ISO_PITCH_DEG (scrolltrigger.js single source), so the
 * cut meets with no snap by construction, not by matching literals.
 * The twin hold itself still pins top-down; Task 36 scrubs the intro so the
 * cut dissolves end-to-end. Decision recorded: carry-45-through + meet at
 * the shared pole (this constant), not flatten-to-0. */
export const HANDOFF_ISO_RANGE_M = 18000;
export const HANDOFF_ISO_POLAR_DEG = ISO_PITCH_DEG;

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

/** Pure: clamp a handoff range into the shared orbit rails
 * ([TWIN_MIN_RANGE_M, TWIN_MAX_RANGE_M], sync.js single source of truth).
 * Non-finite/non-positive input returns null (caller falls back, never a
 * canned pose). Node-checkable. */
export function clampHandoffRange(r) {
  try {
    const v = Number(r);
    if (!Number.isFinite(v) || !(v > 0)) return null;
    return Math.min(TWIN_MAX_RANGE_M, Math.max(TWIN_MIN_RANGE_M, v));
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

/** Twin first-painted message (twin->parent): posted ONCE when the render
 * loop has painted AND the map is tile-idle (or the wall-clock cap hits) —
 * no pose/cam match required, so it fires for off-site arrivals whose
 * ready-match can never agree. It never reveals directly (ready owns the
 * reveal); it arms the map-side fallback to reveal on paint instead of
 * blind, so an open sequence never shows an opaque frame before the twin's
 * first paint. Plain object — structured-clone safe. */
export const TWIN_PAINTED_MSG = MAP_TWIN_PAINTED_MSG;
export function buildTwinPaintedMessage() {
  return { type: TWIN_PAINTED_MSG };
}

/** Wall-clock backstop for first paint: tile streams must never strand the
 * signal (a slow network is not a dead twin). */
export const TWIN_PAINT_MAX_MS = 8000;
/** Pure: first paint is due once PREWARM frames ran AND the scene is live
 * (map tile-idle + terrain draped), or once the wall cap hits regardless.
 * False below PREWARM frames or on any non-finite input — withhold, never
 * guess. Node-checkable. */
export function firstPaintDue({ frames = 0, mapIdle = false, sceneLive = false, elapsedMs = 0 } = {}) {
  try {
    const f = Number(frames);
    if (!Number.isFinite(f) || f < HANDOFF_PREWARM_MIN_FRAMES) return false;
    if (mapIdle === true && sceneLive === true) return true;
    const ms = Number(elapsedMs);
    return Number.isFinite(ms) && ms >= TWIN_PAINT_MAX_MS;
  } catch {
    return false;
  }
}

/** True for the twin painted payload { type:'safepipe-twin-painted' }. Never
 * matches the ready, close or fullscreen shapes. */
export function isTwinPaintedMessage(data) {
  try {
    return !!data && typeof data === 'object' && data.type === TWIN_PAINTED_MSG;
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

/* GATE-3 SCROLL-SCRUB, twin side — wheel-delta-to-progress convention.
 * No map-side handoff9-A scrub report exists in scratch, so this defines the
 * shared convention (map-side handoff8-B fires one transition per 120px
 * accumulated wheel; this matches that notch): one 120px outward wheel notch
 * advances the reverse journey by 120/TWIN_SCRUB_WHEEL_PX, i.e. the full
 * terminal-iso -> ring-top-down journey (push + swoop legs) takes
 * TWIN_SCRUB_WHEEL_PX px of accumulated outward wheel (~5 notches).
 * Outward (reverse intent) = wheel-UP (deltaY < 0) — the same sign the
 * map-side scroll trigger treats as close/reverse, so the gesture reads
 * symmetric flying in and out. Pinch wheels (ctrlKey/metaKey) never count
 * (they stay with OrbitControls pinch-zoom). Inward wheels (deltaY > 0)
 * subtract — symmetric scrub back toward the terminal. All pure +
 * node-checkable. */
export const TWIN_SCRUB_WHEEL_PX = 600;
/* A decisive wheel AT the zoom clamp crosses into scrub-reverse (trackpad
 * dust below this is ignored so resting fingers at max don't trip it). */
export const TWIN_SCRUB_ENTER_DELTA = 40;
/* Dwell fallback is RETIRED (Task 37): the zoom-clamp rest was a
 * frame-counter entry (~0.2 s parked at max auto-enters scrub-reverse with
 * no gesture). Entry is gesture-owned now — a decisive outward wheel AT the
 * clamp (TWIN_SCRUB_ENTER_DELTA, single shot) or ACCUMULATED outward
 * wheel/pinch delta at the clamp (TWIN_SCRUB_PINCH_ENTER_PX, covering
 * pinch-outs and trackpad dust that never trip the single shot — pinch
 * itself stays native, its delta only feeds the entry accumulator) — or an
 * explicit close (Esc / parent-X / close message drives the scrub to 1).
 * A range strictly PAST the cap still clamps back + exits on the same
 * frame (a rail guard, never a parking spot). */
export const TWIN_SCRUB_PINCH_ENTER_PX = 240;
/* Range within this fraction of the max clamp counts as at-max (damping
 * hover just under the rail still reads as the limit). */
export const TWIN_MAXZOOM_TOL_FRAC = 0.01;

/** Pure: camera range at the zoom-out clamp? False on non-finite input. */
export function isAtMaxZoom(range, max = TWIN_MAX_RANGE_M, tolFrac = TWIN_MAXZOOM_TOL_FRAC) {
  try {
    const r = Number(range);
    const m = Number(max);
    let tol = Number(tolFrac);
    if (!Number.isFinite(r) || !Number.isFinite(m) || !(m > 0) || r < 0) return false;
    if (!Number.isFinite(tol) || tol < 0) tol = TWIN_MAXZOOM_TOL_FRAC;
    return r >= m * (1 - tol);
  } catch {
    return false;
  }
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) ?? 0));

/** Pure: fold one wheel event's deltaY into scrub progress (0..1).
 * progress = current journey position (0 terminal-side, 1 ring top-down).
 * Pinch (opts.pinch) returns progress unchanged. Non-finite deltaY returns
 * progress unchanged (clamped). Never throws. */
export function scrubProgressForWheel(progress, deltaY, { pinch = false, totalPx = TWIN_SCRUB_WHEEL_PX } = {}) {
  try {
    const p = clamp01(progress);
    if (pinch) return p;
    const d = Number(deltaY);
    if (!Number.isFinite(d) || d === 0) return p;
    let total = Number(totalPx);
    if (!Number.isFinite(total) || !(total > 0)) total = TWIN_SCRUB_WHEEL_PX;
    // Wheel-up (dY<0) = outward/reverse intent: advance. Wheel-down: retreat.
    return clamp01(p + -d / total);
  } catch {
    return clamp01(progress);
  }
}

/** Pure: fold one outward-delta event into the scrub-reverse ENTRY
 * accumulator (Task 37, dwell-counter replacement). Outward intent is
 * wheel-up (dY<0) — the same sign scrubProgressForWheel advances on — so
 * pinch-outs (which stay native and never touch progress) and sub-threshold
 * trackpad dust still count toward crossing in; inward deltas drain. Returns
 * { accum, enter }: enter when the accumulator reaches the threshold.
 * Non-finite input parks (never throws, never enters). */
export function scrubEntryForDelta(accum, deltaY, { enterPx = TWIN_SCRUB_PINCH_ENTER_PX } = {}) {
  try {
    let a = Number(accum);
    if (!Number.isFinite(a) || a < 0) a = 0;
    const d = Number(deltaY);
    if (!Number.isFinite(d) || d === 0) return { accum: a, enter: false };
    let th = Number(enterPx);
    if (!Number.isFinite(th) || !(th > 0)) th = TWIN_SCRUB_PINCH_ENTER_PX;
    a = Math.max(0, a + -d);
    return { accum: a, enter: a >= th };
  } catch {
    return { accum: 0, enter: false };
  }
}

/** Pure: total ms across close-time walk legs (their time weights). 0 when
 * no leg carries a positive ms — callers then treat the walk as a snap. */
export function scrubTotalMs(legs) {
  try {
    if (!Array.isArray(legs)) return 0;
    let total = 0;
    for (const l of legs) {
      const ms = Number(l?.ms);
      if (Number.isFinite(ms) && ms > 0) total += ms;
    }
    return total;
  } catch {
    return 0;
  }
}

/** Pure: journey progress 0..1 -> interpolated { eye, target, mix } across
 * the close-time walk legs, each leg weighted by its forward ms (same
 * smootherstep curve as the timed engine, so scrub and timed renders agree
 * pose-for-pose). progress 0 = walk start (live close pose), 1 = ring
 * top-down. Null on empty/invalid legs — caller pins + posts. */
export function poseForScrubProgress(legs, progress) {
  try {
    if (!Array.isArray(legs) || !legs.length) return null;
    const p = clamp01(progress);
    const total = scrubTotalMs(legs);
    const first = legs[0];
    const last = legs[legs.length - 1];
    if (!(total > 0)) {
      if (!last?.eye || !last?.target) return null;
      return { eye: { ...last.eye }, target: { ...last.target }, mix: last.mix, legIndex: legs.length - 1, t: 1 };
    }
    const startPose = (leg) => ({
      eye: { ...((leg?.from?.eye) ?? leg?.eye) },
      target: { ...((leg?.from?.target) ?? leg?.target) },
      mix: Number.isFinite(leg?.fromMix) ? leg.fromMix : HANDOFF_START_MIX,
    });
    if (p <= 0) {
      if (!first?.eye || !first?.target) return null;
      const s = startPose(first);
      return { ...s, legIndex: 0, t: 0 };
    }
    if (p >= 1) {
      if (!last?.eye || !last?.target) return null;
      return { eye: { ...last.eye }, target: { ...last.target }, mix: last.mix, legIndex: legs.length - 1, t: 1 };
    }
    let acc = 0;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const ms = Number(leg?.ms);
      const w = Number.isFinite(ms) && ms > 0 ? ms / total : 0;
      if (p <= acc + w || i === legs.length - 1) {
        if (!leg?.eye || !leg?.target) return null;
        const t = w > 0 ? clamp01((p - acc) / w) : 1;
        const k = easeInOutSmoother(t);
        const fe = leg.from?.eye ?? leg.eye;
        const ft = leg.from?.target ?? leg.target;
        const fm = Number.isFinite(leg.fromMix) ? leg.fromMix : HANDOFF_START_MIX;
        const lerp = (a, b, kk) => a + (b - a) * kk;
        return {
          eye: { x: lerp(fe.x, leg.eye.x, k), y: lerp(fe.y, leg.eye.y, k), z: lerp(fe.z, leg.eye.z, k) },
          target: { x: lerp(ft.x, leg.target.x, k), y: lerp(ft.y, leg.target.y, k), z: lerp(ft.z, leg.target.z, k) },
          mix: lerp(fm, leg.mix, k),
          legIndex: i,
          t,
        };
      }
      acc += w;
    }
    return null;
  } catch {
    return null;
  }
}

/** Pure: estimate current journey progress from timed-engine state (for
 * wheel takeover of a running timed reverse with no pose jump): completed
 * legs + elapsed fraction of the live leg, over total ms. */
export function scrubProgressForWalk(legs, i, legT0, now) {
  try {
    if (!Array.isArray(legs) || !legs.length) return 0;
    const total = scrubTotalMs(legs);
    if (!(total > 0)) return 0;
    const idx = Math.min(Math.max(0, Number(i) | 0), legs.length);
    let done = 0;
    for (let k = 0; k < idx; k++) {
      const ms = Number(legs[k]?.ms);
      if (Number.isFinite(ms) && ms > 0) done += ms;
    }
    if (idx < legs.length) {
      const ms = Number(legs[idx]?.ms);
      if (Number.isFinite(ms) && ms > 0) {
        const el = clamp01((Number(now) - Number(legT0)) / ms);
        done += ms * el;
      }
    }
    return clamp01(done / total);
  } catch {
    return 0;
  }
}

/* GATE-3 INTRO SCRUB (Task 36, twin side) — the forward flight (hold ->
 * swoop -> push) as a pure function of ONE 0..1 progress, never wall
 * clocks. The HANDOFF_*_MS constants survive only as leg WEIGHTS (same
 * smootherstep curve as the timed engine, so scrub and timed renders agree
 * pose-for-pose); the pose law is poseForScrubProgress over the legs built
 * by buildForwardLegs. An autoplay clock may advance the scalar until the
 * staged driver arrives — the mapping stays pure either way, so scroll
 * ticks can take over with no pose jump. */
export const TWIN_STAGED_MSG = MAP_TWIN_STAGED_MSG;
/* Map-side staged-scroll contract anchors (scrolltrigger.js owns the
 * values — derived below, never restated): S px past the handoff gate over
 * [0,STAGE,2xSTAGE,3xSTAGE,STAGED_MAX] = ring/blend/tilt/reveal, overlay
 * opacity = ready ? reveal(S) : 0. The twin intro consumes S through
 * fwdProgressForStagedS: the swoop completes exactly where the reveal
 * dissolve starts (3xSTAGE), the push completes where the dissolve completes
 * (STAGED_MAX) — the cut dissolves onto a settled iso frame. */
export const TWIN_FWD_REVEAL_START_PX = 3 * HANDOFF_STAGE_PX;
export const TWIN_FWD_STAGED_MAX_PX = HANDOFF_STAGED_S_MAX;

/** True for the parent->twin staged-scroll shape { type, s } (S px past
 * the gate). The scroll value itself is validated at the consumer — this
 * only names the wire format. Never matches close/fullscreen/ready. */
export function isTwinStagedMessage(data) {
  try {
    return !!data && typeof data === 'object' && data.type === TWIN_STAGED_MSG;
  } catch {
    return false;
  }
}

/** Pure: staged scroll S (px) -> forward intro progress 0..1. Piecewise
 * linear: [0,revealStart] eases the swoop leg 0->swoopW, [revealStart,max]
 * the push leg swoopW->1 (the leg easing itself supplies the curve, so the
 * map stays linear and double-easing never drags). Parks at 0/1 outside.
 * Non-finite S parks at 0. Never throws. */
export function fwdProgressForStagedS(
  s,
  { revealStartPx = TWIN_FWD_REVEAL_START_PX, stagedMaxPx = TWIN_FWD_STAGED_MAX_PX, swoopW = null } = {},
) {
  try {
    const v = Number(s);
    if (!Number.isFinite(v) || v <= 0) return 0;
    let rs = Number(revealStartPx);
    let mx = Number(stagedMaxPx);
    if (!Number.isFinite(rs) || rs <= 0) rs = TWIN_FWD_REVEAL_START_PX;
    if (!Number.isFinite(mx) || mx <= rs) mx = TWIN_FWD_STAGED_MAX_PX;
    let w = swoopW === null || swoopW === undefined ? NaN : Number(swoopW);
    if (!Number.isFinite(w) || w <= 0 || w >= 1) {
      const total = HANDOFF_SWOOP_MS + HANDOFF_PUSH_MS;
      w = total > 0 ? HANDOFF_SWOOP_MS / total : 0.5;
    }
    if (v >= mx) return 1;
    if (v >= rs) return w + ((v - rs) / (mx - rs)) * (1 - w);
    return (v / rs) * w;
  } catch {
    return 0;
  }
}

/** Pure: build the forward intro legs for poseForScrubProgress from the
 * live anchors. startPose = { eye, target } top-down at the ring frame
 * (main.js startEye); mid = ring-frame iso (swoop end / push start); to =
 * terminal iso. Mix rides 0 through the swoop, 0->100 through the push.
 * Null on any missing anchor — caller ends the flight, never a canned
 * pose. Node-checkable. */
export function buildForwardLegs({ startPose, mid, to } = {}) {
  try {
    const se = startPose?.eye;
    const st = startPose?.target;
    const me = mid?.eye;
    const mt = mid?.target;
    const te = to?.eye;
    const tt = to?.target;
    if (!se || !st || !me || !mt || !te || !tt) return null;
    for (const v of [se.x, se.y, se.z, st.x, st.y, st.z, me.x, me.y, me.z, mt.x, mt.y, mt.z, te.x, te.y, te.z]) {
      if (!Number.isFinite(v)) return null;
    }
    const endMix = Number.isFinite(to.mix) ? to.mix : HANDOFF_END_MIX;
    return [
      {
        name: 'swoop',
        eye: { ...me },
        target: { ...mt },
        mix: HANDOFF_START_MIX,
        ms: HANDOFF_SWOOP_MS,
        from: { eye: { ...se }, target: { ...st } },
        fromMix: HANDOFF_START_MIX,
      },
      {
        name: 'push',
        eye: { ...te },
        target: { ...tt },
        mix: endMix,
        ms: HANDOFF_PUSH_MS,
        from: { eye: { ...me }, target: { ...mt } },
        fromMix: HANDOFF_START_MIX,
      },
    ];
  } catch {
    return null;
  }
}

/** Pure: forward intro progress 0..1 -> ring reveal 0..1 on the SAME legs
 * and progress the camera law reads, so stroke and pose agree exactly:
 * easing across the swoop leg, settled at 1 through the push. Null on
 * invalid legs — caller falls back to the normal mix law. */
export function forwardRingPForProgress(legs, progress) {
  try {
    const s = poseForScrubProgress(legs, progress);
    if (!s) return null;
    if ((s.legIndex ?? 0) <= 0) return easeInOutSmoother(s.t ?? 0);
    return 1;
  } catch {
    return null;
  }
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

/* GATE-3 GESTURE REVISION, TWIN SIDE (defects 4-6) — pure, node-checkable. */

/* (4) TONE CONTINUITY: twin-ground light multiplier keyed to the mix band.
 * The satellite photo (mapbase setGroundFade) dissolves out exactly as the
 * Lambert twin ground dissolves in (takeoverU/satBaseV share one smoothstep),
 * but the two bases have different native tones: full-lit Lambert over the
 * last of the photo reads as a step. Grading the twin lights from
 * TWIN_TONE_SAT_MATCH at mix 0 to 1.0 at mix 100 (same smoothstep shape as
 * the base swap, so grade + dissolve move together) bridges photo tone into
 * full-twin tone with no step at either end. Endpoints honest: mix 0 ground
 * is invisible (grade unobservable), mix 100 is exactly the canonical
 * full-twin look. Non-finite mix returns 1 (neutral — never guess dark). */
export const TWIN_TONE_SAT_MATCH = 0.82;
export function toneGradeForMix(mix) {
  try {
    const m = Number(mix);
    if (!Number.isFinite(m)) return 1;
    const t = Math.min(1, Math.max(0, m / 100));
    const s = t * t * (3 - 2 * t);
    return TWIN_TONE_SAT_MATCH + (1 - TWIN_TONE_SAT_MATCH) * s;
  } catch {
    return 1;
  }
}

/* (5) RING FROM CORNERS: handoff-ring reveal progress 0..1 -> { scale,
 * opacity }. The ring starts oversized (RING_CORNER_SCALE x site radius —
 * touching the frame corners at the ring-frame hold footprint) and converges
 * to the site ring (scale 1) while its stroke draws 0->full. Driven by the
 * inbound flight (hold 0, swoop 0->1, push 1) and mirrored on reverse
 * (1->0); idle/done/standalone clear the override and the normal mix law
 * owns the ring. */
export const RING_CORNER_SCALE = 1.45;
export function ringRevealForProgress(p) {
  try {
    let x = Number(p);
    if (!Number.isFinite(x)) x = 1;
    x = Math.min(1, Math.max(0, x));
    return { scale: 1 + (1 - x) * (RING_CORNER_SCALE - 1), opacity: x };
  } catch {
    return { scale: 1, opacity: 1 };
  }
}

/* (6) PREDICTIVE PRECACHE (twin side): the hold already waits for the ready
 * post, but nothing warms the reveal ahead of it. From inbound hold progress
 * + pose-settle velocity the flight now tracks scene-warm (map up + first
 * painted frame), pose-warm (live camera on the hold frame + enough pumped
 * frames for damping to converge), and ready (both) BEFORE the reveal lands
 * (the settle-gated post). Pure + node-checkable; main.js feeds it live. */
export const HANDOFF_PREWARM_MIN_FRAMES = 3;
export function precacheStatus({ poseOk = false, mapUp = false, frames = 0 } = {}) {
  try {
    const f = Number(frames);
    const scene = !!mapUp && Number.isFinite(f) && f >= 1;
    const pose = !!poseOk && Number.isFinite(f) && f >= HANDOFF_PREWARM_MIN_FRAMES;
    const ready = scene && pose;
    return { scene, pose, ready, warm: ready };
  } catch {
    return { scene: false, pose: false, ready: false, warm: false };
  }
}

/* Continuous hold-pose error (velocity source for the precache tracker):
 * { posM, rangeM, pitchDeg, bearingDeg }. Null on any non-finite input —
 * withhold, never guess. Same geometry as twinHoldPoseMatch. */
export function twinHoldPoseError(pose, start) {
  try {
    const eye = pose?.eye;
    const tgt = pose?.target;
    const range = Number(start?.range);
    if (!eye || !tgt || !Number.isFinite(range) || range <= 0) return null;
    if (![eye.x, eye.y, eye.z, tgt.x, tgt.z, start.tx, start.tz].every(Number.isFinite)) return null;
    const ty = Number.isFinite(tgt.y) ? tgt.y : start.ty;
    if (!Number.isFinite(ty)) return null;
    const posM = Math.hypot(tgt.x - start.tx, tgt.z - start.tz);
    const liveRange = Math.hypot(eye.x - tgt.x, eye.y - ty, eye.z - tgt.z);
    if (!Number.isFinite(liveRange)) return null;
    const h = Math.hypot(eye.x - tgt.x, eye.z - tgt.z);
    const v = eye.y - ty;
    const pitchDeg = v > 0 ? (Math.atan2(h, v) * 180) / Math.PI : 90;
    const want = ((Number(start.bearing) || 0) % 360 + 360) % 360;
    const got = ((Math.atan2(-(eye.x - tgt.x), eye.z - tgt.z) * 180) / Math.PI + 360) % 360;
    const bearingDeg = Math.abs((((got - want + 540) % 360) + 360) % 360 - 180);
    return { posM, rangeM: Math.abs(liveRange - range), pitchDeg, bearingDeg };
  } catch {
    return null;
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
