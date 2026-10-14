// src/map/main.js — Phase 03 Tasks 16-19 + GATE 3 look pass + Handoff-3
// Lane 1: flat light Azerbaijan country map (Carto Positron GL, keyless;
// Esri satellite raster, flat default, NO toggle ribbon — sat is
// transition-only: pre-warmed + ramped DURING the outbound zoom flight to
// the clicked H3 ring bounds, reversed on recede) with a single pulsing
// SANGACHAL monitoring blip (40.201262N 49.481270E). Blip color = site worst-health from ./feed.js
// (existing HEALTH_COLORS; ?force=<sector>:<health> override still works).
// Click-to-twin overlay (?sector=<h3>) + X/Esc/back round-trip wiring is
// UNTOUCHED from Tasks 18+19. Single blip opens the twin for the worst
// sector (first sector at the worst rank); no invented sites.
// Probe surface: window.__mapProbe { ready, base, satOn, rings, pins, mode,
// worst, worstAsset, sectorH3, selected, twinOpen, errors[], openTwin,
// closeTwin, selectSector, blips, siteWorst, siteSector }.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
if (maplibregl?.config) maplibregl.config.WORKER_URL = workerUrl;
import { MapLibreOverlay } from 'deck.gl';
import { PolygonLayer, ScatterplotLayer } from 'deck.gl';
import { SITE, sectorsWithOverride, worstHealth, HEALTH_COLORS, HEALTH_RANK } from './feed.js';
import { buildPinData } from './rings.js';
import {
  installZoomJourney,
  zoomToProgress,
  satOpacityForZoom,
  centerBlendForZoom,
  shouldCenter,
  isTopDown,
  needsHandoff,
  isHomeZoom,
  Z_MIN,
  Z_HANDOFF,
  Z_TOP,
  Z_MAX,
} from './scrolltrigger.js';
import {
  sectorH3Map,
  twinUrl,
  h3Bounds,
  parseSectorParam,
  findSector,
  worstAssetId,
  TWIN_CLOSE_MSG,
  TWIN_READY_MSG,
  parseTwinFsMessage,
  parseTwinReadyMessage,
} from './twinlink.js';

const POSITRON_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_SOURCE_ID = 'esri-sat';
const SAT_LAYER_ID = 'esri-sat';
const SEL_KEY = 'ops3d-map-selected';
// GATE 3: country view of Azerbaijan with the Sangachal blip.
const COUNTRY_CENTER = [47.6, 40.15];
const COUNTRY_ZOOM = 6.4;

const errors = [];
window.addEventListener('error', (e) => errors.push('ERR: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  errors.push('REJECT: ' + (r && (r.message || r)));
});

const qs = new URLSearchParams(location.search);
const pinMode = qs.get('pins') === '1';
const sectors = sectorsWithOverride(location.search);
const worst = Object.fromEntries(sectors.map((s) => [s.id, worstHealth(s.assets)]));
const h3map = sectorH3Map(sectors);
const worstBySector = Object.fromEntries(sectors.map((s) => [s.id, worstAssetId(s)]));

// GATE 3: single-site rollup. Site worst = worst rank across all sector
// assets; site sector = first sector holding that rank (twin target).
function siteRollup() {
  let rank = 0;
  for (const s of sectors) {
    for (const a of s.assets) rank = Math.max(rank, HEALTH_RANK[a.health] ?? 0);
  }
  const entry = Object.entries(HEALTH_RANK).find(([, r]) => r === rank);
  const siteWorst = entry ? entry[0] : 'ok';
  const siteSector = sectors.find((s) => worst[s.id] === siteWorst)?.id ?? sectors[0].id;
  return { siteWorst, siteSector };
}
const { siteWorst, siteSector } = siteRollup();
const siteColor = HEALTH_COLORS[siteWorst] ?? HEALTH_COLORS.ok;

function readStoredSelection() {
  try {
    const v = sessionStorage.getItem(SEL_KEY);
    return sectors.some((s) => s.id === v) ? v : null;
  } catch {
    return null;
  }
}

let selectedId = findSector(sectors, parseSectorParam(location.search))?.id
  ?? readStoredSelection();
let twinOpen = false;
let deckOverlay = null;
let deckFeats = [];
let deckPins = [];
let overlayEls = null;
// T2 handoff choreography refs: live map + sat setter (assigned on load),
// in-flight sector id or null. Handoff-3: twinFs tracks overlay-fullscreen
// requested via the twin {type:'safepipe-twin-fullscreen'} protocol.
let mapRef = null;
let setSatRef = null;
let transitId = null;
let twinFs = false;
// Handoff-11-A (FM-2): recede leg flag. Set on recede start, cleared ONLY by
// landHome (idempotent, token-guarded): while set, the gesture trigger
// swallows wheels/pinches (frame held) so a mid-recede jumpTo can never
// cancel the recede easeTo and fire landHome early with a POSITION-OFF rest.
let receding = false;
let recedeDone = false;
// Handoff-5-close: single close chain. CLOSE_FADE_MS mirrors the forward
// reveal; RECEDE_DELAY_MS starts sat->flat + zoom-out after the fade.
// GATE-3 REVISION tempo: 450ms fades overlap the recede for one gesture.
// closeSeq invalidates a pending hide/recede when a fresh open lands first.
const CLOSE_FADE_MS = 450;
const RECEDE_DELAY_MS = 500;
let closeSeq = 0;
// Handoff-4 Lane A seeded reveal: prewarm state. pendingReveal = { id, timer,
// revealed } or null. twinReady mirrors the Lane B {type:TWIN_READY_MSG}
// signal; prewarm is true while the overlay iframe loads hidden at opacity 0.
let pendingReveal = null;
const REVEAL_TIMEOUT_MS = 4000;

window.__mapProbe = {
  ready: false, base: 'positron', satOn: false,
  rings: 0, pins: 1, mode: pinMode ? 'pins' : 'rings',
  worst, worstAsset: worstBySector, sectorH3: null,
  selected: selectedId, twinOpen: false,
  blips: 1, siteWorst, siteSector, site: { lat: SITE.lat, lon: SITE.lon, name: 'SANGACHAL' },
  transit: null, handoff: null, vignette: false, mapFs: false, twinFs: false,
  prewarm: false, twinReady: false, reveal: null, revealFallback: false, revealLate: false,
  recede: null, mapZoom: null, reverseWait: false, reverseFallback: false,
  // GATE-9-A scrub probe: journey progress driving zoom/center/fade.
  scrub: { progress: 0, zoom: null, opacity: 0, centerDist: null },
  centerEase: 0, autoCenter: false, satOpacity: 0,
  // GATE-12-A native-zoom probe: zoom-keyed journey, proximity, ring clip.
  proximity: null, ringClip: { k: 0, cursorNear: false, centerNear: false },
  zoomJourney: { zMin: 6.4, zHand: 12, zTop: 11, zMax: 14, topDown: false, handoff: false, home: true },
  isoBridge: false, deepHandoff: null,
  vectorWarm: false, vectorCache: null, vectorSnapshot: false, vectorHold: false,
  vectorReturnMs: null,
  // Handoff-11-A predictive precache: velocity-predicted next frame kept warm.
  precache: { predicted: 0, velocity: 0, prefetched: 0, hits: 0, tiles: null },
  errors, openTwin, closeTwin, selectSector, flyToSectorThenTwin,
  toggleMapFs, setTwinFs, prewarmThenReveal, revealTwin,
};

function fallbackStyle() {
  return {
    version: 8,
    name: 'safepipe-map-fallback-flat',
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f2f1ec' } }],
  };
}

async function loadStyle() {
  try {
    const res = await fetch(POSITRON_STYLE);
    if (!res.ok) throw new Error('positron HTTP ' + res.status);
    const style = await res.json();
    // LANE A naked flat view: strip ALL place-name/label layers at runtime
    // (every symbol layer), keep geometry/roads/water. Filter the fetched
    // style AND defensively re-apply post-load (see stripLabelLayers).
    try {
      const before = Array.isArray(style.layers) ? style.layers.length : 0;
      style.layers = (style.layers || []).filter((l) => {
        if (!l || typeof l !== 'object') return true;
        if (l.type === 'symbol') return false;
        const sl = l['source-layer'];
        if (sl && (sl === 'place' || sl === 'poi' || sl === 'water_name' ||
          sl === 'transportation_name' || sl === 'housenumber' || sl === 'waterway')) return false;
        return true;
      });
      window.__mapProbe.naked = true;
      window.__mapProbe.strippedLabels = before - style.layers.length;
    } catch { /* filter is best-effort */ }
    return style;
  } catch (err) {
    errors.push('STYLE-FALLBACK: ' + (err && err.message));
    window.__mapProbe.base = 'fallback';
    return fallbackStyle();
  }
}

/* LANE A: hide any symbol (label) layers that arrive via runtime style
 * additions. Keeps geometry/roads/water; removes place names. Matches by
 * layer type AND by label source-layer (place, poi, water_name,
 * transportation_name, housenumber, waterway) so a relabelled/added layer
 * can never slip through an id list. Removes the layer when possible,
 * hides it otherwise. */
