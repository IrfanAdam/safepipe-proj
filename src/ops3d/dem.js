/* Safepipe Ops 3D — src/ops3d/dem.js · real-terrain seam (Phase 1, Task 6).
 * SITE: Fort McMurray 57.03N -111.68W (SRTM GL1 tile N57W112, 30 m).
 * terrainSource: 'procedural' | 'dem' — procedural is the default and the
 * offline fallback; 'dem' only after a successful GeoTIFF decode.
 * loadDEM() never throws: fetch/parse failure → {terrainSource:'procedural'}.
 * levelsForRange(mn, mx, n) is the shared contour-level helper (Task 7):
 * symmetric power-spaced (exponent 1.35), strictly ascending, endpoints
 * within 2% of span of the extrema — same shaping terrain.js always used.
 *
 * Delivery layer (fidelity pass, API-compatible — no terrain.js edits):
 * - Staged progression: cache (ms) → coarse mosaic (<~2 s, decimated
 *   readRasters) → fine mosaic (native 30 m). Any decoded stage returns
 *   terrainSource 'dem' (meta.stage names the stage); procedural only when
 *   NOTHING decoded — no procedural-forever states on a reachable link.
 * - Parallelism: tiles decode concurrently (commit 53099eb); within a tile
 *   the window is split into strips read through independent TIFF handles
 *   so S3 ranges fly in parallel, stitched on arrival (single-read fallback).
 * - Seamless mosaic: the 57°N tile boundary is feather-blended over a ±2 px
 *   band (mosaicSample) — no edge steps where tiles abut.
 * - Zoom-appropriate detail: detailStepForRange(rangeKm) maps camera range
 *   to grid decimation (1 near → full 30 m, 2/4 far); meta carries
 *   nativeResM so the twin can refine with range.
 * - Loading signal: getDemStatus()/onDemStatus() snapshot bus + optional
 *   opts.onProgress(result) per stage for staged swap-in (twin-owned).
 * - Sources: AWS Terrarium PNG primary (resampled NRCan CDEM ~20 m at the
 *   site, CORS *, maxzoom 15) → SRTM GL1 (30 m) fine fallback → Copernicus
 *   GLO-30 COG LAST (no browser CORS — proxy/server use only). Terrarium
 *   stages z12 full-window first paint → z15 progressive near site center
 *   (z15 full-window ≈ 66×66 tiles — never fetched whole).
 * - Budgets: per-op caps plus a globalBudgetMs racing the whole pipeline
 *   (best-available stage wins on expiry, never a throw). The status bus
 *   lives on globalThis so Vite ?t= module forks share one signal.
 * [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 */

export const SITE = Object.freeze({
  name: 'Fort McMurray',
  lat: 57.03,
  lon: -111.68,
  tile: 'N57W112',
  extentKm: 44,
  valleyCutM: 130, // Athabasca W-wall cut ~115-150 m at the site — windowed DEM must show real relief or fallback wins
});

export const SANGACHAL = Object.freeze({ // [plan:2026-10-10_150100-ops3d-sangachal-twin.md#phase-1]
  name: 'Sangachal Terminal',
  lat: 40.20,
  lon: 49.48,
  extentKm: 20,
});

/* Pinned tiles: the 44 km site window straddles the 57°N parallel — north
 * tile N57W112 covers lat 57–58 (site center + north), south tile N56W112
 * covers lat 56–57 (site south). Single-tile decode smeared the whole
 * southern half from the edge row; the mosaic gives every site pixel a
 * real altitude. */
export const DEM_TILES = Object.freeze(['N57W112', 'N56W112']);
const demTileUrl = (t) => `https://opentopography.s3.sdsc.edu/raster/SRTM_GL1/SRTM_GL1_srtm/${t}.tif`;
// OpenTopography S3 public bucket, SRTM GL1 30 m. Range-fetched in-browser
// via geotiff.js (dynamic import so offline/bundled builds never break).
export const DEM_URL = demTileUrl('N57W112');

/* Native grid posting of the sources below (m/px at the equator). */
export const DEM_NATIVE_RES_M = 30;
/* Coarse first-paint budget + extent: the preview is a site-anchored
 * full-resolution crop (not a decimated full-window read — the source
 * tiles are stored tiled, so a decimated read downloads the same blocks
 * and saves nothing). The crop covers ±COARSE_EXTENT_PX/2 around the site
 * pixel (≈±18 km, the probes and the twin's initial view), costing ~1/3
 * of the fine mosaic's ranges. Budget is a cap, not a target — fast links
 * land in <2 s; the cap accommodates slow-link header handshakes. */
export const COARSE_BUDGET_MS = 6000;
export const COARSE_EXTENT_PX = 1200;
/* Global pipeline budget: caps the whole staged load (default 45 s). On
 * expiry loadDEM returns the best-available stage, never throws. */
export const GLOBAL_BUDGET_MS = 45000;
/* Terrarium staging budgets + fetch shape. Coarse is z12 full-window
 * (~9×9 PNGs ≈ the ~20 m effective resolution, no oversample waste); z13
 * full-window would be ~17×17 at ~1 s each — past any first-paint budget.
 * Center-out, deadline-bounded, holes fall through to the SRTM layer in
 * the same mosaic. z15 refines the site center only (full-window ≈ 66×66
 * — never fetched whole). Concurrency matches the browser's ~6-per-origin
 * connection cap; more just queues. */
export const TERRARIUM_BUDGET_MS = 20000;
export const TERRARIUM_CONCURRENCY = 6;
export const TERRARIUM_COARSE_ZOOM = 12;
export const TERRARIUM_COARSE_MAX_PX = 1100;
export const TERRARIUM_FINE_MAX_PX = 1200;
export const TERRARIUM_FINE_MAX_TILES = 48;
export const TERRARIUM_FINE_RADIUS_KM = 6;
/* Twin ground mesh spans ±22 km (terrain SIZE 44): the coarse Terrarium
 * footprint must cover the whole mesh, or the apron renders the procedural
 * fallback (or a clamped mosaic edge) as surveyed terrain — the edge-streak
 * mechanism. [plan:2026-10-10_150100-ops3d-sangachal-twin.md#phase-2] */
export const TWIN_MESH_EXTENT_KM = 44;
/* Site-scoped Terrarium stage cache key: two gallery tabs (or two sites)
 * must never share a stage entry — a foreign payload would clamp-sample
 * as finite "real" terrain. Pure. [plan:2026-10-10_150100-ops3d-sangachal-twin.md#phase-2] */
export function terrStageCacheKey(prefix, z, site = SITE) {
  const lat = Number(site?.lat), lon = Number(site?.lon);
  const c = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : SITE;
  return `${prefix}${z}-${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
}
/* Seam feather half-width each side of the 57°N tile edge (~2 px @30 m). */
export const SEAM_BLEND_DEG = 2 / 3600;
/* Delivery stages, in progression order (status bus + meta.stage). */
export const DEM_STAGES = Object.freeze(['idle', 'loading', 'coarse', 'fine', 'cache', 'procedural']);

/* Copernicus GLO-30 fallback (AWS Open Data COGs, 1° tiles named by SW
 * corner, range-fetch friendly). Attempted per tile only after the SRTM
 * primary fails, inside the same budget — never slows the happy path. */
export function copernicusTileUrl(name) {
  const m = /^([NS])(\d+)([EW])(\d+)$/.exec(name);
  if (!m) return null;
  const lat = `${m[1]}${String(Number(m[2])).padStart(2, '0')}_00`;
  const lon = `${m[3]}${String(Number(m[4])).padStart(3, '0')}_00`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_${lat}_${lon}_DEM/Copernicus_DSM_COG_10_${lat}_${lon}_DEM.tif`;
}
/* Candidate GeoTIFF sources per pinned tile, fastest-known first: SRTM GL1,
 * then Copernicus GLO-30 COG LAST (no browser CORS — keep for proxy/server
 * use only). Terrarium PNG always races ahead of both in loadDEM. */
export function demTileUrls(name) {
  return [demTileUrl(name), copernicusTileUrl(name)].filter(Boolean);
}

/* ---- Location parametrization (?site=<lat>,<lon>[,extentKm] / opts.site) ----
 * Default when absent: Fort McMurray 57.03,-111.68 (zero behavior change).
 * SRTM GL1 spans lat -60..60 — inputs outside that (or unparseable) fall
 * back to the default with a console note. Terrain extent stays 44 km
 * unless a valid extent (5..100 km) rides along as the optional third part
 * or on the opts.site object — Sangachal resolves 20 km this way.
 * [plan:2026-10-10_150100-ops3d-sangachal-twin.md#phase-1] */
