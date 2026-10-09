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
 * - Sources: SRTM GL1 primary (known-good), Copernicus GLO-30 COG fallback
 *   per tile on primary failure, inside the same budget.
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
/* Candidate sources per pinned tile, fastest-known first. */
export function demTileUrls(name) {
  return [demTileUrl(name), copernicusTileUrl(name)].filter(Boolean);
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
export function coarseCropForSite(origin, res, win, extentPx = COARSE_EXTENT_PX) {
  const half = Math.max(8, extentPx) / 2;
  const scol = (SITE.lon - origin[0]) / res[0];
  const srow = (SITE.lat - origin[1]) / res[1];
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
 * loading → coarse? → fine | cache | procedural. */
const _statusListeners = new Set();
let _demStatus = Object.freeze({
  stage: 'idle', tilesTotal: DEM_TILES.length, tilesDone: 0,
  reliefKm: null, wallMs: null, fromCache: [], refined: false, updatedAt: 0,
});
export function getDemStatus() {
  return { ..._demStatus, fromCache: [..._demStatus.fromCache] };
}
export function onDemStatus(cb) {
  if (typeof cb === 'function') {
    _statusListeners.add(cb);
    try { cb(getDemStatus()); } catch { /* listener-local */ }
  }
  return () => { _statusListeners.delete(cb); };
}
function _emitStatus(patch) {
  _demStatus = Object.freeze({ ..._demStatus, ...patch, updatedAt: Date.now() });
  for (const cb of [..._statusListeners]) {
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

/* Strip-parallel full-res decode: the window is split into horizontal
 * strips, each read through its own TIFF handle so the HTTP ranges fly
 * concurrently, then stitched. Throws when striping fails (older geotiff
 * builds, odd tiling) — the caller falls back to a single-window read.
 * Returns { stitched } (raw grid rows); affine stays with the caller. */
async function _decodeStriped(mod, url, origin, res, w, h, win, budgetMs, strips) {
  const winW = win.right - win.left, winH = win.bottom - win.top;
  const bounds = [];
  for (let s = 0; s < strips; s++) {
    const top = win.top + Math.floor((winH * s) / strips);
    const bottom = s === strips - 1 ? win.bottom : win.top + Math.floor((winH * (s + 1)) / strips);
    if (bottom > top) bounds.push([top, bottom]);
  }
  if (bounds.length < 2) throw new Error('window too small to stripe');
  const ctl = new AbortController();
  const parts = await Promise.all(bounds.map(([top, bottom]) =>
    _withBudget((async () => {
      const tiff = await mod.fromUrl(url, { signal: ctl.signal });
      const image = await tiff.getImage();
      const r = await image.readRasters({ window: [win.left, top, win.right, bottom], interleave: true });
      return { top, data: r?.data ?? r, rows: bottom - top };
    })(), budgetMs, `strip ${top}-${bottom}`, ctl),
  ));
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
async function _loadTile(mod, name, urls, timeoutMs, preHit = null, strips = 2) {
  try {
    const hit = preHit ?? (await _cacheRead(name));
    if (hit.payload) return { ...hit.payload, name, _fromCache: hit.fromCache };
    if (!mod?.fromUrl) return null;
    const N_RES = 1 / 3600;
    let lastErr = null;
    for (const url of urls) {
      try {
        // Probe the header once for geometry (cheap: IFD + first ranges).
        const ctl0 = new AbortController();
        const tiff0 = await _withBudget(mod.fromUrl(url, { signal: ctl0.signal }), timeoutMs, `fromUrl ${name}`, ctl0);
        const img0 = await tiff0.getImage();
        const w = img0.getWidth(), h = img0.getHeight();
        const ox = img0.getOrigin(), oy = img0.getResolution();
        const origin = Array.isArray(ox) ? ox : [-112, name.startsWith('N56') ? 57 : 58];
        const res = Array.isArray(oy) ? oy : [N_RES, -N_RES];
        // Georeferenced window: only the 44 km site extent is decoded
        // (range request), pixels map via the image affine — never a
        // whole-tile squeeze onto the site.
        const win = geoWindowForSite(origin, res, w, h);
        if (!win) { lastErr = new Error('site outside raster'); continue; }
        let data, ww, hh, noData = -32768, latTop, latBot;
        try {
          if (strips >= 2) {
            const parts = await _decodeStriped(mod, url, origin, res, w, h, win, timeoutMs, strips);
            // Re-derive no-data + edges from the probe image.
            try { noData = img0.getNoDataValue?.() ?? -32768; } catch { /* default */ }
            const [, dy] = res;
            latTop = origin[1] + win.top * dy; latBot = origin[1] + win.bottom * dy;
            data = parts.stitched; ww = win.right - win.left; hh = win.bottom - win.top;
          } else {
            throw new Error('striping disabled');
          }
        } catch {
          // Single-window fallback (same geometry, one range stream).
          const ctl = new AbortController();
          const rasters = await _withBudget(
            img0.readRasters({ window: [win.left, win.top, win.right, win.bottom], interleave: true }),
            timeoutMs,
            `readRasters ${name}`,
            ctl,
          );
          data = rasters?.data ?? rasters;
          ww = win.right - win.left; hh = win.bottom - win.top;
          try { noData = img0.getNoDataValue?.() ?? -32768; } catch { /* default */ }
          const [, dy] = res;
          latTop = origin[1] + win.top * dy; latBot = origin[1] + win.bottom * dy;
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
async function _loadTileCoarse(mod, name, url, budgetMs, extentPx, notes = null, strips = 2) {
  const note = (m) => { try { notes?.push(`${name}:${m}`); } catch { /* ignore */ } };
  const deadline = Date.now() + Math.max(1, budgetMs);
  const remaining = () => deadline - Date.now();
  try {
    if (!mod?.fromUrl) { note('geotiff unavailable'); return null; }
    if (remaining() <= 0) { note('no budget'); return null; }
    const N_RES = 1 / 3600;
    const ctl = new AbortController();
    const tiff = await _withBudget(mod.fromUrl(url, { signal: ctl.signal }), remaining(), `coarse fromUrl ${name}`, ctl);
    const image = await tiff.getImage();
    const w = image.getWidth(), h = image.getHeight();
    const ox = image.getOrigin(), oy = image.getResolution();
    const origin = Array.isArray(ox) ? ox : [-112, 58];
    const res = Array.isArray(oy) ? oy : [N_RES, -N_RES];
    const win = geoWindowForSite(origin, res, w, h);
    if (!win) { note('site outside raster'); return null; }
    const crop = coarseCropForSite(origin, res, win, extentPx);
    if (!crop) { note('crop degenerate'); return null; }
    if (remaining() <= 0) { note('open consumed budget'); return null; }
    const ww = crop.right - crop.left, hh = crop.bottom - crop.top;
    let data = null;
    try {
      if (strips >= 2) {
        data = (await _decodeStriped(mod, url, origin, res, w, h, crop, remaining(), strips)).stitched;
      } else {
        throw new Error('striping disabled');
      }
    } catch {
      if (remaining() <= 0) { note('strip phase consumed budget'); return null; }
      const ctl2 = new AbortController();
      const rasters = await _withBudget(
        image.readRasters({ window: [crop.left, crop.top, crop.right, crop.bottom], interleave: true }),
        remaining(),
        `coarse readRasters ${name}`,
        ctl2,
      );
      data = rasters?.data ?? rasters;
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
  }
}

/* Build the lon/lat sampler over decoded tiles (seam-feathered). */
function _mosaicSampler(decoded) {
  const lonScale = 111.32 * Math.cos((SITE.lat * Math.PI) / 180);
  return (px, pz) => {
    const lon = SITE.lon + px / lonScale;
    const lat = SITE.lat - pz / 111.32;
    return mosaicSample(decoded, lon, lat, sampleProceduralSync(px, pz));
  };
}

/* Sanity: the windowed mosaic must show real Athabasca relief (~200 m+). */
function _relief(at) {
  const probe = [at(-8, 0), at(0, 0), at(8, 0), at(0, -8), at(0, 8)];
  return Math.max(...probe) - Math.min(...probe);
}

/* Load the pinned DEM tiles. Never throws — any failure → procedural seam.
 * Returns { terrainSource, sample(x,z)->km-altitude, meta }.
 * sample() closes over the decoded grid; bilinear, clamped to tile.
 * Staged for the browser twin: first paint is always procedural; tiles
 * resolve cache-first (IndexedDB/memory, ms) then S3 range fetch in
 * PARALLEL (sequential fetch doubled the wall clock), each stage with a
 * real budget (default 30 s fine; coarse first-paint capped at
 * COARSE_BUDGET_MS).
 * Progression (all terrainSource 'dem', meta.stage names the stage):
 *   cache → coarse → fine. The coarse preview (site-anchored full-res
 *   crop, ~1/3 the ranges) is delivered via opts.onProgress as soon as it
 *   lands, then the fine mosaic refines it to the full 44 km window; a
 *   tile whose fine decode fails keeps its coarse crop — any decoded
 *   data wins over procedural. meta.fromCache names the tiles that
 *   resolved without network. Status bus (getDemStatus/onDemStatus) mirrors
 *   the progression for the HUD loading signal. */
export async function loadDEM(opts = {}) {
  const timeoutMs = opts.fetchTimeoutMs ?? 30000;
  const coarseBudgetMs = Math.min(opts.coarseBudgetMs ?? COARSE_BUDGET_MS, timeoutMs);
  const coarseExtentPx = opts.coarseExtentPx ?? opts.coarseMaxPx ?? COARSE_EXTENT_PX;
  const strips = Math.max(1, Math.floor(opts.parallelStrips ?? 2));
  const skipCoarse = !!opts.skipCoarse;
  const onProgress = opts.onProgress ?? opts.onStage ?? null;
  const emit = (result) => {
    if (typeof onProgress === 'function') {
      try { onProgress(result); } catch { /* consumer-local */ }
    }
  };
  const sample = (x, z) => sampleProceduralSync(x, z);
  // Single-URL override (tests): treat as a one-tile mosaic.
  const tiles = opts.url ? ['__override__'] : DEM_TILES;
  const tileUrls = (t) => (t === '__override__' ? [opts.url] : demTileUrls(t));
  const t0 = Date.now();
  _emitStatus({ stage: 'loading', tilesTotal: tiles.length, tilesDone: 0, reliefKm: null, wallMs: null, fromCache: [], refined: false });
  const procedural = (extraMeta) => {
    _emitStatus({ stage: 'procedural', tilesDone: 0, wallMs: Date.now() - t0, refined: false });
    return { terrainSource: 'procedural', sample, meta: { url: tileUrls(tiles[0])[0], stage: 'procedural', ...extraMeta } };
  };
  try {
    // Cache first, geotiff import only on a miss: a warm repeat visit
    // resolves both tiles from IndexedDB/memory with zero network and
    // without parsing the 300 KB decoder chunk.
    const preHits = await Promise.all(tiles.map((t) => _cacheRead(t)));
    const missing = tiles.filter((_, i) => !preHits[i].payload);
    const cached = tiles.map((t, i) => (preHits[i].payload ? { ...preHits[i].payload, name: t, _fromCache: preHits[i].fromCache } : null)).filter(Boolean);
    if (!missing.length) {
      const at = _mosaicSampler(cached);
      const relief = _relief(at);
      if (!(relief > 0.08)) throw new Error(`tile flat? relief ${relief.toFixed(3)} km`);
      const result = {
        terrainSource: 'dem', sample: at,
        meta: {
          url: tileUrls(tiles[0])[0], reliefKm: relief, tiles: cached.map((d) => d.name),
          fromCache: cached.filter((d) => d._fromCache).map((d) => `${d.name}:${d._fromCache}`),
          wallMs: Date.now() - t0, stage: 'cache', refined: true, nativeResM: DEM_NATIVE_RES_M, gridStepM: DEM_NATIVE_RES_M,
        },
      };
      _emitStatus({ stage: 'cache', tilesDone: tiles.length, reliefKm: relief, wallMs: result.meta.wallMs, fromCache: result.meta.fromCache, refined: true });
      emit(result);
      return result;
    }
    let mod = null;
    mod = await _geotiffMod();
    if (!mod?.fromUrl) throw new Error('geotiff unavailable');
    // Parallel: the two straddling tiles are independent — sequential
    // await doubled a latency-bound load (each needs dozens of S3 ranges).
    const byName = new Map(cached.map((d) => [d.name, d]));
    // Stage 1 — coarse first paint (tight budget, decimated reads). Tiles
    // already in cache join at full res; missing tiles race coarse.
    // Notes collect per-tile coarse failures (meta.coarseError) so a
    // missing first paint is diagnosable, never silent.
    const coarseNotes = [];
    if (!skipCoarse && coarseBudgetMs > 0) {
      const coarseSettled = await Promise.all(
        missing.map((t) => _loadTileCoarse(mod, t, tileUrls(t)[0], coarseBudgetMs, coarseExtentPx, coarseNotes, strips)),
      );
      const coarseTiles = [...cached];
      missing.forEach((t, i) => { if (coarseSettled[i]) byName.set(t, coarseSettled[i]); });
      for (const d of byName.values()) if (!coarseTiles.includes(d)) coarseTiles.push(d);
      if (coarseTiles.length) {
        const atCoarse = _mosaicSampler(coarseTiles);
        const reliefCoarse = _relief(atCoarse);
        if (reliefCoarse > 0.08) {
          const coarseResult = {
            terrainSource: 'dem', sample: atCoarse,
            meta: {
              url: tileUrls(tiles[0])[0], reliefKm: reliefCoarse, tiles: coarseTiles.map((d) => d.name),
              fromCache: coarseTiles.filter((d) => d._fromCache).map((d) => `${d.name}:${d._fromCache}`),
              wallMs: Date.now() - t0, stage: 'coarse', refined: false,
              nativeResM: DEM_NATIVE_RES_M,
              gridStepM: Math.max(...coarseTiles.map((d) => d.resM ?? DEM_NATIVE_RES_M)),
            },
          };
          _emitStatus({ stage: 'coarse', tilesDone: coarseResult.meta.fromCache.length, reliefKm: reliefCoarse, wallMs: coarseResult.meta.wallMs, fromCache: coarseResult.meta.fromCache, refined: false });
          emit(coarseResult);
          if (tiles.every((t) => byName.get(t)?.crop !== true && byName.has(t))) {
            // All tiles were already cached (unreachable — handled above),
            // but keep the invariant: nothing left to refine.
            return { ...coarseResult, meta: { ...coarseResult.meta, stage: 'cache', refined: true } };
          }
        }
      }
    }
    // Stage 2 — fine refine (native 30 m, strip-parallel, source fallback).
    // allSettled: one tile's failure degrades the mosaic, never kills it;
    // tiles whose fine decode fails keep their coarse grid (no
    // procedural-forever for half the window).
    const settled = await Promise.all(
      tiles.map((t, i) => {
        if (preHits[i].payload) return Promise.resolve(byName.get(t));
        return _loadTile(mod, t, tileUrls(t), timeoutMs, preHits[i], strips).then((d) => d ?? byName.get(t) ?? null);
      }),
    );
    const decoded = settled.filter(Boolean);
    if (!decoded.length) throw new Error('no DEM tile resolved');
    const at = _mosaicSampler(decoded);
    // Sanity: the windowed mosaic must show real Athabasca relief (~200 m+).
    const relief = _relief(at);
    if (!(relief > 0.08)) throw new Error(`tile flat? relief ${relief.toFixed(3)} km`);
    const fine = decoded.every((d) => !d.crop);
    const result = {
      terrainSource: 'dem', sample: at,
      meta: {
        url: tileUrls(tiles[0])[0], reliefKm: relief, tiles: decoded.map((d) => d.name),
        fromCache: decoded.filter((d) => d._fromCache).map((d) => `${d.name}:${d._fromCache}`),
        wallMs: Date.now() - t0, stage: fine ? 'fine' : 'coarse', refined: fine,
        nativeResM: DEM_NATIVE_RES_M,
        gridStepM: fine ? DEM_NATIVE_RES_M : Math.max(...decoded.map((d) => d.resM ?? DEM_NATIVE_RES_M)),
        coarseError: coarseNotes.length ? coarseNotes.join('; ') : null,
      },
    };
    _emitStatus({ stage: result.meta.stage, tilesDone: decoded.length, reliefKm: relief, wallMs: result.meta.wallMs, fromCache: result.meta.fromCache, refined: fine });
    emit(result);
    return result;
  } catch {
    return procedural();
  }
}
