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
import { RING_RADIUS_M } from '../ring2/site.js';

export const Z_MIN = 6.4; // country home — enforced as map minZoom (the cap)
export const Z_FADE0 = 6.4; // fade starts: vector->sat keys off zoom only
export const Z_FADE1 = 9.0; // fade ends: full sat well before the handoff (works at ANY center)
export const Z_CENTER = 7.0; // proximity centering + brackets arm past this zoom
export const Z_ISO_START = Z_FADE1; // terrain->iso begins when the satellite is full
export const Z_TOP = 10.5; // iso checkpoint: terrain->iso completes here; the twin dissolve begins here
export const Z_HANDOFF = 11.5; // iso->twin completes here (the twin owns the pose at/above this)
export const Z_MAX = 14.0; // map maxZoom cap
const HOME_EPS = 0.06; // zoomend-at-home tolerance for the reverse edge
// Single source for the re-arm gate below the staged entry (derived, never restated).
export const REARM_DOWN_BELOW = Z_TOP - 0.5; // drop below to re-arm onDown / staging
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

/** Centering arms past Z_CENTER (proximity-gated by main.js). */
export function shouldCenter(z) {
  return Number.isFinite(+z) && +z >= Z_CENTER;
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
 * Ring/blend/tilt already arrive pre-gate in the native journey (Z_TOP..Z_HANDOFF
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
 * rx SEAM_HOLD_RX_PX with ry squashed by the iso-pole tilt projection
 * (rx * cos(ISO_PITCH_DEG)) — instead of re-deriving it from the frozen
 * live zoom. Pure fn of S: identical at/above Z_HANDOFF (no zoom input, so
 * no zoom dependence past the gate) and repainted on every staged tick, so
 * the seam stays under finger control while depth is clamped. Constant
 * across S by design (a hold, not travel — scroll-up retraces it
 * trivially); non-finite S still parks the seam, never blanks the chrome. */
export const SEAM_HOLD_RX_PX = 242.2; // ring ground radius projected at Z_HANDOFF over the site parallel, CSS px
export function seamHoldEllipseForS(s) {
  void s; // the value is the seam itself — S owns the repaint cadence, not the radius
  const rx = SEAM_HOLD_RX_PX;
  return { rx, ry: rx * Math.cos(ISO_PITCH_DEG * DEG2RAD) };
}

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
  // over-zoomed the map (121px vs the twin's 242px clip) — the owner sees the
  // circle shrink too far before the twin arrives. Evaluate at the handoff so
  // the circle lands on the twin's clip and holds there.
  const vr = vignetteRadiusPxForZoom(Z_HANDOFF, latDeg, ringM);
  const c = +cornerPx;
  if (!Number.isFinite(vr) || !Number.isFinite(c) || !(c > 0)) return null;
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
