// scripts/data-pipe/validate.mjs — schema + counts + bounds gates for the pipe.
//
// Errors (exit 1): broken schema, disc overflow, meta/count mismatch, NaN.
// Warnings (exit 0): empty layer with a named cause — e.g. coastline is empty
// when the input sweep query omitted natural=coastline (the 2026-10-12 board
// sweep did; run.mjs --with-coastline-from supplements it). The live fetch
// query in overpass.mjs includes it, so a fresh fetch clears the warning.

import { DISC_R, DISC_TOL, FAR_R, FAR_TOL } from './clip.mjs';
import { LAYER_ORDER } from './classify.mjs';

export function validateAsset(asset, { inputTotalWays = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!asset || typeof asset !== 'object') return { errors: ['asset is not an object'], warnings };
  const { meta, layers } = asset;
  if (!meta || typeof meta !== 'object') errors.push('meta missing');
  if (!layers || typeof layers !== 'object') errors.push('layers missing');
  const keys = Object.keys(layers ?? {});
  if (JSON.stringify([...keys].sort()) !== JSON.stringify([...LAYER_ORDER].sort())) {
    errors.push(`layer keys [${keys}] != [${LAYER_ORDER}]`);
  }
  let elements = 0;
  let vertices = 0;
  let maxRR = 0;
  for (const id of LAYER_ORDER) {
    const fs = layers?.[id];
    if (!Array.isArray(fs)) { errors.push(`layer ${id} not an array`); continue; }
    // Bounds are per lane: the 12 main layers stay inside the twin disc;
    // far_context alone may reach the 25 km ring (clipped in clip.mjs).
    const isFar = id === 'far_context';
    const rrLimit = isFar ? FAR_R + FAR_TOL : DISC_R + DISC_TOL;
    const boxLimit = isFar ? 30000 : 20000;
    if (fs.length === 0) {
      warnings.push(
        `layer ${id} empty` +
        (id === 'coastline' ? ' (input sweep likely omitted natural=coastline — see overpass.mjs query)' : ''),
      );
    }
    for (const f of fs) {
      elements += 1;
      if (typeof f.id !== 'number' || !Array.isArray(f.pts) || f.pts.length < 2) {
        errors.push(`layer ${id}: bad feature id=${f?.id}`);
        continue;
      }
      for (const pt of f.pts) {
        if (!Array.isArray(pt) || pt.length !== 2 || !pt.every(Number.isFinite)) {
          errors.push(`layer ${id} id=${f.id}: non-finite vertex`);
          break;
        }
        vertices += 1;
        const rr = Math.hypot(pt[0], pt[1]);
        if (rr > maxRR) maxRR = rr;
        if (rr > rrLimit) {
          errors.push(`layer ${id} id=${f.id}: vertex rr ${rr.toFixed(1)} past ${rrLimit}`);
          break;
        }
        if (Math.abs(pt[0]) > boxLimit || Math.abs(pt[1]) > boxLimit) {
          errors.push(`layer ${id} id=${f.id}: vertex outside ${boxLimit / 1000} km sanity box`);
          break;
        }
      }
    }
  }
  if (maxRR > FAR_R + FAR_TOL) {
    errors.push(`FAR OVERFLOW: max rr ${maxRR.toFixed(2)} > ${FAR_R} + ${FAR_TOL}`);
  }
  if (elements === 0 || vertices === 0) errors.push('asset has no features/vertices');
  if (meta) {
    if (meta.elements !== elements) errors.push(`meta.elements ${meta.elements} != counted ${elements}`);
    if (meta.vertices !== vertices) errors.push(`meta.vertices ${meta.vertices} != counted ${vertices}`);
    if (meta.disc_r_m !== DISC_R) errors.push(`meta.disc_r_m ${meta.disc_r_m} != DISC_R ${DISC_R}`);
    if (Math.abs((meta.max_rr_m ?? -1) - Math.round(maxRR * 10) / 10) > 0.05) {
      errors.push(`meta.max_rr_m ${meta.max_rr_m} != measured ${maxRR.toFixed(1)}`);
    }
    if (inputTotalWays != null) {
      // Overlap-aware accounting: context layers share members with the
      // legacy buckets, so meta.accounting tracks UNIQUE assigned ways.
      const a = meta.accounting;
      if (!a || typeof a !== 'object') {
        errors.push('meta.accounting missing (unique-assignment ledger)');
      } else {
        const sum = (a.assigned_unique ?? 0) + (a.filtered_only ?? 0)
          + (a.oos_only ?? 0) + (a.skipped_ways ?? 0) + (a.far_dups ?? 0);
        if (sum !== a.input_ways) {
          errors.push(`accounting gap: assigned ${a.assigned_unique}+filtered_only ${a.filtered_only}+oos_only ${a.oos_only}+skipped_ways ${a.skipped_ways}+far_dups ${a.far_dups} != input ways ${a.input_ways}`);
        }
        const nonWays = inputTotalWays - a.input_ways;
        if ((a.skipped_non_way ?? 0) - (a.skipped_ways ?? 0) !== nonWays) {
          errors.push(`accounting gap: non-way skipped mismatch (input elements ${inputTotalWays} - input ways ${a.input_ways} != skipped non-ways)`);
        }
      }
    }
  }
  return { errors, warnings, measured: { elements, vertices, maxRR: Math.round(maxRR * 10) / 10 } };
}
