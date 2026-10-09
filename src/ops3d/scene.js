/* Safepipe Ops 3D — src/ops3d/scene.js · renderer + scene + fog.
 * createScene(canvas) → {renderer, scene}
 * Owns renderer only. No camera (camera.js owns the rig), no sizing
 * (twin.js owns ResizeObserver sizing), no RAF loop.
 *
 * Satellite-base crossfade seam (backward-compatible, additive only):
 *   - renderer is created alpha:true with clearAlpha driven by setBaseMix;
 *   - scene.background is null-able (opaque Color only at mix ≈ 1);
 *   - setBaseMix(m) controls the custom-layer fade, default m = 1 which is
 *     pixel-identical to the previous opaque look (clearAlpha 1 + background
 *     color). Lower mixes reveal the Mapbox div mounted BEHIND the canvas.
 *   - createScene(canvas) signature unchanged; it now also returns a
 *     per-scene setBaseMix bound to its own renderer/scene. The module-level
 *     setBaseMix(m) fans out to every live scene (used by mapbox-base.js so
 *     a DEM-swap remount re-applies the current mix with no twin.js edits).
 */
import * as THREE from 'three';

export const CLEAR_COLOR = 0x0b0c0c;
export const FOG_NEAR = 58;
export const FOG_FAR = 260;

// Clamp a base-mix value to [0, 1]; non-finite input means "today's opaque".
export function clampMix(m) {
  const v = Number(m);
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

const _live = new Set();

function applyMix(entry, v) {
  entry.mix = v;
  entry.renderer.setClearColor(CLEAR_COLOR, v);
  // Opaque only at the top of the range: anything below reveals the
  // satellite div behind the canvas (renderer alpha:true does the rest).
  entry.scene.background = v >= 0.999 ? entry.bg : null;
  entry.scene.userData.baseMix = v;
}

// Global fade: applies to every live scene, returns the clamped mix.
export function setBaseMix(m) {
  const v = clampMix(m);
  for (const e of _live) {
    try {
      applyMix(e, v);
    } catch {
      /* best-effort — a torn-down scene never breaks the fade */
    }
  }
  return v;
}

export function createScene(canvas) {
  if (!canvas) throw new Error('createScene: canvas required');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(CLEAR_COLOR, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const bg = new THREE.Color(CLEAR_COLOR);
  scene.background = bg;
  scene.fog = new THREE.Fog(CLEAR_COLOR, FOG_NEAR, FOG_FAR);

  // Base light stays dim: every hologram layer (contours, outlines, dots,
  // beacons) is unlit by design — bright lights only grey-wash the table
  // and drown thin lines. Lit tubes keep a faint fill for form.
  const hemi = new THREE.HemisphereLight(0xcfd4d6, 0x0b0c0c, 0.5);
  scene.add(hemi);
  // Single sun direction (Phase 1 attention lock): one key light only —
  // a second fill direction flattened tube form and washed thin lines.
  const key = new THREE.DirectionalLight(0xffffff, 0.65);
  key.position.set(18, 26, 12);
  scene.add(key);

  // Crossfade registration: default mix 1 = today's opaque look. The
  // dispose wrapper unregisters so the global setBaseMix never touches a
  // dead renderer (twin.js dispose() calls renderer.dispose() as before).
  const entry = { renderer, scene, bg, mix: 1 };
  const setMix = (m) => {
    const v = clampMix(m);
    try {
      applyMix(entry, v);
    } catch {
      /* best-effort */
    }
    return v;
  };
  setMix(1);
  _live.add(entry);
  const _dispose = renderer.dispose.bind(renderer);
  renderer.dispose = () => {
    _live.delete(entry);
    _dispose();
  };

  return { renderer, scene, setBaseMix: setMix };
}
