import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { field } from '../src/ops3d/terrain.js';
import { SITE, DEM_URL, DEM_TILES, levelsForRange, geoWindowForSite } from '../src/ops3d/dem.js';

/* Ops 3D terrain accuracy gates (Phase 1, Tasks 6–9).
 * Ground truth: Copernicus 30 m DEM via Open-Meteo elevation API, 5×5 grid
 * over the 44 km window centered 57.03N −111.68W, fetched 2026-10-08:
 *   REAL = { reliefM: 277 (252–529 m), sdM: 65, valleyWallWm: ~130,
 *            valleyFloorM: ~260–290, plateauWm: ~400–530, plateauEm: ~300–410 }
 * Procedural readings below are measured values of field() on an 89×89 grid
 * over the same 44 km extent (see plan Phase 1 accuracy table). Bands are
 * set around CURRENT values as regression gates; the gap to REAL is the
 * documented shortfall each rating refers to — tighten bands as fidelity
 * improves, never to hide the gap.
 * [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 */
const REAL = Object.freeze({
  reliefM: 277,
  sdM: 65,
  valleyWallWm: 130,
  source: 'Copernicus30m@open-meteo 2026-10-08, 25-pt grid, 44km window',
});

function gridStats(n = 89) {
  let mn = Infinity, mx = -Infinity, sum = 0;
  const vals = [];
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const h = field(-22 + (44 * ix) / (n - 1), -22 + (44 * iz) / (n - 1));
      vals.push(h);
      sum += h;
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
  }
  const mean = sum / vals.length;
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  return { mnM: mn * 1000, mxM: mx * 1000, reliefM: (mx - mn) * 1000, sdM: sd * 1000 };
}

/* West-wall valley depth at three latitudes: river-center vs 6 km west. */
function valleyWallW(z) {
  const rx = 7.5 + 3.5 * Math.sin(z * 0.16 + 0.8) + 1.2 * Math.sin(z * 0.41 + 2.0);
  return (field(rx - 6, z) - field(rx, z)) * 1000;
}

describe('ops3d terrain accuracy (phase 1 vs Copernicus ground truth)', () => {
  it('Task 8 — relief is ~99% of real 277 m (now ~274 m, gap: under by ~1%)', () => {
    const s = gridStats();
    assert.ok(s.reliefM > 255 && s.reliefM < 290, `relief ${s.reliefM.toFixed(0)} m (real ${REAL.reliefM} m)`);
  });

  it('Task 8 — terrain variance sd is ~74% of real 65 m (now ~48 m)', () => {
    const s = gridStats();
    assert.ok(s.sdM > 42 && s.sdM < 54, `sd ${s.sdM.toFixed(1)} m (real ${REAL.sdM} m)`);
  });

  it('Task 8 — west valley wall averages ~87% of real ~130 m cut', () => {
    const walls = [0, 5, -5].map(valleyWallW);
    const avg = walls.reduce((a, v) => a + v, 0) / walls.length;
    assert.ok(avg > 95 && avg < 135, `avg W-wall ${avg.toFixed(1)} m (real ~${REAL.valleyWallWm} m)`);
    for (const w of walls) assert.ok(w > 70, `no reach shallower than 70 m (got ${w.toFixed(1)})`);
  });

  it('Task 8 — valley is asymmetric (steep E cutbank, gentle W bars)', () => {
    // East wall must exist but read differently from the west wall at z=0.
    const rx = 7.5 + 3.5 * Math.sin(0.8) + 1.2 * Math.sin(2.0);
    const w = (field(rx - 6, 0) - field(rx, 0)) * 1000;
    const e = (field(rx + 6, 0) - field(rx, 0)) * 1000;
    assert.ok(Math.abs(w - e) > 30, `W ${w.toFixed(0)} m vs E ${e.toFixed(0)} m — asymmetry required`);
  });

  it('Task 6 — SITE pin + tile agree with ground-truth window', () => {
    assert.ok(Math.abs(SITE.lat - 57.03) < 0.01 && Math.abs(SITE.lon - -111.68) < 0.01);
    assert.equal(SITE.tile, 'N57W112');
    assert.match(DEM_URL, /N57W112\.tif/);
    assert.equal(SITE.extentKm, 44);
  });

  it('Task 7 — contour endpoints stay within 2% of span on the REAL band', () => {
    // Real DEM band over the window, km-relative: 252–529 m → span 0.277.
    const levels = levelsForRange(0.252, 0.529, 32);
    const span = 0.529 - 0.252;
    assert.equal(levels.length, 32);
    assert.ok(Math.abs(levels[0] - 0.252) < 0.02 * span, 'lo edge ±2% of real band');
    assert.ok(Math.abs(levels[31] - 0.529) < 0.02 * span, 'hi edge ±2% of real band');
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] > levels[i - 1]);
  });

  it('Task 6 — DEM mosaic covers the full site window (georeferenced, no squeeze)', () => {
    // SRTM GL1 geometry; both pinned tiles must own part of the 44 km window
    // with the site center landing in the north tile at the right pixels.
    const r = 1 / 3600;
    const nWin = geoWindowForSite([-112, 58], [r, -r], 3601, 3601);
    const sWin = geoWindowForSite([-112, 57], [r, -r], 3601, 3601);
    assert.deepEqual([...DEM_TILES], ['N57W112', 'N56W112']);
    assert.ok(nWin && sWin, 'both tiles window the site');
    const cx = (SITE.lon + 112) / r, cz = (SITE.lat - 58) / -r;
    assert.ok(nWin.left <= cx && cx <= nWin.right && nWin.top <= cz && cz <= nWin.bottom);
    assert.ok(nWin.right - nWin.left < 3601, 'windowed read, never whole-tile');
    assert.equal(sWin.top, 0, 'south tile owns the south edge the north tile cannot see');
  });
});
