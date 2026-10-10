/* Safepipe Ops 3D — src/ops3d/terrain.js · Athabasca-representative holographic topo.
 * buildTerrain(scene) → { mesh, terrainSource, setDetail, setSize, update, dispose }
 * Representative Athabasca-basin floor (1 unit = 1 km): eastward dip ~2.2 m/km
 * + broad low swells ±46 m + TWO hills (+80/+64 m, auto-nudged clear of
 * pipe corridors so rings close around real highs) + saddle hollow (−32 m)
 * + west tributary draw ~42 m deep + playa-lake depression ~14 m
 * + N–S Athabasca main valley ~85 m (braided floor, steep east cutbank,
 * gentle west point-bars) with a shallow ~12 m inner trough along the river
 * path so water sits in the low contours + 2 kettle ponds + muskeg mottling
 * + masked plateau variance (mid/high-frequency swell, valley+lake masked)
 * — total relief ≈ −170…+115 m true, VEX 4.5.
 * Altitude source is swappable (setFieldSource/sample): contours sample the
 * active source, so the pinned SRTM DEM renders real relief when it resolves
 * and every drape stays coherent. Standing water follows the source too:
 * live DEM surveys its own river channel + lake basins from the sampled
 * grid (waterPlacementFromGrid — positions/levels measured, never
 * hand-tuned, possibly river-only); the synthetic playa + kettles render
 * only in procedural fallback. [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 * Volumetric read (topo-pass): contours carry baked NW-sun hillshade in
 * their vertex colors + a dark matte-charcoal draped ground fill
 * (neutral-grey elevation tint × strengthened directional hillshade) rides
 * just under the lines, so the basin reads as land volume from TOP and ISO.
 * Rendering-only — field() untouched by shading, relief/sd gates
 * cannot move. Blue is reserved for real water ONLY (playa-lake flat fill +
 * 6 organic isobath rings + 2 thin main-stem wave threads draped at the
 * trough bottom); every contour/shore/drain line is neutral grey.
 * Marching-squares 160×160 grid at 32 power-spaced levels; unordered
 * segments are chained (quantized-endpoint greedy) into continuous smooth
 * polylines per level, then batched into THREE LineSegments2 meshes (base +
 * index + summit) — three draw calls for the whole contour field. Muted grey index
 * lines every 5th level; the top-rank levels render wider + brighter
 * (elevation-ranked glow, capped); index rings carry inline elevation pills so the
 * contours read as a plotting technique, not decoration. Cells whose local
 * gradient is below SLOPE_MIN are skipped, so flats stay clean while
 * contours wrap the rest of the terrain. Segments inside water (playa lake,
 * river core) are skipped — water renders as blue fills/threads, never hatch.
 * Desaturated neutral-grey palette, WebGL1-safe (no custom GLSL). Blue is
 * reserved for real water bodies only (playa-lake flat fill + main-stem
 * wave threads, never contour lines).
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { getLayout } from './health-feed.js';
import { levelsForRange, _injectField } from './dem.js';
import { makeSeaLabelSprite } from './labels.js';

function await_import_layout() {
  try { return { getLayout }; } catch { return {}; }
}

const SIZE = 44; // map extent, km (1 unit = 1 km)
const R_MAP = 20; // boundary ring radius, km
const N = 160; // marching-squares grid cells per side (128→160 for tighter high rings)
const LEVELS = 32; // contour levels (20→32 so slope reads as density)
export const VEX = 1; // true-scale landmass parity — twin matches satellite/map terrain 1:1, no exaggeration
/* Shading-only relief exaggeration (Sangachal read): at VEX 1 the true
 * gradients are ~mm/km, so VEX-applied normals go near-flat and the baked
 * hillshade loses all direction. Normals for SHADING are computed with
 * SHADE_VEX while every geometry height stays h×VEX — relief reads, data
 * stays 1:1, field() untouched. Rendering-only. */
export const SHADE_VEX = 4.5;
/* Sea-fill brightness ramp (Sangachal read): the old 0.35–0.80 sea verts sat
 * inside the charcoal band and read as blobs. The floor now clears the
 * brightest possible land vert so open water is unmistakable, capped below
 * alarm bloom. Blue stays water-only (this file's only blue is WATER_COL). */
export const SEA_BRIGHT_LO = 0.72;
export const SEA_BRIGHT_SPAN = 0.48;
/* Bathymetry vs valley (Sangachal read): DEM heights are absolute (km above
 * sea level), so a sub-sea-level low under the DEM source is water-covered
 * seabed — never a valley. The procedural datum is relative, so its lows
 * stay valleys. Pure. */
export function isSeaDepth(h, source = 'procedural') {
  return source === 'dem' && h < 0;
}
const SLOPE_MIN = 0.0028; // skip contour cells flatter than ~2.8 m/km — flats go truly clean
const BASE_COL = new THREE.Color(0x8b949a); // dim cool-grey hairline base — whispers under alarms
const INDEX_COL = new THREE.Color(0x9fabb3); // cool-grey index, never white — alarms own the top luminance
const BELOW_COL = new THREE.Color(0x7e8d95); // below-datum muted blue-grey, dimmed to match
const RING_COL = 0x848b90; // boundary ring: neutral survey grey, never an accent
const LAKE_X = -9; // playa lake center, km (flat spot, away from center + draw)
const LAKE_Z = 6;
const LAKE_R = 1.3; // mean radius; shoreline modulated below, ~2.6 km across
/* Lake isobaths: 6 densified bathymetry rings (fraction of shoreline),
 * outer strongest fading inward — blue only, flat at lake surface. */
export const LAKE_ISO_SCALES = [0.84, 0.70, 0.56, 0.42, 0.28, 0.15];
export const LAKE_ISO_OPAC = [0.34, 0.28, 0.22, 0.17, 0.12, 0.08];
const DRAW_W = 0.65; // dry-draw half-width km — narrower banks bend contours into sharp Vs
/* Water blue — the ONLY blue on the terrain, reserved for real water bodies
 * (playa-lake fill + isobaths + 2 main-stem wave threads). Everything linear on LAND (contours, shore ring, dry-draw
 * threads) is neutral grey. Muted ice-blue, dimmer than any alarm. */
export const WATER_COL = 0x6792a5; // muted ice-blue — water only, never land
const SHORE_COL = 0x848b90; // shoreline ring: neutral survey grey, never an accent
const DRAIN_COL = 0x848b90; // dry-draw threads: neutral grey — the draw is dry, not water
/* Elevation-ranked contour glow (user rubric, dimmed per TOP review):
 * brightness × width still scaled by level rank, summit brightest — but the
 * whole ramp sits BELOW the bloom line now (alarms > pipes/flow > water >
 * land). Contours must never own the frame. */
