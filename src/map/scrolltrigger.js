// src/map/scrolltrigger.js — GATE-3 GESTURE REVISION (handoff 11-A): ONE smooth
// continuous journey driver for wheel + pinch.
// Wheel, trackpad pinch (ctrl/meta-wheel) and two-finger touch pinch ALL funnel
// into a SINGLE integrator (accum px -> progress 0..1) that drives zoom depth,
// center ease and sat fade in main.js — no autonomous jumps, no dead zones.
//   scroll DOWN / pinch OUT -> progress += (zoom in toward the hotspot)
//   scroll UP   / pinch IN  -> progress -= (zoom back out)
// Edge entries fire exactly once per crossing:
//   progress >= 1 (closed) -> onDown()  (forward handoff flight)
//   progress <= 0 (open)    -> onUp()    (reverse-first close)
// Every consumed gesture calls onProgress(progress, px, source) so the map
// scrubs continuously. Twin-frame gestures are exempt.
// Pure DOM helper (node-checkable): no map imports, callbacks injected.
//
// Handoff-10 prescriptions honored (FM-1/2/4/5/7/8):
//   FM-1 native scrollZoom fight: EVERY consumed wheel/pinch is
//         preventDefault+stopPropagation'd (not only fired edges); main.js
//         additionally constructs the map with scrollZoom:false and disables
//         the touchZoomRotate handler so no native zoom can chase jumpTo.
//   FM-2 recede hijack: isReceding() swallows gestures (frame held, no
//         progress motion) for the whole recede leg; main.js also guards
//         landHome idempotent so a jumpTo-sourced moveend can't strand home.
//   FM-4 momentum drinking: sub-4px ticks are ATTENUATED (x0.5), never
//         dropped (trackpad bursts stay monotonic); direction-flip micro
//         deltas need a sustained sign (x0.3) so momentum tails can't pump
//         uncommanded progress.
//   FM-5 entry asymmetry: trackpad pinch arrives as ctrl-wheel and counts
//         the same as a mouse wheel — one accumulated journey, no per-event
//         threshold, so small-tick devices enter exactly like mice.
//   FM-7 deltaMode: line/page wheels scale to px (x16 / x800) before shaping.
//   FM-8 single integrator: accum IS the journey (0..JOURNEY_PX px); progress
//         derives from it — no parallel raw-dy integration, no misleading
//         diagnostics. Clamp is exactly the journey range: reversal is
//         immediate, no overshoot dead zone at either edge.
const JOURNEY_PX = 1000; // full journey in gesture px (wheel-px equivalent)
const PROGRESS_PER_PX = 1 / JOURNEY_PX;
const DOWN_EDGE = 1; // fire forward at full progress
const UP_EDGE = 0; // fire reverse at empty progress
const REARM_DOWN_BELOW = 0.85; // drop below this to re-arm the down edge
const REARM_UP_ABOVE = 0.15; // rise above this to re-arm the up edge
const WINDOW_MS = 1200; // idle gap decays gesture velocity only (progress persists)
const SUBPX_PX = 4; // FM-4: below this a tick is momentum-suspect
const SUBPX_ATTEN = 0.5; // ... attenuated, never dropped (bursts stay monotonic)
const FLIP_PX = 8; // FM-4: below this a sign-flip needs a sustained run
const FLIP_ATTEN = 0.3;
const PINCH_GAIN = 2; // two-finger touch px -> journey px
const WHEEL_PINCH_GAIN = 1; // ctrl/meta-wheel already arrives in px: same scale
const LINE_PX = 16; // FM-7: deltaMode 1 (lines) -> px
const PAGE_PX = 800; // FM-7: deltaMode 2 (pages) -> px

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

function clampJourney(px) {
  const n = +px;
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > JOURNEY_PX ? JOURNEY_PX : n;
}

/**
 * Install the unified wheel+pinch scrub on el.
 * @param {Object} cfg
 * @param {Element} cfg.el container (the #app root)
 * @param {() => boolean} cfg.isOpen true while the twin overlay is open
 * @param {() => boolean} cfg.isBusy true mid-flight/prewarm/reverse-wait/recede
 * @param {() => boolean} [cfg.isReceding] true during the recede leg (swallow all)
 * @param {(p: number, px: number, source: string) => void} [cfg.onProgress] scrub driver (every gesture)
 * @param {() => void} [cfg.onDown] forward entry at progress >= 1
 * @param {() => void} [cfg.onUp] reverse entry at progress <= 0 (when open)
 * @returns {() => void} uninstall
 */
