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
import { MAP_MAX_PITCH_DEG } from './sync.js';
import { waitForSized } from './sizeGate.js';
import { ctxLive, ctxLost, ctxRestored, noteTileErr, noteTileOk } from './ctxmon.js';

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

/** Drop a dead instance from the singleton (called on remove). Stale refs
 * made ground-flag writes hit a removed map (silently caught) while the
 * status line blamed the live one. */
export function releaseMap(m) {
  if (m && _map === m) _map = null;
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

/* Mount the 3D map into el. Resolves { map, loadedClean, dispose, isCtxLost }
 * once the soft load race settles. Rejects (never half-mounts) when the
 * container never sizes (a 0x0-born instance can never heal on real
 * Safari) or when terrain cannot be engaged.
 * opts.ctxmon: shared ctxmon registry (live-count + loss stamps + tile
 * counters). opts.onCtxLost('map') / opts.onCtxRestored('map'): recovery
 * callbacks owned by main.js (full clean re-mount on restore — a resize
 * through a lost context bricks the instance to ratio 0 permanently). */
export async function mountMapBase(el, opts = {}) {
  const {
    zoom = 11,
    pitch = 0,
    bearing = 0,
    exaggeration = VEX,
    interactive = true,
    ctxmon = null,
    onCtxLost = null,
    onCtxRestored = null,
  } = opts;
  if (!el) throw new Error('mountMapBase: container element required');

  // Birth-defect guard (Safari-black): MapLibre snapshots container size
  // AT CONSTRUCTION — a map born into a hidden (0x0) gallery iframe can
  // keep a zero canvas past every resize() on real Safari. Wait briefly
  // for a sized box before building; REFUSE to construct into 0x0 (the
  // old code ignored this result and built the wedged instance anyway).
  // The caller (main.js) additionally defers the mount call itself until
  // visible, so this is the inner net.
  const sizedOk = await waitForSized(() => el, { timeoutMs: 8000 });
  if (!sizedOk) throw new Error('mountMapBase: container never sized (0x0) — refusing 0x0-born instance');

  const map = new maplibregl.Map({
    container: el,
    style: mapStyle(),
    center: [SANGACHAL.lon, SANGACHAL.lat],
    zoom,
    pitch,
    bearing,
    // Tilt ceiling === twin maxPolarAngle (sync.js MAP_MAX_PITCH_DEG, Phase
    // 00): both sides clamp at the same pitch so the mix fade never shears.
    maxPitch: MAP_MAX_PITCH_DEG,
    interactive,
    attributionControl: { compact: true },
    fadeDuration: 0,
  });
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

  // Live-context census: up at construction, down exactly once at remove
  // (see the remove wrap below). Rising `live` across screenshots proves
  // remount churn is exhausting the GPU (P1/P4 family).
  let counted = false;
  try {
    if (ctxmon) {
      ctxLive(ctxmon, +1);
      counted = true;
    }
  } catch { /* census never breaks the mount */ }
  // Capture every source/tile error from the start (surfaced in status).
  map.on('error', (e) => {
    const msg = e?.error?.message ?? e?.error ?? e;
    try {
      if (ctxmon) noteTileErr(ctxmon, String(msg));
    } catch { /* census never breaks the handler */ }
    window.__ring2mapErrors = [...(window.__ring2mapErrors ?? []), String(msg)].slice(-5);
  });
  // Tile-success census: raster/vector tile data events carrying a tile and
  // no error. Telemetry-grade (extends the error ring into tile:err/ok).
  try {
    map.on('data', (e) => {
      try {
        if (ctxmon && e && e.tile && !e.error) noteTileOk(ctxmon);
      } catch { /* census never breaks the handler */ }
    });
  } catch { /* older maplibre without data tiles — error ring still covers */ }
  // Per-instance context-loss flag. A resize() issued between loss and
  // restore runs the L3 brick (_maxCanvasSize=[0,0] -> pixel-ratio 0) and
  // permanently condemns the instance, so ALL resize kicks for a lost
  // instance are suppressed (needsKick/kickResize below) and main.js does
  // a FULL clean re-mount on restore instead of a resize.
  let ctxLostFlag = false;
  const mapCanvas = map.getCanvas?.();
  mapCanvas?.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    ctxLostFlag = true;
    try {
      if (ctxmon) ctxLost(ctxmon, 'map');
    } catch { /* stamp is best-effort */ }
    window.__ring2mapErrors = [...(window.__ring2mapErrors ?? []), 'map WebGL context LOST (GPU)'].slice(-5);
    try {
      onCtxLost?.('map');
    } catch { /* recovery is main.js-owned */ }
  });
  mapCanvas?.addEventListener('webglcontextrestored', () => {
    try {
      if (ctxmon) ctxRestored(ctxmon, 'map');
    } catch { /* stamp is best-effort */ }
    // The instance stays condemned (a resize already ran or ratio is 0):
    // recovery is a full clean re-mount, never a resize of this canvas.
    try {
      onCtxRestored?.('map');
    } catch { /* recovery is main.js-owned */ }
  });
  // Resolve on load ONLY. Tile/source errors are per-tile and must never
  // abort the mount: reject-on-first-error used to kill the whole map on a
  // single 404, leaving the SAT side permanently empty with the twin fading
  // over nothing. A hung style is still caught by the caller's timeout.
  // (No await on 'load' here — the soft race below is the only gate.)
  // NOTE: webglcontextlost/restored are wired once above (with the loss
  // flag + census + recovery callbacks) — no second listener here.
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
  // 0x0 fix: Safari/gallery-iframe mounts while hidden (container 0x0 at
  // construction). Twin self-corrects via renderer.setSize but MapLibre
  // keeps its construction size until resize(). Event-timing races (tab
  // shown before listeners attach) beat one-shot kicks, so self-heal:
  // poll until the canvas is non-zero, plus every visibility/window signal.
  // A LOST instance never kicks: resize() through a lost context is the L3
  // brick (ratio 0, permanent) — recovery is a full re-mount via main.js.
  // A DISPOSED (remounted-away) instance never kicks either (P9 leak: dead
  // maps kept healTimers, ROs and window listeners calling resize() on a
  // dead map while the status blamed the live one).
  let disposed = false;
  const kickResize = () => {
    if (disposed || ctxLostFlag) return;
    try {
      map.resize();
    } catch {}
  };
  const needsKick = () => {
    if (disposed || ctxLostFlag) return false;
    try {
      const c = map.getCanvas?.();
      if (!c) return true;
      if ((c.width | 0) === 0 || (c.height | 0) === 0) return true;
      // Stale-size guard: container grew after mount (hidden -> shown).
      const elW = el?.clientWidth | 0, elH = el?.clientHeight | 0;
      if (elW > 0 && elH > 0 && (Math.abs(c.width - elW) > 2 || Math.abs(c.height - elH) > 2)) {
        // devicePixelRatio scaling means width != clientWidth; only kick
        // when the canvas is clearly stale (half size or less of container
        // times dpr) to avoid resize loops on hidpi.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (c.width < (elW * dpr) / 2 || c.height < (elH * dpr) / 2) return true;
      }
      return false;
    } catch { return false; }
  };
  requestAnimationFrame(() => requestAnimationFrame(kickResize));
  setTimeout(kickResize, 400);
  setTimeout(kickResize, 1200);
  let healTicks = 0;
  let sawNonZero = false; // heal runs until the first non-zero canvas, not just 30 s
  const healTimer = setInterval(() => {
    healTicks++;
    try {
      const c = map.getCanvas?.();
      if (c && (c.width | 0) > 0 && (c.height | 0) > 0) sawNonZero = true;
      if (needsKick()) kickResize();
    } catch {}
    if ((healTicks > 60 && sawNonZero) || healTicks >= 240) clearInterval(healTimer);
  }, 500);
  // Per-mount listeners with named refs so dispose() below can remove
  // every one of them (P9: anonymous window listeners used to outlive the
  // instance and resize() dead maps).
  let ro = null;
  const onRO = () => {
    try {
      if (needsKick()) kickResize();
    } catch {}
  };
  try {
    ro = new ResizeObserver(onRO);
    ro.observe(el);
  } catch {
    ro = null;
    window.addEventListener('resize', kickResize);
  }
  window.addEventListener('resize', kickResize);
  window.addEventListener('orientationchange', kickResize);
  const onVis = () => {
    if (!document.hidden) kickResize();
  };
  document.addEventListener('visibilitychange', onVis);
  try {
    window.__ring2resizeMap = kickResize;
  } catch {}
  // Per-mount dispose: stops the heal timer, disconnects the RO, removes
  // every window/document listener owned by THIS instance. Called from
  // remount/fresh-container BEFORE remove() so a dead map never kicks
  // again. The live census drops in the remove wrap (remove is the true
  // end of the GL context).
  function disposeInst() {
    if (disposed) return;
    disposed = true;
    try {
      clearInterval(healTimer);
    } catch {}
    try {
      ro?.disconnect?.();
    } catch {}
    try {
      window.removeEventListener('resize', kickResize);
    } catch {}
    try {
      window.removeEventListener('orientationchange', kickResize);
    } catch {}
    try {
      document.removeEventListener('visibilitychange', onVis);
    } catch {}
  }
  // Stale-ref clear: main.js tears instances down via remove() on remount.
  // Null the singleton when THIS instance is removed so ground-flag writes
  // can't hit a dead map while the status line blames the live one.
  try {
    const origRemove = map.remove.bind(map);
    map.remove = () => {
      try {
        origRemove();
      } finally {
        disposeInst();
        if (counted) {
          counted = false;
          try {
            if (ctxmon) ctxLive(ctxmon, -1);
          } catch { /* census never breaks teardown */ }
        }
        releaseMap(map);
        try {
          if (window.__ring2map === map) window.__ring2map = null;
        } catch {
          /* diag ref only */
        }
      }
    };
  } catch {
    /* remove stays stock — main.js nulls its own ref */
  }
  _map = map;
  window.__ring2map = map;
  return { map, loadedClean, dispose: disposeInst, isCtxLost: () => ctxLostFlag };
}