const ELEV_GLOW_MIN = 0.55; // lowland recedes deep
const ELEV_GLOW_MAX = 0.95; // summit cap: below bloom, below water fill
const SUMMIT_WIDTH = 2.0; // top-rank readable, never a billboard
const SUMMIT_TOP_K = 4; // top K levels form the wider summit batch
const WATER_MASK = 0.55; // contour segments wetter than this are water — skipped, fills own it
const rankGlow = (k) => ELEV_GLOW_MIN + (ELEV_GLOW_MAX - ELEV_GLOW_MIN) * smooth(0, 1, k / (LEVELS - 1));
/* Water wetness 0..1 at a world point: playa-lake interior + river-thread
 * core. Contours use it as a mask (wet segments skipped — water renders as
 * flat fills, never line hatch); land edges near it get the shoreline glow. */
function waterWet(x, z) {
  const lake = lakeWetActive(x, z);
  const dxr = (x - _riverXat(z)) / 0.7; // visible-water core half-width, km
  return Math.max(lake, Math.exp(-dxr * dxr));
}
/* Land-water edge: contour/land vertices touching a water body (playa lake
 * or river thread) get the rubric TOP-rank glow — same treatment as the
 * summit, so shorelines read as bright edges without any blue lines. */
function shoreTouch(x, z) {
  if (lakeWetActive(x, z) > 0.02) return true;
  return Math.abs(x - _riverXat(z)) < 1.2;
}
/* Dry-draw centerline, shared by the field carve and the drainage thread. */
function drawCenter(x) {
  return 6 * Math.sin(x * 0.22 + 0.5) + 2 * Math.sin(x * 0.55 + 1.1);
}

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* Organic shoreline: radius modulated by low-order harmonics so the playa
 * reads as a real water body, never a compass circle. 1 inside → 0 outside.
 * lakeRAt parameterizes the harmonics by radius so DEM-measured basins reuse
 * the same shoreline read at their own grid-derived size; lakeR is the
 * synthetic-playa specialization (field() carve path — unchanged). */
function lakeRAt(a, R) {
  return R * (1 + 0.28 * Math.sin(2 * a + 1.1) + 0.16 * Math.sin(3 * a + 0.4) + 0.1 * Math.sin(5 * a + 2.3));
}
function lakeR(a) {
  return lakeRAt(a, LAKE_R);
}
function lakeWet(x, z) {
  const dx = x - LAKE_X, dz = z - LAKE_Z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 1;
  const w = d / lakeR(Math.atan2(dz, dx)); // 1 = shoreline
  return 1 - smooth(0.85, 1.15, w);
}
/* Render-time lake bodies: the synthetic playa by default (procedural
 * fallback path); buildTerrain replaces this with DEM-derived basins when
 * the live DEM source is active, so fills/isobaths/shores sit on real
 * depressions at grid-measured levels. field() ALWAYS reads the synthetic
 * lakeWet above — relief/sd gates measure the procedural floor, never the
 * render list. Circular-basin wetness is for DEM-measured lakes (radius
 * from the grid, not the synthetic shoreline harmonics). */
