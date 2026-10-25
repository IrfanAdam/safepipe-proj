// src/map/frame-pacing.js — per-frame budget laws (pure, no DOM, no map).
//
// What this module is for: the journey's cost per FRAME, not its laws per
// tick. Measured on the live page (1100x700, Chromium/Metal, full dive +
// reverse) before these laws existed:
//   - the twin iframe rendered its whole scene AND took two synchronous
//     gl.readPixels readbacks on every animation frame while it sat behind
//     the map at opacity 0 — 69% of the journey's main-thread script time
//     (7.86s of 11.4s) and ~2ms/frame of pure GPU sync;
//   - the map driver ran once per ZOOM TICK, and a native zoom emits 'move'
//     AND 'zoom' per frame, so the same pass ran ~2x per frame, each pass
//     doing 6-16 forced-layout reads (clientWidth/getBoundingClientRect)
//     plus duplicate style/paint writes.
// These helpers are the single source for the pacing decisions so the
// node suite can pin them without a browser.

/* Keep-warm cadence for a twin that CANNOT paint (overlay hidden/prewarm/
 * closed at opacity 0): 120ms ≈ 8fps. Enough to keep its map tiles and pose
 * live (the parent pins it forward while it is hidden), while removing the
 * ~120 invisible renders + 240 readbacks per second that the full-rate loop
 * spent behind the map. */
export const HIDDEN_RENDER_MS = 120;

/* Pixel-readback cadence: the coverage/spread sample exists so the parent's
 * grant/commit gate can refuse a blank twin — a 200ms-old reading answers
 * that question as well as a per-frame one (§"any GL failure keeps the last
 * reading — withhold, never guess"). Two gl.readPixels per SAMPLE, not per
 * frame. */
export const CONTENT_SAMPLE_MS = 200;

/** Pure: can the twin overlay actually paint this frame? Inputs are the
 * overlay root's own state (hidden attribute, prewarm/closing classes, the
 * inline opacity the scrub owns). Anything unreadable counts as PAINTING —
 * the safe default is to render rather than to freeze a visible twin. */
export function overlayPaintsNow({ hidden = false, prewarm = false, closing = false, opacity = null } = {}) {
  if (hidden) return false;
  if (prewarm) return false;
  if (closing) return false;
  const op = opacity === null || opacity === undefined || opacity === '' ? null : +opacity;
  if (op !== null && Number.isFinite(op) && op <= 0.002) return false;
  return true;
}

/** Pure: is a render due on this frame? Painting frames always render; a
 * frame that cannot paint renders only once per keep-warm interval. */
export function renderDue({ paints = true, nowMs = 0, lastRenderMs = -Infinity, hiddenIntervalMs = HIDDEN_RENDER_MS } = {}) {
  if (paints) return true;
  const now = +nowMs;
  const last = +lastRenderMs;
  const iv = +hiddenIntervalMs;
  if (!Number.isFinite(now)) return true;
  if (!Number.isFinite(last)) return true;
  if (!Number.isFinite(iv) || iv <= 0) return true;
  return now - last >= iv;
}

/** Pure: is a pixel-content sample due? Same cadence rule, independent of
 * visibility (a hidden twin still has to answer "do I hold real pixels?"). */
export function sampleDue({ nowMs = 0, lastSampleMs = -Infinity, intervalMs = CONTENT_SAMPLE_MS } = {}) {
  const now = +nowMs;
  const last = +lastSampleMs;
  const iv = +intervalMs;
  if (!Number.isFinite(now)) return true;
  if (!Number.isFinite(last)) return true;
  if (!Number.isFinite(iv) || iv <= 0) return true;
  return now - last >= iv;
}

/* Zoom sources in priority order: a settle (zoomend) carries laws a running
 * gesture never runs (reconcile, catch-up, staged exit), so if ANY step in a
 * coalesced frame is a zoomend, the single pass runs as one. */
export const STEP_SOURCES = Object.freeze(['native-zoomend', 'native-early', 'native-zoom', 'native-move', 'native-init']);

/** Pure: fold several queued step sources into the ONE source the coalesced
 * pass runs as. Unknown/empty sources fall back to 'native-zoom'. */
export function coalesceStepSource(sources) {
  const list = Array.isArray(sources) ? sources : [sources];
  let best = -1;
  for (const s of list) {
    const idx = STEP_SOURCES.indexOf(s);
    if (idx >= 0 && (best < 0 || idx < best)) best = idx;
  }
  return best < 0 ? 'native-zoom' : STEP_SOURCES[best];
}

/** Pure: frame series statistics (deltas in ms). Used by the regression
 * model and by the live probe to state the same numbers. */
export function frameBudgetStats(deltas = []) {
  const d = (Array.isArray(deltas) ? deltas : [])
    .map((v) => +v)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (!d.length) return { n: 0, median: null, p95: null, p99: null, max: null, longFrames: 0, over3x: 0 };
  const at = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
  const median = at(0.5);
  const limit = 2 * median;
  return {
    n: d.length,
    median: +median.toFixed(2),
    p95: +at(0.95).toFixed(2),
    p99: +at(0.99).toFixed(2),
    max: +d[d.length - 1].toFixed(2),
    longFrames: d.filter((v) => v > limit).length,
    over3x: d.filter((v) => v > 3 * median).length,
  };
}

/** Pure: the budget verdict — a journey passes when NO frame exceeds
 * `ratio` x the median (the owner-visible hitch test) and the median itself
 * sits inside a sane band. */
export function frameBudgetPass(stats, { ratio = 2 } = {}) {
  const s = stats || {};
  const med = +s.median;
  const max = +s.max;
  if (!Number.isFinite(med) || !Number.isFinite(max) || med <= 0) return false;
  if (!(max <= ratio * med)) return false;
  return !(s.longFrames > 0);
}

/** Pure: reversal count in a monotone-by-intent series (zoom in, or scroll
 * progress forward). A journey leg must not visibly back up: any step whose
 * delta opposes the leg's sign counts. Ties (0 delta) are not reversals. */
export function reversalsIn(series, { direction = 1, epsilon = 0 } = {}) {
  const d = (Array.isArray(series) ? series : []).map((v) => +v).filter((v) => Number.isFinite(v));
  if (d.length < 2) return 0;
  const dir = direction >= 0 ? 1 : -1;
  const eps = Math.max(0, +epsilon || 0);
  let n = 0;
  for (let i = 1; i < d.length; i++) {
    const delta = (d[i] - d[i - 1]) * dir;
    if (delta < -eps) n += 1;
  }
  return n;
}
