/* Safepipe Ops 3D — src/ops3d/terrain.js · Permian-representative holographic topo.
 * buildTerrain(scene) → { mesh, setSize, update, dispose }
 * Representative Permian-basin floor (1 unit = 1 km): eastward dip ~1.5 m/km
 * + broad low swells ±25 m + one shallow winding dry draw ~15 m deep —
 * total relief ≈ ±40 m true. No hills, no rim mountains.
 * Marching-squares 128×128 grid at 12 levels (VEX fixed 2); unordered
 * segments are chained (quantized-endpoint greedy) into continuous smooth
 * polylines per level and rendered as Line2 strips — two tiers: brighter
 * index lines every 4th level (width 2) over dim base lines (width 1.25).
 * Dense stacked index contours on steeps, sparse faint lines on flats.
 * No dots on terrain, ever. WebGL1-safe (no custom GLSL).
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const SIZE = 44; // map extent, km (1 unit = 1 km)
const R_MAP = 20; // boundary ring radius, km
const N = 128; // marching-squares grid cells per side
const LEVELS = 12; // contour levels
const VEX = 2; // vertical exaggeration, fixed
const BASE_COL = new THREE.Color(0x3f8aa5); // luminous cyan base contours
const INDEX_COL = new THREE.Color(0x8fdcf5); // bright every-4th index contours
const BELOW_COL = new THREE.Color(0x2a6a7e); // below-datum deep teal
const RING_COL = 0x2fa8c7;

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* Permian-basin representative floor field (km units). Eastward dip ~1.5 m/km,
 * broad low swells ±25 m, one shallow winding dry draw ~15 m deep carved
 * along a meandering centerline. Total relief ≈ ±40 m. No hills, no rim. */
export function field(x, z) {
  const dip = -0.0015 * x; // eastward dip: down ~1.5 m per km east
  const swell =
    0.018 * Math.sin(x * 0.16 + 1.2) * Math.cos(z * 0.13 - 0.6) +
    0.007 * Math.sin(x * 0.31 - 0.4) * Math.sin(z * 0.27 + 2.0);
  const zc = 6 * Math.sin(x * 0.22 + 0.5) + 2 * Math.sin(x * 0.55 + 1.1);
  const dd = (z - zc) / 1.2;
  const draw = -0.015 * Math.exp(-dd * dd); // dry draw, ~15 m deep, ~1.2 km wide
  return dip + swell + draw;
}

/* One marching-squares level → raw unordered segments in world coords. */
function levelSegments(H, n, step, level) {
  const segs = [];
  const wx = (g) => -SIZE / 2 + g * step;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = H[j * (n + 1) + i];
      const b = H[j * (n + 1) + i + 1];
      const d = H[(j + 1) * (n + 1) + i];
      const c = H[(j + 1) * (n + 1) + i + 1];
      const pts = [];
      if ((a - level) * (b - level) < 0) pts.push([i + (level - a) / (b - a), j]);
      if ((b - level) * (c - level) < 0) pts.push([i + 1, j + (level - b) / (c - b)]);
      if ((d - level) * (c - level) < 0) pts.push([i + (level - d) / (c - d), j + 1]);
      if ((a - level) * (d - level) < 0) pts.push([i, j + (level - a) / (d - a)]);
      const P = (p) => [wx(p[0]), wx(p[1])];
      if (pts.length === 2) {
        const p = P(pts[0]);
        const q = P(pts[1]);
        segs.push([p[0], p[1], q[0], q[1]]);
      } else if (pts.length === 4) {
        const p = P(pts[0]);
        const q = P(pts[1]);
        const r = P(pts[2]);
        const s = P(pts[3]);
        segs.push([p[0], p[1], q[0], q[1]]);
        segs.push([r[0], r[1], s[0], s[1]]);
      }
    }
  }
  return segs;
}

