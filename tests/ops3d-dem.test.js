import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, DEM_TILES, levelsForRange, loadDEM, sampleProcedural, geoWindowForSite, sampleGrid, demCacheKey, DEM_CACHE_VERSION, _cacheMemSeed, _cacheMemClear, mosaicSample, downsampleGrid, detailStepForRange, copernicusTileUrl, demTileUrls, getDemStatus, onDemStatus, DEM_NATIVE_RES_M, DEM_STAGES, SEAM_BLEND_DEG, coarseCropForSite, COARSE_EXTENT_PX, GLOBAL_BUDGET_MS, TERRARIUM_MAXZOOM, TERRARIUM_TILE_PX, TERRARIUM_EFFECTIVE_RES_M, TERRARIUM_COARSE_ZOOM, TWIN_MESH_EXTENT_KM, terrStageCacheKey, terrariumTileUrl, latLonToTile, terrariumResM, terrariumDecodePixel, terrariumElevationsFromRGBA, terrariumWindowTiles, terrariumTileCount, lonLatToTilePixel, tilePixelToLonLat, stitchTerrariumGrid, loadTerrariumStage, _injectTerrariumFetcher, parseSiteParam, resolveSite, srtmTileName, srtmTileNames, reliefPassesGate, DEM_RELIEF_MIN_KM, TERRARIUM_RELIEF_MIN_KM } from '../src/ops3d/dem.js';

describe('ops3d DEM seam (phase 1)', () => {
  it('SITE pin is Fort McMurray', () => {
    assert.ok(Math.abs(SITE.lat - 57.03) < 0.01, `lat ${SITE.lat}`);
    assert.ok(Math.abs(SITE.lon - -111.68) < 0.01, `lon ${SITE.lon}`);
    assert.equal(SITE.tile, 'N57W112');
  });

  it('procedural sampler is a function over the map extent', async () => {
    const h = await sampleProcedural(0, 0);
    assert.equal(typeof h, 'number');
    assert.ok(Number.isFinite(h), 'finite altitude');
  });

  it('contour levels track the DEM range within 2%', () => {
    const mn = -0.042, mx = 0.088;
    const levels = levelsForRange(mn, mx, 32);
    assert.equal(levels.length, 32);
    assert.ok(levels[0] >= mn - 1e-9 && levels[0] <= mx + 1e-9, `lo ${levels[0]}`);
    assert.ok(levels[31] >= mn - 1e-9 && levels[31] <= mx + 1e-9, `hi ${levels[31]}`);
    // every level inside the band, endpoints within 2% of span of the extrema
    const span = mx - mn;
    assert.ok(Math.abs(levels[0] - mn) < 0.02 * span + 1e-9, 'lo edge ±2%');
    assert.ok(Math.abs(levels[31] - mx) < 0.02 * span + 1e-9, 'hi edge ±2%');
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] > levels[i - 1], 'strictly ascending');
  });

  it('loadDEM falls back to procedural when fetch fails', async () => {
    const r = await loadDEM({ url: 'https://127.0.0.1:9/nope.tif', fetchTimeoutMs: 200 });
    assert.equal(r.terrainSource, 'procedural');
    assert.equal(typeof r.sample, 'function');
    assert.ok(Number.isFinite(r.sample(1, 2)));
  });

  it('mosaic pins both straddling tiles', () => {
    assert.deepEqual([...DEM_TILES], ['N57W112', 'N56W112']);
  });
});

describe('ops3d DEM tile cache (staged swap-in)', () => {
  afterEach(() => _cacheMemClear());

  it('cache keys are versioned per tile', () => {
    assert.equal(demCacheKey('N57W112'), `srtm-dem:v${DEM_CACHE_VERSION}:N57W112`);
    assert.notEqual(demCacheKey('N57W112'), demCacheKey('N56W112'));
  });

  // Synthetic mosaic over the real site pixels: W→E gradient 250→393 m so
  // the 5-point relief probe (>80 m) passes from cache with zero network.
  const seedMosaic = () => {
    const res = [1 / 3600, -1 / 3600];
    const mk = (origin, win) => {
      const ww = win.right - win.left, hh = win.bottom - win.top;
      const data = new Int16Array(ww * hh);
      for (let z = 0; z < hh; z++) for (let x = 0; x < ww; x++) data[z * ww + x] = Math.round(250 + 0.15 * x);
      const [, dy] = res;
      return {
        origin, res, win, data, ww, hh, noData: -32768,
        latTop: origin[1] + win.top * dy, latBot: origin[1] + win.bottom * dy,
        lonLeft: origin[0], dx: res[0],
      };
    };
    _cacheMemSeed('N57W112', mk([-112, 58], { left: 677, top: 3233, right: 1628, bottom: 3601 }));
    _cacheMemSeed('N56W112', mk([-112, 57], { left: 677, top: 0, right: 1628, bottom: 152 }));
  };

  it('memory-cached mosaic resolves dem with no network', async () => {
    seedMosaic();
    const t0 = Date.now();
    // Tight budget: cache hits never fetch, so this only passes when the
    // network is never touched (a fetch-first regression fails here).
    const r = await loadDEM({ fetchTimeoutMs: 4000 });
    assert.equal(r.terrainSource, 'dem');
    assert.deepEqual(r.meta.tiles, ['N57W112', 'N56W112']);
    assert.equal(r.meta.fromCache.length, 2);
    assert.ok(r.meta.reliefKm > 0.08, `relief ${r.meta.reliefKm}`);
    assert.ok(Math.abs(r.sample(0, 0) - 0.321) < 0.01, `center ${r.sample(0, 0)}`);
    assert.ok(Math.abs(r.sample(8, 0) - r.sample(-8, 0) - 0.142) < 0.01, 'W→E gradient');
    assert.ok(Date.now() - t0 < 4000, 'cache path, no fetch wait');
  });

  it('corrupt cached payload is evicted, never sampled', async () => {
    _cacheMemSeed('__override__', { ww: 4, hh: 4, data: new Int16Array([1, 2, 3]) }); // length 3 ≠ 16
    const r = await loadDEM({ url: 'https://127.0.0.1:9/nope.tif', fetchTimeoutMs: 200 });
    assert.equal(r.terrainSource, 'procedural');
  });
});

