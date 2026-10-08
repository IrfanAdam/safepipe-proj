/* Safepipe Ops 3D — src/ops3d/terrain.js · Athabasca-representative holographic topo.
 * buildTerrain(scene) → { mesh, terrainSource, setDetail, setSize, update, dispose }
 * Representative Athabasca-basin floor (1 unit = 1 km): eastward dip ~2.2 m/km
 * + broad low swells ±46 m + TWO hills (+80/+64 m, auto-nudged clear of
 * pipe corridors so rings close around real highs) + saddle hollow (−32 m)
 * + west tributary draw ~42 m deep + playa-lake depression ~14 m
 * + N–S Athabasca main valley ~85 m (braided floor, steep east cutbank,
 * gentle west point-bars) + 2 kettle ponds + muskeg mottling
 * + masked plateau variance (mid/high-frequency swell, valley+lake masked)
 * — total relief ≈ −160…+115 m true, VEX 4.5.
 * Altitude source is swappable (setFieldSource/sample): contours sample the
 * active source, so the pinned SRTM DEM renders real relief when it resolves
 * and every drape stays coherent. [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 * No rim mountains. No body fill either — contours glow on the void,
 * neon-plate style, so no faded landmass is ever needed.
 * Marching-squares 160×160 grid at 32 power-spaced levels; unordered
 * segments are chained (quantized-endpoint greedy) into continuous smooth
 * polylines per level, then batched into TWO LineSegments2 meshes (base +
 * index) — two draw calls for the whole contour field. Brighter index
 * lines every 5th level; index rings carry inline elevation pills so the
 * contours read as a plotting technique, not decoration. Cells whose local
 * gradient is below SLOPE_MIN are skipped, so flats stay clean while
 * contours wrap the rest of the terrain.
 * Desaturated cool-grey palette; one muted slate shoreline ring. No dots on
 * terrain, ever. WebGL1-safe (no custom GLSL).
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { getLayout } from './health-feed.js';
import { levelsForRange, _injectField } from './dem.js';

function await_import_layout() {
  try { return { getLayout }; } catch { return {}; }
}

const SIZE = 44; // map extent, km (1 unit = 1 km)
const R_MAP = 20; // boundary ring radius, km
const N = 160; // marching-squares grid cells per side (128→160 for tighter high rings)
const LEVELS = 32; // contour levels (20→32 so slope reads as density)
export const VEX = 4.5; // vertical exaggeration — single source; network/gridfloor import this
const SLOPE_MIN = 0.0028; // skip contour cells flatter than ~2.8 m/km — flats go truly clean
const BASE_COL = new THREE.Color(0xd3d8db); // cool-grey hairline base, not bone-grey
const INDEX_COL = new THREE.Color(0xffffff); // pure white index
const BELOW_COL = new THREE.Color(0x8fa0a8); // below-datum muted blue-grey
const RING_COL = 0x848b90; // boundary ring: neutral survey grey, never an accent
const LAKE_X = -9; // playa lake center, km (flat spot, away from center + draw)
const LAKE_Z = 6;
const LAKE_R = 1.3; // mean radius; shoreline modulated below, ~2.6 km across
const DRAW_W = 0.65; // dry-draw half-width km — narrower banks bend contours into sharp Vs
const LAKE_BLUE = new THREE.Color(0x7e929d); // desaturated slate tint for contours over water
/* Dry-draw centerline, shared by the field carve and the drainage thread. */
function drawCenter(x) {
  return 6 * Math.sin(x * 0.22 + 0.5) + 2 * Math.sin(x * 0.55 + 1.1);
}

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* Organic shoreline: radius modulated by low-order harmonics so the playa
 * reads as a real water body, never a compass circle. 1 inside → 0 outside. */
function lakeR(a) {
  return LAKE_R * (1 + 0.28 * Math.sin(2 * a + 1.1) + 0.16 * Math.sin(3 * a + 0.4) + 0.1 * Math.sin(5 * a + 2.3));
}
function lakeWet(x, z) {
  const dx = x - LAKE_X, dz = z - LAKE_Z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 1;
  const w = d / lakeR(Math.atan2(dz, dx)); // 1 = shoreline
  return 1 - smooth(0.85, 1.15, w);
}

