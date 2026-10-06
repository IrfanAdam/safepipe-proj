/* Safepipe Ops 3D — src/ops3d/terrain.js · holographic topo map.
 * buildTerrain(scene) → { mesh, update, dispose }
 * The terrain IS its contour lines: seeded value-noise field contoured on
 * a 128×128 grid at 20 levels via marching squares → additive
 * THREE.LineSegments (dim blue-white, brighter every 4th index contour).
 * Lines run UNDER everything (facilities sit on the terrain, hologram-style)
 * — no corridor/pad flattening. Faint dark base disc + thin accent boundary
 * ring + glowing POI dots. Each contour loop rides at its true elevation ×
 * exaggeration (~1 unit per level step, capped ×4) — steep ground stacks
 * glowing curves vertically, flats rest as sparse rings near the floor.
 * WebGL1-safe (no custom GLSL at all).
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { getLayout } from './health-feed.js';

const SIZE = 26; // map extent (world units) — matches TOP framing
const N = 128; // marching-squares grid cells per side
const LEVELS = 20; // elevation levels
const FLAT_Y = -0.02; // grade under corridors/pads
const AMP = 2.0; // gentle: contour layout varies at most ±2 in Y
const CORRIDOR_HALF = 1.0; // flat half-width around each pipeline centreline
const BASE_COL = [0x63, 0x9c, 0xb8].map((v) => v / 255);
const BELOW_COL = [0x2c, 0x55, 0x66].map((v) => v / 255);
const INDEX_COL = [0x9f, 0xd4, 0xe8].map((v) => v / 255);
const RING_COL = 0x2fa8c7;
const POI_COL = 0xffc46b;

/* Deterministic integer-lattice value noise (CPU side). */
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

/* Seeded relief field. No corridor/pad flattening — the hologram runs
 * under everything and facilities sit on the terrain (health data reads
 * by color separation: cyan terrain vs bone/amber/red assets). */
function field(x, z) {
  const lumps = fbm(x * 0.09 + 7.3, z * 0.09 + 2.1) - 0.5;
  const swell = fbm(x * 0.035 + 1.7, z * 0.035 + 9.4) - 0.5;
  const detail = fbm(x * 0.28 + 3.1, z * 0.28 + 8.8) - 0.5;
  const h = (lumps * 2.2 + swell * 2.0 + detail * 0.8) * AMP * 0.5;
  // Guaranteed landforms (noise alone can leave the ops centre flat):
  // two hills clear of the asset cluster + a rim bowl toward the map edge,
  // so dense concentric strata exist by construction, not by luck.
  const gauss = (cx, cz, r, a) => {
    const dx = x - cx;
    const dz = z - cz;
    return a * Math.exp(-(dx * dx + dz * dz) / (r * r));
  };
  const land =
    h + gauss(-8.5, 6.5, 4.5, 2.6) + gauss(9, -7.5, 5, 3.0) + gauss(1, 11, 4, 1.8);
  const edge = Math.hypot(x, z);
  const rim = smooth(9.5, 13.5, edge) * 2.4;
  return FLAT_Y + land + rim;
}

/* One marching-squares level → segments appended to pos/col arrays.
 * Lines ride at yLevel: true elevation × vertical exaggeration, so steep
 * ground stacks glowing curves vertically and flats rest near the floor. */
function contourLevel(H, n, step, level, yLevel, col, pos, cols) {
  const push = (gx, gz) => {
    pos.push(-SIZE / 2 + gx * step, yLevel, -SIZE / 2 + gz * step);
    cols.push(col[0], col[1], col[2]);
  };
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
      if (pts.length === 2) {
        push(pts[0][0], pts[0][1]);
        push(pts[1][0], pts[1][1]);
      } else if (pts.length === 4) {
        push(pts[0][0], pts[0][1]);
        push(pts[1][0], pts[1][1]);
        push(pts[2][0], pts[2][1]);
        push(pts[3][0], pts[3][1]);
      }
    }
  }
}

export function buildTerrain(scene) {
  if (!scene) throw new Error('buildTerrain: scene required');
  const layout = getLayout();
  const group = new THREE.Group();
  group.name = 'ops-terrain';

  // Sample the field on the grid.
  const step = SIZE / N;
  const H = new Float32Array((N + 1) * (N + 1));
  let mn = Infinity;
  let mx = -Infinity;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const h = field(-SIZE / 2 + i * step, -SIZE / 2 + j * step, layout);
      H[j * (N + 1) + i] = h;
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
  }

  // Extract LEVELS contours; every 4th is a brighter index contour.
  // True elevation × exaggeration: adjacent levels sit ~1 unit apart in Y.
  const vStep = (mx - mn) / LEVELS || 1;
  const VEX = Math.min(4, Math.max(1.5, 1 / vStep));
  const pos = [];
  const cols = [];
  for (let k = 0; k < LEVELS; k++) {
    const level = mn + ((k + 0.5) / LEVELS) * (mx - mn);
    const yLevel = FLAT_Y + (level - FLAT_Y) * VEX;
    // Two-tone datum: above-grade glows cyan, below-grade sinks dim teal —
    // instant above/below-ground read; every 4th above is a brighter index.
    const col = level >= FLAT_Y ? (k % 4 === 3 ? INDEX_COL : BASE_COL) : BELOW_COL;
    contourLevel(H, N, step, level, yLevel, col, pos, cols);
  }
  // Fat lines (2px, resolution-independent) — 1px contours can't carry
  // terrain; same treatment as the network boxes (see network.js).
  const lineGeo = new LineSegmentsGeometry();
  lineGeo.setPositions(pos);
  lineGeo.setColors(cols);
  const lineMat = new LineMaterial({
    vertexColors: true,
    linewidth: 2,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  lineMat.resolution.set(1280, 720);
  group.add(new LineSegments2(lineGeo, lineMat));

  // Faint dark base disc.
  const discGeo = new THREE.CircleGeometry(SIZE / 2, 64);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0x02080c,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.08;
  group.add(disc);

  // Thin accent ring marking the map boundary.
  const ringPts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a) * (SIZE / 2 - 0.1), 0.02, Math.sin(a) * (SIZE / 2 - 0.1)));
  }
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const ringMat = new THREE.LineBasicMaterial({
    color: RING_COL,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  group.add(new THREE.Line(ringGeo, ringMat));

  // Glowing POI dots where corridors meet facilities.
  const poiGeo = new THREE.BufferGeometry().setFromPoints(
    layout.facilities.map((f) => new THREE.Vector3(f.position[0], 0.3, f.position[1])),
  );
  const poiMat = new THREE.PointsMaterial({
    color: POI_COL,
    size: 0.35,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  group.add(new THREE.Points(poiGeo, poiMat));

  scene.add(group);

  return {
    mesh: group,
    setSize(w, h) {
      lineMat.resolution.set(w, h);
    },
    update(t = 0) {
      lineMat.opacity = 0.82 + 0.12 * Math.sin(t * 1.2);
      ringMat.opacity = 0.55 + 0.2 * Math.sin(t * 1.2 + 1.3);
      poiMat.size = 0.32 + 0.06 * Math.sin(t * 2.1);
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}