describe('ops3d DEM georeferencing (phase 1 iteration)', () => {
  // SRTM GL1 geometry: 1° tiles, 3601×3601 px, top-left origin.
  const N_RES = 1 / 3600;
  const north = { origin: [-112, 58], res: [N_RES, -N_RES], w: 3601, h: 3601 };
  const south = { origin: [-112, 57], res: [N_RES, -N_RES], w: 3601, h: 3601 };

  it('north window covers site center at the right pixels', () => {
    const win = geoWindowForSite(north.origin, north.res, north.w, north.h);
    // Site lon −111.68 → col (−111.68+112)/res ≈ 1152; lat 57.03 → row ≈ 3492.
    const cx = (SITE.lon - north.origin[0]) / north.res[0];
    const cz = (SITE.lat - north.origin[1]) / north.res[1];
    assert.ok(Math.abs(cx - 1152) < 2, `center col ${cx}`);
    assert.ok(Math.abs(cz - 3492) < 2, `center row ${cz}`);
    assert.ok(win.left <= cx && cx <= win.right, 'center inside window');
    assert.ok(win.top <= cz && cz <= win.bottom, 'center inside window');
    // 44 km ≈ 1467 px wide at 30 m — never a whole-tile squeeze.
    assert.ok(win.right - win.left > 1000 && win.right - win.left < 3601);
  });

  it('site south edge falls outside the north tile (mosaic required)', () => {
    const win = geoWindowForSite(north.origin, north.res, north.w, north.h);
    // True south-edge row ≈ 4203 — past the tile: the window edge-clamps.
    assert.equal(win.bottom, north.h);
    const sw = geoWindowForSite(south.origin, south.res, south.w, south.h);
    assert.equal(sw.top, 0); // clamped north — the south tile owns the edge
    assert.ok(sw.bottom > 500 && sw.bottom < 800, `south window depth ${sw.bottom}`);
  });

  it('junk affine returns null (fallback, never a mis-placed DEM)', () => {
    assert.equal(geoWindowForSite([0, 0], [30, -30], 100, 100), null); // resolutions are degrees/px
    assert.equal(geoWindowForSite([-112, 58], [N_RES, -N_RES], 3601, 3601, { lat: 0, lon: 0, extentKm: 44 }), null);
    assert.equal(geoWindowForSite([0, 0], [0, 0], 10, 10), null);
  });

  it('sampleGrid is exact on nodes, linear between, fallback on no-data', () => {
    const data = [0, 1000, 2000, 3000]; // 2×2 m-grid → km
    assert.equal(sampleGrid(data, 2, 2, 2, 0, 0, -32768, -1), 0);
    assert.equal(sampleGrid(data, 2, 2, 2, 1, 1, -32768, -1), 3);
    assert.equal(sampleGrid(data, 2, 2, 2, 0.5, 0.5, -32768, -1), 1.5);
    const hole = [0, -32768, 2000, 3000];
    assert.equal(sampleGrid(hole, 2, 2, 2, 0.5, 0.5, -32768, -1), -1);
    assert.ok(Number.isFinite(sampleGrid(data, 2, 2, 2, 99, -99, -32768, -1)), 'clamped, never throws');
  });
});