let _renderLakes = null; // null = synthetic default
function activeLakes() {
  return _renderLakes ?? [{ x: LAKE_X, z: LAKE_Z, r: LAKE_R, level: null, organic: true }];
}
function basinWet(x, z, L) {
  const dx = x - L.x, dz = z - L.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 1;
  const w = d / lakeRAt(Math.atan2(dz, dx), L.r); // 1 = shoreline (same read as the fill)
  return 1 - smooth(0.85, 1.15, w);
}
function lakeWetActive(x, z) {
  let w = 0;
  for (const L of activeLakes()) w = Math.max(w, L.organic ? lakeWet(x, z) : basinWet(x, z, L));
  return w;
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
export function riverX(z) {
  return 7.5 + 3.5 * Math.sin(z * 0.16 + 0.8) + 1.2 * Math.sin(z * 0.41 + 2.0);
}
/* Shallow inner trough carved along the river path: the wave threads sit in
 * the same low contours water would flow through, so banks pinch shut around
 * real water. ~12 m deep, ~0.85 km half-width (threads at ±0.18 sit inside
 * with banks to spare). Part of field() — relief/sd gates cover it. */
export const RIVER_TROUGH_D = 0.012;
export const RIVER_TROUGH_W = 0.85;
/* Carve axis: analytic riverX until buildTerrain installs the surveyed
 * drainage line — then the valley + trough carve, the water masks, and the
 * threads all share the derived channel, so water sits in the contour-V low
 * line under either altitude source. Default keeps the node/test path on the
 * analytic axis (relief/sd gates measure field() directly). */
let _troughXat = riverX;
export function riverTrough(x, z) {
  const dx = (x - _troughXat(z)) / RIVER_TROUGH_W;
  return -RIVER_TROUGH_D * Math.exp(-dx * dx);
}
/* Surveyed drainage line: per-row argmin of the SAMPLED altitude grid over
 * the eastern corridor — the DEM's own valley floor when live, the
 * procedural valley axis in fallback. Render (threads, masks) follows THIS
 * derived line, never the fixed analytic path alone. Boxcar-smoothed along
 * z so threads don't jitter grid-to-grid. */
export const DRAIN_X0 = 2, DRAIN_X1 = 18; // eastern corridor holding the main valley
const DRAIN_HALF = 3; // reach window each side of the valley axis — the LINE is surveyed (grid argmin), the window only says which reach
export function drainPathFromGrid(H, n, step, size = SIZE, axis = riverX) {
  const drain = new Float32Array(n + 1);
  for (let j = 0; j <= n; j++) {
    const z = -size / 2 + j * step;
    const ax = axis(z);
    let bx = ax, bv = Infinity;
    for (let i = 0; i <= n; i++) {
      const x = -size / 2 + i * step;
      if (x < DRAIN_X0 || x > DRAIN_X1 || Math.abs(x - ax) > DRAIN_HALF) continue;
      const h = H[j * (n + 1) + i];
      if (h < bv) { bv = h; bx = x; }
    }
    drain[j] = bx;
  }
  for (let p = 0; p < 2; p++) {
    const s = Float32Array.from(drain);
    for (let j = 0; j <= n; j++) {
      const a = s[Math.max(0, j - 1)], b = s[j], c = s[Math.min(n, j + 1)];
      drain[j] = (a + 2 * b + c) / 4;
    }
  }
  return drain;
}
/* DEM-derived channel survey: full-window Viterbi path (no analytic axis,
 * no corridor) — per-row altitude plus a bend penalty per km of lateral
 * jump, so the line rides the real valley floor wherever the DEM puts it
 * yet never teleports across the window (a river cannot jump 10 km
 * row-to-row). The Athabasca course runs x≈+3…+12 diagonally; the corridor
 * survey above assumes the analytic path. Band ±maxJumpKm per row (hard),
 * bendPenalty km-alt per km lateral (soft, default 10 m/km — meanders cost
 * centimetres, teleports cost hundreds of metres). Boxcar-smoothed ×2 for
 * thread rendering. Pure + unit-tested. */
export function surveyChannelFromGrid(H, n, step, size = SIZE, opts = {}) {
  const margin = Math.max(1, opts.margin ?? 1);
  const maxJump = opts.maxJumpKm ?? 2.5;
  const bend = opts.bendPenalty ?? 0.01;
  const B = Math.max(1, Math.ceil(maxJump / step));
  const m = n + 1 - 2 * margin;
  const idx = (j, k) => j * m + k;
  const dp = new Float64Array((n + 1) * m);
  const par = new Int16Array((n + 1) * m);
  for (let k = 0; k < m; k++) dp[idx(0, k)] = H[margin + k];
  for (let j = 1; j <= n; j++) {
    const row = j * (n + 1) + margin;
    for (let k = 0; k < m; k++) {
      let bv = Infinity, bk = 0;
      const k0 = Math.max(0, k - B), k1 = Math.min(m - 1, k + B);
      for (let pk = k0; pk <= k1; pk++) {
        const v = dp[idx(j - 1, pk)] + bend * Math.abs(k - pk) * step;
        if (v < bv) { bv = v; bk = k - pk; }
      }
      dp[idx(j, k)] = H[row + k] + bv;
      par[idx(j, k)] = bk;
    }
  }
  const chan = new Float32Array(n + 1);
  let k = 0;
  {
    let bv = Infinity;
    for (let kk = 0; kk < m; kk++) {
      if (dp[idx(n, kk)] < bv) { bv = dp[idx(n, kk)]; k = kk; }
    }
  }
  for (let j = n; j >= 0; j--) {
    chan[j] = -size / 2 + (margin + k) * step;
    if (j > 0) k = Math.min(m - 1, Math.max(0, k - par[idx(j, k)]));
  }
  for (let p = 0; p < 2; p++) {
    const s = Float32Array.from(chan);
    for (let j = 0; j <= n; j++) {
      const a = s[Math.max(0, j - 1)], b = s[j], c = s[Math.min(n, j + 1)];
      chan[j] = (a + 2 * b + c) / 4;
    }
  }
  return chan;
}
/* Bilinear read of a sampled altitude grid (world km → km altitude). */
function gridAt(H, n, step, size, x, z) {
  const gx = Math.min(n, Math.max(0, (x + size / 2) / step));
  const gz = Math.min(n, Math.max(0, (z + size / 2) / step));
  const i0 = Math.min(n - 1, Math.floor(gx)), j0 = Math.min(n - 1, Math.floor(gz));
  const fx = gx - i0, fz = gz - j0;
  const a = H[j0 * (n + 1) + i0], b = H[j0 * (n + 1) + i0 + 1];
  const c = H[(j0 + 1) * (n + 1) + i0], d = H[(j0 + 1) * (n + 1) + i0 + 1];
  return a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz;
}
/* DEM-derived lake basins: closed COMPACT off-channel depressions in the
 * SAMPLED grid — local minima whose surrounding rings stand ≥ minDepthKm
 * above the floor (spill = highest of the 1.2/1.8/2.4 km ring-minima, so
 * wide bowls are not under-measured), outside the river corridor and the
 * map rim. Breadth + compactness vetoes reject narrow Vs and elongated
 * canyon reaches (lakes are broad and compact).
 * Compactness veto (wet cells below floor + half depth inside ±2.5 km must
 * read ≤ ~2.5:1 axes): linear canyon reaches and river pools are elongated,
 * lakes are not. Render size is conservative (quarter-depth contour) so a
 * small pond in flat bog does not paint a catchment-sized disc; level sits
 * at floor + 25% of depth (above the bottom, below the spill). Returns up
 * to maxLakes sorted by depth×area. Empty when the DEM holds no closed
 * water — then the twin is river-only, as the real site mostly is.
 * Pure + unit-tested. */
export function detectLakeBasins(H, n, step, size = SIZE, opts = {}) {
  const channel = opts.channel ?? null;
  const excludeKm = opts.excludeKm ?? 1.6;
  const ringKm = opts.ringKm ?? 1.2;
  const minDepthKm = opts.minDepthKm ?? 0.004;
  const maxLakes = opts.maxLakes ?? 2;
  const rimKm = opts.rimKm ?? 19.3;
  const chanXat = channel ? (z) => {
    const gz = Math.min(n, Math.max(0, (z + size / 2) / step));
    const j0 = Math.min(n - 1, Math.floor(gz)), f = gz - j0;
    return channel[j0] * (1 - f) + channel[j0 + 1] * f;
  } : null;
  const cand = [];
  for (let j = 2; j <= n - 2; j++) {
    for (let i = 2; i <= n - 2; i++) {
      const x = -size / 2 + i * step, z = -size / 2 + j * step;
      if (Math.hypot(x, z) > rimKm) continue;
      if (chanXat && Math.abs(x - chanXat(z)) < excludeKm) continue;
      const h = H[j * (n + 1) + i];
      let isMin = true;
      for (let dj = -1; dj <= 1 && isMin; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          if (H[(j + dj) * (n + 1) + i + di] < h) { isMin = false; break; }
        }
      }
      if (!isMin) continue;
      // Spill proxy: highest of the 1.2/1.8/2.4 km ring-minima — a wide
      // bowl's inner rings sit inside the depression, so the spill is the
      // outermost (highest) ring floor; 16 samples per ring so narrow
      // gullies cannot hide between sample angles.
      let spill = -Infinity;
      for (const rr of [ringKm, ringKm * 1.5, ringKm * 2]) {
        let rm = Infinity;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          rm = Math.min(rm, gridAt(H, n, step, size, x + Math.cos(a) * rr, z + Math.sin(a) * rr));
        }
        spill = Math.max(spill, rm);
      }
      const depth = spill - h;
      if (!(depth >= minDepthKm)) continue;
      // Breadth test: the 8 neighbours must average below floor + half
      // depth — a narrow V (gully, canyon, noise spike) is deep only at
      // its centre cell, a lake bowl is broad.
      let nsum = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          nsum += H[(j + dj) * (n + 1) + i + di];
        }
      }
      if (nsum / 8 > h + 0.5 * depth) continue;
      // Compactness veto: wet cells (below floor + half depth) inside
      // ±2.5 km must read compact (eigenvalue ratio ≤ 6 ≈ 2.5:1 axes) —
      // a bending canyon stays wet for kilometres along its axis.
      if (!basinCompact(H, n, step, size, x, z, h + 0.5 * depth)) continue;
      // Radius: expand until banks exceed quarter depth (capped 3 km) —
      // render size stays near the open-water core, not the catchment.
      let radius = ringKm;
      for (let r = step; r <= 3; r += step) {
        let bank = Infinity;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + 0.4;
          bank = Math.min(bank, gridAt(H, n, step, size, x + Math.cos(a) * r, z + Math.sin(a) * r));
        }
        radius = r;
        if (bank - h > 0.25 * depth) break;
      }
      cand.push({ x, z, radiusKm: Math.max(0.4, radius), levelKm: h + 0.25 * depth, depthKm: depth });
    }
  }
  // Deepest-first, merging neighbors (keep the deeper basin within 2.5 km).
  cand.sort((a, b) => (b.depthKm * b.radiusKm) - (a.depthKm * a.radiusKm));
  const out = [];
  for (const c of cand) {
    if (out.length >= maxLakes) break;
    if (out.some((k) => Math.hypot(k.x - c.x, k.z - c.z) < 2.5)) continue;
    out.push(c);
  }
  return out;
}
/* Compactness veto for basin candidates: cells below `wetBelow` inside a
 * ±2.5 km box must read compact (covariance eigenvalue ratio ≤ 6, ≈ 2.5:1
 * axes). Too few cells to judge (< 8) passes — a sub-cell puddle cannot be
 * a canyon reach. Pure (unit-tested via detectLakeBasins). */
