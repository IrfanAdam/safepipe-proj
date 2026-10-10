/* Safepipe Ops3D Ring-2 — src/ring2/overlays.js (Phase 3, Task 7).
 * Twin draws OVERLAYS ONLY on a transparent three.js canvas over the
 * MapLibre base. No ground mesh, no sky, no satellite — the map owns all
 * ground (mapbase.js). Every overlay vertex is ground-sat via sampleH.
 *
 * Layers:
 *   1. RING-2 ring line — FULL 10 km mapped radius (RING_RADIUS_M), never
 *      sized to the DEM window (v1 lens class). Labelled source:mapped.
 *   2. Schematic terminal blocks — analytic boxes/tanks near the pin, each
 *      sprite-labelled `source:schematic` (never poses as surveyed).
 *      Every label pill (ring, pin, schematic, contour) declutters by
 *      range: max 3 + a +N count pill at map range, the full set only
 *      zoomed in, each pill joined to its anchor by a leader line.
 *   3. Contours from sampleH — 2-tier (minor + major index), index rings
 *      numbered with elevation labels sourced from the live field status.
 *      Contour alpha fades to 0 across the outer 10% of the DEM window.
 *   4. Water tint — WATER_COL blue ONLY where sampleH < 0 (sea level), as a
 *      per-sample feathered-alpha mesh (never an opaque fill quad or box).
 *      WATER_COL must not be used for any non-water overlay.
 *
 * Rebuilds (re-drapes) when the field bus transitions to a better source.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-3]
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SANGACHAL, VEX, RING_RADIUS_M, EXTENT_M } from './site.js';
import { sampleH, sampleSource, onStatus, getStatus } from './field.js';

/** Blue reserved EXCLUSIVELY for water (sampleH < 0). */
export const WATER_COL = 0x2f6fd8;
export const RING_COL = 0xe8a33d;
export const CONTOUR_MINOR_COL = 0xd7dde2;
export const CONTOUR_MAJOR_COL = 0xffc46b;
export const SCHEMATIC_COL = 0x9aa4ad;
export const SCHEMATIC_EDGE_COL = 0xe8a33d;

const MINOR_INTERVAL_M = 20;
const INDEX_EVERY = 5; // every 5th minor line is a numbered index ring
const GRID_N = 140; // marching-squares grid across the full extent
const LIFT_RING = 25;
const LIFT_MINOR = 12;
const LIFT_MAJOR = 18;
const LIFT_WATER = 8;

/* Defect-fix tuning (verified against mix0/50/100 TOP captures). */
const WATER_FEATHER_M = 8; // shoreline feather band: alpha ramps 0->full over this depth
const WATER_MAX_OPACITY = 0.55;
const EDGE_FADE_FRAC = 0.10; // outer 10% of the DEM window fades to 0 (no razor edge)
const PILL_COLLAPSE_RANGE_M = 12000; // above: max 3 pills + count; below: full set
const PILL_MAX_MAP_RANGE = 3;

/* Schematic terminal program (NOT surveyed — every block is labelled). */
const SCHEMATIC_BLOCKS = [
  { name: 'TRAIN-1', kind: 'box', w: 420, d: 180, h: 60, x: -350, z: -150 },
  { name: 'TRAIN-2', kind: 'box', w: 420, d: 180, h: 60, x: -350, z: 150 },
  { name: 'TANK-FARM', kind: 'cyl', r: 160, h: 70, x: 480, z: -260 },
  { name: 'PUMP-HALL', kind: 'box', w: 260, d: 140, h: 50, x: -60, z: -560 },
  { name: 'ADMIN', kind: 'box', w: 200, d: 120, h: 40, x: 120, z: 560 },
  { name: 'FLARE', kind: 'stack', r: 12, h: 220, x: 720, z: 420 },
];

