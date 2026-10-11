// tests/ring2-coastline.test.js — Phase 01, Tasks 5-7 ground-truth check.
//
// Pinned coastline comparison at 4 transect latitudes near 40.20N:
//   OSM coastline (cached asset public/data/sangachal-vectors.json, ODbL,
//     OSM base 2026-10-11T15:19:57Z — DO NOT regenerate in this lane)
//   vs the live twin shoreline (CASPIAN_SHORE_H = -24 render key over
//   sampleH; in this offline test env sampleH falls through to
//   proceduralH, so the twin side pins the procedural fallback crossing).
//
// Transect truth (verified 2026-10-11 against the disc-clipped asset):
//   lat 40.190000 -> OSM lon 49.505907 (single crossing)
//   lat 40.195000 -> OSM lon 49.511461 (single crossing)
//   lat 40.201262 -> OSM lons 49.523285 / 49.526771 / 49.526791 (bay wiggle,
//     3 hits — nearest hit is used for the deviation budget)
//   lat 40.205000 -> OSM lon 49.532142 (single crossing)
// Twin procedural -24 m crossings (same date): 49.521208 / 49.520403 /
//   49.519476 / 49.518851. Max deviation 1299.5 m (at 40.190N); budget 1500 m.
//
// Genuine gaps named (do NOT invent datum):
//   G-IW: IWLearn 1999 mainland coastline polyline is UNRETRIEVABLE as data.
//     Verified: coast_ascii.zip truncates server-side at 19,016 bytes (page
//     states ~48 Kb) and coast_shapes.zip holds ONLY the 92-record Islands
//     layer (DBF names: Pirallahi/Nargin/Zhiloy/... — no mainland "Coast"
//     ring anywhere near Sangachal). Page metadata (WGS84 decimal degrees,
//     May 1999, 1987 USSR 1:1M chart + 1997 Resurs 150 m) is provenance, not
//     a numeric shoreline — so IWLearn has NO column in the transect table.
//   G-ESIA-DATUM: ESIA Table 7.8 shipping-lane coords datum unstated
//     (consistent with UTM 39N, unconfirmed); ESIA coastline/bathymetry is
//     2003-2006 vintage while the modern Caspian level is lower.
//   G-PROC-SOUTH: south of the site the fallback diverges — at 40.156296N
//     OSM lon 49.473969 vs procedural 49.525371 (4.4 km apart). The pinned
//     SRTM-family grid (tests/ring2-field.test.js TRUTH) agrees with OSM
//     there (interpolated -24 m at ~49.4767), so the fallback — not OSM —
//     is the outlier. Transects below 40.19N are REPORTED, not budgeted.
//   G-AREA: Baku distance 45 vs 55 km; area 500 vs 688 ha vs 32 km2 —
//     unresolved, out of scope for this shoreline test.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SANGACHAL,
  METERS_PER_DEG_LAT,
  METERS_PER_DEG_LON,
} from '../src/ring2/site.js';
import { proceduralH } from '../src/ring2/field.js';
import { CASPIAN_SHORE_H } from '../src/ring2/overlays.js';

const asset = JSON.parse(readFileSync('public/data/sangachal-vectors.json', 'utf8'));
const coast = asset.layers.coastline.find((f) => f.pts.length > 10).pts;

/* OSM coastline longitude(s) where the polyline crosses a transect latitude. */
function osmLonsAt(lat) {
  const z = (SANGACHAL.lat - lat) * METERS_PER_DEG_LAT;
  const hits = [];
  for (let i = 0; i < coast.length - 1; i++) {
    const [x1, z1] = coast[i];
    const [x2, z2] = coast[i + 1];
    if ((z1 - z) * (z2 - z) <= 0 && z1 !== z2) {
      const t = (z - z1) / (z2 - z1);
      hits.push(SANGACHAL.lon + (x1 + t * (x2 - x1)) / METERS_PER_DEG_LON);
    }
  }
  return hits;
}

/* Twin shoreline: first eastward crossing of proceduralH below the render key. */
function twinLonAt(lat) {
  const z = (SANGACHAL.lat - lat) * METERS_PER_DEG_LAT;
  let px = -2000;
  let ph = proceduralH(-2000, z);
  for (let x = -1975; x <= 12000; x += 25) {
    const h = proceduralH(x, z);
    if (ph >= CASPIAN_SHORE_H && h < CASPIAN_SHORE_H) {
      let a = px;
      let b = x;
      for (let i = 0; i < 60; i++) {
        const m = (a + b) / 2;
        if (proceduralH(m, z) >= CASPIAN_SHORE_H) a = m;
        else b = m;
      }
      return SANGACHAL.lon + (a + b) / 2 / METERS_PER_DEG_LON;
    }
    px = x;
    ph = h;
  }
  return null;
}

const LON_TOL = 1e-5; // ~0.85 m — deterministic math, tight pin
const MAX_DEVIATION_M = 1500;

const TRANSECTS = [
  { lat: 40.19, osm: [49.505907], twin: 49.521208 },
  { lat: 40.195, osm: [49.511461], twin: 49.520403 },
  { lat: 40.201262, osm: [49.523285, 49.526771, 49.526791], twin: 49.519476 },
  { lat: 40.205, osm: [49.532142], twin: 49.518851 },
];

test('OSM coastline layer present (2 features, long trace + stub)', () => {
  assert.equal(asset.layers.coastline.length, 2);
  assert.ok(coast.length > 200, `long trace has ${coast.length} pts`);
  assert.equal(asset.meta.license, 'ODbL-1.0');
});

test('OSM coastline longitudes pinned at 4 transects near 40.20N', () => {
  for (const t of TRANSECTS) {
    const got = osmLonsAt(t.lat);
    assert.equal(
      got.length,
      t.osm.length,
      `lat ${t.lat}: expected ${t.osm.length} crossing(s), got ${got.length}`,
    );
    for (let i = 0; i < t.osm.length; i++) {
      assert.ok(
        Math.abs(got[i] - t.osm[i]) < LON_TOL,
        `lat ${t.lat} hit ${i}: got ${got[i].toFixed(6)}, pinned ${t.osm[i]}`,
      );
    }
  }
});

test('twin shoreline (-24 m key) longitudes pinned at the same transects', () => {
  assert.equal(CASPIAN_SHORE_H, -24);
  for (const t of TRANSECTS) {
    const got = twinLonAt(t.lat);
    assert.ok(got !== null, `lat ${t.lat}: twin shoreline crossing exists`);
    assert.ok(
      Math.abs(got - t.twin) < LON_TOL,
      `lat ${t.lat}: got ${got.toFixed(6)}, pinned ${t.twin}`,
    );
    assert.ok(got > SANGACHAL.lon, `lat ${t.lat}: shore stays east of the pin`);
  }
});

test('max OSM-vs-twin deviation within 1500 m budget (nearest hit)', () => {
  let max = 0;
  for (const t of TRANSECTS) {
    const twin = twinLonAt(t.lat);
    const dev = Math.min(...osmLonsAt(t.lat).map((o) => Math.abs(o - twin))) *
      METERS_PER_DEG_LON;
    assert.ok(
      dev < MAX_DEVIATION_M,
      `lat ${t.lat}: deviation ${dev.toFixed(1)} m exceeds ${MAX_DEVIATION_M} m`,
    );
    if (dev > max) max = dev;
  }
  assert.ok(max > 100, `sanity: max deviation ${max.toFixed(1)} m is non-trivial`);
});