/* Athabasca-basin representative floor field (km units). Eastward dip ~2.2 m/km,
 * broad low swells ±46 m (damped flat near the playa so it sits in a flat
 * spot), TWO hills in pipe-corridor gaps — H1 SE (+80 m), H2 west (+64 m,
 * auto-nudged clear of corridors in buildTerrain) — so index rings close
 * around real highs, one saddle hollow (−32 m), one winding dry draw ~42 m
 * deep with flat-bottom trough, one organic playa-lake depression ~14 m,
 * plus masked plateau variance (mid/high-frequency swell ×2.2 km–500 m
 * wavelengths, kept off the valley floor + lake so the river course and
 * walls stay stable). Grid-measured relief ≈ 274 m, sd ≈ 48 m. No rim. */
export function field(x, z) {
  return _active(x, z);
}

/* Swappable altitude source (Phase 1 Task 6 seam): every drape in the twin
 * (contours, pipes, structures, anchors) calls field(), so one swap moves
 * the whole scene coherently. Default is the procedural floor below. */
let _active = _procedural;
let _source = 'procedural';
export function setFieldSource(fn, source = 'dem') {
  _active = fn;
  _source = source;
}
export function terrainSource() {
  return _source;
}
// Sync probe for the DEM fallback path (tests + offline): same floor.
_injectField(_procedural);

/* Athabasca recipe (Phase 1 Task 8): the main valley runs N–S east of
 * center — braided reach (wide, flat-bottomed, gentle west point-bars) with
 * a steep east cutbank. Two kettle ponds + muskeg mottling complete the
 * valley read. The old dry draw stays on as a west tributary creek. */
function riverX(z) {
  return 7.5 + 3.5 * Math.sin(z * 0.16 + 0.8) + 1.2 * Math.sin(z * 0.41 + 2.0);
}
function riverWet(x, z) {
  const dx = (x - riverX(z)) / 2.2; // ~2.2 km half-width
  return Math.exp(-dx * dx * (x > riverX(z) ? 1.6 : 0.8)); // steep cutbank E, bars W
}
const KETTLES = [
  { x: -4.5, z: 11.5, r: 0.8, d: -0.008 },
  { x: 12.5, z: -7.5, r: 0.65, d: -0.006 },
];

function _procedural(x, z) {
  const dip = -0.0022 * x; // eastward dip: down ~2.2 m per km east
  const lakeMask = lakeWet(x, z);
  const swell =
    (0.046 * Math.sin(x * 0.16 + 1.2) * Math.cos(z * 0.13 - 0.6) +
    0.024 * Math.sin(x * 0.31 - 0.4) * Math.sin(z * 0.27 + 2.0) +
    0.010 * Math.sin(x * 0.63 + 2.1) * Math.sin(z * 0.71 - 0.7)) *
    (1 - 0.82 * lakeMask);
  const bump = (ax, az, sig, amp) => {
    const dx = x - ax, dz = z - az;
    return amp * Math.exp(-(dx * dx + dz * dz) / (2 * sig * sig));
  };
  const hills = bump(H1.x, H1.z, 3.4, 0.080) + bump(H2.x, H2.z, 2.9, 0.064);
  const hollow = bump(7, -3.5, 2.8, -0.032);
  const zc = drawCenter(x);
  const dd = (z - zc) / DRAW_W;
  const ad = Math.abs(dd);
  const drawProf = ad < 0.4 ? 1 : Math.max(0, 1 - (ad - 0.4) / 0.6);
  const draw = -0.042 * drawProf * Math.exp(-dd * dd * 0.35); // ~42 m trough, flat bottom
  const playa = -0.014 * lakeMask; // playa depression, ~14 m deep
  const rw = riverWet(x, z);
  const valley = -0.085 * rw; // Athabasca main valley, ~85 m, flat braided floor
  let kettle = 0;
  for (const k of KETTLES) {
    const dx = x - k.x, dz = z - k.z;
    kettle += k.d * Math.exp(-(dx * dx + dz * dz) / (k.r * k.r));
  }
  // Plateau variance: mid/high-frequency swell that lifts relief + sd toward
  // the Copernicus band. Masked off the valley floor + lake, so the river
  // course, wall depths, and playa flat are untouched.
  const plat = (1 - rw) * (1 - 0.85 * lakeMask);
  const platvar = plat * (
    0.012 * Math.sin(x * 0.52 + 0.9) * Math.cos(z * 0.49 + 0.2) +
    0.008 * Math.sin(x * 1.08 + 2.2) * Math.sin(z * 0.92 + 0.5) +
    0.004 * Math.sin(x * 1.95 + 1.0) * Math.sin(z * 2.05 + 0.3));
  const muskeg = 0.0045 * Math.sin(x * 1.7 + 0.6) * Math.sin(z * 1.9 - 1.1) * (1 - rw);
  return dip + swell + hills + hollow + draw + playa + valley + kettle + muskeg + platvar;
}