/** Canvas text sprite. Returns THREE.Sprite with world-height `h`. */
export function makeLabelSprite(text, { h = 260, fg = '#f2f5f6', accent = '#e8a33d' } = {}) {
  const pad = 18;
  const cv = document.createElement('canvas');
  const cx = cv.getContext('2d');
  const font = '600 34px ui-monospace, Menlo, monospace';
  cx.font = font;
  const w = Math.ceil(cx.measureText(text).width) + pad * 2 + 14;
  const hh = 56 + pad;
  cv.width = w;
  cv.height = hh;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(8,12,16,0.78)';
  c.fillRect(0, 0, w, hh);
  c.fillStyle = accent;
  c.fillRect(0, 0, 6, hh);
  c.font = font;
  c.fillStyle = fg;
  c.textBaseline = 'middle';
  c.fillText(text, pad + 10, hh / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set((h * w) / hh, h, 1);
  sp.userData.baseOpacity = 1;
  sp.userData.tex = tex;
  return sp;
}

/* Marching squares: per-level segments over a sampled height grid. */
function contourSegments(grid, half, levels) {
  const n = grid.length - 1;
  const cell = (2 * half) / n;
  const out = new Map(levels.map((L) => [L, []]));
  const xz = (i, j) => ({ x: -half + j * cell, z: -half + i * cell });
  for (const L of levels) {
    const segs = out.get(L);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const h00 = grid[i][j] - L;
        const h10 = grid[i][j + 1] - L;
        const h11 = grid[i + 1][j + 1] - L;
        const h01 = grid[i + 1][j] - L;
        let idx = 0;
        if (h00 > 0) idx |= 8;
        if (h10 > 0) idx |= 4;
        if (h11 > 0) idx |= 2;
        if (h01 > 0) idx |= 1;
        if (idx === 0 || idx === 15) continue;
        const p = (a, b, ha, hb) => {
          const t = ha / (ha - hb);
          return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        };
        const A = xz(i, j);
        const B = xz(i, j + 1);
        const C = xz(i + 1, j + 1);
        const D = xz(i + 1, j);
        const top = () => p(A, B, h00, h10);
        const right = () => p(B, C, h10, h11);
        const bottom = () => p(D, C, h01, h11);
        const left = () => p(A, D, h00, h01);
        const emit = (u, v) => segs.push(u, v);
        switch (idx) {
          case 1: case 14: emit(left(), bottom()); break;
          case 2: case 13: emit(bottom(), right()); break;
          case 3: case 12: emit(left(), right()); break;
          case 4: case 11: emit(top(), right()); break;
          case 5: emit(top(), left()); emit(bottom(), right()); break;
          case 6: case 9: emit(top(), bottom()); break;
          case 7: case 8: emit(top(), left()); break;
          case 10: emit(top(), right()); emit(left(), bottom()); break;
          default: break;
        }
      }
    }
  }
  return out;
}