const LABEL_SOURCE_LAYERS = new Set([
  'place', 'poi', 'water_name', 'transportation_name', 'housenumber', 'waterway',
]);
function isLabelLayer(l) {
  try {
    if (!l || typeof l !== 'object') return false;
    if (l.type === 'symbol') return true;
    if (l['source-layer'] && LABEL_SOURCE_LAYERS.has(l['source-layer'])) return true;
  } catch { /* best-effort */ }
  return false;
}
function stripLabelLayers(map) {
  try {
    const style = map.getStyle();
    const layers = (style && style.layers) || [];
    let n = 0;
    for (const l of layers) {
      try {
        if (!isLabelLayer(l)) continue;
        // Prefer removal (frees glyph fetches); fall back to hiding.
        try {
          if (map.getLayer(l.id)) map.removeLayer(l.id);
          else continue;
        } catch {
          try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch { /* per-layer best-effort */ }
        }
        n++;
      } catch { /* per-layer best-effort */ }
    }
    // Accumulate: loadStyle() already recorded the fetch-time strip count;
    // never overwrite it with a smaller post-load number.
    try {
      const prev = +window.__mapProbe.strippedLabels || 0;
      window.__mapProbe.strippedLabels = Math.max(prev, n);
    } catch { /* probe cosmetic */ }
  } catch { /* pre-ready */ }
}

/* LANE A: minimal micro attribution (replaces the pill + info button).
 * OSM/CARTO/Esri terms require a credit — tiny bottom-left text only. */
function mountMicroCredit() {
  try {
    if (document.getElementById('map-credit')) return;
    const el = document.createElement('div');
    el.id = 'map-credit';
    el.textContent = '© OpenStreetMap contributors © CARTO · Esri World Imagery';
    document.getElementById('app').appendChild(el);
  } catch { /* cosmetic */ }
}

/** deck.gl layers: single Sangachal blip (halo + core) only. No TextLayer:
 * the blip name rides in the DOM pill (.map-pin__tag); a deck text label
 * duplicated it as a second dark-gray caption above the halo. */
function deckLayers() {
  const onPick = (info) => {
    const s = info && info.object && info.object.sector;
    if (s) flyToSectorThenTwin(s);
  };
  return [
    new PolygonLayer({
      id: 'sector-rings',
      data: deckFeats,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.color,
      getLineColor: (d) => (d.sector === selectedId ? [184, 134, 11, 255] : [255, 255, 255, 255]),
      getLineWidth: (d) => (d.sector === selectedId ? 4 : 2),
      lineWidthUnits: 'pixels',
      filled: true,
      stroked: true,
      opacity: 0.85,
      pickable: true,
      onClick: onPick,
      updateTriggers: { getLineColor: selectedId, getLineWidth: selectedId },
    }),
    new ScatterplotLayer({
      id: 'sector-halo',
      data: deckPins,
      getPosition: (d) => d.position,
      getFillColor: (d) => [d.color[0], d.color[1], d.color[2], 70],
      getRadius: 34,
      radiusUnits: 'pixels',
      stroked: false,
      pickable: false,
    }),
    new ScatterplotLayer({
      id: 'sector-pins',
      data: deckPins,
      getPosition: (d) => d.position,
      getFillColor: (d) => d.color,
      getRadius: 14,
      radiusUnits: 'pixels',
      stroked: true,
      getLineColor: [255, 255, 255, 255],
      lineWidthUnits: 'pixels',
      getLineWidth: 3,
      pickable: true,
      onClick: onPick,
    }),
  ];
}

function ensureOverlay() {
  if (overlayEls) return overlayEls;
  const root = document.createElement('div');
  root.id = 'twin-overlay';
  root.hidden = true;
  root.innerHTML =
    '<div class="twin-overlay__bar">' +
    '<span class="twin-overlay__label" id="twin-label"></span>' +
    '<button id="twin-close" title="Close twin (Esc)">&#x2715; CLOSE</button>' +
    '</div>' +
    '<iframe id="twin-frame" title="Sector twin" data-url="about:blank"></iframe>';
  document.getElementById('app').appendChild(root);
  const frame = root.querySelector('#twin-frame');
  const closeBtn = root.querySelector('#twin-close');
  const label = root.querySelector('#twin-label');
  closeBtn.addEventListener('click', () => closeTwin());
  overlayEls = { root, frame, closeBtn, label };
  return overlayEls;
}

/* Frame navigation that never grows the joint session history: plain
 * src assignment pushes a subframe entry on every load after the first,
 * so a later history.back() steps the twin (blanking it) instead of
 * reaching the parent entry. location.replace() swaps in place — the
 * entry count stays flat (probed: 2→2 across loads) and back() always
 * lands on a parent entry. data-url mirrors the target for the probe. */
function setFrameUrl(frame, url) {
  if (frame.getAttribute('data-url') === url) return;
  try {
    frame.contentWindow.location.replace(url);
  } catch (err) {
    frame.setAttribute('src', url); // same-origin fallback, shouldn't fire
    errors.push('FRAME: ' + (err && err.message));
  }
  try {
    frame.setAttribute('data-url', url);
  } catch { /* introspection attr is best-effort */ }
}

function mapUrlWithSector(h3) {
  try {
    const u = new URL(location.href);
    if (h3) u.searchParams.set('sector', h3);
    else u.searchParams.delete('sector');
    return u.pathname + u.search + u.hash;
  } catch {
    return location.pathname;
  }
}

function selectSector(id) {
  if (!sectors.some((s) => s.id === id)) return false;
  selectedId = id;
  try {
    sessionStorage.setItem(SEL_KEY, id);
  } catch { /* selection memory is best-effort */ }
  window.__mapProbe.selected = id;
  document.querySelectorAll('.map-pin').forEach((p) => {
    if (p.dataset.sector === id || p.dataset.sector === siteSector) p.setAttribute('data-sel', 'true');
    else p.removeAttribute('data-sel');
  });
  if (deckOverlay) {
    try {
      deckOverlay.setProps({ layers: deckLayers() });
    } catch (err) {
      errors.push('LAYERS: ' + (err && err.message));
    }
  }
  return true;
}

/** Live handoff frame: map center + zoom rounded for URL params. Null pre-load. */
function liveFrame() {
  try {
    if (!mapRef) return null;
    const c = mapRef.getCenter();
    return {
      cx: +c.lng.toFixed(6),
      cy: +c.lat.toFixed(6),
      z: +mapRef.getZoom().toFixed(2),
    };
  } catch {
    return null;
  }
}

/** T2 vignette: black periphery radial overlay over the map chrome. */
function showVignette(on) {
  try {
    const v = document.getElementById('map-vignette');
    if (v) v.classList.toggle('on', !!on);
  } catch { /* cosmetic */ }
  window.__mapProbe.vignette = !!on;
}

/** Force the sat layer (choreography path only — no toggle chrome exists).
 * Layer + probe stay in sync (FM-8: satOpacity mirrors the forced state so
 * the probe never reports 1.0 over a flat frame after a close). Leaving
 * scrub control restores the 450ms ramp (FM-6c) that setSatScrubbed's
 * duration-0 paint would otherwise inherit as a snap. */
function setSatForced(on) {
  try {
    if (setSatRef) setSatRef(!!on);
  } catch (err) {
    errors.push('SAT-FORCE: ' + (err && err.message));
  }
  try {
    if (mapRef && mapRef.getLayer(SAT_LAYER_ID)) {
      mapRef.setPaintProperty(SAT_LAYER_ID, 'raster-opacity-transition', { duration: 450, delay: 0 });
    }
  } catch { /* transition restore is best-effort */ }
  window.__mapProbe.satOn = !!on;
  try {
    window.__mapProbe.satOpacity = on ? 1 : 0;
  } catch { /* probe cosmetic */ }
}

/** LANE A outbound pre-warm: make the sat raster visible at opacity 0 so
 * tiles load DURING the bounds zoom — the later crossfade never flashes.
 * Probe satOn stays false until the real crossfade (setSatForced(true)). */
function warmSatTiles() {
  try {
    if (!mapRef || !mapRef.getLayer(SAT_LAYER_ID)) return;
    mapRef.setLayoutProperty(SAT_LAYER_ID, 'visibility', 'visible');
    try {
      mapRef.setPaintProperty(SAT_LAYER_ID, 'raster-opacity', 0);
    } catch { /* paint warm is best-effort */ }
  } catch { /* pre-ready */ }
}

/* GATE-12-A NATIVE-ZOOM journey (map side). Native zoom OWNS zoom depth —
 * the journey only READS it. Fade keys off zoom at the CURRENT center (no
 * fly-to, no jump: identical anywhere). Center eases onto the spot ONLY
 * under proximity (cursor near hotspot OR hotspot near canvas center past
 * Z arm); the ring clip converges canvas-edges -> ring-edges with it.
 * Past the top-down checkpoint deeper zoom bridges top->iso, then hands to
 * the twin through the SAME flyToSectorThenTwin entries as the click path.
 * Zoom-out retraces identical checkpoints; the min-zoom cap converts
 * overshoot into the reverse journey (never a stuck park past the cap). */
const SITE_LNGLAT = [SITE.lon, SITE.lat];
const PROX_CURSOR_PX = 140; // cursor within this of the hotspot -> near
const PROX_CENTER_PX = 90; // hotspot within this of canvas center -> near
const CENTER_EASE_MS = 280; // throttle between proximity ease steps
const CENTER_EPS_DEG = 2e-4; // skip the ease when already on the spot
let scrubProgress = 0;
let scrubFired = false;
let cachedVectorStyle = null;
let recedeStartT = 0;
let lastCursor = null; // {x,y} client px, passive mousemove only
let lastCenterEaseT = 0;
let isoBridged = false;

function clamp01(v) {
  const n = +v;
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function smooth01(t) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}
/** Proximity read: hotspot screen px vs cursor + vs canvas center.
 * Returns { sx, sy, distCursor, distCenter, cursorNear, centerNear,
 * near } or null pre-ready. Passive read only — never moves the map. */
