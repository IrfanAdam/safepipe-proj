// src/map/scrolltrigger.js — GATE-3 NATIVE-ZOOM ITERATION (handoff 12-A):
// zoom-event interpreter. Native map zoom (wheel scrollZoom, pinch
// touchZoom) STAYS ON and keeps working everywhere — the journey RIDES on
// it, never hijacks it.
//
// There are NO wheel/touch capture listeners here and NO preventDefault /
// stopPropagation anywhere in this module (the handoff-9/11 wheel-hijack
// scrub path is retired). This module only:
//   (1) maps a live MapLibre zoom level to journey progress / sat fade /
//       center blend with pure, node-checkable helpers, and
//   (2) subscribes to the map's own 'zoom' / 'move' / 'zoomend' events and
//       republishes them as journey snapshots for main.js.
// Direction contract (unchanged): zoom IN deepens the journey, zoom OUT
// retraces it. Edge entries fire exactly once per crossing:
//   z >= Z_HANDOFF (closed) -> onDown()  (forward handoff flight)
//   z <= Z_MIN (+eps, open) -> onUp()    (reverse-first close — map side
//        only fires this when the map canvas itself is zoomed home; the
//        twin overlay covers the canvas while open, so twin-side reverse
//        stays owned by Lane B via the ready/close message contract).
// Pure helpers are node-checkable: no map imports (the single site.js
// import below is pure geo constants, no maplibre/three), callbacks injected.
import { RING_RADIUS_M, SANGACHAL } from '../ring2/site.js';

/* Web-mercator ground-scale constants (hoisted with the zoom laws above:
 * the seam hold derives from the projector at module scope, so the
 * constants it reads must initialize before first use). */
export const EARTH_MPP = 78271.51696; // web-mercator m at z0 over a 512px tile grid (MapLibre transform tileSize 512 — verified in the installed 6.13.0 source AND at runtime: map.project spans 10km at z10 as exactly R/mpp512, mpp256 reads 2x off). A 256-grid 156543 here halves every derived radius.
export const EARTH_CIRC_M = 40075017; // Earth's circumference, meters (ruler maximum)

export const Z_MIN = 6.4; // country home — enforced as map minZoom (the cap)
export const Z_FADE0 = 6.4; // fade starts: vector->sat keys off zoom only
export const Z_FADE1 = 9.0; // fade ends: full sat well before the handoff (works at ANY center)
export const Z_CENTER = 7.0; // proximity centering + brackets arm past this zoom
export const Z_ISO_START = Z_FADE1; // terrain->iso begins when the satellite is full
export const Z_TOP = 10.5; // iso checkpoint: terrain->iso completes here; the twin dissolve begins here
export const Z_HANDOFF = 11.5; // iso->twin completes here (the twin owns the pose at/above this)
export const Z_MAX = 14.0; // map maxZoom cap
/* Band-takeover floor: the in-band takeover owns EVERY tick from the mask
 * edge up (it writes zoom + centre + tilt in ONE camera update). Below the
 * mask edge the cursor anchor stays native — there is no journey law to
 * carry, and the user's own framing should win. */
export const Z_TAKEOVER_FLOOR = Z_CENTER;
const HOME_EPS = 0.06; // zoomend-at-home tolerance for the reverse edge
// Single source for the re-arm gate below the staged entry (derived, never restated).
export const REARM_DOWN_BELOW = Z_TOP - 0.5; // drop below to re-arm onDown / staging
const REARM_UP_ABOVE = Z_MIN + 0.3; // rise above to re-arm onUp

/* CACHE-FAST (wall-clock boot budget): profile-driven boot/prefetch speed.
 * Measured breakdown behind the owner verdict (5/10, caching too slow):
 * the twin SHELL boot (iframe doc + JS compile) dominates, then the
 * first-frame tile stream, then arrival tiles streaming mid-dive. So the
 * shell boots on page idle (whole-session lead instead of a ~4-level dive
 * lead), hotspot tiles warm one level below the mask arm, every patch
 * orders center-first, and boot->grant wall-clock is instrumented on the
 * probe (bootTiming) for the slow-network ready-by-arm regression. */
export const Z_FAR_INTENT = Z_CENTER - 1; // far-intent tile warm: one full level below the mask arm (fires ~z6)
export const CACHE_FAST_IDLE_DELAY_MS = 1500; // page-idle shell preload delay after init
export const CACHE_FAST_IDLE_TTL_MS = 90000; // idle shell released if no dive arms it within this
export const CACHE_FAST_SLOW_FIRST_FRAME_MS = 2500; // simulated slow-network shell + first-frame cost
/** Pure: slow-network readiness schedule — the shell is ready by the arm
 * iff the boot lead covers the first-frame cost. Node-checkable. */
export function readyByArm({ bootAtMs, armAtMs, firstFrameCostMs }) {
  const b = +bootAtMs;
  const a = +armAtMs;
  const c = +firstFrameCostMs;
  if (!Number.isFinite(b) || !Number.isFinite(a) || !Number.isFinite(c)) return false;
  if (b < 0 || a < 0 || c < 0) return false;
  return b + c <= a;
}

/* CONTENT-READY (D2): the twin shell streams its OWN tiles during the dive.
 * Map-side prefetches only warm the HTTP cache — the twin's MapLibre
 * instance still starts its arrival-zoom tiles at the arm, so content lands
 * seconds post-arm behind a frozen S + loading pill. The armed/idle shell
 * sits in hold pre-release, so re-pinning it onto the live frame as the
 * climb proceeds streams the arrival tiles BEFORE the arm. Pure
 * schedule: fires in the climb band on integer-zoom crossings (or a keep
 * alive beat — each accepted pin restarts the twin's hold floor twin-side,
 * so a settled shell can never mature a pre-arm exit while pins flow),
 * never at/above the handoff — a deep frame would trip the twin's painted
 * deep-release pre-arm and spend the hold invisibly (the arrival retarget
 * carries the final frame). Node-checkable. */
