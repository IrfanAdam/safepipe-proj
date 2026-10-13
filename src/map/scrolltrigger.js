// src/map/scrolltrigger.js — GATE-8-B scroll trigger (trigger only).
// Wheel drives the EXISTING map<->twin transition both directions:
//   wheel DOWN over the map -> flyToSectorThenTwin(siteSector) (forward flight)
//   wheel UP (target outside the live twin frame) -> closeTwin() (reverse-first)
// Delegates only; timing, easing, staging, and pose all live in main.js and
// are untouched here. Click on the blip keeps working as a fallback (its
// handler is separate and unmodified).
// Pure DOM helper (node-checkable): no map imports, callbacks injected.
const DOWN_THRESHOLD = 120; // accumulated +deltaY (px) to open
const UP_THRESHOLD = -120; // accumulated -deltaY (px) to close
const WINDOW_MS = 1200; // idle gap resets the accumulation
const COOLDOWN_MS = 2500; // post-fire quiet period (flight already guards too)
const CLAMP = 600; // bound stale-trackpad buildup either direction

/** Publish the scroll probe snapshot (best-effort, never throws). */
function publish(state) {
  try {
    window.__mapProbe.scroll = { ...state };
  } catch { /* probe cosmetic */ }
}

/** True when the wheel originated inside the live twin frame (canvas
 * gestures there belong to the twin — orbit/zoom — not to the close
 * trigger). Synthetic probe wheels dispatched on #app/#map pass through. */
function fromTwinFrame(e) {
  try {
    const t = e && e.target;
    if (t && typeof t.closest === 'function' && t.closest('#twin-frame')) return true;
  } catch { /* best-effort */ }
  return false;
}

/**
 * Install the wheel trigger on el.
 * @param {Object} cfg
 * @param {Element} cfg.el container (the #app root)
 * @param {() => boolean} cfg.isOpen true while the twin overlay is open
 * @param {() => boolean} cfg.isBusy true mid-flight/prewarm/reverse-wait
 * @param {() => void} cfg.onDown forward entry (flyToSectorThenTwin)
 * @param {() => void} cfg.onUp reverse entry (closeTwin)
 * @returns {() => void} uninstall
 */
export function installScrollTrigger({ el, isOpen, isBusy, onDown, onUp }) {
  const state = { armed: true, accum: 0, downs: 0, ups: 0, last: null };
  if (!el || typeof el.addEventListener !== 'function') {
    publish(state);
    return () => {};
  }
  if (el.__scrollTriggerInstalled) return () => {};
  el.__scrollTriggerInstalled = true;
  let accum = 0;
  let lastT = 0;
  let coolUntil = 0;
  const sync = (last) => {
    state.accum = Math.round(accum);
    state.last = last;
    publish(state);
  };
  publish(state);
  function onWheel(e) {
    try {
      // Pinch-zoom (trackpad) belongs to the map — never a transition.
      if (e.ctrlKey || e.metaKey) return;
      const dy = +(e.deltaY || 0);
      if (!Number.isFinite(dy) || dy === 0) return;
      const now = Date.now();
      if (now - lastT > WINDOW_MS) accum = 0;
      lastT = now;
      accum = Math.max(-CLAMP, Math.min(CLAMP, accum + dy));
      const open = !!(isOpen && isOpen());
      if (!open && accum >= DOWN_THRESHOLD) {
        accum = 0;
        if (now < coolUntil || (isBusy && isBusy())) {
          sync('down-ignored-busy');
          return;
        }
        coolUntil = now + COOLDOWN_MS;
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
      if (open && accum <= UP_THRESHOLD) {
        if (fromTwinFrame(e)) return; // twin canvas gesture — leave it alone
        accum = 0;
        if (now < coolUntil) {
          sync('up-ignored-cooldown');
          return;
        }
        coolUntil = now + COOLDOWN_MS;
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
    } catch { /* trigger never breaks the map */ }
  }
  try {
    // Capture + non-passive: a FIRED wheel must win over maplibre scrollZoom;
    // unfired accumulation leaves the default zoom path untouched.
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
