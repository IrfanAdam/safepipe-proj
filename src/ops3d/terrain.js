/* Safepipe Ops 3D — src/ops3d/terrain.js · Permian-representative holographic topo.
 * buildTerrain(scene) → { mesh, setSize, update, dispose }
 * Representative Permian-basin floor (1 unit = 1 km): eastward dip ~1.5 m/km
 * + broad low swells ±40 m + TWO gentle hills (+45/+34 m, placed in the gaps
 * between pipe corridors so rings close around real highs) + one shallow
 * hollow (−24 m) + one winding dry draw ~30 m deep + one playa-lake
 * depression ~10 m deep — total relief ≈ −40…+75 m true, VEX 3.5.
 * No rim mountains. The body carries stepped hypsometric tint + baked NW
 * hillshade so elevation reads as shading at TOP, not just lines.
 * Marching-squares 128×128 grid at 20 levels; unordered segments are
 * chained (quantized-endpoint greedy) into continuous smooth polylines per
 * level and rendered as Line2 strips — two tiers: brighter index lines
 * every 5th level over dim base lines, each index ring carrying its
 * elevation in meters so the contours read as a plotting technique, not
 * decoration. Cells whose local gradient is below SLOPE_MIN are skipped,
 * so flats stay clean while contours wrap the rest of the terrain.
 * Neutral bone-grey palette; one blue playa lake disc + shoreline ring.
 * No dots on terrain, ever. WebGL1-safe (no custom GLSL).
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const SIZE = 44; // map extent, km (1 unit = 1 km)
const R_MAP = 20; // boundary ring radius, km
const N = 128; // marching-squares grid cells per side
const LEVELS = 20; // contour levels
const VEX = 3.5; // vertical exaggeration, fixed (network/gridfloor match this)
const SLOPE_MIN = 0.0012; // skip contour cells flatter than ~1.2 m/km
const BASE_COL = new THREE.Color(0x6a7377); // neutral bone-grey base contours
const INDEX_COL = new THREE.Color(0x9aa3a6); // brighter every-5th index contours
const BELOW_COL = new THREE.Color(0x4a5255); // below-datum deep grey
const RING_COL = 0x2fa8c7;
const LAKE_X = -9; // playa lake center, km (flat spot, away from center + draw)
const LAKE_Z = 6;
const LAKE_R = 1.3; // mean radius; shoreline modulated below, ~2.6 km across
const DRAW_W = 0.8; // dry-draw half-width km — narrow banks bend contours into Vs
const LAKE_BLUE = new THREE.Color(0x4d8fd1); // subtle water tint for contours
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

/* Permian-basin representative floor field (km units). Eastward dip ~1.5 m/km,
 * broad low swells ±40 m (damped flat near the playa so it sits in a flat
 * spot), TWO gentle hills in the gaps between pipe corridors — H1 SE
 * (+45 m), H2 west (+34 m, clear of the trunks and the vignette crush) —
 * so index rings close around real highs, one shallow hollow (−24 m) between the two E-W trunks, one winding dry
 * draw ~30 m deep carved along a meandering centerline, one organic
 * playa-lake depression ~10 m deep. Total relief ≈ −40…+75 m. No rim. */
export function field(x, z) {
  const dip = -0.0015 * x; // eastward dip: down ~1.5 m per km east
  const lakeMask = lakeWet(x, z);
  const swell =
    (0.027 * Math.sin(x * 0.16 + 1.2) * Math.cos(z * 0.13 - 0.6) +
    0.0105 * Math.sin(x * 0.31 - 0.4) * Math.sin(z * 0.27 + 2.0)) *
    (1 - 0.75 * lakeMask);
  const bump = (ax, az, sig, amp) => {
    const dx = x - ax, dz = z - az;
    return amp * Math.exp(-(dx * dx + dz * dz) / (2 * sig * sig));
  };
  const hills = bump(7, 9.5, 3.8, 0.045) + bump(-11.5, -0.5, 3.0, 0.034);
  const hollow = bump(7, -3.5, 2.6, -0.024);
  const zc = drawCenter(x);
  const dd = (z - zc) / DRAW_W;
  const draw = -0.030 * Math.exp(-dd * dd); // dry draw, ~30 m deep, steep banks
  const playa = -0.01 * lakeMask; // playa depression, ~10 m deep
  return dip + swell + hills + hollow + draw + playa;
}

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

/* Index-ring elevation tag: small mono meter readout riding the ring so the
 * contours read as a plotting technique (cf. Britannica contoured-peak
 * plate: numbered rings closing around the high). */
function elevLabel(text, x, y, z) {
  const cv = document.createElement('canvas');
  cv.width = 192;
  cv.height = 48;
  const ctx = cv.getContext('2d');
  ctx.font = '600 30px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#d5dadb';
  ctx.fillText(text, 96, 26);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 1,
    depthWrite: false, depthTest: false, fog: false,
  }));
  sp.scale.set(3.0, 0.75, 1); // TOP-legible from 68 km, like asset pills
  sp.position.set(x, y, z);
  sp.renderOrder = 5;
  return sp;
}

/* One chained polyline → Line2 strip at its true elevation × VEX, with
 * periphery fade toward the boundary ring baked into vertex colors.
 * Inside the playa shoreline the neutral grey yields to subtle water blue. */
