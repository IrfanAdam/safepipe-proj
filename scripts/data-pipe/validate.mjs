// scripts/data-pipe/validate.mjs — schema + counts + bounds gates for the pipe.
//
// Errors (exit 1): broken schema, disc overflow, meta/count mismatch, NaN.
// Warnings (exit 0): empty layer with a named cause — e.g. coastline is empty
// when the input sweep query omitted natural=coastline (the 2026-10-12 board
// sweep did); the live fetch query in overpass.mjs includes it, so a fresh
// fetch should clear the warning.

import { DISC_R, DISC_TOL } from './clip.mjs';
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
        if (Math.abs(pt[0]) > 20000 || Math.abs(pt[1]) > 20000) {
          errors.push(`layer ${id} id=${f.id}: vertex outside 20 km sanity box`);
          break;
        }
      }
    }
  }
  if (maxRR > DISC_R + DISC_TOL) {
    errors.push(`DISC OVERFLOW: max rr ${maxRR.toFixed(2)} > ${DISC_R} + ${DISC_TOL}`);
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
      const accounted = (meta.src_elements ?? 0) + (meta.filtered ?? 0)
        + Object.values(meta.out_of_scope ?? {}).reduce((a, b) => a + b, 0);
      // skipped_non_way covers relations + nodes + geometry-less entries.
      const accountedAll = accounted + (meta.skipped_non_way ?? 0);
      if (accountedAll !== inputTotalWays) {
        errors.push(`accounting gap: src ${meta.src_elements}+filtered ${meta.filtered}+oos+skipped != input ways ${inputTotalWays}`);
      }
    }
  }
  return { errors, warnings, measured: { elements, vertices, maxRR: Math.round(maxRR * 10) / 10 } };
}
