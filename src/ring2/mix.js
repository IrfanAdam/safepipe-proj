/* Safepipe Ops3D Ring-2 — src/ring2/mix.js (Phase 3, Task 8).
 * One slider owns the seamless crossfade. 0 = bare satellite photo (twin
 * ground gone, overlays at zero, all satellite layers visible); mid =
 * overlay emphasis over live satellite; 100 = full twin takeover (opaque
 * twin ground in, satellite ground hidden under it).
 *
 *   - Drives the twin canvas opacity + overlay emphasis (setEmphasis) +
 *     takeover-ground opacity (setTakeover, see takeover.js thresholds) +
 *     satellite-base paint (setGroundFade, held at full through the band).
 *   - Single-source crossfade (Phase-03 rev): the twin ground's alpha IS
 *     the dissolve — the satellite base stays fully painted underneath it,
 *     so the composite is photo*(1-a) + ground*a and cannot dip. The
 *     satellite hides only at mix 100, the exact step the twin ground
 *     reaches opaque (same condition both sides — the old anytime-takeover
 *     black hole can't recur, and the old double fade's mid-band dip is
 *     gone by construction).
 *   - Tilt takeover (owner verdict 2026-10-12): at steep tilt + close range
 *     the twin takes the base regardless of slider — u is the max-merge of
 *     the mix ramp and tiltU(pitch, range), the twin ground's alpha rides u
 *     (base + twin sum to 1 by alpha compositing, the photo staying painted
 *     underneath), and emphasis follows max(t, u) so the
 *     (never tilt-faded) lines stay lit when tilt takes over.
 *   - Canvas-identity watch: a MutationObserver on the twin container
 *     re-applies the full mix (opacity + pointer-events + emphasis) whenever
 *     the canvas remounts, so a remount can never reset to a stale look
 *     (v1 remount-opacity class). Mix also persists to localStorage.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-3]
 */
import { setGroundOwns, getGroundOwns, setGroundFade } from './mapbase.js';
import { takeoverU, groundHidden, gatePureSatEndpoint } from './takeover.js';
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

  let lastPaintKey = null;
  function paintLabel() {
    // Unchanged-value skip: applyGroundRule calls per frame — DOM writes only on change.
    const key = `${mix}|${getGroundOwns() ? 1 : 0}`;
    if (key === lastPaintKey) return;
    lastPaintKey = key;
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

  /* SINGLE-SOURCE BASE CROSSFADE (Phase-03 rev, seam tone).
   *
   * The twin ground's ALPHA is the crossfade — nothing else. The satellite
   * base stays fully painted underneath it, so the composite is ordinary
   * alpha compositing: photo*(1-a) + ground*a. That is the only law that
   * cannot dip, because alpha compositing already sums to 1.
   *
   * What it replaces faded BOTH sides: the ground ramped 0->1 while
   * mapbase.setGroundFade dropped the photo's raster-opacity 1->0 over the
   * same band. Two fades multiply — at mix 50 the frame was 0.5*ground over
   * (0.5*photo over the page background) = 0.5*ground + 0.25*photo +
   * 0.25*bg, a measured 60% luma dip mid-dissolve (basemap 95.1 -> 37.9 ->
   * ground 53.4 at the handoff pose) that read as a dark wash exactly where
   * the owner saw the pop. The photo now holds full paint through the band
   * and the ground's alpha alone dissolves it; setGroundOwns still hides
   * the layers at the mix-100 endpoint, the same step the ground reaches
   * opaque, so base + twin still sum to 1 with no black hole.
   * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03] */
  function applyGroundRule(pitchDeg, rangeM) {
    if (pitchDeg !== undefined) lastPitch = pitchDeg;
    if (Number.isFinite(Number(rangeM))) lastRange = Number(rangeM);
    const eff = effMixNow();
    try {
      // Always 1: the ground's alpha owns the dissolve (see above). Kept as
      // an explicit write so a remount mid-band still lands on full photo
      // paint instead of a stale faded value.
      setGroundFade(1);
    } catch { /* base paint is cosmetic */ }
    setGroundOwns(!groundHidden(eff));
    paintLabel();
  }

  /* Central takeover law (single source of truth — reapply + applyGroundRule
   * both consume it, so the twin ground, the satellite fade and the
   * endpoint rule can never disagree): u = max(takeoverU(effMix),
   * tiltU(pitch, range)). Slider owns the base top-down at any range;
   * steep + close tilt takes it regardless of slider — EXCEPT at the
   * pure-satellite endpoint: effective mix 0 pins u to 0
   * (gatePureSatEndpoint) so tilt can never relight emphasis or twin
   * ground over the bare photo. Gated on the EFFECTIVE mix so the pre-map
   * dead-end floor (eff 50 while the map mounts) still keeps the live
   * twin up; endpoint-only, the 1..100 band is untouched. */
  function effUNow() {
    const merged = Math.max(takeoverU(effMixNow()), tiltU(lastPitch, lastRange));
    return gatePureSatEndpoint(effMixNow(), merged);
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
      // Twin side rides the same per-frame clock as the satellite fade:
      // without this the else branch left applyEmphasis/setTakeover frozen
      // at the last reapply's u (stale ground op 1 + lit schematic far out).
      try {
        applyEmphasis(Math.max(effMixNow() / 100, effUNow()));
      } catch { /* emphasis is cosmetic */ }
      try {
        setTakeover(effUNow());
      } catch { /* takeover ground is cosmetic */ }
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
    // Pure-satellite endpoint flag: true exactly when the twin channel is
    // fully gated (effective mix 0 with the map up — emphasis 0, takeover
    // ground hidden, satellite base at full opacity). Lanes whose content
    // bypasses the emphasis registry (unregistered facility/vector groups)
    // can consume this for group visibility until their materials register
    // via addEmphasisMats; pre-map it reads false (dead-end floor) so the
    // live twin stays up while the map mounts.
    getSatOnly: () => effMixNow() <= 0,
  };
}
