// src/ring2/field.js — Ring-2 elevation field (Phase 1, Task 2).
//
// One field function for every overlay to drape on: sampleH(x, z) -> metres.
//
// Source ladder (first available wins, never silently mislabelled):
//   1. Terrarium PNG tiles (live surveyed DEM)  -> stage 'live', source 'terrarium'
//   2. Open-Meteo elevation grid (SRTM-family)  -> stage 'srtm',  source 'srtm'
//   3. Analytic procedural surface              -> stage 'procedural', source 'procedural'
//
// Status bus lives on globalThis.__ring2dem: { stage, source, tilesLoaded,
// tilesTotal, updatedAt, transitions: [{ stage, source, at }] }. isLive() is
// true ONLY for decoded Terrarium data — fallbacks can never pose as surveyed.

import { SANGACHAL, worldToGeo, geoToWorld } from './site.js';

export const TERRARIUM_TEMPLATE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const SRTM_ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
export const TILE_Z = 12;
export const MAX_TILES = 16;
export const TILE_CONCURRENCY = 6;
export const TILE_SIZE = 256;
export const COLD_SWAP_BUDGET_MS = 60_000;

/** Terrarium encoding: height = R*256 + G + B/256 - 32768. */
export function terrariumToElevation(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

// ---------------------------------------------------------------- PNG decode

/** Inflate zlib-wrapped deflate (IDAT payload). Universal: browsers + node. */
export async function inflateZlib(raw) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([raw]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode a Terrarium PNG (8-bit, RGB/RGBA, non-interlaced) to elevations.
 * @param {Uint8Array|Buffer} bytes raw PNG file bytes
 * @returns {Promise<{ size: number, data: Float32Array }>} row-major, top = north
 */
export async function decodeTerrariumPng(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) {
    throw new Error('not a PNG');
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat = [];
  while (pos + 8 <= b.length) {
    const len =
      (b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
    const type =
      String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    if (type === 'IHDR') {
      width =
        (b[pos + 8] << 24) | (b[pos + 9] << 16) | (b[pos + 10] << 8) | b[pos + 11];
      height =
        (b[pos + 12] << 24) | (b[pos + 13] << 16) | (b[pos + 14] << 8) | b[pos + 15];
      const depth = b[pos + 16];
      colorType = b[pos + 17];
      const interlace = b[pos + 20];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`unsupported Terrarium PNG depth=${depth} color=${colorType}`);
      }
      if (interlace !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') {
      idat.push(b.subarray(pos + 8, pos + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (!width || !height || !idat.length) throw new Error('malformed PNG');

  const total = idat.reduce((n, c) => n + c.length, 0);
  const compressed = new Uint8Array(total);
  let off = 0;
  for (const c of idat) {
    compressed.set(c, off);
    off += c.length;
  }
  const raw = await inflateZlib(compressed);

  const bpp = colorType === 2 ? 3 : 4;
  const stride = width * bpp;
  const px = new Uint8Array(width * height * bpp);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const upLeft = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[p++];
      if (filter === 1) v = (v + left) & 0xff;
      else if (filter === 2) v = (v + up) & 0xff;
      else if (filter === 3) v = (v + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(left, up, upLeft)) & 0xff;
      px[y * stride + x] = v;
    }
  }
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    data[i] = terrariumToElevation(px[i * bpp], px[i * bpp + 1], px[i * bpp + 2]);
  }
  return { size: width, data };
}

// ------------------------------------------------------------- tile geometry

const MERC = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI;
};
const INV_MERC = (m) =>
  (Math.atan(Math.exp(m * Math.PI)) * 2 - Math.PI / 2) * (180 / Math.PI);

/** Geo -> slippy-map tile at zoom z. */
export function latLonToTile(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor((((1 - MERC(lat)) / 2) * n));
  return { x, y };
}

/** Tile -> { north, south, west, east } geo bounds. */
export function tileToGeoBounds(x, y, z) {
  const n = 2 ** z;
  return {
    north: INV_MERC(1 - (2 * y) / n),
    south: INV_MERC(1 - (2 * (y + 1)) / n),
    west: (x / n) * 360 - 180,
    east: ((x + 1) / n) * 360 - 180,
  };
}

/**
 * Tiles covering a square extent around (lat, lon), ordered center-out,
 * capped at maxTiles (coarse budget: v1 apron-streak fix).
 */
export function tilesForExtent(lat, lon, extentKm, z, maxTiles = MAX_TILES) {
  const keys = new Map();
  // Sample the extent densely so every intersecting tile is found.
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const la = lat + ((i / steps - 0.5) * extentKm) / 111.195;
      const lo =
        lon +
        ((j / steps - 0.5) * extentKm) /
          (111.195 * Math.cos((lat * Math.PI) / 180));
      const t = latLonToTile(la, lo, z);
      const k = `${z}/${t.x}/${t.y}`;
      if (!keys.has(k)) keys.set(k, t);
    }
  }
  const arr = [...keys.values()];
  const dist2 = (t) => {
    const c = tileToGeoBounds(t.x, t.y, z);
    const clat = (c.north + c.south) / 2;
    const clon = (c.west + c.east) / 2;
    const dlat = (clat - lat) * 111.195;
    const dlon = (clon - lon) * 111.195 * Math.cos((lat * Math.PI) / 180);
    return dlat * dlat + dlon * dlon;
  };
  arr.sort((a, b) => dist2(a) - dist2(b));
  return arr.slice(0, maxTiles).map((t) => ({ z, ...t }));
}

