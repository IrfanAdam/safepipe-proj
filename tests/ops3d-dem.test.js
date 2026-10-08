import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, levelsForRange, loadDEM, sampleProcedural } from '../src/ops3d/dem.js';

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
});
