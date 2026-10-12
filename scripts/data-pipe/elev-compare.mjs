// scripts/data-pipe/elev-compare.mjs — Lane B triangulation: live Terrarium
// z12 field vs SRTM-family Skadi HGT vs Copernicus-family Open-Meteo (GLO-90).
// GLO-30 COG is absent from the AWS mirror for this AOI — recorded as a gap,
// never substituted.
// [plan:2026-10-12_175646-ops3d-geo-triangulation.md#phase-01] (Lane B)
//
// Reads scratch caches written by elev-fetch.mjs; writes elev-results.json +
// elev-report.md to the same scratch dir. Terrarium/Skadi sampled bilinear at
// native resolution (live twin uses bicubic on Terrarium — sub-metre delta at
// z12 texel density on this relief; stated, not hidden). Open-Meteo values are
// used verbatim at the queried control points.
// Usage: node scripts/data-pipe/elev-compare.mjs

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AOI, SITE, TILE_Z, SHORE_RENDER_M, CASPIAN_TRUE_M, LICENSES,
  COPERNICUS_TILE_KEY, COPERNICUS_PAGES,
  scratchDir, latLonToTile, denseGrid, rimPoints, shoreTransect,
  stats, pairedErr, pearson,
} from './elev-common.mjs';
import { decodeTerrariumPng } from '../../src/ring2/field.js';

const outDir = scratchDir();
const SOURCES = ['terrarium', 'srtm', 'openmeteo'];

function bilinear(grid, lat, lon) {
  const { north, west, resLat, resLon, rows, cols, data } = grid;
  const fy = (north - lat) / resLat;
  const fx = (lon - west) / resLon;
  if (fy < 0 || fy > rows - 1 || fx < 0 || fx > cols - 1) return NaN;
  const y0 = Math.min(rows - 2, Math.floor(fy));
  const x0 = Math.min(cols - 2, Math.floor(fx));
  const dy = Math.min(1, Math.max(0, fy - y0));
  const dx = Math.min(1, Math.max(0, fx - x0));
  const v = (yy, xx) => data[yy * cols + xx];
  const a = v(y0, x0);
  const b = v(y0, x0 + 1);
  const c = v(y0 + 1, x0);
  const d = v(y0 + 1, x0 + 1);
  for (const q of [a, b, c, d]) if (!Number.isFinite(q) || q <= -32000) return NaN;
  return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
}

async function loadTerrarium() {
  const dir = join(outDir, 'terrarium-z12');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.png'));
  const tiles = new Map();
  for (const f of files) {
    const [, x, y] = f.replace('.png', '').split('-').map(Number);
    const { size, data } = await decodeTerrariumPng(await readFile(join(dir, f)));
    tiles.set(`${x}/${y}`, { size, data: Float32Array.from(data) });
  }
  return {
    kind: 'terrarium',
    sample(lat, lon) {
      const t = latLonToTile(lat, lon, TILE_Z);
      const tile = tiles.get(`${t.x}/${t.y}`);
      if (!tile) return NaN;
      const n = 2 ** TILE_Z;
      // Fractional tile position -> pixel grid (same MERC as field.js).
      const merc = Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI;
      const xt = (((lon + 180) / 360) * n - t.x) * tile.size;
      const yt = (((1 - merc) / 2) * n - t.y) * tile.size;
      const s = tile.size;
      const x0 = Math.min(s - 2, Math.max(0, Math.floor(xt)));
      const y0 = Math.min(s - 2, Math.max(0, Math.floor(yt)));
      const dx = Math.min(1, Math.max(0, xt - x0));
      const dy = Math.min(1, Math.max(0, yt - y0));
      const d = tile.data;
      const a = d[y0 * s + x0];
      const b = d[y0 * s + x0 + 1];
      const c = d[(y0 + 1) * s + x0];
      const dd = d[(y0 + 1) * s + x0 + 1];
      return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + dd * dx * dy;
    },
    tiles: files.length,
  };
}

async function loadSkadi() {
  const bytes = await readFile(join(outDir, 'N40E049.hgt'));
  const side = Math.sqrt(bytes.length / 2);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data = new Float32Array(side * side);
  for (let i = 0; i < side * side; i++) {
    const v = dv.getInt16(i * 2, false);
    data[i] = v === -32768 ? NaN : v;
  }
  // HGT tile N40E049: rows north->south, lat 41..40, lon 49..50.
  const grid = { north: 41, west: 49, resLat: 1 / (side - 1), resLon: 1 / (side - 1), rows: side, cols: side, data };
  return { kind: 'srtm-skadi', side, sample: (lat, lon) => bilinear(grid, lat, lon) };
}