export const TWIN_RETARGET_RETRY_MS = 500;
export function progressiveRetargetDue({ z = NaN, lastZ = -1, lastT = 0, nowT = 0 } = {}) {
  try {
    const zz = Number(z);
    if (!Number.isFinite(zz)) return false;
    if (!(zz >= Z_FAR_INTENT && zz < Z_HANDOFF)) return false;
    const iz = Math.floor(zz);
    const lz = Number(lastZ);
    if (!Number.isFinite(lz) || iz !== Math.floor(lz)) return true;
    const lt = Number(lastT);
    const nt = Number(nowT);
    if (!Number.isFinite(lt) || !Number.isFinite(nt)) return false;
    return nt - lt >= TWIN_RETARGET_RETRY_MS;
  } catch {
    return false;
  }
}

export function clamp01(v) {
  const n = +v;
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function smooth01(t) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Live zoom -> journey progress 0..1 (MIN..HANDOFF span). */
export function zoomToProgress(z) {
  const n = +z;
  if (!Number.isFinite(n)) return 0;
  return clamp01((n - Z_MIN) / (Z_HANDOFF - Z_MIN));
}

/** Live zoom -> vector->sat opacity. Keys off ZOOM ONLY — identical at any
 * center (fade where you are: no fly-to, no jump). */
export function satOpacityForZoom(z) {
  const n = +z;
  if (!Number.isFinite(n)) return 0;
  return smooth01((n - Z_FADE0) / (Z_FADE1 - Z_FADE0));
}

/** Shared enclosure law: the bracket clip-k AND the vignette circle-t ride
 * this ONE span (Z_CENTER..Z_HANDOFF, smoothstepped) so the brackets and the
 * circle stay in sync on the way in and on retrace. The span now ends at the
 * handoff, not the iso checkpoint: the circle keeps closing while the twin
 * dissolves in, and it never shrinks past the twin's own clip radius. */
export function enclosureTForZoom(z) {
  const n = +z;
  if (!Number.isFinite(n)) return 0;
  return smooth01((n - Z_CENTER) / (Z_HANDOFF - Z_CENTER));
}

/** Live zoom -> proximity-center blend 0..1 (the shared enclosure span). */
export function centerBlendForZoom(z) {
  return enclosureTForZoom(z);
}

/* CENTRE-SETTLE LAW (owner rev: "make sure the hotspot becomes locked to the
 * center by animating it to the center even sooner"). The mask arms wherever
 * the user aimed — measured 154.5px off canvas centre on the gallery dive —
 * and the old centre glide closed that gap across ~2.6 zoom levels (154px at
 * z7.04, 16px at z8.84, 0 at z9.65), so the ring read off-centre for most of
 * the visible approach. This law names the settle as a span of ZOOM (never of
 * ticks or time): from the arm frame the site's screen offset shrinks to zero
 * over CENTER_SETTLE_SPAN_Z levels and is exactly zero after that, through the
 * commit. Being a pure function of (z, armZ) it is frame-rate independent, it
 * cannot overshoot (the smoothstep has zero slope at both ends, so the pan
 * starts and ends at rest — no snap, no pop), and reading it backwards
 * retraces the same pan exactly: at z = armZ the camera is back on the arm
 * frame, which is where the native cursor dolly takes over on the way out.
 *
 * Span choice: 0.45 levels is the shortest settle that does not read as a
 * yank at wheel-notch cadence (a 154px pan over ~3 notches of zoom) while
 * still landing inside 10px of centre 0.42 levels after onset — inside the
 * owner's "even sooner" ask and well before the iso/twin band. */
export const CENTER_SETTLE_SPAN_Z = 0.45;
export function centerSettleForZoom(z, armZ, spanZ = CENTER_SETTLE_SPAN_Z) {
  const zz = +z;
  const az = +armZ;
  const sp = +spanZ;
  if (!Number.isFinite(zz) || !Number.isFinite(az) || !Number.isFinite(sp) || !(sp > 0)) return 0;
  if (zz <= az) return 0;
  return smooth01((zz - az) / sp);
}
/** The site's screen-offset magnitude (px from canvas centre) at the settle
 * point for an arm frame: armOffsetPx at the arm, 0 from armZ+span on. Pure;
 * the same number the ring centre and the camera centre both ride. */
export function centerSettleOffsetPx(armOffsetPx, z, armZ, spanZ = CENTER_SETTLE_SPAN_Z) {
  const a = +armOffsetPx;
  if (!Number.isFinite(a) || !(a > 0)) return 0;
  return a * (1 - centerSettleForZoom(z, armZ, spanZ));
}
/* MapLibre's world is TILE_SIZE_PX * 2^z CSS px wide for 360 degrees of
 * longitude AND for 360 degrees of mercator y (the same tile grid EARTH_MPP
 * above is derived from — verified at runtime against map.project). */
export const TILE_SIZE_PX = 512;
/** Pure: mercator degrees per CSS px at a zoom. */
export function degreesPerPixel(zoom) {
  const z = +zoom;
  if (!Number.isFinite(z)) return null;
  return 360 / (TILE_SIZE_PX * Math.pow(2, z));
}
/** Pure: the camera centre that leaves the site `offPx` away from the canvas
 * centre along the screen-space unit direction (ux, uy) — +x right, +y down —
 * at a zoom. Exact to the same mercator grid metersPerPixel() projects on
 * (the node suite pins the round-trip against it), so the camera writer and
 * the ring writer can never disagree about where "off by N px" is.
 * Signs: the site sits (ux,uy)*off from the CANVAS CENTRE, so the centre sits
 * the same offset the other way from the SITE — east of it for ux<0, north of
 * it for uy>0 (+y on screen is south, and mercator y converts to latitude by
 * cos(lat)). */
export function centerForSiteOffset({ siteLng, siteLat, ux, uy, offPx, zoom } = {}) {
  const lng = +siteLng;
  const lat = +siteLat;
  const x = +ux;
  const y = +uy;
  const off = +offPx;
  const z = +zoom;
  if (![lng, lat, x, y, off, z].every((n) => Number.isFinite(n))) return null;
  const k = degreesPerPixel(z);
  if (!Number.isFinite(k)) return null;
  return [lng - x * off * k, lat + y * off * k * Math.cos(lat * DEG2RAD)];
}

/** Centering arms past Z_CENTER (proximity-gated by main.js). */
export function shouldCenter(z) {
  return Number.isFinite(+z) && +z >= Z_CENTER;
}

/** Stall-ceiling pin law: the pre-gate depth freeze never parks below the
 * staging-arm threshold — pin at max(live, Z_TOP) so the gate stays
 * reachable while the hold owns the frame. Pinning at a sub-gate live zoom
 * trapped the journey (the ceiling can only be lifted by a zoom tick, but
 * the ceiling itself prevents upward zoom ticks) and let reverse ticks
 * ratchet the ceiling down with every fight. Pure + node-checkable.
 *
 * FLOOR BY PHASE (Task-37 staged): the same trap bites one level later —
 * a stall landing at the staged arm pinned the ceiling at Z_TOP (10.5) while
 * the commit gate needs Z_HANDOFF (11.5), so the dive parked at z10.59 under
 * a 100% opaque overlay for 61s with no commit and no forward input able to
 * move it. The staged floor is therefore the gate itself; anything below
 * Z_TOP is still raised to Z_TOP. */
export function stallCeilingPin(liveZ, floorZ = Z_TOP) {
  const z = Number(liveZ);
  const f = Number(floorZ);
  const floor = Number.isFinite(f) ? Math.max(f, Z_TOP) : Z_TOP;
  if (!Number.isFinite(z)) return floor;
  return Math.max(z, floor);
}

/** Pre-phase stall swallow gate: the mask-armed ('pre') hold swallows
 * forward only on the gate approach (z at/above REARM_DOWN_BELOW) — below
 * that the climb flows (mask forms, tilt glides, tiles warm) and the stop
 * happens at the shut mask, never frozen mid-gesture. The staged hold is
 * untouched (its S stall owns the fingers regardless of zoom). Pure +
 * node-checkable. */
export function preStallSwallowDue({ phase = null, z = NaN } = {}) {
  if (phase !== 'pre') return true;
  const zz = Number(z);
  if (!Number.isFinite(zz)) return false;
  return zz >= REARM_DOWN_BELOW;
}

/* RELEASE-IMPOSSIBLE LAW (resilience half of the handoff contract): a staged
 * hold freezes forward S until the twin reports content, and the twin's intro
 * is scrubbed BY that same S — so when the twin's release cannot arrive, the
 * two sides wait on each other and the map parks with the fingers dead. The
 * long HARD_STOP_HOLD_MS (30s) bound was the only escape, which reads as a
 * frozen page. This law names the impossible wait far earlier: the map-side
 * watch (main.js releaseWatchTick) samples it while a staged hold is
 * un-granted and unwinds the dive with the returned reason.
 *
 * The bound is deliberately an order of magnitude under HARD_STOP_HOLD_MS but
 * above a healthy grant (measured boot->grant on the gallery path is ~1s):
 * ~2.6s of a FROZEN S with no content is no longer a load, it is a deadlock.
 *
 * Reasons (the named unwind the probe reports):
 *   iframe-gone   — no live twin frame at all (blanked / removed): no arrival
 *   twin-unreadable — live frame, but no __ring2 state past the bound (its JS
 *                     never came up, so no release can ever be allocated)
 *   intro-held    — readable and still parked in 'hold': its intro never
 *                   started, and it only starts on an S the map is holding
 *   release-starved — released (intro allocated) but content never settles:
 *                   its tiles can only go idle once the camera stops moving,
 *                   and the camera only moves on the S the map is holding
 *   release-timeout — readable, un-released, not parked: no known state, same
 *                   circular shape, same escape
 * Pure + node-checkable. Returns null while the wait is still legitimate. */
export const RELEASE_WAIT_BOUND_MS = 2600;
export function releaseImpossibleReason({
  iframeAlive = true,
  readable = false,
  released = null,
  phase = null,
  waitMs = 0,
  boundMs = RELEASE_WAIT_BOUND_MS,
  driven = true,
} = {}) {
  if (iframeAlive === false) return 'iframe-gone';
  const b = Number(boundMs);
  const bound = Number.isFinite(b) && b > 0 ? b : RELEASE_WAIT_BOUND_MS;
  const w = Number(waitMs);
  if (!Number.isFinite(w) || w < bound) return null;
  // A user who stopped scrolling is PAUSING, not blocked: the overlay holds
  // exactly where the fingers left it and forward input resumes the ramp.
  // Only live forward pressure can make a wait impossible (a gone iframe
  // still unwinds above — that one is unrecoverable whatever the fingers do).
  if (driven === false) return null;
  if (!readable) return 'twin-unreadable';
  if (released === true) return 'release-starved';
  if (phase === 'hold') return 'intro-held';
  return 'release-timeout';
}

/** Iso scrub target: pitch rides the zoom across the ISO_START..Z_TOP band
 * (0 at/below the terrain grade, smooth 0..ISO_PITCH_DEG as the terrain turns
 * iso, held at ISO_PITCH_DEG through the twin handoff). Starting at the
 * satellite-full zoom makes the terrain->iso motion begin a full level
 * earlier instead of snapping in over the last level before the gate. Pure +
 * node-checkable; the driver writes it straight into the map transform so the
 * gesture owns the tilt forward AND back — no latch, no ease, no timer. */
export const ISO_PITCH_DEG = 45;
export function pitchTargetForZoom(z) {
  const n = +z;
  if (!Number.isFinite(n)) return 0;
  return ISO_PITCH_DEG * smooth01((n - Z_ISO_START) / (Z_TOP - Z_ISO_START));
}
/** Degrees-to-radians factor for the tilt->squash projection (named, never bare). */
export const DEG2RAD = Math.PI / 180;
/** Mask squash for the pitched ground circle: the CSS enclosure mask is a
 * fixed circle but the pitched ground circle projects to an ellipse,
 * vertical x cos(pitch). 1 at/below Z_ISO_START (flat grade), cos(45deg)
 * at/above Z_TOP (the iso pole holds through the handoff). Pure +
 * node-checkable; zoom-out retraces it. */
export function maskSquashForZoom(z) {
  return Math.cos(pitchTargetForZoom(z) * DEG2RAD);
}
/** Enclosure ellipse: rx is the forming-law circle radius unchanged, ry is
 * rx squashed by the tilt projection. Null wherever the circle parks
 * (below the band / no viewport corner). Pure in (z, corner), symmetric on
 * zoom-out. */
export function enclosureEllipsePxForZoom(zoom, latDeg, ringM = MAP_VIGNETTE_RING_M, cornerPx = null) {
  const rx = enclosureRadiusPxForZoom(zoom, latDeg, ringM, cornerPx);
  if (!Number.isFinite(rx)) return null;
  const squash = maskSquashForZoom(zoom);
  if (!Number.isFinite(squash)) return null;
  return { rx, ry: rx * squash, squash };
}
/** Top-down checkpoint reached (bearing/pitch -> 0). */
export function isTopDown(z) {
  return Number.isFinite(+z) && +z >= Z_TOP;
}

/** Deep-zoom handoff threshold reached. */
export function needsHandoff(z) {
  return Number.isFinite(+z) && +z >= Z_HANDOFF;
}

/* GESTURE-REVERSE DISSOLVE (owner rev 2026-10-26: the way back must retrace,
 * never cut to the full map; lane-gesture revision: on the SAME law, not a
 * second one). The twin-initiated recede keeps the overlay mounted while the
 * fingers drive the zoom home; the overlay opacity is the forward staged
 * reveal law (stagedIntroProgressForS — the exact function the map drove the
 * dissolve up with) read at the zoom-mapped S, so dissolve and camera share
 * every knee in both directions by construction. 1 at the handoff gate (the
 * committed frame), 0 at/below the iso checkpoint Z_TOP (the twin is torn
 * down there and the native journey laws own the rest of the way home).
 * Zoom-out retraces it, zoom-in re-dissolves it, by construction.
 * Pure + node-checkable; the map-side reverse driver owns the writes. */
export function retraceOpacityForZoom(z) {
  const n = +z;
  if (!Number.isFinite(n)) return 0;
  if (n >= Z_HANDOFF) return 1;
  if (n <= Z_TOP) return 0;
  return stagedIntroProgressForS(HANDOFF_STAGED_S_MAX * ((n - Z_TOP) / (Z_HANDOFF - Z_TOP)));
}

/* Handoff dissolve band (Task 35): past Z_HANDOFF the map HOLDS its scrubbed
 * end-frame (pitch carried at ISO_PITCH_DEG, center on the spot — native zoom
 * still owns z) while further zoom deltas dissolve into the twin pose. 0
 * at/below handoff, smooth to 1 at full commit — one level past handoff,
 * inside the Z_MAX cap. Pure + node-checkable; the driver publishes it to
 * the probe and stages the twin prewarm on arrival (z itself past Z_HANDOFF);
 * the twin-ready message owns the reveal. Task 36 consumes this band for the
 * range-scrubbed twin intro. */
export const Z_TWIN_COMMIT = 13.0;
export function handoffScrubForZoom(z) {
  const n = +z;
  if (!Number.isFinite(n)) return 0;
  return smooth01((n - Z_HANDOFF) / (Z_TWIN_COMMIT - Z_HANDOFF));
}

/* Post-gate staged scroll (Task 35, owner refinement; MASK-SYNC revision;
 * TIGHTEN revision 2026-10-26): once z is HELD at Z_HANDOFF (map-side maxZoom
 * clamp — scroll-as-zoom throttled), further scroll ticks accumulate as stage
 * scroll S (px of wheel delta past the gate) instead of depth. Gates
 * (cumulative px, band = 700):
 *   ring    0..80   — enclosing ring converges canvas-edges -> ring-edges
 *   blend  80..160  — terrain blend holds full satellite
 *   tilt  160..240  — iso tilt holds 45deg
 *   reveal 0..700   — twin overlay dissolves 0..1 across the WHOLE hold
 * Ring/blend/tilt already arrive pre-gate in the native journey (Z_TOP..Z_HANDOFF
 * band) — their staged laws HOLD the end-state. The reveal used to wait for
 * its own gate (750..1250), so the fingers crossed 750px of dead scroll with
 * the mask parked and the overlay at 0, then the twin faded in 4-5 quantized
 * steps strictly after the mask finished — two separate moves (measured:
 * overlay 0 -> 0.74 -> 1.0 in two wheel ticks). Now the overlay moves on the
 * first post-gate tick together with the hold-ring breathing entry->seam on
 * the same S (driveStagedHold): mask and twin ride one continuous motion from
 * the gate to the commit. The map reveal and the twin intro ride the SAME law
 * (stagedIntroProgressForS below), so dissolve and camera agree knee-for-knee
 * by construction.
 *
 * BAND LENGTH (owner: "the sliding from terrain to twin is slow and
 * noticeable"). The band was 1250px — 12.5 wheel notches at ~100px, i.e. as
 * much scroll as the last three zoom levels of the dive, spent on one
 * dissolve. It is now 700px (44% less scroll), and the swoop leg — the
 * invisible convergence that used to eat the first 60% of the band under a
 * half-transparent overlay — is a third of it (240px), so the visible
 * push/melt owns the majority of the motion instead of the tail. The commit
 * still lands on exactly S = HANDOFF_STAGED_S_MAX at z = Z_HANDOFF, S still
 * freezes at the gate, and every value is still a pure function of S, so
 * scroll-up retraces the shorter band symmetrically. Pure + node-checkable;
 * the map-side wheel accumulator owns S, Task 36 consumes S for the
 * range-scrubbed twin intro. */
export const HANDOFF_STAGE_PX = 80;
export const HANDOFF_REVEAL_LEN_PX = 460;
export const HANDOFF_STAGED_S_MAX = 3 * HANDOFF_STAGE_PX + HANDOFF_REVEAL_LEN_PX; // 700

/* Shared intro/reveal pacing (map + twin, ONE law): the forward intro is
 * three legs — swoop (invisible convergence), push (rigid satellite move),
 * settle (imagery melt on a static pose) — with ms-proportional weights, so
 * the scrub and autoplay clocks agree on pacing and the knees land exactly
 * on leg boundaries. Both sides consume S through stagedIntroProgressForS:
 * the twin maps it onto swoop->push->settle (sector.js delegates here), the
 * map drives the overlay reveal through it — dissolve and camera ride the
 * same mid-band knees (swoop done at 240, push done at the ms-proportional
 * knee), never a linear ramp running ahead of a legged intro. Pure +
 * node-checkable; scroll-up retraces it symmetrically. The leg durations
 * live HERE (single source); sector.js re-exports them so the pose legs and
 * the S law can never disagree. */
export const HANDOFF_SWOOP_MS = 2600;
export const HANDOFF_PUSH_MS = 2400;
export const HANDOFF_MORPH_MS = 1200;
/** S px where the swoop completes (the pacing anchor, band-derived). */
export const STAGED_SWOOP_END_PX = 3 * HANDOFF_STAGE_PX; // 240
/** Pure: staged scroll S (px) -> shared intro/reveal progress 0..1.
 * Piecewise linear across [0,swoopEnd,pushEnd,max]: the leg easing itself
 * supplies the curve, so the S law stays linear and double-easing never
 * drags. Parks at 0/1 outside. Non-finite S parks at 0. Never throws. */
export function stagedIntroProgressForS(
  s,
  { revealStartPx = STAGED_SWOOP_END_PX, pushEndPx = null, stagedMaxPx = HANDOFF_STAGED_S_MAX, swoopW = null } = {},
) {
  try {
    const v = Number(s);
    if (!Number.isFinite(v) || v <= 0) return 0;
    let rs = Number(revealStartPx);
    let mx = Number(stagedMaxPx);
    if (!Number.isFinite(rs) || rs <= 0) rs = STAGED_SWOOP_END_PX;
    if (!Number.isFinite(mx) || mx <= rs) mx = HANDOFF_STAGED_S_MAX;
    const swMs = HANDOFF_SWOOP_MS;
    const puMs = HANDOFF_PUSH_MS;
    const moMs = HANDOFF_MORPH_MS;
    const total = swMs + puMs + moMs;
    const w1 = total > 0 ? swMs / total : 0.5;
    const w2 = total > 0 ? (swMs + puMs) / total : 0.8;
    let ps = pushEndPx === null || pushEndPx === undefined ? NaN : Number(pushEndPx);
    if (!Number.isFinite(ps) || ps <= rs || ps >= mx) {
      const span = puMs + moMs;
      ps = span > 0 ? rs + ((mx - rs) * puMs) / span : (rs + mx) / 2;
    }
    if (v >= mx) return 1;
    if (v >= ps) return w2 + ((v - ps) / (mx - ps)) * (1 - w2);
    if (v >= rs) {
      let w = swoopW === null || swoopW === undefined ? NaN : Number(swoopW);
      if (!Number.isFinite(w) || w <= 0 || w >= 1) w = w1;
      return w + ((v - rs) / (ps - rs)) * (w2 - w);
    }
    return (v / rs) * w1;
  } catch {
    return 0;
  }
}
export function handoffStagesForScroll(s) {
  const n = Number.isFinite(+s) ? Math.max(0, +s) : 0;
  const seg = (a, b) => smooth01((n - a) / (b - a));
  return {
    ring: seg(0, HANDOFF_STAGE_PX),
    blend: seg(HANDOFF_STAGE_PX, 2 * HANDOFF_STAGE_PX),
    tilt: seg(2 * HANDOFF_STAGE_PX, 3 * HANDOFF_STAGE_PX),
    // Pace: the shared intro/reveal law, not a linear ramp. The old linear
    // dissolve ran ahead of the legged twin intro mid-band (0.60 at the
    // swoop knee where the camera had only converged 0.42), so the overlay
    // led the camera through the middle of the hold. Reveal now IS the
    // intro progress — dissolve and camera share every knee.
    reveal: stagedIntroProgressForS(n),
  };
}

/** Symmetric stage-scroll accumulator: forward intent is -deltaY in both
 * conventions (the wheel lane carries flipped clones — plain wheel forward
 * = dy<0 — and native pinch, forward = dy<0), so S grows on scroll-down
 * and drains on scroll-up through the SAME law. Clamped [0, S_MAX]. */
export function accumStagedS(s, deltaY) {
  const cur = Number.isFinite(+s) ? Math.max(0, +s) : 0;
  const dy = +deltaY;
  if (!Number.isFinite(dy) || dy === 0) return Math.min(HANDOFF_STAGED_S_MAX, cur);
  return Math.min(HANDOFF_STAGED_S_MAX, Math.max(0, cur - dy));
}

/* Live-hold travel past the gate (map side): z clamps at Z_HANDOFF while
 * the twin boots, so every zoom-keyed law freezes — scroll fingers go dead
 * until first paint, then the dissolve jumps. These pure laws translate the
 * SAME staged scroll S into visible hold travel, so every wheel tick moves
 * the frame with depth clamped and the twin dark. Handshake-safe: pitch and
 * enclosure chrome are never handed params (twinlink carries cx/cy/z/bearing
 * only). The tilt extra relaxes to 0 across the reveal band, so the commit
 * still meets the twin iso pole exactly (ISO_PITCH_DEG). Pure +
 * node-checkable; symmetric on scroll-up (pure fns of S). */
export const STAGED_HOLD_PITCH_DEG = 0; // the zoom-driven reveal already carries the motion; hold the iso pole exactly
export const STAGED_HOLD_RING_CLOSE = 0; // enclosure already lands on the twin clip at the handoff; no extra shrink
export function stagedHoldPitchForS(s) {
  const st = handoffStagesForScroll(s);
  return STAGED_HOLD_PITCH_DEG * st.tilt * (1 - st.reveal);
}
export function stagedHoldRingCloseForS(s) {
  return STAGED_HOLD_RING_CLOSE * handoffStagesForScroll(s).ring;
}

/* V7 seam hold (map side): while z clamps at Z_HANDOFF and the twin boots,
 * the hold leg parks the enclosure ellipse EXACTLY on the handoff radius —
 * seamHoldRxPx() with ry squashed by the iso-pole tilt projection
 * (rx * cos(ISO_PITCH_DEG)) — the seam is the live projector evaluated at
 * the handoff (vignetteRadiusPxForZoom at Z_HANDOFF over the site parallel),
 * never a tuned literal, so it can never drift from the forming law it
 * meets. Pure fn of S: identical at/above Z_HANDOFF (no zoom input, so
 * no zoom dependence past the gate) and repainted on every staged tick, so
 * the seam stays under finger control while depth is clamped. Constant
 * across S by design (a hold, not travel — scroll-up retraces it
 * trivially); non-finite S still parks the seam, never blanks the chrome.
 * (Definition lives below the projector it derives from.) */

/* Journey-enclosure radius (Task 37, map side): the ground ring the twin
 * clip cuts at — RING_RADIUS_M, imported from src/ring2/site.js (single
 * source of truth; the node suite pins them equal). No literal here, so
 * the map-side enclosing can never drift from the twin clip circle.
 * Projected to CSS px at the live zoom/lat: R / metersPerPixel. The
 * #map-vignette circle rides this radius, so the map-side enclosing
 * coincides with the twin clip circle exactly (~685px diameter at the handoff
 * zoom, an example zoom inside the post-gate band — not the gate itself,
 * held through handoff) — symmetric on zoom-out, since it is a pure
 * function of z. */
export const MAP_VIGNETTE_RING_M = RING_RADIUS_M;
export function vignetteRadiusPxForZoom(zoom, latDeg, ringM = MAP_VIGNETTE_RING_M) {
  const R = +ringM;
  if (!Number.isFinite(R) || !(R > 0)) return null;
  const mpp = metersPerPixel(zoom, latDeg);
  if (!Number.isFinite(mpp) || !(mpp > 0)) return null;
  return R / mpp;
}
/* Enclosure forming wash (map side): the displayed vignette circle starts at
 * the hotspot's farthest screen corner (clear frame, darkness only biasing
 * in from the edges) and closes onto the projected ring across the SHARED
 * enclosure span Z_CENTER..Z_HANDOFF (enclosureTForZoom — the same law as the
 * bracket clip-k, so circle and brackets stay in sync) — display =
 * corner*(1-t) + projected*t. At/above Z_HANDOFF t=1 so it IS the twin's clip
 * circle exactly; the circle never shrinks below that radius, so the map-side
 * enclosing and the twin clip meet without a re-open or an over-zoom.
 * cornerPx is viewport-relative (driver passes the hotspot's farthest-corner
 * distance), so the enclosure always reaches the screen edges on any aspect —
 * never a peephole. Pure in (z, corner), symmetric on zoom-out. */
export function enclosureRadiusPxForZoom(zoom, latDeg, ringM = MAP_VIGNETTE_RING_M, cornerPx = null) {
  const n = +zoom;
  if (!Number.isFinite(n)) return null;
  // The projected ring is evaluated at the HANDOFF zoom: the twin's clip is a
  // fixed ground circle at that pose. Holding at the earlier Z_TOP projection
  // over-zoomed the map (242.2px vs the twin's 484.5px clip) — the owner sees the
  // circle shrink too far before the twin arrives. Evaluate at the handoff so
  // the circle lands on the twin's clip and holds there.
  const vr = vignetteRadiusPxForZoom(Z_HANDOFF, latDeg, ringM);
  const c = +cornerPx;
  if (!Number.isFinite(vr) || !Number.isFinite(c) || !(c > 0)) return null;
  const t = enclosureTForZoom(n);
  if (!(t > 0)) return null;
  return c * (1 - t) + vr * t;
}
/* Seam hold definition (derives from the projector above — never a tuned
 * literal): the hold leg parks on the live forming law evaluated at the
 * handoff zoom over the site parallel, i.e. exactly the radius the forming
 * law converges to (corner*(1-t) + vr*t is vr at t=1). The exported seam
 * pins that derivation at written precision (0.1px — the driver writes
 * --vr/--vr-y to 0.1px, so the written seam and the written live law at the
 * handoff are the identical string, never a 1-frame snap). Pure fns of S:
 * rx is zoom-free past the gate by construction. */
export function seamHoldRxPx(latDeg = SANGACHAL.lat, ringM = MAP_VIGNETTE_RING_M) {
  return vignetteRadiusPxForZoom(Z_HANDOFF, latDeg, ringM);
}
export const SEAM_HOLD_RX_PX = +seamHoldRxPx().toFixed(1);
export function seamHoldEllipseForS(s) {
  void s; // the value is the seam itself — S owns the repaint cadence, not the radius
  const rx = SEAM_HOLD_RX_PX;
  return { rx, ry: rx * Math.cos(ISO_PITCH_DEG * DEG2RAD) };
}
/** At (or below tolerance of) the min-zoom cap — mirrored-reverse home. */
export function isHomeZoom(z) {
  return Number.isFinite(+z) && +z <= Z_MIN + HOME_EPS;
}

/** Publish the zoom-journey probe snapshot (best-effort, never throws). */
function publish(state) {
  try {
    window.__mapProbe.scroll = { ...state };
    window.__mapProbe.zoomJourney = window.__mapProbe.zoomJourney || null;
  } catch { /* probe cosmetic */ }
}

/**
 * Subscribe to the map's OWN zoom/move events and republish them as journey
 * snapshots. Adds NO wheel/touch listeners, calls NO preventDefault — native
 * zoom keeps working everywhere (including far from the hotspot).
 *
 * @param {Object} cfg
 * @param {Object} cfg.map live MapLibre map (needs getZoom/getCenter/on/off)
 * @param {() => boolean} [cfg.isOpen] true while the twin overlay is open
 * @param {() => boolean} [cfg.isBusy] true mid-flight/prewarm/reverse-wait/recede
 * @param {(snap: Object, source: string) => void} [cfg.onProgress] every zoom step
 * @param {() => void} [cfg.onDown] forward entry at z >= Z_HANDOFF
 * @param {() => void} [cfg.onUp] reverse entry at z <= Z_MIN+eps (while open)
 * @returns {() => void} uninstall
 */
export function installZoomJourney({ map, isOpen, isBusy, onProgress, onDown, onUp }) {
  const state = {
    source: 'native-zoom', progress: 0, zoom: null, opacity: 0,
    downs: 0, ups: 0, last: null,
  };
  publish(state);
  if (!map || typeof map.on !== 'function') return () => {};
  if (map.__zoomJourneyInstalled) return () => {};
  try {
    map.__zoomJourneyInstalled = true;
  } catch { /* flag is best-effort */ }
  let downArmed = true;
  let upArmed = true;

  function snapshot() {
    let z = null;
    let center = null;
    try {
      z = map.getZoom();
    } catch { z = null; }
    try {
      const c = map.getCenter();
      center = c ? { lng: +c.lng, lat: +c.lat } : null;
    } catch { center = null; }
    const zn = Number.isFinite(+z) ? +z : Z_MIN;
    return {
      z: Number.isFinite(+z) ? +z : null,
      center,
      progress: zoomToProgress(zn),
      opacity: satOpacityForZoom(zn),
      blend: centerBlendForZoom(zn),
      topDown: isTopDown(zn),
      handoff: needsHandoff(zn),
      home: isHomeZoom(zn),
    };
  }

  function step(source, edge) {
    const snap = snapshot();
    state.progress = +snap.progress.toFixed(4);
    state.zoom = snap.z == null ? null : +snap.z.toFixed(3);
    state.opacity = +snap.opacity.toFixed(4);
    state.last = source;
    const open = (() => { try { return !!(isOpen && isOpen()); } catch { return false; } })();
    let busy = false;
    try {
      busy = !!(isBusy && isBusy());
    } catch { /* best-effort */ }
    if (snap.z != null && snap.z < REARM_DOWN_BELOW) downArmed = true;
    if (snap.z != null && snap.z > REARM_UP_ABOVE) upArmed = true;
    try {
      onProgress && onProgress(snap, source || 'native-zoom');
    } catch { /* driver reports its own errors */ }
    // Edges: exactly once per crossing, never autonomous jumps. While busy
    // (flight/prewarm/recede) the step still publishes + drives the fade —
    // only the EDGE entry is deferred.
    if (edge && !open && snap.handoff && downArmed && !busy) {
      downArmed = false;
      state.downs += 1;
      publish(state);
      try {
        onDown && onDown();
      } catch { /* entry reports its own errors */ }
      return;
    }
    if (edge && open && snap.home && upArmed) {
      upArmed = false;
      state.ups += 1;
      publish(state);
      try {
        onUp && onUp();
      } catch { /* entry reports its own errors */ }
      return;
    }
    publish(state);
  }

  const onZoom = () => step('native-zoom', false);
  const onZoomEnd = () => step('native-zoomend', true);
  const onMove = () => step('native-move', false);
  try {
    map.on('zoom', onZoom);
  } catch { /* subscribe best-effort */ }
  try {
    map.on('move', onMove);
  } catch { /* subscribe best-effort */ }
  try {
    map.on('zoomend', onZoomEnd);
  } catch { /* subscribe best-effort */ }
  // Publish the home frame immediately so the probe never idles empty.
  try {
    step('native-init', false);
  } catch { /* best-effort */ }
  return () => {
    try {
      map.off('zoom', onZoom);
    } catch { /* teardown best-effort */ }
    try {
      map.off('move', onMove);
    } catch { /* teardown best-effort */ }
    try {
      map.off('zoomend', onZoomEnd);
    } catch { /* teardown best-effort */ }
    try {
      map.__zoomJourneyInstalled = false;
    } catch { /* flag teardown best-effort */ }
  };
}

/**
 * Retired hijack entry (handoff-9/11): kept as a named alias so older
 * imports keep working, but it NEVER installs wheel/touch capture listeners
 * and NEVER calls preventDefault. With a live map it delegates to
 * installZoomJourney; with only an element it publishes an idle snapshot and
 * returns a no-op uninstall.
 */
export function installScrollTrigger(cfg = {}) {
  if (cfg && cfg.map) {
    return installZoomJourney(cfg);
  }
  const state = {
    source: 'native-zoom', progress: 0, zoom: null, opacity: 0,
    downs: 0, ups: 0, last: 'retired-hijack',
    retired: true,
  };
  publish(state);
  return () => {};
}

/** Owner wheel preference: drag UP zooms OUT, drag DOWN zooms in (sign
 * flip of the native delta). Pinch (ctrl+wheel) is never flipped — the
 * caller gates on e.ctrlKey. Pure + node-checkable. */
export function flipWheelDelta(deltaY) {
  const n = +deltaY;
  return Number.isFinite(n) ? -n : 0;
}

/* Journey-lock anchor (pure, node-checkable): the screen point the native
 * zoom should circle while locked. Zooming IN anchors beyond the spot, so
 * the spot drifts toward center coupled to the user's own scroll speed and
 * eases in as it centers; zooming OUT anchors at canvas center, so framing
 * holds while the view widens. hx/hy = spot px, cx/cy = canvas center px. */
export const Z_LOCK_ARM = 6.5;
export function lockAroundPoint(hx, hy, cx, cy, zoomIn) {
  const nums = [+hx, +hy, +cx, +cy];
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (!zoomIn) return { x: +cx, y: +cy };
  const K = 0.9;
  return { x: +hx + (+hx - +cx) * K, y: +hy + (+hy - +cy) * K };
}

/* Mask-anchored scroll-gain dip (pure, node-checkable): the slowdown rides
 * the enclosing mask itself, not absolute zoom. Input is the live enclosure
 * blend b (centerBlendForZoom — 0 while the mask is down) plus the mask-arm
 * predicate (hotspot near): gain is 1 whenever the mask is down, dips to
 * MASK_GAIN_MIN mid-formation through a smoothstepped sine window (zero
 * slope at both ends, so the entry joins the full-rate law without a kink
 * and the release meets full rate exactly at the iso checkpoint Z_TOP),
 * and stays 1 at/above iso so the handoff commit runs at full rate.
 * Strictly scroll-governed: a pure function of live mask state, so no
 * timer ever owns camera motion; zoom-out retraces it symmetrically (gain
 * is direction-free). Far frames keep full rate at any zoom because the
 * arm predicate owns the gate — the zoom value alone can never dip. */
export const MASK_GAIN_MIN = 0.7; // deepest slowdown: 30% off at mid mask formation
export const MASK_GAIN_RELEASE_BLEND = enclosureTForZoom(Z_TOP); // blend at the iso checkpoint (~0.874): the dip releases here
export function maskGainForBlend(blend, armed) {
  if (!armed) return 1;
  const b = +blend;
  if (!Number.isFinite(b) || b <= 0) return 1;
  const t = clamp01(b / MASK_GAIN_RELEASE_BLEND);
  if (t <= 0 || t >= 1) return 1;
  const u = smooth01(t);
  return 1 - (1 - MASK_GAIN_MIN) * Math.sin(Math.PI * u);
}
/* Legacy absolute-zoom entry: kept so older imports keep working. Delegates
 * to the mask law with the span-implied arm — the live mask predicate in
 * main.js owns the real gating. */
export const LOCK_GAIN_MIN = MASK_GAIN_MIN;
export function zoomGainForZoom(z) {
  const n = +z;
  if (!Number.isFinite(n)) return 1;
  const armed = n > Z_CENTER && n < Z_TOP;
  return maskGainForBlend(centerBlendForZoom(n), armed);
}

/* Viewport ground-scale telemetry (pure, node-checkable): web-mercator
 * meters-per-pixel at a latitude, scaled by a CSS-px span. Lets the owner
 * report exactly which ground scale a satellite tile swap pops at
 * (integer zoom crossings are where Esri swaps captures). Constants live at
 * the top beside the zoom laws (the seam hold derives from this projector
 * at module scope). */
export function metersPerPixel(zoom, latDeg) {
  const z = +zoom;
  const lat = +latDeg;
  if (!Number.isFinite(z) || !Number.isFinite(lat)) return null;
  const mpp = (EARTH_MPP * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
  return Number.isFinite(mpp) && mpp > 0 ? mpp : null;
}
export function formatGround(m) {
  const v = +m;
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 10000) return (v / 1000).toFixed(0) + ' KM';
  if (v >= 1000) return (v / 1000).toFixed(1) + ' KM';
  if (v >= 10) return v.toFixed(0) + ' M';
  if (v >= 1) return v.toFixed(1) + ' M';
  return (v * 100).toFixed(0) + ' CM';
}
/* Span needle position (pure, node-checkable): where the current ground
 * span sits between the ruler end spans, in log space — zoom steps are
 * exponential, so a linear map would park the needle in the wrong place
 * against the end numbers. Clamped to [0,1]. */
export function spanFrac(currentM, minM, maxM) {
  const c = +currentM;
  const lo = +minM;
  const hi = +maxM;
  if (!Number.isFinite(c) || !Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  if (lo <= 0 || hi <= lo || c <= 0) return 0;
  const cl = c < lo ? lo : c > hi ? hi : c;
  return (Math.log(cl) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
}