/* Quantized-endpoint greedy chaining: unordered segments → continuous polylines. */
function chainSegments(segs) {
  const key = (x, z) => `${Math.round(x * 500)}:${Math.round(z * 500)}`;
  const at = new Map();
  segs.forEach((s, i) => {
    for (let e = 0; e < 2; e++) {
      const k = key(s[e * 2], s[e * 2 + 1]);
      let l = at.get(k);
      if (!l) at.set(k, (l = []));
      l.push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const take = (x, z) => {
    const l = at.get(key(x, z));
    if (!l) return -1;
    for (const i of l) if (!used[i]) return i;
    return -1;
  };
  const paths = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const s = segs[s0];
    const pts = [
      [s[0], s[1]],
      [s[2], s[3]],
    ];
    for (let end = 0; end < 2; end++) {
      for (;;) {
        const tip = end === 0 ? pts[pts.length - 1] : pts[0];
        const i = take(tip[0], tip[1]);
        if (i < 0) break;
        used[i] = 1;
        const g = segs[i];
        const other =
          key(g[0], g[1]) === key(tip[0], tip[1]) ? [g[2], g[3]] : [g[0], g[1]];
        if (end === 0) pts.push(other);
        else pts.unshift(other);
      }
    }
    paths.push(pts);
  }
  return paths;
}

/* One light smoothing pass (endpoints preserved unless the loop is closed). */
function smoothPath(pts) {
  if (pts.length < 3) return pts;
  const n = pts.length;
  const closed =
    Math.abs(pts[0][0] - pts[n - 1][0]) < 1e-6 &&
    Math.abs(pts[0][1] - pts[n - 1][1]) < 1e-6;
  const out = pts.map((p) => p.slice());
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    const p = pts[(i - 1 + n) % n];
    const q = pts[i];
    const r = pts[(i + 1) % n];
    out[i][0] = 0.25 * p[0] + 0.5 * q[0] + 0.25 * r[0];
    out[i][1] = 0.25 * p[1] + 0.5 * q[1] + 0.25 * r[1];
  }
  return out;
}

/* One chained polyline → Line2 strip at its true elevation × VEX, with
 * periphery fade toward the boundary ring baked into vertex colors. */
function stripObject(pts, y, col, mat) {
  const pos = new Array(pts.length * 3);
  const clr = new Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0];
    const z = pts[i][1];
    const f = 1 - smooth(12, 19.5, Math.hypot(x, z));
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    clr[i * 3] = col.r * f;
    clr[i * 3 + 1] = col.g * f;
    clr[i * 3 + 2] = col.b * f;
  }
  const g = new LineGeometry();
  g.setPositions(pos);
  g.setColors(clr);
  return new Line2(g, mat);
}