async function loadOpenMeteo() {
  const doc = JSON.parse(await readFile(join(outDir, 'openmeteo.json'), 'utf8'));
  const steps = doc.gridSteps;
  const data = Float32Array.from(doc.gridValues);
  const grid = {
    north: AOI.N, west: AOI.W,
    resLat: (AOI.N - AOI.S) / (steps - 1),
    resLon: (AOI.E - AOI.W) / (steps - 1),
    rows: steps, cols: steps, data,
  };
  // Extras (rim + transect) verbatim, keyed by set+index — no re-interpolation.
  const rimH = doc.extras.slice(0, 72).map((e) => e.h);
  const tranH = doc.extras.slice(72).map((e) => e.h);
  return {
    kind: 'openmeteo-glo90',
    dataset: doc.dataset,
    gridSample: (lat, lon) => bilinear(grid, lat, lon),
    rimAt: (i) => rimH[i],
    transectAt: (i) => tranH[i],
  };
}

async function loadGap() {
  try {
    return JSON.parse(await readFile(join(outDir, 'copernicus-gap.json'), 'utf8'));
  } catch {
    return null;
  }
}

const terr = await loadTerrarium();
const skadi = await loadSkadi();
const om = await loadOpenMeteo();
const gap = await loadGap();

const gridPts = denseGrid(41);
const rimPts = rimPoints(72, 10000);
const tranPts = shoreTransect(-5000, 10000, 250);

const sampled = {
  grid41: gridPts.map((p, i) => ({
    ...p,
    terrarium: terr.sample(p.lat, p.lon),
    srtm: skadi.sample(p.lat, p.lon),
    openmeteo: om.gridSample(p.lat, p.lon),
  })),
  rim72: rimPts.map((p, i) => ({
    ...p,
    terrarium: terr.sample(p.lat, p.lon),
    srtm: skadi.sample(p.lat, p.lon),
    openmeteo: om.rimAt(i),
  })),
  transect: tranPts.map((p, i) => ({
    ...p,
    terrarium: terr.sample(p.lat, p.lon),
    srtm: skadi.sample(p.lat, p.lon),
    openmeteo: om.transectAt(i),
  })),
};

const perSource = {};
for (const s of SOURCES) {
  perSource[s] = {
    grid41: stats(sampled.grid41.map((p) => p[s])),
    rim72: stats(sampled.rim72.map((p) => p[s])),
  };
}

// Pairwise agreement on the dense grid (Terrarium = live reference).
const gT = sampled.grid41.map((p) => p.terrarium);
const gS = sampled.grid41.map((p) => p.srtm);
const gO = sampled.grid41.map((p) => p.openmeteo);
const allIdx = [];
for (let i = 0; i < sampled.grid41.length; i++) {
  if ([gT[i], gS[i], gO[i]].every(Number.isFinite)) allIdx.push(i);
}
const pick = (a) => allIdx.map((i) => a[i]);
const agreement = {
  coverage: {
    n: sampled.grid41.length,
    allValid: allIdx.length,
    terrarium: gT.filter(Number.isFinite).length,
    srtm: gS.filter(Number.isFinite).length,
    openmeteo: gO.filter(Number.isFinite).length,
  },
  srtmVsTerrarium: { ...pairedErr(pick(gS), pick(gT)), r: pearson(pick(gS), pick(gT)) },
  openmeteoVsTerrarium: { ...pairedErr(pick(gO), pick(gT)), r: pearson(pick(gO), pick(gT)) },
  openmeteoVsSrtm: { ...pairedErr(pick(gO), pick(gS)), r: pearson(pick(gO), pick(gS)) },
  relief: {
    // Relief = max-min over the common-valid dense grid (definition, not lore).
    terrarium: stats(pick(gT)).relief,
    srtm: stats(pick(gS)).relief,
    openmeteo: stats(pick(gO)).relief,
  },
};
agreement.relief.srtmOverTerrarium = agreement.relief.srtm / agreement.relief.terrarium;
agreement.relief.openmeteoOverTerrarium =
  agreement.relief.openmeteo / agreement.relief.terrarium;

// Shoreline: sea/land call at the -24 m render datum + transect crossing.
function shoreStats(pts) {
  const sea = pts.filter((p) => Number.isFinite(p.terrarium) && p.terrarium < SHORE_RENDER_M);
  const land = pts.filter((p) => Number.isFinite(p.terrarium) && p.terrarium >= SHORE_RENDER_M);
  const agree = (arr, src, wantSea) => {
    const v = arr.filter((p) => Number.isFinite(p[src]));
    if (!v.length) return null;
    return v.filter((p) => (p[src] < SHORE_RENDER_M) === wantSea).length / v.length;
  };
  const deep = sea.filter((p) => p.terrarium < -26);
  return {
    nSeaRef: sea.length,
    nLandRef: land.length,
    srtmSeaAgree: agree(sea, 'srtm', true),
    srtmLandAgree: agree(land, 'srtm', false),
    openmeteoSeaAgree: agree(sea, 'openmeteo', true),
    openmeteoLandAgree: agree(land, 'openmeteo', false),
    // Mean water level over deep-sea points (ref < -26 m) vs true -28 m datum.
    deepSea: {
      n: deep.length,
      terrarium: stats(deep.map((p) => p.terrarium)).mean,
      srtm: stats(deep.map((p) => p.srtm)).mean,
      openmeteo: stats(deep.map((p) => p.openmeteo)).mean,
      datumTrueM: CASPIAN_TRUE_M,
    },
  };
}
const shoreline = shoreStats(sampled.grid41);

