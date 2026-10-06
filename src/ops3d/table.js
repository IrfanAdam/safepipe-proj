/* Safepipe Ops 3D — src/ops3d/table.js · dark theatre table plane.
 * addTable(scene) → {update, mesh}
 * One 200×200 ShaderMaterial plane: #141516→#1E1F20 radial base,
 * GGX-ish specular streak top-right, diagonal micro-grid (uPitch),
 * hash-noise smudge. WebGL1-safe GLSL; honours scene fog (30–120).
 */
import * as THREE from 'three';

const SIZE = 200;

const VERT = /* glsl */ `
varying vec2 vXZ;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXZ = wp.xz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vXZ;
uniform float uTime;
uniform float uPitch;
#include <fog_pars_fragment>

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  // All values below are LINEAR (the post composite treats the scene buffer
  // as linear and converts once at the end) — author sRGB intent ^ 2.2 here,
  // or the table renders ~8x too bright and drowns thin hologram lines.
  // Radial base: sRGB #141516 centre → #1E1F20 rim (table-top satin falloff).
  float r = length(vXZ) / ${(SIZE / 2).toFixed(1)};
  vec3 base = mix(vec3(0.0036, 0.0041, 0.0046), vec3(0.0091, 0.0098, 0.0103), clamp(r, 0.0, 1.0));

  // Diagonal micro-grid: two 45° line sets, faint, pitch from uniform.
  // fwidth anti-aliasing keeps lines exactly ~1px at any zoom (no raster crawl).
  vec2 d1 = vec2(vXZ.x + vXZ.y, vXZ.x - vXZ.y) / uPitch;
  vec2 gv = abs(fract(d1 - 0.5) - 0.5) / max(fwidth(d1), vec2(1e-4));
  float line = 1.0 - min(min(gv.x, gv.y), 1.0);
  // Fade the grid with distance so far field stays calm.
  float gridFade = 1.0 - smoothstep(20.0, 90.0, length(vXZ));
  base += vec3(0.0014, 0.0017, 0.0020) * line * gridFade;

  // GGX-ish specular streak: soft lobe leaning top-right of the table.
  vec2 lobe = (vXZ - vec2(28.0, -34.0)) / 70.0;
  float spec = pow(max(0.0, 1.0 - dot(lobe, lobe)), 6.0);
  base += vec3(0.0063, 0.0070, 0.0078) * spec;

  // Noise smudge: barely-there mottling so the dark never bands flat.
  float n = hash(floor(vXZ * 2.0)) - 0.5;
  base += vec3(n * 0.0015);

  // Slow shimmer on the streak only — the table itself never pulses.
  base += vec3(0.0006) * spec * sin(uTime * 0.6);

  gl_FragColor = vec4(base, 1.0);
  #include <fog_fragment>
}
`;

export function addTable(scene) {
  if (!scene) throw new Error('addTable: scene required');

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uTime: { value: 0 }, uPitch: { value: 2.0 } },
  ]);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.05;
  mesh.name = 'ops-table';
  scene.add(mesh);

  return {
    mesh,
    update(t = 0) {
      uniforms.uTime.value = t;
    },
  };
}