describe('ops3d DEM delivery (fidelity pass: progression, seams, zoom, sources)', () => {
  afterEach(() => _cacheMemClear());

  const seedMosaic = () => {
    const res = [1 / 3600, -1 / 3600];
    const mk = (origin, win) => {
      const ww = win.right - win.left, hh = win.bottom - win.top;
      const data = new Int16Array(ww * hh);
      for (let z = 0; z < hh; z++) for (let x = 0; x < ww; x++) data[z * ww + x] = Math.round(250 + 0.15 * x);
      const [, dy] = res;
      return {
        origin, res, win, data, ww, hh, noData: -32768,
        latTop: origin[1] + win.top * dy, latBot: origin[1] + win.bottom * dy,
        lonLeft: origin[0], dx: res[0],
      };
    };
    _cacheMemSeed('N57W112', mk([-112, 58], { left: 677, top: 3233, right: 1628, bottom: 3601 }));
    _cacheMemSeed('N56W112', mk([-112, 57], { left: 677, top: 0, right: 1628, bottom: 152 }));
  };

  it('progression order: warm load emits loading→cache with one onProgress stage', async () => {
    seedMosaic();
    const seen = [];
    const unsub = onDemStatus((s) => seen.push(s.stage));
    const prog = [];
    const r = await loadDEM({ fetchTimeoutMs: 4000, onProgress: (res) => prog.push(res.meta.stage) });
    unsub();
    assert.equal(r.terrainSource, 'dem');
    assert.equal(r.meta.stage, 'cache');
    assert.deepEqual(prog, ['cache']);
    assert.ok(seen.includes('loading'), `saw ${seen}`);
    assert.equal(seen[seen.length - 1], 'cache');
    assert.ok(seen.indexOf('loading') < seen.lastIndexOf('cache'), 'loading precedes cache');
  });

  it('progression order: cold failure ends procedural, never emits a dem stage', async () => {
    const prog = [];
    const r = await loadDEM({
      url: 'https://127.0.0.1:9/nope.tif', fetchTimeoutMs: 300,
      coarseBudgetMs: 100, onProgress: (res) => prog.push(res.meta.stage),
    });
    assert.equal(r.terrainSource, 'procedural');
    assert.equal(r.meta.stage, 'procedural');
    assert.deepEqual(prog, []);
    assert.equal(getDemStatus().stage, 'procedural');
  });

  it('stage enum is ordered idle→loading→coarse→fine→cache→procedural', () => {
    const idx = (s) => DEM_STAGES.indexOf(s);
    assert.ok(idx('idle') < idx('loading'));
    assert.ok(idx('loading') < idx('coarse') && idx('coarse') < idx('fine'));
    assert.equal(DEM_NATIVE_RES_M, 30);
    assert.ok(SEAM_BLEND_DEG > 0 && SEAM_BLEND_DEG < 0.01);
  });

  // Two synthetic tiles sharing a continuous lat-gradient field across the
  // 57°N edge; the north tile carries a +10 m bias (worst case: per-tile
  // source mismatch). Feathering must keep the step well under the bias.
  const seamTiles = (biasN = 10) => {
    const res = [1 / 3600, -1 / 3600];
    const mk = (origin, win, bias) => {
      const ww = win.right - win.left, hh = win.bottom - win.top;
      const data = new Int16Array(ww * hh);
      for (let z = 0; z < hh; z++) {
        for (let x = 0; x < ww; x++) {
          const lon = origin[0] + (win.left + x) * res[0];
          const plat = origin[1] + (win.top + z) * res[1];
          data[z * ww + x] = Math.round(300 + 500 * (plat - 56.9) + 0.05 * (lon + 111.68) * 1000 + bias);
        }
      }
      const [, dy] = res;
      return {
        origin, res, win, data, ww, hh, noData: -32768,
        latTop: origin[1] + win.top * dy, latBot: origin[1] + win.bottom * dy,
      };
    };
    return [
      mk([-112, 58], { left: 677, top: 3233, right: 1628, bottom: 3601 }, biasN),
      mk([-112, 57], { left: 677, top: 0, right: 1628, bottom: 152 }, 0),
    ];
  };

  it('mosaic seams: biased tiles feather across the 57°N edge, no step', () => {
    const tiles = seamTiles(10);
    const seam = (tiles[0].latBot + tiles[1].latTop) / 2;
    const d = 0.0002;
    const below = mosaicSample(tiles, -111.68, seam - d, -1);
    const above = mosaicSample(tiles, -111.68, seam + d, -1);
    assert.ok(Math.abs(above - below) * 1000 < 5, `step ${Math.abs(above - below) * 1000} m < 5 m (bias 10 m)`);
    const mid = mosaicSample(tiles, -111.68, seam, -1);
    const field = (300 + 500 * (seam - 56.9)) / 1000;
    assert.ok(Math.abs(mid - field) * 1000 < 6, `midpoint feathered ${mid} vs field ${field}`);
  });

  it('mosaic seams: unbiased tiles cross continuously, singles + empty are safe', () => {
    const tiles = seamTiles(0);
    const seam = (tiles[0].latBot + tiles[1].latTop) / 2;
    const d = 0.0002;
    const step = Math.abs(mosaicSample(tiles, -111.68, seam + d, -1) - mosaicSample(tiles, -111.68, seam - d, -1)) * 1000;
    assert.ok(step < 1, `continuous crossing, step ${step} m`);
    assert.equal(mosaicSample([], 0, 0, -1), -1);
    const single = mosaicSample([tiles[1]], -111.68, 56.97, -1);
    assert.ok(Number.isFinite(single) && single > 0.2 && single < 0.5, `single tile ${single}`);
  });

  it('downsampleGrid box-averages, skips no-data, keeps float precision', () => {
    const data = new Int16Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const { data: out, ww, hh } = downsampleGrid(data, 4, 4, 2);
    assert.equal(ww, 2); assert.equal(hh, 2);
    assert.deepEqual([...out], [2.5, 4.5, 10.5, 12.5]);
    const hole = new Int16Array([0, -32768, 2, 3]);
    assert.ok(Math.abs(downsampleGrid(hole, 2, 2, 2, -32768).data[0] - 5 / 3) < 1e-9, 'no-data excluded');
    assert.equal(downsampleGrid(new Int16Array([-32768, -32768, -32768, -32768]), 2, 2, 2, -32768).data[0], -32768);
    const same = downsampleGrid(data, 4, 4, 1);
    assert.equal(same.data, data, 'step 1 is a passthrough');
  });

  it('detailStepForRange: full 30 m near, decimated far, monotonic', () => {
    assert.equal(detailStepForRange(5), 1);
    assert.equal(detailStepForRange(11.9), 1);
    assert.equal(detailStepForRange(12), 2);
    assert.equal(detailStepForRange(29), 2);
    assert.equal(detailStepForRange(30), 4);
    assert.equal(detailStepForRange(100), 4);
    assert.equal(detailStepForRange(0), 1);
    assert.equal(detailStepForRange(NaN), 1);
  });

  it('sources: SRTM primary, Copernicus fallback URL well-formed per tile', () => {
    const urls = demTileUrls('N57W112');
    assert.equal(urls.length, 2);
    assert.match(urls[0], /SRTM_GL1.*N57W112\.tif/);
    assert.equal(
      copernicusTileUrl('N57W112'),
      'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N57_00_W112_00_DEM/Copernicus_DSM_COG_10_N57_00_W112_00_DEM.tif',
    );
    assert.match(copernicusTileUrl('N56W112'), /N56_00_W112_00/);
    assert.equal(copernicusTileUrl('XX'), null);
  });

  it('cache versioning intact: keys unchanged, corrupt payloads evicted', async () => {
    assert.equal(demCacheKey('N57W112'), `srtm-dem:v${DEM_CACHE_VERSION}:N57W112`);
    _cacheMemSeed('__override__', { ww: 4, hh: 4, data: new Int16Array([1, 2, 3]) });
    const r = await loadDEM({ url: 'https://127.0.0.1:9/nope.tif', fetchTimeoutMs: 200, coarseBudgetMs: 50 });
    assert.equal(r.terrainSource, 'procedural');
  });

  it('coarse crop anchors the site pixel, clamps to the window', () => {
    assert.equal(COARSE_EXTENT_PX, 1200);
    const res = [1 / 3600, -1 / 3600];
    // North tile: site row 3492 well inside — crop surrounds it.
    const nCrop = coarseCropForSite([-112, 58], res, { left: 0, top: 2780, right: 2458, bottom: 3601 });
    assert.ok(nCrop.left <= 1152 && 1152 <= nCrop.right, `site col inside ${JSON.stringify(nCrop)}`);
    assert.ok(nCrop.top <= 3492 && 3492 <= nCrop.bottom, `site row inside ${JSON.stringify(nCrop)}`);
    assert.ok(nCrop.right - nCrop.left <= COARSE_EXTENT_PX + 2 && nCrop.bottom - nCrop.top <= COARSE_EXTENT_PX + 2);
    // South tile: site row lies above the tile — crop pins to the top edge.
    const sCrop = coarseCropForSite([-112, 57], res, { left: 0, top: 0, right: 2458, bottom: 603 });
    assert.equal(sCrop.top, 0);
    assert.ok(sCrop.bottom - sCrop.top >= 8 && sCrop.right - sCrop.left >= 8);
    // Degenerate window → null (caller notes + skips, never throws).
    assert.equal(coarseCropForSite([-112, 58], res, { left: 0, top: 0, right: 4, bottom: 4 }), null);
  });

  it('mosaic strict crops: inside samples tile, outside falls through, never smears', () => {
    const res = [1 / 3600, -1 / 3600];
    const win = { left: 552, top: 3042, right: 1752, bottom: 3601 };
    const ww = win.right - win.left, hh = win.bottom - win.top;
    const data = new Int16Array(ww * hh).fill(350);
    const cropTile = {
      origin: [-112, 58], res, win, data, ww, hh, crop: true, noData: -32768,
      latTop: 58 + win.top * res[1], latBot: 58 + win.bottom * res[1],
    };
    // Site center (inside crop) reads the tile value.
    assert.ok(Math.abs(mosaicSample([cropTile], SITE.lon, SITE.lat, -1) - 0.35) < 1e-9, 'inside crop');
    // Far outside the crop (but inside the tile footprint) → fallback, not edge smear.
    assert.equal(mosaicSample([cropTile], -111.0, 57.5, -1), -1);
    // Crop + full tile mix: outside-crop points use the full tile.
    const full = { ...cropTile, win: { left: 0, top: 2780, right: 2458, bottom: 3601 }, ww: 2458, hh: 821, crop: false, data: new Int16Array(2458 * 821).fill(400), latTop: 58 + 2780 * res[1], latBot: 58 + 3601 * res[1] };
    assert.ok(Math.abs(mosaicSample([cropTile, full], -111.0, 57.5, -1) - 0.4) < 1e-9, 'falls through to full tile');
  });
});

