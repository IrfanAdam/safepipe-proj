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
// Pure helpers are node-checkable: no map imports, callbacks injected.

export const Z_MIN = 6.4; // country home — enforced as map minZoom (the cap)
export const Z_FADE0 = 6.4; // fade starts: vector->sat keys off zoom only
export const Z_FADE1 = 9.0; // fade ends: full sat well before the handoff (works at ANY center)
export const Z_CENTER = 7.0; // proximity centering + brackets arm past this zoom
export const Z_TOP = 10.5; // top-down checkpoint (bearing/pitch -> 0): a full zoom level of scrubbed tilt before the gate, so the iso reads as motion, never a snap
export const Z_HANDOFF = 11.5; // deeper zoom hands to the twin
export const Z_MAX = 14.0; // map maxZoom cap
const HOME_EPS = 0.06; // zoomend-at-home tolerance for the reverse edge
const REARM_DOWN_BELOW = Z_HANDOFF - 0.5; // drop below to re-arm onDown
const REARM_UP_ABOVE = Z_MIN + 0.3; // rise above to re-arm onUp

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
 * this ONE span (Z_CENTER..Z_TOP, smoothstepped) so the brackets and the
 * circle stay in sync on the way in and on retrace. Pure + node-checkable. */
export function enclosureTForZoom(z) {
  const n = +z;
  if (!Number.isFinite(n)) return 0;
  return smooth01((n - Z_CENTER) / (Z_TOP - Z_CENTER));
}

/** Live zoom -> proximity-center blend 0..1 (the shared enclosure span). */
export function centerBlendForZoom(z) {
  return enclosureTForZoom(z);
}

/** Centering arms past Z_CENTER (proximity-gated by main.js). */
export function shouldCenter(z) {
  return Number.isFinite(+z) && +z >= Z_CENTER;
}

/** Iso scrub target: pitch rides the zoom across the TOP..HANDOFF band (0 at
 * or below the top-down checkpoint, smooth 0..ISO_PITCH_DEG inside the band,
 * held at ISO_PITCH_DEG above it). Pure + node-checkable; the driver writes
 * it straight into the map transform so the gesture owns the tilt forward
 * AND back — no latch, no ease, no timer. */
export const ISO_PITCH_DEG = 45;
export function pitchTargetForZoom(z) {
  const n = +z;
  if (!Number.isFinite(n)) return 0;
  return ISO_PITCH_DEG * smooth01((n - Z_TOP) / (Z_HANDOFF - Z_TOP));
}
/** Top-down checkpoint reached (bearing/pitch -> 0). */
export function isTopDown(z) {
  return Number.isFinite(+z) && +z >= Z_TOP;
}

/** Deep-zoom handoff threshold reached. */
export function needsHandoff(z) {
  return Number.isFinite(+z) && +z >= Z_HANDOFF;
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

/* Post-gate staged scroll (Task 35, owner refinement): once z is HELD at
 * Z_HANDOFF (map-side maxZoom clamp — scroll-as-zoom throttled), further
 * scroll ticks accumulate as stage scroll S (px of wheel delta past the
 * gate) instead of depth. Gates (cumulative px):
 *   ring   0..250   — enclosing ring converges canvas-edges -> ring-edges
 *   blend  250..500 — terrain blend holds full satellite
 *   tilt   500..750 — iso tilt holds 45deg
 *   reveal 750..1250 — twin overlay dissolves 0..1 (twin-ready gates >0)
 * Ring/blend/tilt already arrive pre-gate in the native journey (10.5..11.5
 * band) — their staged laws HOLD the end-state; the reveal is the live
 * post-gate stage. Every value is a pure function of S, so scroll-up
 * retraces it symmetrically. Pure + node-checkable; the map-side wheel
 * accumulator owns S, Task 36 consumes the reveal band for the
 * range-scrubbed twin intro. */
export const HANDOFF_STAGE_PX = 250;
export const HANDOFF_REVEAL_LEN_PX = 500;
export const HANDOFF_STAGED_S_MAX = 3 * HANDOFF_STAGE_PX + HANDOFF_REVEAL_LEN_PX; // 1250
export function handoffStagesForScroll(s) {
  const n = Number.isFinite(+s) ? Math.max(0, +s) : 0;
  const seg = (a, b) => smooth01((n - a) / (b - a));
  return {
    ring: seg(0, HANDOFF_STAGE_PX),
    blend: seg(HANDOFF_STAGE_PX, 2 * HANDOFF_STAGE_PX),
    tilt: seg(2 * HANDOFF_STAGE_PX, 3 * HANDOFF_STAGE_PX),
    reveal: seg(3 * HANDOFF_STAGE_PX, HANDOFF_STAGED_S_MAX),
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

/* Journey-enclosure radius (Task 37, map side): the ground ring the twin
 * clip cuts at (RING_RADIUS_M, owned by src/ring2/site.js — mirrored here
 * so this module stays import-free; the node suite pins them equal).
 * Projected to CSS px at the live zoom/lat: R / metersPerPixel. The
 * #map-vignette circle rides this radius, so the map-side enclosing
 * coincides with the twin clip circle exactly (~685px diameter at z=12,
 * held through handoff) — symmetric on zoom-out, since it is a pure
 * function of z. */
export const MAP_VIGNETTE_RING_M = 10000;
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
 * enclosure span Z_CENTER..Z_TOP (enclosureTForZoom — the same law as the
 * bracket clip-k, so circle and brackets stay in sync) — display =
 * corner*(1-t) + projected*t. At/above Z_TOP t=1 so it IS the clip circle
 * exactly (held through handoff); at/below band start it
 * parks at null (an ungated surround would black the frame). cornerPx is
 * viewport-relative (driver passes the hotspot's farthest-corner distance),
 * so the enclosure always reaches the screen edges on any aspect — never a
 * peephole. Pure in (z, corner), symmetric on zoom-out. */
export function enclosureRadiusPxForZoom(zoom, latDeg, ringM = MAP_VIGNETTE_RING_M, cornerPx = null) {
  const vr = vignetteRadiusPxForZoom(zoom, latDeg, ringM);
  const c = +cornerPx;
  if (!Number.isFinite(vr) || !Number.isFinite(c) || !(c > 0)) return null;
  const n = +zoom;
  if (!Number.isFinite(n)) return null;
  const t = enclosureTForZoom(n);
  if (!(t > 0)) return null;
  return c * (1 - t) + vr * t;
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

/* Viewport ground-scale telemetry (pure, node-checkable): web-mercator
 * meters-per-pixel at a latitude, scaled by a CSS-px span. Lets the owner
 * report exactly which ground scale a satellite tile swap pops at
 * (integer zoom crossings are where Esri swaps captures). */
export const EARTH_MPP = 156543.03392;
export const EARTH_CIRC_M = 40075017; // Earth's circumference, meters (ruler maximum)
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
