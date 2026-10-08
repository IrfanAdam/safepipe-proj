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

/* Decoded-tile cache (staged DEM swap-in): the 44 km mosaic costs ~50+
 * S3 range round-trips on a cold load (60 s wall on slow links — far past
 * any first-paint window), so decoded windows persist in IndexedDB
 * (versioned key per tile) + a session memory map. Repeat visits resolve
 * from cache in ms with zero network. Never throws; Node/test runtimes
 * without indexedDB simply use the memory map. Payloads are plain
 * structured-cloneable structs (typed-array grid + affine). */
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
function _idbOpen() {
  const impl = _idb();
  if (!impl) return Promise.resolve(null);
  return new Promise((resolve) => {
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
    } catch {
      resolve(null);
    }
  });
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
    try {
      db.close();
    } catch {
      /* ignore */
    }
    if (payload && payload.data && payload.ww * payload.hh === payload.data.length) {
      _memTiles.set(key, payload);
      return { payload, fromCache: 'indexeddb' };
    }
    return { payload: null, fromCache: null };
  } catch {
    try {
      db.close();
    } catch {
      /* ignore */
    }
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
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
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

/* Resolve one tile: memory → IndexedDB → S3 range fetch. Returns a decoded
 * struct or null (per-tile miss degrades the mosaic, never kills it).
 * Cache is checked WITHOUT importing geotiff (the 300 KB chunk parse can
 * cost seconds on a busy tab — a warm swap should never pay it). */
async function _loadTile(mod, name, url, timeoutMs, preHit = null) {
  try {
    const hit = preHit ?? (await _cacheRead(name));
    if (hit.payload) return { ...hit.payload, name, _fromCache: hit.fromCache };
    if (!mod?.fromUrl) return null;
    const ctl = new AbortController();
    const tiff = await _withBudget(mod.fromUrl(url, { signal: ctl.signal }), timeoutMs, `fromUrl ${name}`, ctl);
    const image = await tiff.getImage();
    const w = image.getWidth(), h = image.getHeight();
    const ox = image.getOrigin(), oy = image.getResolution();
    const origin = Array.isArray(ox) ? ox : [0, 0];
    const res = Array.isArray(oy) ? oy : [1 / 3600, -1 / 3600];
    // Georeferenced window: only the 44 km site extent is decoded
    // (range request), pixels map via the image affine — never a
    // whole-tile squeeze onto the site.
    const win = geoWindowForSite(origin, res, w, h);
    if (!win) return null;
    const ctl2 = new AbortController();
    const rasters = await _withBudget(
      image.readRasters({ window: [win.left, win.top, win.right, win.bottom], interleave: true }),
      timeoutMs,
      `readRasters ${name}`,
      ctl2,
    );
    const data = rasters?.data ?? rasters;
    const ww = win.right - win.left, hh = win.bottom - win.top;
    if (!data || !ww || !hh || data.length < ww * hh) return null;
    const [ox0, oy0] = origin;
    const [, dy] = res;
    const payload = {
      origin, res, win, data, ww, hh,
      noData: image.getNoDataValue?.() ?? -32768,
      latTop: oy0 + win.top * dy, latBot: oy0 + win.bottom * dy,
      lonLeft: ox0, dx: res[0],
    };
    await _cacheWrite(name, payload);
    return { ...payload, name, _fromCache: null };
  } catch {
    return null;
  }
}

/* Load the pinned DEM tile. Never throws — any failure → procedural seam.
 * Returns { terrainSource, sample(x,z)->km-altitude, meta }.
 * sample() closes over the decoded grid; bilinear, clamped to tile.
 * Staged for the browser twin: first paint is always procedural; tiles
 * resolve cache-first (IndexedDB/memory, ms) then S3 range fetch in
 * PARALLEL (sequential fetch doubled the wall clock), each stage with a
 * real budget (default 30 s — a cold mosaic costs ~50+ S3 round-trips,
 * ~8–60 s depending on link; the old 5–8 s window guaranteed fallback).
 * meta.fromCache names the tiles that resolved without network. */
export async function loadDEM(opts = {}) {
  const timeoutMs = opts.fetchTimeoutMs ?? 30000;
  const sample = (x, z) => sampleProceduralSync(x, z);
  // Single-URL override (tests): treat as a one-tile mosaic.
  const tiles = opts.url ? ['__override__'] : DEM_TILES;
  const tileUrl = (t) => (t === '__override__' ? opts.url : demTileUrl(t));
  const t0 = Date.now();
  try {
    // Cache first, geotiff import only on a miss: a warm repeat visit
    // resolves both tiles from IndexedDB/memory with zero network and
    // without parsing the 300 KB decoder chunk.
    const preHits = await Promise.all(tiles.map((t) => _cacheRead(t)));
    const missing = tiles.filter((_, i) => !preHits[i].payload);
    let mod = null;
    if (missing.length) {
      const GeoTIFF = await import('geotiff').catch(() => null);
      // geotiff v3 ships fromUrl as a NAMED export; a default export may exist
      // but it is the GeoTIFF class, not the loader — prefer whichever carries
      // fromUrl (this bug silently forced procedural everywhere, even online).
      mod = GeoTIFF?.fromUrl ? GeoTIFF : GeoTIFF?.default;
      if (!mod?.fromUrl) throw new Error('geotiff unavailable');
    }
    // Parallel: the two straddling tiles are independent — sequential
    // await doubled a latency-bound load (each needs dozens of S3 ranges).
    const settled = await Promise.all(
      tiles.map((t, i) => _loadTile(mod, t, tileUrl(t), timeoutMs, preHits[i])),
    );
    const decoded = settled.filter(Boolean);
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
    return {
      terrainSource: 'dem', sample: at,
      meta: {
        url: tileUrl(tiles[0]), reliefKm: relief, tiles: decoded.map((d) => d.name),
        fromCache: decoded.filter((d) => d._fromCache).map((d) => `${d.name}:${d._fromCache}`),
        wallMs: Date.now() - t0,
      },
    };
  } catch {
    return { terrainSource: 'procedural', sample, meta: { url: tileUrl(tiles[0]) } };
  }
}
