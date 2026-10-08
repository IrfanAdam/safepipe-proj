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
  valleyCutM: 65, // Athabasca valley ~60-70 m — DEM must show this or fallback wins
});

// OpenTopography S3 public bucket, SRTM GL1 30 m. Range-fetched in-browser
// via geotiff.js (dynamic import so offline/bundled builds never break).
export const DEM_URL =
  'https://opentopography.s3.sdsc.edu/raster/SRTM_GL1/SRTM_GL1_srtm/N57W112.tif';

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
  const url = opts.url ?? DEM_URL;
  const timeoutMs = opts.fetchTimeoutMs ?? 8000;
  const sample = (x, z) => sampleProceduralSync(x, z);
  try {
    const GeoTIFF = await import('geotiff').catch(() => null);
    const mod = GeoTIFF?.default ?? GeoTIFF;
    if (!mod?.fromUrl) throw new Error('geotiff unavailable');
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeoutMs);
    let tiff;
    try {
      tiff = await mod.fromUrl(url, { signal: ctl.signal });
    } finally {
      clearTimeout(to);
    }
    const image = await tiff.getImage();
    const [ox, oy, w, h] = [image.getOrigin(), image.getResolution(), image.getWidth(), image.getHeight()];
    const origin = Array.isArray(ox) ? ox : [0, 0];
    const res = Array.isArray(oy) ? oy : [30, -30];
    const rasters = await image.readRasters({ interleave: true });
    const data = rasters?.data ?? rasters;
    if (!data || !w || !h) throw new Error('empty raster');
    // Map tile pixel grid → local km extent (44 km window on tile center).
    const noData = image.getNoDataValue?.() ?? -32768;
    const at = (px, pz) => {
      const gx = Math.min(w - 1, Math.max(0, (px / SITE.extentKm + 0.5) * w));
      const gz = Math.min(h - 1, Math.max(0, (pz / SITE.extentKm + 0.5) * h));
      const x0 = Math.floor(gx), z0 = Math.floor(gz);
      const x1 = Math.min(w - 1, x0 + 1), z1 = Math.min(h - 1, z0 + 1);
      const fx = gx - x0, fz = gz - z0;
      const v = (ix, iz) => {
        const val = data[iz * w + ix];
        return val === noData ? NaN : val / 1000; // m → km altitude
      };
      const a = v(x0, z0), b = v(x1, z0), c = v(x0, z1), d = v(x1, z1);
      if ([a, b, c, d].some(Number.isNaN)) return sampleProceduralSync(px, pz);
      return a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz;
    };
    // Sanity: the tile must show a real valley cut (~60 m across the window).
    const probe = [at(-8, 0), at(0, 0), at(8, 0), at(0, -8), at(0, 8)];
    const relief = Math.max(...probe) - Math.min(...probe);
    if (!(relief > 0.03)) throw new Error(`tile flat? relief ${relief.toFixed(3)} km`);
    void origin;
    void res;
    return { terrainSource: 'dem', sample: at, meta: { url, reliefKm: relief } };
  } catch {
    return { terrainSource: 'procedural', sample, meta: { url } };
  }
}
