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
  handoffScrubForZoom,
  handoffStagesForScroll,
  accumStagedS,
  vignetteRadiusPxForZoom,
  MAP_VIGNETTE_RING_M,
  isHomeZoom,
  flipWheelDelta,
  lockAroundPoint,
  pitchTargetForZoom,
  metersPerPixel,
  formatGround,
  spanFrac,
  EARTH_CIRC_M,
  Z_LOCK_ARM,
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
  buildTwinStagedMessage,
  parseTwinFsMessage,
  parseTwinReadyMessage,
} from './twinlink.js';

const POSITRON_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_SOURCE_ID = 'esri-sat';
const SAT_LAYER_ID = 'esri-sat';
const SEL_KEY = 'ops3d-map-selected';
// GATE 3: first load is the FULL map (whole world, hotspot centered) —
// the user zooms into the Sangachal blip from there. Home rests at
// COUNTRY_ZOOM but the camera starts at the floor, so the whole journey
// (flat travel -> sat fade -> handoff) streams over warming tiles instead
// of cold-opening mid-journey. Journey math already clamps sub-home to 0.
const COUNTRY_CENTER = [47.6, 40.15];
const COUNTRY_ZOOM = 6.4;
const MAP_FLOOR = 1.0;

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
// Handoff-11-A (FM-2): recede leg flag. Set on recede start, cleared by
// landHome (idempotent, token-guarded) or by a fresh handoff (which disarms
// the armed gesture leg and owns the camera again). While set, journey
// edge entries defer (flight/prewarm/recede busy) — gestures themselves are
// never swallowed: native zoom stays live so the fingers own the way home.
let receding = false;
let recedeLandHome = null; // Task-37 gesture recede: arrival closure armed by recedeToHome, fired by the zoom-step home check
let recedeDone = false;
// Handoff-5-close: single close chain. CLOSE_FADE_MS mirrors the forward
// reveal; RECEDE_DELAY_MS starts the gesture-owned recede arm after the fade.
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
  view: null, // live ground-scale telemetry { z, tile, frac, w, h, label }
  // GATE-9-A scrub probe: journey progress driving zoom/center/fade.
  scrub: { progress: 0, zoom: null, opacity: 0, centerDist: null },
  centerEase: 0, autoCenter: false, satOpacity: 0,
  // GATE-12-A native-zoom probe: zoom-keyed journey, proximity, ring clip.
  proximity: null, ringClip: { k: 0, cursorNear: false, centerNear: false },
  zoomJourney: { zMin: 6.4, zHand: 12, zTop: 11, zMax: 14, topDown: false, handoff: false, home: true },
  isoBridge: false, deepHandoff: null, staged: { active: false, s: 0, committed: false },
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

/* Scale telemetry HUD: persistent bottom-center overlay (same always-there
 * treatment as the FULLSCREEN button) showing live zoom, the ground span
 * the viewport covers (width x height at center latitude), and the sat tile
 * level + fraction (swaps happen at integer crossings) — plus a zoom-range
 * bar from the widest-out floor to the deepest-in max with a needle at the
 * current zoom and a tick where the twin handoff fires. Updated on every
 * zoom step; mirrored into __mapProbe.view for console reporting.
 * Pointer-transparent so gestures are untouched. */
let lastScaleTxt = '';
let lastNeedlePct = -1;
let rangeEndsW = 0; // viewport width the static ruler ends were computed at
let rangeDeepM = 0; // deepest-in end span, meters (right stop)
let rangeWideM = 0; // widest-allowed end span, meters (left stop)
let rangeHandM = 0; // handoff span, meters (amber tick)
/* Static ruler ends: widest-allowed span (left, the maximum — one Earth,
 * 40,075.017 KM) and deepest-in span (right), computed once at home
 * latitude — never live, so the ruler is a fixed scale the needle travels
 * along. The wide end clamps to one Earth: the map shows a single world
 * (no repeats), so the viewport can never honestly exceed it. */
