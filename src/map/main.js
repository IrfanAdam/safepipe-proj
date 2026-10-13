// src/map/main.js — Phase 03 Tasks 16-19 + GATE 3 look pass: flat light
// Azerbaijan country map (Carto Positron GL, keyless; Esri satellite raster
// toggle, flat default) with a single pulsing SANGACHAL monitoring blip
// (40.201262N 49.481270E). Blip color = site worst-health from ./feed.js
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
import { PolygonLayer, ScatterplotLayer, TextLayer } from 'deck.gl';
import { SITE, sectorsWithOverride, worstHealth, HEALTH_COLORS, HEALTH_RANK } from './feed.js';
import { buildPinData } from './rings.js';
import {
  sectorH3Map,
  twinUrl,
  parseSectorParam,
  findSector,
  worstAssetId,
  TWIN_CLOSE_MSG,
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

window.__mapProbe = {
  ready: false, base: 'positron', satOn: false,
  rings: 0, pins: 1, mode: pinMode ? 'pins' : 'rings',
  worst, worstAsset: worstBySector, sectorH3: null,
  selected: selectedId, twinOpen: false,
  blips: 1, siteWorst, siteSector, site: { lat: SITE.lat, lon: SITE.lon, name: 'SANGACHAL' },
  errors, openTwin, closeTwin, selectSector,
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
    return await res.json();
  } catch (err) {
    errors.push('STYLE-FALLBACK: ' + (err && err.message));
    window.__mapProbe.base = 'fallback';
    return fallbackStyle();
  }
}

/** deck.gl layers: single Sangachal blip (halo + core) + label. Clickable. */
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
    new TextLayer({
      id: 'sector-labels',
      data: deckPins,
      getPosition: (d) => d.position,
      getText: (d) => d.name,
      getSize: 13,
      sizeUnits: 'pixels',
      getColor: [45, 55, 60, 255],
      getPixelOffset: [0, -34],
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
    '<span class="map-toggle__meta" id="map-meta">positron</span>';
  document.getElementById('app').appendChild(bar);
  const btn = bar.querySelector('#sat-toggle');
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    setSat(on);
    window.__mapProbe.satOn = on;
    const meta = document.getElementById('map-meta');
    if (meta) meta.textContent = on ? 'satellite' : 'positron';
  });
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
    openTwin(siteSector);
  });
  pinLayer.appendChild(b);
  document.getElementById('app').appendChild(pinLayer);
  positionDomPins(map);
  return { btn, pinLayer };
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
  });

  map.on('error', (e) => {
    const msg = (e && e.error && e.error.message) || 'map-error';
    // Tile blips (offline sandbox) must not fail the probe: record, don't throw.
    errors.push('MAP: ' + msg);
  });
}

boot();