export function parseSiteParam(raw) { // [plan:2026-10-10_150100-ops3d-sangachal-twin.md#phase-1]
  if (raw == null) return null;
  const parts = String(raw).split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2 && parts.length !== 3) return null;
  const lat = Number(parts[0]), lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!(lat >= -60 && lat <= 60 && lon >= -180 && lon <= 180)) return null;
  if (parts.length === 2) return { lat, lon };
  const extentKm = Number(parts[2]);
  if (!Number.isFinite(extentKm) || !(extentKm >= 5 && extentKm <= 100)) return null;
  return { lat, lon, extentKm };
}
/* Resolve the working site: explicit opts.site ({lat,lon[,extentKm]} or
 * "lat,lon[,extentKm]") wins, then the ?site= param value, then the
 * default pin. Extent rides along when valid (5..100 km), else 44.
 * Never throws. [plan:2026-10-10_150100-ops3d-sangachal-twin.md#phase-1] */
export function resolveSite(input = null, searchRaw = null) {
  const fallback = { lat: SITE.lat, lon: SITE.lon, extentKm: SITE.extentKm };
  const extentOf = (cand) => (cand && Number.isFinite(cand.extentKm)
    && cand.extentKm >= 5 && cand.extentKm <= 100 ? cand.extentKm : SITE.extentKm);
  const cand = typeof input === 'string' ? parseSiteParam(input) : input;
  if (cand && Number.isFinite(cand.lat) && Number.isFinite(cand.lon)
    && cand.lat >= -60 && cand.lat <= 60 && cand.lon >= -180 && cand.lon <= 180) {
    return { lat: cand.lat, lon: cand.lon, extentKm: extentOf(cand) };
  }
  const fromParam = parseSiteParam(searchRaw);
  if (fromParam) return { lat: fromParam.lat, lon: fromParam.lon, extentKm: extentOf(fromParam) };
  const dirty = input != null || (searchRaw != null && String(searchRaw).trim() !== '');
  if (dirty) {
    try {
      console.info(`[ops3d] site "${String(input ?? searchRaw)}" invalid (want lat,lon with lat -60..60, lon -180..180) — using default 57.03,-111.68`);
    } catch { /* ignore */ }
  }
  return fallback;
}
/* SRTM 1° tile name for a lon/lat (SW-corner N/S E/W convention, padded —
 * same key pattern Copernicus uses, so both sources derive from lat/lon). */
export function srtmTileName(lat, lon) {
  const la = Math.floor(lat), lo = Math.floor(lon);
  const ns = la >= 0 ? `N${String(la).padStart(2, '0')}` : `S${String(-la).padStart(2, '0')}`;
  const ew = lo >= 0 ? `E${String(lo).padStart(3, '0')}` : `W${String(-lo).padStart(3, '0')}`;
  return `${ns}${ew}`;
}
/* Pinned tiles for a site: every 1° latitude row the extent window crosses
 * (the 57°N mosaic case) in the site's own lon column — E/W edge slivers
 * stay edge-clamped as before. North-first. Fort McMurray →
 * ['N57W112','N56W112'], identical to DEM_TILES. */
export function srtmTileNames(lat, lon, extentKm = SITE.extentKm) {
  const halfLat = extentKm / 2 / 111.32;
  const rows = [];
  for (let k = Math.floor(lat - halfLat); k <= Math.floor(lat + halfLat); k++) rows.push(k);
  rows.sort((a, b) => b - a);
  const col = Math.floor(lon);
  return rows.map((r) => srtmTileName(r + 0.5, col + 0.5));
}

/* ---- Terrarium primary: pure tile math + decode (unit-tested) ----
 * AWS elevation-tiles-prod PNGs, CORS *, maxzoom 15 (z16 404s). At this
 * site the pixels are resampled NRCan CDEM (~20 m effective — beats SRTM /
 * Copernicus 30 m). Decode: elev = R*256+G+B/256-32768 (site px = 323.1 m,
 * consistent across zooms). Grid posting at the site: z13 ≈ 10.4 m/px,
 * z14 ≈ 5.2, z15 ≈ 2.6 (mercator meters, not effective resolution). */
export const TERRARIUM_TILE_PX = 256;
export const TERRARIUM_MAXZOOM = 15;
export const TERRARIUM_EFFECTIVE_RES_M = 20;
export function terrariumTileUrl(z, x, y) {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}
/* Standard WebMercator slippy tile for a lon/lat. Pure + unit-tested. */
export function latLonToTile(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const c = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latR = (c * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return { x, y };
}
/* Grid posting (mercator m/px) of a Terrarium zoom at a latitude. Pure. */
export function terrariumResM(z, lat = SITE.lat) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}
/* Terrarium decode: RGB → meters. Pure + unit-tested. */
export function terrariumDecodePixel(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}
/* RGBA clamp array (S×S×4) → Float64Array meters, row-major. Pure. */
export function terrariumElevationsFromRGBA(rgba, w = TERRARIUM_TILE_PX, h = TERRARIUM_TILE_PX) {
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = terrariumDecodePixel(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }
  return out;
}
/* Inclusive tile range covering the site window at a zoom. Pure. */
export function terrariumWindowTiles(z, site = SITE, extentKm = site.extentKm) {
  const halfLat = extentKm / 2 / 111.32;
  const halfLon = extentKm / 2 / (111.32 * Math.cos((site.lat * Math.PI) / 180));
  const nw = latLonToTile(site.lat + halfLat, site.lon - halfLon, z);
  const se = latLonToTile(site.lat - halfLat, site.lon + halfLon, z);
  const n = 2 ** z;
  const clamp = (v) => Math.max(0, Math.min(n - 1, v));
  return {
    z,
    x0: clamp(Math.min(nw.x, se.x)), x1: clamp(Math.max(nw.x, se.x)),
    y0: clamp(Math.min(nw.y, se.y)), y1: clamp(Math.max(nw.y, se.y)),
  };
}
export function terrariumTileCount(range) {
  return (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
}
/* Fractional unit-square latitude of a tile-row fraction (inverse mercator). */
function _tileFracToLat(f) {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * f))) * 180) / Math.PI;
}
/* lon/lat → tile + fractional pixel (px/py in [0,256)). Pure. */
export function lonLatToTilePixel(lon, lat, z) {
  const n = 2 ** z, S = TERRARIUM_TILE_PX;
  const fx = ((lon + 180) / 360) * n;
  const c = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latR = (c * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  return { x, y, px: (fx - x) * S, py: (fy - y) * S };
}
/* tile + pixel → lon/lat (inverse of above). Pure. */
export function tilePixelToLonLat(x, y, px, py, z) {
  const n = 2 ** z, S = TERRARIUM_TILE_PX;
  return {
    lon: (((x + px / S) / n) * 360) - 180,
    lat: _tileFracToLat((y + py / S) / n),
  };
}
/* Stitch landed Terrarium tiles (array of {x, y, grid:Float64Array 256²m})
 * into one equirectangular meter grid (decimated so max dim ≤ maxPx),
 * mosaic-sampler compatible. Missed tiles stay no-data so lower-priority
 * layers show through. Pure + unit-tested. Returns
 * {data, ww, hh, bbox, validFrac} or null. */
export function stitchTerrariumGrid(landed, z, maxPx = TERRARIUM_COARSE_MAX_PX) {
  if (!landed?.length) return null;
  const S = TERRARIUM_TILE_PX, n = 2 ** z;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const t of landed) {
    if (!(t?.grid && t.grid.length >= S * S)) continue;
    if (t.x < x0) x0 = t.x; if (t.x > x1) x1 = t.x;
    if (t.y < y0) y0 = t.y; if (t.y > y1) y1 = t.y;
  }
  if (!(x0 <= x1 && y0 <= y1)) return null;
  const fullW = (x1 - x0 + 1) * S, fullH = (y1 - y0 + 1) * S;
  const step = Math.max(1, Math.ceil(Math.max(fullW, fullH) / Math.max(1, maxPx)));
  const ww = Math.ceil(fullW / step), hh = Math.ceil(fullH / step);
  const lonLeft = ((x0 / n) * 360) - 180, lonRight = (((x1 + 1) / n) * 360) - 180;
  const latTop = _tileFracToLat(y0 / n), latBot = _tileFracToLat((y1 + 1) / n);
  const byKey = new Map();
  for (const t of landed) {
    if (t?.grid && t.grid.length >= S * S) byKey.set(`${t.x}/${t.y}`, t.grid);
  }
  const data = new Float64Array(ww * hh);
  let valid = 0;
  for (let j = 0; j < hh; j++) {
    const lat = latTop - (((j + 0.5) / hh) * (latTop - latBot));
    for (let i = 0; i < ww; i++) {
      const lon = lonLeft + (((i + 0.5) / ww) * (lonRight - lonLeft));
      const fp = lonLatToTilePixel(lon, lat, z);
      const g = byKey.get(`${fp.x}/${fp.y}`);
      let v = -32768;
      if (g) {
        const fx = Math.max(0, Math.min(S - 1.001, fp.px));
        const fy = Math.max(0, Math.min(S - 1.001, fp.py));
        const xa = Math.floor(fx), ya = Math.floor(fy);
        const tx = fx - xa, ty = fy - ya;
        const g00 = g[ya * S + xa], g10 = g[ya * S + xa + 1];
        const g01 = g[(ya + 1) * S + xa], g11 = g[(ya + 1) * S + xa + 1];
        v = (g00 * (1 - tx) + g10 * tx) * (1 - ty) + ((g01 * (1 - tx) + g11 * tx) * ty);
        valid++;
      }
      data[j * ww + i] = v;
    }
  }
  return { data, ww, hh, bbox: { lonLeft, lonRight, latTop, latBot }, validFrac: valid / (ww * hh) };
}

