/* Safepipe Ops 3D — src/ops3d/structures.js · outline-hologram facility assets.
 * Theatre-style see-through geometry: everything is THREE.LineSegments
 * (EdgesGeometry over shared unit geoms, or custom segment buffers) plus a
 * few glowing status dots (MeshBasicMaterial spheres). No solid masses.
 * FAC-01 gas transmission compressor station (2 gabled halls, suction /
 * discharge headers on trestles, fin-fan cooler bay, control building,
 * vent stack, fence); FAC-02 valve yard (manifold grid + handwheels +
 * fence); FAC-03 tank farm (open ring tanks + bund walls); sensor masts
 * (pole + head + lamp dot); thin 6-sided pipe tubes (r=0.045) that read as
 * lines plus health-tinted joint rings.
 * Health: dim bone 0x8f9797 nominal / amber 0xff8c39 watch / red 0xe31919
 * outlines + brighter lamp dots. Selection: 1.1x scale + brighten.
 * Contract: buildStructures(scene, feed, layout?) → {group, update, setSelection, dispose}.
 */
import * as THREE from 'three';
import { getLayout } from './health-feed.js';

const OUTLINE = { nominal: 0x8f9797, watch: 0xff8c39, critical: 0xe31919 };
const LAMP = { nominal: 0xf4f1e8, watch: 0xffb066, critical: 0xff4545 };
const GRAPHITE = 0x5a636b;
const PIPE_Y = 0.35; // above-ground pipe centerline elevation
const PIPE_R = 0.045; // thin 6-sided tube radius — reads as a line at map scale
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(0xffffff);

const col = (h) => OUTLINE[h] ?? OUTLINE.nominal;
const lampCol = (h) => LAMP[h] ?? LAMP.nominal;

// Shared unit geoms + cached edge geoms (module singletons, never disposed).
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  torus: new THREE.TorusGeometry(0.5, 0.07, 6, 20),
  sph: new THREE.SphereGeometry(0.5, 10, 8),
};
const EDGE = new Map();
const edgeOf = (g) => {
  let e = EDGE.get(g);
  if (!e) { e = new THREE.EdgesGeometry(g); EDGE.set(g, e); }
  return e;
};
const graphite = new THREE.LineBasicMaterial({ color: GRAPHITE, transparent: true, opacity: 0.9 });

/* Per-asset draw context: one outline material + one lamp material shared by
 * every line/dot of the asset, so update() recolors with two assignments. */