/* Hill centers — defaults sited in pipe-gap quads; buildTerrain nudges them
 * to ≥2.5 km clearance from any pipeline vertex. Mutable so the nudge sticks. */
export const H1 = { x: 8.2, z: 10.1 };
export const H2 = { x: -12.8, z: -1.2 };

/* One marching-squares level → raw unordered segments in world coords.
 * Cells flatter than SLOPE_MIN (from the sampled grid, central differences)
 * contribute no segments, so flats stay clean. */
function levelSegments(H, n, step, level) {
  const segs = [];
  const wx = (g) => -SIZE / 2 + g * step;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = H[j * (n + 1) + i];
      const b = H[j * (n + 1) + i + 1];
      const d = H[(j + 1) * (n + 1) + i];
      const c = H[(j + 1) * (n + 1) + i + 1];
      const gx = ((b + c) - (a + d)) / (2 * step);
      const gz = ((d + c) - (a + b)) / (2 * step);
      if (Math.hypot(gx, gz) < SLOPE_MIN) continue;
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

/* Quantized-endpoint greedy chaining: unordered segments → continuous polylines.
 * Two-pass: tight quant (2 m) first, then loose (5 m) for leftovers — keeps
 * index rings glass-smooth at N=160 without speckle. */
function chainSegments(segs) {
  const chainPass = (list, quant, usedGlobal) => {
    const key = (x, z) => `${Math.round(x * quant)}:${Math.round(z * quant)}`;
    const at = new Map();
    list.forEach((s, i) => {
      if (usedGlobal[i]) return;
      for (let e = 0; e < 2; e++) {
        const k = key(s[e * 2], s[e * 2 + 1]);
        let l = at.get(k);
        if (!l) at.set(k, (l = []));
        l.push(i);
      }
    });
    const take = (x, z) => {
      const l = at.get(key(x, z));
      if (!l) return -1;
      for (const i of l) if (!usedGlobal[i]) return i;
      return -1;
    };
    const paths = [];
    for (let s0 = 0; s0 < list.length; s0++) {
      if (usedGlobal[s0]) continue;
      // only seed from segments that have at least one endpoint in this pass map
      const s = list[s0];
      if (!at.has(key(s[0], s[1])) && !at.has(key(s[2], s[3]))) continue;
      usedGlobal[s0] = 1;
      const pts = [[s[0], s[1]], [s[2], s[3]]];
      for (let end = 0; end < 2; end++) {
        for (;;) {
          const tip = end === 0 ? pts[pts.length - 1] : pts[0];
          const i = take(tip[0], tip[1]);
          if (i < 0) break;
          usedGlobal[i] = 1;
          const g = list[i];
          const other =
            key(g[0], g[1]) === key(tip[0], tip[1]) ? [g[2], g[3]] : [g[0], g[1]];
          if (end === 0) pts.push(other);
          else pts.unshift(other);
        }
      }
      paths.push(pts);
    }
    return paths;
  };
  const used = new Uint8Array(segs.length);
  const tight = chainPass(segs, 500, used);
  const loose = chainPass(segs, 200, used);
  return tight.concat(loose);
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

/* Index-ring elevation tag: OS-plate style — meter readout on a dark plate
 * with the cyberpunk chamfer (cut top-right corner), so it sits inline on
 * the ring and reads at every zoom. */
function elevLabel(text, x, y, z) {
  const cv = document.createElement('canvas');
  cv.width = 192;
  cv.height = 48;
  const ctx = cv.getContext('2d');
  const CUT = 20; // deep enough to read at 3× TOP scale
  ctx.fillStyle = 'rgba(16,20,24,0.9)';
  ctx.beginPath();
  ctx.moveTo(28, 4);
  ctx.lineTo(164 - CUT, 4);
  ctx.lineTo(164, 4 + CUT);
  ctx.lineTo(164, 44);
  ctx.lineTo(28, 44);
  ctx.closePath();
  ctx.fill(); // dark chamfered plate behind the number
  ctx.font = '600 30px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d5dadb';
  ctx.fillText(text, 96, 26);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 1,
    depthWrite: false, depthTest: false, fog: false,
  }));
  sp.scale.set(1.7, 0.425, 1); // small inline readout, never a billboard
  sp.position.set(x, y, z);
  sp.renderOrder = 5;
  return sp;
}