const LEVEL_EXP = 1.35;

/* n symmetric power-spaced levels across [mn, mx] (Task 7 helper). */
export function levelsForRange(mn, mx, n = 32) {
  const mid = (mn + mx) / 2;
  const half = (mx - mn) / 2;
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const u = 2 * t - 1;
    out.push(mid + Math.sign(u) * Math.pow(Math.abs(u), LEVEL_EXP) * half);
  }
  out[0] = mn; // pin extrema so the contour field spans the full DEM band
  out[n - 1] = mx;
  return out;
}

/* Geographic window: pixel rect of the raster covering the site extent.
 * Pure + unit-tested. origin = [lon,lat] of pixel (0,0) (top-left),
 * res = [dx,dy] degrees per pixel (dy is negative on north-up rasters).
 * Returns {left,top,right,bottom} clamped to the image, or null when the
 * site falls outside the raster. km→degrees via equirectangular scale at
 * the site latitude (good to <1% over a 44 km window). */
export function geoWindowForSite(origin, res, width, height, site = SITE) {
  const [ox, oy] = origin;
  const [dx, dy] = res;
  if (!(dx > 0) || !(dy < 0) || !(width > 0) || !(height > 0)) return null;
  const halfLat = site.extentKm / 2 / 111.32;
  const halfLon = site.extentKm / 2 / (111.32 * Math.cos((site.lat * Math.PI) / 180));
  const col = (lon) => (lon - ox) / dx;
  const row = (lat) => (lat - oy) / dy;
  const left = Math.max(0, Math.floor(col(site.lon - halfLon)));
  const right = Math.min(width, Math.ceil(col(site.lon + halfLon)));
  const top = Math.max(0, Math.floor(row(site.lat + halfLat)));
  const bottom = Math.min(height, Math.ceil(row(site.lat - halfLat)));
  if (right - left < 4 || bottom - top < 4) return null;
  return { left, top, right, bottom };
}

/* Bilinear sample of a row-major grid in pixel space. Pure + unit-tested.
 * Returns fallback when any corner is no-data. */
export function sampleGrid(data, strideW, w, h, gx, gz, noData, fallback) {
  const cx = Math.min(w - 1, Math.max(0, gx));
  const cz = Math.min(h - 1, Math.max(0, gz));
  const x0 = Math.floor(cx), z0 = Math.floor(cz);
  const x1 = Math.min(w - 1, x0 + 1), z1 = Math.min(h - 1, z0 + 1);
  const fx = cx - x0, fz = cz - z0;
  const v = (ix, iz) => {
    const val = data[iz * strideW + ix];
    return val === noData ? NaN : val / 1000; // m → km altitude
  };
  const a = v(x0, z0), b = v(x1, z0), c = v(x0, z1), d = v(x1, z1);
  if ([a, b, c, d].some(Number.isNaN)) return fallback;
  return a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz;
}

/* Box-average decimation of a raw-meter grid (coarse path + far views).
 * Pure + unit-tested. No-data pixels are excluded from the mean; a block
 * of pure no-data stays no-data. Returns {data, ww, hh}. */
export function downsampleGrid(data, ww, hh, step, noData = -32768) {
  step = Math.max(1, Math.floor(step));
  if (!(step > 1)) return { data, ww, hh };
  const nw = Math.ceil(ww / step), nh = Math.ceil(hh / step);
  const out = new Float64Array(nw * nh); // float: block means keep sub-meter precision
  for (let jz = 0; jz < nh; jz++) {
    for (let ix = 0; ix < nw; ix++) {
      let sum = 0, count = 0;
      for (let z = jz * step; z < Math.min(hh, (jz + 1) * step); z++) {
        for (let x = ix * step; x < Math.min(ww, (ix + 1) * step); x++) {
          const val = data[z * ww + x];
          if (val !== noData) { sum += val; count++; }
        }
      }
      out[jz * nw + ix] = count ? sum / count : noData;
    }
  }
  return { data: out, ww: nw, hh: nh };
}

/* Zoom-driven detail: camera range → grid decimation step. Near views get
 * the native 30 m grid (step 1); far views can render decimated grids
 * without visible loss. Pure + unit-tested. */
export function detailStepForRange(rangeKm) {
  if (!(rangeKm > 0)) return 1;
  if (rangeKm < 12) return 1; // site close-ups: full 30 m
  if (rangeKm < 30) return 2; // regional: 60 m effective
  return 4; // overview: 120 m effective
}

/* Sample one decoded tile at lon/lat. Coarse (decimated) payloads carry
 * sx/sy scale factors mapping full-res window pixels → stored pixels.
 * Crop-preview tiles (crop:true) are STRICT: outside their window they
 * return the fallback instead of smearing the clamped edge row — the
 * mosaic falls through to covering tiles or procedural. */
function _sampleTile(tile, lon, lat, fallback) {
  const sx = tile.sx > 0 ? tile.sx : 1;
  const sy = tile.sy > 0 ? tile.sy : 1;
  const gx = ((lon - tile.origin[0]) / tile.res[0] - tile.win.left) * sx;
  const gz = ((lat - tile.origin[1]) / tile.res[1] - tile.win.top) * sy;
  if (tile.crop && (gx < 0 || gz < 0 || gx > tile.ww - 1 || gz > tile.hh - 1)) return fallback;
  return sampleGrid(tile.data, tile.ww, tile.ww, tile.hh, gx, gz, tile.noData, fallback);
}

/* Seamless mosaic sample: tiles abutting at 57°N are feather-blended over
 * ±SEAM_BLEND_DEG so the boundary never shows an edge step. Outside the
 * band this is exactly one tile's bilinear sample. Strict (crop) tiles
 * that miss fall through to covering tiles, then to the fallback.
 * Pure + unit-tested. */
export function mosaicSample(decoded, lon, lat, fallback) {
  if (!decoded?.length) return fallback;
  const tol = SEAM_BLEND_DEG;
  let cands = decoded.filter((d) => lat <= d.latTop + tol && lat >= d.latBot - tol);
  if (!cands.length) cands = [decoded.find((d) => lat <= d.latTop && lat >= d.latBot) ?? decoded[0]];
  const got = [];
  for (const d of cands) {
    const v = _sampleTile(d, lon, lat, null);
    if (v != null && Number.isFinite(v)) got.push([d, v]);
  }
  if (!got.length) {
    // Strict-only coverage here: fall back to the owning full tile clamped
    // (same as the pre-crop behavior), else the procedural fallback.
    const owner = decoded.find((d) => !d.crop && lat <= d.latTop + tol && lat >= d.latBot - tol)
      ?? decoded.find((d) => !d.crop) ?? null;
    if (!owner) return fallback;
    const gx = (lon - owner.origin[0]) / owner.res[0] - owner.win.left;
    const gz = (lat - owner.origin[1]) / owner.res[1] - owner.win.top;
    return sampleGrid(owner.data, owner.ww, owner.ww, owner.hh, gx, gz, owner.noData, fallback);
  }
  if (got.length === 1) return got[0][1];
  const ordered = [...got].sort((a, b) => b[0].latTop - a[0].latTop);
  const [north, vn] = ordered[0];
  const [south, vs] = ordered[ordered.length - 1];
  const seam = (north.latBot + south.latTop) / 2;
  const w = Math.min(1, Math.max(0, (lat - (seam - tol)) / (2 * tol)));
  return vs * (1 - w) + vn * w;
}

