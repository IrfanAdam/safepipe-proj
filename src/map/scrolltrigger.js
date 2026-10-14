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
export const Z_FADE0 = 7.2; // fade starts: vector->sat keys off zoom only
export const Z_FADE1 = 10.2; // fade ends: full sat (works at ANY center)
export const Z_CENTER = 9.0; // proximity centering arms past this zoom
export const Z_TOP = 11.0; // top-down checkpoint (bearing/pitch -> 0)
export const Z_HANDOFF = 12.0; // deeper zoom hands to the twin
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

/** Live zoom -> proximity-center blend 0..1 (CENTER..TOP span). */
export function centerBlendForZoom(z) {
  const n = +z;
  if (!Number.isFinite(n)) return 0;
  return smooth01((n - Z_CENTER) / (Z_TOP - Z_CENTER));
}

/** Centering arms past Z_CENTER (proximity-gated by main.js). */
export function shouldCenter(z) {
  return Number.isFinite(+z) && +z >= Z_CENTER;
}

/** Top-down checkpoint reached (bearing/pitch -> 0). */
export function isTopDown(z) {
  return Number.isFinite(+z) && +z >= Z_TOP;
}

/** Deep-zoom handoff threshold reached. */
export function needsHandoff(z) {
  return Number.isFinite(+z) && +z >= Z_HANDOFF;
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
