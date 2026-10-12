// scripts/data-pipe/elev-common.mjs — shared AOI / tile-math / stats for Lane B.
// [plan:2026-10-12_175646-ops3d-geo-triangulation.md#phase-01] (Lane B)
//
// Site pin, AOI rect, source URLs, license table and small numeric helpers
// shared by elev-fetch.mjs and elev-compare.mjs. No network here.

export const SITE = Object.freeze({ lat: 40.201262, lon: 49.48127 });

// AOI rect shared with scripts/data-pipe/overpass.mjs AOI_BBOX.
export const AOI = Object.freeze({
  S: 40.111431, N: 40.291093, W: 49.363656, E: 49.598884,
});

// Render shoreline datum (overlays.js CASPIAN_SHORE_H) vs true Caspian datum.
export const SHORE_RENDER_M = -24;
export const CASPIAN_TRUE_M = -28;

// ---- No-credential mirrors (verified live 2026-10-12 via S3 ListBucket) ----
// Correct 1° key for the AOI (lon 49-50E). MISSING from the AWS mirror —
// the N40 band jumps E042 -> E051 (Caucasus/Caspian block E043-E050 absent
// from both GLO-30 and GLO-90 mirrors; HEAD probes 404). Recorded as gap
// evidence by elev-fetch.mjs, never fabricated.
export const COPERNICUS_TILE_KEY =
  'Copernicus_DSM_COG_10_N40_00_E049_00_DEM/Copernicus_DSM_COG_10_N40_00_E049_00_DEM.tif';
export const COPERNICUS_URL = `https://copernicus-dem-30m.s3.amazonaws.com/${COPERNICUS_TILE_KEY}`;
export const COPERNICUS_PAGES = Object.freeze({
  dataspace: 'https://dataspace.copernicus.eu/',
  collection: 'https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model',
  awsRegistry: 'https://registry.opendata.aws/copernicus-dem/',
  doi: 'https://doi.org/10.5270/ESA-c5d3d65',
});
// Copernicus-family leg that IS fetchable: Open-Meteo elevation API
// (provider docs: Copernicus DEM GLO-90 2021 release, 90 m, no key for
// non-commercial, ≤100 coords/request). Note: field.js labels this path
// "srtm" — provider docs say GLO-90; reported as openmeteo (GLO-90 family).
export const OPENMETEO_API = 'https://api.open-meteo.com/v1/elevation';
export const OPENMETEO_DOCS = 'https://open-meteo.com/en/docs/elevation-api';
export const SRTM_SKADI_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/skadi/N40/N40E049.hgt.gz';
export const TERRARIUM_TEMPLATE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TILE_Z = 12;

// Gated originals (investigate-only, never fetched here): exact files + pages
// are recorded in the manifest/report by elev-fetch.mjs.
export const GATED = Object.freeze([
  {
    what: 'Copernicus GLO-30 per-1° tiles + EGM geoid (Dataspace original)',
    page: 'https://dataspace.copernicus.eu/',
    gate: 'OAuth account required; AWS mirror used instead (no auth).',
  },
  {
    what: 'SRTM 1-arcsec void-filled original (SRTMGL1, N40E049)',
    page: 'https://earthexplorer.usgs.gov/',
    gate: 'USGS login required; AWS Skadi HGT mirror used instead (no auth).',
  },
]);

export const LICENSES = Object.freeze({
  terrarium:
    'Mapzen/Tilezen Terrarium (SRTM+ETOPO1+EUDEM blend, mixed sources) — stream tiles, never vendored; comparison stats are ours.',
  copernicus:
    'Copernicus DEM GLO-30 — free/open Copernicus terms, cite + date; comparison stats are ours.',
  srtm: 'SRTM-family HGT via AWS open-data mirror — USGS public domain; cite source.',
  openmeteo:
    'Copernicus DEM GLO-90 (2021) via Open-Meteo elevation API — free for non-commercial, attribute Copernicus programme + Open-Meteo (DOI 10.5270/ESA-c5d3d65).',
});

// Scratch + manifest locations (Lane B owns scratch only + these scripts).
export const SCRATCH_ENV = 'HERMES_SCRATCH';
export const SCRATCH_DEFAULT = '/Users/irfan/.hermes/cache/scratch';
export const ELEV_DIR_NAME = 'elev-triangulation';