function proximityInfo() {
  try {
    if (!mapRef || typeof mapRef.project !== 'function') return null;
    const pt = mapRef.project(SITE_LNGLAT);
    if (!pt || !Number.isFinite(+pt.x) || !Number.isFinite(+pt.y)) return null;
    let cw = 0;
    let ch = 0;
    try {
      const el = mapRef.getContainer();
      cw = (el && el.clientWidth) || window.innerWidth || 800;
      ch = (el && el.clientHeight) || window.innerHeight || 600;
    } catch {
      cw = 800;
      ch = 600;
    }
    const dxC = pt.x - cw / 2;
    const dyC = pt.y - ch / 2;
    const distCenter = Math.sqrt(dxC * dxC + dyC * dyC);
    let distCursor = null;
    let cursorNear = false;
    if (lastCursor && Number.isFinite(+lastCursor.x) && Number.isFinite(+lastCursor.y)) {
      try {
        const r = mapRef.getContainer().getBoundingClientRect();
        const lx = lastCursor.x - (r ? r.left : 0);
        const ly = lastCursor.y - (r ? r.top : 0);
        const dx = pt.x - lx;
        const dy = pt.y - ly;
        distCursor = Math.sqrt(dx * dx + dy * dy);
        cursorNear = distCursor <= PROX_CURSOR_PX;
      } catch { /* cursor math is best-effort */ }
    }
    const centerNear = distCenter <= PROX_CENTER_PX;
    return {
      sx: +pt.x.toFixed(1), sy: +pt.y.toFixed(1),
      distCursor: distCursor == null ? null : +distCursor.toFixed(1),
      distCenter: +distCenter.toFixed(1),
      cursorNear, centerNear, near: cursorNear || centerNear,
    };
  } catch {
    return null;
  }
}

/** Ring clip: corner brackets converge canvas-edges -> ring-edges with the
 * center blend. k=0 rests at the canvas edges, k=1 hugs the hotspot ring. */
function updateRingClip(k, prox) {
  const v = clamp01(k);
  try {
    let clip = document.getElementById('ring-clip');
    if (!clip) {
      clip = document.createElement('div');
      clip.id = 'ring-clip';
      clip.setAttribute('aria-hidden', 'true');
      clip.innerHTML = '<i class="rc-tl"></i><i class="rc-tr"></i><i class="rc-bl"></i><i class="rc-br"></i>';
      const app = document.getElementById('app');
      if (app) app.appendChild(clip);
    }
    clip.style.setProperty('--clip', v.toFixed(4));
    clip.classList.toggle('on', v > 0.02);
  } catch { /* cosmetic */ }
  try {
    window.__mapProbe.ringClip = {
      k: +v.toFixed(4),
      cursorNear: !!(prox && prox.cursorNear),
      centerNear: !!(prox && prox.centerNear),
    };
  } catch { /* probe cosmetic */ }
  return v;
}
/** Hold the vector style/tiles warm: cache the style JSON, keep every
 * source+layer mounted, and repaint so country tiles stay resident. */
function holdVectorWarm(reason) {
  try {
    if (mapRef && typeof mapRef.getStyle === 'function' && !cachedVectorStyle) {
      try {
        cachedVectorStyle = JSON.parse(JSON.stringify(mapRef.getStyle()));
      } catch {
        try { cachedVectorStyle = mapRef.getStyle(); } catch { /* best-effort */ }
      }
    }
  } catch { /* cache is best-effort */ }
  try {
    if (mapRef && typeof mapRef.triggerRepaint === 'function') mapRef.triggerRepaint();
  } catch { /* repaint is best-effort */ }
  try {
    window.__mapProbe.vectorWarm = true;
    window.__mapProbe.vectorCache = 'held';
    window.__mapProbe.vectorSnapshot = true;
    window.__mapProbe.vectorSnapshotT = Date.now();
    window.__mapProbe.vectorHoldReason = reason || null;
  } catch { /* probe cosmetic */ }
}
/** Scrubbed sat opacity: tracks scroll progress exactly (duration-0 paint).
 * Visibility stays on through the journey so tiles never reload mid-fade. */
function setSatScrubbed(p) {
  const v = clamp01(p);
  try {
    if (mapRef && mapRef.getLayer(SAT_LAYER_ID)) {
      try {
        mapRef.setLayoutProperty(SAT_LAYER_ID, 'visibility', 'visible');
      } catch { /* layout is best-effort */ }
      try {
        try {
          mapRef.setPaintProperty(SAT_LAYER_ID, 'raster-opacity-transition', { duration: 0, delay: 0 });
        } catch { /* transition reset is best-effort */ }
        mapRef.setPaintProperty(SAT_LAYER_ID, 'raster-opacity', v);
      } catch (err) {
        errors.push('SAT-SCRUB: ' + (err && err.message));
      }
    }
  } catch { /* pre-ready */ }
  try {
    window.__mapProbe.satOpacity = +v.toFixed(4);
    window.__mapProbe.satOn = v > 0.02;
  } catch { /* probe cosmetic */ }
  return v;
}
/** Flat hold veil covering the zoom-out vector refill (same flat bg tone,
 * so a tile pop reads as one continuous surface, never a reload flash). */
function showVectorHold(on) {
  try {
    let veil = document.getElementById('vector-hold');
    if (!veil) {
      veil = document.createElement('div');
      veil.id = 'vector-hold';
      const app = document.getElementById('app');
      if (app) app.appendChild(veil);
      else return;
    }
    veil.classList.toggle('on', !!on);
  } catch { /* cosmetic */ }
  try {
    window.__mapProbe.vectorHold = !!on;
  } catch { /* probe cosmetic */ }
}
/** THE native-zoom driver: reads ONE zoom snapshot (the map owns zoom —
 * this never sets zoom, never jumpTo's depth). Fade tracks zoom at the
 * CURRENT center; center eases onto the spot only under proximity; deep
 * zoom past the top-down checkpoint bridges top->iso then hands to the
 * twin through flyToSectorThenTwin; zoom-out at/below the min cap lands
 * the mirrored reverse home. */
function onNativeZoomStep(snap, source) {
  try {
    if (!mapRef) return;
    let z = snap && Number.isFinite(+snap.z) ? +snap.z : null;
    try {
      const live = mapRef.getZoom();
      if (Number.isFinite(+live)) z = +live;
    } catch { /* snapshot zoom is best-effort */ }
    if (!Number.isFinite(z)) return;
    // Min-zoom cap: MapLibre clamps via minZoom, but a fast wheel burst can
    // report a hair under — convert overshoot into the reverse journey
    // instead of parking past the cap (the reported stuck state).
    if (z < COUNTRY_ZOOM) {
      try {
        if (typeof mapRef.jumpTo === 'function') mapRef.jumpTo({ zoom: COUNTRY_ZOOM });
        else mapRef.easeTo({ zoom: COUNTRY_ZOOM, duration: 0 });
      } catch { /* cap clamp is best-effort */ }
      z = COUNTRY_ZOOM;
    }
    const progress = zoomToProgress(z);
    scrubProgress = progress;
    holdVectorWarm(source === 'native-zoomend' ? 'zoomend' : 'native-zoom');
    // (2) FADE WHERE YOU ARE — zoom-keyed opacity at whatever center the
    // user sits on. Duration-0 paint so it never runs its own rhythm.
    const opacity = setSatScrubbed(satOpacityForZoom(z));
    trackAndPrecache(progress);
    let dist = null;
    try {
      const c = mapRef.getCenter();
      const dx = c.lng - SITE_LNGLAT[0];
      const dy = c.lat - SITE_LNGLAT[1];
      dist = +Math.sqrt(dx * dx + dy * dy).toFixed(5);
    } catch { /* probe cosmetic */ }
    const prox = proximityInfo();
    const blend = centerBlendForZoom(z);
    // Ring clip converges canvas-edges -> ring-edges only while near;
    // far away it rests at the canvas edges (k=0) so zoom reads the same.
    const clipK = prox && prox.near ? blend : 0;
    updateRingClip(clipK, prox);
    try {
      window.__mapProbe.scrub = {
        progress: +progress.toFixed(4),
        zoom: +z.toFixed(3),
        opacity: +opacity.toFixed(4),
        centerDist: dist,
      };
      window.__mapProbe.mapZoom = +z.toFixed(2);
      window.__mapProbe.proximity = prox;
      try {
        window.__mapProbe.zoomJourney = {
          zMin: Z_MIN, zHand: Z_HANDOFF, zTop: Z_TOP, zMax: Z_MAX,
          topDown: isTopDown(z), handoff: needsHandoff(z), home: isHomeZoom(z),
        };
      } catch { /* probe cosmetic */ }
    } catch { /* probe cosmetic */ }
    const busyNow = !!(transitId || pendingReveal || reverseWait || receding);
    // (3) PROXIMITY CENTERING — past the arm zoom, ease center onto the
    // spot + top-down ONLY when near. Throttled, epsilon-guarded, and it
    // preserves the native zoom (never sets depth).
    if (!twinOpen && !busyNow && shouldCenter(z) && prox && prox.near) {
      let now = 0;
      try {
        now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      } catch {
        now = Date.now();
      }
      const far = dist == null || dist > CENTER_EPS_DEG;
      let tilt = false;
      try {
        const b = mapRef.getBearing();
        const p = mapRef.getPitch();
        tilt = Math.abs(b || 0) > 0.5 || Math.abs(p || 0) > 0.5;
      } catch { /* bearing read is best-effort */ }
      if ((far || tilt) && now - lastCenterEaseT >= CENTER_EASE_MS) {
        lastCenterEaseT = now;
        try {
          mapRef.easeTo({ center: SITE_LNGLAT.slice(), bearing: 0, pitch: 0, duration: 250 });
        } catch (err) {
          errors.push('CENTER-EASE: ' + (err && err.message));
        }
      }
      try {
        window.__mapProbe.centerEase = +blend.toFixed(4);
        window.__mapProbe.autoCenter = true;
      } catch { /* probe cosmetic */ }
    } else {
      try {
        window.__mapProbe.centerEase = +blend.toFixed(4);
        window.__mapProbe.autoCenter = false;
      } catch { /* probe cosmetic */ }
    }
    // (4) DEEPER ZOOM — past top-down, bridge top->iso on approach, then
    // hand to the twin through the SAME click-path entries.
    if (!twinOpen && !busyNow && isTopDown(z) && !needsHandoff(z) && prox && prox.near && !isoBridged) {
      try {
        const p = mapRef.getPitch();
        if (Number.isFinite(+p) && +p < 20) {
          isoBridged = true;
          try {
            mapRef.easeTo({ pitch: 45, bearing: 0, duration: 300 });
          } catch { /* iso bridge is best-effort */ }
          try {
            window.__mapProbe.isoBridge = true;
          } catch { /* probe cosmetic */ }
        }
      } catch { /* pitch read is best-effort */ }
    }
    if (!twinOpen && !busyNow && needsHandoff(z)) {
      if (!scrubFired) {
        scrubFired = true;
        try {
          window.__mapProbe.deepHandoff = { z: +z.toFixed(2) };
        } catch { /* probe cosmetic */ }
        flyToSectorThenTwin(siteSector);
      }
    } else if (z < Z_HANDOFF - 0.5 && scrubFired && !twinOpen) {
      scrubFired = false; // re-arm: a fresh deep zoom may hand off again
      isoBridged = false;
    }
    // (5) MIRRORED REVERSE — at/below the cap the checkpoints retrace:
    // fade is already ~0 here; land the journey home and re-arm.
    if (isHomeZoom(z)) {
      if (scrubProgress > 0.001 || scrubFired || isoBridged) {
        scrubFired = false;
        isoBridged = false;
      }
      try {
        if (window.__mapProbe.recede === 'out') window.__mapProbe.recede = 'home';
      } catch { /* probe cosmetic */ }
      if (progress <= 0.001) {
        try {
          window.__mapProbe.centerEase = 0;
          window.__mapProbe.autoCenter = false;
        } catch { /* probe cosmetic */ }
      }
    }
    try {
      if (typeof positionDomPins === 'function' && mapRef) positionDomPins(mapRef);
    } catch { /* pins cosmetic */ }
  } catch (err) {
    errors.push('ZOOM-STEP: ' + (err && err.message));
  }
}
/** Reset the journey after a close lands home (progress + edge re-arm). */
function resetScrubJourney() {
  scrubProgress = 0;
  scrubFired = false;
  isoBridged = false;
  try {
    window.__mapProbe.isoBridge = false;
  } catch { /* probe cosmetic */ }
  try {
    updateRingClip(0, null);
  } catch { /* reset is best-effort */ }
  try {
    window.__mapProbe.scrub = { progress: 0, zoom: +COUNTRY_ZOOM.toFixed(3), opacity: 0, centerDist: null };
    window.__mapProbe.centerEase = 0;
    window.__mapProbe.autoCenter = false;
  } catch { /* probe cosmetic */ }
}

