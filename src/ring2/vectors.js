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
// plan Task 14). All five OSM layers are 'osm'; procedural or
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

export const VECTORS_URL = '/data/sangachal-vectors.json';

/*
 * Belt-and-braces rim fade: the asset is CPU-clipped to the twin disc at
 * build time (scripts/process-osm.mjs DISC_R), so no vertex should reach
 * this band — but a stale/unclipped asset still dissolves to transparent at
 * the ring line instead of spilling past it. Mirrors the DISC_R formula
 * (RING_RADIUS_M single source of truth, 150 m inset), never a literal.
 */
export const VECTORS_DISC_R = RING_RADIUS_M - 150;

/** Per-vertex alpha: 1 inside the disc, smoothstep to 0 at the ring line. */
export function vectorFadeAlpha(rr, discR = VECTORS_DISC_R, ringR = RING_RADIUS_M) {
  if (!(rr > discR)) return 1;
  if (rr >= ringR) return 0;
  const u = (rr - discR) / (ringR - discR);
  return 1 - u * u * (3 - 2 * u);
}

/** Provenance tier per layer id. */
export const PROVENANCE = Object.freeze({
  roads: 'osm',
  tracks: 'osm',
  paths: 'osm',
  coastline: 'osm',
  terminal: 'osm',
});

/** Drape lift (m, DRAPE_LIFTS key) per layer id. */
export const LAYER_LIFT = Object.freeze({
  roads: 'MAJOR',
  tracks: 'MINOR',
  paths: 'MINOR',
  coastline: 'WATER',
  terminal: 'MINOR',
});

const LAYER_ORDER = ['roads', 'tracks', 'paths', 'coastline', 'terminal'];

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
 * Returns { group, redrape } — call redrape() when sampleH goes live.
 */
export async function mountVectors(scene, data, opts = {}) {
  const THREE = await import('three');
  const lift = (id) => DRAPE_LIFTS[LAYER_LIFT[id] ?? 'MINOR'] + (opts.lift ?? 0);
  const group = new THREE.Group();
  group.name = 'ring2-vectors';
  const colors = {
    roads: 0xd8dee6, tracks: 0x9fb2c8, paths: 0x7f8ea3,
    coastline: 0x4fb3ff, terminal: 0xffc46b,
  };
  const segs = [];
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
    for (let s = 0; s < arr.length; s += 4) {
      const v = (s / 4) * 2;
      col[v * 4] = cr; col[v * 4 + 1] = cg; col[v * 4 + 2] = cb;
      col[v * 4 + 3] = vectorFadeAlpha(Math.hypot(arr[s], arr[s + 1]));
      col[(v + 1) * 4] = cr; col[(v + 1) * 4 + 1] = cg; col[(v + 1) * 4 + 2] = cb;
      col[(v + 1) * 4 + 3] = vectorFadeAlpha(Math.hypot(arr[s + 2], arr[s + 3]));
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
    const lines = new THREE.LineSegments(g, m);
    lines.name = `vectors:${id}`;
    lines.userData.provenance = PROVENANCE[id] ?? 'indicated';
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
  return { group, redrape: drape };
}

/** Fetch the asset from `url`, then mount. */
export async function mountVectorsFromData(scene, url = VECTORS_URL, opts) {
  return mountVectors(scene, await loadVectors(url), opts);
}
