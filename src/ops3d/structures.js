/* Safepipe Ops 3D — src/ops3d/structures.js · procedural facility assets.
 * Compressor station (hall + stacks + cooler fans), valve yard (manifold +
 * valve wheels + fence), tank farm (cylindrical tanks + bund walls), sensor
 * masts (pole + head + health lamp), pipeline trestles along routes.
 * Dark MeshStandardMaterial PBR-ish; emissive windows/lamps follow feed
 * health: bone nominal, amber watch, red critical.
 * Contract: buildStructures(scene, feed, layout?) → {group, update, setSelection, dispose}.
 */
import * as THREE from 'three';
import { getLayout } from './health-feed.js';

const HEALTH = { nominal: 0xd8d2c2, watch: 0xff8c39, critical: 0xe31919 };
const col = (h) => new THREE.Color(HEALTH[h] ?? HEALTH.nominal);

const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.55, metalness: 0.65 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1f25, roughness: 0.7, metalness: 0.5 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.9, metalness: 0.05 }),
  pipe: new THREE.MeshStandardMaterial({ color: 0x4d4438, roughness: 0.45, metalness: 0.75 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.6, metalness: 0.6 }),
  tank: new THREE.MeshStandardMaterial({ color: 0x39404a, roughness: 0.4, metalness: 0.55 }),
  gravel: new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 1, metalness: 0 }),
  blade: new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.5, metalness: 0.7 }),
};
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  sph: new THREE.SphereGeometry(0.5, 10, 8),
  torus: new THREE.TorusGeometry(0.5, 0.09, 8, 18),
};
function part(geo, mat, sx, sy, sz, x, y, z, ry = 0, rz = 0, rx = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}
const lampMat = (health) => new THREE.MeshStandardMaterial({
  color: 0x111111, emissive: col(health), emissiveIntensity: 1.6, roughness: 0.4,
});

function compressor(root, health) {
  const lamps = [];
  root.add(part(GEO.box, M.concrete, 1.5, 0.08, 1.15, 0, 0.04, 0)); // pad
  root.add(part(GEO.box, M.metal, 1.1, 0.55, 0.85, -0.05, 0.355, 0)); // hall
  root.add(part(GEO.box, M.roof, 1.2, 0.07, 0.95, -0.05, 0.66, 0)); // roof
  const win = lampMat(health); lamps.push(win);
  root.add(part(GEO.box, win, 1.12, 0.1, 0.87, -0.05, 0.48, 0)); // window band
  for (let i = 0; i < 2; i++) { // exhaust stacks
    const x = -0.35 + i * 0.5;
    root.add(part(GEO.cyl, M.dark, 0.14, 0.7, 0.14, x, 1.0, -0.2));
    const tip = lampMat(health); lamps.push(tip);
    root.add(part(GEO.cyl, tip, 0.15, 0.06, 0.15, x, 1.36, -0.2));
  }
  for (let i = 0; i < 2; i++) { // cooler fans: shroud + 3 blades
    const x = 0.15 + i * 0.35;
    root.add(part(GEO.cyl, M.dark, 0.34, 0.12, 0.34, x, 0.76, 0.25));
    for (let b = 0; b < 3; b++)
      root.add(part(GEO.box, M.blade, 0.28, 0.02, 0.06, x, 0.83, 0.25, (b * Math.PI) / 3));
  }
  root.add(part(GEO.cyl, M.pipe, 0.12, 1.3, 0.12, 0, 0.1, 0.62, 0, Math.PI / 2)); // tie-in pipe
  return lamps;
}
function valveYard(root, health) {
  const lamps = [];
  root.add(part(GEO.box, M.gravel, 1.2, 0.06, 1.0, 0, 0.03, 0)); // pad
  for (let i = 0; i < 3; i++) { // manifold runs
    const z = -0.25 + i * 0.25;
    root.add(part(GEO.cyl, M.pipe, 0.1, 1.0, 0.1, 0, 0.16, z, 0, Math.PI / 2));
    for (let k = -1; k <= 1; k += 2) { // riser + valve wheel
      root.add(part(GEO.cyl, M.pipe, 0.07, 0.3, 0.07, k * 0.3, 0.3, z));
      const wheel = part(GEO.torus, M.dark, 0.22, 0.22, 0.22, k * 0.3, 0.48, z, 0, 0, Math.PI / 2);
      root.add(wheel);
      root.add(part(GEO.cyl, M.dark, 0.04, 0.14, 0.04, k * 0.3, 0.42, z));
    }
  }
  const lamp = lampMat(health); lamps.push(lamp);
  root.add(part(GEO.sph, lamp, 0.12, 0.12, 0.12, 0.45, 0.75, -0.35)); // yard lamp
  root.add(part(GEO.cyl, M.dark, 0.05, 0.7, 0.05, 0.45, 0.4, -0.35));
  const post = new THREE.InstancedMesh(GEO.box, M.dark, 12); // fence posts
  const d = new THREE.Object3D();
  let n = 0;
  for (let i = 0; i < 4; i++) for (let k = 0; k <= 2; k++) {
    const t = -0.6 + k * 0.6;
    d.position.set(i < 2 ? t : (i === 2 ? -0.65 : 0.65), 0.3, i < 2 ? (i === 0 ? -0.55 : 0.55) : t * 0.9);
    d.scale.set(0.05, 0.6, 0.05); d.updateMatrix();
    post.setMatrixAt(n++, d.matrix);
  }
  root.add(post);
  for (const z of [-0.55, 0.55]) root.add(part(GEO.box, M.dark, 1.35, 0.04, 0.04, 0, 0.55, z));
  return lamps;
}
function tankFarm(root, health) {
  const lamps = [];
  root.add(part(GEO.box, M.concrete, 1.6, 0.07, 1.3, 0, 0.035, 0)); // slab
  const spots = [[-0.4, -0.25], [0.4, -0.25], [0, 0.35]];
  for (const [x, z] of spots) {
    root.add(part(GEO.cyl, M.tank, 0.44, 0.5, 0.44, x, 0.32, z));
    root.add(part(GEO.sph, M.roof, 0.44, 0.16, 0.44, x, 0.57, z));
    const g = lampMat(health); lamps.push(g);
    root.add(part(GEO.box, g, 0.06, 0.06, 0.02, x, 0.42, z + 0.23)); // gauge lamp
  }
  for (const [w, dd, x, z] of [[1.6, 0.06, 0, -0.62], [1.6, 0.06, 0, 0.62], [0.06, 1.3, -0.77, 0], [0.06, 1.3, 0.77, 0]])
    root.add(part(GEO.box, M.concrete, w, 0.28, dd, x, 0.14, z)); // bund walls
  root.add(part(GEO.cyl, M.pipe, 0.09, 1.5, 0.09, 0, 0.12, 0, 0, Math.PI / 2));
  return lamps;
}
function sensorMast(root, health) {
  const lamp = lampMat(health);
  root.add(part(GEO.cyl, M.dark, 0.06, 1.1, 0.06, 0, 0.55, 0)); // pole
  root.add(part(GEO.box, M.metal, 0.22, 0.14, 0.16, 0, 1.12, 0)); // head
  root.add(part(GEO.sph, lamp, 0.14, 0.14, 0.14, 0, 1.28, 0)); // status lamp
  root.add(part(GEO.box, M.concrete, 0.2, 0.08, 0.2, 0, 0.04, 0)); // footing
  return [lamp];
}
function trestles(group, layout) {
  const legs = [], bars = [];
  for (const p of layout.pipelines) {
    const pts = p.points;
    let total = 0; const lens = [];
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(l); total += l;
    }
    const n = Math.max(2, Math.round(total / 1.4));
    for (let k = 0; k <= n; k++) {
      let target = (k / n) * total, seg = 0;
      while (seg < lens.length - 1 && target > lens[seg]) { target -= lens[seg]; seg++; }
      const f = lens[seg] ? target / lens[seg] : 0;
      const x = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * f;
      const z = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * f;
      legs.push([x - 0.12, z], [x + 0.12, z]); bars.push([x, z]);
    }
  }
  const d = new THREE.Object3D();
  const legMesh = new THREE.InstancedMesh(GEO.box, M.dark, legs.length);
  legs.forEach(([x, z], i) => {
    d.position.set(x, 0.09, z); d.scale.set(0.06, 0.18, 0.06);
    d.rotation.set(0, 0, 0); d.updateMatrix(); legMesh.setMatrixAt(i, d.matrix);
  });
  const barMesh = new THREE.InstancedMesh(GEO.box, M.metal, bars.length);
  bars.forEach(([x, z], i) => {
    d.position.set(x, 0.19, z); d.scale.set(0.36, 0.05, 0.12);
    d.updateMatrix(); barMesh.setMatrixAt(i, d.matrix);
  });
  group.add(legMesh, barMesh);
  return [legMesh, barMesh];
}