/* Site-anchored coarse crop window: ±extentPx/2 full-res pixels around the
 * site pixel, clamped to the decoded window (min 8 px per side, else null).
 * Pure + unit-tested. */
export function coarseCropForSite(origin, res, win, extentPx = COARSE_EXTENT_PX, site = SITE) {
  const half = Math.max(8, extentPx) / 2;
  const scol = (site.lon - origin[0]) / res[0];
  const srow = (site.lat - origin[1]) / res[1];
  const left = Math.max(win.left, Math.floor(scol - half));
  const right = Math.min(win.right, Math.ceil(scol + half));
  const top = Math.max(win.top, Math.floor(srow - half));
  const bottom = Math.min(win.bottom, Math.ceil(srow + half));
  if (right - left < 8 || bottom - top < 8) return null;
  return { left, top, right, bottom };
}

/* Procedural sampler passthrough — lazy import avoids a terrain↔dem cycle. */
export async function sampleProcedural(x, z) {
  const { field } = await import('./terrain.js');
  return field(x, z);
}

/* Sync procedural probe used by tests (same field, no async). */
let _field = null;
export function sampleProceduralSync(x, z) {
  return _field ? _field(x, z) : 0;
}
export function _injectField(fn) {
  _field = fn;
}

/* Loading-state signal for the HUD (twin-owned UI subscribes; dem.js only
 * publishes — no terrain.js/hud/twin edits). Stages progress idle →
 * loading → coarse? → fine | cache | procedural.
 * Pinned to globalThis: Vite dev serves the page graph with an HMR ?t=
 * query, so a bare import instantiates a FORKED module copy with its own
 * listeners — the probe read 'idle' for 60 s while the twin's copy loaded.
 * One shared bus fixes it. */
const _bus = (globalThis.__safepipeDem ??= { status: null, listeners: new Set() });
if (!_bus.status) {
  _bus.status = Object.freeze({
    stage: 'idle', tilesTotal: DEM_TILES.length, tilesDone: 0,
    reliefKm: null, wallMs: null, fromCache: [], refined: false, updatedAt: 0,
  });
}
export function getDemStatus() {
  const s = _bus.status;
  return { ...s, fromCache: [...s.fromCache] };
}
export function onDemStatus(cb) {
  if (typeof cb === 'function') {
    _bus.listeners.add(cb);
    try { cb(getDemStatus()); } catch { /* listener-local */ }
  }
  return () => { _bus.listeners.delete(cb); };
}
function _emitStatus(patch) {
  _bus.status = Object.freeze({ ..._bus.status, ...patch, updatedAt: Date.now() });
  for (const cb of [..._bus.listeners]) {
    try { cb(getDemStatus()); } catch { /* listener-local */ }
  }
}

/* Decoded-tile cache (staged DEM swap-in): the 44 km mosaic costs ~50+
 * S3 range round-trips on a cold load (far past any first-paint window),
 * so decoded windows persist in IndexedDB (versioned key per tile) + a
 * session memory map. Repeat visits resolve from cache in ms with zero
 * network. Never throws; Node/test runtimes without indexedDB simply use
 * the memory map. Payloads are plain structured-cloneable structs
 * (typed-array grid + affine). Only native-resolution payloads are cached
 * (coarse stages are transient) — keys and version are unchanged. */
