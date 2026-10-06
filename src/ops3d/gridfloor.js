/* Safepipe Ops 3D — src/ops3d/gridfloor.js · red survey grid floor.
 * buildGridFloor(scene) → { group, dispose }
 * Fine red (#7a1e1e) grid every 2 km + brighter index lines every 10 km,
 * clipped to the mapped circle (r = 20 km), laid flat at y = -0.14 just
 * above the table. Single LineSegments with vertexColors; radial fade to
 * transparent (black, additive) at the rim. Static — no animation.
 */
import * as THREE from 'three';
import { field } from './terrain.js';

const R_MAP = 20; // mapped-circle radius, km (matches terrain.js)
const STEP_FINE = 2; // fine grid pitch, km
const STEP_INDEX = 10; // index line pitch, km
const Y = 0.02; // draped just above the terrain body (field-mapped below)
const VEX = 2; // must match terrain.js vertical exaggeration
const DIV = 40; // subdivisions per line for smooth rim fade

const FINE_COL = new THREE.Color(0x7a1e1e);
const INDEX_COL = new THREE.Color(0xc23a3a);
const FADE_INNER = 14; // full strength inside this radius

const isIndex = (v) => Math.round(v) % STEP_INDEX === 0;

function chordHalf(v) {
  const d = R_MAP * R_MAP - v * v;
  return d > 0 ? Math.sqrt(d) : -1;
}

export function buildGridFloor(scene) {
  if (!scene) throw new Error('buildGridFloor: scene required');

  const pos = [];
  const col = [];
  const c = new THREE.Color();

  // Emit one chord (fixed axis coordinate `v`) subdivided into DIV
  // segments so the radial rim fade is smooth per-vertex.
  const emit = (v, alongX) => {
    const half = chordHalf(v);
    if (half < 0) return; // outside the circle — skipped
    const base = (isIndex(v) ? INDEX_COL : FINE_COL).clone();
    // Index lines render brighter: fine lines sit at ~0.65 strength.
    const gain = isIndex(v) ? 1.0 : 0.65;
    let px = 0;
    let pz = 0;
    let pf = 0;
    for (let i = 0; i <= DIV; i++) {
      const t = -half + (2 * half * i) / DIV;
      const x = alongX ? t : v;
      const z = alongX ? v : t;
      const fade = 1 - THREE.MathUtils.smoothstep(Math.hypot(x, z), FADE_INNER, R_MAP);
      // Drape: grid hugs the terrain surface so it reads as one volume.
      const y = field(x, z) * VEX + Y;
      const py = field(px, pz) * VEX + Y;
      if (i > 0) {
        pos.push(px, py, pz, x, y, z);
        c.copy(base).multiplyScalar(gain * pf);
        col.push(c.r, c.g, c.b);
        c.copy(base).multiplyScalar(gain * fade);
        col.push(c.r, c.g, c.b);
      }
      px = x;
      pz = z;
      pf = fade;
    }
  };

  for (let v = -R_MAP; v <= R_MAP + 1e-6; v += STEP_FINE) {
    const q = Math.round(v / STEP_FINE) * STEP_FINE; // snap off float drift
    emit(q, true); // vertical line x = t, z = q
    emit(q, false); // horizontal line x = q, z = t
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending, // fade to black == fade to transparent
    depthWrite: false,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'ops-gridfloor';
  lines.renderOrder = 1;

  const group = new THREE.Group();
  group.name = 'ops-gridfloor-group';
  group.add(lines);
  scene.add(group);

  return {
    group,
    dispose() {
      scene.remove(group);
      geo.dispose();
      mat.dispose();
    },
  };
}