/* Handoff-11-A DEFECT 3 — predictive precache (map side): from scroll/zoom
 * velocity predict the next journey frame (~250ms ahead) and keep it warm.
 * Vector stays HELD (existing holdVectorWarm — style cached, sources/layers
 * never removed); satellite tiles along the flight path are pre-fetched as
 * image preloads into a small capped cache, so travel in EITHER direction
 * never shows a reload pop. Best-effort throughout: offline tile fetches
 * must never error the probe. Sibling Lane B owns twin-side precache;
 * message contract only (no shared code). */
const PRECACHE_LOOKAHEAD_S = 0.25; // predict 250ms of motion ahead
const PRECACHE_MIN_P_DELTA = 0.02; // refetch only when prediction moved on
const PRECACHE_MIN_MS = 600; // ... or this long elapsed
const PRECACHE_MAX_TILES = 64; // cap the warm image cache
const satTileSeen = new Set(); // url -> warm (insertion-ordered for evict)
let precachePrefetched = 0;
let precacheHits = 0;
let lastPrecProgP = 0;
let lastPrecT = 0;
let precVel = 0; // journey progress per second (EMA)
let lastPrefetchPred = -1;
let lastPrefetchT = 0;
function satTileUrl(z, x, y) {
  return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;
}
function lngLatToTile(lon, lat, z) {
  const n = Math.pow(2, z);
  const x = Math.floor(((+lon + 180) / 360) * n);
  const lr = (+lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n);
  return { x, y };
}
/** Pre-fetch the 3x3 sat tile patch around center at zoom (best-effort). */
function prefetchSatTiles(center, zoom) {
  try {
    const z = Math.max(0, Math.min(19, Math.floor(+zoom)));
    if (!Number.isFinite(z)) return;
    const c = Array.isArray(center) && center.length === 2 ? center : COUNTRY_CENTER;
    if (!Number.isFinite(+c[0]) || !Number.isFinite(+c[1])) return;
    const t = lngLatToTile(c[0], c[1], z);
    const n = Math.pow(2, z);
    const urls = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = t.x + dx;
        const y = t.y + dy;
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= n || y >= n) continue;
        urls.push(satTileUrl(z, x, y));
      }
    }
    try {
      window.__mapProbe.precache.tiles = { z, x: t.x, y: t.y, n: urls.length };
    } catch { /* probe cosmetic */ }
    for (const url of urls) {
      try {
        if (satTileSeen.has(url)) {
          precacheHits += 1;
          continue;
        }
        satTileSeen.add(url);
        while (satTileSeen.size > PRECACHE_MAX_TILES) {
          const oldest = satTileSeen.values().next();
          if (oldest && !oldest.done) {
            try { satTileSeen.delete(oldest.value); } catch { break; }
          } else break;
        }
        try {
          const img = new Image();
          img.decoding = 'async';
          img.src = url; // warm the HTTP cache; never inserted in the DOM
        } catch { /* preload is best-effort */ }
        precachePrefetched += 1;
      } catch { /* per-tile best-effort */ }
    }
    try {
      window.__mapProbe.precache.prefetched = precachePrefetched;
      window.__mapProbe.precache.hits = precacheHits;
    } catch { /* probe cosmetic */ }
  } catch { /* precache never breaks the map */ }
}
/** Track journey velocity, predict the next frame, keep it warm. Called on
 * every scrub step (both directions). Vector hold re-asserts on fast
 * motion (throttled by the prefetch gate); sat tiles pre-fetch along path. */
function trackAndPrecache(p) {
  try {
    let now = 0;
    try {
      now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    } catch {
      now = Date.now();
    }
    const dt = Math.max(1, now - (lastPrecT || now));
    const inst = (p - lastPrecProgP) / (dt / 1000);
    precVel = Number.isFinite(inst) ? precVel * 0.6 + inst * 0.4 : precVel * 0.6;
    if (!Number.isFinite(precVel)) precVel = 0;
    lastPrecT = now;
    lastPrecProgP = p;
    const pPred = clamp01(p + precVel * PRECACHE_LOOKAHEAD_S);
    try {
      window.__mapProbe.precache.predicted = +pPred.toFixed(4);
      window.__mapProbe.precache.velocity = +precVel.toFixed(4);
    } catch { /* probe cosmetic */ }
    if (Math.abs(pPred - lastPrefetchPred) >= PRECACHE_MIN_P_DELTA || now - lastPrefetchT >= PRECACHE_MIN_MS) {
      lastPrefetchPred = pPred;
      lastPrefetchT = now;
      // GATE-12-A: predict from the LIVE frame (native zoom owns center) —
      // predicted zoom spans the journey range, center stays where the user
      // is (nudged to the spot only under an armed proximity blend).
      let predCenter = COUNTRY_CENTER;
      let predZoom = COUNTRY_ZOOM;
      try {
        if (mapRef) {
          const c = mapRef.getCenter();
          const z = mapRef.getZoom();
          if (c && Number.isFinite(+c.lng) && Number.isFinite(+c.lat)) predCenter = [c.lng, c.lat];
          if (Number.isFinite(+z)) predZoom = +z + precVel * PRECACHE_LOOKAHEAD_S * (Z_HANDOFF - Z_MIN);
        }
      } catch { /* live frame read is best-effort */ }
      prefetchSatTiles(predCenter, predZoom);
      if (Math.abs(precVel) > 0.5) holdVectorWarm('predict');
    }
  } catch { /* precache never breaks the map */ }
}

/** Handoff-5 wide first zoom: pixel padding ≈28% of the viewport's smaller
 * side, so the ring-bounds fit stops WIDE (whole flat map / ring + generous
 * context margin) and the flat→sat crossfade plays over the full map. */
function wideFitPadding() {
  try {
    const el = mapRef ? mapRef.getContainer() : null;
    const w = (el && el.clientWidth) || window.innerWidth || 800;
    const h = (el && el.clientHeight) || window.innerHeight || 600;
    return Math.round(Math.min(w, h) * 0.28);
  } catch {
    return 180;
  }
}

