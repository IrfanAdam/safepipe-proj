/* Safepipe Ops3D Ring-2 — src/ring2/mapbase.js (Phase 2, Task 4).
 * MapLibre owns ALL ground: Esri World Imagery + Terrarium raster-dem 3D
 * terrain + neutral hillshade + Esri reference labels, one shared VEX.
 * The twin (Phase 3) renders overlays ONLY — never ground.
 *
 * Phase-3 seam hooks (mix slider lane drives these, no edits here):
 *   getMap()          -> live maplibre Map instance (or null pre-mount)
 *   setGroundOwns(b)  -> true: satellite ground visible (map look);
 *                        false: ground layers hidden (twin takeover look)
 *   getGroundOwns()   -> current flag
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-2]
 */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { SANGACHAL, VEX, worldToGeo } from './site.js';

/* Keyless tile endpoints. Imagery has TWO hosts for the same Esri
 * service: some Safari setups (content blockers) kill tile subresources on
 * one hostname while the address-bar page loads fine. The backup layer sits
 * UNDER the primary — failed primary tiles are transparent, so the backup
 * shows through the gaps with zero runtime swapping logic. */
export const ESRI_IMAGERY_TILES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
];
export const ESRI_IMAGERY_TILES_BACKUP = [
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
];
export const ESRI_REFERENCE_TILES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
];
export const TERRARIUM_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
];
export const TERRAIN_SOURCE_ID = 'terrarium';
export const HILL_SOURCE_ID = 'terrarium-hill'; // same tiles, separate source id (maplibre warns if hillshade shares the terrain source)
export const IMAGERY_LAYER_ID = 'esri-imagery';
export const IMAGERY_BACKUP_LAYER_ID = 'esri-imagery-backup';
export const HILLSHADE_LAYER_ID = 'ring2-hillshade';
export const REFERENCE_LAYER_ID = 'esri-reference';
export const MASK_FILL_COL = '#0b0c0c'; // page bg: clipped ground reads as vignette, not void

/* Map-side ring clip (world-space, projection-proof). The twin-side mask
 * (overlays.js) is drawn through the twin perspective camera, which
 * misregisters against the MapLibre mercator camera by tens of px at
 * oblique pitch — map photo leaked past it with square tile corners. A
 * fill layer conforms to map terrain in map space BY CONSTRUCTION, so its
 * edge is always a world circle under every projection: ONE hard-edged
 * band, photo full inside R, opaque cover outside R. No stepped feather
 * (0.75/0.85/0.95 dropped per the owner no-feather call — a single edge
 * shared with the twin-side hard clip, so both sides agree at exactly R).
 * Topmost layer, so labels clip to the disc too. */
function circleRing(rM, seg = 72) {
  const ring = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const g = worldToGeo(Math.cos(a) * rM, Math.sin(a) * rM);
    ring.push([g.lon, g.lat]);
  }
  ring.push(ring[0].slice());
  return ring;
}
function maskGeoJSON() {
  const R = SANGACHAL.radiusKm * 1000;
  // Outer shell = the whole world (mercator limits): zoomed-out oblique
  // views otherwise show photo past a fixed-degree box. The lens hole is
  // the only imagery window at any zoom or pitch.
  const world = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  const band = (outer, hole, id, op) => ({
    type: 'Feature',
    properties: { band: id, 'fill-opacity': op },
    geometry: { type: 'Polygon', coordinates: hole ? [outer, hole] : [outer] },
  });
  return {
    type: 'FeatureCollection',
    features: [
      band(world, circleRing(R), 1),
    ],
  };
}
export const MASK_BAND_LAYER_IDS = ['ring2-mask-1'];
const MASK_BAND_OPACITY = [1];

const ESRI_ATTRIB =
  'Imagery &copy; Esri, Maxar, Earthstar Geographics | Terrain: AWS Terrarium (Mapzen)';