/* Filter/accumulate: every chained polyline contributes its (prev → cur)
 * segment pairs to a tier batch at true elevation × VEX, with periphery
 * fade toward the boundary ring baked into vertex colors. Inside the playa
 * shoreline the neutral grey yields to subtle water blue. */
const _wc = new THREE.Color();
const _white = new THREE.Color(0xffffff);
function pushPath(batch, pts, y, col) {
  if (pts.length < 2) return;
  batch.paths += 1;
  batch.segs += pts.length - 1;
  const hillBoost = y > 0.18 ? 0.35 : 0; // summits bloom toward white
  let has = false;
  let px = 0;
  let pz = 0;
  let pr = 0;
  let pg = 0;
  let pb = 0;
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0];
    const z = pts[i][1];
    const f = 1 - smooth(12, 19.5, Math.hypot(x, z));
    _wc.copy(col);
    if (hillBoost) _wc.lerp(_white, hillBoost);
    _wc.lerp(LAKE_BLUE, Math.min(1, lakeWet(x, z) + riverWet(x, z)) * 0.65);
    const r = _wc.r * f;
    const g = _wc.g * f;
    const b = _wc.b * f;
    if (has) {
      batch.pos.push(px, y, pz, x, y, z);
      batch.clr.push(pr, pg, pb, r, g, b);
    }
    px = x;
    pz = z;
    pr = r;
    pg = g;
    pb = b;
    has = true;
  }
}