function actx(health) {
  return {
    group: new THREE.Group(),
    outline: new THREE.LineBasicMaterial({ color: col(health), transparent: true, opacity: 0.9 }),
    lampMat: new THREE.MeshBasicMaterial({ color: lampCol(health) }),
    base: new THREE.Color(col(health)),
    lampBase: new THREE.Color(lampCol(health)),
    owned: [], // transient BufferGeometries for dispose()
  };
}
function wire(c, geo, sx, sy, sz, x, y, z, ry = 0, rx = 0, mat = null) {
  const l = new THREE.LineSegments(edgeOf(geo), mat ?? c.outline);
  l.scale.set(sx, sy, sz);
  l.position.set(x, y, z);
  l.rotation.set(rx, ry, 0);
  c.group.add(l);
  return l;
}
const box = (c, w, h, d, x, y, z, ry = 0) => wire(c, GEO.box, w, h, d, x, y, z, ry);
function segs(c, positions, mat = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  c.owned.push(g);
  const l = new THREE.LineSegments(g, mat ?? c.outline);
  c.group.add(l);
  return l;
}
function loop(c, pts) {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  c.owned.push(g);
  const l = new THREE.LineLoop(g, c.outline);
  c.group.add(l);
  return l;
}
function dot(c, x, y, z, r = 0.05) {
  const m = new THREE.Mesh(GEO.sph, c.lampMat);
  m.scale.setScalar(r * 2);
  m.position.set(x, y, z);
  c.group.add(m);
  return m;
}
/* Elevated tube between two 3D points (shared 6-sided cylinder edges). */
function tube(c, x0, y0, z0, x1, y1, z1, r, mat = null) {
  const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
  const dir = b.clone().sub(a), len = dir.length() || 0.001;
  const l = new THREE.LineSegments(edgeOf(GEO.cyl6), mat ?? c.outline);
  l.scale.set(r * 2, len, r * 2);
  l.position.copy(a).add(b).multiplyScalar(0.5);
  l.quaternion.setFromUnitVectors(UP, dir.normalize());
  c.group.add(l);
  return l;
}
/* Raw-segment helpers (flat xyz pairs). */
function ringSegs(arr, cx, cy, cz, r, n = 20) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    arr.push(cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r,
      cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r);
  }
}
function rectSegs(arr, x0, z0, x1, z1, y) {
  arr.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1,
    x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
}
const vert = (arr, x, y0, y1, z) => { arr.push(x, y0, z, x, y1, z); };
/* Gabled hall outline: base + eave rects, corner posts, ridge, 4 slopes. */
function gable(c, w, wallH, d, roofH, x, y, z) {
  const arr = [], hx = w / 2;
  const X0 = x - hx, X1 = x + hx, Z0 = z - d / 2, Z1 = z + d / 2;
  const y1 = y + wallH, y2 = y1 + roofH;
  rectSegs(arr, X0, Z0, X1, Z1, y);
  rectSegs(arr, X0, Z0, X1, Z1, y1);
  for (const [cx, cz] of [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]]) vert(arr, cx, y, y1, cz);
  arr.push(X0, y2, z, X1, y2, z);
  for (const ex of [X0, X1]) arr.push(ex, y2, z, ex, y1, Z0, ex, y2, z, ex, y1, Z1);
  segs(c, arr);
  dot(c, x, y2 + 0.04, z, 0.035);
}
/* Open tank outline: bottom + top rings, verticals, roof-cone slopes + apex dot. */
function tank(c, x, z, r = 0.28, h = 0.5, roofH = 0.16, n = 20, m = 8) {
  const arr = [], y0 = 0.06, y1 = y0 + h;
  ringSegs(arr, x, y0, z, r, n);
  ringSegs(arr, x, (y0 + y1) / 2, z, r, n);
  ringSegs(arr, x, y1, z, r, n);
  for (let i = 0; i < m; i++) {
    const a = (i / m) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    vert(arr, px, y0, y1, pz);
    arr.push(x, y1 + roofH, z, px, y1, pz);
  }
  segs(c, arr);
  dot(c, x, y1 + roofH + 0.04, z, 0.035);
}
/* Fence perimeter outline: top rail rect + posts. */
function fence(c, w, d, h = 0.55, step = 0.6) {
  const arr = [], hx = w / 2, hz = d / 2;
  rectSegs(arr, -hx, -hz, hx, hz, h);
  const nx = Math.max(1, Math.round(w / step)), nz = Math.max(1, Math.round(d / step));
  for (let i = 0; i <= nx; i++) {
    const x = -hx + (w * i) / nx;
    vert(arr, x, 0, h, -hz); vert(arr, x, 0, h, hz);
  }
  for (let i = 1; i < nz; i++) {
    const z = -hz + (d * i) / nz;
    vert(arr, -hx, 0, h, z); vert(arr, hx, 0, h, z);
  }
  segs(c, arr);
}
/* Trestle bent: leg pair + crossbar (graphite). */
function bent(c, x, z, topY = PIPE_Y) {
  const arr = [];
  vert(arr, x - 0.12, 0, topY - 0.03, z);
  vert(arr, x + 0.12, 0, topY - 0.03, z);
  arr.push(x - 0.16, topY - 0.03, z, x + 0.16, topY - 0.03, z);
  segs(c, arr, graphite);
}
function fanCircle(c, x, y, z, r, n = 24) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(x + Math.cos(a) * r, y, z + Math.sin(a) * r));
  }
  loop(c, pts);
}
/* Lattice derrick tower: 4 tapering legs, ring band + X-braces per level.
 * The hero silhouette of ref rigs — dense but one static segment buffer. */
