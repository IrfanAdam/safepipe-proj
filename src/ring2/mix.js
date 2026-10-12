/* Safepipe Ops3D Ring-2 — src/ring2/mix.js (Phase 3, Task 8).
 * One slider owns the seamless crossfade. 0 = bare satellite photo (twin
 * ground gone, overlays at zero, all satellite layers visible); mid =
 * overlay emphasis over live satellite; 100 = full twin takeover (opaque
 * twin ground in, satellite ground hidden under it).
 *
 *   - Drives the twin canvas opacity + overlay emphasis (setEmphasis) +
 *     takeover-ground opacity (setTakeover, see takeover.js thresholds) +
 *     satellite-base fade (setGroundFade, same smoothstep band).
 *   - Endpoint rule: the satellite hides ONLY at mix 100, the exact step
 *     the twin ground reaches opaque (same condition both sides — the old
 *     anytime-takeover black hole can't recur); across the mix band the
 *     photo base dissolves out as paint opacity while the twin ground
 *     dissolves in, so the base swap never jumps.
 *   - Tilt takeover (owner verdict 2026-10-12): at steep tilt + close range
 *     the twin takes the base regardless of slider — u is the max-merge of
 *     the mix ramp and tiltU(pitch, range), the satellite fades as (1 - u)
 *     so base + twin always sum to 1, and emphasis follows max(t, u) so the
 *     (never tilt-faded) lines stay lit when tilt takes over.
 *   - Canvas-identity watch: a MutationObserver on the twin container
 *     re-applies the full mix (opacity + pointer-events + emphasis) whenever
 *     the canvas remounts, so a remount can never reset to a stale look
 *     (v1 remount-opacity class). Mix also persists to localStorage.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-3]
 */
import { setGroundOwns, getGroundOwns, setGroundFade } from './mapbase.js';
import { takeoverU, groundHidden } from './takeover.js';
import { twinPointerEvents, tiltU } from './sync.js';

export const MIX_STORE_KEY = 'ring2.mix';
export const TOP_PITCH_DEG = 20; // retired: ground no longer pitch-gated (kept for API compat)
export const TWIN_TAKEOVER_MIX = 99; // retired: takeover removed, ground always on (kept for API compat)

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
    setTakeover = () => {},
    getPitchDeg = () => 0,
    getRangeM = () => Infinity,
    initial = loadMix(50),
  } = opts;

  let mix = clampMix(initial);
  let lastPitch = getPitchDeg();
  let lastRange = getRangeM();
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

  /* Full mix application: canvas opacity + events + emphasis + takeover
   * pair (twin-ground ramp in overlays + satellite-base fade in mapbase,
   * same steps both sides) + ground endpoint rule. The takeover u is the
   * max-merge of the mix ramp and the tilt takeover (see effUNow) — base +
   * twin always sum to 1, so a black hole is impossible from either side. */
  function reapply() {
    // Dead-end guard: stored mix 0 + map still mounting = empty viewport
    // with orbit going nowhere. While the map object doesn't exist, floor
    // the EFFECTIVE mix at 50 so the live twin stays visible and
    // interactive; the stored value (pill) is untouched and takes over the
    // moment the map lands.
    const effMix = effMixNow();
    const t = effMix / 100;
    const u = effUNow();
    const canvas = getTwinCanvas();
    lastCanvas = canvas ?? lastCanvas;
    if (canvas) {
      // Canvas stays opaque: the ring mask lives on this canvas and must
      // survive at every mix. Overlay fade rides on emphasis alone.
      canvas.style.opacity = '1';
      // Twin owns the camera at EVERY mix (satellite mode included): the
      // canvas stays pointer-interactive so OrbitControls always receives
      // orbit input and the map follows via sync. pointer-events:none here
      // used to freeze satellite mode (twin got no input AND the map was
      // constructed interactive, fighting the sync).
      canvas.style.pointerEvents = twinPointerEvents(effMix);
    }
    try {
      applyEmphasis(Math.max(t, u));
    } catch { /* emphasis is cosmetic */ }
    try {
      setTakeover(u);
    } catch { /* takeover ground is cosmetic */ }
    applyGroundRule(lastPitch);
    paintLabel();
  }

  /* Effective mix: the dead-end floor in one place so the ground rule and
   * the takeover ramp always agree (no step where the satellite hides but
   * the twin ground isn't opaque, and vice versa). */
  function effMixNow() {
    return (!getMap?.() && mix < 50) ? 50 : mix;
  }

  /* Smooth base crossfade (was: binary satellite hide at mix 100). Every
   * reapply drives BOTH sides of the dissolve over the SAME steps: the twin
   * ground ramps 0->1 via setTakeover(u) in reapply, and here the satellite
   * base fades to (1 - u) via setGroundFade as raster-opacity /
   * hillshade-exaggeration paint — u is the max-merge (see effUNow), so the
   * mix band and the close-range tilt takeover share one law and base +
   * twin always sum to 1. setGroundOwns keeps the slider ENDPOINT only:
   * layers stay layout-visible through the band and hide exactly at mix
   * 100, the step the mix-driven twin ground reaches opaque.
   * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
  function applyGroundRule(pitchDeg, rangeM) {
    if (pitchDeg !== undefined) lastPitch = pitchDeg;
    if (Number.isFinite(Number(rangeM))) lastRange = Number(rangeM);
    const eff = effMixNow();
    const u = effUNow();
    try {
      setGroundFade(1 - u);
    } catch { /* base fade is cosmetic */ }
    setGroundOwns(!groundHidden(eff));
    paintLabel();
  }

  /* Central takeover law (single source of truth — reapply + applyGroundRule
   * both consume it, so the twin ground, the satellite fade and the
   * endpoint rule can never disagree): u = max(takeoverU(effMix),
   * tiltU(pitch, range)). Slider owns the base top-down at any range;
   * steep + close tilt takes it regardless of slider. */
  function effUNow() {
    return Math.max(takeoverU(effMixNow()), tiltU(lastPitch, lastRange));
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
    if (getTwinCanvas() !== lastCanvas) reapply();
  });
  const watchRoot = seen() ?? el;
  observer.observe(watchRoot, { childList: true, subtree: true });

  /** Per-frame hook from main.js: re-resolves canvas identity + ground rule.
   * Feeds the tilt takeover (pitch + eye-to-target range) before applying,
   * so a remount reapply also sees the fresh camera. */
  function updateForCamera(pitchDeg, rangeM) {
    if (pitchDeg !== undefined) lastPitch = pitchDeg;
    if (Number.isFinite(Number(rangeM))) lastRange = Number(rangeM);
    const cur = getTwinCanvas();
    if (cur !== lastCanvas) {
      reapply();
    } else {
      applyGroundRule(lastPitch);
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
    // Effective mix after the pre-map dead-end floor (mix < 50 with no map
    // reads 50 so the live twin stays visible). Feeds the eff: telemetry
    // token so the bar can show stored vs effective side by side.
    getEffMix: () => effMixNow(),
  };
}
