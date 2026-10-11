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

import { VEX } from './site.js';
import { sampleH } from './field.js';
import { DRAPE_LIFTS } from './drape.js';

export const VECTORS_URL = '/data/sangachal-vectors.json';

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
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.userData.flat = arr;
    g.userData.lift = lift(id);
    const m = new THREE.LineBasicMaterial({
      color: colors[id] ?? 0xffffff, transparent: true, opacity: 0.85,
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
