/* Safepipe Ops3D Ring-2 — src/ring2/sync.js (Phase 2, Task 5).
 * Bidirectional camera parity between the three.js twin and MapLibre:
 * orbit target <-> map center, ground-resolution zoom, azimuth bearing.
 * Pure math (no maplibre import) so the node probe can verify it numerically.
 * World frame: +x east, +z south, y up (same frame as site.js mapping).
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-2]
 */
import { SANGACHAL, VEX, worldToGeo, geoToWorld } from './site.js';

/* Camera-parity anchor (Phase 00 chassis fix): the MapLibre camera's TRUE
 * vertical fov. Pinned to maplibre-gl 6.13.0
 * node_modules/maplibre-gl/src/geo/transform_helper.ts
 * (`this._fovInRadians = 0.6435011087932844`) — the Map class exposes only
 * getVerticalFieldOfView() with NO public setter, so the TWIN adopts the
 * map's fov, never the reverse (no private _transform hacks). Same
 * center+zoom+bearing+pitch under different fovs can only agree at nadir;
 * every oblique view drifts — the owner-reported rotate/tilt misalignment.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-00] */
export const MAP_FOV_RAD = 0.6435011087932844;
export const MAP_TRUE_FOV_DEG = (MAP_FOV_RAD * 180) / Math.PI; // ≈36.8699
/* Twin tilt clamp: OrbitControls maxPolarAngle and the map maxPitch must be
 * the SAME number or the twin can tilt past where the map clamps and the
 * mix fade shears at the extreme. mapbase.js + overlays.js both use this.
 * 65 (not 85): owner video proved the Shift+drag decoupling happens at
 * NEAR-GRAZING edge-on pitch — world collapsed to a line, drape floating
 * past the terrain silhouette. Parallax magnification of ANY residual
 * twin-vs-map DEM difference scales ~tan(pitch): tan(85°)=11.4 vs
 * tan(65°)=2.1, a 5× reduction, and grazing becomes unreachable. 65 stays
 * just past MapLibre's own default 60 so oblique inspection still feels
 * open, and keeps the pitch-60 parity proof inside the legal envelope.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
export const MAP_MAX_PITCH_DEG = 65;
/* Drape tilt-fade start: draped linework holds EXACTLY full opacity to this
 * pitch, then ramps to zero at MAP_MAX_PITCH_DEG — a last-resort 5° band,
 * not a look. 60 sits exactly on MapLibre's own default maxPitch, so every
 * normal oblique inspection (0–60°) is pixel-identical with the fade
 * compiled out (tiltK === 1); only the 60–65° past-default zone dissolves
 * contours + OSM vectors instead of floating them past the silhouette.
 * Ground, water, ring, labels and schematic NEVER ride this fade (mix-only).
 * Measured 2026-10-12 (live Terrarium, 72 far-rim pts @ R=10 km): twin-z12
 * vs map-z15 |d| max 16.7 m / mean 1.19 m over 286 m relief — the LOD gap
 * dominates any lift on relief, so the fade only hides the residual. */
export const TILT_FADE_START_DEG = 60;
/* Native-zoom ceilings (single source of truth — mapbase.js mapStyle()
 * consumes these for its source maxzoom instead of bare literals, and the
 * twin dive clamp below is derived from them).
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
export const SAT_IMAGERY_MAXZOOM = 19; // Esri World Imagery native ceiling
export const TERRAIN_DEM_MAXZOOM = 15; // Terrarium raster-dem native ceiling
/* Usable overzoom past DEM native: 1 level of bilinear upscale stays smooth
 * on this relief; ~2 levels (the old 800 m dive: z≈16.5 at H=800, z≈16.9 at
 * H=1096) visibly magnifies the twin-coarse (maxTiles:16 sampler + SRTM
 * fallback) vs map-full-res DEM difference into vertical shear at oblique
 * pitch. Esri z19 native is never approached at twin ranges (z19 would need
 * range ≲140 m at H=800) — the DEM, not the imagery, is the binding
 * ceiling, so the clamp is derived from TERRAIN_DEM_MAXZOOM + 1. */