export const DEM_CACHE_VERSION = 1;
const _memTiles = new Map();
export function demCacheKey(name) {
  return `srtm-dem:v${DEM_CACHE_VERSION}:${name}`;
}
/* Session-memory seed/read — the unit-test seam (no network, no IDB). */
export function _cacheMemSeed(name, payload) {
  _memTiles.set(demCacheKey(name), payload);
}
export function _cacheMemClear() {
  _memTiles.clear();
}
function _idb() {
  try {
    return typeof indexedDB !== 'undefined' ? indexedDB : null;
  } catch {
    return null;
  }
}
let _dbPromise = null;
function _idbOpen() {
  const impl = _idb();
  if (!impl) return Promise.resolve(null);
  if (_dbPromise) return _dbPromise;
  const p = new Promise((resolve) => {
    try {
      const req = impl.open('safepipe-dem', 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore('tiles');
        } catch {
          /* store exists */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  // Cache the promise, but race it against a 900ms timeout so a slow
  // IndexedDB open (seen: 16s in Playwright cold profile) doesn't eat
  // the whole global pipeline budget. The timeout resolves to null and
  // callers fall back to network fetch — cache is a warm-path optimization.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 900));
  _dbPromise = Promise.race([p, timeout]).then((db) => {
    // If we timed out, keep the real promise around so a later warm
    // read can still use it, but don't block this load.
    if (!db) p.then((real) => { if (real) _dbPromise = Promise.resolve(real); }).catch(() => {});
    return db;
  });
  // Single shared connection: don't close per-read (close is per-load now).
  return _dbPromise;
}
async function _cacheRead(name) {
  const key = demCacheKey(name);
  const sane = (p) => p && p.data && p.ww * p.hh === p.data.length;
  if (_memTiles.has(key)) {
    const payload = _memTiles.get(key);
    if (sane(payload)) return { payload, fromCache: 'memory' };
    _memTiles.delete(key);
  }
  const db = await _idbOpen();
  if (!db) return { payload: null, fromCache: null };
  try {
    const payload = await new Promise((resolve) => {
      try {
        const tx = db.transaction('tiles', 'readonly');
        const rq = tx.objectStore('tiles').get(key);
        rq.onsuccess = () => resolve(rq.result ?? null);
        rq.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (payload && payload.data && payload.ww * payload.hh === payload.data.length) {
      _memTiles.set(key, payload);
      return { payload, fromCache: 'indexeddb' };
    }
    return { payload: null, fromCache: null };
  } catch {
    return { payload: null, fromCache: null };
  }
}
async function _cacheWrite(name, payload) {
  try {
    _memTiles.set(demCacheKey(name), payload);
  } catch {
    /* ignore */
  }
  const db = await _idbOpen();
  if (!db) return;
  try {
    await new Promise((resolve) => {
      try {
        const tx = db.transaction('tiles', 'readwrite');
        tx.objectStore('tiles').put(payload, demCacheKey(name));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    /* cache is best-effort */
  }
}

/* One promise gate: rejects after ms AND fires the fetch abort, so a hung
 * range stalls out even if the HTTP client ignores the signal. */
function _withBudget(promise, ms, label, ctl) {
  let to;
  const gate = new Promise((_, reject) => {
    to = setTimeout(() => {
      try {
        ctl?.abort();
      } catch {
        /* ignore */
      }
      reject(new Error(`${label} budget ${ms}ms exceeded`));
    }, ms);
  });
  return Promise.race([promise, gate]).finally(() => clearTimeout(to));
}

const _delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* Link a child controller to a parent signal (per-strip controllers: a
 * shared controller cross-cancels siblings on the first budget trip —
 * each strip gets its own). Returns an unlink fn. */
function _linkAbort(parent, child) {
  if (!parent) return () => {};
  if (parent.aborted) {
    try { child.abort(); } catch { /* ignore */ }
    return () => {};
  }
  const handler = () => { try { child.abort(); } catch { /* ignore */ } };
  try { parent.addEventListener('abort', handler, { once: true }); } catch { /* ignore */ }
  return () => { try { parent.removeEventListener('abort', handler); } catch { /* ignore */ } };
}

/* geotiff loader resolve (v3 ships fromUrl as a NAMED export; a default
 * export may exist but it is the GeoTIFF class, not the loader — prefer
 * whichever carries fromUrl; this bug once silently forced procedural
 * everywhere, even online). Imported lazily so cache-warm loads never pay
 * the ~300 KB parse. */
async function _geotiffMod() {
  const GeoTIFF = await import('geotiff').catch(() => null);
  const mod = GeoTIFF?.fromUrl ? GeoTIFF : GeoTIFF?.default;
  return mod?.fromUrl ? mod : null;
}

/* Open ONE TIFF handle per tile/stage: fromUrl takes the abort signal as its
 * 3rd arg (geotiff v3: fromUrl(url, options, signal) — the old code passed
 * {signal} inside options, which never reached the fetch), and getImage()
 * runs inside the same budget (an unbudgeted getImage once cost ~670 ms of
 * silent wall time). Returns {tiff, image, close}. */
async function _openTileImage(mod, url, budgetMs, signal, label) {
  const ctl = new AbortController();
  const unlink = _linkAbort(signal, ctl);
  try {
    const tiff = await _withBudget(mod.fromUrl(url, {}, ctl.signal), budgetMs, `fromUrl ${label}`, ctl);
    const image = await _withBudget(tiff.getImage(), budgetMs, `getImage ${label}`, ctl);
    return { tiff, image, close: unlink };
  } catch (e) {
    unlink();
    try { ctl.abort(); } catch { /* ignore */ }
    throw e;
  }
}

/* Concurrent strip reads through ONE image handle: the window is split into
 * horizontal strips read in parallel, each with its OWN AbortController,
 * then stitched. Throws when striping fails — the caller falls back to a
 * single-window read on the same handle. Returns { stitched } (raw rows). */
async function _readWindowStrips(image, win, budgetMs, strips, signal) {
  const winW = win.right - win.left, winH = win.bottom - win.top;
  const bounds = [];
  for (let s = 0; s < strips; s++) {
    const top = win.top + Math.floor((winH * s) / strips);
    const bottom = s === strips - 1 ? win.bottom : win.top + Math.floor((winH * (s + 1)) / strips);
    if (bottom > top) bounds.push([top, bottom]);
  }
  if (bounds.length < 2) throw new Error('window too small to stripe');
  const parts = await Promise.all(bounds.map(([top, bottom]) => {
    const ctl = new AbortController();
    const unlink = _linkAbort(signal, ctl);
    return _withBudget(
      image.readRasters({ window: [win.left, top, win.right, bottom], interleave: true }),
      budgetMs,
      `strip ${top}-${bottom}`,
      ctl,
    ).then((r) => ({ top, data: r?.data ?? r, rows: bottom - top })).finally(unlink);
  }));
  const sample = parts[0].data;
  const Ctor = sample?.constructor ?? Int16Array;
  const stitched = new Ctor(winW * winH);
  for (const p of parts) {
    if (!p.data || p.data.length < winW * p.rows) throw new Error('short strip');
    stitched.set(p.data.subarray ? p.data.subarray(0, winW * p.rows) : p.data.slice(0, winW * p.rows), (p.top - win.top) * winW);
  }
  return { stitched, Ctor };
}

/* Resolve one tile at full resolution: memory → IndexedDB → S3 range
 * fetch (strip-parallel, SRTM primary + Copernicus fallback). Returns a
 * decoded struct or null (per-tile miss degrades the mosaic, never kills
 * it). Cache is checked WITHOUT importing geotiff. */
async function _loadTile(mod, name, urls, timeoutMs, preHit = null, strips = 2, signal = null, site = SITE) {
  try {
    const hit = preHit ?? (await _cacheRead(name));
    if (hit.payload) return { ...hit.payload, name, _fromCache: hit.fromCache };
    if (!mod?.fromUrl) return null;
    const N_RES = 1 / 3600;
    let lastErr = null;
    for (const url of urls) {
      let opened = null;
      try {
        // One handle per tile: geometry probe + strip reads share it.
        opened = await _openTileImage(mod, url, timeoutMs, signal, name);
        const { image } = opened;
        const w = image.getWidth(), h = image.getHeight();
        const ox = image.getOrigin(), oy = image.getResolution();
        const origin = Array.isArray(ox) ? ox : [-112, name.startsWith('N56') ? 57 : 58];
        const res = Array.isArray(oy) ? oy : [N_RES, -N_RES];
        // Georeferenced window: only the 44 km site extent is decoded
        // (range request), pixels map via the image affine — never a
        // whole-tile squeeze onto the site.
        const win = geoWindowForSite(origin, res, w, h, site);
        if (!win) { lastErr = new Error('site outside raster'); continue; }
        let data, ww, hh, noData = -32768, latTop, latBot;
        const edges = () => {
          try { noData = image.getNoDataValue?.() ?? -32768; } catch { /* default */ }
          const [, dy] = res;
          latTop = origin[1] + win.top * dy; latBot = origin[1] + win.bottom * dy;
        };
        try {
          if (strips >= 2) {
            data = (await _readWindowStrips(image, win, timeoutMs, strips, signal)).stitched;
            ww = win.right - win.left; hh = win.bottom - win.top;
            edges();
          } else {
            throw new Error('striping disabled');
          }
        } catch {
          // Single-window fallback (same handle, one range stream).
          const ctl = new AbortController();
          const unlink = _linkAbort(signal, ctl);
          try {
            const rasters = await _withBudget(
              image.readRasters({ window: [win.left, win.top, win.right, win.bottom], interleave: true }),
              timeoutMs,
              `readRasters ${name}`,
              ctl,
            );
            data = rasters?.data ?? rasters;
          } finally {
            unlink();
          }
          ww = win.right - win.left; hh = win.bottom - win.top;
          edges();
        }
        if (!data || !ww || !hh || data.length < ww * hh) { lastErr = new Error('short raster'); continue; }
        const payload = {
          origin, res, win, data, ww, hh,
          noData, latTop, latBot,
          lonLeft: origin[0], dx: res[0], resM: DEM_NATIVE_RES_M, src: url,
        };
        await _cacheWrite(name, payload);
        return { ...payload, name, _fromCache: null };
      } catch (e) {
        lastErr = e;
        continue; // next source (SRTM → Copernicus), same budget
      } finally {
        try { opened?.close(); } catch { /* ignore */ }
      }
    }
    void lastErr;
    return null;
  } catch {
    return null;
  }
}

/* Resolve one tile's coarse preview: a site-anchored full-resolution crop
 * (~1/3 the fine ranges), strip-parallel, transient — never cached. A hard
 * deadline spans both phases (open + read share budgetMs). Returns a
 * decoded struct (crop:true, strict sampling) or null, noting the failure
 * reason in notes (surfaced as meta.coarseError). */
async function _loadTileCoarse(mod, name, url, budgetMs, extentPx, notes = null, strips = 2, signal = null, site = SITE) {
  const note = (m) => { try { notes?.push(`${name}:${m}`); } catch { /* ignore */ } };
  const deadline = Date.now() + Math.max(1, budgetMs);
  const remaining = () => deadline - Date.now();
  let opened = null;
  try {
    if (!mod?.fromUrl) { note('geotiff unavailable'); return null; }
    if (remaining() <= 0) { note('no budget'); return null; }
    const N_RES = 1 / 3600;
    // One handle for open + read (shared deadline across both phases).
    opened = await _openTileImage(mod, url, remaining(), signal, `coarse ${name}`);
    const { image } = opened;
    const w = image.getWidth(), h = image.getHeight();
    const ox = image.getOrigin(), oy = image.getResolution();
    const origin = Array.isArray(ox) ? ox : [-112, 58];
    const res = Array.isArray(oy) ? oy : [N_RES, -N_RES];
    const win = geoWindowForSite(origin, res, w, h, site);
    if (!win) { note('site outside raster'); return null; }
    const crop = coarseCropForSite(origin, res, win, extentPx, site);
    if (!crop) { note('crop degenerate'); return null; }
    if (remaining() <= 0) { note('open consumed budget'); return null; }
    const ww = crop.right - crop.left, hh = crop.bottom - crop.top;
    let data = null;
    try {
      if (strips >= 2) {
        data = (await _readWindowStrips(image, crop, remaining(), strips, signal)).stitched;
      } else {
        throw new Error('striping disabled');
      }
    } catch {
      if (remaining() <= 0) { note('strip phase consumed budget'); return null; }
      const ctl2 = new AbortController();
      const unlink2 = _linkAbort(signal, ctl2);
      try {
        const rasters = await _withBudget(
          image.readRasters({ window: [crop.left, crop.top, crop.right, crop.bottom], interleave: true }),
          remaining(),
          `coarse readRasters ${name}`,
          ctl2,
        );
        data = rasters?.data ?? rasters;
      } finally {
        unlink2();
      }
    }
    if (!data || data.length < ww * hh) { note('short raster'); return null; }
    const [, dy] = res;
    return {
      origin, res, win: crop, data, ww, hh, crop: true,
      noData: image.getNoDataValue?.() ?? -32768,
      latTop: origin[1] + crop.top * dy, latBot: origin[1] + crop.bottom * dy,
      lonLeft: origin[0], dx: res[0], resM: DEM_NATIVE_RES_M,
      name, _fromCache: null,
    };
  } catch (e) {
    note(e?.message ? String(e.message).slice(0, 120) : 'decode failed');
    return null;
  } finally {
    try { opened?.close(); } catch { /* ignore */ }
  }
}

/* Terrarium tile fetch seam: tests inject a synthetic RGBA supplier via
 * _injectTerrariumFetcher; browsers fetch + decode PNGs through
 * ImageBitmap/canvas getImageData (no geotiff.js). Node/test runtimes
 * without a 2d canvas fail per-tile (caught) → null stage, never a throw. */
let _terrariumFetcher = null;
export function _injectTerrariumFetcher(fn) {
  _terrariumFetcher = typeof fn === 'function' ? fn : null;
}

async function _defaultTerrariumRGBA(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`terrarium HTTP ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  try {
    const S = TERRARIUM_TILE_PX;
    let ctx = null;
    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      canvas.width = S; canvas.height = S;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    } else if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(S, S).getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) throw new Error('no canvas 2d (non-browser)');
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, S, S).data;
  } finally {
    try { bmp.close?.(); } catch { /* ignore */ }
  }
}

/* One Terrarium stage: center-out fetch (concurrency-capped, deadline-cut),
 * decode, stitch to an equirectangular meter grid the mosaic sampler reads
 * directly. Missed tiles stay no-data so lower-priority layers show
 * through. Returns a decoded struct or null. Stages cache under opts
 * cacheName (memory + IndexedDB, same store as the SRTM tiles — distinct
 * keys, so DEM_CACHE_VERSION is untouched). */
export async function loadTerrariumStage(z, opts = {}) {
  const center = opts.center ?? SITE;
  const extentKm = opts.extentKm ?? center.extentKm ?? SITE.extentKm;
  const maxPx = opts.maxPx ?? TERRARIUM_COARSE_MAX_PX;
  const budgetMs = opts.budgetMs ?? TERRARIUM_BUDGET_MS;
  const maxTiles = Math.max(1, Math.floor(opts.maxTiles ?? Infinity));
  const minTiles = Math.max(1, Math.floor(opts.minTiles ?? 1));
  const validFracMin = opts.validFracMin ?? 0.15;
  const signal = opts.signal ?? null;
  const fetchOne = _terrariumFetcher ?? _defaultTerrariumRGBA;
  const t0 = Date.now();
  const deadline = t0 + Math.max(1, budgetMs);
  const remaining = () => deadline - Date.now();
  try {
    if (!(z >= 0 && z <= TERRARIUM_MAXZOOM)) return null;
    const range = terrariumWindowTiles(z, center, extentKm);
    const cx = (range.x0 + range.x1) / 2, cy = (range.y0 + range.y1) / 2;
    const list = [];
    for (let x = range.x0; x <= range.x1; x++) {
      for (let y = range.y0; y <= range.y1; y++) list.push({ x, y, d: (x - cx) ** 2 + (y - cy) ** 2 });
    }
    list.sort((a, b) => a.d - b.d);
    const picked = list.slice(0, maxTiles);
    const landed = [];
    let cursor = 0;
    const workers = [];
    const n = Math.max(1, Math.min(TERRARIUM_CONCURRENCY, picked.length));
    for (let k = 0; k < n; k++) {
      workers.push((async () => {
        for (;;) {
          if (signal?.aborted || remaining() <= 0) return;
          const t = picked[cursor++];
          if (!t) return;
          const ctl = new AbortController();
          const unlink = _linkAbort(signal, ctl);
          const to = setTimeout(() => { try { ctl.abort(); } catch { /* ignore */ } }, Math.max(1, remaining()));
          try {
            const rgba = await fetchOne(terrariumTileUrl(z, t.x, t.y), ctl.signal);
            landed.push({ x: t.x, y: t.y, grid: terrariumElevationsFromRGBA(rgba, TERRARIUM_TILE_PX, TERRARIUM_TILE_PX) });
            try { opts.onTile?.(t); } catch { /* ignore */ }
          } catch { /* per-tile miss degrades, never kills */ }
          finally {
            clearTimeout(to);
            unlink();
          }
        }
      })());
    }
    await Promise.all(workers);
    if (landed.length < minTiles) return null;
    const st = stitchTerrariumGrid(landed, z, maxPx);
    if (!st || st.validFrac < validFracMin) return null;
    const { data, ww, hh, bbox } = st;
    const origin = [bbox.lonLeft, bbox.latTop];
    const res = [(bbox.lonRight - bbox.lonLeft) / ww, -(bbox.latTop - bbox.latBot) / hh];
    const payload = {
      origin, res, win: { left: 0, top: 0, right: ww, bottom: hh },
      data, ww, hh, noData: -32768, crop: true, // windowed crop: strict sampling, never edge-smear
      latTop: bbox.latTop, latBot: bbox.latBot,
      lonLeft: bbox.lonLeft, dx: res[0], resM: TERRARIUM_EFFECTIVE_RES_M,
      src: `terrarium-z${z}`, terrTiles: landed.length, terrTotal: picked.length,
      terrValidFrac: st.validFrac, terrElapsedMs: Date.now() - t0,
    };
    if (opts.cacheName) {
      try { await _cacheWrite(opts.cacheName, payload); } catch { /* best-effort */ }
    }
    return { ...payload, name: opts.cacheName ?? `terr-z${z}`, _fromCache: null };
  } catch {
    return null;
  }
}

/* Build the lon/lat sampler over decoded tiles (seam-feathered). */
function _mosaicSampler(decoded, site = SITE) {
  const lonScale = 111.32 * Math.cos((site.lat * Math.PI) / 180);
  return (px, pz) => {
    const lon = site.lon + px / lonScale;
    const lat = site.lat - pz / 111.32;
    return mosaicSample(decoded, lon, lat, sampleProceduralSync(px, pz));
  };
}

/* Layered sampler: first finite layer wins per query (Terrarium refine →
 * Terrarium coarse → SRTM mosaic → procedural). Each layer is a decoded
 * array, internally seam-feathered by mosaicSample. Lets a partial
 * high-res center refine a full-window coarse stage without resampling. */
function _layeredSampler(layers, site = SITE) {
  const lonScale = 111.32 * Math.cos((site.lat * Math.PI) / 180);
  return (px, pz) => {
    const lon = site.lon + px / lonScale;
    const lat = site.lat - pz / 111.32;
    for (const layer of layers) {
      if (!layer?.length) continue;
      const v = mosaicSample(layer, lon, lat, null);
      if (v != null && Number.isFinite(v)) return v;
    }
    return sampleProceduralSync(px, pz);
  };
}

/* Relief sanity gates (5-point probe over ±8 km must show real terrain —
 * guards against flat/wrong decodes, not valley depth). The 80 m bar was
 * calibrated on the noisier SRTM field (cold run: 103 m); Terrarium/CDEM is
 * smoother and cross-zoom consistent at ~38 m here (z12/z13/z15 agree,
 * center 323 m verified), so Terrarium-bearing mosaics use a 25 m bar. */
export const DEM_RELIEF_MIN_KM = 0.08;
export const TERRARIUM_RELIEF_MIN_KM = 0.025;
export function reliefPassesGate(reliefKm, hasTerrarium = false) {
  if (!(reliefKm > 0)) return false;
  return reliefKm > (hasTerrarium ? TERRARIUM_RELIEF_MIN_KM : DEM_RELIEF_MIN_KM);
}

/* Sanity: the windowed mosaic must show real Athabasca relief (~200 m+). */
function _relief(at) {
  const probe = [at(-8, 0), at(0, 0), at(8, 0), at(0, -8), at(0, 8)];
  return Math.max(...probe) - Math.min(...probe);
}

/* Load the pinned DEM tiles. Never throws — any failure → procedural seam.
 * Returns { terrainSource, sample(x,z)->km-altitude, meta }.
 * sample() closes over the decoded grids; bilinear per layer, first finite
 * layer wins (Terrarium refine → Terrarium coarse → SRTM → procedural).
 * Staged for the browser twin: first paint is always procedural; tiles
 * resolve cache-first (IndexedDB/memory, ms), then Terrarium PNGs race the
 * SRTM range fetch in PARALLEL (serial awaits doubled the wall clock),
 * each stage with a real budget (default 30 s fine; coarse first-paint
 * capped at COARSE_BUDGET_MS; Terrarium at TERRARIUM_BUDGET_MS) under a
 * globalBudgetMs racing the whole pipeline (best-available stage wins).
 * Progression (all terrainSource 'dem', meta.stage names the stage):
 *   cache → coarse → fine. meta.src names the winning source
 *   ('terrarium' | 'srtm' | 'mixed' | 'cache' | ...); meta.timings carries
 *   per-phase ms {cacheMs, geotiffMs, terrCoarseMs, coarseMs, fineMs};
 *   meta.coarseError carries per-tile first-paint failure notes. Status bus
 *   (getDemStatus/onDemStatus) mirrors the progression for the HUD signal.
 * twin.js contract (unchanged fields): sample, meta.reliefKm/tiles/
 *   fromCache/wallMs/stage/refined. To surface the new diagnostics in the
 *   twin's swap-in line, extend its console.info with meta.src,
 *   JSON.stringify(meta.timings) and meta.coarseError (dem.js logs the same
 *   line itself on every dem stage — see logStage). */
const _GLOBAL_EXPIRED = { expired: true };
export async function loadDEM(opts = {}) {
  const timeoutMs = opts.fetchTimeoutMs ?? 30000;
  const globalBudgetMs = opts.globalBudgetMs ?? GLOBAL_BUDGET_MS;
  const coarseBudgetMs = Math.min(opts.coarseBudgetMs ?? COARSE_BUDGET_MS, timeoutMs);
  const terrariumBudgetMs = Math.min(opts.terrariumBudgetMs ?? TERRARIUM_BUDGET_MS, timeoutMs);
  const coarseExtentPx = opts.coarseExtentPx ?? opts.coarseMaxPx ?? COARSE_EXTENT_PX;
  const strips = Math.max(1, Math.floor(opts.parallelStrips ?? 2));
  const skipCoarse = !!opts.skipCoarse;
  const skipTerrarium = !!opts.skipTerrarium || !!opts.url; // single-URL override = one-tile mosaic
  const terrCoarseZoom = Math.max(0, Math.min(TERRARIUM_MAXZOOM, opts.terrariumCoarseZoom ?? TERRARIUM_COARSE_ZOOM));
  const terrFineZoom = Math.max(0, Math.min(TERRARIUM_MAXZOOM, opts.terrariumFineZoom ?? TERRARIUM_MAXZOOM));
  const terrFineMaxTiles = Math.max(1, Math.floor(opts.terrariumFineMaxTiles ?? TERRARIUM_FINE_MAX_TILES));
  const terrFineRadiusKm = Math.max(1, opts.terrariumFineRadiusKm ?? TERRARIUM_FINE_RADIUS_KM);
  const onProgress = opts.onProgress ?? opts.onStage ?? null;
  const emit = (result) => {
    if (typeof onProgress === 'function') {
      try { onProgress(result); } catch { /* consumer-local */ }
    }
  };
  const sample = (x, z) => sampleProceduralSync(x, z);
  // Working site (?site= / opts.site, default Fort McMurray): tile names,
  // Terrarium center, and samplers all derive from it. Extent stays 44 km.
  const site = resolveSite(opts.site);
  // Single-URL override (tests): treat as a one-tile mosaic.
  const tiles = opts.url ? ['__override__'] : srtmTileNames(site.lat, site.lon, site.extentKm);
  const terrCoarseKey = terrStageCacheKey('terr-z', terrCoarseZoom, site);
  const tileUrls = (t) => (t === '__override__' ? [opts.url] : demTileUrls(t));
  const t0 = Date.now();
  const timings = {};
  const pipelineCtl = new AbortController();
  let best = null;
  _emitStatus({ stage: 'loading', tilesTotal: tiles.length, tilesDone: 0, reliefKm: null, wallMs: null, fromCache: [], refined: false });
  const procedural = (extraMeta) => {
    const wallMs = Date.now() - t0;
    _emitStatus({ stage: 'procedural', tilesDone: 0, wallMs, refined: false });
    return { terrainSource: 'procedural', sample, meta: { url: tileUrls(tiles[0])[0], stage: 'procedural', wallMs, timings: { ...timings }, coarseError: null, src: 'procedural', site: { lat: site.lat, lon: site.lon }, ...extraMeta } };
  };
  /* Dem-side swap-in log: mirrors the twin's line plus per-phase timings +
   * coarse notes (twin.js owns its own line — extend it per the contract
   * note above; this line keeps the diagnosis self-contained). */
  const logStage = (result) => {
    try {
      const m = result.meta;
      console.info(
        `[ops3d] DEM ${m.stage} swap-in: relief ${((m.reliefKm ?? 0) * 1000).toFixed(0)} m, ` +
        `tiles ${(m.tiles ?? []).join('+')}, ` +
        `cache ${(m.fromCache ?? []).join(',') || 'cold-fetch'}, ` +
        `wall ${((m.wallMs ?? 0) / 1000).toFixed(1)}s, src ${m.src ?? '?'}, ` +
        `timings ${JSON.stringify(m.timings ?? {})}` +
        (m.coarseError ? `, coarseError ${m.coarseError}` : ''),
      );
    } catch { /* logging never breaks the seam */ }
  };
  const coarseNotes = [];
  const pipeline = (async () => {
    try {
      // Cache first, geotiff import only on a miss: a warm repeat visit
      // resolves tiles from IndexedDB/memory with zero network and
      // without parsing the 300 KB decoder chunk. Terrarium stages share
      // the same store under distinct keys (DEM_CACHE_VERSION untouched).
      const tCache = Date.now();
      const preHits = await Promise.all(tiles.map((t) => _cacheRead(t)));
      const terrFineKey = terrStageCacheKey('terr-f', terrFineZoom, site);
      const terrCachedHits = skipTerrarium ? [] : await Promise.all(
        [terrCoarseKey, terrFineKey].map((k) => _cacheRead(k).catch(() => ({ payload: null, fromCache: null }))),
      );
      timings.cacheMs = Date.now() - tCache;
      const missing = tiles.filter((_, i) => !preHits[i].payload);
      const cached = tiles.map((t, i) => (preHits[i].payload ? { ...preHits[i].payload, name: t, _fromCache: preHits[i].fromCache } : null)).filter(Boolean);
      const terrCached = terrCachedHits
        .map((h, k) => (h.payload ? { ...h.payload, name: k === 0 ? terrCoarseKey : terrFineKey, _fromCache: h.fromCache } : null))
        .filter(Boolean);
      if (!missing.length) {
        // Warm path: everything from cache, one 'cache' stage.
        const layers = [...(terrCached.length ? [terrCached] : []), ...(cached.length ? [cached] : [])];
        if (!layers.length) throw new Error('cache empty');
        const at = _layeredSampler(layers, site);
        const relief = _relief(at);
        if (!reliefPassesGate(relief, terrCached.length > 0)) throw new Error(`tile flat? relief ${relief.toFixed(3)} km`);
        const fromCache = [...terrCached, ...cached].filter((d) => d._fromCache).map((d) => `${d.name}:${d._fromCache}`);
        const result = {
          terrainSource: 'dem', sample: at,
          meta: {
            url: tileUrls(tiles[0])[0], reliefKm: relief,
            tiles: [...terrCached, ...cached].map((d) => d.name),
            fromCache, wallMs: Date.now() - t0, stage: 'cache', refined: true,
            nativeResM: terrCached.length ? TERRARIUM_EFFECTIVE_RES_M : DEM_NATIVE_RES_M,
            gridStepM: terrCached.length ? TERRARIUM_EFFECTIVE_RES_M : DEM_NATIVE_RES_M,
            src: terrCached.length ? 'mixed-cache' : 'cache',
            site: { lat: site.lat, lon: site.lon },
            coarseError: null, timings: { ...timings },
          },
        };
        _emitStatus({ stage: 'cache', tilesDone: tiles.length, reliefKm: relief, wallMs: result.meta.wallMs, fromCache, refined: true });
        emit(result);
        logStage(result);
        return result;
      }
      // Overlap: the Terrarium first paint and the decoder import fly
      // together; fine SRTM ranges start BEFORE coarse resolves (the old
      // code awaited the stages serially).
      const tGeo = Date.now();
      const terrCoarseP = skipTerrarium
        ? Promise.resolve(null)
        : loadTerrariumStage(terrCoarseZoom, {
          // Mesh-covering footprint: a small-extent site must still resolve
          // real terrain to the mesh rim (see TWIN_MESH_EXTENT_KM); maxTiles
          // fits the 44 km z12 window at every latitude (FM spans 81).
          center: site, extentKm: Math.max(site.extentKm, TWIN_MESH_EXTENT_KM), maxPx: TERRARIUM_COARSE_MAX_PX,
          maxTiles: 96,
          budgetMs: terrariumBudgetMs, cacheName: terrCoarseKey, signal: pipelineCtl.signal,
        });
      const mod = await _geotiffMod();
      timings.geotiffMs = Date.now() - tGeo;
      // Parallel: the two straddling tiles are independent — sequential
      // await doubled a latency-bound load (each needs dozens of S3 ranges).
      const byName = new Map(cached.map((d) => [d.name, d]));
      const fineP = mod?.fromUrl
        ? Promise.all(tiles.map((t, i) => {
          if (preHits[i].payload) return Promise.resolve(byName.get(t));
          return _loadTile(mod, t, tileUrls(t), timeoutMs, preHits[i], strips, pipelineCtl.signal, site)
            .then((d) => d ?? byName.get(t) ?? null);
        }))
        : Promise.resolve(tiles.map((t) => byName.get(t) ?? null));
      // Stage 1 — coarse first paint: Terrarium z13 (deadline-cut,
      // center-out) layered over SRTM site-anchored crops. Tiles already
      // in cache join at full res; missing tiles race coarse.
      const tCoarse = Date.now();
      const [terrCoarse, srtmCoarseSettled] = await Promise.all([
        terrCoarseP.then((d) => { timings.terrCoarseMs = Date.now() - tCoarse; return d; }),
        (!skipCoarse && coarseBudgetMs > 0 && mod?.fromUrl)
          ? Promise.all(missing.map((t) => _loadTileCoarse(mod, t, tileUrls(t)[0], coarseBudgetMs, coarseExtentPx, coarseNotes, strips, pipelineCtl.signal, site)))
          : Promise.resolve(missing.map(() => null)),
      ]);
      timings.coarseMs = Date.now() - tCoarse;
      if (!terrCoarse && !skipTerrarium) coarseNotes.push(`${terrCoarseKey}:no coverage`);
      const terrLayers = [];
      if (terrCoarse) terrLayers.push(terrCoarse);
      for (const c of terrCached) if (!terrLayers.some((d) => d.name === c.name)) terrLayers.push(c);
      const srtmCoarseTiles = [...cached];
      missing.forEach((t, i) => {
        const d = srtmCoarseSettled[i];
        if (d) { byName.set(t, d); if (!srtmCoarseTiles.includes(d)) srtmCoarseTiles.push(d); }
      });
      const layersCoarse = [...(terrLayers.length ? [terrLayers] : []), ...(srtmCoarseTiles.length ? [srtmCoarseTiles] : [])];
      if (layersCoarse.length) {
        const atCoarse = _layeredSampler(layersCoarse, site);
        const reliefCoarse = _relief(atCoarse);
        if (reliefPassesGate(reliefCoarse, terrLayers.length > 0)) {
          const fromCache = [...terrLayers, ...srtmCoarseTiles].filter((d) => d._fromCache).map((d) => `${d.name}:${d._fromCache}`);
          const coarseResult = {
            terrainSource: 'dem', sample: atCoarse,
            meta: {
              url: tileUrls(tiles[0])[0], reliefKm: reliefCoarse,
              tiles: [...terrLayers, ...srtmCoarseTiles].map((d) => d.name),
              fromCache, wallMs: Date.now() - t0, stage: 'coarse', refined: false,
              nativeResM: terrLayers.length ? TERRARIUM_EFFECTIVE_RES_M : DEM_NATIVE_RES_M,
              gridStepM: terrLayers.length ? TERRARIUM_EFFECTIVE_RES_M : Math.max(...srtmCoarseTiles.map((d) => d.resM ?? DEM_NATIVE_RES_M)),
              src: terrLayers.length ? (srtmCoarseTiles.length ? 'mixed' : 'terrarium') : 'srtm',
              site: { lat: site.lat, lon: site.lon },
              coarseError: coarseNotes.length ? coarseNotes.join('; ') : null,
              timings: { ...timings },
            },
          };
          _emitStatus({ stage: 'coarse', tilesDone: fromCache.length, reliefKm: reliefCoarse, wallMs: coarseResult.meta.wallMs, fromCache, refined: false });
          emit(coarseResult);
          logStage(coarseResult);
          best = coarseResult;
        }
      }
      // Stage 2 — fine refine: Terrarium z15 site-center progressive plus
      // the SRTM native grids (already in flight since before coarse).
      // One tile's failure degrades the mosaic, never kills it; tiles
      // whose fine decode fails keep their coarse grid — any decoded data
      // wins over procedural.
      const tFine = Date.now();
      const terrFineP = skipTerrarium
        ? Promise.resolve(terrCached.find((c) => c.name !== terrCoarseKey) ?? null)
        : loadTerrariumStage(terrFineZoom, {
          center: site, extentKm: Math.min(site.extentKm, terrFineRadiusKm * 2), maxPx: TERRARIUM_FINE_MAX_PX,
          budgetMs: terrariumBudgetMs, maxTiles: terrFineMaxTiles,
          cacheName: terrStageCacheKey('terr-f', terrFineZoom, site), signal: pipelineCtl.signal,
        });
      const settled = await fineP;
      const terrFine = await terrFineP;
      timings.fineMs = Date.now() - tFine;
      const decoded = settled.filter(Boolean);
      const terrFineLayers = [];
      if (terrFine) terrFineLayers.push(terrFine);
      for (const c of terrCached) {
        if (c.name !== terrCoarseKey && !terrFineLayers.some((d) => d.name === c.name)) terrFineLayers.push(c);
      }
      const layersFine = [
        ...(terrFineLayers.length ? [terrFineLayers] : []),
        ...(terrLayers.length ? [terrLayers] : []),
        ...(decoded.length ? [decoded] : []),
      ];
      if (!layersFine.length) throw new Error('no DEM tile resolved');
      const at = _layeredSampler(layersFine, site);
      // Sanity: the windowed mosaic must show real Athabasca relief (~200 m+).
      const relief = _relief(at);
      if (!reliefPassesGate(relief, terrFineLayers.length + terrLayers.length > 0)) throw new Error(`tile flat? relief ${relief.toFixed(3)} km`);
      const srtmFull = decoded.length > 0 && decoded.every((d) => !d.crop);
      const hasFineDetail = terrFineLayers.length > 0 || srtmFull;
      const allDecoded = [...terrFineLayers, ...terrLayers, ...decoded];
      const result = {
        terrainSource: 'dem', sample: at,
        meta: {
          url: tileUrls(tiles[0])[0], reliefKm: relief, tiles: allDecoded.map((d) => d.name),
          fromCache: allDecoded.filter((d) => d._fromCache).map((d) => `${d.name}:${d._fromCache}`),
          wallMs: Date.now() - t0, stage: hasFineDetail ? 'fine' : 'coarse', refined: hasFineDetail,
          nativeResM: (terrFineLayers.length || terrLayers.length) ? TERRARIUM_EFFECTIVE_RES_M : DEM_NATIVE_RES_M,
          gridStepM: terrFineLayers.length ? terrariumResM(terrFineZoom) : (terrLayers.length ? TERRARIUM_EFFECTIVE_RES_M : DEM_NATIVE_RES_M),
          src: terrFineLayers.length ? 'terrarium' : (terrLayers.length ? (decoded.length ? 'mixed' : 'terrarium') : 'srtm'),
          site: { lat: site.lat, lon: site.lon },
          coarseError: coarseNotes.length ? coarseNotes.join('; ') : null,
          timings: { ...timings },
        },
      };
      _emitStatus({ stage: result.meta.stage, tilesDone: decoded.length, reliefKm: relief, wallMs: result.meta.wallMs, fromCache: result.meta.fromCache, refined: hasFineDetail });
      emit(result);
      logStage(result);
      return result;
    } catch {
      return procedural({ coarseError: coarseNotes.length ? coarseNotes.join('; ') : null });
    }
  })();
  if (!(globalBudgetMs > 0)) return pipeline;
  // Unref'd expiry timer: it must never hold the process open on its own.
  let globalTo = null;
  const expiry = new Promise((resolve) => {
    globalTo = setTimeout(() => resolve(_GLOBAL_EXPIRED), globalBudgetMs);
    try { globalTo.unref?.(); } catch { /* ignore */ }
  });
  const winner = await Promise.race([pipeline, expiry]);
  try { clearTimeout(globalTo); } catch { /* ignore */ }
  if (winner !== _GLOBAL_EXPIRED) return winner;
  // Global budget tripped: stop the network, hand back the best stage.
  try { pipelineCtl.abort(); } catch { /* ignore */ }
  if (best) {
    best.meta = { ...best.meta, globalBudgetExpired: true, wallMs: Date.now() - t0, timings: { ...timings } };
    return best;
  }
  return procedural({ globalBudgetExpired: true });
}