export function buildStructures(scene, feed, layout) {
  const lay = layout ?? getLayout();
  const healthById = new Map((feed ?? []).map((f) => [f.assetId, f.health ?? 'nominal']));
  const group = new THREE.Group();
  group.name = 'ops-structures';
  scene.add(group);
  const entries = new Map(); // assetId → {root, lamps}
  const builders = { 'FAC-01': compressor, 'FAC-02': valveYard, 'FAC-03': tankFarm };
  const kinds = { 'FAC-01': 0, 'FAC-02': 1, 'FAC-03': 2 };
  for (const fac of lay.facilities) {
    const root = new THREE.Group();
    const [fx, fz] = fac.position;
    root.position.set(fx, 0, fz);
    const health = healthById.get(fac.assetId) ?? 'nominal';
    const fn = builders[fac.assetId] ?? [compressor, valveYard, tankFarm][kinds[fac.assetId] ?? 0] ?? compressor;
    const lamps = fn(root, health);
    root.userData.assetId = fac.assetId;
    group.add(root);
    entries.set(fac.assetId, { root, lamps });
  }
  for (const sen of lay.sensors) {
    const root = new THREE.Group();
    root.position.set(sen.position[0] + 0.35, 0, sen.position[1] + 0.25);
    const lamps = sensorMast(root, healthById.get(sen.assetId) ?? 'nominal');
    root.userData.assetId = sen.assetId;
    group.add(root);
    entries.set(sen.assetId, { root, lamps });
  }
  const trestleMeshes = trestles(group, lay);
  let selected = null;
  const api = {
    group,
    update(next) {
      for (const f of next ?? []) {
        healthById.set(f.assetId, f.health ?? 'nominal');
        const e = entries.get(f.assetId);
        if (e) for (const lm of e.lamps) lm.emissive.copy(col(f.health));
      }
    },
    setSelection(id) {
      selected = id ?? null;
      for (const [aid, e] of entries) {
        const on = selected === aid;
        e.root.scale.setScalar(on ? 1.1 : 1);
        for (const lm of e.lamps) lm.emissiveIntensity = on ? 2.6 : 1.6;
      }
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.isInstancedMesh || o.isMesh) {
          if (!Object.values(GEO).includes(o.geometry)) o.geometry?.dispose?.();
        }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) if (!Object.values(M).includes(m)) m.dispose?.();
      });
      entries.clear();
    },
  };
  return api;
}
