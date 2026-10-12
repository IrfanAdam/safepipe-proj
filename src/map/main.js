// src/map/main.js — Phase 03 Tasks 16-19: launcher map + health rings +
// click-to-twin overlay (?sector=<h3>) with X/Esc/back round-trip.
// MapLibre owns ground (CARTO Dark Matter vector, keyless; Esri satellite
// raster toggle). deck.gl MapLibreOverlay draws H3-sized health arcs per
// sector + Scatterplot pin fallback. Clicking a ring/pin opens the twin
// (ops3d-ring2.html) as a full-screen overlay iframe, pre-selected on the
// sector's worst asset; closing keeps hex + selection. Functional only —
// map-look deferred.
// Probe surface: window.__mapProbe { ready, base, satOn, rings, pins, mode,
// worst, worstAsset, sectorH3, selected, twinOpen, errors[], openTwin,
// closeTwin, selectSector }.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
if (maplibregl?.config) maplibregl.config.WORKER_URL = workerUrl;
import { MapLibreOverlay } from 'deck.gl';
import { PolygonLayer, ScatterplotLayer, TextLayer } from 'deck.gl';
import { SITE, sectorsWithOverride, worstHealth } from './feed.js';
import { buildRingFeatures, buildPinData } from './rings.js';
import {
  sectorH3Map,
  twinUrl,
  parseSectorParam,
  findSector,
  worstAssetId,
  TWIN_CLOSE_MSG,
} from './twinlink.js';

const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_SOURCE_ID = 'esri-sat';
const SAT_LAYER_ID = 'esri-sat';
const SEL_KEY = 'ops3d-map-selected';

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

window.__mapProbe = {
  ready: false, base: 'dark-matter', satOn: false,
  rings: 0, pins: sectors.length, mode: pinMode ? 'pins' : 'rings',
  worst, worstAsset: worstBySector, sectorH3: null,
  selected: selectedId, twinOpen: false,
  errors, openTwin, closeTwin, selectSector,
};

function fallbackStyle() {
  return {
    version: 8,
    name: 'safepipe-map-fallback',
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b0c0c' } }],
  };
}

