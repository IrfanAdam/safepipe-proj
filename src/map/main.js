// src/map/main.js — Phase 03 Tasks 16+17: launcher map + health rings.
// MapLibre owns ground (CARTO Dark Matter vector, keyless; Esri satellite
// raster toggle). deck.gl MapLibreOverlay draws H3-sized health arcs per
// sector + Scatterplot pin fallback. Functional only — map-look deferred.
// Probe surface: window.__mapProbe { ready, base, satOn, rings, pins, mode,
// worst: {sectorId: health}, errors[] }.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
if (maplibregl?.config) maplibregl.config.WORKER_URL = workerUrl;
import { MapLibreOverlay } from 'deck.gl';
import { PolygonLayer, ScatterplotLayer, TextLayer } from 'deck.gl';
import { SITE, sectorsWithOverride, worstHealth } from './feed.js';
import { buildRingFeatures, buildPinData } from './rings.js';

const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_SOURCE_ID = 'esri-sat';
const SAT_LAYER_ID = 'esri-sat';

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

window.__mapProbe = {
  ready: false, base: 'dark-matter', satOn: false,
  rings: 0, pins: sectors.length, mode: pinMode ? 'pins' : 'rings',
  worst, errors,
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
    b.addEventListener('click', () => {
      document.querySelectorAll('.map-pin').forEach((p) => p.removeAttribute('data-sel'));
      b.setAttribute('data-sel', 'true');
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

    let overlay = null;
    let mode = pinMode ? 'pins' : 'rings';
    if (!pinMode) {
      try {
        const feats = buildRingFeatures(sectors);
        const pins = buildPinData(sectors);
        window.__mapProbe.rings = feats.length;
        overlay = new MapLibreOverlay({
          interleaved: false,
          layers: [
            new PolygonLayer({
              id: 'sector-rings',
              data: feats,
              getPolygon: (d) => d.polygon,
              getFillColor: (d) => d.color,
              getLineColor: [11, 12, 12, 255],
              getLineWidth: 2,
              lineWidthUnits: 'pixels',
              filled: true,
              stroked: true,
              opacity: 0.85,
              pickable: true,
            }),
            new ScatterplotLayer({
              id: 'sector-pins',
              data: pins,
              getPosition: (d) => d.position,
              getFillColor: (d) => d.color,
              getRadius: 18,
              radiusUnits: 'pixels',
              stroked: true,
              getLineColor: [11, 12, 12, 230],
              lineWidthUnits: 'pixels',
              getLineWidth: 2,
              pickable: true,
            }),
            new TextLayer({
              id: 'sector-labels',
              data: pins,
              getPosition: (d) => d.position,
              getText: (d) => d.name,
              getSize: 12,
              sizeUnits: 'pixels',
              getColor: [207, 212, 214, 255],
              getPixelOffset: [0, -26],
            }),
          ],
        });
        map.addControl(overlay);
      } catch (err) {
        errors.push('DECK-FALLBACK: ' + (err && err.message));
        mode = 'pins';
        window.__mapProbe.mode = 'pins';
        const pl = document.getElementById('map-pins');
        if (pl) pl.hidden = false;
      }
    }

    const chrome = mountChrome(map, overlay, setSat);
    if (mode === 'pins') chrome.pinLayer.hidden = false;
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
