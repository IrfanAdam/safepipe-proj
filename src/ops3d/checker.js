/* Safepipe Ops 3D — src/ops3d/checker.js · static radial gradient wash.
 * buildChecker(scene) → { mesh, setSize, update, dispose, setDetail }
 * A single flat radial gradient wash under everything at Y=-0.06: faint
 * grey-blue near the center fading to nothing at the rim. No grid, no
 * diamonds, no step patterns, no time-based pulse — white index contours
 * dominate. Canvas radial-gradient texture on a flat MeshBasicMaterial
 * (transparent, depthWrite off). Opacity kept very low (≤ ~0.08).
 * [plan:2026-10-06_153000-ops3d-terrain-topo.md#task-6]
 */
import * as THREE from 'three';

const R_MAP = 20;
const Y = -0.06;
const PEAK_OPACITY = 0.075; // final visual weight ≤ ~0.08

function makeWashTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, 'rgba(102,122,138,0.95)');
  g.addColorStop(0.45, 'rgba(88,108,124,0.52)');
  g.addColorStop(0.80, 'rgba(72,90,104,0.16)');
  g.addColorStop(1.00, 'rgba(66,82,96,0.00)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export function buildChecker(scene) {
  if (!scene) throw new Error('buildChecker: scene required');
  let mesh = null;
  let mat = null;
  let geo = null;
  let tex = null;
  try {
    tex = makeWashTexture();
    geo = new THREE.CircleGeometry(R_MAP, 96);
    mat = new THREE.MeshBasicMaterial({
      map: tex,
      alphaMap: tex,
      transparent: true,
      opacity: PEAK_OPACITY,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
    });
    mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = Y;
  } catch {
    // Fallback: plain faint disc, still no pattern.
    geo = new THREE.CircleGeometry(R_MAP, 64);
    mat = new THREE.MeshBasicMaterial({
      color: 0x46525c, transparent: true, opacity: PEAK_OPACITY,
      depthWrite: false, blending: THREE.NormalBlending, fog: false,
    });
    mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = Y;
  }
  mesh.name = 'ops-checker';
  mesh.renderOrder = 0;
  scene.add(mesh);
  return {
    mesh,
    setSize() {},
    setDetail(name) {
      const o = name === 'asset' ? 0.045 : name === 'segment' ? 0.060 : PEAK_OPACITY;
      if (mat?.uniforms?.uOpacity) mat.uniforms.uOpacity.value = o;
      else if (mat) mat.opacity = o;
    },
    update() {
      // Static wash — intentionally no time-based modulation.
    },
    dispose() {
      scene.remove(mesh);
      geo?.dispose();
      mat?.dispose();
      tex?.dispose();
    },
  };
}