// Transect: where each source crosses -24 m heading east (first crossing x).
function crossing(src) {
  const tr = sampled.transect.filter((p) => Number.isFinite(p[src]));
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1][src];
    const b = tr[i][src];
    if (a >= SHORE_RENDER_M && b < SHORE_RENDER_M) {
      const f = (SHORE_RENDER_M - a) / (b - a);
      return tr[i - 1].x + f * (tr[i].x - tr[i - 1].x);
    }
  }
  return null;
}
shoreline.transectCrossingXm = {
  terrarium: crossing('terrarium'),
  srtm: crossing('srtm'),
  openmeteo: crossing('openmeteo'),
};

const results = {
  site: SITE,
  aoi: AOI,
  datum: { renderShoreM: SHORE_RENDER_M, trueCaspianM: CASPIAN_TRUE_M },
  caches: {
    terrariumTiles: terr.tiles,
    skadiSide: skadi.side,
    openmeteoDataset: om.dataset,
  },
  copernicusGlo30: gap ?? { missing: true, expectedKey: COPERNICUS_TILE_KEY, note: 'gap file not written (fetch step did not run)' },
  licenses: LICENSES,
  datumCaveat:
    'Skadi/SRTM ~EGM96, Copernicus-family (GLO-90/Open-Meteo, Terrarium blend components) mix EGM2008/EGM96 — expect ~1-3 m systematic offsets; sub-metre bias is not signal.',
  perSource,
  agreement,
  shoreline,
  comparedAt: new Date().toISOString(),
};
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'elev-results.json'), JSON.stringify(results, null, 2));

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'n/a');
const xm = (v) => (Number.isFinite(v) ? `${v.toFixed(0)} m` : 'n/a');
const r = results;
const md = `# Lane B — elevation triangulation (Sangachal AOI ${AOI.S}..${AOI.N}N ${AOI.W}..${AOI.E}E)

Compared ${r.comparedAt}. Reference = live Terrarium z12 field (bicubic in-twin;
bilinear here — sub-metre delta at z12 texel density, stated not hidden).
Datum caveat: ${r.datumCaveat}

## Per-source stats (dense 41x41 grid, common-valid n=${r.agreement.coverage.allValid})

| source | min | max | mean | relief | rim72 relief |
|---|---|---|---|---|---|
| terrarium (live, z12) | ${f(r.perSource.terrarium.grid41.min)} | ${f(r.perSource.terrarium.grid41.max)} | ${f(r.perSource.terrarium.grid41.mean)} | ${f(r.perSource.terrarium.grid41.relief)} | ${f(r.perSource.terrarium.rim72.relief)} |
| srtm (skadi HGT, 1-arcsec) | ${f(r.perSource.srtm.grid41.min)} | ${f(r.perSource.srtm.grid41.max)} | ${f(r.perSource.srtm.grid41.mean)} | ${f(r.perSource.srtm.grid41.relief)} | ${f(r.perSource.srtm.rim72.relief)} |
| openmeteo (GLO-90 family, 90 m) | ${f(r.perSource.openmeteo.grid41.min)} | ${f(r.perSource.openmeteo.grid41.max)} | ${f(r.perSource.openmeteo.grid41.mean)} | ${f(r.perSource.openmeteo.grid41.relief)} | ${f(r.perSource.openmeteo.rim72.relief)} |

Coverage: terrarium ${r.agreement.coverage.terrarium}/${r.agreement.coverage.n}, \
srtm ${r.agreement.coverage.srtm}/${r.agreement.coverage.n}, \
openmeteo ${r.agreement.coverage.openmeteo}/${r.agreement.coverage.n} (voids->NaN).

## Pairwise agreement vs live Terrarium (dense grid)

| pair | bias m | RMSE m | MAE m | max|d| m | r |
|---|---|---|---|---|---|
| srtm − terrarium | ${f(r.agreement.srtmVsTerrarium.bias, 2)} | ${f(r.agreement.srtmVsTerrarium.rmse, 2)} | ${f(r.agreement.srtmVsTerrarium.mae, 2)} | ${f(r.agreement.srtmVsTerrarium.maxAbs)} | ${f(r.agreement.srtmVsTerrarium.r, 4)} |
| openmeteo − terrarium | ${f(r.agreement.openmeteoVsTerrarium.bias, 2)} | ${f(r.agreement.openmeteoVsTerrarium.rmse, 2)} | ${f(r.agreement.openmeteoVsTerrarium.mae, 2)} | ${f(r.agreement.openmeteoVsTerrarium.maxAbs)} | ${f(r.agreement.openmeteoVsTerrarium.r, 4)} |
| openmeteo − srtm | ${f(r.agreement.openmeteoVsSrtm.bias, 2)} | ${f(r.agreement.openmeteoVsSrtm.rmse, 2)} | ${f(r.agreement.openmeteoVsSrtm.mae, 2)} | ${f(r.agreement.openmeteoVsSrtm.maxAbs)} | ${f(r.agreement.openmeteoVsSrtm.r, 4)} |

Relief (max−min, common-valid grid): terrarium ${f(r.agreement.relief.terrarium)} m, \
srtm ${f(r.agreement.relief.srtm)} m \
(ratio ${f(r.agreement.relief.srtmOverTerrarium, 3)}), \
openmeteo ${f(r.agreement.relief.openmeteo)} m \
(ratio ${f(r.agreement.relief.openmeteoOverTerrarium, 3)}).

## Shoreline (−24 m render datum; true Caspian −28 m)

Sea/land agreement vs Terrarium call: srtm sea ${pct(r.shoreline.srtmSeaAgree)} \
land ${pct(r.shoreline.srtmLandAgree)}; openmeteo sea ${pct(r.shoreline.openmeteoSeaAgree)} \
land ${pct(r.shoreline.openmeteoLandAgree)} (ref: ${r.shoreline.nSeaRef} sea / ${r.shoreline.nLandRef} land pts).
Deep-water mean (ref < −26 m, n=${r.shoreline.deepSea.n}): terrarium ${f(r.shoreline.deepSea.terrarium, 2)} m, \
srtm ${f(r.shoreline.deepSea.srtm, 2)} m, openmeteo ${f(r.shoreline.deepSea.openmeteo, 2)} m.
Transect −24 m crossing (site lat, m east of pin): terrarium ${xm(r.shoreline.transectCrossingXm.terrarium)}, \
srtm ${xm(r.shoreline.transectCrossingXm.srtm)}, openmeteo ${xm(r.shoreline.transectCrossingXm.openmeteo)}.

## Copernicus GLO-30 (missing from mirror — exact file + pages)

- Expected key: \`${r.copernicusGlo30.expectedKey ?? COPERNICUS_TILE_KEY}\`
- Mirror probe: HEAD ${r.copernicusGlo30.mirrorHeadStatus ?? 'n/a'}; \
${r.copernicusGlo30.neighbourEvidence ?? ''}
- Official pages: Dataspace ${COPERNICUS_PAGES.dataspace} · \
collection ${COPERNICUS_PAGES.collection} · \
AWS registry ${COPERNICUS_PAGES.awsRegistry} · DOI ${COPERNICUS_PAGES.doi}
- Standing substitute for the Copernicus leg: Open-Meteo GLO-90 above (same family, coarser).

## Verdict (default = report, not swap — DEM swap needs parent approval)

${verdict(r)}

## Licenses

- Terrarium: ${LICENSES.terrarium}
- Copernicus GLO-30: ${LICENSES.copernicus} (+ DOI ${COPERNICUS_PAGES.doi})
- SRTM: ${LICENSES.srtm}
- Open-Meteo: ${LICENSES.openmeteo}

## Gated / missing (named, never fabricated)

- Copernicus GLO-30 1° tile \`${COPERNICUS_TILE_KEY}\` — absent from AWS mirror; \
original at ${COPERNICUS_PAGES.dataspace} (OAuth account) / collection page above.
- SRTMGL1 void-filled original N40E049 — page https://earthexplorer.usgs.gov/ \
(USGS login; AWS Skadi HGT mirror used instead).
`;
await writeFile(join(outDir, 'elev-report.md'), md);
console.log(md);

function verdict(res) {
  const s = res.agreement.srtmVsTerrarium;
  const o = res.agreement.openmeteoVsTerrarium;
  const best = o.rmse <= s.rmse ? ['openmeteo (GLO-90)', o] : ['srtm (skadi)', s];
  return `Closest to live Terrarium: ${best[0]} at RMSE ${best[1].rmse.toFixed(2)} m ` +
    `(r=${best[1].r.toFixed(4)}; srtm RMSE ${s.rmse.toFixed(2)} m, openmeteo RMSE ${o.rmse.toFixed(2)} m). ` +
    'This measures AGREEMENT with the installed field, not superiority over it — ' +
    'there is no independent ground truth in this triangulation. No DEM swap: keep Terrarium live; ' +
    'file this report + manifest entry only.';
}