describe('ops3d DEM Terrarium primary (task-0: tile math, decode, staging)', () => {
  afterEach(() => { _cacheMemClear(); _injectTerrariumFetcher(null); });

  it('slippy tile math pins the verified site tiles (z13/z14/z15)', () => {
    assert.deepEqual(latLonToTile(57.03, -111.68, 13), { x: 1554, y: 2508 });
    assert.deepEqual(latLonToTile(57.03, -111.68, 14), { x: 3109, y: 5016 });
    assert.deepEqual(latLonToTile(57.03, -111.68, 15), { x: 6218, y: 10033 });
    assert.equal(TERRARIUM_MAXZOOM, 15);
    assert.equal(
      terrariumTileUrl(15, 6218, 10033),
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/6218/10033.png',
    );
  });

  it('decode: elev = R*256+G+B/256-32768 (verified site px 323.1 m)', () => {
    assert.ok(Math.abs(terrariumDecodePixel(129, 67, 31) - 323.12) < 0.01, 'site pixel');
    assert.equal(terrariumDecodePixel(0, 0, 0), -32768);
    assert.ok(Math.abs(terrariumDecodePixel(255, 255, 255) - 32768) < 1, 'max white');
  });

  it('RGBA decode is pure: synthetic 2x2 tile', () => {
    const enc = (elev) => {
      const v = elev + 32768;
      const R = Math.floor(v / 256), G = Math.floor(v % 256), B = Math.round((v - Math.floor(v)) * 256);
      return [R, G, B, 255];
    };
    const rgba = new Uint8ClampedArray([...enc(0), ...enc(100.5)]);
    const out = terrariumElevationsFromRGBA(rgba, 2, 1);
    assert.ok(Math.abs(out[0]) < 0.01, `zero ${out[0]}`);
    assert.ok(Math.abs(out[1] - 100.5) < 0.01, `gradient ${out[1]}`);
  });

  it('posting halves per zoom (z13 ≈ 10.4 m/px at the site; effective 20 m)', () => {
    const r13 = terrariumResM(13);
    assert.ok(Math.abs(r13 - 10.4) < 0.5, `z13 posting ${r13}`);
    assert.ok(Math.abs(terrariumResM(14) * 2 - r13) < 1e-9, 'z14 halves');
    assert.ok(Math.abs(terrariumResM(15) * 4 - r13) < 1e-9, 'z15 quarters');
    assert.equal(TERRARIUM_EFFECTIVE_RES_M, 20);
    assert.equal(TERRARIUM_TILE_PX, 256);
  });

  it('zoom staging: z13 window bounded, z15 full-window impractical (capped, never whole)', () => {
    const w13 = terrariumWindowTiles(13);
    const c13 = terrariumTileCount(w13);
    assert.ok(c13 >= 100 && c13 <= 500, `z13 full-window ${c13} tiles`);
    assert.ok(w13.x0 <= 1554 && 1554 <= w13.x1 && w13.y0 <= 2508 && 2508 <= w13.y1, 'site tile inside');
    const w15 = terrariumWindowTiles(15);
    assert.ok(terrariumTileCount(w15) > 1000, `z15 full-window ${terrariumTileCount(w15)} — must cap, never fetch whole`);
  });

  it('tile-pixel helpers round-trip lon/lat at the site pixel', () => {
    const fp = lonLatToTilePixel(SITE.lon, SITE.lat, 15);
    assert.deepEqual({ x: fp.x, y: fp.y }, { x: 6218, y: 10033 });
    assert.ok(Math.abs(fp.px - 163) < 2 && Math.abs(fp.py - 203) < 2, `site pixel ${fp.px},${fp.py}`);
    const ll = tilePixelToLonLat(fp.x, fp.y, fp.px, fp.py, 15);
    assert.ok(Math.abs(ll.lon - SITE.lon) < 1e-6 && Math.abs(ll.lat - SITE.lat) < 1e-6, 'round-trip');
  });

  it('stitch: constant tile samples through the mosaic at full validFrac', () => {
    const S = TERRARIUM_TILE_PX;
    const rgba = new Uint8ClampedArray(S * S * 4);
    for (let i = 0; i < S * S; i++) { rgba[i * 4] = 129; rgba[i * 4 + 1] = 67; rgba[i * 4 + 2] = 31; rgba[i * 4 + 3] = 255; }
    const st = stitchTerrariumGrid([{ x: 6218, y: 10033, grid: terrariumElevationsFromRGBA(rgba) }], 15, 256);
    assert.equal(st.ww, 256); assert.equal(st.hh, 256);
    assert.equal(st.validFrac, 1);
    const payload = {
      origin: [st.bbox.lonLeft, st.bbox.latTop],
      res: [(st.bbox.lonRight - st.bbox.lonLeft) / st.ww, -(st.bbox.latTop - st.bbox.latBot) / st.hh],
      win: { left: 0, top: 0, right: st.ww, bottom: st.hh },
      data: st.data, ww: st.ww, hh: st.hh, noData: -32768,
      latTop: st.bbox.latTop, latBot: st.bbox.latBot,
    };
    assert.ok(Math.abs(mosaicSample([payload], SITE.lon, SITE.lat, -1) - 0.32312) < 0.001, 'site reads 323 m');
  });

  it('source order: Terrarium primary, SRTM→Copernicus fallback, Copernicus last', () => {
    const urls = demTileUrls('N57W112');
    assert.equal(urls.length, 2);
    assert.match(urls[0], /SRTM_GL1/);
    assert.match(urls[1], /copernicus-dem-30m/, 'Copernicus last (no browser CORS)');
  });
});