export function buildTerrain(scene) {
  if (!scene) throw new Error('buildTerrain: scene required');
  const group = new THREE.Group();
  group.name = 'ops-terrain';

  // Sample the Permian floor field on the grid.
  const step = SIZE / N;
  const H = new Float32Array((N + 1) * (N + 1));
  let mn = Infinity;
  let mx = -Infinity;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const h = field(-SIZE / 2 + i * step, -SIZE / 2 + j * step);
      H[j * (N + 1) + i] = h;
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
  }

  // Two shared fat-line materials: luminous base (1.25px) + bright index (2px).
  // Cool cyan carries the terrain so the warm fault zone wins by hue.
  const baseMat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: 1.5,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const indexMat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: 2.25,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  baseMat.resolution.set(1280, 720);
  indexMat.resolution.set(1280, 720);

  // 12 levels chained into smooth strips; every 4th is a brighter index contour.
  for (let k = 0; k < LEVELS; k++) {
    const level = mn + ((k + 0.5) / LEVELS) * (mx - mn);
    const y = level * VEX;
    const isIndex = k % 4 === 3;
    const col = level >= 0 ? (isIndex ? INDEX_COL : BASE_COL) : BELOW_COL;
    for (const p of chainSegments(levelSegments(H, N, step, level))) {
      if (p.length < 2) continue;
      group.add(stripObject(smoothPath(p), y, col, isIndex ? indexMat : baseMat));
    }
  }

  // Solid table body: elevation-tinted surface under the contours — dark
  // teal in the lows rising to deep cyan on the highs, one draw, normal
  // blending so it reads as matter, not light. Lines stay crisp on top.
  {
    const SEG = 96;
    const body = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    const pa = body.attributes.position;
    const colors = new Float32Array(pa.count * 3);
    const cLo = new THREE.Color(0x062027);
    const cHi = new THREE.Color(0x1a6a80);
    const tmp = new THREE.Color();
    const span = (mx - mn) || 1;
    for (let k = 0; k < pa.count; k++) {
      const x = pa.getX(k);
      const z = -pa.getY(k); // plane Y maps to world -Z after rotation
      const h = field(x, z);
      pa.setZ(k, h * VEX - 0.04);
      const t = (h - mn) / span;
      tmp.copy(cLo).lerp(cHi, t * t);
      const f = 1 - smooth(12, 19.5, Math.hypot(x, z));
      colors[k * 3] = tmp.r * f;
      colors[k * 3 + 1] = tmp.g * f;
      colors[k * 3 + 2] = tmp.b * f;
    }
    body.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    body.computeVertexNormals();
    // Circular alpha mask: the square plane must die exactly at the ring —
    // no dark corners peeking outside the mapped circle.
    const mask = document.createElement('canvas');
    mask.width = mask.height = 256;
    const mctx = mask.getContext('2d');
    const mg = mctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    mg.addColorStop(0, 'rgba(255,255,255,1)');
    mg.addColorStop(0.86, 'rgba(255,255,255,1)');
    mg.addColorStop(0.93, 'rgba(255,255,255,0)');
    mctx.fillStyle = mg;
    mctx.fillRect(0, 0, 256, 256);
    const maskTex = new THREE.CanvasTexture(mask);
    const bodyMesh = new THREE.Mesh(body, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.92, fog: false,
      alphaMap: maskTex,
    }));
    bodyMesh.rotation.x = -Math.PI / 2;
    bodyMesh.renderOrder = -1;
    group.add(bodyMesh);
  }
  // Faint dark base disc.
  const discGeo = new THREE.CircleGeometry(R_MAP, 64);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0x02080c,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.18;
  group.add(disc);

  // Boundary ring: fat-line + survey ticks, always legible — this is the
  // mapped 20 km circle. Ticks every 15° read as survey markers at TOP.
  const ringPos = [];
  for (let i = 0; i < 160; i++) {
    const a0 = (i / 160) * Math.PI * 2, a1 = ((i + 1) / 160) * Math.PI * 2;
    ringPos.push(Math.cos(a0) * R_MAP, 0.02, Math.sin(a0) * R_MAP,
      Math.cos(a1) * R_MAP, 0.02, Math.sin(a1) * R_MAP);
  }
  const ringGeo = new LineGeometry();
  ringGeo.setPositions(ringPos);
  const ringMat = new LineMaterial({
    color: RING_COL,
    linewidth: 2,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  ringMat.resolution.set(1280, 720);
  group.add(new Line2(ringGeo, ringMat));
  // Glass-slab thickness: faint outer echo of the boundary ring.
  const lipGeo = new LineGeometry();
  const lipPos = [];
  for (let i = 0; i < 160; i++) {
    const a0 = (i / 160) * Math.PI * 2, a1 = ((i + 1) / 160) * Math.PI * 2;
    lipPos.push(Math.cos(a0) * (R_MAP + 0.4), -0.05, Math.sin(a0) * (R_MAP + 0.4),
      Math.cos(a1) * (R_MAP + 0.4), -0.05, Math.sin(a1) * (R_MAP + 0.4));
  }
  lipGeo.setPositions(lipPos);
  const lipMat = new LineMaterial({
    color: RING_COL, linewidth: 1.5, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  lipMat.resolution.set(1280, 720);
  group.add(new Line2(lipGeo, lipMat));
  const tickPos = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    tickPos.push(c * (R_MAP - 0.7), 0.02, s * (R_MAP - 0.7), c * R_MAP, 0.02, s * R_MAP);
  }
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPos, 3));
  const tickMat = new THREE.LineBasicMaterial({
    color: RING_COL, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  group.add(new THREE.LineSegments(tickGeo, tickMat));

  scene.add(group);

  return {
    mesh: group,
    setSize(w, h) {
      baseMat.resolution.set(w, h);
      indexMat.resolution.set(w, h);
      ringMat.resolution.set(w, h);
      lipMat.resolution.set(w, h);
    },
    update(t = 0) {
      baseMat.opacity = 0.8 + 0.06 * Math.sin(t * 1.2);
      indexMat.opacity = 0.95 + 0.05 * Math.sin(t * 1.2 + 0.6);
      ringMat.opacity = 0.45 + 0.1 * Math.sin(t * 1.2 + 1.3);
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material !== baseMat && o.material !== indexMat) o.material.dispose();
      });
      baseMat.dispose();
      indexMat.dispose();
    },
  };
}
