/* Safepipe Ops 3D — src/ops3d/checker.js · diamond checker parterre.
 * buildChecker(scene) → { mesh, setSize, update, dispose, setDetail }
 * Faint 2 km-pitch diagonal diamond wash under everything, draped to the
 * terrain surface. Gives the void a scale without stealing glow from white
 * index contours. WebGL1-safe ShaderMaterial (sin/step/smoothstep only);
 * falls back to LineSegments if shaders unavailable.
 * [plan:2026-10-06_153000-ops3d-terrain-topo.md#task-6]
 */
import * as THREE from 'three';
import { field, VEX } from './terrain.js';

const R_MAP = 20;
const Y = -0.06;

export function buildChecker(scene) {
  if (!scene) throw new Error('buildChecker: scene required');
  let mesh = null;
  let mat = null;
  let geo = null;
  try {
    geo = new THREE.PlaneGeometry(44, 44, 44, 44);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = -pos.getY(i);
      pos.setXYZ(i, x, field(x, z) * VEX + Y, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    mat = new THREE.ShaderMaterial({
      uniforms: { uR: { value: R_MAP }, uOpacity: { value: 0.16 } },
      vertexShader: `varying vec2 vP; void main(){ vP = vec2(position.x, position.z); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        varying vec2 vP;
        uniform float uR; uniform float uOpacity;
        void main(){
          float d = length(vP);
          float rim = smoothstep(12.0, 19.5, d);
          vec2 q = vP * 0.5;
          float a = step(0.0, sin(q.x + q.y) * sin(q.x - q.y));
          float checker = mix(0.06, 0.14, a);
          float alpha = (1.0 - rim) * checker * uOpacity * 8.0;
          gl_FragColor = vec4(vec3(0.58, 0.64, 0.68) * alpha, alpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    mesh = new THREE.Mesh(geo, mat);
  } catch {
    // Fallback: diagonal LineSegments at same pitch/opacity.
    const pts = [];
    for (let v = -R_MAP; v <= R_MAP; v += 2) {
      pts.push(v, Y, -R_MAP, v + 2 * R_MAP, Y, R_MAP);
      pts.push(v, Y, R_MAP, v + 2 * R_MAP, Y, -R_MAP);
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    mat = new THREE.LineBasicMaterial({
      color: 0x3a4448, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    mesh = new THREE.LineSegments(geo, mat);
  }
  mesh.name = 'ops-checker';
  mesh.renderOrder = 0;
  scene.add(mesh);
  return {
    mesh,
    setSize() {},
    setDetail(name) {
      const o = name === 'asset' ? 0.06 : name === 'segment' ? 0.10 : 0.16;
      if (mat?.uniforms?.uOpacity) mat.uniforms.uOpacity.value = o;
      else if (mat) mat.opacity = o * 0.75;
    },
    update(t = 0) {
      if (mat?.uniforms?.uOpacity) {
        const base = mat.uniforms.uOpacity.value;
        mat.uniforms.uOpacity.value = base + 0.008 * Math.sin(t * 0.4);
      }
    },
    dispose() {
      scene.remove(mesh);
      geo?.dispose();
      mat?.dispose();
    },
  };
}