// Synthetic Terrarium PNG supplier: E-W elevation gradient so relief probes
// pass with zero network. elev = base + (globalTilePx)*k.
const terrariumGradientFetcher = (metersPerPx = 0.1, baseM = 300) => async (url, _signal) => {
  const m = /terrarium\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
  assert.ok(m, `tile url ${url}`);
  const tx = Number(m[2]), ty = Number(m[3]);
  const S = TERRARIUM_TILE_PX;
  const rgba = new Uint8ClampedArray(S * S * 4);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const elev = baseM + (tx * S + i) * metersPerPx + (ty * S + j) * 0.001;
      const v = elev + 32768;
      const R = Math.floor(v / 256), G = Math.floor(v % 256), B = Math.round((v - Math.floor(v)) * 256);
      const o = (j * S + i) * 4;
      rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = 255;
    }
  }
  return rgba;
};

describe('ops3d DEM Terrarium staging (fetch → stitch → layer)', () => {
  afterEach(() => { _cacheMemClear(); _injectTerrariumFetcher(null); });

  it('loadTerrariumStage stitches injected tiles; mosaic reads the gradient', async () => {
    _injectTerrariumFetcher(terrariumGradientFetcher());
    const r = await loadTerrariumStage(13, { extentKm: 4, maxPx: 256, budgetMs: 5000 });
    assert.ok(r && r.src === 'terrarium-z13', `stage ${r?.src}`);
    assert.ok(r.terrTiles >= 1 && r.terrTiles <= r.terrTotal);
    assert.ok(r.terrValidFrac > 0.9, `validFrac ${r.terrValidFrac}`);
    const w = r.win.right - r.win.left;
    const west = mosaicSample([r], r.origin[0] + r.res[0] * w * 0.1, SITE.lat, -1);
    const east = mosaicSample([r], r.origin[0] + r.res[0] * w * 0.9, SITE.lat, -1);
    assert.ok(Number.isFinite(west) && Number.isFinite(east), 'finite samples');
    assert.ok(east - west > 0.005, `E-W gradient ${(east - west) * 1000} m`);
  });

  it('fine zoom honors maxTiles (z15 progressive, never full-window)', async () => {
    let fetches = 0;
    _injectTerrariumFetcher(async (url, signal) => { fetches++; return terrariumGradientFetcher()(url, signal); });
    const r = await loadTerrariumStage(15, { extentKm: SITE.extentKm, maxPx: 256, budgetMs: 10000, maxTiles: 4 });
    assert.ok(r, 'stage resolves');
    assert.ok(fetches <= 4, `fetched ${fetches} ≤ 4`);
    assert.equal(r.terrTotal, 4);
  });

  it('Terrarium-primary pipeline resolves dem with injected PNGs (SRTM budgeted out)', async () => {
    _injectTerrariumFetcher(terrariumGradientFetcher(0.15));
    const prog = [];
    const r = await loadDEM({
      fetchTimeoutMs: 300, coarseBudgetMs: 300,
      onProgress: (res) => prog.push(res.meta.stage),
    });
    assert.equal(r.terrainSource, 'dem');
    assert.equal(r.meta.src, 'terrarium');
    assert.equal(r.meta.stage, 'fine');
    assert.ok(r.meta.reliefKm > 0.08, `relief ${r.meta.reliefKm}`);
    assert.ok(r.meta.timings && typeof r.meta.timings.terrCoarseMs === 'number', 'phase timings recorded');
    assert.ok(prog.includes('coarse') && prog[prog.length - 1] === 'fine', `progression ${prog}`);
  }, { timeout: 30000 });
});