/** Handoff-5-close wide destination: padded ring-bounds fit, then back off
 * 3.5 levels so the 10 km survey ring (20 km across) + margin fits the
 * viewport's short side — centered, never bleeding off edges. (MapLibre
 * reports zoom in 512-px tiles: res halves per level from 78271.5 m/px, so
 * the ring needs ~3.5 levels past the 1 km-hex fit to fill ~75% of a
 * ~577 px side.) Null when uncomputable (caller keeps the padded fit). */
function wideZoomForBounds(bounds) {
  try {
    if (!mapRef || !bounds) return null;
    const cam = mapRef.cameraForBounds(bounds, { padding: wideFitPadding() });
    if (!cam || !Number.isFinite(cam.zoom)) return null;
    return { center: cam.center, zoom: Math.min(cam.zoom - 3.5, 14) };
  } catch {
    return null;
  }
}
/** Handoff-3 outbound choreography: ease to the clicked H3 RING bounds (the
  * hex bounds — wider than the terminal footprint) with WIDE padding (~28%
 * of viewport: ring + generous context margin in view, never terminal-tight)
 * + center lock (strictly vertical top view). Sat tiles pre-warm AND the
 * flat->sat crossfade ramps DURING the zoom flight (together, not after);
 * then the twin opens with the staged ring frame (?sector&cx&cy&z).
 * Falls back to a direct open when the map isn't ready, bounds fail, or
 * motion is reduced. Re-entrant clicks are ignored. */
function flyToSectorThenTwin(id, opts = {}) {
  const s = sectors.find((x) => x.id === id);
  if (!s) return false;
  // GATE-9-A(1): hold the vector style warm BEFORE leaving the flat view,
  // so the way back never refetches it.
  holdVectorWarm('outbound');
  let bounds = null;
  try {
    bounds = h3Bounds(h3map[id]);
  } catch (err) {
    errors.push('BOUNDS: ' + (err && err.message));
  }
  const reduced = (() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  })();
  if (!mapRef || !bounds || reduced) {
    if (reduced && mapRef && bounds) {
      // Handoff-5-close: reduced-motion jumps straight to the SAME wide
      // destination (never the tight padded fit — the ring + margin rule
      // holds animated or not).
      const w = wideZoomForBounds(bounds);
      try {
        if (w) mapRef.easeTo({ center: w.center, zoom: w.zoom, bearing: 0, pitch: 0, duration: 0 });
        else mapRef.fitBounds(bounds, { bearing: 0, pitch: 0, duration: 0, padding: wideFitPadding(), maxZoom: 14 });
      } catch { /* instant-fit is best-effort */ }
      setSatForced(true);
      showVignette(true);
      openTwin(id, { ...opts, frame: liveFrame() });
      return true;
    }
    return openTwin(id, opts);
  }
  if (transitId) return false;
  transitId = id;
  window.__mapProbe.transit = id;
  // Handoff-3: pre-warm sat tiles AND ramp the flat->sat crossfade TOGETHER
  // with the zoom flight — the ramp runs during the zoom, never after it.
  warmSatTiles();
  setSatForced(true);
  showVignette(true);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try {
      mapRef.off('moveend', finish);
    } catch { /* listener teardown is best-effort */ }
    // LANE A center lock: fitBounds already centers; re-assert the ring
    // center at zoom (bearing/pitch 0) so the ring sits at the viewport
    // bounds AND centered even under asymmetric chrome.
    try {
      const c = mapRef.getCenter();
      const sw = bounds[0];
      const ne = bounds[1];
      const mid = [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2];
      const dx = Math.abs(c.lng - mid[0]);
      const dy = Math.abs(c.lat - mid[1]);
      if (dx > 1e-6 || dy > 1e-6) {
        try {
          mapRef.easeTo({ center: mid, bearing: 0, pitch: 0, duration: 180 });
        } catch { /* center nudge is best-effort */ }
      }
    } catch { /* center lock is best-effort */ }
    // Flight is done and the sat frame is already staged underneath (the
    // crossfade ran during the zoom). Handoff-4: HOLD the map end-frame and
    // PRE-WARM the twin hidden (opacity 0) until it posts
    // {type:'safepipe-twin-ready'} (or the ~4s fallback), then crossfade.
    // Handoff-5-close: publish the staged zoom for the framing probe.
    try {
      window.__mapProbe.mapZoom = liveFrame()?.z ?? null;
    } catch { /* probe cosmetic */ }
    setTimeout(() => {
      transitId = null;
      window.__mapProbe.transit = null;
      prewarmThenReveal(id, liveFrame(), opts);
    }, 180); // GATE-3 REVISION tempo: tight settle — sat already staged
  };
  try {
    mapRef.once('moveend', finish);
  } catch {
    return openTwin(id, opts);
  }
  setTimeout(finish, 3500); // fallback if moveend never fires
  try {
    // Handoff-5-close wide first zoom: padded ring-bounds fit sets the framing,
    // then back off 3.5 levels so the flight stops WIDE (10 km survey ring +
    // margin in frame, never bleeding) and the flat→sat crossfade plays
    // over the full map. Single easeTo, still centered on the ring.
    // liveFrame() then carries this wider z into ?cx&cy&z for the twin.
    const w = wideZoomForBounds(bounds);
    if (!w) throw new Error('wide-fit-unavailable');
    mapRef.easeTo({
      center: w.center,
      zoom: w.zoom,
      bearing: 0,
      pitch: 0,
      duration: 650, // GATE-3 REVISION tempo: faster flight, same wide frame
    });
  } catch {
    try {
      mapRef.fitBounds(bounds, {
        bearing: 0,
        pitch: 0,
        duration: 650, // GATE-3 REVISION tempo: mirrors the easeTo above
        // Fallback keeps the wide padded fit when cameraForBounds is
        // unavailable; liveFrame() still carries the wider z to the twin.
        padding: wideFitPadding(),
        maxZoom: 14,
      });
    } catch (err) {
    errors.push('FLY: ' + (err && err.message));
    finish();
    }
  }
  return true;
}

/** Handoff-4 Lane A seeded reveal: PRE-WARM the twin at the ring frame —
 * create the overlay iframe hidden (opacity 0 via .prewarm, still loading
 * ?sector&cx&cy&z&embed=1) and HOLD the map end-frame until the twin posts
 * {type:'safepipe-twin-ready'} (Lane B). Timeout fallback (~4s) reveals
 * anyway so a silent twin can never strand the map. On ready, CROSSFADE
 * map->twin over ~450ms (overlay opacity 0->1 above the matched sat frame).
 * Reduced-motion: reveal instantly. */
function prewarmThenReveal(id, frame, opts = {}) {
  const s = sectors.find((x) => x.id === id);
  if (!s) return false;
  selectSector(id);
  const h3 = h3map[id];
  const { root, frame: frameEl, label } = ensureOverlay();
  const url = twinUrl(h3, frame);
  // Handoff-5-close: a fresh open cancels any pending close hide/recede.
  closeSeq++;
  // Handoff-6-retrace: also settle a reverse-first wait (stale reply must
  // not tear down the fresh twin).
  clearReverseWait();
  try {
    window.__mapProbe.reverseFallback = false;
  } catch { /* probe cosmetic */ }
  // Reset + publish prewarm probe state.
  try {
    if (pendingReveal && pendingReveal.timer) clearTimeout(pendingReveal.timer);
  } catch { /* timer teardown is best-effort */ }
  pendingReveal = { id, timer: null, revealed: false };
  window.__mapProbe.prewarm = true;
  window.__mapProbe.twinReady = false;
  window.__mapProbe.reveal = 'prewarm';
  window.__mapProbe.revealFallback = false;
  window.__mapProbe.revealLate = false;
  // Hidden-but-loading: overlay mounted (hidden=false) at opacity 0 so the
  // twin boots its matched top-down sat frame underneath the held map frame.
  try {
    root.classList.remove('closing');
    root.classList.add('prewarm');
  } catch { /* cosmetic */ }
  // Force the opacity-0 state to apply BEFORE the iframe starts loading, so
  // the later crossfade always animates from 0 (no flash on fast twins).
  try {
    void root.offsetWidth;
  } catch { /* reflow nudge is best-effort */ }
  setFrameUrl(frameEl, url);
  root.hidden = false;
  try {
    document.body.classList.add('twin-open');
  } catch { /* chrome class is cosmetic */ }
  if (label) label.textContent = s.name + ' — ' + worstAssetId(s) + ' · ' + h3;
  twinOpen = true;
  window.__mapProbe.twinOpen = true;
  window.__mapProbe.sectorH3 = h3;
  window.__mapProbe.handoff = frame ?? null;
  if (!opts.replace) {
    try {
      history.pushState({ twin: id }, '', mapUrlWithSector(h3));
    } catch (err) {
      errors.push('HISTORY: ' + (err && err.message));
    }
  }
  let reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { /* cosmetic */ }
  if (reduced) {
    revealTwin(true);
    return true;
  }
  try {
    pendingReveal.timer = setTimeout(() => {
      // Fallback: reveal anyway; flag it so the probe distinguishes a real
      // Lane B ready signal from the timeout path.
      try {
        if (pendingReveal && !pendingReveal.revealed) {
          window.__mapProbe.revealFallback = true;
          revealTwin(false);
        }
      } catch { /* fallback reveal is best-effort */ }
    }, REVEAL_TIMEOUT_MS);
  } catch { /* timer is best-effort */ }
  return true;
}