function latticeTower(c, x, z, baseW = 0.24, h = 2.4, levels = 6, y0 = 0.06) {
  const arr = [];
  const wTop = baseW * 0.35;
  const corner = (sx, sz, y) => {
    const f = (y - y0) / h;
    const w = baseW * (1 - f) + wTop * f;
    return [x + (sx * w) / 2, y, z + (sz * w) / 2];
  };
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const [ax, ay, az] = corner(sx, sz, y0);
    const [bx, by, bz] = corner(sx, sz, y0 + h);
    arr.push(ax, ay, az, bx, by, bz);
  }
  for (let l = 0; l <= levels; l++) {
    const y = y0 + (h * l) / levels;
    const f = l / levels;
    const w = (baseW * (1 - f) + wTop * f) / 2;
    rectSegs(arr, x - w, z - w, x + w, z + w, y);
    if (l < levels) {
      const y2 = y0 + (h * (l + 1)) / levels;
      const f2 = (l + 1) / levels;
      const w2 = (baseW * (1 - f2) + wTop * f2) / 2;
    // X-brace on all 4 faces: diagonals B[f]→T[g] and B[g]→T[f].
    const B = [[x - w, y, z - w], [x + w, y, z - w], [x + w, y, z + w], [x - w, y, z + w]];
    const T = [[x - w2, y2, z - w2], [x + w2, y2, z - w2], [x + w2, y2, z + w2], [x - w2, y2, z + w2]];
    for (let f = 0; f < 4; f++) {
      const g = (f + 1) % 4;
      arr.push(...B[f], ...T[g], ...B[g], ...T[f]);
    }
    }
  }
  segs(c, arr);
  dot(c, x, y0 + h + 0.04, z, 0.05);
}
/* Drop lines: facility corners bleed vertically below datum (ref map glow). */
function drops(c, w, d, yTop = 0.02, yBot = -1.1) {
  const arr = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
    vert(arr, (sx * w) / 2, yTop, yBot, (sz * d) / 2);
  segs(c, arr, graphite);
}
/* Speckle fill: deterministic faint dot-dust inside a footprint (ref map). */
const speckleMat = new THREE.PointsMaterial({
  color: 0x5f93ad, size: 0.035, transparent: true, opacity: 0.55,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
function speckle(c, w, d, id, y = 0.08) {
  let s = 7;
  for (const ch of String(id)) s = (Math.imul(s, 31) + ch.charCodeAt(0)) | 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
  const n = Math.min(220, Math.floor(w * d * 30));
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    p[i * 3] = (rnd() - 0.5) * w;
    p[i * 3 + 1] = y + rnd() * 0.05;
    p[i * 3 + 2] = (rnd() - 0.5) * d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  c.owned.push(g);
  c.group.add(new THREE.Points(g, speckleMat));
}

/* FAC-01 — gas transmission compressor station. */
function compressor(c) {
  box(c, 3.6, 0.06, 2.2, 0, 0.03, 0); // pad outline
  gable(c, 1.3, 0.75, 0.9, 0.32, -0.7, 0.06, -0.55); // hall A
  gable(c, 1.3, 0.75, 0.9, 0.32, 0.7, 0.06, -0.55); // hall B
  for (const z of [0.65, 0.9]) { // suction / discharge headers
    tube(c, -1.6, PIPE_Y, z, 1.6, PIPE_Y, z, 0.055);
    for (let x = -1.6; x <= 1.61; x += 0.8) bent(c, x, z);
  }
  for (const x of [-0.7, 0.7]) { // risers: hall front up to headers
    tube(c, x, 0.1, 0.35, x, PIPE_Y, 0.35, 0.04);
    tube(c, x, PIPE_Y, 0.35, x, PIPE_Y, 0.9, 0.04);
  }
  const legs = []; // fin-fan cooler bay: legs + deck + 2 fan circles
  for (const [lx, lz] of [[-1.75, 0.05], [-0.95, 0.05], [-1.75, 0.45], [-0.95, 0.45]])
    vert(legs, lx, 0.06, 1.05, lz);
  segs(c, legs);
  box(c, 1.0, 0.14, 0.55, -1.35, 1.1, 0.25);
  fanCircle(c, -1.6, 1.18, 0.25, 0.16);
  fanCircle(c, -1.1, 1.18, 0.25, 0.16);
  box(c, 0.6, 0.45, 0.5, 1.35, 0.28, 0.25); // control building
  latticeTower(c, 1.7, -0.9, 0.24, 2.4, 6); // vent / flare stack (lattice derrick)
  fence(c, 3.6, 2.2);
}
/* FAC-02 — valve yard: manifold grid + handwheels + fence. */
function valveYard(c) {
  box(c, 1.5, 0.05, 1.2, 0, 0.025, 0); // pad outline
  for (let i = 0; i < 3; i++) {
    const z = -0.3 + i * 0.3;
    tube(c, -0.65, 0.16, z, 0.65, 0.16, z, 0.05);
    for (const x of [-0.3, 0.3]) {
      tube(c, x, 0.16, z, x, 0.42, z, 0.035);
      wire(c, GEO.torus, 0.2, 0.2, 0.2, x, 0.5, z, 0, Math.PI / 2); // handwheel
    }
  }
  const pole = [];
  vert(pole, 0.6, 0, 0.8, -0.45);
  segs(c, pole);
  dot(c, 0.6, 0.86, -0.45, 0.05);
  fence(c, 1.5, 1.2);
}
/* FAC-03 — tank farm: 3 open outline tanks + bund walls. */
function tankFarm(c) {
  box(c, 2.0, 0.06, 1.7, 0, 0.03, 0); // slab outline
  tank(c, -0.55, -0.3);
  tank(c, 0.55, -0.3);
  tank(c, 0, 0.35);
  box(c, 2.0, 0.25, 0.06, 0, 0.18, -0.79); // bund walls
  box(c, 2.0, 0.25, 0.06, 0, 0.18, 0.79);
  box(c, 0.06, 0.25, 1.64, -0.97, 0.18, 0);
  box(c, 0.06, 0.25, 1.64, 0.97, 0.18, 0);
  tube(c, -0.9, 0.12, 0.62, 0.9, 0.12, 0.62, PIPE_R); // takeover line
  for (const x of [-0.55, 0, 0.55]) tube(c, x, 0.12, 0.62, x, 0.3, 0.62, 0.03);
}
function sensorMast(c) {
  box(c, 0.22, 0.08, 0.22, 0, 0.04, 0); // footing outline
  const pole = [];
  vert(pole, 0, 0.08, 1.1, 0);
  segs(c, pole);
  box(c, 0.24, 0.14, 0.18, 0, 1.12, 0); // head outline
  dot(c, 0, 1.3, 0, 0.06);
}
/* Pipe runs: graphite thin-tube outlines + health joint rings + waypoint dots. */
function pipeRuns(group, layout, healthById, entries) {
  for (const p of layout.pipelines) {
    const c = actx(healthById.get(p.assetId) ?? 'nominal');
    const pts = p.points;
    for (let i = 1; i < pts.length; i++)
      tube(c, pts[i - 1][0], PIPE_Y, pts[i - 1][1], pts[i][0], PIPE_Y, pts[i][1], PIPE_R, graphite);
    const rings = [];
    for (const [x, z] of pts) {
      ringSegs(rings, x, PIPE_Y, z, PIPE_R * 2.1, 10);
      dot(c, x, PIPE_Y + 0.12, z, 0.03);
    }
    segs(c, rings);
    let total = 0; // trestle bents every ~1.4 units
    const lens = [];
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(l); total += l;
    }
    const n = Math.max(2, Math.round(total / 1.4));
    for (let k = 0; k <= n; k++) {
      let target = (k / n) * total, s = 0;
      while (s < lens.length - 1 && target > lens[s]) { target -= lens[s]; s++; }
      const f = lens[s] ? target / lens[s] : 0;
      bent(c, pts[s][0] + (pts[s + 1][0] - pts[s][0]) * f, pts[s][1] + (pts[s + 1][1] - pts[s][1]) * f);
    }
    c.group.userData.assetId = p.assetId;
    group.add(c.group);
    entries.set(p.assetId, c);
  }
}

function paint(e, on) {
  e.outline.color.copy(e.base).lerp(WHITE, on ? 0.45 : 0);
  e.lampMat.color.copy(e.lampBase).lerp(WHITE, on ? 0.5 : 0);
}

export function buildStructures(scene, feed, layout) {
  const lay = layout ?? getLayout();
  const healthById = new Map((feed ?? []).map((f) => [f.assetId, f.health ?? 'nominal']));
  const group = new THREE.Group();
  group.name = 'ops-structures';
  scene.add(group);
  const entries = new Map(); // assetId → actx (facilities, sensors, pipelines)
  const builders = { 'FAC-01': compressor, 'FAC-02': valveYard, 'FAC-03': tankFarm };
  const kinds = { 'FAC-01': 0, 'FAC-02': 1, 'FAC-03': 2 };
  for (const fac of lay.facilities) {
    const c = actx(healthById.get(fac.assetId) ?? 'nominal');
    c.group.position.set(fac.position[0], 0, fac.position[1]);
    const fn = builders[fac.assetId] ?? [compressor, valveYard, tankFarm][kinds[fac.assetId] ?? 0] ?? compressor;
    fn(c);
    drops(c, fac.size[0], fac.size[2]);
    speckle(c, fac.size[0], fac.size[2], fac.assetId);
    c.group.userData.assetId = fac.assetId;
    group.add(c.group);
    entries.set(fac.assetId, c);
  }
  for (const sen of lay.sensors) {
    const c = actx(healthById.get(sen.assetId) ?? 'nominal');
    c.group.position.set(sen.position[0] + 0.35, 0, sen.position[1] + 0.25);
    sensorMast(c);
    c.group.userData.assetId = sen.assetId;
    group.add(c.group);
    entries.set(sen.assetId, c);
  }
  pipeRuns(group, lay, healthById, entries);
  let selected = null;
  const api = {
    group,
    update(next) {
      for (const f of next ?? []) {
        const e = entries.get(f.assetId);
        if (!e) continue;
        const h = f.health ?? 'nominal';
        e.base.set(col(h));
        e.lampBase.set(lampCol(h));
        paint(e, selected === f.assetId);
      }
    },
    setSelection(id) {
      selected = id ?? null;
      for (const [aid, e] of entries) {
        const on = selected === aid;
        e.group.scale.setScalar(on ? 1.1 : 1);
        paint(e, on);
      }
    },
    dispose() {
      scene.remove(group);
      for (const e of entries.values()) {
        for (const g of e.owned) g.dispose?.();
        e.outline.dispose?.();
        e.lampMat.dispose?.();
      }
      entries.clear();
    },
  };
  return api;
}
