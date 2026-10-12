// src/ring2/vectors.js — OSM vector overlay (Phase 01, Tasks 7+10).
//
// Renders the compact browser asset public/data/sangachal-vectors.json
// (built by scripts/process-osm.mjs from cached Overpass geometry) as
// draped twin polylines. Does NOT touch overlays.js (sibling lane owns it).
//
// Convention: asset points are world metres (+x east, +z south of the pin).
// Every vertex drapes at sampleH(x,z)*VEX + lift (drape.js), so vectors ride
// the same DEM as every other twin layer. Nothing here writes depth.
//
// Provenance per asset: 'osm' | 'parametric' | 'indicated' (spec §6 /
// plan Task 14). All twelve OSM layers are 'osm'; procedural or
// imagery-inferred layers register here when they land.
//
// PARENT-HANDOFF — exact call site (add to src/ring2/main.js boot(), after
// `twin = createOverlayTwin(...)`, twin exposes .scene):
//   import { mountVectorsFromData } from './vectors.js';
//   mountVectorsFromData(twin.scene).catch(() => {});
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]

import { VEX, RING_RADIUS_M } from './site.js';
import { sampleH } from './field.js';
import { DRAPE_LIFTS } from './drape.js';
import { TIER } from './facilities/dims.js';

export const VECTORS_URL = '/data/sangachal-vectors.json';

/*
 * Belt-and-braces rim fade: the asset is CPU-clipped to the twin disc at
 * build time (scripts/process-osm.mjs DISC_R), so no vertex should reach
 * this band — but a stale/unclipped asset still dissolves to transparent at
 * the ring line instead of spilling past it. Mirrors the DISC_R formula
 * (RING_RADIUS_M single source of truth, 150 m inset), never a literal.
 * far_context is the exception: it is clipped to the 25 km FAR_R ring and
 * dissolves there via farContextFadeAlpha, never vectorFadeAlpha.
 */
export const VECTORS_DISC_R = RING_RADIUS_M - 150;

/** Far-context ring: regional arterials ride out to 25 km, strongly faded. */
export const FAR_R = 25000;
/** Ceiling alpha for far_context: muted even at its brightest. */
export const FAR_MAX_ALPHA = 0.45;

/** Per-vertex alpha: 1 inside the disc, smoothstep to 0 at the ring line. */
export function vectorFadeAlpha(rr, discR = VECTORS_DISC_R, ringR = RING_RADIUS_M) {
  if (!(rr > discR)) return 1;
  if (rr >= ringR) return 0;
  const u = (rr - discR) / (ringR - discR);
  return 1 - u * u * (3 - 2 * u);
}

/**
 * Per-vertex alpha for far_context: flat FAR_MAX_ALPHA out to the 10 km
 * ring, then smoothstep to 0 at the 25 km FAR_R ring. The ceiling keeps
 * regional arterials an orientation backdrop — never focus-pullers.
 */
export function farContextFadeAlpha(rr, ringR = RING_RADIUS_M, farR = FAR_R) {
  if (!(rr > ringR)) return FAR_MAX_ALPHA;
  if (rr >= farR) return 0;
  const u = (rr - ringR) / (farR - ringR);
  return FAR_MAX_ALPHA * (1 - u * u * (3 - 2 * u));
}

/** Provenance tier per layer id. */
export const PROVENANCE = Object.freeze({
  roads: 'osm',
  tracks: 'osm',
  paths: 'osm',
  coastline: 'osm',
  terminal: 'osm',
  arterials: 'osm',
  streets: 'osm',
  landuse: 'osm',
  water: 'osm',
  power: 'osm',
  barriers: 'osm',
  buildings: 'osm',
  far_context: 'osm',
});

/** Drape lift (m, DRAPE_LIFTS key) per layer id. */
export const LAYER_LIFT = Object.freeze({
  roads: 'MAJOR',
  tracks: 'MINOR',
  paths: 'MINOR',
  coastline: 'WATER',
  terminal: 'MINOR',
  arterials: 'MAJOR',
  streets: 'MINOR',
  landuse: 'MINOR',
  water: 'WATER',
  power: 'MINOR',
  barriers: 'MINOR',
  buildings: 'MINOR',
  far_context: 'MINOR',
});

const LAYER_ORDER = [
  'roads', 'tracks', 'paths', 'coastline', 'terminal',
  'arterials', 'streets', 'landuse', 'water', 'power', 'barriers', 'buildings',
  'far_context',
];

/** Total vertex count across all layers of an asset object. */
export function countVertices(data) {
  let n = 0;
  for (const id of LAYER_ORDER) {
    for (const f of data?.layers?.[id] ?? []) n += f.pts.length;
  }
  return n;
}

/** Total feature count across all layers of an asset object. */
export function countFeatures(data) {
  let n = 0;
  for (const id of LAYER_ORDER) n += (data?.layers?.[id] ?? []).length;
  return n;
}

/** Fetch the compact vector asset. */
export async function loadVectors(url = VECTORS_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`loadVectors: ${res.status} ${url}`);
  return res.json();
}