function basinCompact(H, n, step, size, x, z, wetBelow) {
  const R2 = 2.5;
  const i0 = Math.max(0, Math.ceil((x - R2 + size / 2) / step));
  const i1 = Math.min(n, Math.floor((x + R2 + size / 2) / step));
  const j0 = Math.max(0, Math.ceil((z - R2 + size / 2) / step));
  const j1 = Math.min(n, Math.floor((z + R2 + size / 2) / step));
  let cnt = 0, sx = 0, sz = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (H[j * (n + 1) + i] < wetBelow) {
        cnt++;
        sx += -size / 2 + i * step; sz += -size / 2 + j * step;
      }
    }
  }
  if (cnt < 8) return true;
  const mx = sx / cnt, mz = sz / cnt;
  let cxx = 0, czz = 0, cxz = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (H[j * (n + 1) + i] < wetBelow) {
        const dx = -size / 2 + i * step - mx, dz = -size / 2 + j * step - mz;
        cxx += dx * dx; czz += dz * dz; cxz += dx * dz;
      }
    }
  }
  cxx /= cnt; czz /= cnt; cxz /= cnt;
  const tr = cxx + czz, det = cxx * czz - cxz * cxz;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc), l2 = tr / 2 - Math.sqrt(disc);
  if (!(l2 > 1e-9)) return false; // collinear wet cells = gully, not a lake
  return l1 / l2 <= 6;
}
/* Water placement from the sampled grid (the DEM→water seam): DEM source →
 * surveyed channel + measured basins (positions + levels from the grid,
 * never hand-tuned); anything else → analytic drainage + synthetic playa
 * (offline fallback, never half-derived). Pure + unit-tested. */
export function waterPlacementFromGrid(H, n, step, size = SIZE, source = 'procedural') {
  if (source === 'dem') {
    const channel = surveyChannelFromGrid(H, n, step, size);
    const basins = detectLakeBasins(H, n, step, size, { channel });
    return {
      channel,
      lakes: basins.map((b) => ({ x: b.x, z: b.z, r: b.radiusKm, level: b.levelKm, organic: false })),
    };
  }
  return {
    channel: drainPathFromGrid(H, n, step, size),
    lakes: [{ x: LAKE_X, z: LAKE_Z, r: LAKE_R, level: null, organic: true }],
  };
}
/* Active river axis: analytic fallback until buildTerrain installs the
 * grid-derived surveyed line. waterWet/shoreTouch read through this so
 * masks + banks follow surveyed drainage under either altitude source. */
let _riverXat = riverX;
function riverWet(x, z) {
  const dx = (x - _troughXat(z)) / 2.2; // ~2.2 km half-width
  return Math.exp(-dx * dx * (x > _troughXat(z) ? 1.6 : 0.8)); // steep cutbank E, bars W
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
  const trough = riverTrough(x, z); // shallow inner carve along the river path, ~12 m
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
  return dip + swell + hills + hollow + draw + playa + valley + trough + kettle + muskeg + platvar;
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

/* Chaikin corner-cutting resampling (quadratic B-spline approx): each pass
 * replaces every corner with two points at 1/4 + 3/4 along each segment, so
 * chained marching-squares joints relax into continuous bezier-like bends.
 * Rendering-only: y stays level×VEX and field() is untouched, so the relief
 * gate (260–290 m) and sd gate (42–54 m) cannot move. Endpoints of open
 * paths are preserved; closed rings iterate with wrap (detected by tip gap,
 * not exact equality — chained tips meet within quant tolerance, ~2–5 m). */
function chaikinOnce(pts, closed) {
  if (closed) {
    const ring = pts.slice(0, pts.length - 1); // drop duplicated closing tip
    const n = ring.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      out.push(
        [0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]],
        [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]],
      );
    }
    out.push(out[0].slice()); // re-close the ring
    return out;
  }
  const out = [pts[0].slice()];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    out.push(
      [0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]],
      [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]],
    );
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

/* Smooth one chained path: `iterations` Chaikin passes (2 base, 3 index)
 * plus one light Laplacian relax to erase residual joint bias. Signature
 * stays single-arg-safe: called as paths.map((p) => smoothPath(p, n)), never
 * bare map(smoothPath) — Array.map would inject the index as `iterations`. */
