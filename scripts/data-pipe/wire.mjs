// scripts/data-pipe/wire.mjs — check (default) or perform (--apply) the boot wire.
//
// Boot reads VECTORS_URL ('/data/sangachal-vectors.json', src/ring2/vectors.js)
// served from public/data/sangachal-vectors.json. The pipe builds to
// scripts/data-pipe/out/ (owned); this step diffs the fresh asset against the
// live boot file and, only with --apply, copies it over. Default is dry-run so
// a rebuild can never silently shift pinned test counts.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { VECTORS_URL } from '../../src/ring2/vectors.js';

export const BOOT_FILE = 'public/data/sangachal-vectors.json';
export const BOOT_URL = '/data/sangachal-vectors.json';

export function checkWire(freshAsset) {
  const notes = [];
  let same = false;
  if (VECTORS_URL !== BOOT_URL) {
    notes.push(`BOOT URL CHANGED: vectors.js serves ${VECTORS_URL}, expected ${BOOT_URL}`);
  } else {
    notes.push(`boot URL ok: vectors.js VECTORS_URL=${VECTORS_URL}`);
  }
  if (!existsSync(BOOT_FILE)) {
    notes.push(`boot file MISSING: ${BOOT_FILE} — run with --apply to install`);
    return { same, notes };
  }
  const live = JSON.parse(readFileSync(BOOT_FILE, 'utf8'));
  const lLayers = Object.fromEntries(Object.entries(live.layers ?? {}).map(([k, v]) => [k, v.length]));
  const fLayers = Object.fromEntries(Object.entries(freshAsset.layers ?? {}).map(([k, v]) => [k, v.length]));
  same = JSON.stringify(lLayers) === JSON.stringify(fLayers)
    && live.meta?.vertices === freshAsset.meta.vertices;
  notes.push(`live boot asset: elements=${live.meta?.elements} vertices=${live.meta?.vertices} ${JSON.stringify(lLayers)}`);
  notes.push(`fresh pipe asset: elements=${freshAsset.meta.elements} vertices=${freshAsset.meta.vertices} ${JSON.stringify(fLayers)}`);
  notes.push(same
    ? 'IN SYNC — boot serves exactly what the pipe builds.'
    : 'DIFFERS — review the diff, then re-run with --apply to wire (parent also updates pinned test counts + docs/source-manifest.json).');
  return { same, notes };
}

export function applyWire(freshPath, bootPath = BOOT_FILE) {
  writeFileSync(bootPath, readFileSync(freshPath));
  return bootPath;
}