/**
 * Mount draped OSM polylines into a live THREE scene.
 * three is imported lazily so node tests can use the pure helpers above.
 * Returns { group, redrape, materials } — call redrape() when sampleH goes
 * live; pass materials to the twin's addEmphasisMats() so mix dims them and
 * the last-resort 60–65° tilt band dissolves them (linework membership:
 * overlays stamps these 'vector'; ground/water fills must never enter that
 * registry).
 */
export async function mountVectors(scene, data, opts = {}) {
  const THREE = await import('three');
  const lift = (id) => DRAPE_LIFTS[LAYER_LIFT[id] ?? 'MINOR'] + (opts.lift ?? 0);
  const group = new THREE.Group();
  group.name = 'ring2-vectors';
  const colors = {
    roads: 0xd8dee6, tracks: 0x9fb2c8, paths: 0x7f8ea3,
    coastline: 0x4fb3ff, terminal: 0xffc46b,
    // Phase 02 Task 12 context layers: muted, never focus-pullers.
    // Vectors mount as LINES, so landuse/buildings render as footprint
    // outlines — correct at this stage. Arterials sit slightly brighter
    // than service roads; buildings are faint amber-grey outlines.
    arterials: 0xe2e8f0, streets: 0xa8b4c4, landuse: 0x8a9a7c,
    water: 0x5f93b8, power: 0x9a8fb0, barriers: 0xb08a7e,
    buildings: 0xa89880,
    // far_context: muted slate — dimmer than every main layer, and capped
    // at FAR_MAX_ALPHA vertex alpha on top (see farContextFadeAlpha).
    far_context: 0x6b7686,
  };
  const segs = [];
  const mats = [];
  const hexRgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  for (const id of LAYER_ORDER) {
    const arr = [];
    for (const f of data?.layers?.[id] ?? []) {
      const p = f.pts;
      for (let i = 0; i + 1 < p.length; i++) {
        arr.push(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);
      }
    }
    if (!arr.length) continue;
    const pos = new Float32Array((arr.length / 4) * 6);
    // RGBA vertex colors: layer RGB baked in, alpha dissolves across the
    // disc->ring band so even an unclipped asset can't spill past the ring
    // at full brightness. (three honors a 4-component color attribute as
    // per-vertex alpha; the build-time disc clip remains the real fix.)
    const col = new Float32Array((arr.length / 4) * 8);
    const [cr, cg, cb] = hexRgb(colors[id] ?? 0xffffff);
    // Rim fade is per lane: main layers dissolve at the 10 km ring line,
    // far_context dissolves across the 10–25 km band (never full-bright).
    const fadeFor = id === 'far_context' ? farContextFadeAlpha : vectorFadeAlpha;
    for (let s = 0; s < arr.length; s += 4) {
      const v = (s / 4) * 2;
      col[v * 4] = cr; col[v * 4 + 1] = cg; col[v * 4 + 2] = cb;
      col[v * 4 + 3] = fadeFor(Math.hypot(arr[s], arr[s + 1]));
      col[(v + 1) * 4] = cr; col[(v + 1) * 4 + 1] = cg; col[(v + 1) * 4 + 2] = cb;
      col[(v + 1) * 4 + 3] = fadeFor(Math.hypot(arr[s + 2], arr[s + 3]));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.userData.flat = arr;
    g.userData.lift = lift(id);
    const m = new THREE.LineBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.85,
      depthWrite: false,
    });
    // Base opacity stamp: the emphasis registry (overlays.addEmphasisMats)
    // captures this on registration; stamping at creation keeps the base
    // even if registration races a fade pass. Opacity still multiplies with
    // the per-vertex rim-fade alpha, never replaces it.
    m.userData.baseOpacity = m.opacity;
    mats.push(m);
    const lines = new THREE.LineSegments(g, m);
    lines.name = `vectors:${id}`;
    lines.userData.provenance = PROVENANCE[id] ?? 'indicated';
    lines.userData.tier = TIER.DERIVED; // REF GATE 2: OSM-sourced vectors are derived
    lines.renderOrder = -4;
    lines.frustumCulled = false;
    segs.push(lines);
    group.add(lines);
  }
  const drape = () => {
    for (const lines of segs) {
      const { flat, lift: lf } = lines.geometry.userData;
      const pos = lines.geometry.getAttribute('position');
      for (let s = 0; s < flat.length; s += 4) {
        const v = (s / 4) * 2;
        pos.array[v * 3] = flat[s];
        pos.array[v * 3 + 1] = sampleH(flat[s], flat[s + 1]) * VEX + lf;
        pos.array[v * 3 + 2] = flat[s + 1];
        pos.array[(v + 1) * 3] = flat[s + 2];
        pos.array[(v + 1) * 3 + 1] = sampleH(flat[s + 2], flat[s + 3]) * VEX + lf;
        pos.array[(v + 1) * 3 + 2] = flat[s + 3];
      }
      pos.needsUpdate = true;
    }
  };
  drape();
  scene.add(group);
  return { group, redrape: drape, materials: mats };
}

/** Fetch the asset from `url`, then mount. */
export async function mountVectorsFromData(scene, url = VECTORS_URL, opts) {
  return mountVectors(scene, await loadVectors(url), opts);
}
