// src/ring2/site.js — Ring-2 site constant + world<->geo mapping (Phase 1, Task 1).
//
// Single source of truth for the Sangachal pin. Every later Ring-2 module
// (field, mapbase, sync, overlays) imports these verbatim — no copies.
//
// Convention: local world frame is equirectangular, origin at the site pin,
// +x = east, +z = south, units metres. Shared vertical exaggeration VEX.

export const SANGACHAL = Object.freeze({
  lat: 40.201262,
  lon: 49.48127,
  radiusKm: 10,
  extentKm: 20,
});

// Shared vertical exaggeration — MapLibre setTerrain AND twin overlays use this.
export const VEX = 1.0;

export const EARTH_RADIUS_M = 6371000;
const DEG = Math.PI / 180;

// Equirectangular scale at the site parallel.
export const METERS_PER_DEG_LAT = EARTH_RADIUS_M * DEG;
export const METERS_PER_DEG_LON =
  EARTH_RADIUS_M * Math.cos(SANGACHAL.lat * DEG) * DEG;

export const RING_RADIUS_M = SANGACHAL.radiusKm * 1000;
export const EXTENT_M = SANGACHAL.extentKm * 1000;

/** World (x east, z south, metres) -> { lat, lon }. */
export function worldToGeo(x, z) {
  return {
    lat: SANGACHAL.lat - z / METERS_PER_DEG_LAT,
    lon: SANGACHAL.lon + x / METERS_PER_DEG_LON,
  };
}

/** { lat, lon } -> world { x east, z south, metres }. */
export function geoToWorld(lat, lon) {
  return {
    x: (lon - SANGACHAL.lon) * METERS_PER_DEG_LON,
    z: (SANGACHAL.lat - lat) * METERS_PER_DEG_LAT,
  };
}

/** True when a world point lies inside the 10 km survey ring. */
export function isWithinRing(x, z) {
  return Math.hypot(x, z) <= RING_RADIUS_M;
}

/** True when a world point lies inside the 20 km square extent. */
export function isWithinExtent(x, z) {
  const h = EXTENT_M / 2;
  return Math.abs(x) <= h && Math.abs(z) <= h;
}
