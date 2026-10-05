/* Safepipe Ops 3D — src/ops3d/scene.js · renderer + scene + fog.
 * createScene(canvas) → {renderer, scene}
 * Owns renderer only. No camera (camera.js owns the rig), no sizing
 * (twin.js owns ResizeObserver sizing), no RAF loop.
 */
import * as THREE from 'three';

export const CLEAR_COLOR = 0x0b0c0c;
export const FOG_NEAR = 30;
export const FOG_FAR = 120;

export function createScene(canvas) {
  if (!canvas) throw new Error('createScene: canvas required');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(CLEAR_COLOR, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CLEAR_COLOR);
  scene.fog = new THREE.Fog(CLEAR_COLOR, FOG_NEAR, FOG_FAR);

  // Neutral base light so future unlit-agnostic meshes (facility boxes,
  // zone decals) never render pitch black. Shader-driven layers ignore it.
  const hemi = new THREE.HemisphereLight(0xcfd4d6, 0x0b0c0c, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(18, 26, 12);
  scene.add(key);

  return { renderer, scene };
}