describe('ops3d DEM site parametrization (?site=<lat>,<lon> / opts.site)', () => {
  afterEach(() => { _cacheMemClear(); _injectTerrariumFetcher(null); });

  it('parseSiteParam accepts lat,lon, rejects garbage + out-of-SRTM range', () => {
    assert.deepEqual(parseSiteParam('57.03,-111.68'), { lat: 57.03, lon: -111.68 });
    assert.deepEqual(parseSiteParam('-23.95, -46.63'), { lat: -23.95, lon: -46.63 });
    assert.deepEqual(parseSiteParam('2.3 45.1'), { lat: 2.3, lon: 45.1 });
    assert.equal(parseSiteParam(null), null);
    assert.equal(parseSiteParam(''), null);
    assert.equal(parseSiteParam('abc,def'), null);
    assert.equal(parseSiteParam('57.03'), null);
    assert.equal(parseSiteParam('57.03,-111.68,4'), null, 'extent below 5 km rejected');
    assert.deepEqual(parseSiteParam('57.03,-111.68,5'), { lat: 57.03, lon: -111.68, extentKm: 5 });
    assert.deepEqual(parseSiteParam('40.20,49.48,20'), { lat: 40.20, lon: 49.48, extentKm: 20 });
    assert.equal(parseSiteParam('61,-111.68'), null, 'lat > 60 outside SRTM GL1');
    assert.equal(parseSiteParam('-61,0'), null, 'lat < -60 outside SRTM GL1');
    assert.equal(parseSiteParam('0,181'), null, 'lon > 180');
  });

  it('resolveSite: opts.site wins, then ?site=, then default (garbage → default)', () => {
    assert.deepEqual(resolveSite(), { lat: 57.03, lon: -111.68, extentKm: 44 });
    assert.deepEqual(resolveSite(null, '-23.95,-46.63'), { lat: -23.95, lon: -46.63, extentKm: 44 });
    assert.deepEqual(
      resolveSite({ lat: 2.3, lon: 45.1 }, '-23.95,-46.63'),
      { lat: 2.3, lon: 45.1, extentKm: 44 },
      'explicit opts.site beats the param',
    );
    assert.deepEqual(resolveSite('garbage', 'also-bad'), { lat: 57.03, lon: -111.68, extentKm: 44 });
    assert.deepEqual(resolveSite('40.20,49.48,20'), { lat: 40.20, lon: 49.48, extentKm: 20 }, 'Sangachal keeps 20 km');
    assert.deepEqual(resolveSite({ lat: 75, lon: 0 }), { lat: 57.03, lon: -111.68, extentKm: 44 }, 'out-of-range → default');
  });

  it('srtmTileName derives the SW-corner pattern in all quadrants', () => {
    assert.equal(srtmTileName(57.03, -111.68), 'N57W112');
    assert.equal(srtmTileName(-23.55, -46.63), 'S24W047');
    assert.equal(srtmTileName(2.3, 45.1), 'N02E045');
    assert.equal(srtmTileName(-0.5, 100.9), 'S01E100');
  });

  it('srtmTileNames: Fort McMurray ≡ DEM_TILES; southern straddle crosses rows', () => {
    assert.deepEqual(srtmTileNames(57.03, -111.68), ['N57W112', 'N56W112']);
    assert.deepEqual(srtmTileNames(57.03, -111.68), [...DEM_TILES], 'default pin: zero behavior change');
    assert.deepEqual(srtmTileNames(-23.95, -46.63), ['S24W047', 'S25W047'], 'window crosses 24°S');
    assert.deepEqual(srtmTileNames(-23.55, -46.63), ['S24W047'], 'single row when clear');
    assert.match(copernicusTileUrl('S24W047'), /S24_00_W047_00/, 'Copernicus key derives from the same name');
  });

  it('z12 coarse window is ~9×9 (first-paint bounded); site tile 777/1254', () => {
    assert.equal(TERRARIUM_COARSE_ZOOM, 12);
    assert.deepEqual(latLonToTile(57.03, -111.68, 12), { x: 777, y: 1254 });
    const w12 = terrariumWindowTiles(12);
    assert.equal(terrariumTileCount(w12), 81, '9×9 full-window');
    assert.ok(w12.x0 <= 777 && 777 <= w12.x1 && w12.y0 <= 1254 && 1254 <= w12.y1, 'site tile inside');
    const s12 = terrariumWindowTiles(12, { lat: -23.95, lon: -46.63, extentKm: 44 });
    assert.ok(terrariumTileCount(s12) >= 25 && terrariumTileCount(s12) <= 64, `southern window ${terrariumTileCount(s12)}`);
  });

  it('loadDEM({site}) builds for that location: meta.site + derived tiles', async () => {
    _injectTerrariumFetcher(terrariumGradientFetcher());
    const r = await loadDEM({
      site: { lat: -23.95, lon: -46.63 }, fetchTimeoutMs: 300, coarseBudgetMs: 300,
    });
    assert.equal(r.terrainSource, 'dem');
    assert.deepEqual(r.meta.site, { lat: -23.95, lon: -46.63 });
    assert.ok(r.meta.reliefKm > 0.08, `relief ${r.meta.reliefKm}`);
  }, { timeout: 30000 });

  it('loadDEM default meta.site is the Fort McMurray pin', async () => {
    const r = await loadDEM({ url: 'https://127.0.0.1:9/nope.tif', fetchTimeoutMs: 200 });
    assert.deepEqual(r.meta.site, { lat: 57.03, lon: -111.68 });
  });

  it('apron samples follow real relief, never edge-clamped plateaus', async () => {
    assert.equal(TWIN_MESH_EXTENT_KM, 44, 'coarse footprint contract = terrain mesh size');
    _injectTerrariumFetcher(terrariumGradientFetcher());
    const r = await loadDEM({
      site: { lat: 40.20, lon: 49.48, extentKm: 20 }, fetchTimeoutMs: 300, coarseBudgetMs: 300,
    });
    assert.equal(r.terrainSource, 'dem');
    // ±18–22 km: inside the 44 km twin mesh, outside the 20 km site window.
    // A clamped mosaic edge returns the SAME pixel twice (the streak
    // mechanism); real relief differs between the two points.
    for (const [a, b] of [[ [18, 0], [22, 0] ], [ [-18, 0], [-22, 0] ], [ [0, 18], [0, 22] ]]) {
      const va = r.sample(a[0], a[1]);
      const vb = r.sample(b[0], b[1]);
      assert.ok(Math.abs(va - vb) > 1e-9, `apron ${a}→${b} is a clamped plateau (${va})`);
    }
  }, { timeout: 30000 });

  it('Terrarium stage cache keys are site-scoped', async () => {
    const { terrStageCacheKey } = await import('../src/ops3d/dem.js');
    const fm = { lat: 57.03, lon: -111.68, extentKm: 44 };
    const sang = { lat: 40.20, lon: 49.48, extentKm: 20 };
    assert.notEqual(
      terrStageCacheKey('terr-z', 12, fm),
      terrStageCacheKey('terr-z', 12, sang),
      'two gallery tabs must never share a stage entry',
    );
    assert.equal(
      terrStageCacheKey('terr-z', 12, sang),
      terrStageCacheKey('terr-z', 12, { lat: 40.20, lon: 49.48 }),
      'same site + zoom is a stable key',
    );
    assert.notEqual(
      terrStageCacheKey('terr-z', 12, sang),
      terrStageCacheKey('terr-z', 15, sang),
      'zoom is part of the key',
    );
  });

  it('reliefPassesGate: 80 m SRTM bar, 25 m Terrarium bar (CDEM ~38 m here)', () => {
    assert.equal(DEM_RELIEF_MIN_KM, 0.08);
    assert.equal(TERRARIUM_RELIEF_MIN_KM, 0.025);
    assert.equal(reliefPassesGate(0.09), true);
    assert.equal(reliefPassesGate(0.05), false, 'SRTM-only 50 m rejected');
    assert.equal(reliefPassesGate(0.05, true), true, 'Terrarium 50 m passes');
    assert.equal(reliefPassesGate(0.038, true), true, 'verified site relief passes');
    assert.equal(reliefPassesGate(0.01, true), false, 'near-flat still rejected');
    assert.equal(reliefPassesGate(0), false);
  });

  it('low-relief Terrarium (~30 m) resolves dem (SRTM bar would reject)', async () => {
    _injectTerrariumFetcher(terrariumGradientFetcher(0.038));
    const c = await loadTerrariumStage(12, { extentKm: 44, maxPx: 1100, budgetMs: 10000, cacheName: terrStageCacheKey('terr-z', 12, SITE) });
    const f = await loadTerrariumStage(15, { extentKm: 12, maxPx: 1200, maxTiles: 48, budgetMs: 10000, cacheName: terrStageCacheKey('terr-f', 15, SITE) });
    assert.ok(c && f, 'stages seed the cache');
    _injectTerrariumFetcher(null);
    const prog = [];
    const r = await loadDEM({ fetchTimeoutMs: 300, coarseBudgetMs: 300, onProgress: (res) => prog.push(res.meta.stage) });
    assert.equal(r.terrainSource, 'dem');
    assert.ok(prog.includes('coarse'), `progression ${prog}`);
  }, { timeout: 30000 });
});

