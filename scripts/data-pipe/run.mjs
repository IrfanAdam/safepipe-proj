// scripts/data-pipe/run.mjs — single entry: fetch -> clip -> validate -> wire.
//
//   node scripts/data-pipe/run.mjs [--input FILE]... [--out DIR] [--apply] [--fetch-only]
//
// --input FILE  offline/cached mode: skip the Overpass fetch, read FILE
//               (e.g. public/data/osm-sangachal.json). Repeatable: elements
//               merge in order, first file wins on duplicate ids.
// --with-coastline-from FILE  if the inputs hold zero natural=coastline
//               ways (e.g. the 2026-10-12 board sweep omitted that
//               selector), pull coastline ways from FILE (dedup by id).
//               A live fetch needs no supplement — the pipe query includes
//               natural=coastline natively.
// --out DIR     pipe output dir (default scripts/data-pipe/out).
// --apply       install the fresh asset to the boot path (default: dry-run diff).
// --fetch-only  stop after fetching (writes the raw sweep, prints counts).
// On unreachable sources: exits 2 with the official download page + query,
// never invented data. Provenance: REPORTED on stdout (docs/source-manifest.json
// is single-writer owned by the parent lane — this pipe never touches it).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : null;
};
// Repeatable flags: --input A --input B ...
const args = (k) => {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === k && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
};
const flag = (k) => process.argv.includes(k);

async function main() {
  const outDir = arg('--out') ?? join(HERE, 'out');
  mkdirSync(outDir, { recursive: true });
  const rawPath = join(outDir, 'osm-sangachal.raw.json');
  const assetPath = join(outDir, 'sangachal-vectors.json');

  // ---- fetch ----
  let raw;
  let inputTotalWays = null;
  const inputs = args('--input');
  if (inputs.length) {
    // Offline merge: first file wins on duplicate ids (later files only
    // fill gaps, e.g. a coastline supplement sweep).
    const seen = new Set();
    const merged = [];
    const perFile = [];
    let firstOsm3s = null;
    for (const f of inputs) {
      const j = JSON.parse(readFileSync(f, 'utf8'));
      if (firstOsm3s === null) firstOsm3s = j.osm3s;
      let added = 0;
      for (const el of j.elements ?? []) {
        const key = `${el?.type}:${el?.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(el);
        added += 1;
      }
      perFile.push({ file: f, elements: (j.elements ?? []).length, added });
    }
    raw = { elements: merged, osm3s: firstOsm3s, pipeInputs: perFile };
    console.log(`inputs=${inputs.join(',')} (offline, fetch skipped)`);
    for (const p of perFile) console.log(`  ${p.file}: elements=${p.elements} added=${p.added}`);
    // Coastline supplement: only coastline ways, only when missing.
    if (arg('--with-coastline-from')) {
      const hasCoast = merged.some((e) => e?.type === 'way' && e?.tags?.natural === 'coastline');
      if (!hasCoast) {
        const sup = JSON.parse(readFileSync(arg('--with-coastline-from'), 'utf8'));
        let n = 0;
        for (const el of sup.elements ?? []) {
          if (el?.type !== 'way' || el?.tags?.natural !== 'coastline') continue;
          const key = `way:${el.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(el);
          n += 1;
        }
        raw.pipeInputs.push({ file: arg('--with-coastline-from'), elements: sup.elements?.length ?? 0, added: n, coastline_supplement: true });
        console.log(`coastline supplement: +${n} ways from ${arg('--with-coastline-from')}`);
      } else {
        console.log('coastline present in inputs, supplement skipped');
      }
    }
  } else {
    const { buildQuery, fetchOverpass, LoudFetchError } = await import('./overpass.mjs');
    const query = buildQuery();
    try {
      const { json, endpoint } = await fetchOverpass(query);
      raw = json;
      writeFileSync(rawPath, JSON.stringify(raw));
      console.log(`fetched via ${endpoint} -> ${rawPath}`);
    } catch (e) {
      if (e?.name === 'LoudFetchError') {
        console.error(e.message);
        console.error('\n--- Overpass QL (paste at https://overpass-turbo.eu/) ---');
        console.error(e.query ?? query);
      } else {
        console.error(`FETCH FAILED: ${e.message}`);
      }
      process.exit(2);
    }
  }
  const ways = (raw.elements ?? []).filter((e) => e?.type === 'way');
  inputTotalWays = raw.elements?.length ?? null;
  console.log(`raw: elements=${raw.elements?.length ?? 0} ways=${ways.length} osm_base=${raw.osm3s?.timestamp_osm_base ?? '?'}`);
  if (flag('--fetch-only')) return;

  // ---- classify + clip ----
  const { classify } = await import('./classify.mjs');
  const { buildAsset } = await import('./clip.mjs');
  const classified = classify(raw.elements);
  const perLayer = Object.fromEntries(
    Object.entries(classified.layers).map(([k, v]) => [k, v.length]),
  );
  console.log(`classified: ${JSON.stringify(perLayer)} filtered=${classified.filtered.length} skipped_non_way=${classified.skippedNonWay}`);
  const oosTotal = Object.values(classified.outOfScope).reduce((a, b) => a + b, 0);
  if (oosTotal) console.log(`out-of-scope (kept in raw, not boot vectors): ${JSON.stringify(classified.outOfScope)}`);
  const asset = buildAsset(classified, raw);
  writeFileSync(assetPath, JSON.stringify(asset));
  console.log(`asset: ${assetPath} elements=${asset.meta.elements} vertices=${asset.meta.vertices} clipped=${asset.meta.clippedFeatures} max_rr=${asset.meta.max_rr_m}`);

  // ---- validate ----
  const { validateAsset } = await import('./validate.mjs');
  const { errors, warnings, measured } = validateAsset(asset, { inputTotalWays });
  for (const w of warnings) console.log(`WARN  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`INVALID  ${e}`);
    process.exit(1);
  }
  console.log(`VALID  elements=${measured.elements} vertices=${measured.vertices} max_rr=${measured.maxRR}`);

  // ---- wire ----
  const { checkWire, applyWire } = await import('./wire.mjs');
  const { same, notes } = checkWire(asset);
  for (const n of notes) console.log(`WIRE  ${n}`);
  if (flag('--apply')) {
    if (same) console.log('WIRE  already in sync, nothing copied.');
    else {
      applyWire(assetPath);
      console.log('WIRE  installed fresh asset to public/data/sangachal-vectors.json');
    }
  }

  // ---- provenance (REPORT; parent writes docs/source-manifest.json) ----
  console.log([
    'PROVENANCE (for docs/source-manifest.json single-writer):',
    `  name=OpenStreetMap Sangachal AOI vectors (12 layers: roads/tracks/paths/coastline/terminal + arterials/streets/landuse/water/power/barriers/buildings)`,
    `  source=Overpass API (https://overpass-turbo.eu/, api overpass-api.de)`,
    `  query_bbox=S40.111431 N40.291093 W49.363656 E49.598884`,
    `  osm_base_timestamp=${asset.meta.osm_base_timestamp}`,
    `  license=Open Database License (ODbL) 1.0 — https://opendatacommons.org/licenses/odbl/`,
    `  attribution=© OpenStreetMap contributors`,
    `  counts=${JSON.stringify(perLayer)} total={elements:${asset.meta.elements},vertices:${asset.meta.vertices}}`,
  ].join('\n'));
}

main().catch((e) => {
  console.error(`PIPE FAILED: ${e.message}`);
  process.exit(1);
});
