// scripts/data-pipe/clip.mjs — AOI clamp -> geoToWorld -> disc clip -> r0.1m.
//
// Algorithm mirrors scripts/process-osm.mjs (its clipToAOI /
// segmentCircleTs / clipPolylineToDisc); the math is re-implemented here
// instead of imported because process-osm.mjs runs its whole build as a
// module side effect (it rewrites public/data + docs/source-manifest.json on
// import — the manifest is single-writer owned by the parent lane). The
// projection truth stays imported: geoToWorld + RING_RADIUS_M from
// src/ring2/site.js. If the process-osm.mjs clip semantics ever change,
// port them here and note it in docs/data-pipeline.md.

import { geoToWorld, RING_RADIUS_M } from '../../src/ring2/site.js';
import { AOI_BBOX } from './overpass.mjs';
import { LAYER_ORDER } from './classify.mjs';

// Twin disc: the 10 km ring line minus a 150 m inset (same formula as
// process-osm.mjs DISC_R and vectors.js VECTORS_DISC_R).
export const DISC_R = RING_RADIUS_M - 150;
export const DISC_TOL = 0.11; // r0.1m rounding slack, same as process-osm.mjs
const AOI = AOI_BBOX;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function clipToAOI(lon, lat) {
  const cLon = clamp(lon, AOI.W, AOI.E);
  const cLat = clamp(lat, AOI.S, AOI.N);
  return [cLon, cLat, cLon !== lon || cLat !== lat];
}

export function segmentCircleTs(p0, p1, R = DISC_R) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const a = dx * dx + dy * dy;
  if (a === 0) return [];
  const b = 2 * (p0[0] * dx + p0[1] * dy);
  const c = p0[0] * p0[0] + p0[1] * p0[1] - R * R;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  if (disc === 0) {
    const t = -b / (2 * a);
    return t > 0 && t < 1 ? [t] : [];
  }
  const sq = Math.sqrt(disc);
  return [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]
    .filter((t) => t > 0 && t < 1).sort((x, y) => x - y);
}

const insideDisc = (p, R) => p[0] * p[0] + p[1] * p[1] <= R * R;
const lerpPt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function clipPolylineToDisc(pts, R = DISC_R) {
  const runs = [];
  let cur = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const in0 = insideDisc(p0, R);
    const in1 = insideDisc(p1, R);
    if (in0 && in1) {
      if (!cur.length) cur.push(p0);
      cur.push(p1);
    } else if (in0 && !in1) {
      const ts = segmentCircleTs(p0, p1, R);
      if (!cur.length) cur.push(p0);
      cur.push(lerpPt(p0, p1, ts[0] ?? 1));
      runs.push(cur);
      cur = [];
    } else if (!in0 && in1) {
      const ts = segmentCircleTs(p0, p1, R);
      cur = [lerpPt(p0, p1, ts[0] ?? 0), p1];
    } else {
      const ts = segmentCircleTs(p0, p1, R);
      if (ts.length === 2) runs.push([lerpPt(p0, p1, ts[0]), lerpPt(p0, p1, ts[1])]);
    }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Build the boot-schema asset {meta, layers} from classified ways.
 * Same output contract as process-osm.mjs so src/ring2/vectors.js boots it
 * unchanged: features {id, pts:[[x,z]..], c?}, meta counts + max_rr_m.
 */
export function buildAsset(classified, raw, { pipeline = 'scripts/data-pipe/run.mjs' } = {}) {
  const out = {};
  let elements = 0;
  let vertices = 0;
  let clippedFeatures = 0;
  // Source accounting is by UNIQUE way: context layers overlap the legacy
  // buckets by design (shared refs), so per-layer inputs would double-count.
  const srcIds = new Set();
  let srcVertices = 0;
  const layerSrc = {};
  let maxRR = 0;
  for (const layer of LAYER_ORDER) {
    out[layer] = [];
    layerSrc[layer] = classified.layers[layer].length;
    for (const el of classified.layers[layer]) {
      if (!srcIds.has(el.id)) {
        srcIds.add(el.id);
        srcVertices += el.geometry.length;
      }
      const world = [];
      let clipped = false;
      for (const p of el.geometry) {
        const [lon, lat, c] = clipToAOI(p.lon, p.lat);
        clipped ||= c;
        const { x, z } = geoToWorld(lat, lon);
        world.push([x, z]);
      }
      for (const run of clipPolylineToDisc(world)) {
        const f = { id: el.id, pts: run.map(([x, z]) => [r1(x), r1(z)]) };
        if (clipped) f.c = 1;
        out[layer].push(f);
      }
    }
  }
  for (const fs of Object.values(out)) {
    for (const f of fs) {
      elements += 1;
      vertices += f.pts.length;
      if (f.c) clippedFeatures += 1;
      for (const [x, z] of f.pts) {
        const rr = Math.hypot(x, z);
        if (rr > maxRR) maxRR = rr;
      }
    }
  }
  if (maxRR > DISC_R + DISC_TOL) {
    throw new Error(`DISC OVERFLOW: max rr ${maxRR.toFixed(2)} m > DISC_R ${DISC_R} + ${DISC_TOL}`);
  }
  // Unique-assignment accounting: a filtered/oos way that also joined a
  // context layer counts as assigned, never as dropped.
  const filteredOnly = classified.filtered.filter((f) => !srcIds.has(f.id)).length;
  const inputWays = (raw.elements ?? []).filter((e) => e?.type === 'way').length;
  const skippedWays = classified.skippedWays ?? 0;
  const oosOnly = inputWays - srcIds.size - filteredOnly - skippedWays;
  return {
    meta: {
      site: { lat: 40.201262, lon: 49.48127 },
      aoi: { ...AOI },
      disc_r_m: DISC_R,
      ring_r_m: RING_RADIUS_M,
      crs: 'EPSG:4326',
      units: 'metres (world: +x east, +z south of site pin)',
      precision_m: 0.1,
      elements,
      vertices,
      clippedFeatures,
      src_elements: srcIds.size,
      src_vertices: srcVertices,
      layer_src: layerSrc,
      max_rr_m: Math.round(maxRR * 10) / 10,
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
      pipeline,
      osm_base_timestamp: raw?.osm3s?.timestamp_osm_base ?? null,
      inputs: raw?.pipeInputs ?? null,
      filtered: classified.filtered.length,
      out_of_scope: classified.outOfScope,
      skipped_non_way: classified.skippedNonWay,
      accounting: {
        assigned_unique: srcIds.size, filtered_only: filteredOnly,
        oos_only: oosOnly, skipped_ways: skippedWays,
        skipped_non_way: classified.skippedNonWay, input_ways: inputWays,
      },
    },
    layers: out,
  };
}