export function buildTerrain(scene) {
  if (!scene) throw new Error('buildTerrain: scene required');
  const group = new THREE.Group();
  group.name = 'ops-terrain';
  // Close-up restraint: at segment/asset the fault owns the view, so rings
  // dim + pills shrink on drill-in (TOP keeps full neon).
  let dimF = 1;
  let pillF = 1;

  // Corridor clearance: nudge hills out of pipe corridors so no trunk runs
  // across a peak. Best-effort — layout import is lazy to avoid cycles.
  try {
    const { getLayout } = await_import_layout();
    if (getLayout) {
      const layout = getLayout();
      const poles = [];
      for (const p of layout?.pipelines ?? []) for (const pt of p.points) poles.push(pt);
      for (const f of layout?.facilities ?? []) if (f.position) poles.push(f.position);
      const clearance = (px, pz) => Math.min(...poles.map(([x, z]) => Math.hypot(px - x, pz - z)));
      for (const Hb of [H1, H2]) {
        let k = 0;
        while (poles.length && clearance(Hb.x, Hb.z) < 2.5 && k++ < 12) { Hb.x += 1.2; Hb.z += 0.7; }
      }
    }
  } catch { /* layout unavailable — defaults already clear */ }

  // Sample the Athabasca floor field on the grid.
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
  if (mn < -0.15 || mx > 0.16) console.warn(`[terrain] field out of expected band mn=${mn.toFixed(3)} mx=${mx.toFixed(3)} — check amplitudes`);

  // Two shared fat-line materials: dim base + bright index, both additive
  // so rings glow neon on the void. White-on-black per reference, fog off.
  const baseMat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: 1.15,
    transparent: true,
    opacity: 0.52,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const indexMat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: 2.35,
    transparent: true,
    opacity: 0.98,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  baseMat.resolution.set(1280, 720);
  indexMat.resolution.set(1280, 720);

  // 32 levels chained into smooth strips; every 5th is a brighter index contour.
  // Levels are symmetric power-spaced (dense near mid-ground, open at the
  // extremes) — logarithmic feel, so line density itself plots the terrain.
  // Index paths get a second smoothing pass for glass curves; fragments
  // <0.4 km are dropped unless index. Two longest index rings per level
  // carry inline elevation pills, OS plate style.
  const labelGroup = new THREE.Group();
  labelGroup.name = 'ops-elev-labels';
  const placed = [];
  // Batched contour field: every chained path used to be its own Line2 mesh
  // (hundreds of draw calls per frame). All base levels accumulate into ONE
  // LineSegments2 and all index levels into another — two draw calls for
  // the whole terrain, pixel-identical output.
  const baseBatch = { pos: [], clr: [], paths: 0, segs: 0 };
  const indexBatch = { pos: [], clr: [], paths: 0, segs: 0 };
  // Task 7: levels come from the shared DEM helper — same power shaping,
  // sourced from whatever altitude the sampler resolved (DEM or fallback).
  const contourLevels = levelsForRange(mn, mx, LEVELS);
  for (let k = 0; k < LEVELS; k++) {
    const level = contourLevels[k];
    const y = level * VEX;
    const isIndex = k % 5 === 4;
    const col = level >= 0 ? (isIndex ? INDEX_COL : BASE_COL) : BELOW_COL;
    let paths = chainSegments(levelSegments(H, N, step, level)).map(smoothPath);
    if (isIndex) paths = paths.map(smoothPath); // second pass for index glass
    paths = paths.filter((p) => p.length >= 2 && (isIndex || p.length >= 4));
    const batch = isIndex ? indexBatch : baseBatch;
    for (const p of paths) pushPath(batch, p, y, col);
    if (isIndex) {
      const tag = `${Math.round(level * 1000)} m`;
      const ranked = paths.filter((p) => p.length >= 8).sort((a, b) => b.length - a.length).slice(0, 2);
      for (const p of ranked) {
        // Spread along the ring thirds, OS-plate density. Skip tags that
        // fall outside the mapped circle or stack on another pill.
        const q = p[Math.floor(p.length * (0.33 + 0.22 * ranked.indexOf(p)))];
        if (Math.hypot(q[0], q[1]) > 18.5) continue;
        if (placed.some(([x, z]) => Math.hypot(x - q[0], z - q[1]) < 1.1)) continue;
        placed.push([q[0], q[1]]);
        if (placed.length > 18) break;
        const sp = elevLabel(tag, q[0], y + 0.14, q[1]);
        sp.scale.set(1.85, 0.46, 1);
        labelGroup.add(sp);
      }
    }
  }
  for (const [batch, mat] of [[baseBatch, baseMat], [indexBatch, indexMat]]) {
    if (!batch.pos.length) continue;
    const g = new LineSegmentsGeometry();
    g.setPositions(batch.pos);
    g.setColors(batch.clr);
    const mesh = new LineSegments2(g, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  console.info(
    `[ops3d] contours batched: ${baseBatch.paths + indexBatch.paths} paths / ` +
    `${baseBatch.segs + indexBatch.segs} segments → 2 meshes (was one mesh per path)`,
  );
  labelGroup.visible = true; // inline pills read at every zoom, OS-plate style
  group.add(labelGroup);

  // Summit tags: always-visible elevation proof at TOP — the two hill
  // summits carry their height so elevation reads before any drill-in.
  // White disk under each summit gives the "bloom to white" cue.
  const summitGroup = new THREE.Group();
  summitGroup.name = 'ops-summits';
  for (const Hb of [H1, H2]) {
    const sx = Hb.x, sz = Hb.z;
    const h = field(sx, sz);
    const y = h * VEX;
    const disk = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false })
    );
    disk.rotation.x = -Math.PI / 2;
    disk.position.set(sx, y + 0.04, sz);
    group.add(disk);
    const tag = elevLabel(`▲ ${Math.round(h * 1000)} m`, sx, y + 0.62, sz);
    tag.scale.set(2.0, 0.5, 1);
    summitGroup.add(tag);
  }
  // Valley-floor proof: the low landmark gets the same treatment as the
  // summits, so the full relief span reads before any drill-in.
  {
    const vz = 6, vx = riverX(vz);
    const vh = field(vx, vz);
    const tag = elevLabel(`▼ ${Math.round(vh * 1000)} m · VALLEY`, vx, vh * VEX + 0.55, vz);
    tag.scale.set(2.6, 0.5, 1);
    summitGroup.add(tag);
  }
  group.add(summitGroup);

  // No body fill: contours glow on the void (neon-plate style), so no
  // faded landmass is needed. The faint base disc below grounds the scene.
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

  // Boundary ring: thin neutral survey line marking the mapped 20 km
  // circle — matte, no glow, so it never competes with live data. No lip
  // echo; ticks stay faint.
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
    linewidth: 1.0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    fog: false,
  });
  ringMat.resolution.set(1280, 720);
  group.add(new Line2(ringGeo, ringMat));
  const tickPos = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    tickPos.push(c * (R_MAP - 0.7), 0.02, s * (R_MAP - 0.7), c * R_MAP, 0.02, s * R_MAP);
  }
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPos, 3));
  const tickMat = new THREE.LineBasicMaterial({
    color: RING_COL, transparent: true, opacity: 0.22,
    depthWrite: false, fog: false,
  });
  group.add(new THREE.LineSegments(tickGeo, tickMat));

  // Playa lake: no disc — the water reads through subtle blue contour lines
  // inside an organic shoreline ring. Faint wash only, so the body stays dark.
  const lakeY = field(LAKE_X, LAKE_Z) * VEX;
  {
    // Draped onto the depression so it never pokes through the body.
    const wy = (x, z) => field(x, z) * VEX + 0.012;
    const washPos = [];
    for (let i = 0; i < 64; i++) {
      const a0 = (i / 64) * Math.PI * 2, a1 = ((i + 1) / 64) * Math.PI * 2;
      const r0 = lakeR(a0) * 0.92, r1 = lakeR(a1) * 0.92;
      const x0 = LAKE_X + Math.cos(a0) * r0, z0 = LAKE_Z + Math.sin(a0) * r0;
      const x1 = LAKE_X + Math.cos(a1) * r1, z1 = LAKE_Z + Math.sin(a1) * r1;
      washPos.push(
        LAKE_X, wy(LAKE_X, LAKE_Z), LAKE_Z,
        x0, wy(x0, z0), z0,
        x0, wy(x0, z0), z0,
        x1, wy(x1, z1), z1,
      );
    }
    const washGeo = new THREE.BufferGeometry();
    washGeo.setAttribute('position', new THREE.Float32BufferAttribute(washPos, 3));
    const wash = new THREE.Mesh(washGeo, new THREE.MeshBasicMaterial({
      color: 0x223038, transparent: true, opacity: 0.20, depthWrite: false,
      side: THREE.DoubleSide,
    }));
    wash.renderOrder = 0;
    group.add(wash);
  }
  const shorePos = [];
  for (let i = 0; i < 96; i++) {
    const a0 = (i / 96) * Math.PI * 2, a1 = ((i + 1) / 96) * Math.PI * 2;
    const r0 = lakeR(a0), r1 = lakeR(a1);
    const sx0 = LAKE_X + Math.cos(a0) * r0, sz0 = LAKE_Z + Math.sin(a0) * r0;
    const sx1 = LAKE_X + Math.cos(a1) * r1, sz1 = LAKE_Z + Math.sin(a1) * r1;
    shorePos.push(
      sx0, field(sx0, sz0) * VEX + 0.02, sz0,
      sx1, field(sx1, sz1) * VEX + 0.02, sz1
    );
  }
  const shoreGeo = new LineGeometry();
  shoreGeo.setPositions(shorePos);
  const shoreMat = new LineMaterial({
    color: 0x8299a5, linewidth: 1.05, transparent: true, opacity: 0.40,
    depthWrite: false, fog: false,
  });
  shoreMat.resolution.set(1280, 720);
  const shore = new Line2(shoreGeo, shoreMat);
  shore.renderOrder = 2;
  group.add(shore);

  // Drainage thread: faint blue run along the draw bottom + two short
  // feeders — the valley-bottom water language from the topo plate. Contours
  // kink into Vs around it via the steep-bank carve, not by hand.
  const drainMat = new LineMaterial({
    color: 0x8299a5, linewidth: 1.05, transparent: true, opacity: 0.42,
    depthWrite: false, fog: false,
  });
  drainMat.resolution.set(1280, 720);
  const drapeRun = (pts) => {
    const runs = [[]];
    for (const [x, z] of pts) {
      if (Math.hypot(x, z) > 19.3) { if (runs[runs.length - 1].length) runs.push([]); continue; }
      runs[runs.length - 1].push(x, field(x, z) * VEX + 0.025, z);
    }
    for (const r of runs) {
      if (r.length < 6) continue;
      const g = new LineGeometry();
      g.setPositions(r);
      const line = new Line2(g, drainMat);
      line.renderOrder = 2;
      group.add(line);
    }
  };
  const main = [];
  for (let x = -19; x <= 19; x += 0.4) main.push([x, drawCenter(x)]);
  drapeRun(main);
  const feeder = (ax, az, bx) => {
    const pts = [];
    const bz = drawCenter(bx);
    for (let k = 0; k <= 12; k++) {
      const f = k / 12;
      pts.push([ax + (bx - ax) * f + Math.sin(f * Math.PI) * 0.8, az + (bz - az) * f]);
    }
    drapeRun(pts);
  };
  feeder(2.5, 13.5, 3.2); // off the SE hill flank
  feeder(-6.5, -11.5, -5.4); // off the southern flats

  scene.add(group);

  return {
    mesh: group,
    terrainSource: _source,
    setDetail(name) {
      // Inline contour pills are illegible micro-tags at TOP (6–8 px) — they
      // add noise, not data. Landmark summit/valley tags stay at every zoom.
      labelGroup.visible = name !== 'network';
      dimF = name === 'network' ? 0.8 : name === 'asset' ? 0.5 : name === 'segment' ? 0.6 : 1;
      pillF = name === 'asset' ? 0.35 : name === 'segment' ? 0.6 : 1;
      for (const sp of labelGroup.children) sp.scale.set(1.85 * pillF, 0.46 * pillF, 1);
      for (const sp of summitGroup.children) sp.scale.set(2.0 * pillF, 0.5 * pillF, 1);
    },
    setSize(w, h) {
      baseMat.resolution.set(w, h);
      indexMat.resolution.set(w, h);
      ringMat.resolution.set(w, h);
      shoreMat.resolution.set(w, h);
      drainMat.resolution.set(w, h);
    },
    update(t = 0) {
      // Attention lock (Phase 1 Task 10): terrain whispers at TOP so faults
      // own the frame — drill-in dims further via dimF. Bloom threshold in
      // post.js stays at 0.36 so critical red still catches it, not white.
      baseMat.opacity = 0.44 * dimF;
      indexMat.opacity = 0.92 * dimF;
      ringMat.opacity = 0.35;
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