// ---------------------------------------------------------------- status bus

function bus() {
  if (!globalThis.__ring2dem) {
    const now = Date.now();
    globalThis.__ring2dem = {
      stage: 'idle',
      source: 'none',
      tilesLoaded: 0,
      tilesTotal: 0,
      updatedAt: now,
      transitions: [{ stage: 'idle', source: 'none', at: now }],
      _subs: new Set(),
    };
  }
  return globalThis.__ring2dem;
}

function setStatus(patch) {
  const b = bus();
  const prevStage = b.stage;
  const prevSource = b.source;
  Object.assign(b, patch, { updatedAt: Date.now() });
  if (b.stage !== prevStage || b.source !== prevSource) {
    b.transitions.push({ stage: b.stage, source: b.source, at: b.updatedAt });
  }
  for (const cb of b._subs) {
    try {
      cb(getStatus());
    } catch {
      /* listener errors must not break the field */
    }
  }
}

/** Snapshot of the DEM status bus (transitions included for cold-swap proof). */
export function getStatus() {
  const b = bus();
  return {
    stage: b.stage,
    source: b.source,
    tilesLoaded: b.tilesLoaded,
    tilesTotal: b.tilesTotal,
    updatedAt: b.updatedAt,
    transitions: b.transitions.map((t) => ({ ...t })),
  };
}

/** Subscribe to status changes. Returns an unsubscribe function. */
export function onStatus(cb) {
  const b = bus();
  b._subs.add(cb);
  return () => b._subs.delete(cb);
}

/**
 * True ONLY when decoded live Terrarium tiles back sampleH.
 * Fallbacks (srtm / procedural) NEVER report live — they must not pose
 * as surveyed data.
 */
export function isLive() {
  return bus().stage === 'live' && tileCache.size > 0;
}

// ------------------------------------------------------------------- storage

const tileCache = new Map(); // `${z}/${x}/${y}` -> { x, y, z, size, data, bounds }
let srtmGrid = null; // { lats, lons, values } rows north->south
let inflight = null;

export function tileCount() {
  return tileCache.size;
}

/** Test-only reset: clears tiles + SRTM grid, returns bus to idle. */
export function resetField() {
  tileCache.clear();
  srtmGrid = null;
  setStatus({ stage: 'idle', source: 'none', tilesLoaded: 0, tilesTotal: 0 });
}

// ------------------------------------------------------------------ fetching