function smoothPath(pts, iterations = 2) {
  if (pts.length < 3) return pts;
  const n = pts.length;
  const tipGap = Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]);
  const closed = tipGap < 0.01; // ~10 m: chained ring tips meet within quant
  let cur = pts.map((p) => p.slice());
  for (let k = 0; k < iterations; k++) cur = chaikinOnce(cur, closed);
  const m = cur.length;
  const loop = closed;
  const out = cur.map((p) => p.slice());
  for (let i = 0; i < m; i++) {
    if (!loop && (i === 0 || i === m - 1)) continue;
    const p = cur[(i - 1 + m) % m];
    const q = cur[i];
    const r = cur[(i + 1) % m];
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
  cv.height = 48;
  cv.width = 512; // measuring width — resized to fit below
  const FONT = '600 30px ui-monospace, Menlo, monospace';
  const mctx = cv.getContext('2d');
  mctx.font = FONT;
  const textW = mctx.measureText(text).width;
  cv.width = Math.max(192, Math.ceil(56 + textW)); // long tags grow, short stay
  const ctx = cv.getContext('2d'); // resize resets state — set everything after
  const CUT = 20; // deep enough to read at 3× TOP scale
  const W = cv.width, CX = W / 2;
  ctx.fillStyle = 'rgba(16,20,24,0.9)';
  ctx.beginPath();
  ctx.moveTo(28, 4);
  ctx.lineTo(W - 28 - CUT, 4);
  ctx.lineTo(W - 28, 4 + CUT);
  ctx.lineTo(W - 28, 44);
  ctx.lineTo(28, 44);
  ctx.closePath();
  ctx.fill(); // dark chamfered plate behind the number
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#aeb7bc';
  ctx.fillText(text, CX, 26);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 1,
    depthWrite: false, depthTest: false, fog: false,
  }));
  sp.userData.aspect = cv.width / cv.height; // scale sites derive width from this
  sp.scale.set(0.425 * sp.userData.aspect, 0.425, 1); // small inline readout, never a billboard
  sp.position.set(x, y, z);
  sp.renderOrder = 5;
  return sp;
}

/* Baked hillshade (rendering-only, field() untouched): single NW sun, so
 * contours + ground fill get a sunlit/shadowed read without any shader.
 * The shade grid is derived from the sampled H grid (central differences,
 * VEX-applied normals) — zero extra field() calls — and sampled bilinearly
 * per vertex. Matte-charcoal swing (0.52–1.13): deep enough that volume
 * reads at TOP, capped so greys stay grey and alarms keep the lead. */
const SUN = new THREE.Vector3(-0.52, 0.78, -0.34).normalize(); // NW sun, ~51° alt
const _sn = new THREE.Vector3();
let _shadeAt = () => 0.5; // replaced per buildTerrain from the live H grid
const shadeToBright = (t) => 0.52 + 0.61 * Math.min(1, Math.max(0, t));

/* Fill-grid sampler (same bilinear read over H): the draped ground fill
 * rides true altitude without extra field() calls. */
let _heightAt = (x, z) => field(x, z);
let _fillLo = -0.16, _fillHi = 0.12;

/* Filter/accumulate: every chained polyline contributes its (prev → cur)
 * segment pairs to a tier batch at true elevation × VEX, with periphery
 * fade toward the boundary ring baked into vertex colors. Contour lines
 * are neutral grey everywhere on LAND — segments inside water (playa lake,
 * river core) are skipped so water reads as flat fills, never line hatch.
 * Vertex brightness = level-rank glow × baked hillshade; land vertices
 * touching water get the rubric top-rank glow (bright shoreline edges). */