describe('ops3d DEM bus + budgets (task-1)', () => {
  afterEach(() => { _cacheMemClear(); _injectTerrariumFetcher(null); });

  it('status bus is pinned to globalThis and snapshots are copies', () => {
    assert.ok(globalThis.__safepipeDem, 'shared bus object');
    assert.ok(globalThis.__safepipeDem.listeners instanceof Set, 'shared listeners');
    const a = getDemStatus();
    a.stage = 'hacked'; a.fromCache.push('x');
    assert.notEqual(getDemStatus().stage, 'hacked', 'snapshot is a copy');
    assert.deepEqual(getDemStatus().fromCache.includes('x'), false, 'fromCache is a copy');
    const seen = [];
    const unsub = onDemStatus((s) => seen.push(s.stage));
    assert.ok(seen.length >= 1, 'immediate snapshot on subscribe');
    unsub();
  });

  it('cold-failure meta carries timings + null coarseError + procedural src', async () => {
    const r = await loadDEM({ url: 'https://127.0.0.1:9/nope.tif', fetchTimeoutMs: 200 });
    assert.equal(r.terrainSource, 'procedural');
    assert.equal(r.meta.src, 'procedural');
    assert.ok(typeof r.meta.coarseError === 'string' && r.meta.coarseError.includes('__override__'), `coarse notes recorded: ${r.meta.coarseError}`);
    assert.ok(r.meta.timings && typeof r.meta.timings.cacheMs === 'number', 'timings recorded');
    assert.ok(typeof r.meta.wallMs === 'number', 'wallMs recorded');
  });

  it('warm-cache result carries timings + src contract', async () => {
    const res = [1 / 3600, -1 / 3600];
    const mk = (origin, win) => {
      const ww = win.right - win.left, hh = win.bottom - win.top;
      const data = new Int16Array(ww * hh);
      for (let z = 0; z < hh; z++) for (let x = 0; x < ww; x++) data[z * ww + x] = Math.round(250 + 0.15 * x);
      const [, dy] = res;
      return {
        origin, res, win, data, ww, hh, noData: -32768,
        latTop: origin[1] + win.top * dy, latBot: origin[1] + win.bottom * dy,
        lonLeft: origin[0], dx: res[0],
      };
    };
    _cacheMemSeed('N57W112', mk([-112, 58], { left: 677, top: 3233, right: 1628, bottom: 3601 }));
    _cacheMemSeed('N56W112', mk([-112, 57], { left: 677, top: 0, right: 1628, bottom: 152 }));
    const r = await loadDEM({ fetchTimeoutMs: 4000 });
    assert.equal(r.meta.stage, 'cache');
    assert.ok(typeof r.meta.src === 'string', 'src present');
    assert.equal(r.meta.coarseError, null);
    assert.ok(r.meta.timings && typeof r.meta.timings.cacheMs === 'number', 'timings present');
  });

  it('global budget expiry cuts a hung pipeline: procedural + flag, fast', async () => {
    _injectTerrariumFetcher((_url, signal) => new Promise((_res, rej) => {
      signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
    }));
    assert.ok(GLOBAL_BUDGET_MS >= 30000, `global default ${GLOBAL_BUDGET_MS}`);
    const t0 = Date.now();
    const r = await loadDEM({ fetchTimeoutMs: 200, coarseBudgetMs: 50, skipCoarse: true, globalBudgetMs: 150 });
    assert.ok(Date.now() - t0 < 10000, 'budget cuts the pipeline');
    assert.equal(r.terrainSource, 'procedural');
    assert.equal(r.meta.globalBudgetExpired, true);
  });
});
