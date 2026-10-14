/* Safepipe Ops3D Ring-2 — src/ring2/overlays.js (Phase 3, Task 7).
 * Twin draws OVERLAYS on a transparent three.js canvas over the
 * MapLibre base, plus an opaque DEM-draped takeover ground inside the ring
 * that exists ONLY at the top of the mix slider (mix 100 full twin).
 * Every overlay vertex is ground-sat via sampleH.
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
 *   4. Water tint — WATER_COL blue ONLY where sampleH < CASPIAN_SHORE_H
 *      (Caspian shoreline datum, -24 m: Terrarium clamps near-shore water
 *      at ~-27, so a 0 m key would flood the coastal plain while a -28 m
 *      key would erase the sea), as a
 *      per-sample feathered-alpha mesh (never an opaque fill quad or box).
 *      WATER_COL must not be used for any non-water overlay.
 *
 * Rebuilds (re-drapes) when the field bus transitions to a better source.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-3]
 */
import * as THREE from 'three';
import { pickGLPrecision } from '../glprecision.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SANGACHAL, VEX, RING_RADIUS_M, EXTENT_M } from './site.js';
import { MAP_MAX_PITCH_DEG, MAP_TRUE_FOV_DEG, TWIN_MIN_RANGE_M, TWIN_MAX_RANGE_M, tiltFadeForPitch } from './sync.js';
import { sampleH, sampleSource, onStatus, getStatus } from './field.js';
import { DRAPE_LIFTS, RIM_FADE_IN, RIM_TILT_GAIN } from './drape.js';
import { ringRevealForProgress } from './sector.js';
import { TIER } from './facilities/dims.js';

/* REF GATE 2: every overlay renderable carries userData.tier. All overlay
 * geometry is computed from the real field/site constants (mapped radius,
 * DEM drape, schematic program) — TIER.DERIVED throughout.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-02] */
const tagDerived = (o) => { o.userData.tier = TIER.DERIVED; return o; };

/** Blue reserved EXCLUSIVELY for water (sampleH < CASPIAN_SHORE_H). */
/* Caspian shoreline datum: the Caspian surface sits at -28 m but Terrarium
 * clamps near-shore water at ~-27, so keying water at 0 floods the coastal
 * plain and keying at -28 erases the sea. -24 m splits the difference.
 * field.js proceduralH keeps its own -28 anchor (real-world datum); this
 * is the RENDER key only. [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
export const CASPIAN_SHORE_H = -24;
export const WATER_COL = 0x2f6fd8;
export const RING_COL = 0xe8a33d;
export const CONTOUR_MINOR_COL = 0xd7dde2;
export const CONTOUR_MAJOR_COL = 0xffc46b;
export const SCHEMATIC_COL = 0x9aa4ad;
export const SCHEMATIC_EDGE_COL = 0xe8a33d;

const MINOR_INTERVAL_M = 20;
const INDEX_EVERY = 5; // every 5th minor line is a numbered index ring
const GRID_N = 140; // marching-squares grid across the full extent
/* Superimpose budget (drape.js): every lift is the vertical offset between
 * the twin drape (sampleH*VEX+lift) and the map photo (h*VEX, same DEM).
 * Nothing writes depth so paint order composites — lifts sit at the floor
 * (ground 1 m … mask 6 m) keeping oblique parallax subpixel while top-down
 * stays pixel-identical. Measured far-rim LOD gap (twin-z12 vs map-z15:
 * max 16.7 m) dominates any lift on relief — geometry left alone. */
const LIFT_RING = DRAPE_LIFTS.RING;
const LIFT_MINOR = DRAPE_LIFTS.MINOR;
const LIFT_MAJOR = DRAPE_LIFTS.MAJOR;
const LIFT_WATER = DRAPE_LIFTS.WATER;

/* Defect-fix tuning (verified against mix0/50/100 TOP captures). */
const WATER_FEATHER_M = 8; // shoreline feather band: alpha ramps 0->full over this depth
const WATER_MAX_OPACITY = 0.55;
const EDGE_FADE_FRAC = 0.10; // outer 10% of the DEM window fades to 0 (no razor edge)
const PILL_COLLAPSE_RANGE_M = 12000; // above: max 3 pills + count; below: full set
const MASK_COL = 0x0b0c0c; // page/map background: masked ground reads as vignette, not void
const MASK_LIFT_M = DRAPE_LIFTS.MASK; // hugs terrain outside the ring, hides satellite beneath
const MASK_SIZE_M = 300000; // covers the oblique horizon (far plane raised to match)
const MASK_SEG = 100;
const PILL_MAX_MAP_RANGE = 3;
/* Takeover ground (Issue 2): opaque DEM-draped twin terrain INSIDE the ring,
 * shown only at the top of the slider. Neutral hypsometric Lambert (own
 * lights, overlay Basic materials ignore lights) so mix 100 reads as a
 * rendered twin, not satellite. Lift sits under every overlay lift. */
const LIFT_GROUND_M = DRAPE_LIFTS.GROUND;
const TAKEOVER_SEG = 128; // sectors
const TAKEOVER_RINGS = 26;