export function scratchDir() {
  return `${process.env[SCRATCH_ENV] || SCRATCH_DEFAULT}/${ELEV_DIR_NAME}`;
}

// ---- Slippy-map tile math (same formulae as src/ring2/field.js) ----
const MERC = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI;
};

export function latLonToTile(lat, lon, z) {
  const n = 2 ** z;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor((((1 - MERC(lat)) / 2) * n)),
  };
}

export function tileToGeoBounds(x, y, z) {
  const n = 2 ** z;
  const inv = (m) =>
    (Math.atan(Math.exp(m * Math.PI)) * 2 - Math.PI / 2) * (180 / Math.PI);
  return {
    north: inv(1 - (2 * y) / n),
    south: inv(1 - (2 * (y + 1)) / n),
    west: (x / n) * 360 - 180,
    east: ((x + 1) / n) * 360 - 180,
  };
}

/** Tiles covering the AOI rect at zoom z (exact cover, not extent sample). */
export function tilesForAoi(z = TILE_Z, aoi = AOI) {
  const n = 2 ** z;
  const x0 = Math.floor(((aoi.W + 180) / 360) * n);
  const x1 = Math.floor(((aoi.E + 180) / 360) * n);
  const tN = latLonToTile(aoi.N, SITE.lon, z).y;
  const tS = latLonToTile(aoi.S, SITE.lon, z).y;
  const out = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = Math.min(tN, tS); y <= Math.max(tN, tS); y++) {
      out.push({ z, x, y });
    }
  }
  return out;
}

// ---- Control-point grids ----

/** Dense lat/lon grid over the AOI rect (rows north->south). */
export function denseGrid(steps = 41, aoi = AOI) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const lat = aoi.N - ((aoi.N - aoi.S) * i) / (steps - 1);
    for (let j = 0; j < steps; j++) {
      const lon = aoi.W + ((aoi.E - aoi.W) * j) / (steps - 1);
      pts.push({ lat, lon });
    }
  }
  return pts;
}

/** 72 far-rim points at R=10 km (matches sync.js parity-probe precedent). */
export function rimPoints(n = 72, radiusM = 10000) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const dx = radiusM * Math.cos(a);
    const dz = radiusM * Math.sin(a);
    const lat = SITE.lat - dz / 111195;
    const lon = SITE.lon + dx / (111195 * Math.cos((SITE.lat * Math.PI) / 180));
    pts.push({ lat, lon });
  }
  return pts;
}

/** East-west shoreline transect at site latitude (crosses the -24 m datum). */
export function shoreTransect(x0m = -5000, x1m = 10000, stepM = 250) {
  const pts = [];
  for (let x = x0m; x <= x1m; x += stepM) {
    const lon = SITE.lon + x / (111195 * Math.cos((SITE.lat * Math.PI) / 180));
    pts.push({ lat: SITE.lat, lon, x });
  }
  return pts;
}

// ---- Small stats ----

export function stats(values) {
  let n = 0;
  let mn = Infinity;
  let mx = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    n++;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
  }
  return { n, min: mn, max: mx, mean: sum / n, relief: mx - mn };
}

/** Paired error stats of candidate[] vs reference[] (same order). */
export function pairedErr(candidate, reference) {
  let n = 0;
  let bias = 0;
  let se = 0;
  let ae = 0;
  let maxAbs = 0;
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate[i];
    const r = reference[i];
    if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
    const d = c - r;
    n++;
    bias += d;
    se += d * d;
    ae += Math.abs(d);
    if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
  }
  return {
    n,
    bias: bias / n,
    rmse: Math.sqrt(se / n),
    mae: ae / n,
    maxAbs,
  };
}

export function pearson(a, b) {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    n++;
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch with retries (no credentials ever attached). */
export async function fetchRetry(url, { tries = 4, timeoutMs = 60000 } = {}) {
  let last;
  for (let a = 0; a < tries; a++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctl.signal }).finally(() =>
        clearTimeout(t),
      );
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (e) {
      last = e;
      await sleep(1500 * (a + 1));
    }
  }
  throw last;
}
