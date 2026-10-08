/* Safepipe Ops 3D — src/ops3d/dem.js · real-terrain seam (Phase 1, Task 6).
 * SITE: Fort McMurray 57.03N -111.68W (SRTM GL1 tile N57W112, 30 m).
 * terrainSource: 'procedural' | 'dem' — procedural is the default and the
 * offline fallback; 'dem' only after a successful GeoTIFF decode.
 * loadDEM() never throws: fetch/parse failure → {terrainSource:'procedural'}.
 * levelsForRange(mn, mx, n) is the shared contour-level helper (Task 7):
 * symmetric power-spaced (exponent 1.35), strictly ascending, endpoints
 * within 2% of span of the extrema — same shaping terrain.js always used.
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

/* Load the pinned DEM tile. Never throws — any failure → procedural seam.
 * Returns { terrainSource, sample(x,z)->km-altitude, meta }.
 * sample() closes over the decoded grid; bilinear, clamped to tile. */
export async function loadDEM(opts = {}) {
  const timeoutMs = opts.fetchTimeoutMs ?? 8000;
  const sample = (x, z) => sampleProceduralSync(x, z);
  // Single-URL override (tests): treat as a one-tile mosaic.
  const tiles = opts.url ? ['__override__'] : DEM_TILES;
  const tileUrl = (t) => (t === '__override__' ? opts.url : demTileUrl(t));
  try {
    const GeoTIFF = await import('geotiff').catch(() => null);
    // geotiff v3 ships fromUrl as a NAMED export; a default export may exist
    // but it is the GeoTIFF class, not the loader — prefer whichever carries
    // fromUrl (this bug silently forced procedural everywhere, even online).
    const mod = GeoTIFF?.fromUrl ? GeoTIFF : GeoTIFF?.default;
    if (!mod?.fromUrl) throw new Error('geotiff unavailable');
    const decoded = [];
    for (const t of tiles) {
      try {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), timeoutMs);
        let tiff;
        try {
          tiff = await mod.fromUrl(tileUrl(t), { signal: ctl.signal });
        } finally {
          clearTimeout(to);
        }
        const image = await tiff.getImage();
        const w = image.getWidth(), h = image.getHeight();
        const ox = image.getOrigin(), oy = image.getResolution();
        const origin = Array.isArray(ox) ? ox : [0, 0];
        const res = Array.isArray(oy) ? oy : [1 / 3600, -1 / 3600];
        // Georeferenced window: only the 44 km site extent is decoded
        // (range request), pixels map via the image affine — never a
        // whole-tile squeeze onto the site.
        const win = geoWindowForSite(origin, res, w, h);
        if (!win) continue;
        const rasters = await image.readRasters({
          window: [win.left, win.top, win.right, win.bottom],
          interleave: true,
        });
        const data = rasters?.data ?? rasters;
        const ww = win.right - win.left, hh = win.bottom - win.top;
        if (!data || !ww || !hh) continue;
        const [ox0, oy0] = origin;
        const [, dy] = res;
        decoded.push({
          name: t, origin, res, win, data, ww, hh,
          noData: image.getNoDataValue?.() ?? -32768,
          latTop: oy0 + win.top * dy, latBot: oy0 + win.bottom * dy,
          lonLeft: ox0, dx: res[0],
        });
      } catch {
        /* per-tile miss — the mosaic degrades, it doesn't die */
      }
    }
    if (!decoded.length) throw new Error('no DEM tile resolved');
    const lonScale = 111.32 * Math.cos((SITE.lat * Math.PI) / 180);
    const at = (px, pz) => {
      // Local km → lon/lat (equirectangular at the site latitude, matching
      // the window math above) → owning tile → windowed pixels → bilinear.
      const lon = SITE.lon + px / lonScale;
      const lat = SITE.lat - pz / 111.32;
      const tile = decoded.find((d) => lat <= d.latTop + 1e-9 && lat >= d.latBot - 1e-9) ?? decoded[0];
      const gx = (lon - tile.origin[0]) / tile.res[0] - tile.win.left;
      const gz = (lat - tile.origin[1]) / tile.res[1] - tile.win.top;
      return sampleGrid(tile.data, tile.ww, tile.ww, tile.hh, gx, gz, tile.noData, sampleProceduralSync(px, pz));
    };
    // Sanity: the windowed mosaic must show real Athabasca relief (~200 m+).
    const probe = [at(-8, 0), at(0, 0), at(8, 0), at(0, -8), at(0, 8)];
    const relief = Math.max(...probe) - Math.min(...probe);
    if (!(relief > 0.08)) throw new Error(`tile flat? relief ${relief.toFixed(3)} km`);
    return { terrainSource: 'dem', sample: at, meta: { url: tileUrl(tiles[0]), reliefKm: relief, tiles: decoded.map((d) => d.name) } };
  } catch {
    return { terrainSource: 'procedural', sample, meta: { url: tileUrl(tiles[0]) } };
  }
}