function computeRangeEnds() {
  let w = 800;
  try {
    const el = mapRef && mapRef.getContainer();
    w = (el && el.clientWidth) || window.innerWidth || 800;
  } catch { /* size read best-effort */ }
  let minTxt = '';
  let maxTxt = '';
  let deepM = 0;
  let wideM = 0;
  try {
    const mppDeep = metersPerPixel(Z_MAX, SITE.lat);
    const mppWide = metersPerPixel(MAP_FLOOR, SITE.lat);
    const mppHand = metersPerPixel(Z_HANDOFF, SITE.lat);
    if (mppDeep != null) { deepM = mppDeep * w; minTxt = formatGround(deepM); }
    if (mppWide != null) { wideM = Math.min(mppWide * w, EARTH_CIRC_M); maxTxt = formatGround(wideM); }
    if (mppHand != null) rangeHandM = mppHand * w;
  } catch { /* ends best-effort */ }
  rangeEndsW = w;
  rangeDeepM = deepM;
  rangeWideM = wideM;
  return { minTxt, maxTxt };
}
function paintRangeEnds() {
  try {
    const e = computeRangeEnds();
    // Flipped sides: maximum (widest) on the left, deepest-in on the right.
    const lf = document.getElementById('map-zoomrange-left');
    if (lf && e.maxTxt) lf.textContent = e.maxTxt;
    const rt = document.getElementById('map-zoomrange-right');
    if (rt && e.minTxt) rt.textContent = e.minTxt;
    const hd = document.getElementById('map-zoomrange-hand');
    if (hd && rangeDeepM > 0 && rangeWideM > rangeDeepM && rangeHandM > 0) {
      hd.style.left = ((1 - spanFrac(rangeHandM, rangeDeepM, rangeWideM)) * 100).toFixed(1) + '%';
    }
  } catch { /* cosmetic */ }
}
function mountScaleHud() {
  try {
    if (document.getElementById('map-zoomrange')) return;
    const el = document.createElement('div');
    el.id = 'map-zoomrange';
    el.setAttribute('aria-hidden', 'true');
    const label = document.createElement('div');
    label.id = 'map-zoomrange-label';
    label.textContent = 'Z — · —';
    const row = document.createElement('div');
    row.id = 'map-zoomrange-row';
    const left = document.createElement('div');
    left.id = 'map-zoomrange-left';
    left.textContent = '';
    const track = document.createElement('div');
    track.id = 'map-zoomrange-track';
    const hand = document.createElement('div');
    hand.id = 'map-zoomrange-hand';
    hand.title = 'twin handoff';
    const needle = document.createElement('div');
    needle.id = 'map-zoomrange-needle';
    track.appendChild(hand);
    track.appendChild(needle);
    const right = document.createElement('div');
    right.id = 'map-zoomrange-right';
    right.textContent = '';
    row.appendChild(left);
    row.appendChild(track);
    row.appendChild(right);
    el.appendChild(label);
    el.appendChild(row);
    const app = document.getElementById('app');
    if (app) app.appendChild(el);
    paintRangeEnds(); // sets rangeDeepM/WideM/HandM before tick placement
    try {
      // Ruler runs widest-out (left, the maximum) → deepest-in (right).
      // Ticks sit mirrored: where their spans fall between the ends (log).
      if (rangeDeepM > 0 && rangeWideM > rangeDeepM && rangeHandM > 0) {
        hand.style.left = ((1 - spanFrac(rangeHandM, rangeDeepM, rangeWideM)) * 100).toFixed(1) + '%';
      }
      window.__mapProbe.scaleHud = true;
    } catch { /* probe cosmetic */ }
  } catch { /* cosmetic */ }
}
function updateScaleHud(z) {
  try {
    if (!mapRef || !Number.isFinite(+z)) return;
    let lat = SITE.lat;
    let w = 800;
    let h = 600;
    try {
      const c = mapRef.getCenter();
      if (c && Number.isFinite(+c.lat)) lat = +c.lat;
    } catch { /* center read best-effort */ }
    try {
      const el = mapRef.getContainer();
      w = (el && el.clientWidth) || window.innerWidth || 800;
      h = (el && el.clientHeight) || window.innerHeight || 600;
    } catch { /* size read best-effort */ }
    const mpp = metersPerPixel(+z, lat);
    if (mpp == null) return;
    const tile = Math.floor(+z);
    const frac = (+z - tile).toFixed(2).slice(1); // ".42"
    const wM = Math.min(mpp * w, EARTH_CIRC_M);
    const hM = Math.min(mpp * h, EARTH_CIRC_M);
    const label = formatGround(wM) + ' × ' + formatGround(hM);
    // Static ends refresh only when the viewport width itself changes
    // (resize) — never with zoom.
    if (Math.abs(w - rangeEndsW) > 60) paintRangeEnds();
    try {
      window.__mapProbe.view = {
        z: +(+z).toFixed(3), tile, frac: +(+z - tile).toFixed(3),
        wM: +wM.toFixed(1), hM: +hM.toFixed(1), label,
        range: { minZ: MAP_FLOOR, maxZ: Z_MAX, handZ: Z_HANDOFF, frac: +(1 - spanFrac(wM, rangeDeepM, rangeWideM)).toFixed(4) },
      };
    } catch { /* probe cosmetic */ }
    if (label !== lastScaleTxt) {
      lastScaleTxt = label;
      const el = document.getElementById('map-zoomrange-label');
      if (el) el.textContent = label;
    }
    // Needle sits mirrored: where the live span falls between the end stops (log).
    const pct = (1 - spanFrac(wM, rangeDeepM, rangeWideM)) * 100;
    if (Math.abs(pct - lastNeedlePct) >= 0.2) {
      lastNeedlePct = pct;
      const nd = document.getElementById('map-zoomrange-needle');
      if (nd) nd.style.left = pct.toFixed(1) + '%';
    }
  } catch { /* hud never breaks the map */ }
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

/** T2 vignette: black periphery radial overlay over the map chrome.
 * Creates its own element on first use (the journey drives it before any
 * twin flight ever runs). Twin open/close paths share this same toggle. */
function showVignette(on) {
  try {
    let v = document.getElementById('map-vignette');
    if (!v) {
      v = document.createElement('div');
      v.id = 'map-vignette';
      v.setAttribute('aria-hidden', 'true');
      const app = document.getElementById('app');
      if (app) app.appendChild(v);
      else return;
    }
    v.classList.toggle('on', !!on);
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
const LOCK_VIEW_M = 120; // lock engages while the blip is anywhere on screen — corner counts
let lastDeepWarmZ = -1; // integer sat level already warmed around the spot
let scrubProgress = 0;
let scrubFired = false;
// Task-35 staged scrub: past the handoff gate scroll-as-zoom is clamped and
// further ticks accumulate here (px past the gate) instead of depth.
let stagedActive = false;
let stagedS = 0;
let stagedCommitted = false;
// Task-37 staged-S producer: last S value posted to the twin frame
// (postTwinStagedS throttles to value-change; null = nothing posted yet).
let lastPostedStagedS = null;
let cachedVectorStyle = null;
let recedeStartT = 0;
let lastCursor = null; // {x,y} client px, passive mousemove only
let lastCenterEaseT = 0;
let isoScrubOwned = false;
const ISO_SCRUB_SLACK_DEG = 2; // engage only when pitch is at/below target+slack: never yanks a user oblique
const ISO_SCRUB_EPS_DEG = 0.3; // skip transform writes inside this of target
const ISO_SCRUB_RELEASE = 0.3; // zoom below Z_TOP-this releases ownership

function clamp01(v) {
  const n = +v;
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function smooth01(t) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}
/** Journey lock: engaged from the lock arm (6.5, ahead of the brackets) while
 * the hotspot is anywhere on screen — corner counts. Engaging early IS the
 * anticipation: the spot is already near center before deep zoom begins, so
 * the deep run is a pure glide. The lock holds across every ring transition
 * until handoff, recede, or zoom-out below the arm. */
function lockEngaged() {
  try {
    if (twinOpen || transitId || pendingReveal || reverseWait || receding) return false;
    if (!mapRef) return false;
    const lz = mapRef.getZoom();
    if (!Number.isFinite(lz) || lz < Z_LOCK_ARM) return false;
    const pt = mapRef.project(SITE_LNGLAT);
    if (!pt || !Number.isFinite(+pt.x) || !Number.isFinite(+pt.y)) return false;
    const el = mapRef.getContainer();
    const w = (el && el.clientWidth) || 800;
    const h = (el && el.clientHeight) || 600;
    return pt.x > -LOCK_VIEW_M && pt.y > -LOCK_VIEW_M && pt.x < w + LOCK_VIEW_M && pt.y < h + LOCK_VIEW_M;
  } catch { return false; }
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
    // True floor guard: MapLibre clamps via minZoom; only a fast wheel
    // burst reporting under the FLOOR gets pulled back. Between FLOOR and
    // home the camera is left alone — journey progress/opacity already
    // clamp sub-home to 0, so zoom-out stays visible and never sticks.
    if (z < MAP_FLOOR) {
      try {
        if (typeof mapRef.jumpTo === 'function') mapRef.jumpTo({ zoom: MAP_FLOOR });
        else mapRef.easeTo({ zoom: MAP_FLOOR, duration: 0 });
      } catch { /* floor clamp is best-effort */ }
      z = MAP_FLOOR;
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
    // Journey enclosure: the vignette circle rides on the hotspot with the
    // PROJECTED ring radius (RING_RADIUS_M / metersPerPixel(z) — the same
    // ground circle the twin clip cuts, 685px across at handoff z=12), so
    // the enclosing coincides with the twin clip exactly. The corner
    // brackets stay as dressing only — they no longer gate the enclosure.
    // Zoom-out retraces the radius symmetrically (pure function of z).
    // Twin paths own it while open.
    if (!twinOpen && prox) {
      try {
        const v = document.getElementById('map-vignette');
        if (v) {
          v.style.setProperty('--vx', prox.sx.toFixed(1) + 'px');
          v.style.setProperty('--vy', prox.sy.toFixed(1) + 'px');
          const vr = vignetteRadiusPxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M);
          if (Number.isFinite(vr)) {
            v.style.setProperty('--vr', vr.toFixed(1) + 'px');
            try {
              window.__mapProbe.vignetteR = +vr.toFixed(1);
            } catch { /* probe cosmetic */ }
          }
        }
      } catch { /* cosmetic */ }
      showVignette(prox.near);
    }
    // Deep warm for the dissolve: while the spot is tracked in sat range,
    // keep the level AFTER next warm around it — the arriving level streams
    // in naturally so its raster fade-in actually plays (a cached tile
    // swaps in at full opacity and pops). One 3x3 per level
    // (gated on level change; cap + hit counting live in prefetchSatTiles).
    if (!twinOpen && prox && z >= 8 && z < 12) {
      try {
        const zl = Math.floor(z) + 2;
        if (zl !== lastDeepWarmZ) { lastDeepWarmZ = zl; prefetchSatTiles(SITE_LNGLAT, zl); }
      } catch { /* warm is best-effort */ }
    } else if (lastDeepWarmZ !== -1) {
      lastDeepWarmZ = -1;
    }
    try {
      window.__mapProbe.scrub = {
        progress: +progress.toFixed(4),
        zoom: +z.toFixed(3),
        opacity: +opacity.toFixed(4),
        centerDist: dist,
      };
      window.__mapProbe.mapZoom = +z.toFixed(2);
      updateScaleHud(z);
      window.__mapProbe.proximity = prox;
      try {
        window.__mapProbe.zoomJourney = {
          zMin: Z_MIN, zHand: Z_HANDOFF, zTop: Z_TOP, zMax: Z_MAX,
          topDown: isTopDown(z), handoff: needsHandoff(z), home: isHomeZoom(z),
        };
      } catch { /* probe cosmetic */ }
    } catch { /* probe cosmetic */ }
    // Task-37: scrolling back up to the gate cancels an armed gesture
    // recede — the journey owns forward again (staging may re-fire below).
    if (receding && needsHandoff(z)) {
      receding = false;
      recedeLandHome = null;
      try {
        window.__mapProbe.recede = null;
      } catch { /* probe cosmetic */ }
    }
    const busyNow = !!(transitId || pendingReveal || reverseWait || receding);
    const busyNoRecede = !!(transitId || pendingReveal || reverseWait);
    // (3) PROXIMITY CENTERING — past the arm zoom, ease center onto the
    // spot + top-down ONLY when near, and ONLY on gesture settle
    // (native-zoomend). NOTHING may touch the camera mid-gesture: even an
    // instant jumpTo cancels the wheel/pinch glide, stair-stepping zoom
    // into abrupt states. Settle-landing glides onto the spot and HOLDS it,
    // so the next push zooms from the locked center. Fade + clip + vignette
    // above still track every live step; only the recenter waits for settle.
    // Throttled, epsilon-guarded, and it preserves the native zoom.
    if (!twinOpen && !busyNow && shouldCenter(z) && prox && prox.near && source === 'native-zoomend') {
      let now = 0;
      try {
        now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      } catch {
        now = Date.now();
      }
      const far = dist == null || dist > CENTER_EPS_DEG;
      let tilt = false;
      let pHold = 0;
      try {
        const b = mapRef.getBearing();
        const p = mapRef.getPitch();
        pHold = pitchTargetForZoom(z);
        tilt = Math.abs(b || 0) > 0.5 || Math.abs((p || 0) - pHold) > 0.5;
      } catch { /* bearing read is best-effort */ }
      if ((far || tilt) && now - lastCenterEaseT >= CENTER_EASE_MS) {
        lastCenterEaseT = now;
        try {
          mapRef.easeTo({ center: SITE_LNGLAT.slice(), bearing: 0, pitch: pHold, duration: 250 });
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
    // (4) ISO SCRUB — past the top-down checkpoint the tilt rides the zoom
    // itself (Z_TOP..Z_HANDOFF -> pitch 0..45), written straight into the
    // transform so the running scroll glide is never stopped: no latch, no
    // easeTo, no timers. Zoom-out retraces it symmetrically. Ownership: the
    // scrub engages only while near and only when the live pitch sits
    // at/below target (+slack), so a user-set oblique is never yanked; the
    // settle landing above still zeroes bearing and holds this same target.
    // Twin paths own the camera while open. Task-37: the gesture recede
    // does NOT block this — pitch 45->0 IS the mirrored checkpoint on the
    // way out, ridden by the same law.
    if (!twinOpen && !busyNoRecede && prox && prox.near) {
      const pTarget = pitchTargetForZoom(z);
      let pCur = null;
      try {
        pCur = +mapRef.getPitch();
      } catch { pCur = null; }
      if (Number.isFinite(pCur)) {
        if (!isoScrubOwned) {
          if (z >= Z_TOP && pCur <= pTarget + ISO_SCRUB_SLACK_DEG) isoScrubOwned = true;
        } else if (z < Z_TOP - ISO_SCRUB_RELEASE) isoScrubOwned = false;
        if (isoScrubOwned && Math.abs(pCur - pTarget) > ISO_SCRUB_EPS_DEG) {
          try {
            if (mapRef.transform && typeof mapRef.transform.setPitch === 'function') {
              mapRef.transform.setPitch(pTarget);
              if (typeof mapRef.triggerRepaint === 'function') mapRef.triggerRepaint();
            }
          } catch (err) {
            errors.push('ISO-SCRUB: ' + (err && err.message));
          }
        }
        try {
          window.__mapProbe.isoBridge = isoScrubOwned;
        } catch { /* probe cosmetic */ }
      }
    } else if (isoScrubOwned) {
      isoScrubOwned = false;
      try {
        window.__mapProbe.isoBridge = false;
      } catch { /* probe cosmetic */ }
    }
    if (!twinOpen && !busyNow && needsHandoff(z)) {
      if (!scrubFired) {
        scrubFired = true; // latched now; staging runs next frame (afterFrame)
        try {
          window.__mapProbe.deepHandoff = { z: +z.toFixed(2), scrub: +handoffScrubForZoom(z).toFixed(4) };
        } catch { /* probe cosmetic */ }
        afterFrame(() => {
          try {
            if (twinOpen || transitId || receding) return; // twin/staging owns it
            if (!Number.isFinite(mapRef.getZoom()) || !needsHandoff(mapRef.getZoom())) { scrubFired = false; return; }
            flyToSectorThenTwin(siteSector);
          } catch { /* handoff best-effort */ }
        });
      }
    } else if (z < Z_HANDOFF - 0.5 && scrubFired && !twinOpen) {
      scrubFired = false; // re-arm: a fresh deep zoom may hand off again
      isoScrubOwned = false;
    }
    // Task-35 staged exit (reverse): zoomend settle below the gate unwinds
    // the hold — unclamp, drop accumulated scroll, quietly tear down the
    // uncommitted prewarm. Settle AT the gate holds (no-op). Forward exit is
    // twin-ready + S-commit (driveStagedOverlay/finalizeStagedReveal).
    if (stagedActive && source === 'native-zoomend' && z < Z_HANDOFF - 0.05) {
      try {
        exitStaged();
      } catch { /* unwind is best-effort */ }
    }
    // (5) MIRRORED REVERSE — at/below the cap the checkpoints retrace:
    // fade is already ~0 here; land the journey home and re-arm. A
    // gesture-owned recede armed by recedeToHome lands here (the fingers
    // drove z home; sat already retraced via the scrub law).
    if (isHomeZoom(z)) {
      if (receding && recedeLandHome) {
        try {
          recedeLandHome();
        } catch { /* landing is best-effort */ }
      }
      if (scrubProgress > 0.001 || scrubFired || isoScrubOwned) {
        scrubFired = false;
        isoScrubOwned = false;
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
  isoScrubOwned = false;
  // Task-35: never leave the ceiling clamped or staged flags set behind a
  // close (Esc during a staged hold funnels here via recede -> landHome).
  try {
    exitStaged();
  } catch { /* unwind is best-effort */ }
  try {
    window.__mapProbe.isoBridge = false;
  } catch { /* probe cosmetic */ }
  try {
    updateRingClip(0, null);
  } catch { /* reset is best-effort */ }
  try {
    window.__mapProbe.scrub = { progress: 0, zoom: +MAP_FLOOR.toFixed(3), opacity: 0, centerDist: null };
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
/** Task-35 scrubbed handoff (replaces the 650ms timed flight): native zoom
 * OWNS z — this stages the twin at the LIVE scrubbed frame and never flies
 * the camera on the scroll path. Progress toward handoff is driven purely by
 * wheel/pinch deltas through native zoom (z itself past Z_HANDOFF arms the
 * latch in onNativeZoomStep / the onDown edge); there is no easeTo, no
 * moveend wait, no 180/3500ms timeout. Sat rides the scrub law
 * (setSatScrubbed(satOpacityForZoom(z)) — pure fn of z), never a timed ramp.
 * Staging is synchronous on arrival-at-handoff-zoom; the actual reveal stays
 * owned by the twin-ready message (prewarmThenReveal + Lane B listener).
 * Pitch: the iso scrub already holds 45deg at/above Z_HANDOFF and nothing
 * here resets it to 0 — the map carries 45 through the cut while the twin's
 * iso pole (HANDOFF_ISO_POLAR_DEG, now 45) meets it under the shared 36.87deg
 * FOV, so the 5deg snap is gone. The twin hold still pins top-down — Task 36
 * scrubs the intro; this task only aligns the meeting angles.
 * Settle centering: owned by the zoomend center-ease in onNativeZoomStep
 * (same zoomend, proximity-gated) — the old 180ms post-flight nudge is
 * deleted, not moved. Falls back to a direct open when the map isn't ready
 * or bounds fail. Re-entrant clicks are ignored via transitId.
 * Staged hold (owner refinement): a deep arrival NEAR the hotspot clamps
 * scroll-as-zoom at the gate (maxZoom = Z_HANDOFF) and further scroll ticks
 * accumulate as stage scroll S (see installStagedAccum + handoffStagesFor-
 * Scroll): ring -> blend -> tilt holds, then the twin dissolve. Twin-ready
 * GRANTS the dissolve, the fingers own its progress, zoomend settle below
 * the gate unwinds it — the only exits. Far arrivals skip the clamp. */
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
  if (!mapRef || !bounds) {
    return openTwin(id, opts);
  }
  if (transitId) return false;
  // Live arrival: native zoom owns z — read it, never set it on this path.
  let liveZ = null;
  try {
    liveZ = +mapRef.getZoom();
  } catch {
    liveZ = null;
  }
  const deep = Number.isFinite(liveZ) && needsHandoff(liveZ);
  transitId = id;
  window.__mapProbe.transit = id;
  // Task-37: a fresh handoff disarms an armed gesture recede (the camera is
  // owned forward again — the stale arrival closure must never land home
  // mid-journey) and drops the hold veil if one lingered.
  receding = false;
  recedeLandHome = null;
  try {
    showVectorHold(false);
  } catch { /* veil teardown is best-effort */ }
  try {
    if (!deep) {
      // Click/fallback entry below handoff: place the staged frame
      // synchronously (duration-0 jump to the SAME wide site fit the old
      // flight framed — ring + margin, never terminal-tight) so the twin
      // anchors on the site at a legal zoom. No ease, no timers: a discrete
      // open carries one honest cut (reduced-motion keeps this exact path).
      const w = wideZoomForBounds(bounds);
      try {
        if (w) mapRef.jumpTo({ center: w.center, zoom: w.zoom, bearing: 0, pitch: pitchTargetForZoom(w.zoom) });
        else mapRef.fitBounds(bounds, { bearing: 0, pitch: 0, duration: 0, padding: wideFitPadding(), maxZoom: 14 });
        try {
          liveZ = +mapRef.getZoom();
        } catch { /* keep the pre-jump read */ }
      } catch { /* jump is best-effort; stage the live frame below */ }
    }
    // Forward-path sat: PURE function of z (the scrub law) — never the timed
    // setSatForced ramp. Past the fade band this is already ~1 (asserted by
    // every zoom step); the re-assert covers the jumpTo above.
    try {
      setSatScrubbed(satOpacityForZoom(Number.isFinite(liveZ) ? liveZ : Z_HANDOFF));
    } catch { /* sat stage is best-effort */ }
    showVignette(true);
    // Handoff-5-close: publish the staged zoom for the framing probe.
    try {
      window.__mapProbe.mapZoom = liveFrame()?.z ?? null;
    } catch { /* probe cosmetic */ }
    const proxNow = proximityInfo();
    const nearNow = !!(proxNow && proxNow.near);
    // Reduced-motion never stages (no scroll-driven dissolve to follow) —
    // the unstaged prewarm below reveals instantly inside prewarmThenReveal.
    let reducedMotion = false;
    try {
      reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch { /* cosmetic */ }
    // Arrival owns staging (synchronous — no 180ms settle, no 3500ms moveend
    // fallback). Near the hotspot the hold becomes STAGED: z clamps at the
    // gate and further scroll ticks accumulate as stage advances (the twin-
    // ready message + zoomend settle are the only exits). Far away there is
    // nothing to hold against — stage unstaged, reveal on twin-ready as
    // before, native zoom untouched.
    try {
      window.__mapProbe.deepHandoff = Number.isFinite(liveZ)
        ? { z: +liveZ.toFixed(2), scrub: +handoffScrubForZoom(liveZ).toFixed(4), staged: deep && nearNow && !reducedMotion }
        : null;
    } catch { /* probe cosmetic */ }
    if (deep && nearNow && !reducedMotion) {
      try {
        if (mapRef && typeof mapRef.setMaxZoom === 'function') mapRef.setMaxZoom(Z_HANDOFF);
      } catch { /* clamp is best-effort */ }
      stagedActive = true;
      stagedS = 0;
      stagedCommitted = false;
      lastPostedStagedS = null; // Task-37: the S producer re-arms (S=0 posts on first drive)
      try {
        window.__mapProbe.staged = { active: true, s: 0, committed: false };
      } catch { /* probe cosmetic */ }
      prewarmThenReveal(id, liveFrame(), { ...opts, staged: true });
    } else {
      prewarmThenReveal(id, liveFrame(), opts);
    }
  } finally {
    transitId = null;
    window.__mapProbe.transit = null;
  }
  return true;
}

/** Task-35 staged-scrub helpers: restore the native zoom ceiling (unclamp).
 * Idempotent — safe from every staged exit path. */
function restoreMaxZoom() {
  try {
    if (mapRef && typeof mapRef.setMaxZoom === 'function') mapRef.setMaxZoom(Z_MAX);
  } catch { /* unclamp is best-effort */ }
}

/** Task-37 staged-S producer (map -> twin): posts { type, s } to the live
 * twin frame as S accumulates past the gate, so the twin intro scrub tracks
 * the fingers instead of its autoplay clock. Throttled to value-change
 * (lastPostedStagedS); mirrors the postTwinReverseRequest pattern
 * (contentWindow + '*' — same-origin iframe). The twin consumes it through
 * its existing staged listener; with no twin/no frame this is a silent
 * no-op and autoplay still owns the intro. Never throws. */
function postTwinStagedS() {
  try {
    if (!stagedActive || stagedCommitted) return false;
    const s = Math.max(0, +stagedS || 0);
    if (lastPostedStagedS !== null && s === lastPostedStagedS) return false;
    const fr = overlayEls && overlayEls.frame;
    if (!fr || fr.getAttribute('data-url') === 'about:blank') return false;
    const win = fr.contentWindow;
    if (!win) return false;
    win.postMessage(buildTwinStagedMessage(s), '*');
    lastPostedStagedS = s;
    try {
      window.__mapProbe.stagedPost = +s.toFixed(1);
    } catch { /* probe cosmetic */ }
    return true;
  } catch {
    return false;
  }
}

/** Drive the staged overlay dissolve from accumulated scroll S. Twin-ready
 * GRANTS (>0 only once Lane B posts it); the S law owns the progress, so a
 * fast twin still dissolves on the fingers, never its own rhythm. At full
 * reveal the hold commits (finalizeStagedReveal). Pure-law in, DOM out. */
function driveStagedOverlay() {
  if (!stagedActive || stagedCommitted) return;
  // Task-37: feed S to the twin on every drive (value-change throttled
  // inside) — including the unready hold, where it seeds the release
  // progress without moving the pin.
  try {
    postTwinStagedS();
  } catch { /* producer never breaks the drive */ }
  const st = handoffStagesForScroll(stagedS);
  let root = null;
  try {
    root = document.getElementById('twin-overlay');
  } catch {
    root = null;
  }
  if (!root) return;
  let ready = false;
  try {
    ready = !!window.__mapProbe.twinReady;
  } catch {
    ready = false;
  }
  try {
    window.__mapProbe.staged = {
      active: true,
      s: +stagedS.toFixed(1),
      ring: +st.ring.toFixed(4),
      blend: +st.blend.toFixed(4),
      tilt: +st.tilt.toFixed(4),
      reveal: +st.reveal.toFixed(4),
      ready,
      committed: false,
    };
  } catch { /* probe cosmetic */ }
  if (!ready) {
    // Hold at 0 until Lane B grants the frame — the prewarm keeps booting.
    try {
      if (root.style.opacity !== '0') root.style.opacity = '0';
    } catch { /* cosmetic */ }
    return;
  }
  if (st.reveal >= 1) {
    finalizeStagedReveal(root);
    return;
  }
  try {
    root.style.opacity = st.reveal <= 0 ? '0' : String(+st.reveal.toFixed(4));
  } catch { /* cosmetic */ }
}

/** Commit the staged hold: the fingers dissolved the twin to full — drop the
 * inline staging opacity, run the standard instant reveal bookkeeping
 * (flags, probe, focus) and unclamp native zoom. Idempotent. */
function finalizeStagedReveal(root) {
  if (stagedCommitted) return;
  stagedCommitted = true;
  stagedActive = false;
  lastPostedStagedS = null; // commit ends the S stream (producer guards on flags anyway)
  try {
    if (root) root.style.opacity = '';
  } catch { /* cosmetic */ }
  restoreMaxZoom();
  revealTwin(true); // instant: the scroll already animated the dissolve
  try {
    window.__mapProbe.staged = { active: false, s: +stagedS.toFixed(1), committed: true };
  } catch { /* probe cosmetic */ }
}

/** Unwind the staged hold (reverse exit): zoomend settle below the gate.
 * Unclamps, drops accumulated scroll, hides the staged dissolve, and quietly
 * tears down the uncommitted prewarm (overlay hidden, frame blanked, twin
 * flags cleared) so no invisible twin-open state lingers — the map is never
 * stranded and re-entry restages cold. The twin-ready message is the only
 * other exit (forward, via driveStagedOverlay). */
function exitStaged() {
  const had = stagedActive || stagedS !== 0;
  stagedActive = false;
  stagedS = 0;
  stagedCommitted = false;
  lastPostedStagedS = null; // symmetric unwind: the S stream ends with the hold
  restoreMaxZoom();
  try {
    window.__mapProbe.staged = { active: false, s: 0, committed: false };
  } catch { /* probe cosmetic */ }
  if (!had) return; // nothing staged: flags + unclamp only, never touch live state
  try {
    const root = document.getElementById('twin-overlay');
    if (root) root.style.opacity = ''; // fall back to .prewarm CSS 0
  } catch { /* cosmetic */ }
  // Quiet prewarm teardown (no fade/recede — nothing visible ever staged).
  try {
    if (pendingReveal && pendingReveal.timer) clearTimeout(pendingReveal.timer);
  } catch { /* timer teardown is best-effort */ }
  pendingReveal = null;
  closeSeq++;
  twinOpen = false;
  try {
    window.__mapProbe.prewarm = false;
    window.__mapProbe.twinReady = false;
    window.__mapProbe.reveal = null;
    window.__mapProbe.revealFallback = false;
    window.__mapProbe.revealLate = false;
    window.__mapProbe.handoff = null;
    window.__mapProbe.twinOpen = false;
    try {
      history.replaceState(null, '', mapUrlWithSector(null));
    } catch (err) {
      errors.push('HISTORY: ' + (err && err.message));
    }
  } catch { /* probe cosmetic */ }
  try {
    if (overlayEls && overlayEls.root) {
      overlayEls.root.hidden = true;
      try {
        setFrameUrl(overlayEls.frame, 'about:blank');
      } catch { /* frame teardown is best-effort */ }
    } else {
      const root = document.getElementById('twin-overlay');
      if (root) root.hidden = true;
    }
  } catch { /* overlay teardown is best-effort */ }
  try {
    document.body.classList.remove('twin-open');
  } catch { /* chrome class is cosmetic */ }
}

/** Handoff-4 Lane A seeded reveal: PRE-WARM the twin at the ring frame —
 * create the overlay iframe hidden (opacity 0 via .prewarm, still loading
 * ?sector&cx&cy&z&embed=1) and HOLD the map end-frame until the twin posts
 * {type:'safepipe-twin-ready'} (Lane B). Timeout fallback (~4s) reveals
 * anyway so a silent twin can never strand the map — SKIPPED for staged
 * prewarms (opts.staged): there the twin-ready message is the only forward
 * exit and the map is never stranded (scroll-up unwinds the hold). On ready,
 * CROSSFADE map->twin over ~450ms (overlay opacity 0->1 above the matched
 * sat frame). Reduced-motion: reveal instantly. */
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
  // Staged prewarms skip the timeout fallback: twin-ready is the only
  // forward exit (scroll-up unwinds instead), so a silent twin can never
  // strand the map — the hold simply never dissolves.
  if (!opts.staged) {
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
  }
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
  // Task-37: direct opens disarm an armed gesture recede, like the staged path.
  receding = false;
  recedeLandHome = null;
  try {
    showVectorHold(false);
  } catch { /* veil teardown is best-effort */ }
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
      recedeToHome();
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
/* LANE A recede (reverse): Task-37 gesture-owned reverse scrub back to the
 * first-load world frame — never an abrupt cut, never a programmatic
 * flight. Native wheel/pinch zoom (wheel deltas) owns z back to MAP_FLOOR;
 * sat follows the scrub law per zoom step (setSatScrubbed(satOpacityForZoom(z))
 * in onNativeZoomStep, so the checkpoints retrace exactly); arrival at home
 * lands via the armed recedeLandHome closure. No easeTo, no gesture
 * swallow, no moveend fallback timer — the map stays live throughout, and a
 * fresh handoff mid-recede simply disarms it. Reduced-motion: instant cut.
 * The vector style/sources are never reloaded (held warm), so the way back
 * is instant; no hold veil is raised — the user watches the retrace. */
function recedeToHome() {
  let reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { /* cosmetic */ }
  // GATE-9-A(1): the vector style/sources are never reloaded — the zoom
  // runs over the HELD style (cached in holdVectorWarm), so the way back
  // is instant. No veil: the user watches the checkpoints retrace.
  holdVectorWarm('recede');
  // Task-37: arm the gesture-owned leg — the fingers own z home, the
  // zoom-step home check fires landHome. LandHome is idempotent so a
  // duplicate arrival can never strand a POSITION-OFF rest behind 'home'.
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
    recedeLandHome = null;
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
  recedeLandHome = landHome;
  // Handoff-5-close: probe the recede leg (sat->flat + zoom-out).
  window.__mapProbe.recede = 'out';
  try {
    if (reduced) {
      // Reduced-motion: instant cut home, no gesture needed.
      if (mapRef) {
        mapRef.easeTo({
          center: COUNTRY_CENTER,
          zoom: MAP_FLOOR,
          bearing: 0,
          pitch: 0,
          duration: 0,
        });
      }
      landHome();
      return;
    }
    if (mapRef) {
      // Gesture path: NO programmatic flight — assert the scrubbed sat for
      // the current z so the frame is honest while awaiting the fingers;
      // every native zoom step repaints after it (sat via setSatScrubbed).
      try {
        const lz = +mapRef.getZoom();
        if (Number.isFinite(lz)) setSatScrubbed(satOpacityForZoom(lz));
      } catch { /* sat assert is best-effort */ }
      // Already home (or under it): land now instead of waiting on a
      // gesture that has nowhere to go.
      try {
        const lz = +mapRef.getZoom();
        if (Number.isFinite(lz) && isHomeZoom(lz)) landHome();
      } catch { /* arrival check is best-effort */ }
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
  // Task-35 staged: ready GRANTS the dissolve but the fingers own its
  // progress — route through the staged driver, never revealTwin directly.
  if (stagedActive && !stagedCommitted) {
    try {
      driveStagedOverlay();
    } catch { /* staged drive is best-effort */ }
    return;
  }
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
  // Wheel over the blip must zoom the map, not die on the button: the pin
  // layer is a sibling ABOVE the canvas, so map-root listeners never see
  // these wheels. Same up-out flip, cloned to the canvas lane — click
  // (open twin) is untouched, cursor stays on the hotspot for zoom-to-point.
  // Lock-aware: scrolling on the blip drives the locked ease, not the clone.
  try { installWheelFlip(b, map.getCanvasContainer(), { map, lockState: lockEngaged }); } catch { /* flip best-effort */ }
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
      if (!twinOpen) recedeToHome();
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

/** Defer a camera write out of MapLibre's render-task drain. Camera ease
 * frames run INSIDE the task queue; replacing the ease re-entrantly (from a
 * zoom listener) makes the interrupted task's tail queue a DUPLICATE ease
 * frame, which outlives the new ease and crashes the next stop with
 * `_onEaseFrame is not a function`. rAF runs outside the drain, so a
 * deferred ease always starts clean. Fail-open. */
function afterFrame(fn) {
  try {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { try { fn(); } catch { /* deferred camera write best-effort */ } });
    } else fn();
  } catch { try { fn(); } catch { /* best-effort */ } }
}
/** Class insurance for the same race: if a stale duplicate ease frame ever
 * reaches the head of the queue after its ease was superseded, skip it
 * instead of throwing. A superseded frame carries no valid work, so a pure
 * skip is side-effect-free. Fail-open. */
function guardEaseQueue(map) {
  // v6 shape: the ease frame callback lives on the owned Camera
  // (map._camera), not the Map facade — guard whichever owns it.
  const host = map && typeof map._camera === 'object' && map._camera ? map._camera : map;
  try {
    if (!host || typeof host._renderFrameCallback !== 'function') {
      try { window.__mapProbe.easeGuard = 'missing:' + typeof (host && host._renderFrameCallback); } catch { /* probe cosmetic */ }
      return;
    }
    const orig = host._renderFrameCallback.bind(host);
    host._renderFrameCallback = (...args) => {
      try {
        if (typeof host._onEaseFrame !== 'function') return;
      } catch { return; }
      return orig(...args);
    };
    try { window.__mapProbe.easeGuard = true; } catch { /* probe cosmetic */ }
  } catch { /* guard best-effort */ }
}
// Owner wheel preference: two-finger drag UP zooms OUT, drag DOWN zooms
// in (reverse of the MapLibre default). Trackpad pinch (ctrl+wheel) stays
// native. Capture-phase flip on the map root: the original wheel is
// stopped, then a sign-flipped clone is dispatched to the canvas lane, so
// the native handler (zoom-to-cursor, pinch path, zoomend) runs untouched
// — only the direction changes. Fail-open: if the clone cannot be built,
// the native event is left alone.
//
// Journey lock: while lockState() holds (spot on screen, past the lock
// arm), the clone carries a phantom zoom anchor — beyond the spot when
// zooming in, canvas center when zooming out — so the NATIVE handler glides
// the spot to center itself. No custom animation exists to stutter.
// ctx = { map, lockState } (optional; without it this is flip-only).
function installWheelFlip(rootEl, laneEl, ctx) {
  if (!rootEl || !laneEl || rootEl.__wheelFlipInstalled) return;
  try { rootEl.__wheelFlipInstalled = true; } catch { /* flag best-effort */ }
  rootEl.addEventListener('wheel', (e) => {
    try {
      if (e.__zoomFlipped) return;
      if (e.ctrlKey) return;
      const dy = +e.deltaY;
      if (!Number.isFinite(dy) || dy === 0) return;
      // Journey lock: zoom AROUND a phantom point placed beyond the spot
      // (zoom-in) or at canvas center (zoom-out). The native handler keeps
      // its around-point fixed, so the spot glides toward center coupled to
      // the user's own scroll speed — one motion, never a yank, easing in
      // as it centers. Fully native downstream (zoom math, events, zoomend)
      // — only the anchor moves.
      let px = null, py = null;
      let locked = false;
      try { locked = !!(ctx && ctx.map && ctx.lockState && ctx.lockState()); } catch { locked = false; }
      if (locked) {
        try {
          const H = ctx.map.project(SITE_LNGLAT);
          const r = laneEl.getBoundingClientRect();
          const P = lockAroundPoint(+H.x, +H.y, (r.width || 800) / 2, (r.height || 600) / 2, dy > 0);
          if (P) { px = r.left + P.x; py = r.top + P.y; }
          else locked = false;
        } catch { locked = false; }
      }
      try { window.__mapProbe.zoomLock = locked; } catch { /* probe cosmetic */ }
      let clone = null;
      try {
        clone = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: flipWheelDelta(+e.deltaX || 0),
          deltaY: flipWheelDelta(dy),
          deltaZ: +e.deltaZ || 0,
          deltaMode: e.deltaMode,
          clientX: px == null ? e.clientX : px,
          clientY: py == null ? e.clientY : py,
          screenX: px == null ? e.screenX : px,
          screenY: py == null ? e.screenY : py,
          ctrlKey: false, shiftKey: !!e.shiftKey,
          altKey: !!e.altKey, metaKey: !!e.metaKey,
        });
        clone.__zoomFlipped = true;
      } catch { return; }
      e.preventDefault();
      e.stopPropagation();
      laneEl.dispatchEvent(clone);
    } catch { /* flip best-effort */ }
  }, { capture: true, passive: false });
  try { window.__mapProbe.zoomFlip = 'up-out'; } catch { /* probe cosmetic */ }
}

/* Task-35 staged accumulator: past the handoff gate scroll-as-zoom is
 * CLAMPED (maxZoom = Z_HANDOFF, set at staged entry) and further scroll
 * ticks accumulate as stage scroll S instead of depth. Passive read-only
 * listener on the canvas lane — it sees the flipped clones (plain wheel,
 * forward = dy<0) AND native pinch (ctrl+wheel, forward = dy<0): forward
 * intent is -deltaY in both conventions. NEVER preventDefaults — below the
 * gate native zoom is untouched, above it the maxZoom clamp holds depth, so
 * there is nothing to block. Symmetric: scroll-up drains S; the zoomend
 * exit (below gate) and twin-ready + S-commit (forward) are the only exits.
 * Every accumulation also drives the overlay AND posts S to the twin frame
 * (driveStagedOverlay -> postTwinStagedS, value-change throttled).
 * A close tearing down the prewarm mid-hold unwinds via exitStaged. */
function installStagedAccum(laneEl) {
  if (!laneEl || laneEl.__stagedAccumInstalled) return;
  try { laneEl.__stagedAccumInstalled = true; } catch { /* flag best-effort */ }
  laneEl.addEventListener('wheel', (e) => {
    try {
      if (!stagedActive || stagedCommitted) return;
      if (!pendingReveal || pendingReveal.revealed) {
        // A close tore the prewarm down mid-hold — unwind, never drive.
        try {
          exitStaged();
        } catch { /* unwind is best-effort */ }
        return;
      }
      const dy = +e.deltaY;
      if (!Number.isFinite(dy) || dy === 0) return;
      stagedS = accumStagedS(stagedS, dy); // symmetric: scroll-up retraces the same law
      driveStagedOverlay(); // repaints the overlay AND posts S to the twin (throttled)
    } catch { /* accumulator never breaks the map */ }
  }, { passive: true });
}

async function boot() {
  const style = await loadStyle();
  const map = new maplibregl.Map({
    container: 'map',
    style,
    center: COUNTRY_CENTER,
    zoom: MAP_FLOOR, // first-load frame: full map, hotspot centered
    // GATE-12-A NATIVE-ZOOM: native zoom STAYS ON everywhere (wheel
    // scrollZoom + touch pinch). The journey RIDES on zoom/zoomend/move
    // events and never hijacks gestures — no preventDefault capture path.
    // First load sits AT the floor (full map); zoom-in travels the whole
    // journey from flat over warming tiles. Home stays the journey rest
    // below the fade start, the floor is the clamp.
    scrollZoom: true,
    minZoom: MAP_FLOOR,
    maxZoom: Z_MAX,
    // Single world: no side-by-side repeats, so the widest honest span is
    // one Earth. Drag pans freely (the journey only recenters on settle
    // when the spot is near, never mid-drag).
    renderWorldCopies: false,
    dragPan: true,
    // LANE A naked view: no default attribution pill / info (ⓘ) button.
    // A minimal micro credit is mounted instead (mountMicroCredit).
    attributionControl: false,
  });
  // No key prompts anywhere: suppress geolocate, never request tokens.
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: true }), 'top-right');
  // Ease-queue guard: a stale duplicate ease frame skips instead of throwing
  // `_onEaseFrame is not a function` (see afterFrame for the full story).
  try { guardEaseQueue(map); } catch { /* guard best-effort */ }
  // Owner preference: drag-up zooms out (flip); pinch stays native.
  // Lock-aware: past the arm with the spot on screen, the clone carries a
  // phantom anchor so native glides the spot to center (see installWheelFlip).
  try { installWheelFlip(document.getElementById('map'), map.getCanvasContainer(), { map, lockState: lockEngaged }); } catch { /* flip best-effort */ }
  // Task-35 staged scrub: passive stage-scroll accumulator on the same lane
  // (read-only — never hijacks gestures; the maxZoom clamp holds depth).
  try { installStagedAccum(map.getCanvasContainer()); } catch { /* accum best-effort */ }

  map.on('load', () => {
    // LANE A: belt-and-braces label strip + micro credit + kill any
    // injected attrib pill (no ⓘ button anywhere).
    stripLabelLayers(map);
    mountMicroCredit();
    mountScaleHud();
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
            // Tile-level crossfade: Esri swaps source captures across zooms
            // ("inevitably different" images) — this fades old->new tiles
            // instead of popping. Independent of the opacity ramp above.
            // 800ms so a deeper-zoom tone change reads as a dissolve.
            'raster-fade-duration': 800,
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
    try {
      const zz0 = map.getZoom();
      if (Number.isFinite(+zz0)) updateScaleHud(+zz0);
    } catch { /* initial hud best-effort */ }

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
    try { if (typeof map.setMinZoom === 'function') map.setMinZoom(MAP_FLOOR); } catch { /* best-effort */ }
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
    // center + deep handoff + mirrored reverse. Direction flip lives in
    // installWheelFlip (capture, plain-wheel only) — not here.
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
    // GATE-9-A(1): first-load world flat view is the held frame — cache it now.
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

  /* GATE-12-A NATIVE-ZOOM: no wheel hijack for the journey (zoom/zoomend/move
   * events only). One deliberate capture flip (installWheelFlip) inverts
   * plain-wheel direction per owner preference — pinch + twin gestures
   * untouched (Lane B owns twin-side entry/exit via the unchanged
   * handoff query + ready/close message contract). */
}

boot();
