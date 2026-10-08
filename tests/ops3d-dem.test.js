import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, DEM_TILES, levelsForRange, loadDEM, sampleProcedural, geoWindowForSite, sampleGrid } from '../src/ops3d/dem.js';

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