/* Schematic terminal program (NOT surveyed — every block is labelled). */
// Phase-02 T0+T1 raise all parametric geometry (src/ring2/facilities/) —
// the placeholder set is fully retired; buildSchematic stays as a no-op
// shell so the label/declutter call sites keep one audit point.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-02]
const SCHEMATIC_BLOCKS = [];

/** Pure mix*tilt opacity law (node-testable; applyEmphasisFull is this per mat). */
export function emphasisOpacity(baseOpacity, t, tiltK) {
  return baseOpacity * t * tiltK;
}

/* Tilt-fade MEMBERSHIP (single source of truth — reg() stamps every mat
 * through this, addEmphasisMats() stamps OSM vectors through this). NOTHING
 * rides the tilt fade anymore: owner verdict 2026-10-12 — at steep tilt the
 * terrain-coupled contour/vector lines stay FULLY visible (per-vertex
 * sampleH drape, so no float) and the SATELLITE yields instead via the
 * mix.js tilt takeover (twin ground in, photo out). Every kind is mix-only
 * and pitch-invariant at every angle. Kept as a function (not deleted) so
 * reg()/addEmphasisMats() call sites and the node pins keep one audit
 * point; the b65vecfade regression (whole twin dissolving past 50°) stays
 * fixed by scoping, now taken to zero.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
export function tiltFadeApplies(_kind) {
  return false;
}

/** Per-mat opacity with tilt membership (node-testable). Every kind is
 * mix-only now (tiltFadeApplies is false across the board): matOpacity(base,
 * t, anyPitch, anyKind) is exactly base*t. */
export function matOpacity(baseOpacity, t, pitchDeg, kind) {
  return emphasisOpacity(baseOpacity, t, tiltFadeApplies(kind) ? tiltFadeForPitch(pitchDeg) : 1);
}

/** Canvas text sprite. Returns THREE.Sprite with world-height `h`. */

/* Auto-redrape settle rule (slide smoothing, node-testable). The DEM
 * coarse->live flip schedules a full dispose+recreate+recompile; while the
 * mix/tilt feed is still moving values the rebuild waits for the view to
 * settle instead of hitching mid-gesture. */