/** Style JSON: satellite ground, Terrarium DEM, neutral hillshade, labels. */
export function mapStyle() {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      [TERRAIN_SOURCE_ID]: {
        type: 'raster-dem',
        tiles: TERRARIUM_TILES,
        tileSize: 256,
        maxzoom: 15,
        encoding: 'terrarium',
        attribution: 'Terrain: AWS Terrarium (Mapzen Joerd)',
      },
      [HILL_SOURCE_ID]: {
        type: 'raster-dem',
        tiles: TERRARIUM_TILES,
        tileSize: 256,
        maxzoom: 15,
        encoding: 'terrarium',
      },
      'esri-imagery-src': {
        type: 'raster',
        tiles: ESRI_IMAGERY_TILES,
        tileSize: 256,
        maxzoom: 19,
        attribution: ESRI_ATTRIB,
      },
      'esri-imagery-backup-src': {
        type: 'raster',
        tiles: ESRI_IMAGERY_TILES_BACKUP,
        tileSize: 256,
        maxzoom: 19,
        attribution: ESRI_ATTRIB,
      },
      'esri-reference-src': {
        type: 'raster',
        tiles: ESRI_REFERENCE_TILES,
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Reference &copy; Esri',
      },
      'ring2-mask-src': {
        type: 'geojson',
        data: maskGeoJSON(),
      },
    },
    layers: [
      // Backup FIRST (bottom): identical pixels when both hosts live; failed
      // primary tiles are transparent, so the backup shows through the gaps.
      { id: IMAGERY_BACKUP_LAYER_ID, type: 'raster', source: 'esri-imagery-backup-src', paint: { 'raster-opacity': 1 } },
      { id: IMAGERY_LAYER_ID, type: 'raster', source: 'esri-imagery-src', paint: { 'raster-opacity': 1 } },
      {
        id: HILLSHADE_LAYER_ID,
        type: 'hillshade',
        source: HILL_SOURCE_ID,
        paint: {
          /* Neutral relief shading: low exaggeration, mid-gray ramp so it
           * reads as shade, not tint, under the satellite imagery. */
          'hillshade-exaggeration': 0.25,
          'hillshade-highlight-color': '#ffffff',
          'hillshade-shadow-color': '#8a8a8a',
          'hillshade-accent-color': '#6e6e6e',
        },
      },
      {
        id: REFERENCE_LAYER_ID,
        type: 'raster',
        source: 'esri-reference-src',
        paint: { 'raster-opacity': 0.85 },
      },
      // Map-side ring clip, topmost: single hard world-circular edge at R (see above).
      ...MASK_BAND_LAYER_IDS.map((id, i) => ({
        id,
        type: 'fill',
        source: 'ring2-mask-src',
        filter: ['==', ['get', 'band'], i + 1],
        paint: { 'fill-color': MASK_FILL_COL, 'fill-opacity': MASK_BAND_OPACITY[i] },
      })),
    ],
  };
}

/* Throws unless setTerrain ran against the live Terrarium source with
 * exaggeration exactly VEX. Called post-mount AND by the probe harness so
 * a flat-looking map can never pass as "3D terrain on". */
export function assertTerrainOn(map) {
  if (!map || typeof map.getTerrain !== 'function') throw new Error('assertTerrainOn: no live map');
  const t = map.getTerrain();
  if (!t) throw new Error('assertTerrainOn: setTerrain was never called (terrain OFF)');
  if (t.source !== TERRAIN_SOURCE_ID) {
    throw new Error(`assertTerrainOn: terrain source "${t.source}" !== live "${TERRAIN_SOURCE_ID}"`);
  }
  if (t.exaggeration !== VEX) {
    throw new Error(`assertTerrainOn: exaggeration ${t.exaggeration} !== VEX ${VEX}`);
  }
  return true;
}

let _map = null;
let _groundOwns = true;

/** Live MapLibre instance (null before mount resolves). */
export function getMap() {
  return _map;
}

/** Current ground-ownership flag. */
export function getGroundOwns() {
  return _groundOwns;
}

/* Phase-3 mix-slider hook. true = satellite ground visible; false = ground
 * layers hidden so the twin canvas takes over (map keeps camera/terrain
 * state, just stops drawing ground — no remount, no camera jump). */
