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
  // Radial base: #141516 centre → #1E1F20 rim (table-top satin falloff).
  float r = length(vXZ) / ${(SIZE / 2).toFixed(1)};
  vec3 base = mix(vec3(0.078, 0.082, 0.086), vec3(0.118, 0.122, 0.125), clamp(r, 0.0, 1.0));

  // Diagonal micro-grid: two 45° line sets, faint, pitch from uniform.
  vec2 d1 = vec2(vXZ.x + vXZ.y, vXZ.x - vXZ.y) / uPitch;
  vec2 g = abs(fract(d1) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.06, min(g.x, g.y));
  // Fade the grid with distance so far field stays calm.
  float gridFade = 1.0 - smoothstep(20.0, 90.0, length(vXZ));
  base += vec3(0.05, 0.055, 0.06) * line * gridFade;

  // GGX-ish specular streak: soft lobe leaning top-right of the table.
  vec2 lobe = (vXZ - vec2(28.0, -34.0)) / 70.0;
  float spec = pow(max(0.0, 1.0 - dot(lobe, lobe)), 6.0);
  base += vec3(0.10, 0.105, 0.11) * spec;

  // Noise smudge: barely-there mottling so the dark never bands flat.
  float n = hash(floor(vXZ * 2.0)) - 0.5;
  base += vec3(n * 0.012);

  // Slow shimmer on the streak only — the table itself never pulses.
  base += vec3(0.008) * spec * sin(uTime * 0.6);

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