/** Crossfade the pre-warmed overlay in (opacity 0->1, ~450ms). Idempotent. */
function revealTwin(instant = false) {
  try {
    if (pendingReveal && pendingReveal.revealed) return true;
    if (pendingReveal) pendingReveal.revealed = true;
    try {
      if (pendingReveal && pendingReveal.timer) clearTimeout(pendingReveal.timer);
    } catch { /* timer teardown is best-effort */ }
    if (!overlayEls || overlayEls.root.hidden) return false;
    if (!instant) {
      // Force a frame at opacity 0, then drop .prewarm so the CSS
      // opacity transition (~450ms) crossfades map->twin with no flash.
      try {
        void overlayEls.root.offsetWidth;
      } catch { /* reflow nudge is best-effort */ }
      try {
        overlayEls.root.classList.remove('prewarm');
      } catch { /* cosmetic */ }
    } else {
      try {
        overlayEls.root.classList.remove('prewarm');
      } catch { /* cosmetic */ }
    }
    window.__mapProbe.prewarm = false;
    window.__mapProbe.reveal = 'revealed';
    try {
      overlayEls.frame.focus?.();
    } catch { /* focus is best-effort */ }
    return true;
  } catch (err) {
    errors.push('REVEAL: ' + (err && err.message));
    return false;
  }
}

/** Task 18: open the twin overlay pre-selected on the sector's worst asset.
 * opts.frame (default: live map frame) rides as ?cx=&cy=&z= handoff params. */
function openTwin(id, opts = {}) {
  const s = sectors.find((x) => x.id === id);
  if (!s) return false;
  selectSector(id);
  const h3 = h3map[id];
  // Handoff-5-close: a fresh open cancels any pending close hide/recede.
  closeSeq++;
  // Handoff-6-retrace: also settle a reverse-first wait (stale reply must
  // not tear down the fresh twin).
  clearReverseWait();
  try {
    window.__mapProbe.reverseFallback = false;
  } catch { /* probe cosmetic */ }
  const { root, frame, label } = ensureOverlay();
  const handoff = opts.frame === undefined ? liveFrame() : opts.frame;
  const url = twinUrl(h3, handoff);
  setFrameUrl(frame, url);
  root.hidden = false;
  try {
    root.classList.remove('closing');
    root.classList.remove('prewarm');
  } catch { /* cosmetic */ }
  try {
    if (pendingReveal && pendingReveal.timer) clearTimeout(pendingReveal.timer);
  } catch { /* timer teardown is best-effort */ }
  pendingReveal = null;
  window.__mapProbe.prewarm = false;
  window.__mapProbe.twinReady = false;
  window.__mapProbe.reveal = 'revealed';
  window.__mapProbe.revealFallback = false;
  window.__mapProbe.revealLate = false;
  try {
    document.body.classList.add('twin-open');
  } catch { /* chrome class is cosmetic */ }
  if (label) label.textContent = s.name + ' — ' + worstAssetId(s) + ' · ' + h3;
  twinOpen = true;
  window.__mapProbe.twinOpen = true;
  window.__mapProbe.sectorH3 = h3;
  window.__mapProbe.handoff = handoff ?? null;
  if (!opts.replace) {
    try {
      history.pushState({ twin: id }, '', mapUrlWithSector(h3));
    } catch (err) {
      errors.push('HISTORY: ' + (err && err.message));
    }
  }
  try {
    frame.focus?.();
  } catch { /* focus is best-effort */ }
  return true;
}

/** Actual teardown: fades the overlay out (never an abrupt cut), keeps hex
 * + selection (Task 19). Handoff-5-close single chain: EVERY close path
 * (X/Esc/back/twin-Esc) runs the same reverse — twin->map-sat fade over
 * CLOSE_FADE_MS (~450ms, symmetric with the forward reveal; sat stays ON
 * underneath), then sat->flat + zoom-out to the country blip view. Pending
 * hide/recede steps are seq-guarded so a fresh open inside the fade window
 * cancels them (no blanked twin, no yanked map). */
function doCloseTwin() {
  // Handoff-3: if the overlay is the fullscreen element, drop fullscreen
  // silently first (flag cleared so fullscreenchange can't recede twice).
  try {
    if (overlayEls && document.fullscreenElement === overlayEls.root) {
      twinFs = false;
      try { window.__mapProbe.twinFs = false; } catch { /* probe cosmetic */ }
      if (document.exitFullscreen) {
        const r = document.exitFullscreen();
        if (r && r.catch) r.catch(() => {});
      }
    }
  } catch { /* fullscreen teardown is best-effort */ }
  try {
    if (pendingReveal && pendingReveal.timer) clearTimeout(pendingReveal.timer);
  } catch { /* timer teardown is best-effort */ }
  pendingReveal = null;
  window.__mapProbe.prewarm = false;
  window.__mapProbe.twinReady = false;
  window.__mapProbe.reveal = null;
  window.__mapProbe.revealFallback = false;
  window.__mapProbe.revealLate = false;
  // Handoff-5-close: seq-guard + reduced-motion flag for the fade/recede below.
  const seq = ++closeSeq;
  const seqGuard = () => closeSeq;
  let reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { /* cosmetic */ }
  const finishHide = () => {
    if (seqGuard() !== seq) return; // reopened mid-fade: leave the fresh twin alone
    if (overlayEls) {
      overlayEls.root.hidden = true;
      overlayEls.root.classList.remove('closing');
      overlayEls.root.classList.remove('prewarm');
      try {
        setFrameUrl(overlayEls.frame, 'about:blank');
      } catch { /* frame teardown is best-effort */ }
    }
  };
  if (overlayEls && !overlayEls.root.hidden) {
    if (!reduced) {
      try {
        overlayEls.root.classList.remove('prewarm');
        overlayEls.root.classList.add('closing');
      } catch { /* cosmetic */ }
      setTimeout(finishHide, CLOSE_FADE_MS + 20);
    } else {
      finishHide();
    }
  } else {
    finishHide();
  }
  // Vignette stays through the twin->sat fade (forward-symmetric); the
  // recede below lifts it while sat->flat + zoom-out run.
  window.__mapProbe.recede = 'fading';
  setTimeout(() => {
    if (seqGuard() !== seq || twinOpen) return;
    try {
      showVignette(false);
    } catch { /* cosmetic */ }
    try {
      recedeToCountry();
    } catch { /* recede is best-effort */ }
  }, reduced ? 0 : RECEDE_DELAY_MS);
  try {
    document.body.classList.remove('twin-open');
  } catch { /* chrome class is cosmetic */ }
  twinOpen = false;
  window.__mapProbe.twinOpen = false;
}

/** Task 19: X/Esc/twin-Esc close. Direct teardown + replaceState — never
 * history.back(): subframe loads share the joint history, so back() can
 * step the twin instead of the parent entry.
 * Handoff-6-retrace: EVERY map-side close entry (X/Esc/back) goes through
 * closeTwin() (reverse-first) — never straight to finishTwinClose(), which
 * would skip the twin's staged inbound. */
function finishTwinClose() {
  if (!twinOpen) return;
  clearReverseWait();
  doCloseTwin();
  try {
    if (history.state && history.state.twin) {
      history.replaceState(null, '', mapUrlWithSector(null));
    }
  } catch (err) {
    errors.push('HISTORY: ' + (err && err.message));
  }
}

/* Handoff-6-retrace reverse-first close: X/Esc/back must NOT tear the
 * overlay down directly — that jumps straight to the map satellite view and
 * skips the twin's inbound stages. Instead ask the live twin to walk back
 * through every stage actually passed (pull to ring frame -> pitch back to
 * top-down -> slider 100->0); its {recede:true} reply then runs the single
 * fade+recede chain. Timeout fallback tears down anyway so a dead twin can
 * never strand the map. Probe: __mapProbe.reverseWait/reverseFallback. */
const TWIN_REVERSE_WAIT_MS = 8000;
let reverseWait = null; // { timer } while a twin reverse flight is awaited
function clearReverseWait() {
  try {
    if (reverseWait && reverseWait.timer) clearTimeout(reverseWait.timer);
  } catch { /* timer teardown is best-effort */ }
  reverseWait = null;
  try {
    window.__mapProbe.reverseWait = false;
  } catch { /* probe cosmetic */ }
}
/* Post the reverse request to the live twin iframe: the object form WITHOUT
 * recede — the twin matches it as a reverse request and replies with
 * {recede:true} after the stage walk. True when posted. */
function postTwinReverseRequest() {
  try {
    const fr = overlayEls && overlayEls.frame;
    if (!fr) return false;
    if (fr.getAttribute('data-url') === 'about:blank') return false;
    const win = fr.contentWindow;
    if (!win) return false;
    win.postMessage({ type: TWIN_CLOSE_MSG }, '*');
    return true;
  } catch {
    return false;
  }
}
/* Reverse-first entry for X/Esc/back: request the twin's stage walk, defer
 * teardown to its {recede:true} reply (or the timeout fallback). Repeat
 * entries while a reverse is awaited are ignored — the flight already runs. */
function closeTwin() {
  if (!twinOpen) return;
  if (reverseWait) return;
  try {
    if (postTwinReverseRequest()) {
      const seq = closeSeq;
      try {
        window.__mapProbe.reverseWait = true;
      } catch { /* probe cosmetic */ }
      reverseWait = {
        timer: setTimeout(() => {
          if (seq !== closeSeq) return; // fresh open landed first
          if (!twinOpen) {
            clearReverseWait();
            return;
          }
          try {
            window.__mapProbe.reverseFallback = true;
          } catch { /* probe cosmetic */ }
          finishTwinClose();
        }, TWIN_REVERSE_WAIT_MS),
      };
      return;
    }
  } catch { /* request is best-effort; fall through to teardown */ }
  finishTwinClose();
}