const _wc = new THREE.Color();
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
    _wc.copy(col).lerp(LAKE_BLUE, lakeWet(x, z) * 0.85);
    clr[i * 3] = _wc.r * f;
    clr[i * 3 + 1] = _wc.g * f;
    clr[i * 3 + 2] = _wc.b * f;
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

  // Two shared fat-line materials: dim base + brighter index, glow trimmed
  // ~20% vs before so the neutral contours sit calm under the fault zone.
  const baseMat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: 1.2,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const indexMat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: 2.2,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  baseMat.resolution.set(1280, 720);
  indexMat.resolution.set(1280, 720);

  // 20 levels chained into smooth strips; every 5th is a brighter index contour.
  // The two longest index rings per level carry their elevation in meters —
  // gated to zoomed views (segment/asset): at full-map distance no meter
  // readout stays legible without becoming a billboard, same as paper topo.
  const labelGroup = new THREE.Group();
  labelGroup.name = 'ops-elev-labels';
  for (let k = 0; k < LEVELS; k++) {
    const level = mn + ((k + 0.5) / LEVELS) * (mx - mn);
    const y = level * VEX;
    const isIndex = k % 5 === 4;
    const col = level >= 0 ? (isIndex ? INDEX_COL : BASE_COL) : BELOW_COL;
    const paths = chainSegments(levelSegments(H, N, step, level))
      .map(smoothPath)
      .filter((p) => p.length >= 2);
    for (const p of paths) group.add(stripObject(p, y, col, isIndex ? indexMat : baseMat));
    if (isIndex) {
      const tag = `${Math.round(level * 1000)} m`;
      const ranked = paths.filter((p) => p.length >= 10).sort((a, b) => b.length - a.length).slice(0, 2);
      for (const p of ranked) {
        const q = p[Math.floor(p.length / 2)];
        labelGroup.add(elevLabel(tag, q[0], y + 0.12, q[1]));
      }
    }
  }
  labelGroup.visible = false; // twin.js setDetail reveals on drill-in
  group.add(labelGroup);

  // Summit tags: always-visible elevation proof at TOP — the two hill
  // summits carry their height so elevation reads before any drill-in.
  const summitGroup = new THREE.Group();
  summitGroup.name = 'ops-summits';
  for (const [sx, sz] of [[7, 9.5], [-11.5, -0.5]]) {
    const h = field(sx, sz);
    const tag = elevLabel(`+${Math.round(h * 1000)} m`, sx, h * VEX + 0.6, sz);
    tag.scale.set(4.2, 1.05, 1); // summit proof must survive TOP distance
    summitGroup.add(tag);
  }
  group.add(summitGroup);

  // Solid table body: stepped hypsometric tint + baked NW hillshade under
  // the contours — near-black in the lows rising to mid grey on the highs,
  // normal blending so it reads as matter, not light. Lines stay crisp on top.
  {
    const SEG = 96;
    const body = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    const pa = body.attributes.position;
    const colors = new Float32Array(pa.count * 3);
    const cLo = new THREE.Color(0x0e1214);
    const cHi = new THREE.Color(0x6b7377); // wide enough to survive TOP view
    const tmp = new THREE.Color();
    // NW key light for the baked hillshade (matches scene key direction).
    const LX = -0.5, LY = 0.8, LZ = -0.4;
    const ll = Math.hypot(LX, LY, LZ);
    const lx = LX / ll, ly = LY / ll, lz = LZ / ll;
    const E = 0.3; // finite-difference step, km
    const span = (mx - mn) || 1;
    for (let k = 0; k < pa.count; k++) {
      const x = pa.getX(k);
      const z = -pa.getY(k); // plane Y maps to world -Z after rotation
      const h = field(x, z);
      pa.setZ(k, h * VEX - 0.04);
      // Stepped hypsometric: quantize into LEVELS bands, keep 65% continuous
      // so bands read as tint steps, not stripes.
      const t = (h - mn) / span;
      const stepped = (Math.floor(t * LEVELS) + 0.5) / LEVELS;
      tmp.copy(cLo).lerp(cHi, t * 0.65 + stepped * 0.35);
      // Baked hillshade from analytic normals: NW faces lift, SE faces drop.
      const gx = (field(x + E, z) - field(x - E, z)) / (2 * E) * VEX;
      const gz = (field(x, z + E) - field(x, z - E)) / (2 * E) * VEX;
      const nl = Math.hypot(gx, 1, gz);
      const shade = 0.45 + 0.55 * Math.max(0, (-gx * lx + ly - gz * lz) / nl);
      const f = 1 - smooth(12, 19.5, Math.hypot(x, z));
      colors[k * 3] = tmp.r * shade * f;
      colors[k * 3 + 1] = tmp.g * shade * f;
      colors[k * 3 + 2] = tmp.b * shade * f;
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
    linewidth: 1.4,
    transparent: true,
    opacity: 0.32,
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
    color: RING_COL, linewidth: 1.0, transparent: true, opacity: 0.21,
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
    color: RING_COL, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
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
      color: 0x1d4a73, transparent: true, opacity: 0.28, depthWrite: false,
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
    color: 0x6fa8dc, linewidth: 1.2, transparent: true, opacity: 0.45,
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
    color: 0x6fa8dc, linewidth: 1.2, transparent: true, opacity: 0.55,
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
    setDetail(name) {
      labelGroup.visible = name !== 'network';
    },
    setSize(w, h) {
      baseMat.resolution.set(w, h);
      indexMat.resolution.set(w, h);
      ringMat.resolution.set(w, h);
      lipMat.resolution.set(w, h);
      shoreMat.resolution.set(w, h);
      drainMat.resolution.set(w, h);
    },
    update(t = 0) {
      baseMat.opacity = 0.5 + 0.05 * Math.sin(t * 1.2);
      indexMat.opacity = 0.9 + 0.04 * Math.sin(t * 1.2 + 0.6);
      ringMat.opacity = 0.32 + 0.07 * Math.sin(t * 1.2 + 1.3);
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