async function loadStyle() {
  try {
    const res = await fetch(DARK_MATTER_STYLE);
    if (!res.ok) throw new Error('dark-matter HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    errors.push('STYLE-FALLBACK: ' + (err && err.message));
    window.__mapProbe.base = 'fallback';
    return fallbackStyle();
  }
}

/** deck.gl layers for the current selection (Task 18: rings are clickable). */
function deckLayers() {
  const onPick = (info) => {
    const s = info && info.object && info.object.sector;
    if (s) openTwin(s);
  };
  return [
    new PolygonLayer({
      id: 'sector-rings',
      data: deckFeats,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.color,
      getLineColor: (d) => (d.sector === selectedId ? [255, 217, 160, 255] : [11, 12, 12, 255]),
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
      id: 'sector-pins',
      data: deckPins,
      getPosition: (d) => d.position,
      getFillColor: (d) => d.color,
      getRadius: 18,
      radiusUnits: 'pixels',
      stroked: true,
      getLineColor: [11, 12, 12, 230],
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      pickable: true,
      onClick: onPick,
    }),
    new TextLayer({
      id: 'sector-labels',
      data: deckPins,
      getPosition: (d) => d.position,
      getText: (d) => d.name,
      getSize: 12,
      sizeUnits: 'pixels',
      getColor: [207, 212, 214, 255],
      getPixelOffset: [0, -26],
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
    if (p.dataset.sector === id) p.setAttribute('data-sel', 'true');
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

/** Task 18: open the twin overlay pre-selected on the sector's worst asset. */
function openTwin(id, opts = {}) {
  const s = sectors.find((x) => x.id === id);
  if (!s) return false;
  selectSector(id);
  const h3 = h3map[id];
  const { root, frame, label } = ensureOverlay();
  const url = twinUrl(h3);
  setFrameUrl(frame, url);
  root.hidden = false;
  try {
    document.body.classList.add('twin-open');
  } catch { /* chrome class is cosmetic */ }
  if (label) label.textContent = s.name + ' — ' + worstAssetId(s) + ' · ' + h3;
  twinOpen = true;
  window.__mapProbe.twinOpen = true;
  window.__mapProbe.sectorH3 = h3;
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

/** Actual teardown: hides the overlay, keeps hex + selection (Task 19). */
function doCloseTwin() {
  if (overlayEls) {
    overlayEls.root.hidden = true;
    try {
      setFrameUrl(overlayEls.frame, 'about:blank');
    } catch { /* frame teardown is best-effort */ }
  }
  try {
    document.body.classList.remove('twin-open');
  } catch { /* chrome class is cosmetic */ }
  twinOpen = false;
  window.__mapProbe.twinOpen = false;
}

/** Task 19: X/Esc/twin-Esc close. Direct teardown + replaceState — never
 * history.back(): subframe loads share the joint history, so back() can
 * step the twin instead of the parent entry. */
function closeTwin() {
  if (!twinOpen) return;
  doCloseTwin();
  try {
    if (history.state && history.state.twin) {
      history.replaceState(null, '', mapUrlWithSector(null));
    }
  } catch (err) {
    errors.push('HISTORY: ' + (err && err.message));
  }
}

window.addEventListener('popstate', (e) => {
  const id = e && e.state && e.state.twin;
  if (id && !twinOpen) openTwin(id, { replace: true });
  else if (!id && twinOpen) doCloseTwin();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && twinOpen) {
    if (e.stopPropagation) e.stopPropagation();
    closeTwin();
  }
});

// Twin-iframe Esc (focus lives in the iframe while orbiting): the embedded
// twin posts TWIN_CLOSE_MSG instead of touching history.
window.addEventListener('message', (e) => {
  if (e && e.data === TWIN_CLOSE_MSG && twinOpen) closeTwin();
});

function mountChrome(map, overlay, setSat) {
  const bar = document.createElement('div');
  bar.className = 'map-toggle';
  bar.innerHTML =
    '<span class="map-toggle__label">MAP</span>' +
    '<button id="sat-toggle" aria-pressed="false" title="Toggle satellite imagery">SAT</button>' +
    '<span class="map-toggle__meta" id="map-meta"></span>';
  document.getElementById('app').appendChild(bar);
  const btn = bar.querySelector('#sat-toggle');
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    setSat(on);
    window.__mapProbe.satOn = on;
    const meta = document.getElementById('map-meta');
    if (meta) meta.textContent = on ? 'satellite' : 'dark-matter';
  });
  // DOM pin fallback layer (screen-reader + no-WebGL path; hidden unless pins mode)
  const pinLayer = document.createElement('div');
  pinLayer.id = 'map-pins';
  pinLayer.className = 'map-pins';
  pinLayer.hidden = !pinMode;
  for (const s of sectors) {
    const b = document.createElement('button');
    b.className = 'map-pin map-pin--' + worst[s.id];
    b.dataset.sector = s.id;
    b.title = s.name + ' — ' + worst[s.id];
    b.textContent = s.name.charAt(0);
    if (s.id === selectedId) b.setAttribute('data-sel', 'true');
    b.addEventListener('click', () => {
      openTwin(s.id);
    });
    pinLayer.appendChild(b);
  }
  document.getElementById('app').appendChild(pinLayer);
  if (pinMode) positionDomPins(map);
  return { btn, pinLayer };
}

function positionDomPins(map) {
  const layer = document.getElementById('map-pins');
  if (!layer) return;
  const pins = layer.querySelectorAll('.map-pin');
  pins.forEach((p) => {
    const s = sectors.find((x) => x.id === p.dataset.sector);
    if (!s) return;
    try {
      const pt = map.project([s.lon, s.lat]);
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
    center: [SITE.lon, SITE.lat],
    zoom: 11.5,
    attributionControl: { compact: true },
  });
  // No key prompts anywhere: suppress geolocate, never request tokens.
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');

  map.on('load', () => {
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
        map.addLayer({ id: SAT_LAYER_ID, type: 'raster', source: SAT_SOURCE_ID, layout: { visibility: 'none' } });
      }
    } catch (err) {
      errors.push('SAT-SOURCE: ' + (err && err.message));
    }

    const setSat = (on) => {
      try {
        if (map.getLayer(SAT_LAYER_ID)) {
          map.setLayoutProperty(SAT_LAYER_ID, 'visibility', on ? 'visible' : 'none');
        }
      } catch (err) {
        errors.push('SAT-TOGGLE: ' + (err && err.message));
      }
    };

    let mode = pinMode ? 'pins' : 'rings';
    if (!pinMode) {
      try {
        deckFeats = buildRingFeatures(sectors);
        deckPins = buildPinData(sectors);
        window.__mapProbe.rings = deckFeats.length;
        deckOverlay = new MapLibreOverlay({
          interleaved: false,
          layers: deckLayers(),
        });
        map.addControl(deckOverlay);
      } catch (err) {
        errors.push('DECK-FALLBACK: ' + (err && err.message));
        mode = 'pins';
        window.__mapProbe.mode = 'pins';
        const pl = document.getElementById('map-pins');
        if (pl) pl.hidden = false;
      }
    }

    const chrome = mountChrome(map, deckOverlay, setSat);
    if (mode === 'pins') chrome.pinLayer.hidden = false;
    // Restored selection (reload/back-forward with ?sector= or stored): mark
    // only — the overlay stays closed until a click (Task 19 keep).
    if (selectedId) selectSector(selectedId);
    map.on('move', () => positionDomPins(map));
    positionDomPins(map);
    window.__mapProbe.ready = true;
    window.__mapProbe.satLayer = !!map.getLayer(SAT_LAYER_ID);
  });

  map.on('error', (e) => {
    const msg = (e && e.error && e.error.message) || 'map-error';
    // Tile blips (offline sandbox) must not fail the probe: record, don't throw.
    errors.push('MAP: ' + msg);
  });
}

boot();