export const TWIN_MAX_DEM_OVERZOOM = 1;
export const TWIN_MAX_ZOOM = TERRAIN_DEM_MAXZOOM + TWIN_MAX_DEM_OVERZOOM; // 16
/* Closest legal twin dive: rangeForZoom(16, lat, {viewportPx:1096}) ≈ 1500 m,
 * so minDistance 1500 keeps map zoom ≤16 (≤1 DEM-overzoom level) on viewport
 * heights ≤ ~1096 px — every owner device. */
export const TWIN_MIN_RANGE_M = 1500;
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
export function zoomForRange(rangeM, latDeg = SANGACHAL.lat, { viewportPx = 600, fovDeg = MAP_TRUE_FOV_DEG } = {}) {
  if (!Number.isFinite(rangeM) || rangeM <= 0) throw new Error(`zoomForRange: bad range ${rangeM}`);
  const footprintM = 2 * rangeM * Math.tan(rad(fovDeg) / 2);
  return zoomForGroundRes(footprintM / viewportPx, latDeg);
}

/** Inverse of zoomForRange (same opts required). */
export function rangeForZoom(z, latDeg = SANGACHAL.lat, { viewportPx = 600, fovDeg = MAP_TRUE_FOV_DEG } = {}) {
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
  const { latDeg = SANGACHAL.lat, viewportPx = 600, fovDeg = MAP_TRUE_FOV_DEG } = opts;
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

/* Read-back truth: does the live map camera disagree with the authoritative
 * twin-derived pose beyond tolerance? jumpTo applies synchronously, but any
 * map-side-only deviation between frames (post-remount default camera,
 * terrain re-init, a stray programmatic nudge, a re-enabled handler in a
 * future edit) used to PERSIST until the twin next moved — the one-way-sync
 * gap behind the owner's permanent Shift+drag decoupling. Missing getters
 * pass (a stub without them can't disagree); bearing compares on the
 * circle, not the raw number. */
const SYNC_SNAP_TOL = { center: 1e-9, zoom: 1e-6, bearing: 1e-3, pitch: 1e-3 };
export function mapDisagrees(map, mp, tol = SYNC_SNAP_TOL) {
  try {
    const c = typeof map?.getCenter === 'function' ? map.getCenter() : null;
    const z = typeof map?.getZoom === 'function' ? map.getZoom() : null;
    const b = typeof map?.getBearing === 'function' ? map.getBearing() : null;
    const p = typeof map?.getPitch === 'function' ? map.getPitch() : null;
    if (c == null || z == null || b == null || p == null) return false;
    const clon = Array.isArray(c) ? c[0] : c.lng;
    const clat = Array.isArray(c) ? c[1] : c.lat;
    if (![clon, clat, z, b, p].every(Number.isFinite)) return false;
    const circ = (a, x) => Math.abs((((a - x + 540) % 360) + 360) % 360 - 180);
    return (
      Math.abs(clon - mp.center[0]) > tol.center ||
      Math.abs(clat - mp.center[1]) > tol.center ||
      Math.abs(z - mp.zoom) > tol.zoom ||
      circ(b, mp.bearing) > tol.bearing ||
      Math.abs(p - mp.pitch) > tol.pitch
    );
  } catch {
    return false; // read-back is best-effort; the jumpTo already applied
  }
}

/* Drive a live MapLibre map from a twin pose (jumpTo: sync, no animation
 * fight). AUTHORITATIVE every twin frame: jumpTo + redraw run
 * unconditionally, then the camera is read back and snapped back on ANY
 * disagreement beyond tolerance — jumpTo is idempotent, so the agreeing
 * fast path costs one comparison and a map-side nudge can never persist
 * past the next frame. Asserts VEX first so a mis-exaggerated map can never
 * silently receive a synced camera. Returns the applied
 * { center, zoom, bearing, pitch } with .snapped=true when a snap-back
 * re-push fired. */
export function applyTwinToMap(map, pose, opts = {}) {
  assertTerrainVex(map);
  const mp = mapPoseForTwin(pose, opts);
  const push = { center: mp.center, zoom: mp.zoom, bearing: mp.bearing, pitch: mp.pitch };
  // Unconditional re-push + repaint: the twin pose is the camera authority
  // every frame, resting or moving — a map-side-only change can never linger.
  map.jumpTo(push);
  try {
    if (typeof map.redraw === 'function') map.redraw();
  } catch {
    /* the map's own async loop still paints — parity degrades one frame, nothing breaks */
  }
  // Snap-back: read the live camera back; any disagreement beyond tolerance
  // is re-pushed immediately (jumpTo is idempotent, so agreement is cheap).
  try {
    if (mapDisagrees(map, mp)) {
      map.jumpTo(push);
      try {
        if (typeof map.redraw === 'function') map.redraw();
      } catch {
        /* same one-frame grace as above */
      }
      mp.snapped = true;
    }
  } catch {
    /* read-back is best-effort — the first push already applied */
  }
  return mp;
}

/* Drape tilt fade (pure): linework opacity multiplier for a camera pitch.
 * 1 up to TILT_FADE_START_DEG, smoothstep ramp to 0 at the shared clamp —
 * near-grazing views hide the drape instead of floating it past the
 * silhouette. Node-testable; overlays.setTiltFade consumes it per frame. */
export function tiltFadeForPitch(pitchDeg, fadeStart = TILT_FADE_START_DEG, clamp = MAP_MAX_PITCH_DEG) {
  const p = Number(pitchDeg);
  if (!Number.isFinite(p) || p <= fadeStart) return 1;
  if (p >= clamp) return 0;
  const t = (p - fadeStart) / (clamp - fadeStart);
  return 1 - t * t * (3 - 2 * t);
}

/* Input ownership: the twin canvas is the ONLY camera input at every mix.
 * The twin orbit owns the camera from SAT (0) to TWIN (100) and the map
 * follows via the per-frame twin->map sync (the map itself is constructed
 * non-interactive, so it can never fight the sync). A previous revision
 * set pointer-events:none here at effMix<2, which starved OrbitControls of
 * all input in satellite mode — a frozen camera. This pins the rule the
 * other way: satellite mode orbits exactly like twin mode.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-4] */
/** CSS pointer-events for the twin canvas at any effective mix: always 'auto'. */
export function twinPointerEvents(_effMix) {
  return 'auto';
}

/* Aspect parity: the twin PerspectiveCamera aspect (twin container w/h)
 * and the map canvas aspect (map container w/h) must be EQUAL — same fov
 * with different aspects still shears the mix fade horizontally. Returns
 * the relative aspect mismatch |a-b|/max(a,b) (0 = identical). Callers
 * fail closed above tolerance; main.js warns once per session live.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-00] */
export function aspectMismatch(twinW, twinH, mapW, mapH) {
  const a = twinW / Math.max(twinH, 1);
  const b = mapW / Math.max(mapH, 1);
  return Math.abs(a - b) / Math.max(a, b, 1e-12);
}

/** Throw unless twin/map aspects agree within tol (default 1%). */
export function assertAspectParity(twinW, twinH, mapW, mapH, tol = 0.01) {
  const m = aspectMismatch(twinW, twinH, mapW, mapH);
  if (!(m <= tol)) {
    throw new Error(`assertAspectParity: twin ${twinW}x${twinH} vs map ${mapW}x${mapH} mismatch ${m}`);
  }
  return true;
}

/* Native map gesture handlers. ALL stay disabled for the life of the map:
 * the twin orbit owns the camera at every mix and the map follows via the
 * per-frame twin->map sync — a live map handler would fight the sync and
 * shear pan/tilt alignment (owner pan-break finding). mapbase.mountMapBase
 * disables each one post-construction AND probes with
 * assertMapNonInteractive, so a future handler addition fails closed
 * instead of silently fighting. Lives here (not mapbase.js) because this
 * module is import-clean for node probes; mapbase re-exports both.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01] */
export const MAP_INPUT_HANDLERS = [
  'dragPan',
  'dragRotate',
  'scrollZoom',
  'boxZoom',
  'doubleClickZoom',
  'keyboard',
  'touchZoomRotate',
];

/* Throws unless no native map handler owns input. Missing handlers pass
 * (a handler that doesn't exist can't fight the sync); any enabled one
 * fails closed with its name. */
export function assertMapNonInteractive(map) {
  if (!map) throw new Error('assertMapNonInteractive: no live map');
  for (const name of MAP_INPUT_HANDLERS) {
    const h = map[name];
    if (h && typeof h.isEnabled === 'function' && h.isEnabled()) {
      throw new Error(`assertMapNonInteractive: map.${name} owns input (fights twin->map sync)`);
    }
  }
  return true;
}