window.addEventListener('popstate', (e) => {
  const id = e && e.state && e.state.twin;
  if (id && !twinOpen) openTwin(id, { replace: true });
  else if (!id && twinOpen) closeTwin();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && twinOpen) {
    if (e.stopPropagation) e.stopPropagation();
    closeTwin();
  }
});

// Twin-iframe Esc (focus lives in the iframe while orbiting): the embedded
// twin posts TWIN_CLOSE_MSG instead of touching history. LANE 3 also posts
// the extended { type, recede } object — accept either form. recede:true
// rewinds the T2 staging: sat->flat crossfade + zoom back out to country.
function isTwinCloseData(d) {
  if (d === TWIN_CLOSE_MSG) return true;
  try {
    return !!d && typeof d === 'object' && d.type === TWIN_CLOSE_MSG;
  } catch {
    return false;
  }
}
/* LANE A recede (reverse): animate sat->flat fade + smooth zoom back out
 * to the country view — never an abrupt cut. setSatForced(false) already
 * ramps raster-opacity 1->0 over the cached sat frame; the easeTo runs
 * concurrently so flat returns while zooming out. Reduced-motion: instant. */
function recedeToCountry() {
  let reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { /* cosmetic */ }
  // GATE-9-A(1): veil up + clock starts — the flat return is timed in
  // vectorReturnMs and the veil covers the vector tile refill (no jank).
  // The vector style/sources are never reloaded: the zoom runs over the
  // HELD style (cached in holdVectorWarm), so the way back is instant.
  holdVectorWarm('recede');
  showVectorHold(true);
  // Handoff-11-A (FM-2): arm the recede leg — gestures are swallowed until
  // landHome, and landHome is idempotent so a jumpTo-sourced moveend can
  // never strand a POSITION-OFF rest behind a 'home' probe.
  receding = true;
  recedeDone = false;
  try {
    recedeStartT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  } catch {
    recedeStartT = Date.now();
  }
  const landHome = () => {
    if (recedeDone) return; // idempotent: first arrival wins (FM-2 token)
    recedeDone = true;
    receding = false;
    try {
      let ms = null;
      try {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        ms = Math.round(now - recedeStartT);
      } catch { /* timing is best-effort */ }
      window.__mapProbe.recede = 'home';
      window.__mapProbe.mapZoom = liveFrame()?.z ?? null;
      window.__mapProbe.vectorReturnMs = ms;
    } catch { /* probe cosmetic */ }
    try {
      showVectorHold(false);
    } catch { /* cosmetic */ }
    try {
      resetScrubJourney();
    } catch { /* reset is best-effort */ }
  };
  setSatForced(false);
  // Handoff-5-close: probe the recede leg (sat->flat + zoom-out).
  window.__mapProbe.recede = 'out';
  try {
    if (mapRef) {
      if (reduced) {
        mapRef.easeTo({
          center: COUNTRY_CENTER,
          zoom: COUNTRY_ZOOM,
          bearing: 0,
          pitch: 0,
          duration: 0,
        });
        landHome();
      } else {
        mapRef.easeTo({
          center: COUNTRY_CENTER,
          zoom: COUNTRY_ZOOM,
          bearing: 0,
          pitch: 0,
          duration: 800, // GATE-3 REVISION tempo: quicker recede, same home
        });
        try {
          mapRef.once('moveend', landHome);
        } catch { /* probe listener is best-effort */ }
        // Fallback: never strand the veil/journey if moveend is missed.
        setTimeout(() => {
          try {
            if (window.__mapProbe.recede === 'out') landHome();
          } catch { /* fallback is best-effort */ }
        }, 2500);
      }
    }
  } catch (err) {
    errors.push('RECEDE: ' + (err && err.message));
  }
}
// Handoff-3 Lane 1: twin fullscreen protocol (sister Lane 2 sends
// { type:'safepipe-twin-fullscreen', on }). Separate listener so the close
// path below is untouched.
window.addEventListener('message', (e) => {
  let fs = null;
  try { fs = parseTwinFsMessage(e && e.data); } catch { fs = null; }
  if (!fs) return;
  if (!twinOpen) return;
  setTwinFs(fs.on);
});
// Handoff-4 Lane A seeded reveal: Lane B posts { type:'safepipe-twin-ready' }
// when its top-down sat frame matches the staged map end-frame. Reveal (the
// ~450ms crossfade) on that signal; the ~4s fallback in prewarmThenReveal
// covers a silent twin. A ready that lands AFTER the fallback already
// revealed is still accepted (late-sync: twinReady=true + revealLate flag)
// instead of being dropped — the fallback guarantee is untouched, but the
// probe no longer reports a permanently UNMATCHED reveal on slow twins.
// A ready on the direct-open path (no prewarm pending) is recorded the
// same way. Stale readies with no open twin are ignored.
// Handoff-7-A: late-ready gap close (audit aid3 section 2).
window.addEventListener('message', (e) => {
  let rdy = null;
  try { rdy = parseTwinReadyMessage(e && e.data); } catch { rdy = null; }
  if (!rdy) return;
  if (!twinOpen) return;
  try {
    window.__mapProbe.twinReady = true;
  } catch { /* probe cosmetic */ }
  if (pendingReveal && !pendingReveal.revealed) {
    revealTwin(false);
    return;
  }
  // Late ready: the fallback (or a direct open) already revealed. Re-assert
  // the matched end-state so the crossfade lands synced, never re-hidden.
  try {
    window.__mapProbe.revealLate = true;
    window.__mapProbe.prewarm = false;
    window.__mapProbe.reveal = 'revealed';
    if (overlayEls && overlayEls.root) overlayEls.root.classList.remove('prewarm');
  } catch { /* late-sync is best-effort */ }
});
window.addEventListener('message', (e) => {
  if (!twinOpen || !isTwinCloseData(e && e.data)) return;
  const recede = !!(e.data && typeof e.data === 'object' && e.data.recede);
  if (recede) {
    // Handoff-5-close: the twin already returned to top-down sat — keep
    // map-sat ON underneath the twin fade, then finishTwinClose() runs the
    // single close chain (fade ~450ms, then sat->flat + zoom out to the
    // blip). Never cut, never fade over flat. Handoff-6-retrace: the reply
    // also settles the reverse-first wait armed by closeTwin().
    setSatForced(true);
    finishTwinClose();
    return;
  }
  finishTwinClose();
});

function mountChrome(map, overlay, setSat) {
  mountFlatFs();
  // GATE 3: single pulsing Sangachal DOM blip — always visible (screen
  // reader + no-WebGL path + deck pulse overlay). Colored by site worst.
  const pinLayer = document.createElement('div');
  pinLayer.id = 'map-pins';
  pinLayer.className = 'map-pins';
  pinLayer.hidden = false;
  const b = document.createElement('button');
  b.className = 'map-pin map-pin--single map-pin--' + siteWorst;
  b.dataset.sector = siteSector;
  b.dataset.site = 'sangachal';
  b.title = 'Sangachal — ' + siteWorst;
  b.setAttribute('aria-label', 'Sangachal monitoring blip, health ' + siteWorst + '. Activate to open twin.');
  b.innerHTML = '<span class="map-pin__dot"></span><span class="map-pin__tag">SANGACHAL</span>';
  if (selectedId) b.setAttribute('data-sel', 'true');
  b.addEventListener('click', () => {
    flyToSectorThenTwin(siteSector);
  });
  pinLayer.appendChild(b);
  document.getElementById('app').appendChild(pinLayer);
  positionDomPins(map);
  return { pinLayer };
}

/* Handoff-3 Lane 1: flat-view FULLSCREEN button (quiet mono, bottom-right).
 * Fullscreen-toggles the map root (#app) so the flat view fills the screen;
 * the button rides inside #app so it stays visible in map-fullscreen. */
function mountFlatFs() {
  try {
    if (document.getElementById('map-fs')) return;
    const app = document.getElementById('app');
    if (!app) return;
    const b = document.createElement('button');
    b.id = 'map-fs';
    b.textContent = '\u26F6 FULLSCREEN';
    b.title = 'Toggle fullscreen map';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => toggleMapFs());
    app.appendChild(b);
    document.addEventListener('fullscreenchange', syncFsProbe);
  } catch { /* chrome is cosmetic */ }
}

function toggleMapFs() {
  try {
    const app = document.getElementById('app');
    if (!app) return false;
    if (document.fullscreenElement === app) {
      if (document.exitFullscreen) {
        const r = document.exitFullscreen();
        if (r && r.catch) r.catch((err) => errors.push('MAP-FS: ' + (err && err.message)));
      }
      return true;
    }
    if (app.requestFullscreen) {
      const r = app.requestFullscreen();
      if (r && r.catch) r.catch((err) => errors.push('MAP-FS: ' + (err && err.message)));
      return true;
    }
    return false;
  } catch (err) {
    errors.push('MAP-FS: ' + (err && err.message));
    return false;
  }
}

/* Handoff-3 Lane 1: parent-side fullscreen protocol. The twin iframe posts
 * { type:'safepipe-twin-fullscreen', on } — request/exit fullscreen on the
 * #twin-overlay element ITSELF so the CLOSE bar stays visible inside
 * fullscreen (windowed, map-fullscreen, overlay-fullscreen). */
