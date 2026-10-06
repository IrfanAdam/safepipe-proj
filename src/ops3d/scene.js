/* Safepipe Ops 3D — src/ops3d/scene.js · renderer + scene + fog.
 * createScene(canvas) → {renderer, scene}
 * Owns renderer only. No camera (camera.js owns the rig), no sizing
 * (twin.js owns ResizeObserver sizing), no RAF loop.
 */
import * as THREE from 'three';

export const CLEAR_COLOR = 0x0b0c0c;
export const FOG_NEAR = 70;
export const FOG_FAR = 220;

export function createScene(canvas) {
  if (!canvas) throw new Error('createScene: canvas required');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(CLEAR_COLOR, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CLEAR_COLOR);
  scene.fog = new THREE.Fog(CLEAR_COLOR, FOG_NEAR, FOG_FAR);

  // Base light stays dim: every hologram layer (contours, outlines, dots,
  // beacons) is unlit by design — bright lights only grey-wash the table
  // and drown thin lines. Lit tubes keep a faint fill for form.
  const hemi = new THREE.HemisphereLight(0xcfd4d6, 0x0b0c0c, 0.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.65);
  key.position.set(18, 26, 12);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc4d8, 0.25);
  fill.position.set(-14, 10, -18);
  scene.add(fill);

  return { renderer, scene };
}
