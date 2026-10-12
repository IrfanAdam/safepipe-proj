// scripts/data-pipe/elev-fetch.mjs — Lane B fetch: Terrarium z12 AOI tiles,
// SRTM-family Skadi HGT tile, Copernicus GLO-30 COG AOI window (range reads).
// [plan:2026-10-12_175646-ops3d-geo-triangulation.md#phase-01] (Lane B)
//
// No credentials, no accounts: AWS open-data mirrors only. Gated originals
// (Dataspace OAuth, EarthExplorer login) are recorded in the manifest, never
// fetched. Usage: node scripts/data-pipe/elev-fetch.mjs [--offline]

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  AOI, SITE, TILE_Z, TERRARIUM_TEMPLATE, COPERNICUS_URL, COPERNICUS_TILE_KEY,
  COPERNICUS_PAGES, SRTM_SKADI_URL, OPENMETEO_API,
  GATED, LICENSES, scratchDir, tilesForAoi, fetchRetry,
  denseGrid, rimPoints, shoreTransect,
} from './elev-common.mjs';

const outDir = scratchDir();
const offline = process.argv.includes('--offline');

async function fetchTerrarium() {
  const tiles = tilesForAoi(TILE_Z);
  const dir = join(outDir, 'terrarium-z12');
  await mkdir(dir, { recursive: true });
  const got = [];
  const missing = [];
  await Promise.all(tiles.map(async (t) => {
    const name = `${t.z}-${t.x}-${t.y}.png`;
    const dest = join(dir, name);
    if (existsSync(dest) && (await readFile(dest)).length > 0) {
      got.push(name);
      return;
    }
    if (offline) {
      missing.push(name);
      return;
    }
    const url = TERRARIUM_TEMPLATE
      .replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
    try {
      const res = await fetchRetry(url);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('not a PNG');
      await writeFile(dest, bytes);
      got.push(name);
    } catch (e) {
      missing.push(`${name} (${e.message})`);
    }
  }));
  return { tiles: tiles.length, got: got.length, files: got.sort(), missing };
}

async function fetchSkadi() {
  const dest = join(outDir, 'N40E049.hgt.gz');
  const rawDest = join(outDir, 'N40E049.hgt');
  let bytes;
  if (existsSync(rawDest)) {
    bytes = await readFile(rawDest);
  } else {
    if (offline) throw new Error('skadi HGT missing and --offline set');
    const res = await fetchRetry(SRTM_SKADI_URL);
    const gz = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, gz);
    bytes = gunzipSync(gz);
    await writeFile(rawDest, bytes);
  }
  // Validate: 1-arcsec HGT = 3601x3601 int16 BE.
  const n = bytes.length / 2;
  const side = Math.sqrt(n);
  if (!Number.isInteger(side)) throw new Error(`skadi HGT bad size ${bytes.length}`);
  return { bytes: bytes.length, side, file: 'N40E049.hgt', gz: 'N40E049.hgt.gz' };
}

async function recordCopernicusGap() {
  // The AOI's GLO-30 key is absent from the no-credential AWS mirror
  // (N40 band jumps E042 -> E051; E043-E050 404 on both GLO-30 and GLO-90
  // mirrors, verified 2026-10-12). Record the gap with its official pages —
  // never substitute a neighbouring tile as if it covered the AOI.
  const dest = join(outDir, 'copernicus-gap.json');
  if (offline && existsSync(dest)) {
    return JSON.parse(await readFile(dest, 'utf8'));
  }
  let http = null;
  try {
    const res = await fetch(COPERNICUS_URL, { method: 'HEAD' });
    http = res.status;
  } catch (e) {
    http = `fetch-error: ${e.message}`;
  }
  const gap = {
    missing: http === 200 ? false : true,
    expectedKey: COPERNICUS_TILE_KEY,
    expectedUrl: COPERNICUS_URL,
    mirrorHeadStatus: http,
    neighbourEvidence:
      'N40 E040/E041/E042 present; E043-E050 404 (GLO-30 + GLO-90); E051-E059 present — Caucasus/Caspian block gap in AWS mirror.',
    officialPages: COPERNICUS_PAGES,
    recordedAt: new Date().toISOString(),
  };
  await writeFile(dest, JSON.stringify(gap, null, 2));
  return gap;
}