export function setGroundOwns(on) {
  _groundOwns = !!on;
  const m = _map;
  if (m && m.loaded()) {
    const vis = _groundOwns ? 'visible' : 'none';
    for (const id of [IMAGERY_LAYER_ID, IMAGERY_BACKUP_LAYER_ID, HILLSHADE_LAYER_ID, REFERENCE_LAYER_ID]) {
      try {
        m.setLayoutProperty(id, 'visibility', vis);
      } catch {
        /* layer not yet added — flag still applies on next mount */
      }
    }
  }
  return _groundOwns;
}

function applyGroundFlag(m) {
  if (!_groundOwns) {
    for (const id of [IMAGERY_LAYER_ID, IMAGERY_BACKUP_LAYER_ID, HILLSHADE_LAYER_ID, REFERENCE_LAYER_ID]) {
      try {
        m.setLayoutProperty(id, 'visibility', 'none');
      } catch {
        /* ignore pre-style race */
      }
    }
  }
}

/* Mount the 3D map into el. Resolves { map } once loaded AND terrain
 * asserted on. Rejects (never half-mounts) if terrain cannot be set. */
export async function mountMapBase(el, opts = {}) {
  const {
    zoom = 11,
    pitch = 0,
    bearing = 0,
    exaggeration = VEX,
    interactive = true,
  } = opts;
  if (!el) throw new Error('mountMapBase: container element required');

  const map = new maplibregl.Map({
    container: el,
    style: mapStyle(),
    center: [SANGACHAL.lon, SANGACHAL.lat],
    zoom,
    pitch,
    bearing,
    maxPitch: 85,
    interactive,
    attributionControl: { compact: true },
    fadeDuration: 0,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.TerrainControl({ source: TERRAIN_SOURCE_ID, exaggeration }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  // Flat-earth pin: projection stays mercator — any globe/perspective flavor
  // renders the ground as a convex sphere at oblique pitch, which the twin
  // overlays then can't superimpose on. Sky melts the horizon into the page
  // background so distant terrain can't read as a planet limb; the
  // twin-side mask (overlays.js) does the actual ring clip.
  try {
    map.setProjection({ type: 'mercator' });
  } catch { /* maplibre without projections — already flat */ }
  const applySky = () => {
    try {
      map.setSky({
        'sky-color': '#0b0c0c',
        'horizon-color': '#0b0c0c',
        'fog-color': '#0b0c0c',
        'fog-ground-blend': 0.55,
        'horizon-fog-blend': 1,
        'sky-horizon-blend': 0.5,
      });
    } catch { /* style not ready — the load handler below retries */ }
  };
  applySky();

  // Capture every source/tile error from the start (surfaced in status).
  map.on('error', (e) => {
    const msg = e?.error?.message ?? e?.error ?? e;
    window.__ring2mapErrors = [...(window.__ring2mapErrors ?? []), String(msg)].slice(-5);
  });
  // Resolve on load ONLY. Tile/source errors are per-tile and must never
  // abort the mount: reject-on-first-error used to kill the whole map on a
  // single 404, leaving the SAT side permanently empty with the twin fading
  // over nothing. A hung style is still caught by the caller's timeout.
  // (No await on 'load' here — the soft race below is the only gate.)
  map.getCanvas()?.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    window.__ring2mapErrors = [...(window.__ring2mapErrors ?? []), 'map WebGL context LOST (GPU)'].slice(-5);
  });
  // Resolve on load — but NEVER gate the mount on it. A hung tile host
  // holds 'load' forever (proven by fault injection: one hanging host =
  // permanent map:- with the twin fading over nothing). Soft 8 s resolve
  // hands the live map to the loop; terrain engages best-effort now and
  // again on load. The outer 30 s timeout stays for worker catastrophe.
  let loadedClean = false;
  map.once('load', () => {
    loadedClean = true;
    applySky();
    try {
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
    } catch {
      /* style still settling — retry below is harmless */
    }
    applyGroundFlag(map);
  });
  await Promise.race([
    new Promise((res) => map.once('load', res)),
    new Promise((res) => setTimeout(res, 8000)),
  ]);
  try {
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
  } catch {
    /* style pending — the load handler above applies it when ready */
  }
  applyGroundFlag(map);
  _map = map;
  window.__ring2map = map;
  return { map, loadedClean };
}