export function installScrollTrigger({ el, isOpen, isBusy, isReceding, onProgress, onDown, onUp }) {
  const state = {
    armed: true, accum: 0, progress: 0, depth: 0,
    downs: 0, ups: 0, last: null,
    vel: 0, source: null, pinchIn: 0, pinchOut: 0, consumed: 0,
  };
  if (!el || typeof el.addEventListener !== 'function') {
    publish(state);
    return () => {};
  }
  if (el.__scrollTriggerInstalled) return () => {};
  el.__scrollTriggerInstalled = true;
  // THE single integrator: journey px in [0, JOURNEY_PX]. progress derives.
  let accum = 0;
  let progress = 0;
  let lastT = 0;
  let vel = 0; // journey-px per ms (EMA) — feeds the map-side precache predictor
  let lastSign = 0;
  let downArmed = true;
  let upArmed = true;
  const sync = (last) => {
    state.accum = Math.round(accum);
    state.progress = +progress.toFixed(4);
    state.depth = +progress.toFixed(4);
    state.last = last;
    state.vel = +vel.toFixed(4);
    publish(state);
  };
  const consume = (e) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      state.consumed += 1;
    } catch { /* best-effort */ }
  };
  // Map-side reset (called after a close lands home): journey restarts at 0.
  try {
    el.__scrollScrubReset = () => {
      try {
        accum = 0;
        progress = 0;
        vel = 0;
        lastSign = 0;
        downArmed = true;
        upArmed = true;
        sync('reset');
      } catch { /* reset is best-effort */ }
    };
    el.__scrollScrubSet = (p) => {
      try {
        const n = +p;
        const c = Number.isFinite(n) ? (n < 0 ? 0 : n > 1 ? 1 : n) : 0;
        accum = c * JOURNEY_PX;
        progress = c;
        downArmed = progress < REARM_DOWN_BELOW;
        upArmed = progress > REARM_UP_ABOVE;
        sync(state.last);
      } catch { /* set is best-effort */ }
    };
  } catch { /* handle exposure is best-effort */ }
  publish(state);

  /** FM-4 momentum shaping: attenuate suspect ticks, never drop them. */
  function shapeDy(dy) {
    let s = dy;
    const ad = Math.abs(s);
    const sign = s > 0 ? 1 : -1;
    if (ad < SUBPX_PX) s *= SUBPX_ATTEN;
    if (lastSign !== 0 && sign !== lastSign && ad < FLIP_PX) s *= FLIP_ATTEN;
    if (sign !== 0) lastSign = sign;
    return s;
  }

  function trackVel(shapedPx, now) {
    try {
      const dt = Math.max(1, now - lastT);
      const inst = shapedPx / dt;
      vel = vel * 0.7 + inst * 0.3;
      if (!Number.isFinite(vel)) vel = 0;
    } catch { /* velocity is best-effort */ }
  }

  /** THE one driver: every gesture lands here. Returns what happened. */
  function addDelta(px, source, e) {
    try {
      if (fromTwinFrame(e)) return 'twin-exempt';
    } catch { /* guard is best-effort */ }
    // FM-2: recede holds the frame — swallow, never move, never edge.
    try {
      if (isReceding && isReceding()) {
        vel = 0;
        state.source = source;
        sync('recede-hold');
        consume(e);
        return 'recede-hold';
      }
    } catch { /* recede guard is best-effort */ }
    // Re-arm edges once the journey leaves the bound zone.
    if (progress < REARM_DOWN_BELOW) downArmed = true;
    if (progress > REARM_UP_ABOVE) upArmed = true;
    let busy = false;
    try {
      busy = !!(isBusy && isBusy());
    } catch { /* busy is best-effort */ }
    const open = (() => { try { return !!(isOpen && isOpen()); } catch { return false; } })();
    if (open && busy) {
      // Mid-flight/prewarm/reverse: hold the frame, still publish + consume.
      state.source = source;
      sync(source);
      consume(e);
      return 'busy-hold';
    }
    accum = clampJourney(accum + px);
    progress = accum * PROGRESS_PER_PX;
    state.source = source;
    // Scrub driver first: zoom depth + center + fade track this value.
    try {
      onProgress && onProgress(progress, px, source);
    } catch { /* scrub driver reports its own errors */ }
    // Edge entries: exactly once per crossing, never autonomous jumps.
    // Epsilon: float accumulation (e.g. 10x0.1) can land at 0.9999999.
    if (!open && progress >= DOWN_EDGE - 1e-6 && downArmed) {
      downArmed = false;
      if (busy) {
        sync('down-ignored-busy');
        consume(e);
        return 'down-ignored-busy';
      }
      state.downs += 1;
      sync('down');
      consume(e);
      try {
        onDown && onDown();
      } catch { /* entry reports its own errors */ }
      return 'down';
    }
    if (open && progress <= UP_EDGE + 1e-6 && upArmed) {
      upArmed = false;
      state.ups += 1;
      sync('up');
      consume(e);
      try {
        onUp && onUp();
      } catch { /* entry reports its own errors */ }
      return 'up';
    }
    sync(source);
    consume(e); // FM-1: every consumed gesture wins over native zoom
    return 'scrub';
  }

  function onWheel(e) {
    try {
      // DEFECT 1: pinch-zoom is NOT exempt anymore — ctrl/meta-wheel is the
      // trackpad pinch-zoom gesture and drives the SAME journey as the wheel.
      if (fromTwinFrame(e)) return;
      let dy = +(e.deltaY || 0);
      if (!Number.isFinite(dy) || dy === 0) return;
      // FM-7: scale line/page deltas to px before shaping.
      try {
        const m = e.deltaMode || 0;
        if (m === 1) dy *= LINE_PX;
        else if (m === 2) dy *= PAGE_PX;
      } catch { /* deltaMode read is best-effort */ }
      const pinch = !!((e && e.ctrlKey) || (e && e.metaKey));
      const now = Date.now();
      if (now - lastT > WINDOW_MS) vel = 0; // idle: decay velocity, keep journey
      const shaped = shapeDy(dy) * (pinch ? WHEEL_PINCH_GAIN : 1);
      trackVel(shaped, now);
      lastT = now;
      addDelta(shaped, pinch ? 'pinch-wheel' : 'wheel', e);
    } catch { /* scrub never breaks the map */ }
  }

  // DEFECT 1: two-finger touch pinch drives the same integrator. Pinch OUT
  // (fingers spread) zooms the journey in; pinch IN recedes — mirroring the
  // wheel direction contract. Single-finger pan is untouched (map dragPan).
  let pinchDist = null;
  function touchDist(t0, t1) {
    try {
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    } catch {
      return null;
    }
  }
  function onTouchStart(e) {
    try {
      const t = (e && e.touches) || [];
      pinchDist = t.length === 2 ? touchDist(t[0], t[1]) : null;
    } catch { pinchDist = null; }
  }
  function onTouchMove(e) {
    try {
      const t = (e && e.touches) || [];
      if (t.length !== 2) {
        pinchDist = null;
        return;
      }
      if (fromTwinFrame(e)) return;
      const d = touchDist(t[0], t[1]);
      if (!Number.isFinite(d) || d <= 0) return;
      if (pinchDist == null || !Number.isFinite(pinchDist)) {
        pinchDist = d;
        return;
      }
      const dd = (d - pinchDist) * PINCH_GAIN;
      pinchDist = d;
      if (dd === 0) return;
      if (dd > 0) state.pinchOut += 1;
      else state.pinchIn += 1;
      const now = Date.now();
      if (now - lastT > WINDOW_MS) vel = 0;
      trackVel(dd, now);
      lastT = now;
      addDelta(dd, 'pinch', e);
    } catch { /* scrub never breaks the map */ }
  }
  function onTouchEnd(e) {
    try {
      const t = (e && e.touches) || [];
      pinchDist = t.length === 2 ? touchDist(t[0], t[1]) : null;
      if (t.length < 2) vel = vel * 0.5; // fingers lifted: momentum dies fast
    } catch { pinchDist = null; }
  }
  try {
    // Capture + non-passive: every consumed gesture must win over MapLibre
    // native handlers AND the browser pinch-zoom default.
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
  } catch {
    el.addEventListener('wheel', onWheel);
  }
  try {
    el.addEventListener('touchstart', onTouchStart, { passive: true });
  } catch {
    el.addEventListener('touchstart', onTouchStart);
  }
  try {
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  } catch {
    el.addEventListener('touchmove', onTouchMove);
  }
  try {
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
  } catch {
    try { el.addEventListener('touchend', onTouchEnd); } catch { /* best-effort */ }
  }
  return () => {
    try {
      el.removeEventListener('wheel', onWheel, { capture: true });
    } catch { /* teardown best-effort */ }
    try {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove, { capture: true });
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    } catch { /* teardown best-effort */ }
    try {
      el.__scrollTriggerInstalled = false;
    } catch { /* flag teardown best-effort */ }
  };
}
