/* Safepipe Ops3D Ring-2 — src/ring2/mix.js (Phase 3, Task 8).
 * One slider owns the seamless crossfade. 0 = pure map (twin invisible),
 * 100 = pure twin (map ground hidden, twin takes over). Mid = blend.
 *
 *   - Drives the twin canvas opacity + overlay emphasis (setEmphasis).
 *   - Takeover rule: mix >= 99 forces setGroundOwns(false) at ANY pitch,
 *     so TOP-down at slider 100 shows zero satellite photo. The TOP-only
 *     satellite rule (pitch < TOP_PITCH_DEG forces satellite full) applies
 *     below 99 only.
 *   - Canvas-identity watch: a MutationObserver on the twin container
 *     re-applies the full mix (opacity + pointer-events + emphasis) whenever
 *     the canvas remounts, so a remount can never reset to a stale look
 *     (v1 remount-opacity class). Mix also persists to localStorage.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-3]
 */
import { setGroundOwns, getGroundOwns, IMAGERY_LAYER_ID, HILLSHADE_LAYER_ID, REFERENCE_LAYER_ID } from './mapbase.js';

export const MIX_STORE_KEY = 'ring2.mix';
export const TOP_PITCH_DEG = 20;
export const TWIN_TAKEOVER_MIX = 99;

export function clampMix(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function loadMix(fallback = 50) {
  try {
    const raw = localStorage.getItem(MIX_STORE_KEY);
    if (raw === null) return clampMix(fallback);
    return clampMix(raw);
  } catch {
    return clampMix(fallback);
  }
}

export function saveMix(v) {
  try {
    localStorage.setItem(MIX_STORE_KEY, String(clampMix(v)));
  } catch { /* private-mode: memory still holds the mix */ }
}

export function mountMixBar(el, opts = {}) {
  if (!el) throw new Error('mountMixBar: bar container required');
  const {
    getTwinCanvas = () => document.querySelector('[data-ring2="twin"]'),
    getTwinContainer = () => getTwinCanvas()?.parentElement ?? null,
    getMap = () => null,
    applyEmphasis = () => {},
    getPitchDeg = () => 0,
    initial = loadMix(50),
  } = opts;

  let mix = clampMix(initial);
  let lastPitch = getPitchDeg();
  let lastCanvas = null;
  const subs = new Set();
  const emit = () => {
    for (const cb of subs) {
      try {
        cb(mix);
      } catch { /* listener errors never break the slider */ }
    }
  };

  const bar = document.createElement('div');
  bar.className = 'ring2-mix';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Map-twin mix');
  bar.innerHTML =
    '<button type="button" class="ring2-mix__end" data-end="sat" title="Pure map">SAT</button>' +
    '<input type="range" class="ring2-mix__slider" min="0" max="100" step="1" aria-label="Map to twin mix" />' +
    '<button type="button" class="ring2-mix__end" data-end="twin" title="Pure twin">TWIN</button>' +
    '<span class="ring2-mix__val" aria-live="polite"></span>';
  el.appendChild(bar);

  const slider = bar.querySelector('.ring2-mix__slider');
  const val = bar.querySelector('.ring2-mix__val');
  slider.value = String(mix);

  function paintLabel() {
    val.textContent = `${mix}`;
    bar.dataset.mix = String(mix);
    bar.dataset.ground = getGroundOwns() ? 'sat' : 'twin';
  }

  /* Full mix application: canvas opacity + events + emphasis + ground rule. */
  function forceGroundLayers() {
    // mapbase.setGroundOwns owns the flag but only applies it while the map
    // reports loaded() — and our per-frame jumpTo sync keeps loaded() false
    // forever, so apply the flagged state directly to the live layers here.
    // setLayoutProperty works on idle-or-busy maps; missing layers are
    // skipped (flag still reapplies on mount inside mapbase).
    const m = getMap();
    if (!m || typeof m.setLayoutProperty !== 'function') return;
    const vis = getGroundOwns() ? 'visible' : 'none';
    for (const id of [IMAGERY_LAYER_ID, HILLSHADE_LAYER_ID, REFERENCE_LAYER_ID]) {
      try {
        m.setLayoutProperty(id, 'visibility', vis);
      } catch { /* layer absent — mapbase flag covers the next mount */ }
    }
  }

  function reapply() {
    // Dead-end guard: stored mix 0 + map still mounting = empty viewport
    // with orbit going nowhere. While the map object doesn't exist, floor
    // the EFFECTIVE mix at 50 so the live twin stays visible and
    // interactive; the stored value (pill) is untouched and takes over the
    // moment the map lands.
    const effMix = (!getMap?.() && mix < 50) ? 50 : mix;
    const t = effMix / 100;
    const canvas = getTwinCanvas();
    lastCanvas = canvas ?? lastCanvas;
    if (canvas) {
      canvas.style.opacity = String(t);
      // Pure-map end: twin gets out of the way so the map is directly
      // interactive; any visible twin owns orbit (sync drives the map).
      canvas.style.pointerEvents = t < 0.02 ? 'none' : 'auto';
    }
    try {
      applyEmphasis(t);
    } catch { /* emphasis is cosmetic */ }
    applyGroundRule(lastPitch);
    forceGroundLayers();
    paintLabel();
  }

  /* Takeover rule: mix >= 99 forces twin ground at ANY pitch (TOP-down
   * at slider 100 shows zero satellite photo). The TOP-only satellite
   * rule applies below 99 only. */
  function applyGroundRule(pitchDeg) {
    lastPitch = pitchDeg;
    if (mix >= TWIN_TAKEOVER_MIX) {
      setGroundOwns(false);
    } else if (pitchDeg < TOP_PITCH_DEG) {
      setGroundOwns(true); // satellite full at TOP
    } else {
      setGroundOwns(mix < TWIN_TAKEOVER_MIX); // below 99 the map keeps ground
    }
    forceGroundLayers();
    paintLabel();
  }

  function setMix(v, { silent = false } = {}) {
    const next = clampMix(v);
    if (next === mix && slider.value === String(next)) return mix;
    mix = next;
    slider.value = String(mix);
    saveMix(mix);
    reapply();
    if (!silent) emit();
    return mix;
  }

  slider.addEventListener('input', () => setMix(slider.value));
  slider.addEventListener('change', () => setMix(slider.value));
  bar.querySelector('[data-end="sat"]').addEventListener('click', () => setMix(0));
  bar.querySelector('[data-end="twin"]').addEventListener('click', () => setMix(100));

  /* Canvas-identity watch: any remount re-applies the full mix. */
  const seen = () => getTwinContainer();
  const observer = new MutationObserver(() => {
    const cur = getTwinCanvas();
    if (cur !== lastCanvas || cur?.style.opacity !== String(mix / 100)) {
      reapply();
    }
  });
  const watchRoot = seen() ?? el;
  observer.observe(watchRoot, { childList: true, subtree: true });

  /** Per-frame hook from main.js: re-resolves canvas identity + ground rule. */
  function updateForCamera(pitchDeg) {
    const cur = getTwinCanvas();
    if (cur !== lastCanvas) {
      reapply();
    } else {
      applyGroundRule(pitchDeg);
    }
  }

  function onMix(cb) {
    subs.add(cb);
    return () => subs.delete(cb);
  }

  function dispose() {
    observer.disconnect();
    subs.clear();
    bar.remove();
  }

  reapply();
  saveMix(mix);

  return {
    bar, slider,
    getMix: () => mix,
    setMix,
    reapply,
    updateForCamera,
    onMix,
    dispose,
  };
}