export const REDRAPE_DEBOUNCE_MS = 300;
export const REDRAPE_SETTLE_MS = 500;
export const REDRAPE_MAX_DEFERS = 20;
export function shouldDeferRedrape({ nowMs, lastSlideAt, defers = 0 } = {}) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastSlideAt)) return false;
  if ((defers ?? 0) >= REDRAPE_MAX_DEFERS) return false;
  return nowMs - lastSlideAt < REDRAPE_SETTLE_MS;
}

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
  /* Phase 00 camera parity: default twin fov === map true fov (sync.js
   * MAP_TRUE_FOV_DEG). main.js passes it explicitly; the default keeps
   * standalone callers paritied too.
   * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-00] */
  const fovDeg = opts.fovDeg ?? MAP_TRUE_FOV_DEG;

  let renderer;
  try {
    // Guarded precision: Safari on some GPUs returns null from
    // getShaderPrecisionFormat(), which three dereferences unguarded and
    // dies at construction (whole tab black, one TypeError).
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, precision: pickGLPrecision() });
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
  // Takeover-ground lights (Issue 2): the Lambert twin terrain is the only
  // lit material in the scene — every overlay is MeshBasicMaterial and
  // ignores lights. Added to the scene (not the rebuilt group) once.
  // Base intensities are the single source of truth for the GATE-3 tone
  // grade (setToneGrade scales both, never rewrites the bases).
  const AMBIENT_BASE = 0.85;
  const SUN_BASE = 1.5;
  const ambLight = new THREE.AmbientLight(0xc4cacf, AMBIENT_BASE);
  scene.add(ambLight);
  const takeSun = new THREE.DirectionalLight(0xfff1dc, SUN_BASE);
  takeSun.position.set(-35000, 52000, 22000);
  scene.add(takeSun);
  /* GATE-3 TONE GRADE (defect 4, twin side): multiplier on the
   * takeover-ground lights, driven per frame from the mix band by main.js
   * (sector.js toneGradeForMix: sat-matched at mix 0 -> 1.0 at mix 100, so
   * the photo->twin base swap moves tone smoothly). Scene-level — survives
   * rebuild. Clamped so a bad caller can never black out the twin. */
  let lastTone = 1;
  function setToneGrade(g) {
    let n = Number(g);
    if (!Number.isFinite(n)) n = 1;
    n = Math.min(1.1, Math.max(0.5, n));
    lastTone = n;
    try {
      ambLight.intensity = AMBIENT_BASE * n;
    } catch { /* grade never breaks the frame */ }
    try {
      takeSun.intensity = SUN_BASE * n;
    } catch { /* grade never breaks the frame */ }
  }
  const camera = new THREE.PerspectiveCamera(
    fovDeg,
    Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
    10,
    600000, // mask spans the oblique horizon; nothing writes depth so no fighting
  );
  const startRange = opts.startRange ?? 26000;
  camera.position.set(0, startRange, 0.01);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  /* Ground-plane pan (pan-drift fix): screenSpacePanning=true (the three.js
   * default) lifts/drops controls.target.y on every vertical screen drag at
   * oblique pitch, but getPose() below reports terrain-snapped ty while the
   * twin renders the drifted target — the rendered view ray and the synced
   * map ray shear further apart with every pan. false keeps pan in the world
   * XZ plane (map-style pan; target.y is owned solely by the terrain snap in
   * updateControls).
   * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
  controls.screenSpacePanning = false;
  // Input-ownership note: touches stay at the OrbitControls default
  // (ONE-finger ROTATE, TWO-finger DOLLY_PAN). Pan MUST keep working
  // through the twin — the map is non-interactive and follows via the
  // per-frame twin->map sync, so a twin pan is the only pan. Never set
  // enablePan=false or override touches here.
  // [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // Tilt clamp === map maxPitch (sync.js MAP_MAX_PITCH_DEG): the twin can
  // never orbit past where the map clamps, or the mix fade shears there.
  controls.maxPolarAngle = (MAP_MAX_PITCH_DEG * Math.PI) / 180;
  /* Dive clamp (suspect 2, DEM-overzoom variant PROVED): minDistance 800 let
   * the map overzoom to z≈16.5–16.9 — ~2 levels past the Terrarium z15
   * native — magnifying twin-coarse vs map-full-res DEM differences into
   * vertical shear at oblique pitch. 1500 m keeps zoom ≤16 (≤1 level) on
   * viewports ≤ ~1096 px; Esri z19 native is never binding (needs ≲140 m).
   * Derived in sync.js (TWIN_MIN_RANGE_M) — single source of truth.
   * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
  controls.minDistance = TWIN_MIN_RANGE_M;
  /* Handoff-5-close: ceiling is TWIN_MAX_RANGE_M (sync.js single source) so
   * the ring-frame hold (10 km ring + margin, ~40 km range in short
   * viewports) never fights OrbitControls. Free orbit may pull back to the
   * full ring view, never deep void. */
  controls.maxDistance = TWIN_MAX_RANGE_M;

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
  /* kind: tiltFadeApplies(kind) decides at registration whether the mat
   * rides the tilt fade ('contour' | 'vector' only) or is mix-only. Every
   * call site passes an explicit kind — no silent default into the fade. */
  const reg = (mat, base = mat.opacity, kind = 'other') => {
    if (typeof base === 'string') { kind = base; base = mat.opacity; } // reg(mat, 'label')
    mat.userData.baseOpacity = base;
    mat.userData.tiltFade = tiltFadeApplies(kind);
    emphasisMats.push(mat);
    return mat;
  };
  /* Externally-owned mats (OSM vectors in twin.scene, NOT in group): rebuild
   * clears emphasisMats, so registered externals are re-added after every
   * rebuild with the same lastT/lastTiltK re-applied. They live outside
   * `group`, so group.clear()/disposables never dispose them.
   * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
  const externalMats = [];
  function addEmphasisMats(mats) {
    for (const m of mats ?? []) {
      if (!m) continue;
      if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity ?? 1;
      // OSM vectors are draped linework: stamped through the same membership
      // (mix-only like everything else since the tilt fade retired).
      m.userData.tiltFade = tiltFadeApplies('vector');
      if (!emphasisMats.includes(m)) emphasisMats.push(m);
      if (!externalMats.includes(m)) externalMats.push(m);
    }
    applyEmphasisFull();
    return mats;
  }

  /* GATE-3 RING-FROM-CORNERS (defect 5, twin side): the handoff ring draws
   * geometrically instead of just fading. While a flight owns the ring
   * (ringFlight), the line scales from RING_CORNER_SCALE x (frame corners at
   * the hold footprint) down to the site ring while its stroke draws 0->full
   * (sector.js ringRevealForProgress); its opacity rides max(mix law,
   * reveal) so it stays continuous into the push. Standalone/done/idle
   * clear the override (setRingReveal(null)) and the normal mix law owns
   * the ring. Scale re-applies in buildRing so a mid-flight redrape keeps
   * the converge. */
  let ringLine = null;
  let lastRingP = 1;
  let ringFlight = false;
  function applyRingTransform() {
    if (!ringLine) return;
    try {
      const { scale } = ringRevealForProgress(lastRingP);
      ringLine.scale.set(scale, 1, scale);
    } catch { /* ring never breaks the frame */ }
  }
  function setRingReveal(p) {
    if (p === null || p === undefined) {
      ringFlight = false;
      lastRingP = 1;
      if (ringLine) {
        try {
          ringLine.scale.set(1, 1, 1);
        } catch { /* ring never breaks the frame */ }
      }
      applyEmphasisFull();
      return 1;
    }
    let x = Number(p);
    if (!Number.isFinite(x)) x = 1;
    lastRingP = Math.min(1, Math.max(0, x));
    ringFlight = true;
    applyRingTransform();
    applyEmphasisFull();
    return lastRingP;
  }

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
    })), 'ring'); // mapped-radius reference: mix-only, never tilt-faded
    const ring = tagDerived(new THREE.Line(g, m));
    ring.name = 'ring2-ring';
    ring.frustumCulled = false;
    ring.material.userData.isHandoffRing = true; // GATE-3 ring-from-corners: flight-owned look
    ringLine = ring;
    applyRingTransform(); // mid-flight redrape keeps the converge
    group.add(ring);
    const lbl = makeLabelSprite(`RING-2 · r ${SANGACHAL.radiusKm} km · source:${src}`, { h: 420 });
    reg(lbl.material, 'label');
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
    })), 'marker'));
    tagDerived(pin);
    pin.position.y = groundY(0, 0, 40);
    group.add(pin);
    const pinLbl = makeLabelSprite(
      `SANGACHAL ${SANGACHAL.lat.toFixed(6)}N ${SANGACHAL.lon.toFixed(6)}E · source:mapped`, { h: 380 },
    );
    reg(pinLbl.material, 'label');
    pinLbl.position.set(0, groundY(0, 0, 1100), 0);
    group.add(pinLbl);
    const pinAnchor = new THREE.Vector3(0, groundY(0, 0, 0), 0);
    labels.push({ sprite: pinLbl, leader: makeLeader(pinAnchor, pinLbl.position), anchor: pinAnchor });
  }

  function makeLeader(a, bPos) {
    const g = track(new THREE.BufferGeometry().setFromPoints([a.clone(), bPos.clone()]));
    const line = new THREE.Line(g, reg(track(new THREE.LineBasicMaterial({
      color: SCHEMATIC_EDGE_COL, transparent: true, opacity: 0.55, depthWrite: false,
    })), 0.55, 'leader'));
    tagDerived(line);
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
          reg(track(new THREE.MeshBasicMaterial({ color: SCHEMATIC_COL, transparent: true, opacity: 0.55, depthWrite: false })), 'schematic'),
        );
        mesh.position.set(b.x, gy + (b.h * VEX) / 2, b.z);
      } else if (b.kind === 'cyl') {
        mesh = new THREE.Mesh(
          track(new THREE.CylinderGeometry(b.r, b.r, b.h * VEX, 28)),
          reg(track(new THREE.MeshBasicMaterial({ color: SCHEMATIC_COL, transparent: true, opacity: 0.55, depthWrite: false })), 'schematic'),
        );
        mesh.position.set(b.x, gy + (b.h * VEX) / 2, b.z);
      } else {
        mesh = new THREE.Mesh(
          track(new THREE.CylinderGeometry(b.r, b.r * 1.6, b.h * VEX, 10)),
          reg(track(new THREE.MeshBasicMaterial({ color: SCHEMATIC_COL, transparent: true, opacity: 0.7, depthWrite: false })), 'schematic'),
        );
        mesh.position.set(b.x, gy + (b.h * VEX) / 2, b.z);
        const tip = makeLabelSprite('FLARE-TIP · source:schematic', { h: 150 });
        reg(tip.material, 'label');
        tip.userData.baseScale = tip.scale.clone();
        tip.userData.screenClamp = true;
        tip.userData.hideNear = true;
        tip.position.set(b.x, gy + b.h * VEX + 260, b.z);
        tip.name = 'flare-tip';
        group.add(tip);
        labels.push({ sprite: tip, leader: makeLeader(blockTop, tip.position), anchor: blockTop });
      }
      mesh.name = `schematic-${b.name}`;
      tagDerived(mesh);
      group.add(mesh);
      const edges = new THREE.LineSegments(
        track(new THREE.EdgesGeometry(mesh.geometry)),
        reg(track(new THREE.LineBasicMaterial({ color: SCHEMATIC_EDGE_COL, transparent: true, opacity: 0.9, depthWrite: false })), 'schematic'),
      );
      edges.position.copy(mesh.position);
      tagDerived(edges);
      group.add(edges);
      const lbl = makeLabelSprite(`${b.name} · source:schematic`, { h: 150 });
      reg(lbl.material, 'label');
      lbl.userData.baseScale = lbl.scale.clone();
      lbl.userData.screenClamp = true;
      lbl.userData.hideNear = true;
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
    reg(countPill.material, 'label');
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
    const range = camera.position.distanceTo(controls.target);
    const collapsed = range > PILL_COLLAPSE_RANGE_M;
    // Screen-clamped placeholders: ~40px pills at mid range (v1 DOM-pill
    // behavior); hidden in closest inspection where T0 geometry stands alone.
    let clampH = 0;
    try {
      const hPx = renderer.domElement.height || 800;
      clampH = (2 * range * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (40 / hPx);
    } catch { /* clamp stays off */ }
    const hidePlaceholder = range < 3500;
    labels.forEach((p, i) => {
      let vis = !collapsed || i < PILL_MAX_MAP_RANGE;
      if (vis && hidePlaceholder && p.sprite.userData.hideNear) vis = false;
      p.sprite.visible = vis;
      p.leader.visible = vis;
      if (vis && clampH > 0 && p.sprite.userData.screenClamp && p.sprite.userData.baseScale) {
        const b = p.sprite.userData.baseScale;
        const k = clampH / b.y;
        p.sprite.scale.set(b.x * k, clampH, 1);
      }
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
          reg(lbl.material, 'label');
          lbl.userData.baseScale = lbl.scale.clone();
          lbl.userData.screenClamp = true;
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
      })), 'contour')); // draped linework: mix-only at every pitch (tilt fade retired)
      tagDerived(m);
      m.frustumCulled = false;
      group.add(m);
    };
    mkLines(minorPos, minorFade, CONTOUR_MINOR_COL, 0.4);
    mkLines(majorPos, majorFade, CONTOUR_MAJOR_COL, 0.85);
    return { min: mn, max: mx, indexCount };
  }