function setTwinFs(on) {
  try {
    if (!twinOpen || !overlayEls) return false;
    const root = overlayEls.root;
    if (on) {
      twinFs = true;
      try { window.__mapProbe.twinFs = true; } catch { /* probe cosmetic */ }
      if (document.fullscreenElement === root) return true;
      if (root.requestFullscreen) {
        const r = root.requestFullscreen();
        if (r && r.catch) r.catch((err) => errors.push('TWIN-FS: ' + (err && err.message)));
        return true;
      }
      return false;
    }
    twinFs = false;
    try { window.__mapProbe.twinFs = false; } catch { /* probe cosmetic */ }
    if (document.fullscreenElement === root && document.exitFullscreen) {
      const r = document.exitFullscreen();
      if (r && r.catch) r.catch((err) => errors.push('TWIN-FS: ' + (err && err.message)));
    }
    return true;
  } catch (err) {
    errors.push('TWIN-FS: ' + (err && err.message));
    return false;
  }
}

/* Esc exits overlay-fullscreen natively (the page never sees the key): on
 * fullscreenchange, if the overlay ended up closed by that exit, run the
 * normal recede reverse. Otherwise just sync the probe + flat button. */
function syncFsProbe() {
  try {
    const fsEl = document.fullscreenElement || null;
    const app = document.getElementById('app');
    try { window.__mapProbe.mapFs = fsEl === app; } catch { /* probe cosmetic */ }
    try { window.__mapProbe.twinFs = fsEl === (overlayEls && overlayEls.root); } catch { /* probe cosmetic */ }
    const b = document.getElementById('map-fs');
    if (b) b.setAttribute('aria-pressed', String(fsEl === app));
  } catch { /* probe sync is cosmetic */ }
  try {
    if (!document.fullscreenElement && twinFs) {
      twinFs = false;
      if (!twinOpen) recedeToCountry();
    }
  } catch { /* recede fallback is best-effort */ }
}

function positionDomPins(map) {
  const layer = document.getElementById('map-pins');
  if (!layer) return;
  const pins = layer.querySelectorAll('.map-pin');
  pins.forEach((p) => {
    try {
      const pt = map.project([SITE.lon, SITE.lat]);
      p.style.left = pt.x + 'px';
      p.style.top = pt.y + 'px';
    } catch { /* pre-ready: centered via CSS */ }
  });
}

async function boot() {
  const style = await loadStyle();
  const map = new maplibregl.Map({
    container: 'map',
    style,
    center: COUNTRY_CENTER,
    zoom: COUNTRY_ZOOM,
    // GATE-12-A NATIVE-ZOOM: native zoom STAYS ON everywhere (wheel
    // scrollZoom + touch pinch). The journey RIDES on zoom/zoomend/move
    // events and never hijacks gestures — no preventDefault capture path.
    // The min-zoom cap converts zoom-out overshoot into the reverse
    // journey instead of parking past the cap (the stuck state).
    scrollZoom: true,
    minZoom: COUNTRY_ZOOM,
    maxZoom: Z_MAX,
    // LANE A naked view: no default attribution pill / info (ⓘ) button.
    // A minimal micro credit is mounted instead (mountMicroCredit).
    attributionControl: false,
  });
  // No key prompts anywhere: suppress geolocate, never request tokens.
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: true }), 'top-right');

  map.on('load', () => {
    // LANE A: belt-and-braces label strip + micro credit + kill any
    // injected attrib pill (no ⓘ button anywhere).
    stripLabelLayers(map);
    mountMicroCredit();
    try {
      map.on('styledata', () => stripLabelLayers(map));
      map.on('sourcedata', () => stripLabelLayers(map));
      map.on('idle', () => stripLabelLayers(map));
    } catch { /* styledata guard is best-effort */ }
    try {
      if (!map.getSource(SAT_SOURCE_ID)) {
        map.addSource(SAT_SOURCE_ID, {
          type: 'raster',
          tiles: [ESRI_IMAGERY],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'Esri World Imagery',
        });
      }
      if (!map.getLayer(SAT_LAYER_ID)) {
        map.addLayer({
          id: SAT_LAYER_ID,
          type: 'raster',
          source: SAT_SOURCE_ID,
          layout: { visibility: 'none' },
          // T2: staged crossfade — opacity animates, visibility flips.
          // GATE-3 REVISION tempo: 450ms ramp completes inside the flight.
          paint: {
            'raster-opacity': 0,
            'raster-opacity-transition': { duration: 450, delay: 0 },
          },
        });
      }
    } catch (err) {
      errors.push('SAT-SOURCE: ' + (err && err.message));
    }

    const setSat = (on) => {
      try {
        if (!map.getLayer(SAT_LAYER_ID)) return;
        if (on) {
          map.setLayoutProperty(SAT_LAYER_ID, 'visibility', 'visible');
          requestAnimationFrame(() => {
            try {
              map.setPaintProperty(SAT_LAYER_ID, 'raster-opacity', 1);
            } catch (err) {
              errors.push('SAT-TOGGLE: ' + (err && err.message));
            }
          });
        } else {
          try {
            map.setPaintProperty(SAT_LAYER_ID, 'raster-opacity', 0);
          } catch (err) {
            errors.push('SAT-TOGGLE: ' + (err && err.message));
          }
          setTimeout(() => {
            try {
              if (!window.__mapProbe.satOn) {
                map.setLayoutProperty(SAT_LAYER_ID, 'visibility', 'none');
              }
            } catch { /* delayed hide is best-effort */ }
          }, 500); // GATE-3 REVISION tempo: tracks the 450ms ramp
        }
      } catch (err) {
        errors.push('SAT-TOGGLE: ' + (err && err.message));
      }
    };
    mapRef = map;
    setSatRef = setSat;

    // GATE 3 single blip: one deck pin at SITE colored by site worst.
    let mode = pinMode ? 'pins' : 'rings';
    try {
      deckFeats = [];
      deckPins = [{
        sector: siteSector,
        name: 'SANGACHAL',
        position: [SITE.lon, SITE.lat],
        h3: h3map[siteSector],
        worst: siteWorst,
        color: siteColor,
      }];
      // Keep rings.js importable/used (probe path); pin count is the blip.
      void buildPinData;
      window.__mapProbe.rings = deckPins.length;
      window.__mapProbe.pins = deckPins.length;
      deckOverlay = new MapLibreOverlay({
        interleaved: false,
        layers: deckLayers(),
      });
      map.addControl(deckOverlay);
    } catch (err) {
      errors.push('DECK-FALLBACK: ' + (err && err.message));
      mode = 'pins';
      window.__mapProbe.mode = 'pins';
    }

    const chrome = mountChrome(map, deckOverlay, setSat);
    chrome.pinLayer.hidden = false;
    void mode;
    // Restored selection (reload/back-forward with ?sector= or stored): mark
    // only — the overlay stays closed until a click (Task 19 keep).
    if (selectedId) selectSector(selectedId);
    map.on('move', () => positionDomPins(map));
    positionDomPins(map);
    window.__mapProbe.ready = true;
    window.__mapProbe.satLayer = !!map.getLayer(SAT_LAYER_ID);
    // GATE-12-A NATIVE-ZOOM: native handlers stay ON — the journey rides
    // on zoom events (scrolltrigger.js installZoomJourney). Re-assert the
    // enabled state + the min/max caps in case a control path changed them.
    try { if (map.scrollZoom) map.scrollZoom.enable(); } catch { /* best-effort */ }
    try { if (map.touchZoomRotate) map.touchZoomRotate.enable(); } catch { /* best-effort */ }
    try { if (typeof map.setMinZoom === 'function') map.setMinZoom(COUNTRY_ZOOM); } catch { /* best-effort */ }
    try { if (typeof map.setMaxZoom === 'function') map.setMaxZoom(Z_MAX); } catch { /* best-effort */ }
    // Passive cursor read for proximity centering (never prevents default).
    try {
      const app = document.getElementById('app');
      if (app && !app.__cursorTracked) {
        app.__cursorTracked = true;
        app.addEventListener('mousemove', (e) => {
          try {
            lastCursor = { x: e.clientX, y: e.clientY };
          } catch { /* cursor read is best-effort */ }
        }, { passive: true });
      }
    } catch { /* cursor tracking is best-effort */ }
    // THE native-zoom wiring: zoom/zoomend/move drive fade + proximity
    // center + deep handoff + mirrored reverse. No wheel capture anywhere.
    try {
      installZoomJourney({
        map,
        isOpen: () => twinOpen,
        isBusy: () => !!transitId || !!pendingReveal || !!reverseWait || receding,
        onProgress: (snap, source) => onNativeZoomStep(snap, source),
        onDown: () => {
          try {
            if (!scrubFired && !twinOpen && !transitId) {
              scrubFired = true;
              flyToSectorThenTwin(siteSector);
            }
          } catch (err) {
            errors.push('ZOOM-DOWN: ' + (err && err.message));
          }
        },
        onUp: () => closeTwin(),
      });
    } catch { /* journey wiring is best-effort */ }
    // GATE-9-A(1): country flat view is the held frame — cache it now.
    holdVectorWarm('boot');
    // Handoff-11-A DEFECT 3: seed the sat precache at the journey start so
    // the first scroll-down already travels over warm tiles.
    try { prefetchSatTiles(COUNTRY_CENTER, COUNTRY_ZOOM); } catch { /* best-effort */ }
  });

  map.on('error', (e) => {
    const msg = (e && e.error && e.error.message) || 'map-error';
    // Tile blips (offline sandbox) must not fail the probe: record, don't throw.
    errors.push('MAP: ' + msg);
  });

  /* GATE-12-A NATIVE-ZOOM: no wheel/touch capture anywhere. The journey is
   * wired inside map.on('load') via installZoomJourney (zoom/zoomend/move
   * events only). Blip click fallback intact; twin overlay gestures are
   * never touched (Lane B owns twin-side entry/exit via the unchanged
   * handoff query + ready/close message contract). */
}

boot();
