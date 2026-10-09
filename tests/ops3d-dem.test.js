import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, DEM_TILES, levelsForRange, loadDEM, sampleProcedural, geoWindowForSite, sampleGrid, demCacheKey, DEM_CACHE_VERSION, _cacheMemSeed, _cacheMemClear, mosaicSample, downsampleGrid, detailStepForRange, copernicusTileUrl, demTileUrls, getDemStatus, onDemStatus, DEM_NATIVE_RES_M, DEM_STAGES, SEAM_BLEND_DEG, coarseCropForSite, COARSE_EXTENT_PX } from '../src/ops3d/dem.js';

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
