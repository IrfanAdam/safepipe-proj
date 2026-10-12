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
import { AOI_BBOX, FAR_BBOX } from './overpass.mjs';
import { LAYER_ORDER } from './classify.mjs';

// Twin disc: the 10 km ring line minus a 150 m inset (same formula as
// process-osm.mjs DISC_R and vectors.js VECTORS_DISC_R).
export const DISC_R = RING_RADIUS_M - 150;
export const DISC_TOL = 0.11; // r0.1m rounding slack, same as process-osm.mjs
// Far-context disc: regional arterials ride to the 25 km ring, faded
// (vectors.js farContextFadeAlpha). Same 0.11 m rounding slack.
export const FAR_R = 25000;
export const FAR_TOL = 0.11;
const AOI = AOI_BBOX;
const FAR_AOI = FAR_BBOX;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function clipToAOI(lon, lat, bbox = AOI) {
  const cLon = clamp(lon, bbox.W, bbox.E);
  const cLat = clamp(lat, bbox.S, bbox.N);
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
 *
 * opts.far / opts.rawFar carry the far sweep (classifyFar output + raw):
 * far_context clamps to FAR_BBOX and clips to the 25 km FAR_R disc while
 * the 12 main layers keep the AOI rect + twin-disc clip byte-identical.
 */
export function buildAsset(classified, raw, { pipeline = 'scripts/data-pipe/run.mjs', far = null, rawFar = null } = {}) {
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
  let maxFarRR = 0;
  const pushWay = (el, R, bbox) => {
    if (!srcIds.has(el.id)) {
      srcIds.add(el.id);
      srcVertices += el.geometry.length;
    }
    const world = [];
    let clipped = false;
    for (const p of el.geometry) {
      const [lon, lat, c] = clipToAOI(p.lon, p.lat, bbox);
      clipped ||= c;
      const { x, z } = geoToWorld(lat, lon);
      world.push([x, z]);
    }
    const feats = [];
    for (const run of clipPolylineToDisc(world, R)) {
      const f = { id: el.id, pts: run.map(([x, z]) => [r1(x), r1(z)]) };
      if (clipped) f.c = 1;
      feats.push(f);
    }
    return feats;
  };
  for (const layer of LAYER_ORDER) {
    if (layer === 'far_context') continue; // built from the far sweep below
    out[layer] = [];
    layerSrc[layer] = (classified.layers[layer] ?? []).length;
    for (const el of classified.layers[layer] ?? []) {
      for (const f of pushWay(el, DISC_R, AOI)) out[layer].push(f);
    }
  }
  // ---- far_context (classified-only, 25 km ring) ----
  out.far_context = [];
  const farEls = far?.layers?.far_context ?? [];
  layerSrc.far_context = farEls.length;
  for (const el of farEls) {
    for (const f of pushWay(el, FAR_R, FAR_AOI)) out.far_context.push(f);
  }
  for (const [id, fs] of Object.entries(out)) {
    for (const f of fs) {
      elements += 1;
      vertices += f.pts.length;
      if (f.c) clippedFeatures += 1;
      for (const [x, z] of f.pts) {
        const rr = Math.hypot(x, z);
        if (rr > maxRR) maxRR = rr;
        if (id === 'far_context' && rr > maxFarRR) maxFarRR = rr;
      }
    }
  }
  if (maxRR > FAR_R + FAR_TOL) {
    throw new Error(`FAR OVERFLOW: max rr ${maxRR.toFixed(2)} m > FAR_R ${FAR_R} + ${FAR_TOL}`);
  }
  // Main layers stay inside the twin disc; far_context alone may reach FAR_R.
  let maxMainRR = 0;
  for (const [id, fs] of Object.entries(out)) {
    if (id === 'far_context') continue;
    for (const f of fs) {
      for (const [x, z] of f.pts) {
        const rr = Math.hypot(x, z);
        if (rr > maxMainRR) maxMainRR = rr;
      }
    }
  }
  if (maxMainRR > DISC_R + DISC_TOL) {
    throw new Error(`DISC OVERFLOW: max rr ${maxMainRR.toFixed(2)} m > DISC_R ${DISC_R} + ${DISC_TOL}`);
  }
  // Unique-assignment accounting: a filtered/oos way that also joined a
  // context layer counts as assigned, never as dropped. Far-sweep ways
  // already present in the main sweep count as far_dups (assigned via the
  // main copy), never twice.
  const filteredOnly = classified.filtered.filter((f) => !srcIds.has(f.id)).length;
  const mainWays = (raw.elements ?? []).filter((e) => e?.type === 'way').length;
  const farWays = (rawFar?.elements ?? []).filter((e) => e?.type === 'way').length;
  const inputWays = mainWays + farWays;
  const farDups = far?.dups ?? 0;
  const skippedWays = (classified.skippedWays ?? 0) + (far?.skippedWays ?? 0);
  const skippedNonWay = (classified.skippedNonWay ?? 0) + (far?.skippedNonWay ?? 0);
  const oosOnly = inputWays - srcIds.size - filteredOnly - skippedWays - farDups;
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
      max_far_rr_m: Math.round(maxFarRR * 10) / 10,
      far_r_m: FAR_R,
      far_bbox: { ...FAR_AOI },
      far_src: layerSrc.far_context ?? 0,
      far_osm_base_timestamp: rawFar?.osm3s?.timestamp_osm_base ?? null,
      far_fetched: rawFar?.fetched_at ?? null,
      far_inputs: rawFar?.pipeInputs ?? null,
      far_out_of_scope: far?.outOfScope ?? {},
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
      pipeline,
      osm_base_timestamp: raw?.osm3s?.timestamp_osm_base ?? null,
      inputs: raw?.pipeInputs ?? null,
      filtered: classified.filtered.length,
      out_of_scope: classified.outOfScope,
      skipped_non_way: skippedNonWay,
      accounting: {
        assigned_unique: srcIds.size, filtered_only: filteredOnly,
        oos_only: oosOnly, skipped_ways: skippedWays, far_dups: farDups,
        skipped_non_way: skippedNonWay, input_ways: inputWays,
      },
    },
    layers: out,
  };
}