/* Radial rim fade: 1 inside, smoothstepping to 0 at the 10 km ring, so
 * overlays dissolve concentrically — never a square curtain with a corner
 * wedge. (Was a max-norm "outer 10% of the square" fade; its straight N-S /
 * E-W bands and 90° corner showed through over flat water.) The ring line
 * itself is exempt (it is the mapped radius, not coverage). */
function edgeFade(x, z) {
  const rr = Math.hypot(x, z);
  const inner = RING_RADIUS_M * (1 - EDGE_FADE_FRAC);
  if (rr <= inner) return 1;
  if (rr >= RING_RADIUS_M) return 0;
  const u = (rr - inner) / (RING_RADIUS_M - inner);
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
    // sampleH < CASPIAN_SHORE_H — no fill quad is ever emitted for land.
    const wc = new THREE.Color(WATER_COL);
    const pos = new Float32Array(vn * vn * 3);
    const col = new Float32Array(vn * vn * 4);
    const alphaAt = (x, z) => {
      const depth = CASPIAN_SHORE_H - sampleH(x, z);
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
        // Draped sea surface: rides the DEM (flat over flat sea) a hair
        // above the map photo instead of floating at a fixed height — the
        // old flat 0+lift plane stood ~28 m off the Caspian DEM surface and
        // separated from the photo at oblique pitch.
        pos[k * 3 + 1] = sampleH(x, z) * VEX + LIFT_WATER;
        pos[k * 3 + 2] = z;
        col[k * 4] = wc.r;
        col[k * 4 + 1] = wc.g;
        col[k * 4 + 2] = wc.b;
        col[k * 4 + 3] = alphaAt(x, z);
      }
    }
    const idx = [];
    let wet = 0;
    // All-dry skip inherits the CASPIAN_SHORE_H key via alphaAt: a cell is
    // emitted only if at least one corner is wet (h < CASPIAN_SHORE_H).
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
    })), WATER_MAX_OPACITY, 'water')); // sea fill: mix-only, NEVER tilt-faded
    m.name = 'ring2-water';
    tagDerived(m);
    m.frustumCulled = false;
    group.add(m);
    return wet;
  }

  /* Ring mask: an opaque page-background drape OUTSIDE the 10 km ring that
   * clips the satellite to a disc at every pitch (map tiles are square and
   * full-bleed; oblique without this shows a planet-limb of satellite the
   * overlays can't superimpose on). Hard world-circular clip at exactly R
   * via onBeforeCompile fragment injection: discard inside R (alpha 0),
   * opaque outside (alpha 1) — same begin_vertex plus opaque_fragment
   * anchor pattern as the rebuild() ring-clip pass. Fragment-space, so the
   * edge is pixel-crisp regardless of the coarse drape grid (the old
   * vertex-alpha feather 0.9R->R interpolated across 3 km cells and
   * rendered chunky). Own customProgramCacheKey so three never confuses
   * this program with the overlay clip-fade program. Never registered for
   * emphasis (must survive mix 0) and skipped by the ring-clip pass below
   * (it IS the clipper). depthWrite off — nothing in this scene writes
   * depth, so paint order alone composites mask-first, overlays-over. */
  function buildMask() {
    // Ring with a REAL hole (geometry-level clip, zero shader injection).
    // The old 300 km plane + onBeforeCompile fragment-discard misfired on
    // real-Safari GPUs (whole viewport black, v1 unaffected); a true ring
    // cannot over-discard, and there is no injected GLSL to miscompile.
    const THETA = 256, PHI = 48; // ~2.9 km radial cells, same drape as before
    const g = track(new THREE.RingGeometry(RING_RADIUS_M, MASK_SIZE_M / 2, THETA, PHI));
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      p.setY(i, sampleH(p.getX(i), p.getZ(i)) * VEX + MASK_LIFT_M);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    const m = track(new THREE.MeshBasicMaterial({
      color: MASK_COL,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'ring2-mask';
    tagDerived(mesh);
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  /* Rim-fade material handle: refreshed by every buildRimFade() so the
   * per-frame tilt feed below always hits the live program. */
  let rimFadeMat = null;

  /* Periphery vignette: a MASK_COL annulus INSIDE the disc, DEM-draped
   * like the ground, with the falloff evaluated PER PIXEL in the fragment
   * shader as smoothstep(inner, R, |world.xz|) — a pure function of
   * ground-plane distance from the disc center, base curve identical to
   * rimFadeAlpha() in drape.js (GLSL smoothstep is the same cubic, pinned
   * by tests/ring2-drape.test.js).
   *
   * Why fragment, not vertex alpha: the old mesh baked alpha per VERTEX
   * on a coarse annulus and let the GPU linearly interpolate across ~170 m
   * cells, which skewed per side under perspective. A per-pixel
   * length(vWorld.xz) falloff is radially symmetric by construction;
   * tilt can't skew it because only the VERTICES ride the DEM (y), while
   * the fade reads the ground-plane radius (x, z).
   *
   * Tilt compensation (owner call): top-down the uniform band is even, but
   * at tilt the near (camera-side) rim compressed to a hard cut while the
   * far rim stayed soft (pixel-measured ~3.5 px vs ~7 px at 60° pitch).
   * The INNER radius therefore breathes with view alignment: the band
   * widens on the camera side and narrows opposite, scaled by pitch
   * (uTiltT = 0 at nadir, so top-down is exactly the uniform band), which
   * equalizes on-screen softness all around at every tilt. Gain lives in
   * drape.js RIM_TILT_GAIN; the width law mirrors rimWidthMult() there.
   * The annulus runs in to 0.8 R for headroom (the widened inner edge
   * never exceeds it); fragments below alpha 0.004 discard, so the extra
   * ring is invisible. Alpha still reaches 1 exactly at R where the opaque
   * outside mask takes over: one continuous dissolve.
   *
   * renderOrder 5 draws it over every overlay (paint order composites,
   * nothing writes depth). Never registered for emphasis: the rim must
   * dissolve at mix 0 too. Skipped by the ring-clip pass (it IS a fade).
   * userData.rimRadial marks the fragment implementation for the probe
   * lane; userData.rimShader carries the compiled uniforms so updateControls
   * can feed the per-frame tilt (pan-aware: measured off the orbit target).
   * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-4] */
  function buildRimFade() {
    const THETA = 220, PHI = 8;
    const g = track(new THREE.RingGeometry(RING_RADIUS_M * 0.8, RING_RADIUS_M, THETA, PHI));
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    const n = p.count;
    for (let i = 0; i < n; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      p.setY(i, sampleH(x, z) * VEX + DRAPE_LIFTS.RIM);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    const m = track(new THREE.MeshBasicMaterial({
      color: MASK_COL,
      transparent: true,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    m.userData.rimRadial = true;
    m.userData.rimFadeIn = RIM_FADE_IN;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRimR = { value: RING_RADIUS_M };
      sh.uniforms.uRimW0 = { value: RING_RADIUS_M * (1 - RIM_FADE_IN) };
      sh.uniforms.uTiltGain = { value: RIM_TILT_GAIN };
      sh.uniforms.uTiltT = { value: 0 };
      sh.uniforms.uCamDir = { value: new THREE.Vector2(0, 1) };
      sh.vertexShader =
        'varying vec3 vRimW;\n' +
        sh.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n vRimW = (modelMatrix * vec4(position, 1.0)).xyz;',
        );
      sh.fragmentShader =
        'varying vec3 vRimW;\nuniform float uRimR;\nuniform float uRimW0;\nuniform float uTiltGain;\nuniform float uTiltT;\nuniform vec2 uCamDir;\n' +
        sh.fragmentShader.replace(
          // Same anchor as the ring-clip pass: opaque_fragment (end of
          // main) — diffuseColor is only declared mid-main.
          '#include <opaque_fragment>',
          '{ float rr = length(vRimW.xz);' +
          ' float s = dot(vRimW.xz / max(rr, 1e-3), uCamDir);' +
          ' float wmul = max(1.0 + uTiltGain * uTiltT * s, 0.15);' +
          ' float a = smoothstep(uRimR - uRimW0 * wmul, uRimR, rr);' +
          ' if (a <= 0.004) discard; diffuseColor.a *= a; }\n#include <opaque_fragment>',
        );
      m.userData.rimShader = sh;
    };
    m.customProgramCacheKey = () => 'ring2-rimfade';
    m.needsUpdate = true;
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'ring2-rimfade';
    tagDerived(mesh);
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    group.add(mesh);
    rimFadeMat = m;
  }

  /* Takeover ground (Issue 2): opaque DEM-draped twin terrain filling the
   * disc to exactly R. Polar grid with a true center vertex (no hole, no
   * shader discard — Safari-safe). Neutral hypsometric vertex colors under
   * the scene lights. renderOrder -5: after the outside mask (-10), before
   * every overlay (0) — paint order alone composites, nothing writes depth.
   * Never registered for emphasis and skipped by the ring-clip pass (it IS
   * ground); visibility/opacity ride on setTakeover(u) only. */
  let groundMesh = null;
  let groundMat = null;
  let lastU = 0;
  /* Wall-clock ms of the last VALUE-changing setTakeover/setEmphasis (slider
   * drag or orbit still moving the view). The DEM auto-redrape waits these
   * out so a rebuild never lands mid-gesture. */
  let lastSlideAt = 0;
  function buildTwinGround() {
    const NS = TAKEOVER_SEG;
    const NR = TAKEOVER_RINGS;
    const cSea = new THREE.Color(0x232f38);
    const cLow = new THREE.Color(0x2a3036);
    const cHigh = new THREE.Color(0x6f7069);
    const tmp = new THREE.Color();
    const colAt = (h) => {
      if (!(h >= CASPIAN_SHORE_H)) return tmp.copy(cSea);
      const u = Math.min(1, Math.max(0, h / 450));
      return tmp.copy(cLow).lerp(cHigh, u);
    };
    const positions = [];
    const colors = [];
    const h0 = sampleH(0, 0);
    positions.push(0, h0 * VEX + LIFT_GROUND_M, 0);
    let c = colAt(h0);
    colors.push(c.r, c.g, c.b);
    for (let r = 1; r <= NR; r++) {
      const rr = (r / NR) * RING_RADIUS_M;
      for (let s = 0; s < NS; s++) {
        const a = (s / NS) * Math.PI * 2;
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        const h = sampleH(x, z);
        positions.push(x, h * VEX + LIFT_GROUND_M, z);
        c = colAt(h);
        colors.push(c.r, c.g, c.b);
      }
    }
    const ringStart = (r) => 1 + (r - 1) * NS;
    const idx = [];
    for (let s = 0; s < NS; s++) {
      idx.push(0, ringStart(1) + ((s + 1) % NS), ringStart(1) + s);
    }
    for (let r = 1; r < NR; r++) {
      for (let s = 0; s < NS; s++) {
        const a0 = ringStart(r) + s;
        const a1 = ringStart(r) + ((s + 1) % NS);
        const b0 = ringStart(r + 1) + s;
        const b1 = ringStart(r + 1) + ((s + 1) % NS);
        idx.push(a0, b1, b0, a0, a1, b1);
      }
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    groundMat = track(new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    groundMesh = tagDerived(new THREE.Mesh(g, groundMat));
    groundMesh.name = 'ring2-ground';
    groundMesh.renderOrder = -5;
    groundMesh.frustumCulled = false;
    groundMesh.visible = lastU > 0.003;
    groundMat.opacity = lastU;
    group.add(groundMesh);
  }
  /* Takeover control: u 0 = twin ground gone (satellite base), 1 = opaque
   * twin terrain. Called by the mix slider; re-applied after every rebuild. */
  function setTakeover(u) {
    const nu = Math.min(1, Math.max(0, Number(u) || 0));
    // Settle stamp: a VALUE change means the slider/orbit is still moving
    // the view — the DEM auto-redrape below waits these out. Identical
    // per-frame repeats (at rest) leave the stamp alone.
    if (nu !== lastU) lastSlideAt = Date.now();
    lastU = nu;
    if (groundMesh) groundMesh.visible = lastU > 0.003;
    if (groundMat) groundMat.opacity = lastU;
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
    for (const m of externalMats) {
      if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity ?? 1;
      emphasisMats.push(m);
    }
    labels = [];
    countPill = null;
    countLeader = null;
    const src = sampleSource(0, 0);
    buildRing(src === 'terrarium' ? 'mapped' : src);
    buildSchematic();
    const c = buildContours(src);
    const waterCells = buildWater();
    buildTwinGround();
    buildMask();
    buildRimFade();
    buildCountPill(); // last: +N covers ring + pin + schematic + contour labels
    // Ring-clip + periphery fade: every overlay EXCEPT the ring itself, the
    // mask (it IS the clipper), + label sprites dissolves over the outer
    // ~10% of the disc instead of hitting a hard edge (the old razor cut
    // read as a coverage boundary).
    // Sprites (pills/labels) stay unclipped by design.
    group.traverse((o) => {
      if (!o.material || o.isSprite || o.name === 'ring2-ring' || o.name === 'ring2-mask' || o.name === 'ring2-rimfade' || o.name === 'ring2-ground') return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || m.userData.ringClipped) continue;
        m.userData.ringClipped = true;
        m.transparent = true;
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uRingR = { value: RING_RADIUS_M };
          sh.uniforms.uFadeIn = { value: RIM_FADE_IN }; // same radius as the rim vignette
          sh.vertexShader =
            'varying vec3 vRingW;\n' +
            sh.vertexShader.replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\n vRingW = (modelMatrix * vec4(position, 1.0)).xyz;',
            );
          sh.fragmentShader =
            'varying vec3 vRingW;\nuniform float uRingR;\nuniform float uFadeIn;\n' +
            sh.fragmentShader.replace(
              // NOTE: anchored on opaque_fragment (end of main), NOT
              // clipping_planes_fragment — diffuseColor is only declared
              // mid-main, so an early inject would not compile.
              '#include <opaque_fragment>',
              '{ float rr = length(vRingW.xz); float fade = 1.0 - smoothstep(uRingR * uFadeIn, uRingR, rr); if (fade <= 0.004) discard; diffuseColor.a *= fade; }\n#include <opaque_fragment>',
            );
        };
        m.customProgramCacheKey = () => 'ring2-clipfade';
        m.needsUpdate = true;
      }
    });
    lastInfo = { ...c, waterCells, source: src, at: Date.now() };
    applyEmphasis(lastT);
    return lastInfo;
  }

  // Re-drape when the field lands on a better source (coarse -> live).
  // Slide smoothing: a redrape disposes + recreates every overlay mesh and
  // recompiles its shaders — a multi-frame hitch. While the mix/tilt feed is
  // still moving values (slider drag or orbit), re-arm the debounce instead
  // of rebuilding mid-gesture; the pending redrape lands once the view
  // settles (bounded by REDRAPE_MAX_DEFERS so a marathon drag can't pin a
  // stale drape forever). Direct rebuild() calls stay synchronous.
  let debounce = 0;
  let redrapeDefers = 0;
  let dead = false;
  const unsub = onStatus((s) => {
    if (s.stage === 'live' || s.stage === 'srtm') {
      clearTimeout(debounce);
      redrapeDefers = 0;
      const arm = () => {
        if (dead) return;
        debounce = setTimeout(() => {
          try {
            if (!dead && shouldDeferRedrape({ nowMs: Date.now(), lastSlideAt, defers: redrapeDefers })) {
              redrapeDefers++;
              arm();
              return;
            }
            if (dead) return;
            redrapeDefers = 0;
            rebuild();
          } catch { /* a failed re-drape never kills the loop */ }
        }, REDRAPE_DEBOUNCE_MS);
      };
      arm();
    }
  });

  let lastT = 0.5;
  /* Tilt response (RETIRED as a line fade 2026-10-12 — owner verdict: lines
   * stay, satellite yields). The old suspect-3 law hid draped linework over
   * the 60–65° band; now every mat is mix-only (tiltFade stamp false
   * everywhere, setTiltFade pins 1) and the steep-tilt response lives in
   * mix.js as the tilt takeover: twin ground in via setTakeover(u),
   * satellite out via setGroundFade(1-u). Survives rebuild (module scope,
   * re-applied with lastT); driven per frame by main.js via the mix
   * control's updateForCamera(pitch, rangeM). Pure law lives in sync.js
   * (tiltU).
   * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
  let lastTiltK = 1;
  function applyEmphasisFull() {
    for (const m of emphasisMats) {
      // Every mat is mix-only now (tiltFadeApplies is false for all kinds):
      // the tilt stamp below is dead weight kept for API compat, and pitch
      // can never dim a line again. GATE-3 ring-from-corners: while a flight
      // owns the ring, its stroke rides max(mix law, reveal) so the corner
      // converge stays continuous into the push.
      const base = m.userData.baseOpacity ?? m.opacity;
      const tEff = (m.userData.isHandoffRing && ringFlight) ? Math.max(lastT, lastRingP) : lastT;
      m.opacity = emphasisOpacity(base, tEff, m.userData.tiltFade ? lastTiltK : 1);
    }
  }
  function applyEmphasis(t) {
    const nt = Math.min(1, Math.max(0, t));
    if (nt !== lastT) lastSlideAt = Date.now();
    lastT = nt;
    applyEmphasisFull();
  }
  /* Neutered 2026-10-12 (owner verdict: lines stay, satellite yields): kept
   * exported + driven per frame by main.js for API compat, but pins the
   * multiplier at 1 — the steep-tilt response now lives in mix.js as the
   * tilt takeover (twin ground in, photo out), not a line fade. */
  function setTiltFade(_pitchDeg) {
    lastTiltK = 1;
    applyEmphasisFull();
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

  /* Split-phase frame (zoom catch-up fix): updateControls() settles the
   * damped orbit + CPU scene state WITHOUT painting; renderTwin() paints.
   * main.js runs controls -> map jumpTo -> render so the map receives the
   * fresh post-damping pose before EITHER side paints (same-frame parity).
   * update() stays as the both-phases shortcut for external callers. */
  function updateControls() {
    controls.update();
    /* Target-terrain snap (pan-drift fix): the twin must RENDER exactly the
     * pose the per-frame sync sends — getPose() reports target.y =
     * sampleH*VEX, so the orbit target is snapped to the same value here,
     * after damping settles and before main.js reads the pose / paints.
     * Without this the rendered ray (drifted controls.target.y) and the map
     * ray (snapped ty) disagree by the drift, growing with every pan at
     * oblique pitch. Per-frame delta is cm-scale (terrain slope × damped
     * step) and the snap is a fixed point at rest, so orbit feel is unchanged.
     * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
    try {
      controls.target.y = sampleH(controls.target.x, controls.target.z) * VEX;
    } catch { /* field not ready — pose falls back with target.y as-is */ }
    updatePills();
    // Rim tilt feed (pan-aware): pitch off the orbit target, azimuth off
    // the camera-to-target ground direction. uTiltT is 0 at nadir, so the
    // top-down fade is exactly the uniform band.
    try {
      const sh = rimFadeMat?.userData?.rimShader;
      if (sh?.uniforms?.uTiltT) {
        const dx = camera.position.x - controls.target.x;
        const dz = camera.position.z - controls.target.z;
        const dy = camera.position.y - (controls.target.y || 0);
        const h = Math.hypot(dx, dz);
        const tilt = 1 - Math.min(1, Math.max(0, dy / (Math.hypot(h, dy) || 1)));
        sh.uniforms.uTiltT.value = tilt;
        if (h > 1e-6) sh.uniforms.uCamDir.value.set(dx / h, dz / h);
      }
    } catch { /* rim drives on without us */ }
    const t = perfClock.getElapsedTime();
    const flare = group.getObjectByName('flare-tip');
    if (flare) {
      const s = 1 + 0.06 * Math.sin(t * 7.3) + 0.03 * Math.sin(t * 17.7);
      flare.scale.set(s, 1, 1);
    }
  }

  function renderTwin() {
    renderer.render(scene, camera);
  }

  function update() {
    updateControls();
    renderTwin();
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
    dead = true;
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
    rebuild, setEmphasis, setTiltFade, setTakeover, addEmphasisMats, update, updateControls, renderTwin,
    setToneGrade, setRingReveal,
    getPose, dispose, onResize,
    getInfo: () => ({ ...(lastInfo ?? {}), takeoverU: lastU, status: getStatus(), pills: getPillState() }),
  };
}