/* Greedy endpoint-hash join of segments into polylines (for index labels). */
function joinSegments(flat, tol = 60) {
  const key = (pt) => `${Math.round(pt.x / tol)},${Math.round(pt.z / tol)}`;
  const startMap = new Map();
  flat.forEach((s, i) => {
    const k = key(s[0]);
    if (!startMap.has(k)) startMap.set(k, []);
    startMap.get(k).push(i);
  });
  const used = new Array(flat.length).fill(false);
  const lines = [];
  for (let i = 0; i < flat.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const line = [flat[i][0], flat[i][1]];
    let grew = true;
    while (grew) {
      grew = false;
      const endK = key(line[line.length - 1]);
      const cand = (startMap.get(endK) ?? []).find(
        (k) => !used[k] && k !== i,
      ) ?? flat.findIndex(
        (s, k) => !used[k] && (key(s[0]) === endK || key(s[1]) === endK),
      );
      if (cand !== undefined && cand >= 0 && !used[cand]) {
        used[cand] = true;
        const s = flat[cand];
        line.push(key(s[0]) === endK ? s[1] : s[0]);
        grew = true;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function createOverlayTwin(container, opts = {}) {
  if (!container) throw new Error('createOverlayTwin: container required');
  const fovDeg = opts.fovDeg ?? 60;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (err) {
    // No WebGL (blocked GPU, old browser): leave a readable verdict in the
    // container instead of a silent transparent canvas. Plain DOM survives.
    const d = document.createElement('div');
    d.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font:12px/1.7 ui-monospace,monospace;color:#ffd9a0;text-align:center;padding:24px;';
    d.textContent =
      'TWIN unavailable: this browser gave no WebGL context (' +
      (err?.message ?? err) + '). The map layer above still works — drag the mix to SAT.';
    container.appendChild(d);
    throw err;
  }
  renderer.setClearColor(0x000000, 0); // transparent: map shows through
  renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
  const canvas = renderer.domElement;
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.dataset.ring2 = 'twin';
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    const d = document.createElement('div');
    d.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font:12px/1.7 ui-monospace,monospace;color:#ffd9a0;text-align:center;padding:24px;';
    d.textContent = 'TWIN: WebGL context LOST mid-render (GPU/driver). Reload the tab.';
    container.appendChild(d);
  });
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    fovDeg,
    Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
    10,
    120000,
  );
  const startRange = opts.startRange ?? 26000;
  camera.position.set(0, startRange, 0.01);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = (85 * Math.PI) / 180;
  controls.minDistance = 800;
  controls.maxDistance = 60000;

  const group = new THREE.Group();
  group.name = 'ring2-overlays';
  scene.add(group);
  const perfClock = new THREE.Clock();

  const disposables = [];
  const track = (o) => {
    disposables.push(o);
    return o;
  };
  let emphasisMats = []; // { mat, base }
  const reg = (mat, base = mat.opacity) => {
    mat.userData.baseOpacity = base;
    emphasisMats.push(mat);
    return mat;
  };

  function groundY(x, z, lift = 0) {
    return sampleH(x, z) * VEX + lift;
  }

  function buildRing(src) {
    const SEG = 256;
    const pos = new Float32Array((SEG + 1) * 3);
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = Math.cos(a) * RING_RADIUS_M;
      const z = Math.sin(a) * RING_RADIUS_M;
      pos[i * 3] = x;
      pos[i * 3 + 1] = groundY(x, z, LIFT_RING);
      pos[i * 3 + 2] = z;
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = reg(track(new THREE.LineBasicMaterial({
      color: RING_COL, transparent: true, opacity: 0.95, depthWrite: false,
    })));
    const ring = new THREE.Line(g, m);
    ring.name = 'ring2-ring';
    ring.frustumCulled = false;
    group.add(ring);
    const lbl = makeLabelSprite(`RING-2 · r ${SANGACHAL.radiusKm} km · source:${src}`, { h: 420 });
    reg(lbl.material);
    lbl.position.set(RING_RADIUS_M * Math.cos(Math.PI / 4), groundY(RING_RADIUS_M * 0.7, RING_RADIUS_M * 0.7, 700), RING_RADIUS_M * Math.sin(Math.PI / 4));
    group.add(lbl);
    const ringAnchor = new THREE.Vector3(
      RING_RADIUS_M * Math.cos(Math.PI / 4),
      groundY(RING_RADIUS_M * Math.cos(Math.PI / 4), RING_RADIUS_M * Math.sin(Math.PI / 4), 0),
      RING_RADIUS_M * Math.sin(Math.PI / 4),
    );
    labels.push({ sprite: lbl, leader: makeLeader(ringAnchor, lbl.position), anchor: ringAnchor });
    // Site pin cross at the terminal.
    const pinG = track(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-500, 0, 0), new THREE.Vector3(500, 0, 0),
      new THREE.Vector3(0, 0, -500), new THREE.Vector3(0, 0, 500),
    ]));
    const pin = new THREE.LineSegments(pinG, reg(track(new THREE.LineBasicMaterial({
      color: RING_COL, transparent: true, opacity: 0.8, depthWrite: false,
    }))));
    pin.position.y = groundY(0, 0, 40);
    group.add(pin);
    const pinLbl = makeLabelSprite(
      `SANGACHAL ${SANGACHAL.lat.toFixed(6)}N ${SANGACHAL.lon.toFixed(6)}E · source:mapped`, { h: 380 },
    );
    reg(pinLbl.material);
    pinLbl.position.set(0, groundY(0, 0, 1100), 0);
    group.add(pinLbl);
    const pinAnchor = new THREE.Vector3(0, groundY(0, 0, 0), 0);
    labels.push({ sprite: pinLbl, leader: makeLeader(pinAnchor, pinLbl.position), anchor: pinAnchor });
  }

  function makeLeader(a, bPos) {
    const g = track(new THREE.BufferGeometry().setFromPoints([a.clone(), bPos.clone()]));
    const line = new THREE.Line(g, reg(track(new THREE.LineBasicMaterial({
      color: SCHEMATIC_EDGE_COL, transparent: true, opacity: 0.55, depthWrite: false,
    })), 0.55));
    line.frustumCulled = false;
    group.add(line);
    return line;
  }

  /* Every label pill: tracked for map-range declutter (max 3 + count). */
  let labels = [];
  let countPill = null;
  let countLeader = null;

  function buildSchematic() {
    for (const b of SCHEMATIC_BLOCKS) {
      const gy = groundY(b.x, b.z, 0);
      const blockTop = new THREE.Vector3(b.x, gy + (b.h ?? 60) * VEX, b.z);
      let mesh;
      if (b.kind === 'box') {
        mesh = new THREE.Mesh(
          track(new THREE.BoxGeometry(b.w, b.h * VEX, b.d)),
          reg(track(new THREE.MeshBasicMaterial({ color: SCHEMATIC_COL, transparent: true, opacity: 0.55, depthWrite: false }))),
        );
        mesh.position.set(b.x, gy + (b.h * VEX) / 2, b.z);
      } else if (b.kind === 'cyl') {
        mesh = new THREE.Mesh(
          track(new THREE.CylinderGeometry(b.r, b.r, b.h * VEX, 28)),
          reg(track(new THREE.MeshBasicMaterial({ color: SCHEMATIC_COL, transparent: true, opacity: 0.55, depthWrite: false }))),
        );
        mesh.position.set(b.x, gy + (b.h * VEX) / 2, b.z);
      } else {
        mesh = new THREE.Mesh(
          track(new THREE.CylinderGeometry(b.r, b.r * 1.6, b.h * VEX, 10)),
          reg(track(new THREE.MeshBasicMaterial({ color: SCHEMATIC_COL, transparent: true, opacity: 0.7, depthWrite: false }))),
        );
        mesh.position.set(b.x, gy + (b.h * VEX) / 2, b.z);
        const tip = makeLabelSprite('FLARE-TIP · source:schematic', { h: 300 });
        reg(tip.material);
        tip.position.set(b.x, gy + b.h * VEX + 260, b.z);
        tip.name = 'flare-tip';
        group.add(tip);
        labels.push({ sprite: tip, leader: makeLeader(blockTop, tip.position), anchor: blockTop });
      }
      mesh.name = `schematic-${b.name}`;
      group.add(mesh);
      const edges = new THREE.LineSegments(
        track(new THREE.EdgesGeometry(mesh.geometry)),
        reg(track(new THREE.LineBasicMaterial({ color: SCHEMATIC_EDGE_COL, transparent: true, opacity: 0.9, depthWrite: false }))),
      );
      edges.position.copy(mesh.position);
      group.add(edges);
      const lbl = makeLabelSprite(`${b.name} · source:schematic`, { h: 300 });
      reg(lbl.material);
      lbl.position.set(b.x, gy + (b.h ?? 60) * VEX + 520, b.z);
      group.add(lbl);
      labels.push({ sprite: lbl, leader: makeLeader(blockTop, lbl.position), anchor: blockTop });
    }
  }

  /* +N count pill for the collapsed map-range set; sits over the hidden
   * labels' centroid with its own leader line. Built LAST so N covers
   * every label (ring, pin, schematic, contour). */
  function buildCountPill() {
    if (labels.length <= PILL_MAX_MAP_RANGE) return;
    const hidden = labels.slice(PILL_MAX_MAP_RANGE);
    const c = new THREE.Vector3();
    for (const p of hidden) c.add(p.anchor);
    c.multiplyScalar(1 / hidden.length);
    countPill = makeLabelSprite(`+${hidden.length} MORE`, { h: 300, accent: '#9aa4ad' });
    reg(countPill.material);
    countPill.position.set(c.x, c.y + 2600, c.z);
    group.add(countPill);
    countLeader = makeLeader(c, countPill.position);
    countPill.visible = false;
    countLeader.visible = false;
  }

  /* Map-range declutter: above PILL_COLLAPSE_RANGE_M only the first
   * PILL_MAX_MAP_RANGE pills draw, plus the +N count pill; zoomed in the
   * full set returns. Runs per frame from update(). */
  function updatePills() {
    if (!labels.length) return;
    const collapsed = camera.position.distanceTo(controls.target) > PILL_COLLAPSE_RANGE_M;
    labels.forEach((p, i) => {
      const vis = !collapsed || i < PILL_MAX_MAP_RANGE;
      p.sprite.visible = vis;
      p.leader.visible = vis;
    });
    const showCount = collapsed && labels.length > PILL_MAX_MAP_RANGE;
    if (countPill) countPill.visible = showCount;
    if (countLeader) countLeader.visible = showCount;
  }

  function getPillState() {
    return {
      range: Math.round(camera.position.distanceTo(controls.target)),
      collapsed: camera.position.distanceTo(controls.target) > PILL_COLLAPSE_RANGE_M,
      visible: labels.filter((p) => p.sprite.visible).length,
      total: labels.length,
    };
  }

  function buildContours(src) {
    const half = EXTENT_M / 2;
    const n = GRID_N;
    const grid = [];
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i <= n; i++) {
      const row = new Float32Array(n + 1);
      for (let j = 0; j <= n; j++) {
        const x = -half + ((2 * half) * j) / n;
        const z = -half + ((2 * half) * i) / n;
        const h = sampleH(x, z);
        row[j] = h;
        if (h < mn) mn = h;
        if (h > mx) mx = h;
      }
      grid.push(row);
    }
    const levels = [];
    for (let L = Math.ceil(mn / MINOR_INTERVAL_M) * MINOR_INTERVAL_M; L <= mx; L += MINOR_INTERVAL_M) {
      levels.push(L);
      if (levels.length > 48) break; // relief guard
    }
    if (!levels.length) return { min: mn, max: mx, indexCount: 0 };
    const perLevel = contourSegments(grid, half, levels);
    const minorPos = [];
    const minorFade = [];
    const majorPos = [];
    const majorFade = [];
    let indexCount = 0;
    const labelBudget = 24;
    for (const L of levels) {
      const segs = perLevel.get(L);
      if (!segs.length) continue;
      const isIndex = Math.round(L / MINOR_INTERVAL_M) % INDEX_EVERY === 0;
      const lift = isIndex ? LIFT_MAJOR : LIFT_MINOR;
      const arr = isIndex ? majorPos : minorPos;
      const fadeArr = isIndex ? majorFade : minorFade;
      const y = L * VEX + lift;
      for (let k = 0; k < segs.length; k += 2) {
        arr.push(segs[k].x, y, segs[k].z, segs[k + 1].x, y, segs[k + 1].z);
        fadeArr.push(edgeFade(segs[k].x, segs[k].z), edgeFade(segs[k + 1].x, segs[k + 1].z));
      }
      if (isIndex && indexCount < labelBudget) {
        const flat = [];
        for (let k = 0; k < segs.length; k += 2) flat.push([segs[k], segs[k + 1]]);
        const lines = joinSegments(flat);
        lines.sort((a, b) => b.length - a.length);
        const longest = lines[0];
        if (longest && longest.length > 24) {
          const mid = longest[Math.floor(longest.length / 2)];
          const lbl = makeLabelSprite(`${L} m · source:${src}`, { h: 300, accent: '#ffc46b' });
          lbl.material.opacity = edgeFade(mid.x, mid.z); // dissolve at coverage edge
          reg(lbl.material);
          lbl.position.set(mid.x, L * VEX + 420, mid.z);
          group.add(lbl);
          const cAnchor = new THREE.Vector3(mid.x, L * VEX, mid.z);
          labels.push({ sprite: lbl, leader: makeLeader(cAnchor, lbl.position), anchor: cAnchor });
          indexCount++;
        }
      }
    }
    const mkLines = (arr, fade, color, opacity) => {
      if (!arr.length) return;
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
      // RGBA vertex colors: per-vertex alpha carries the outer-10% DEM
      // fade so contours dissolve at the coverage edge (no razor line).
      const c = new THREE.Color(color);
      const carr = new Float32Array(fade.length * 4);
      for (let i = 0; i < fade.length; i++) {
        const f = Math.min(1, Math.max(0, fade[i]));
        carr[i * 4] = c.r;
        carr[i * 4 + 1] = c.g;
        carr[i * 4 + 2] = c.b;
        carr[i * 4 + 3] = f * f * (3 - 2 * f);
      }
      g.setAttribute('color', new THREE.BufferAttribute(carr, 4));
      const m = new THREE.LineSegments(g, reg(track(new THREE.LineBasicMaterial({
        color: 0xffffff, vertexColors: true, transparent: true, opacity, depthWrite: false,
      }))));
      m.frustumCulled = false;
      group.add(m);
    };
    mkLines(minorPos, minorFade, CONTOUR_MINOR_COL, 0.4);
    mkLines(majorPos, majorFade, CONTOUR_MAJOR_COL, 0.85);
    return { min: mn, max: mx, indexCount };
  }

