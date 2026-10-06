/* Safepipe Ops 3D — src/ops3d/terrain.js · procedural night-vision relief.
 * buildTerrain(scene) → { mesh, update, dispose }
 * 200×200 heightfield (128×128 segs) displaced on the CPU with seeded value
 * noise; pipeline corridors + facility pads from getLayout() are carved flat
 * so dots (y=0.06) and facility boxes sit on grade. Unlit ShaderMaterial in
 * near-black teal with height tint + faint contour lines. WebGL1-safe GLSL.
 */
import * as THREE from 'three';
import { getLayout } from './health-feed.js';

const SIZE = 200;
const SEGS = 128;
const FLAT_Y = -0.02; // grade level: above table (-0.05), below dots (0.06)
const AMP = 3.2; // far-field relief amplitude
const CORRIDOR_HALF = 1.0; // flat half-width around each pipeline centreline
const CONTOUR_STEP = 0.5;

/* Deterministic integer-lattice value noise (CPU side — no GLSL loops). */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y) {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(fx, fy);
    amp *= 0.5;
    fx = fx * 2.03 + 11.7;
    fy = fy * 2.03 + 5.3;
  }
  return sum; // ~0..1
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const VERT = /* glsl */ `
varying vec2 vXZ;
varying float vH;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXZ = wp.xz;
  vH = wp.y;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vXZ;
varying float vH;
uniform float uTime;
#include <fog_pars_fragment>
void main() {
  // Near-black teal base, lifted faintly with height.
  float hMix = clamp((vH - (${FLAT_Y.toFixed(2)})) / ${AMP.toFixed(1)}, 0.0, 1.0);
  vec3 base = mix(vec3(0.012, 0.050, 0.055), vec3(0.030, 0.110, 0.115), hMix);
  // Faint contour lines every CONTOUR_STEP, AA'd so they stay ~1px.
  float g = vH / ${CONTOUR_STEP.toFixed(1)};
  float w = max(fwidth(g), 1e-4);
  float d = abs(fract(g + 0.5) - 0.5);
  float line = 1.0 - smoothstep(0.0, w * 1.5, d);
  float fade = 1.0 - smoothstep(30.0, 95.0, length(vXZ));
  base += vec3(0.05, 0.16, 0.16) * line * fade * (0.55 + 0.1 * sin(uTime * 0.5));
  gl_FragColor = vec4(base, 1.0);
  #include <fog_fragment>
}
`;

export function buildTerrain(scene) {
  if (!scene) throw new Error('buildTerrain: scene required');
  const layout = getLayout();

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Rolling relief, calm at the ops centre, rising to the far field.
    const r = Math.hypot(x, z);
    const n = fbm(x * 0.045 + 7.3, z * 0.045 + 2.1) - 0.5;
    const ridge = fbm(x * 0.012 + 1.7, z * 0.012 + 9.4) - 0.5;
    let h = (n * 2.0 + ridge * 2.6) * AMP * 0.5 * smooth(7, 30, r);
    // Carve pipeline corridors flat: min distance to any centreline segment.
    let dLine = Infinity;
    for (const pipe of layout.pipelines) {
      const pts = pipe.points;
      for (let s = 1; s < pts.length; s++) {
        const d = segDist(x, z, pts[s - 1][0], pts[s - 1][1], pts[s][0], pts[s][1]);
        if (d < dLine) dLine = d;
      }
    }
    // Carve facility pads flat: rounded-rect footprint + margin.
    let dPad = Infinity;
    for (const fac of layout.facilities) {
      const hw = fac.size[0] / 2 + 0.55;
      const hd = fac.size[2] / 2 + 0.55;
      const qx = Math.abs(x - fac.position[0]) - hw;
      const qz = Math.abs(z - fac.position[1]) - hd;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
      if (d < dPad) dPad = d;
    }
    const keep = smooth(CORRIDOR_HALF * 0.7, CORRIDOR_HALF + 0.9, Math.min(dLine, dPad));
    pos.setY(i, FLAT_Y + h * keep);
  }
  geo.computeVertexNormals();

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uTime: { value: 0 } },
  ]);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'ops-terrain';
  mesh.receiveShadow = false;
  scene.add(mesh);

  return {
    mesh,
    update(t = 0) {
      uniforms.uTime.value = t;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      material.dispose();
    },
  };
}