async function fetchTile(url, t, fetchFn, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`tile HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { size, data } = await decodeTerrariumPng(bytes);
    tileCache.set(`${t.z}/${t.x}/${t.y}`, {
      ...t,
      size,
      data,
      bounds: tileToGeoBounds(t.x, t.y, t.z),
    });
  } finally {
    clearTimeout(timer);
  }
  setStatus({ tilesLoaded: tileCache.size });
}

async function mapPool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try {
        await fn(items[k], k);
      } catch {
        /* per-tile failure: tile stays missing, sampler falls through */
      }
    }
  });
  await Promise.all(workers);
}

/** SRTM-family fallback: Open-Meteo elevation grid over the extent. */
export async function fetchSrtmGrid(fetchFn, extentKm = SANGACHAL.extentKm) {
  const half = extentKm / 2 / 111.195;
  const halfLon = half / Math.cos((SANGACHAL.lat * Math.PI) / 180);
  // rows north -> south, cols west -> east
  const latRow = [-1, -0.5, 0, 0.5, 1].map((f) => SANGACHAL.lat - f * half);
  const lons = [-1, -0.5, 0, 0.5, 1].map((f) => SANGACHAL.lon + f * halfLon);
  const latParams = [];
  const lonParams = [];
  for (const la of latRow) for (const lo of lons) {
    latParams.push(la.toFixed(6));
    lonParams.push(lo.toFixed(6));
  }
  const url =
    `${SRTM_ELEVATION_API}?latitude=${latParams.join(',')}` +
    `&longitude=${lonParams.join(',')}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`srtm HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.elevation) || json.elevation.length !== 25) {
    throw new Error('srtm payload malformed');
  }
  return { lats: latRow, lons, values: json.elevation };
}

function sampleGridBilinear(grid, lat, lon) {
  const { lats, lons, values } = grid;
  // lats descending (north->south); lons ascending.
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const la = clamp(lat, lats[lats.length - 1], lats[0]);
  const lo = clamp(lon, lons[0], lons[lons.length - 1]);
  let r = 0;
  while (r < lats.length - 2 && lats[r + 1] > la) r++;
  let c = 0;
  while (c < lons.length - 2 && lons[c + 1] < lo) c++;
  const r0 = lats[r];
  const r1 = lats[r + 1];
  const c0 = lons[c];
  const c1 = lons[c + 1];
  const fy = r1 === r0 ? 0 : (r0 - la) / (r0 - r1);
  const fx = c1 === c0 ? 0 : (lo - c0) / (c1 - c0);
  const n = lons.length;
  const v00 = values[r * n + c];
  const v01 = values[r * n + c + 1];
  const v10 = values[(r + 1) * n + c];
  const v11 = values[(r + 1) * n + c + 1];
  return v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) + v10 * (1 - fx) * fy + v11 * fx * fy;
}

/**
 * Load the coarse Terrarium window (center-out, capped). Resolves with the
 * status snapshot; NEVER rejects — total failure lands on a labelled
 * fallback (srtm, then procedural).
 */
export function ensureField(opts = {}) {
  if (inflight) return inflight;
  if (bus().stage === 'live' && tileCache.size > 0) {
    return Promise.resolve(getStatus());
  }
  inflight = _load(opts).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function _load({
  template = TERRARIUM_TEMPLATE,
  z = TILE_Z,
  maxTiles = MAX_TILES,
  concurrency = TILE_CONCURRENCY,
  extentKm = SANGACHAL.extentKm,
  fetchFn = (...a) => fetch(...a),
  tileTimeoutMs = 20000,
  allowSrtm = true,
} = {}) {
  const startedAt = Date.now();
  try {
    const list = tilesForExtent(SANGACHAL.lat, SANGACHAL.lon, extentKm, z, maxTiles);
    setStatus({
      stage: 'coarse',
      source: 'terrarium',
      tilesLoaded: tileCache.size,
      tilesTotal: list.length,
    });
    await mapPool(list, concurrency, (t) => {
      const key = `${t.z}/${t.x}/${t.y}`;
      if (tileCache.has(key)) return Promise.resolve();
      const url = template
        .replace('{z}', String(t.z))
        .replace('{x}', String(t.x))
        .replace('{y}', String(t.y));
      return fetchTile(url, t, fetchFn, tileTimeoutMs);
    });
    if (tileCache.size > 0) {
      setStatus({ stage: 'live', source: 'terrarium' });
      return { ...getStatus(), coldSwapMs: Date.now() - startedAt };
    }
    if (allowSrtm) {
      try {
        srtmGrid = await fetchSrtmGrid(fetchFn, extentKm);
        setStatus({ stage: 'srtm', source: 'srtm' });
        return getStatus();
      } catch {
        srtmGrid = null;
      }
    }
    setStatus({ stage: 'procedural', source: 'procedural' });
    return getStatus();
  } catch {
    setStatus({ stage: 'procedural', source: 'procedural' });
    return getStatus();
  }
}

// ------------------------------------------------------------------ sampling

function sampleTerrarium(x, z) {
  const { lat, lon } = worldToGeo(x, z);
  const n = 2 ** TILE_Z;
  const xt = ((lon + 180) / 360) * n;
  const yt = ((1 - MERC(lat)) / 2) * n;
  const xi = Math.floor(xt);
  const yi = Math.floor(yt);
  const t = tileCache.get(`${TILE_Z}/${xi}/${yi}`);
  if (!t) return null;
  const fx = Math.min(0.99999, Math.max(0, xt - xi)) * t.size;
  const fy = Math.min(0.99999, Math.max(0, yt - yi)) * t.size;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(t.size - 1, x0 + 1);
  const y1 = Math.min(t.size - 1, y0 + 1);
  const dx = fx - x0;
  const dy = fy - y0;
  const d = t.data;
  const s = t.size;
  const v00 = d[y0 * s + x0];
  const v01 = d[y0 * s + x1];
  const v10 = d[y1 * s + x0];
  const v11 = d[y1 * s + x1];
  return (
    v00 * (1 - dx) * (1 - dy) + v01 * dx * (1 - dy) + v10 * (1 - dx) * dy + v11 * dx * dy
  );
}

function sampleSrtm(x, z) {
  if (!srtmGrid) return null;
  const { lat, lon } = worldToGeo(x, z);
  return sampleGridBilinear(srtmGrid, lat, lon);
}

function smoothstep(a, b, t) {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/**
 * Procedural fallback surface (NOT surveyed). Calibrated analytic terrain:
 * west-high coastal plain falling to the Caspian (-28 m) in the east, a
 * northern hill mass, a southwestern ridge, plus rolling detail. Exists so
 * overlays never float on NaN when offline — always labelled procedural.
 */
export function proceduralH(x, z) {
  const base = 30 - 0.006 * x + 0.0038 * z;
  const hillN =
    230 * Math.exp(-(x * x + (z + 5000) * (z + 5000)) / (2 * 2800 * 2800));
  const ridgeSW =
    160 *
    Math.exp(
      -((x + 10000) * (x + 10000) + (z - 5000) * (z - 5000)) / (2 * 3200 * 3200),
    );
  const rolling =
    12 * Math.sin(x * 0.0009) * Math.cos(z * 0.0011) +
    8 * Math.sin(x * 0.00037 + 1.7) * Math.sin(z * 0.00043 + 0.6);
  const h = base + hillN + ridgeSW + rolling;
  const sea = smoothstep(4000, 9000, x);
  return h * (1 - sea) + -28 * sea;
}

/** Single field function every overlay drapes on. Always returns a number. */
export function sampleH(x, z) {
  const t = sampleTerrarium(x, z);
  if (t !== null && Number.isFinite(t)) return t;
  const s = sampleSrtm(x, z);
  if (s !== null && Number.isFinite(s)) return s;
  return proceduralH(x, z);
}

/** Which source backs sampleH at (x, z) right now. */
export function sampleSource(x, z) {
  const { lat, lon } = worldToGeo(x, z);
  const n = 2 ** TILE_Z;
  if (
    tileCache.has(
      `${TILE_Z}/${Math.floor(((lon + 180) / 360) * n)}/${Math.floor(((1 - MERC(lat)) / 2) * n)}`,
    )
  ) {
    return 'terrarium';
  }
  if (srtmGrid) return 'srtm';
  return 'procedural';
}

/** Live relief (max-min of sampleH) over a world-space grid. Flat => failure. */
export function liveRelief(halfExtentM = 10000, steps = 9) {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const x = -halfExtentM + ((2 * halfExtentM) * j) / (steps - 1);
      const z = -halfExtentM + ((2 * halfExtentM) * i) / (steps - 1);
      const h = sampleH(x, z);
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
  }
  return { min: mn, max: mx, relief: mx - mn };
}
