/* Safepipe Ops3D Ring-2 — src/ring2/sync.js (Phase 2, Task 5).
 * Bidirectional camera parity between the three.js twin and MapLibre:
 * orbit target <-> map center, ground-resolution zoom, azimuth bearing.
 * Pure math (no maplibre import) so the node probe can verify it numerically.
 * World frame: +x east, +z south, y up (same frame as site.js mapping).
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-2]
 */
import { SANGACHAL, VEX, worldToGeo, geoToWorld } from './site.js';

/* 512-px tile convention (MapLibre default tileSize 512): metres per pixel
 * at zoom 0 on the equator. The 256-px constant (156543.03392) is WRONG
 * here — using it halves every zoom (v1's 2x-zoom class). */
export const GROUND_RES_Z0_MPX = 78271.51696;
export const TILE_PX = 512;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Ground resolution (m/px) at zoom z and latitude. */
export function groundResForZoom(z, latDeg = SANGACHAL.lat) {
  return (GROUND_RES_Z0_MPX * Math.cos(rad(latDeg))) / Math.pow(2, z);
}

/** Inverse: zoom for a ground resolution. Throws on non-finite input. */
export function zoomForGroundRes(resMpx, latDeg = SANGACHAL.lat) {
  if (!Number.isFinite(resMpx) || resMpx <= 0) throw new Error(`zoomForGroundRes: bad res ${resMpx}`);
  return Math.log2((GROUND_RES_Z0_MPX * Math.cos(rad(latDeg))) / resMpx);
}

/* Zoom from camera range via NADIR ground resolution. NO slant factor:
 * dividing by cos(pitch) is what slid v1 apart the moment the camera
 * tilted — map zoom must not depend on pitch. viewportPx is the screen
 * height the twin's vertical footprint maps to; fovDeg is the twin's
 * vertical fov. Both must match the twin camera for scale parity. */
export function zoomForRange(rangeM, latDeg = SANGACHAL.lat, { viewportPx = 600, fovDeg = 60 } = {}) {
  if (!Number.isFinite(rangeM) || rangeM <= 0) throw new Error(`zoomForRange: bad range ${rangeM}`);
  const footprintM = 2 * rangeM * Math.tan(rad(fovDeg) / 2);
  return zoomForGroundRes(footprintM / viewportPx, latDeg);
}

/** Inverse of zoomForRange (same opts required). */
export function rangeForZoom(z, latDeg = SANGACHAL.lat, { viewportPx = 600, fovDeg = 60 } = {}) {
  return (groundResForZoom(z, latDeg) * viewportPx) / (2 * Math.tan(rad(fovDeg) / 2));
}

/* Map bearing for a twin pose. The map's up-screen ground direction points
 * from target TOWARD the eye, so the bearing uses (eye - target):
 * bearing = atan2(east, north) = atan2(-dx, dz) with +x east / +z south.
 * (Using target-eye instead mirrors the map — v1's mirror class.) */
export function bearingForPose(eye, target) {
  const dx = eye.x - target.x;
  const dz = eye.z - target.z;
  return (deg(Math.atan2(-dx, dz)) + 360) % 360;
}

/** Map pitch (deg from nadir) for a twin pose. TOP-down eye => 0. */
export function pitchForPose(eye, target, targetY = 0) {
  const h = Math.hypot(eye.x - target.x, eye.z - target.z);
  const v = eye.y - targetY;
  return deg(Math.atan2(h, v));
}

/** Center-follows-target: twin orbit target -> map center [lon, lat]. */
export function centerForTarget(target) {
  const g = worldToGeo(target.x, target.z);
  return [g.lon, g.lat];
}

/** Inverse: map center -> twin orbit target {x, z}. */
export function targetForCenter(lon, lat) {
  return geoToWorld(lat, lon);
}

/* Full twin pose -> MapLibre camera. pose = { eye:{x,y,z}, target:{x,z} }.
 * Returns { center:[lon,lat], zoom, bearing, pitch }. */
export function mapPoseForTwin(pose, opts = {}) {
  const { latDeg = SANGACHAL.lat, viewportPx = 600, fovDeg = 60 } = opts;
  const rangeM = Math.hypot(
    pose.eye.x - pose.target.x,
    pose.eye.y - (pose.target.y ?? 0),
    pose.eye.z - pose.target.z,
  );
  return {
    center: centerForTarget(pose.target),
    zoom: zoomForRange(rangeM, latDeg, { viewportPx, fovDeg }),
    bearing: bearingForPose(pose.eye, pose.target),
    pitch: pitchForPose(pose.eye, pose.target, pose.target.y ?? 0),
  };
}

/* VEX assert: the map's live terrain exaggeration must equal the shared
 * VEX, or twin drape (sampleH * VEX) floats/buries against map terrain. */
export function assertTerrainVex(map) {
  const t = typeof map?.getTerrain === 'function' ? map.getTerrain() : null;
  if (!t) throw new Error('assertTerrainVex: terrain is off (getTerrain() null) — call mapbase mount first');
  if (t.exaggeration !== VEX) {
    throw new Error(`assertTerrainVex: exaggeration ${t.exaggeration} !== VEX ${VEX}`);
  }
  return true;
}

/* Drive a live MapLibre map from a twin pose (jumpTo: sync, no animation
 * fight). Asserts VEX first so a mis-exaggerated map can never silently
 * receive a synced camera. Returns the applied { center, zoom, bearing, pitch }. */
export function applyTwinToMap(map, pose, opts = {}) {
  assertTerrainVex(map);
  const mp = mapPoseForTwin(pose, opts);
  map.jumpTo({ center: mp.center, zoom: mp.zoom, bearing: mp.bearing, pitch: mp.pitch });
  return mp;
}