/* Outer-10% DEM-window fade: 1 inside, smoothstepping to 0 at the
 * extent edge, so overlays never end in a razor line. The 10 km ring
 * itself is exempt (it is the mapped radius, not DEM coverage). */
function edgeFade(x, z) {
  const half = EXTENT_M / 2;
  const m = Math.max(Math.abs(x), Math.abs(z));
  const inner = half * (1 - EDGE_FADE_FRAC);
  if (m <= inner) return 1;
  if (m >= half) return 0;
  const u = (m - inner) / (half - inner);
  return 1 - u * u * (3 - 2 * u);
}

  function buildWater() {
    const half = EXTENT_M / 2;
    const n = 90;
    const vn = n + 1;
    const cell = (2 * half) / n;
    // Shared vertices (not per-cell quads): per-vertex alpha interpolates,
    // so the shoreline feathers instead of stair-stepping, and the DEM
    // window edge fades instead of clipping to a box. Water ONLY where
    // sampleH < 0 — no fill quad is ever emitted for land.
    const wc = new THREE.Color(WATER_COL);
    const pos = new Float32Array(vn * vn * 3);
    const col = new Float32Array(vn * vn * 4);
    const alphaAt = (x, z) => {
      const depth = -sampleH(x, z);
      if (!(depth > 0)) return 0;
      const u = Math.min(1, depth / WATER_FEATHER_M);
      return (u * u * (3 - 2 * u)) * edgeFade(x, z);
    };
    for (let i = 0; i < vn; i++) {
      for (let j = 0; j < vn; j++) {
        const x = -half + j * cell;
        const z = -half + i * cell;
        const k = i * vn + j;
        pos[k * 3] = x;
        pos[k * 3 + 1] = LIFT_WATER; // flat sea plane: sea level 0 + lift
        pos[k * 3 + 2] = z;
        col[k * 4] = wc.r;
        col[k * 4 + 1] = wc.g;
        col[k * 4 + 2] = wc.b;
        col[k * 4 + 3] = alphaAt(x, z);
      }
    }
    const idx = [];
    let wet = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const k00 = i * vn + j;
        const k10 = k00 + 1;
        const k01 = k00 + vn;
        const k11 = k01 + 1;
        if (col[k00 * 4 + 3] <= 0 && col[k10 * 4 + 3] <= 0 &&
            col[k01 * 4 + 3] <= 0 && col[k11 * 4 + 3] <= 0) continue;
        idx.push(k00, k01, k10, k10, k01, k11);
        wet++;
      }
    }
    if (!idx.length) return 0;
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4)); // RGBA: per-sample alpha
    g.setIndex(idx);
    const m = new THREE.Mesh(g, reg(track(new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, opacity: WATER_MAX_OPACITY,
      depthWrite: false, side: THREE.DoubleSide,
    })), WATER_MAX_OPACITY));
    m.name = 'ring2-water';
    m.frustumCulled = false;
    group.add(m);
    return wet;
  }

  let lastInfo = null;
  function rebuild() {
    group.traverse((o) => {
      try {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      } catch { /* noop */ }
    });
    group.clear();
    for (const d of disposables.splice(0)) {
      try {
        d.dispose?.();
      } catch { /* noop */ }
    }
    emphasisMats = [];
    labels = [];
    countPill = null;
    countLeader = null;
    const src = sampleSource(0, 0);
    buildRing(src === 'terrarium' ? 'mapped' : src);
    buildSchematic();
    const c = buildContours(src);
    const waterCells = buildWater();
    buildCountPill(); // last: +N covers ring + pin + schematic + contour labels
    lastInfo = { ...c, waterCells, source: src, at: Date.now() };
    applyEmphasis(lastT);
    return lastInfo;
  }

  // Re-drape when the field lands on a better source (coarse -> live).
  let debounce = 0;
  const unsub = onStatus((s) => {
    if (s.stage === 'live' || s.stage === 'srtm') {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          rebuild();
        } catch { /* a failed re-drape never kills the loop */ }
      }, 300);
    }
  });

  let lastT = 0.5;
  function applyEmphasis(t) {
    lastT = Math.min(1, Math.max(0, t));
    const k = 0.25 + 0.75 * lastT;
    for (const m of emphasisMats) m.opacity = (m.userData.baseOpacity ?? m.opacity) * k;
  }
  function setEmphasis(t) {
    applyEmphasis(t);
  }

  function getPose() {
    const ty = sampleH(controls.target.x, controls.target.z) * VEX;
    return {
      eye: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: ty, z: controls.target.z },
    };
  }

  function update() {
    controls.update();
    updatePills();
    const t = perfClock.getElapsedTime();
    const flare = group.getObjectByName('flare-tip');
    if (flare) {
      const s = 1 + 0.06 * Math.sin(t * 7.3) + 0.03 * Math.sin(t * 17.7);
      flare.scale.set(s, 1, 1);
    }
    renderer.render(scene, camera);
  }

  function onResize() {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  onResize();
  window.addEventListener('resize', onResize);

  function dispose() {
    unsub?.();
    clearTimeout(debounce);
    window.removeEventListener('resize', onResize);
    controls.dispose();
    renderer.dispose();
    canvas.remove();
  }

  rebuild();
  applyEmphasis(lastT);

  return {
    renderer, scene, camera, controls, canvas,
    rebuild, setEmphasis, update, getPose, dispose, onResize,
    getInfo: () => ({ ...(lastInfo ?? {}), status: getStatus(), pills: getPillState() }),
  };
}