async function fetchOpenMeteo() {
  // Copernicus-family leg (GLO-90, 90 m) at the exact control points the
  // compare step uses: dense 41x41 AOI grid + 72 rim pts + shore transect.
  // API takes ≤100 coords/request; batches of 50 with a polite pause.
  const dest = join(outDir, 'openmeteo.json');
  const gridPts = denseGrid(41);
  const extraPts = [...rimPoints(72, 10000), ...shoreTransect(-5000, 10000, 250)];
  const all = [...gridPts, ...extraPts];
  if (offline && existsSync(dest)) {
    const cached = JSON.parse(await readFile(dest, 'utf8'));
    if (cached.gridValues?.length === gridPts.length) return { ...cached, fromCache: true };
  }
  const values = new Array(all.length).fill(null);
  const BATCH = 50; // gentle pacing: the API enforces a minutely quota
  for (let b = 0; b < all.length; b += BATCH) {
    const chunk = all.slice(b, b + BATCH);
    const url = `${OPENMETEO_API}?latitude=${chunk.map((p) => p.lat.toFixed(6)).join(',')}` +
      `&longitude=${chunk.map((p) => p.lon.toFixed(6)).join(',')}`;
    let res;
    try {
      res = await fetchRetry(url, { timeoutMs: 30000, tries: 6 });
    } catch (e) {
      throw new Error(`openmeteo batch @${b} failed: ${e.message.split(' for ')[0]}`);
    }
    const json = await res.json();
    if (!Array.isArray(json.elevation) || json.elevation.length !== chunk.length) {
      throw new Error(`openmeteo malformed batch @${b}: ${JSON.stringify(json).slice(0, 120)}`);
    }
    json.elevation.forEach((h, i) => { values[b + i] = h; });
    await new Promise((r) => setTimeout(r, 4000));
  }
  const doc = {
    dataset: 'Copernicus DEM GLO-90 2021 release via Open-Meteo elevation API (90 m)',
    n: all.length,
    gridSteps: 41,
    gridValues: values.slice(0, gridPts.length), // row-major, rows N->S (matches denseGrid)
    extras: extraPts.map((p, i) => ({ ...p, h: values[gridPts.length + i] })),
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(dest, JSON.stringify(doc));
  return { ...doc, gridValues: `(${doc.gridValues.length} cached)`, extras: doc.extras.length };
}

const results = { site: SITE, aoi: AOI, licenses: LICENSES, gated: GATED };
await mkdir(outDir, { recursive: true });
try {
  results.terrarium = { template: TERRARIUM_TEMPLATE, z: TILE_Z, ...(await fetchTerrarium()) };
} catch (e) {
  results.terrarium = { error: e.message };
}
try {
  results.skadi = { url: SRTM_SKADI_URL, ...(await fetchSkadi()) };
} catch (e) {
  results.skadi = { error: e.message };
}
try {
  results.copernicusGap = await recordCopernicusGap();
} catch (e) {
  results.copernicusGap = { url: COPERNICUS_URL, error: e.message };
}
try {
  const om = await fetchOpenMeteo();
  results.openmeteo = { api: OPENMETEO_API, n: om.n ?? om.extras, dataset: om.dataset, fromCache: om.fromCache ?? false };
} catch (e) {
  results.openmeteo = { api: OPENMETEO_API, error: e.message };
}
results.fetchedAt = new Date().toISOString();
await writeFile(join(outDir, 'elev-manifest.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ outDir, summary: {
  terrarium: results.terrarium?.got ?? results.terrarium?.error,
  skadi: results.skadi?.side ?? results.skadi?.error,
  copernicusGlo30: results.copernicusGap?.missing ? `MISSING (mirror HEAD ${results.copernicusGap?.mirrorHeadStatus})` : results.copernicusGap,
  openmeteo: results.openmeteo?.n ?? results.openmeteo?.error,
} }, null, 2));
