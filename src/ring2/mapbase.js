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
import { SANGACHAL, VEX } from './site.js';

/* Keyless tile endpoints. */
export const ESRI_IMAGERY_TILES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
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
export const HILLSHADE_LAYER_ID = 'ring2-hillshade';
export const REFERENCE_LAYER_ID = 'esri-reference';

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
      'esri-reference-src': {
        type: 'raster',
        tiles: ESRI_REFERENCE_TILES,
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Reference &copy; Esri',
      },
    },
    layers: [
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
    for (const id of [IMAGERY_LAYER_ID, HILLSHADE_LAYER_ID, REFERENCE_LAYER_ID]) {
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
    for (const id of [IMAGERY_LAYER_ID, HILLSHADE_LAYER_ID, REFERENCE_LAYER_ID]) {
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

  // Capture every source/tile error from the start (surfaced in status).
  map.on('error', (e) => {
    const msg = e?.error?.message ?? e?.error ?? e;
    window.__ring2mapErrors = [...(window.__ring2mapErrors ?? []), String(msg)].slice(-5);
  });
  // Resolve on load ONLY. Tile/source errors are per-tile and must never
  // abort the mount: reject-on-first-error used to kill the whole map on a
  // single 404, leaving the SAT side permanently empty with the twin fading
  // over nothing. A hung style is still caught by the caller's timeout.
  await new Promise((resolve) => {
    map.once('load', resolve);
  });
  map.getCanvas()?.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    window.__ring2mapErrors = [...(window.__ring2mapErrors ?? []), 'map WebGL context LOST (GPU)'].slice(-5);
  });
  map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
  assertTerrainOn(map);
  applyGroundFlag(map);
  _map = map;
  window.__ring2map = map;
  return { map };
}
