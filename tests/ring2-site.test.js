// tests/ring2-site.test.js — Phase 1, Task 1 gate.
// Exact Sangachal pin, shared VEX, world<->geo round-trip < 1 m.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SANGACHAL,
  VEX,
  METERS_PER_DEG_LAT,
  METERS_PER_DEG_LON,
  RING_RADIUS_M,
  EXTENT_M,
  worldToGeo,
  geoToWorld,
  isWithinRing,
  isWithinExtent,
} from '../src/ring2/site.js';

const haversineM = (a, b, c, d) => {
  const R = 6371000;
  const p = Math.PI / 180;
  const s1 = Math.sin(((c - a) * p) / 2) ** 2;
  const s2 =
    Math.cos(a * p) * Math.cos(c * p) * Math.sin(((d - b) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1 + s2));
};

test('Sangachal pin is exact (wiki coords, ring, extent)', () => {
  assert.equal(SANGACHAL.lat, 40.201262);
  assert.equal(SANGACHAL.lon, 49.48127);
  assert.equal(SANGACHAL.radiusKm, 10);
  assert.equal(SANGACHAL.extentKm, 20);
  assert.equal(RING_RADIUS_M, 10000);
  assert.equal(EXTENT_M, 20000);
});

test('VEX is the shared 1.0 export', () => {
  assert.equal(VEX, 1.0);
});

test('origin maps to the pin', () => {
  const g = worldToGeo(0, 0);
  assert.equal(g.lat, SANGACHAL.lat);
  assert.equal(g.lon, SANGACHAL.lon);
  const w = geoToWorld(SANGACHAL.lat, SANGACHAL.lon);
  assert.equal(w.x, 0);
  assert.equal(w.z, 0);
});

test('+x is east, +z is south', () => {
  const e = worldToGeo(1000, 0);
  assert.ok(e.lon > SANGACHAL.lon, '+x must increase longitude');
  assert.equal(e.lat, SANGACHAL.lat);
  const s = worldToGeo(0, 1000);
  assert.ok(s.lat < SANGACHAL.lat, '+z must decrease latitude');
  assert.equal(s.lon, SANGACHAL.lon);
});

test('world<->geo round-trips < 1 m over ring + extent corners', () => {
  const pts = [
    [0, 0],
    [10000, 0],
    [-10000, 0],
    [0, 10000],
    [0, -10000],
    [7071, 7071],
    [-7071, -7071],
    [10000, 10000],
    [-10000, -10000],
    [10000, -10000],
    [-10000, 10000],
    [1234.5, -6789.1],
  ];
  let worst = 0;
  for (const [x, z] of pts) {
    const g = worldToGeo(x, z);
    const w = geoToWorld(g.lat, g.lon);
    const err = Math.hypot(w.x - x, w.z - z);
    worst = Math.max(worst, err);
    assert.ok(err < 1, `round-trip err ${err} m at (${x},${z})`);
    // Independent check on the sphere, not just self-inverse math.
    const geoErr = haversineM(SANGACHAL.lat, SANGACHAL.lon, g.lat, g.lon);
    const planar = Math.hypot(x, z);
    assert.ok(
      Math.abs(geoErr - planar) < planar * 0.005 + 0.5,
      `equirect drift ${geoErr} vs ${planar}`,
    );
  }
  console.log(`  worst round-trip error: ${worst.toExponential(2)} m`);
});

test('10 km east maps ~10 km (scale sanity)', () => {
  const g = worldToGeo(10000, 0);
  const d = haversineM(SANGACHAL.lat, SANGACHAL.lon, g.lat, g.lon);
  assert.ok(Math.abs(d - 10000) < 50, `got ${d} m`);
  assert.ok(Math.abs(METERS_PER_DEG_LON - 84928.66) < 5, `m/degLon ${METERS_PER_DEG_LON}`);
  assert.ok(Math.abs(METERS_PER_DEG_LAT - 111194.93) < 1, `m/degLat ${METERS_PER_DEG_LAT}`);
});

test('ring / extent predicates', () => {
  assert.equal(isWithinRing(0, 0), true);
  assert.equal(isWithinRing(9999, 0), true);
  assert.equal(isWithinRing(10001, 0), false);
  assert.equal(isWithinRing(7072, 7072), false); // corner outside ring…
  assert.equal(isWithinExtent(7071, 7071), true); // …but inside extent
  assert.equal(isWithinExtent(10001, 0), false);
});