const _wc = new THREE.Color();
const _white = new THREE.Color(0xffffff);
function pushPath(batch, pts, y, col, glow = 1) {
  if (pts.length < 2) return;
  batch.paths += 1;
  let has = false;
  let px = 0;
  let pz = 0;
  let pwet = 0;
  let pr = 0;
  let pg = 0;
  let pb = 0;
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0];
    const z = pts[i][1];
    const wet = waterWet(x, z);
    if (has && pwet > WATER_MASK && wet > WATER_MASK) {
      has = false; // both ends inside water — drop the segment, fills own it
      continue;
    }
    const f = 1 - smooth(12, 19.5, Math.hypot(x, z));
    const gl = Math.max(glow, shoreTouch(x, z) ? ELEV_GLOW_MAX : 0);
    _wc.copy(col).multiplyScalar(gl * shadeToBright(_shadeAt(x, z)));
    const r = _wc.r * f;
    const g = _wc.g * f;
    const b = _wc.b * f;
    if (has) {
      batch.pos.push(px, y, pz, x, y, z);
      batch.clr.push(pr, pg, pb, r, g, b);
      batch.segs += 1;
    }
    px = x;
    pz = z;
    pwet = wet;
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

  // Sample the Athabasca floor field on the grid — two passes. The first
  // pass (analytic carve) locates the surveyed drainage axis; the second
  // re-carves valley + trough along that derived line, so the channel the
  // threads ride is the contour-V low line, never a fixed drawing.
  const step = SIZE / N;
  const H = new Float32Array((N + 1) * (N + 1));
  let mn = Infinity;
  let mx = -Infinity;
  const sampleH = () => {
    mn = Infinity; mx = -Infinity;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const h = field(-SIZE / 2 + i * step, -SIZE / 2 + j * step);
        H[j * (N + 1) + i] = h;
        if (h < mn) mn = h;
        if (h > mx) mx = h;
      }
    }
  };
  sampleH();
  // Surveyed drainage axis: derived from THIS grid (live DEM or fallback),
  // so threads + water masks sit on the real valley floor, never a fixed
  // drawing. DEM source surveys the full window + measures lake basins
  // (waterPlacementFromGrid — positions/levels from the grid, never
  // hand-tuned); fallback keeps the analytic corridor + synthetic playa.
  // Bilinear readout for sub-cell smoothness.
  const _placed = waterPlacementFromGrid(H, N, step, SIZE, _source);
  const _drain = _placed.channel;
  _renderLakes = _placed.lakes.map((L) => ({ ...L, level: L.level ?? field(L.x, L.z) }));
  const drainAt = (z) => {
    const gz = Math.min(N, Math.max(0, (z + SIZE / 2) / step));
    const j0 = Math.min(N - 1, Math.floor(gz)), f = gz - j0;
    return _drain[j0] * (1 - f) + _drain[j0 + 1] * f;
  };
  _riverXat = drainAt;
  _troughXat = drainAt;
  sampleH(); // re-carve along the surveyed line; contours + threads share it
  if (mn < -0.15 || mx > 0.16) console.warn(`[terrain] field out of expected band mn=${mn.toFixed(3)} mx=${mx.toFixed(3)} — check amplitudes`);

  // Baked hillshade grid: SHADE_VEX-applied normals from H (shading-only
  // relief — geometry stays true-scale), dotted with the
  // single NW sun → 0..1 (shadowed..sunlit). Contours + fill sample this
  // bilinearly; field() is never touched so the relief/sd gates hold.
  const SG = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const xm = H[j * (N + 1) + Math.max(i - 1, 0)];
      const xp = H[j * (N + 1) + Math.min(i + 1, N)];
      const zm = H[Math.max(j - 1, 0) * (N + 1) + i];
      const zp = H[Math.min(j + 1, N) * (N + 1) + i];
      _sn.set(-((xp - xm) / (2 * step)) * SHADE_VEX, 1, -((zp - zm) / (2 * step)) * SHADE_VEX).normalize();
      SG[j * (N + 1) + i] = (_sn.dot(SUN) + 1) / 2;
    }
  }
  const bilin = (G, x, z) => {
    const gx = Math.min(N, Math.max(0, (x + SIZE / 2) / step));
    const gz = Math.min(N, Math.max(0, (z + SIZE / 2) / step));
    const i0 = Math.min(N - 1, Math.floor(gx)), j0 = Math.min(N - 1, Math.floor(gz));
    const fx = gx - i0, fz = gz - j0;
    const a = G[j0 * (N + 1) + i0], b = G[j0 * (N + 1) + i0 + 1];
    const c = G[(j0 + 1) * (N + 1) + i0], d = G[(j0 + 1) * (N + 1) + i0 + 1];
    return a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz;
  };
  _shadeAt = (x, z) => bilin(SG, x, z);
  _heightAt = (x, z) => bilin(H, x, z);
  _fillLo = mn; _fillHi = mx;

  // Two shared fat-line materials: dim base + muted index, both additive
  // so the land reads without owning the frame. Cool greys, fog off.
  // Whisper opacities (TOP review): alarms > pipes/flow > water > land.
  const baseMat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: 1.0,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const indexMat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: 2.0,
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  // Summit batch: the top-rank levels render wider (SUMMIT_WIDTH) at the
  // capped summit glow — elevation reads as emphasis, never as alarm.
  const summitMat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: SUMMIT_WIDTH,
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  baseMat.resolution.set(1280, 720);
  indexMat.resolution.set(1280, 720);
  summitMat.resolution.set(1280, 720);

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
  // (hundreds of draw calls per frame). Base levels accumulate into ONE
  // LineSegments2, index levels into a second, summit-rank levels into a
  // third — three draw calls for the whole terrain.
  const baseBatch = { pos: [], clr: [], paths: 0, segs: 0 };
  const indexBatch = { pos: [], clr: [], paths: 0, segs: 0 };
  const summitBatch = { pos: [], clr: [], paths: 0, segs: 0 };
  // Task 7: levels come from the shared DEM helper — same power shaping,
  // sourced from whatever altitude the sampler resolved (DEM or fallback).
  const contourLevels = levelsForRange(mn, mx, LEVELS);
  for (let k = 0; k < LEVELS; k++) {
    const level = contourLevels[k];
    const y = level * VEX;
    const isIndex = k % 5 === 4;
    const isSummit = k >= LEVELS - SUMMIT_TOP_K; // rubric top rank: wider + brightest
    const col = level >= 0 ? (isIndex || isSummit ? INDEX_COL : BASE_COL) : BELOW_COL;
    let paths = chainSegments(levelSegments(H, N, step, level)).map((p) =>
      smoothPath(p, isIndex ? 3 : 2)); // Chaikin resample: 2 base, 3 index glass
    paths = paths.filter((p) => p.length >= 2 && (isIndex || isSummit || p.length >= 4));
    const batch = isSummit ? summitBatch : isIndex ? indexBatch : baseBatch;
    const glow = rankGlow(k); // elevation-ranked: brightest at summit, fading downslope
    for (const p of paths) pushPath(batch, p, y, col, glow);
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
        sp.scale.set(0.46 * sp.userData.aspect, 0.46, 1);
        labelGroup.add(sp);
      }
    }
  }
  for (const [batch, mat] of [[baseBatch, baseMat], [indexBatch, indexMat], [summitBatch, summitMat]]) {
    if (!batch.pos.length) continue;
    const g = new LineSegmentsGeometry();
    g.setPositions(batch.pos);
    g.setColors(batch.clr);
    const mesh = new LineSegments2(g, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  console.info(
    `[ops3d] contours batched: ${baseBatch.paths + indexBatch.paths + summitBatch.paths} paths / ` +
    `${baseBatch.segs + indexBatch.segs + summitBatch.segs} segments → 3 meshes (base/index/summit)`,
  );
  labelGroup.visible = true; // inline pills read at every zoom, OS-plate style
  group.add(labelGroup);

  // Summit tags: always-visible elevation proof at TOP — the two hill
  // summits carry their height so elevation reads before any drill-in.
  // Faint grey disk under each summit marks the high point quietly.
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
    tag.scale.set(0.5 * tag.userData.aspect, 0.5, 1);
    summitGroup.add(tag);
  }
  // Valley-floor proof: the low landmark gets the same treatment as the
  // summits, so the full relief span reads before any drill-in. Bathymetry
  // check (Sangachal read): a sub-sea-level DEM low is water-covered seabed
  // — the -78 m pill sitting in the Caspian is a depth, never a valley.
  {
    const vz = 6, vx = drainAt(vz);
    const vh = field(vx, vz);
    const seaLow = isSeaDepth(vh, _source);
    const tag = elevLabel(`▼ ${Math.round(vh * 1000)} m · ${seaLow ? 'SEABED' : 'VALLEY'}`, vx, vh * VEX + 0.55, vz);
    tag.scale.set(0.5 * tag.userData.aspect, 0.5, 1);
    summitGroup.add(tag);
  }
  group.add(summitGroup);

  // Open-water identity (Sangachal read): one CASPIAN SEA label rides the
  // DEM open-water centroid so the sea is named at every zoom, oblique
  // included. DEM-only — the procedural floor has no sea, so there is
  // nothing to name. Dark ops theme kept (labels.js water-blue on halo).
  {
    if (_source === 'dem') {
      let seaCount = 0, seaX = 0, seaZ = 0;
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          if (H[j * (N + 1) + i] < 0) {
            seaCount++;
            seaX += -SIZE / 2 + i * step;
            seaZ += -SIZE / 2 + j * step;
          }
        }
      }
      if (seaCount > (N + 1) * (N + 1) * 0.01) {
        const seaSp = makeSeaLabelSprite();
        seaSp.position.set(seaX / seaCount, 0.9, seaZ / seaCount);
        group.add(seaSp);
      }
    }
  }

  // Draped ground fill: polar mesh (center fan + 56 rings × 160 sectors)
  // riding true altitude just under the contour lines. Vertex colors =
  // neutral-grey elevation tint × baked NW-sun hillshade, kept near-black
  // so the land reads as a body without ever outshining alarms. The rim
  // fades darker into the boundary ring. Rendering-only.
  {
    const SECT = 160, RINGS = 56;
    const LO = new THREE.Color(0x0c0e10); // valley-floor near-black charcoal, neutral
    const HI = new THREE.Color(0x3a3d40); // high-ground matte grey — volume without glare
    const pos = [0, 0, 0];
    const clr = [0, 0, 0];
    const idx = [];
    const tmpC = new THREE.Color();
    const SEA = new THREE.Color(WATER_COL); // open water (Caspian Sea): blue fill, never land charcoal
    const fillVert = (x, z) => {
      const h = _heightAt(x, z);
      const te = Math.min(1, Math.max(0, (h - _fillLo) / Math.max(1e-6, _fillHi - _fillLo)));
      const rim = 1 - 0.55 * smooth(18.5, 20, Math.hypot(x, z));
      // Landmass parity: sub-sea-level DEM verts read as WATER_COL water so
      // the coastline tells land from sea at a glance; bathymetry contours
      // stay. Gated on the DEM source — the procedural datum is relative,
      // so its lows stay charcoal land, never water.
      // [plan:2026-10-10_150100-ops3d-sangachal-twin.md#phase-3]
      if (_source === 'dem' && h < 0) tmpC.copy(SEA).multiplyScalar((SEA_BRIGHT_LO + SEA_BRIGHT_SPAN * _shadeAt(x, z)) * rim);
      else tmpC.copy(LO).lerp(HI, te).multiplyScalar((0.42 + 0.78 * _shadeAt(x, z)) * rim);
      pos.push(x, h * VEX - 0.02, z);
      clr.push(tmpC.r, tmpC.g, tmpC.b);
      return pos.length / 3 - 1;
    };
    // center vertex (average height, mid shade) then ring verts
    {
      const h = _heightAt(0, 0);
      if (_source === 'dem' && h < 0) tmpC.copy(SEA).multiplyScalar(SEA_BRIGHT_LO + SEA_BRIGHT_SPAN * _shadeAt(0, 0));
      else tmpC.copy(LO).lerp(HI, 0.5).multiplyScalar(0.42 + 0.78 * _shadeAt(0, 0));
      pos[1] = h * VEX - 0.02;
      clr[0] = tmpC.r; clr[1] = tmpC.g; clr[2] = tmpC.b;
    }
    for (let k = 1; k <= RINGS; k++) {
      const r = (k / RINGS) * R_MAP;
      for (let s = 0; s < SECT; s++) {
        const a = (s / SECT) * Math.PI * 2;
        fillVert(Math.cos(a) * r, Math.sin(a) * r);
      }
    }
    for (let s = 0; s < SECT; s++) idx.push(0, 1 + s, 1 + ((s + 1) % SECT));
    for (let k = 0; k < RINGS - 1; k++) {
      const r0 = 1 + k * SECT, r1 = 1 + (k + 1) * SECT;
      for (let s = 0; s < SECT; s++) {
        const s1 = (s + 1) % SECT;
        idx.push(r0 + s, r1 + s, r1 + s1, r0 + s, r1 + s1, r0 + s1);
      }
    }
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fillGeo.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    fillGeo.setIndex(idx);
    const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.92,
      depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    fill.renderOrder = -1; // land first, contours + water draw over it
    group.add(fill);
  }

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
    opacity: 0.25,
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
    color: RING_COL, transparent: true, opacity: 0.15,
    depthWrite: false, fog: false,
  });
  group.add(new THREE.LineSegments(tickGeo, tickMat));

  // Standing water: one flat fill + isobaths + shoreline per placed lake
  // body — the synthetic playa in fallback, DEM-measured basins when live
  // (possibly zero: the real site is mostly river). Flat surface at the
  // placed level, bounded by the shoreline contour. Blue is water-only.
  // shoreMat stays build-scoped (setSize touches it) — per-lake materials
  // share identical params, so the last one serves resolution updates.
  let shoreMat = null;
  for (const L of _renderLakes) {
  const LX = L.x, LZ = L.z;
  // DEM-measured basins reuse the organic shoreline harmonics at their own
  // grid-derived radius — never a compass circle.
  const lakeRad = (a) => lakeRAt(a, L.organic ? LAKE_R : L.r);
  const lakeY = L.level * VEX;
  {
    const RING = 96;
    const cy = lakeY + 0.015; // FLAT water surface — one Y for the whole lake
    const pos = [LX, cy, LZ];
    const idx = [];
    for (let i = 0; i <= RING; i++) {
      const a = (i % RING) / RING * Math.PI * 2;
      const r = lakeRad(a);
      pos.push(LX + Math.cos(a) * r, cy, LZ + Math.sin(a) * r);
    }
    for (let i = 1; i <= RING; i++) idx.push(0, i, i + 1);
    const lakeGeo = new THREE.BufferGeometry();
    lakeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lakeGeo.setIndex(idx);
    lakeGeo.computeVertexNormals();
    const lake = new THREE.Mesh(lakeGeo, new THREE.MeshBasicMaterial({
      color: WATER_COL, transparent: true, opacity: 0.48, depthWrite: false,
      side: THREE.DoubleSide,
    }));
    lake.renderOrder = 0;
    group.add(lake);
  }
  // Lake isobaths: blue pseudo-contours inside water (bathymetry waves).
  // Six rings (84→15% of the organic shoreline), each with its OWN wave
  // wiggle — never perfect scaled circles — flat at lake surface, blue
  // only (no land grey). Outer strongest, fading inward. Reads as waves.
  {
    const cy = lakeY + 0.016; // just above fill, avoids z-fight but stays flat
    // Sub-cell ponds (r < 0.45 km) render fill + shore only — isobaths
    // would be sub-pixel mush at TOP.
    if (L.r < 0.45) { /* fill + shore carry it */ }
    else for (let k = 0; k < LAKE_ISO_SCALES.length; k++) {
      const s = LAKE_ISO_SCALES[k];
      const wob = (a) => 1
        + 0.10 * Math.sin(3 * a + k * 1.7)
        + 0.06 * Math.sin(5 * a - k * 0.9 + 1.3)
        + 0.04 * Math.sin(8 * a + k * 2.3);
      const pts = [];
      for (let i = 0; i < 64; i++) {
        const a0 = (i / 64) * Math.PI * 2, a1 = ((i + 1) / 64) * Math.PI * 2;
        const r0 = lakeRad(a0) * s * wob(a0), r1 = lakeRad(a1) * s * wob(a1);
        pts.push(
          LX + Math.cos(a0) * r0, cy, LZ + Math.sin(a0) * r0,
          LX + Math.cos(a1) * r1, cy, LZ + Math.sin(a1) * r1,
        );
      }
      const ig = new LineGeometry(); ig.setPositions(pts);
      const im = new LineMaterial({ color: WATER_COL, linewidth: 1.1, transparent: true, opacity: LAKE_ISO_OPAC[k], depthWrite: false, fog: false });
      im.resolution.set(1280, 720);
      const iso = new LineSegments2(ig, im);
      iso.renderOrder = 1;
      group.add(iso);
    }
  }
  const shorePos = [];
  for (let i = 0; i < 96; i++) {
    const a0 = (i / 96) * Math.PI * 2, a1 = ((i + 1) / 96) * Math.PI * 2;
    const r0 = lakeRad(a0), r1 = lakeRad(a1);
    const sx0 = LX + Math.cos(a0) * r0, sz0 = LZ + Math.sin(a0) * r0;
    const sx1 = LX + Math.cos(a1) * r1, sz1 = LZ + Math.sin(a1) * r1;
    shorePos.push(
      sx0, field(sx0, sz0) * VEX + 0.02, sz0,
      sx1, field(sx1, sz1) * VEX + 0.02, sz1
    );
  }
  const shoreGeo = new LineGeometry();
  shoreGeo.setPositions(shorePos);
  // Shoreline glow: land-water edges get the rubric top-rank treatment —
  // wider + brighter than other survey lines, still neutral grey (blue is
  // water-fill only) and capped so alarms lead.
  shoreMat = new LineMaterial({
    color: SHORE_COL, linewidth: 2.0, transparent: true, opacity: 0.45,
    depthWrite: false, fog: false,
  });
  shoreMat.resolution.set(1280, 720);
  const shore = new Line2(shoreGeo, shoreMat);
  shore.renderOrder = 2;
  group.add(shore);
  } // end per-lake standing water (zero iterations when DEM holds no basins)

  // Drainage threads: the west draw is DRY, so its thread + feeders run
  // neutral grey (a dry creek is land, not water). Kinks in the contours
  // come from the steep-bank carve, not by hand. The main-stem Athabasca
  // is real flowing water, so it alone keeps WATER_COL wave threads.
  const drainMat = new LineMaterial({
    color: DRAIN_COL, linewidth: 1.05, transparent: true, opacity: 0.35,
    depthWrite: false, fog: false,
  });
  drainMat.resolution.set(1280, 720);
  const drapeRun = (pts, mat = drainMat) => {
    const runs = [[]];
    for (const [x, z] of pts) {
      if (Math.hypot(x, z) > 19.3) { if (runs[runs.length - 1].length) runs.push([]); continue; }
      runs[runs.length - 1].push(x, field(x, z) * VEX + 0.025, z);
    }
    for (const r of runs) {
      if (r.length < 6) continue;
      const g = new LineGeometry();
      g.setPositions(r);
      const line = new Line2(g, mat);
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
  // Main-stem Athabasca: NO slab — the old flat ribbon (seamed quads floating
  // above terrain) is gone. Water sits INSIDE the carved trough valley as 2
  // thin draped wave threads below; contours stop at its banks (WATER_MASK)
  // and the banks keep the shoreline top-rank glow via shoreTouch.
  // River wave lines: the ONLY water on the main stem — 2 thin blue threads
  // draped at the trough bottom (per-segment field() sampling, so they ride
  // the valley floor inside the carve, never a floating band). Same
  // WATER_COL ice-blue, 2 offset wavy centerlines with gentle sinuosity.
  // No ribbon slab, no chevrons — lines alone carry flow.
  {
    const offs = [-0.18, 0.18];
    const WAVE_AMP = 0.09; // km lateral wiggle
    for (let oi = 0; oi < offs.length; oi++) {
      const off = offs[oi];
      const pts = [];
      for (let z = -19; z < 19; z += 0.3) {
        const z2 = z + 0.3;
        if (z2 > 19) break;
        const cx = drainAt(z) + off + Math.sin(z * 1.1 + oi * 2.1) * WAVE_AMP;
        const cx2 = drainAt(z2) + off + Math.sin(z2 * 1.1 + oi * 2.1) * WAVE_AMP;
        if (Math.hypot(cx, z) > 19.3 && Math.hypot(cx2, z2) > 19.3) continue;
        const y = (_heightAt(cx, z) * VEX + _heightAt(cx2, z2) * VEX) / 2 + 0.017;
        const y2 = y;
        pts.push(cx, y, z, cx2, y2, z2);
      }
      if (pts.length < 6) continue;
      const wg = new LineGeometry(); wg.setPositions(pts);
      const wm = new LineMaterial({ color: WATER_COL, linewidth: 1.7, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
      wm.resolution.set(1280, 720);
      const wl = new LineSegments2(wg, wm); wl.renderOrder = 1; group.add(wl);
    }
  }

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
      for (const sp of labelGroup.children) sp.scale.set(0.46 * pillF * (sp.userData.aspect || 4), 0.46 * pillF, 1);
      for (const sp of summitGroup.children) sp.scale.set(0.5 * pillF * (sp.userData.aspect || 4), 0.5 * pillF, 1);
    },
    setSize(w, h) {
      baseMat.resolution.set(w, h);
      indexMat.resolution.set(w, h);
      summitMat.resolution.set(w, h);
      ringMat.resolution.set(w, h);
      shoreMat?.resolution.set(w, h);
      drainMat.resolution.set(w, h);
    },
    update(t = 0) {
      // Attention lock (Phase 1 Task 10): terrain whispers at TOP so faults
      // own the frame — drill-in dims further via dimF. Contour core colors
      // sit at cool grey (never white) so red/amber alarms lead in luminance.
      baseMat.opacity = 0.16 * dimF;
      indexMat.opacity = 0.32 * dimF;
      summitMat.opacity = 0.32 * dimF; // dimmed summit emphasis — alarms lead
      ringMat.opacity = 0.25;
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material !== baseMat && o.material !== indexMat && o.material !== summitMat) o.material.dispose();
      });
      baseMat.dispose();
      indexMat.dispose();
      summitMat.dispose();
    },
  };
}
