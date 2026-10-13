// src/map/scrolltrigger.js — GATE-9-A scroll SCRUB (continuous journey).
// Wheel delta accumulates into ONE journey progress value (0..1) that drives
// zoom depth, center ease, and sat fade in main.js — no autonomous jumps.
//   wheel DOWN (dy>0) -> progress += dy*k  (zoom in toward the hotspot)
//   wheel UP   (dy<0) -> progress -= |dy|*k (zoom back out)
// Edge entries fire exactly once per crossing:
//   progress >= 1 (closed) -> onDown()  (forward handoff flight)
//   progress <= 0 (open)    -> onUp()    (reverse-first close)
// Every wheel also calls onProgress(progress, dy) so the map scrubs
// continuously. Pinch-zoom (ctrl/meta) and twin-frame gestures are exempt.
// Pure DOM helper (node-checkable): no map imports, callbacks injected.
const PROGRESS_PER_PX = 1 / 1000; // full journey per ~1000px of wheel delta
const DOWN_EDGE = 1; // fire forward at full progress
const UP_EDGE = 0; // fire reverse at empty progress
const REARM_DOWN_BELOW = 0.85; // drop below this to re-arm the down edge
const REARM_UP_ABOVE = 0.15; // rise above this to re-arm the up edge
const CLAMP_PX = 1500; // bound stale-trackpad buildup either direction
const WINDOW_MS = 1200; // idle gap resets the px accumulator only (progress persists)

/** Publish the scroll probe snapshot (best-effort, never throws). */
function publish(state) {
  try {
    window.__mapProbe.scroll = { ...state };
  } catch { /* probe cosmetic */ }
}

/** True when the wheel originated inside the live twin frame (canvas
 * gestures there belong to the twin — orbit/zoom — not to the scrub). */
function fromTwinFrame(e) {
  try {
    const t = e && e.target;
    if (t && typeof t.closest === 'function' && t.closest('#twin-frame')) return true;
  } catch { /* best-effort */ }
  return false;
}

function clamp01(v) {
  const n = +v;
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Install the wheel scrub on el.
 * @param {Object} cfg
 * @param {Element} cfg.el container (the #app root)
 * @param {() => boolean} cfg.isOpen true while the twin overlay is open
 * @param {() => boolean} cfg.isBusy true mid-flight/prewarm/reverse-wait
 * @param {(p: number, dy: number) => void} [cfg.onProgress] scrub driver (every wheel)
 * @param {() => void} [cfg.onDown] forward entry at progress >= 1
 * @param {() => void} [cfg.onUp] reverse entry at progress <= 0 (when open)
 * @returns {() => void} uninstall
 */
export function installScrollTrigger({ el, isOpen, isBusy, onProgress, onDown, onUp }) {
  const state = {
    armed: true, accum: 0, progress: 0, depth: 0,
    downs: 0, ups: 0, last: null,
  };
  if (!el || typeof el.addEventListener !== 'function') {
    publish(state);
    return () => {};
  }
  if (el.__scrollTriggerInstalled) return () => {};
  el.__scrollTriggerInstalled = true;
  let accum = 0;
  let progress = 0;
  let lastT = 0;
  let downArmed = true;
  let upArmed = true;
  const sync = (last) => {
    state.accum = Math.round(accum);
    state.progress = +progress.toFixed(4);
    state.depth = +progress.toFixed(4);
    state.last = last;
    publish(state);
  };
  // Map-side reset (called after a close lands home): journey restarts at 0.
  try {
    el.__scrollScrubReset = () => {
      try {
        accum = 0;
        progress = 0;
        downArmed = true;
        upArmed = true;
        sync('reset');
      } catch { /* reset is best-effort */ }
    };
    el.__scrollScrubSet = (p) => {
      try {
        progress = clamp01(p);
        downArmed = progress < REARM_DOWN_BELOW;
        upArmed = progress > REARM_UP_ABOVE;
        sync(state.last);
      } catch { /* set is best-effort */ }
    };
  } catch { /* handle exposure is best-effort */ }
  publish(state);
  function onWheel(e) {
    try {
      // Pinch-zoom (trackpad) belongs to the map — never a transition.
      if (e.ctrlKey || e.metaKey) return;
      // Twin canvas gestures are never hijacked — leave progress alone.
      if (fromTwinFrame(e)) return;
      const dy = +(e.deltaY || 0);
      if (!Number.isFinite(dy) || dy === 0) return;
      const now = Date.now();
      if (now - lastT > WINDOW_MS) accum = 0;
      lastT = now;
      accum = Math.max(-CLAMP_PX, Math.min(CLAMP_PX, accum + dy));
      // Continuous scrub: every wheel moves the single journey value.
      progress = clamp01(progress + dy * PROGRESS_PER_PX);
      const open = !!(isOpen && isOpen());
      // Re-arm edges once the journey leaves the bound zone.
      if (progress < REARM_DOWN_BELOW) downArmed = true;
      if (progress > REARM_UP_ABOVE) upArmed = true;
      // Scrub driver first: zoom depth + center + fade track this value.
      try {
        if (open && (isBusy && isBusy())) {
          // Mid-flight/prewarm/reverse: hold the frame, still publish.
        } else {
          onProgress && onProgress(progress, dy);
        }
      } catch { /* scrub driver reports its own errors */ }
      // Edge entries: exactly once per crossing, never autonomous jumps.
      // Epsilon: float accumulation (e.g. 10x0.1) can land at 0.9999999.
      if (!open && progress >= DOWN_EDGE - 1e-6 && downArmed) {
        downArmed = false;
        if (isBusy && isBusy()) {
          sync('down-ignored-busy');
          return;
        }
        state.downs += 1;
        sync('down');
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch { /* best-effort */ }
        try {
          onDown && onDown();
        } catch { /* entry reports its own errors */ }
        return;
      }
      if (open && progress <= UP_EDGE + 1e-6 && upArmed) {
        upArmed = false;
        state.ups += 1;
        sync('up');
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch { /* best-effort */ }
        try {
          onUp && onUp();
        } catch { /* entry reports its own errors */ }
        return;
      }
      sync(state.last);
    } catch { /* scrub never breaks the map */ }
  }
  try {
    // Capture + non-passive: a FIRED edge wheel must win over maplibre
    // scrollZoom; sub-edge accumulation leaves the default zoom path alone.
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
  } catch {
    el.addEventListener('wheel', onWheel);
  }
  return () => {
    try {
      el.removeEventListener('wheel', onWheel, { capture: true });
    } catch { /* teardown best-effort */ }
    try {
      el.__scrollTriggerInstalled = false;
    } catch { /* flag teardown best-effort */ }
  };
}
