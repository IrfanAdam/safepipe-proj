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
  HANDOFF_STAGED_S_MAX,
  accumStagedS,
  stagedHoldPitchForS,
  stagedHoldRingCloseForS,
  seamHoldEllipseForS,
  enclosureEllipsePxForZoom,
  MAP_VIGNETTE_RING_M,
  isHomeZoom,
  flipWheelDelta,
  lockAroundPoint,
  maskGainForBlend,
  pitchTargetForZoom,
  metersPerPixel,
  formatGround,
  spanFrac,
  EARTH_CIRC_M,
  Z_MIN,
  Z_FADE1,
  Z_ISO_START,
  Z_HANDOFF,
  Z_TOP,
  Z_MAX,
  Z_FAR_INTENT,
  CACHE_FAST_IDLE_DELAY_MS,
  CACHE_FAST_IDLE_TTL_MS,
  REARM_DOWN_BELOW,
  progressiveRetargetDue,
  stallCeilingPin,
  preStallSwallowDue,
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
  buildTwinRetargetMessage,
  parseTwinFsMessage,
  parseTwinReadyMessage,
  parseTwinPaintedMessage,
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
const COUNTRY_ZOOM = Z_MIN; // country home IS the journey floor — one source, never a matching literal
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
// Handoff-5-close: single close chain. CLOSE_FADE_MS is the SAT raster
// transition only (paint-layer fade, never camera motion) — the overlay
// close itself is an instant cut with no timers, by owner rule.
// closeSeq invalidates a pending hide/recede when a fresh open lands first.
const CLOSE_FADE_MS = 450;
const SAT_FADE_DURATION_MS = 800; // tile-level crossfade: Esri swaps source captures across zooms — fades old->new tiles instead of popping. Independent of the opacity ramp.
const SAT_HIDE_DELAY_MS = 500; // delayed sat-layer hide tracks the 450ms ramp (same beat as the close fade)
let closeSeq = 0;
// Handoff-4 Lane A seeded reveal: prewarm state. pendingReveal = { id, timer,
// revealed } or null. twinReady mirrors the Lane B {type:TWIN_READY_MSG}
// signal; prewarm is true while the overlay iframe loads hidden at opacity 0.
let pendingReveal = null;
const REVEAL_TIMEOUT_MS = 4000;
let lastFallbackArmT = 0; // staged fallback re-arms at most once/sec while the hold flows: every-tick clear+set churns a 4000ms timer that only matters after S stalls
let earlyTwinArmed = false; // round-10 dive-start prewarm: early iframe boot armed, consumed at arrival or aborted on retreat
let staleCloseGuardUntil = 0; // round-10 stale-echo guard: arrival replaces a LIVE early twin, whose pagehide posts a close echo that lands after twinOpen flips and would tear down the fresh prewarm — closes inside this window are dropped (set only when consuming an armed early boot, so plain opens keep exact Esc behavior)
// Boot-once smart cache: the h3 of the live booted twin shell (null = no
// live boot). The intent prewarm boots it once per dive; takeover + arrival
// reuse the warm shell via retarget (no second navigation/reload).
let twinBootKey = null;

window.__mapProbe = {
  ready: false, base: 'positron', satOn: false,
  rings: 0, pins: 1, mode: pinMode ? 'pins' : 'rings',
  worst, worstAsset: worstBySector, sectorH3: null,
  selected: selectedId, twinOpen: false,
  blips: 1, siteWorst, siteSector, site: { lat: SITE.lat, lon: SITE.lon, name: 'SANGACHAL' },
  transit: null, handoff: null, vignette: false, mapFs: false, twinFs: false,
  prewarm: false, twinReady: false, twinPainted: false, reveal: null, revealFallback: false, revealLate: false, revealPaint: false,
  twinBootKey: null, twinBoots: 0, // boot-once cache: live shell key + shell boots this page life (one per dive)
  // CACHE-FAST wall-clock boot budget: idle/intent/boot/arm/grant timestamps
  // (performance.now ms) + live ready-by-arm verdict for the slow-net regression.
  bootTiming: { idleArmed: false, idleFiredMs: 0, intentMs: 0, bootMs: 0, firstBootMs: 0, armMs: 0, readyMs: 0, paintedMs: 0, bootToReadyMs: 0, bootToPaintedMs: 0, readyByArm: null },
  recede: null, mapZoom: null, reverseWait: false, reverseFallback: false,
  view: null, // live ground-scale telemetry { z, tile, frac, w, h, label }
  // GATE-9-A scrub probe: journey progress driving zoom/center/fade.
  scrub: { progress: 0, zoom: null, opacity: 0, centerDist: null },
  centerEase: 0, autoCenter: false, satOpacity: 0,
  // GATE-12-A native-zoom probe: zoom-keyed journey, proximity, ring clip.
  proximity: null, ringClip: { k: 0, cursorNear: false, centerNear: false },
  zoomJourney: { zMin: Z_MIN, zHand: Z_HANDOFF, zTop: Z_TOP, zMax: Z_MAX, topDown: false, handoff: false, home: true },
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

/** CACHE-FAST wall-clock stamp (performance.now ms, Date.now fallback). Never throws. */
function nowMs() {
  try {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
  } catch { /* fall through to Date */ }
  try { return Date.now(); } catch { return 0; }
}
/** CACHE-FAST arm stamp: the handoff commits to the twin (arrival entry).
 * Per-arm verdict, reset every arm: true iff the CURRENT shell holds REAL
 * CONTENT at the arm (sampled live through the same gate the staged hold
 * drives on) — boot-earliness alone never counts, because a booted-but-
 * tileless shell still freezes S behind the pill, so stamping it warm lied.
 * A fresh navigation after this stamp resets the race
 * (see resetGrantStampsForFreshShell). */
function stampArm() {
  try {
    const bt = window.__mapProbe && window.__mapProbe.bootTiming;
    if (!bt) return;
    const t = nowMs();
    bt.armMs = t;
    bt.readyByArm = null;
    let content = false;
    try {
      content = twinFrameHasContent() === true;
    } catch { content = false; }
    if (content) bt.readyByArm = true;
  } catch { /* probe cosmetic */ }
}
/** CACHE-FAST grant stamp: twin first-paint ('painted') or pose-match
 * ('ready'). Records boot->grant wall-clock; decides ready-by-arm once an
 * arm exists (grant at/before the arm = warm when the fingers arrived).
 * Sticky-true: a pre-arm warm shell stays warm even when the post-arm grant
 * lands later — each new arm resets the verdict (see stampArm). */
function stampGrant(kind) {
  try {
    const bt = window.__mapProbe && window.__mapProbe.bootTiming;
    if (!bt) return;
    const t = nowMs();
    if (kind === 'ready') {
      bt.readyMs = t;
      if (bt.bootMs > 0 && t >= bt.bootMs) bt.bootToReadyMs = t - bt.bootMs;
    } else {
      bt.paintedMs = t;
      if (bt.bootMs > 0 && t >= bt.bootMs) bt.bootToPaintedMs = t - bt.bootMs;
    }
    if (bt.armMs > 0 && bt.readyByArm !== true) bt.readyByArm = t <= bt.armMs;
  } catch { /* probe cosmetic */ }
}
/** CACHE-FAST fresh-shell reset: a post-arm navigation births a new shell,
 * so the discarded shell's grants must not describe the new race. Re-births
 * bootMs (firstBootMs keeps the page-life headline number); grants pending. */
function resetGrantStampsForFreshShell() {
  try {
    const bt = window.__mapProbe && window.__mapProbe.bootTiming;
    if (!bt) return;
    const t = nowMs();
    if (!bt.firstBootMs && bt.bootMs > 0) bt.firstBootMs = bt.bootMs;
    bt.bootMs = t;
    bt.paintedMs = 0;
    bt.readyMs = 0;
    bt.bootToPaintedMs = 0;
    bt.bootToReadyMs = 0;
    bt.readyByArm = null;
  } catch { /* probe cosmetic */ }
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

/* Twin-open snap guard (map side): the camera hook keeps owning pitch until
 * the twin overlay is actually opaque. Releasing at dissolve start
 * (twinOpen set, overlay still translucent) lets the native ease re-apply
 * the gesture-start pitch 0 on every frame — a minus-45 snap behind the
 * fading overlay. Computed opacity is the single source: it covers the
 * staged scrubbed leg (inline opacity) and the timed crossfade leg (the
 * stylesheet value easing 0->1). Never throws; unreadable state keeps
 * ownership (the safe direction — the hook's law already holds the pole). */
const TWIN_OVERLAY_OPAQUE = 1; // computed overlay opacity at which the twin owns the frame and the hook releases
const TWIN_OVERLAY_OPAQUE_EPS = 0.01; // float slack on the opaque comparison
function twinOverlayOpaque() {
  try {
    const root = overlayEls && overlayEls.root;
    if (!root || root.hidden) return false;
    let o = NaN;
    try {
      const cs = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(root) : null;
      o = cs ? parseFloat(cs.opacity) : NaN;
    } catch { o = NaN; }
    if (!Number.isFinite(o)) {
      try { o = parseFloat(root.style.opacity); } catch { o = NaN; }
    }
    if (!Number.isFinite(o)) return false;
    return o >= TWIN_OVERLAY_OPAQUE - TWIN_OVERLAY_OPAQUE_EPS;
  } catch {
    return false;
  }
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
    let pitch = null;
    let bearing = null;
    try { pitch = +mapRef.getPitch(); } catch { pitch = null; }
    try { bearing = +mapRef.getBearing(); } catch { bearing = null; }
    const f = {
      cx: +c.lng.toFixed(6),
      cy: +c.lat.toFixed(6),
      z: +mapRef.getZoom().toFixed(2),
    };
    if (Number.isFinite(pitch)) f.pitch = +pitch.toFixed(2);
    if (Number.isFinite(bearing)) f.bearing = +bearing.toFixed(2);
    return f;
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
      mapRef.setPaintProperty(SAT_LAYER_ID, 'raster-opacity-transition', { duration: CLOSE_FADE_MS, delay: 0 });
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
let lastDeepWarmZ = -1; // integer sat level already warmed around the spot
let lastArriveWarmZ = -1; // arriving level already warmed (integer crossings stream it cold otherwise)
// INTENT-PRECACHE: per-dive arrival-level warm state. intentWarmed latches
// when the mask arm first fires (lock intent) and re-arms when intent drops
// (retreat/off-site), so the next dive warms again; the twin boot itself
// aborts on the existing z-band retreat path (earlyTwinArmed guard).
let intentWarmed = false;
let intentWarmedZ = -1; // integer zoom already warmed at lock intent (per dive)
// CACHE-FAST far-intent: per-dive current-level warm state (re-arms with intent loss).
let lastFarWarmZ = -1; // integer zoom already warmed at far intent (per dive)
// CONTENT-READY: progressive twin retarget during the climb — last integer
// zoom re-pinned + last post time. Re-arms with intent loss like the warms.
let lastRetargetZ = -1;
let lastRetargetT = 0;
let scrubProgress = 0;
let scrubFired = false;
// Task-35 staged scrub: past the handoff gate scroll-as-zoom is clamped and
// further ticks accumulate here (px past the gate) instead of depth.
let stagedActive = false;
let stagedS = 0;
let stagedCommitted = false;
// HARD-STOP (owner override): long bounded zero-hold favoring holding. The
// S ramp (overlay opacity) stays at 0 until the twin holds real tiles
// (twinFrameHasContent); forward scroll itself stalls at frozen S (see
// stallHolding/feedStagedScroll) instead of running ahead under a 0 ramp.
// Past HARD_STOP_HOLD_MS forward releases anyway, flagged, so a dead frame
// can never trap the fingers — reverse is always free. The scrub laws stay
// pure functions of scroll; only the feeder advance and the written opacity
// are gated.
let stagedTilesT0 = 0;
const HARD_STOP_HOLD_MS = 30000; // long wall-clock escape bound (was a 4s release-to-law)
const STAGED_TILES_HOLD_MS = HARD_STOP_HOLD_MS; // the overlay ramp shares the same bound
// READINESS-HYSTERESIS: the tiles grant latches. twinFrameHasContent flaps
// mid-dissolve (the twin camera moves => fresh tiles => mapIdle false for a
// few frames), and without a latch each gap re-armed the zero-hold and the
// overlay strobed 0<->law with S freezing under it. Once granted the hold
// stays released for the life of the staged hold (commit/unwind/entry reset
// it); pre-grant ov stays 0 and the commit gates still sample live content.
let stagedTilesGranted = false;

// HARD-STOP state: wall-clock arming of the zero-hold (0 = none armed).
// stallPhase() names where the fingers are: 'staged' while the staged hold
// owns S, 'pre' while the enclosing mask is armed on the native-zoom climb.
// stallArmed() adds the unloaded twin; stallHolding() adds the long cap.
// Reverse (scroll-up) never consults any of this — every reverse path runs
// untouched, so fingers always escape by going back.
let stallT0 = 0;
let stallCeilingOn = false; // pre-gate depth freeze applied (restored only when set here)
let stallPollT = 0; // bounded presentation poll: one 500ms chain while holding (cleared on release)
// HARD-STOP pill grace: the loader is a FALLBACK surface, not a dive badge.
// stallPhase arms at the mask (z~7) while fast-grant dives release almost
// immediately — showing the pill from tick 0 flashes it on every healthy
// dive. Visibility waits STALL_PILL_GRACE_MS of held time; the feeder gate
// (zoom freeze) is unaffected and engages from tick 0.
const STALL_PILL_GRACE_MS = 2000;
function stallPhase() {
  try {
    if (transitId) return null;
    // Staged first: the hold owns S while twinOpen is already true (prewarm),
    // so the twinOpen check below must not mask it — the loader and the S
    // freeze apply inside the mask exactly as on the climb.
    if (stagedActive && !stagedCommitted) return 'staged';
    if (twinOpen) return null;
    if (maskArmed()) return 'pre';
  } catch { /* predicate is best-effort */ }
  return null;
}
function twinLoaded() {
  // READINESS-HYSTERESIS: a latched staged grant survives tile gaps — the
  // feeder (stallSwallowForward) and the loader share this predicate, so
  // without the latch each mid-dissolve gap re-froze S and re-lit the pill.
  // Scoped to the live staged hold: the pre-gate climb stays strict.
  try {
    if (stagedActive && !stagedCommitted && stagedTilesGranted) return true;
  } catch { /* latch read is best-effort */ }
  try { return twinFrameHasContent(); } catch { return false; }
}
function stallArmed() {
  try {
    const phase = stallPhase();
    if (phase === null || twinLoaded()) return false;
    // Gate-approach stop: the mask-armed ('pre') hold swallows forward only
    // on the gate approach — below it the climb flows and the stop happens
    // at the shut mask, never frozen mid-gesture below the arming threshold
    // (a sub-gate freeze the ceiling then had to bound was the trap). The
    // staged hold's S stall is zoom-independent and untouched.
    if (phase === 'pre') {
      let zNow = NaN;
      try { zNow = mapRef ? +mapRef.getZoom() : NaN; } catch { zNow = NaN; }
      if (!preStallSwallowDue({ phase, z: zNow })) return false;
    }
    return true;
  } catch { return false; }
}
function stallWaitMs() {
  try {
    const nowS = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    return stallT0 > 0 ? Math.max(0, nowS - stallT0) : 0;
  } catch { return 0; }
}
function stallHolding() {
  try {
    if (!stallArmed()) return false;
    return stallWaitMs() < HARD_STOP_HOLD_MS;
  } catch { return false; }
}
/** HARD-STOP loading pill: created once, visibility derived from stallHolding().
 * Pointer-transparent, token-styled (see ops3d-map.html #twin-loading). */
function ensureStallLoading() {
  try {
    let el = document.getElementById('twin-loading');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'twin-loading';
    el.setAttribute('aria-hidden', 'true');
    el.hidden = true;
    el.innerHTML = '<b>TWIN LOADING</b><span>forward held &middot; scroll up releases</span>';
    const app = document.getElementById('app');
    if (app) app.appendChild(el);
    return el;
  } catch { return null; }
}
/** Feeder gate: true while forward intent must be swallowed. Refreshes
 * presentation on the way in — this also catches the just-loaded transition:
 * a stale holding bit re-releases through refresh instead of swallowing
 * forever (the content grant lands between ticks, and zone ticks stop while
 * the ceiling holds). Never throws. */
function stallSwallowForward() {
  try {
    let was = false;
    try { was = !!(window.__mapProbe.stall && window.__mapProbe.stall.holding); } catch { was = false; }
    if (!stallArmed() && !was) return false;
    return !!refreshStallLoading();
  } catch { return false; }
}
/** Depth freeze: while the hard stop holds, pin the native maxZoom at the live
 * zoom so NO input (wheel, pinch, touch, keys — or an in-flight native ease
 * landing after the hold re-arms) advances depth; reverse stays free
 * (minZoom untouched). The pin never sits below the staging-arm threshold
 * (stallCeilingPin: max(live, Z_TOP)) — a sub-gate pin trapped the journey
 * (the pin lifts only on a zoom tick, which the pin itself prevents) and let
 * reverse ticks ratchet it down. This runs in EVERY phase including staged: the staged
 * Z_HANDOFF clamp alone still lets zoom travel (and settle) below the gate
 * under the hold (measured 10.96→11.5 ratchet). Restores the phase owner's
 * ceiling on release — the staged clamp while staged, the native cap
 * otherwise — so a grant-time release never unclamps a staged hold, and only
 * ever a ceiling this set. */
function applyStallCeiling(hold) {
  try {
    if (!mapRef || typeof mapRef.setMaxZoom !== 'function') return;
    if (hold) {
      const z = +mapRef.getZoom();
      if (Number.isFinite(z)) { mapRef.setMaxZoom(stallCeilingPin(z)); stallCeilingOn = true; }
      return;
    }
    if (stallCeilingOn) {
      // Release to the phase owner's ceiling, never past it: granting while
      // staged re-hands the staged clamp (the sprint still needs its gate);
      // anywhere else the native cap returns. Unwind/commit paths restore
      // the native cap themselves and clear the arm, so this never fights
      // them — and a ceiling set by nobody is never touched.
      try {
        if (stagedActive && !stagedCommitted) mapRef.setMaxZoom(Z_HANDOFF);
        else restoreMaxZoom();
      } catch { restoreMaxZoom(); }
      stallCeilingOn = false;
    }
  } catch { /* ceiling is best-effort */ }
}
/** Preventive directional guards for non-wheel forward input: touch pinch-in,
 * keyboard +, and double-click carry forward intent without emitting a wheel
 * tick, so the wheel-lane swallows above never see them — without a guard
 * they ratchet depth forward under the hold. Each guard swallows FORWARD
 * only (pinch-out, keyboard -, and every reverse lane pass through untouched,
 * so the fingers always escape by going back). Installed once at boot next
 * to the other lane guards. Never throws. */
let stallPinchD = -1; // last two-finger distance for the touch pinch guard
function installStallForwardGuards() {
  try {
    if (window.__stallGuardsInstalled) return;
    window.__stallGuardsInstalled = true;
  } catch { /* flag best-effort */ }
  // Keyboard: +/= (and numpad +) zoom in, -/_ zoom out. Swallow forward.
  window.addEventListener('keydown', (e) => {
    try {
      if (!e || e.defaultPrevented) return;
      const t = e.target;
      try {
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      } catch { /* target read is best-effort */ }
      const k = e.key;
      const fwd = k === '+' || k === '=' || k === 'Add';
      if (!fwd) return;
      if (stallSwallowForward()) {
        try { window.__mapProbe.stallGuardSwallows = (+window.__mapProbe.stallGuardSwallows || 0) + 1; } catch { /* probe cosmetic */ }
        e.preventDefault();
        e.stopPropagation();
      }
    } catch { /* guard never breaks input */ }
  }, { capture: true });
  // Double-click zooms in (forward) — swallow while holding.
  window.addEventListener('dblclick', (e) => {
    try {
      if (stallSwallowForward()) {
        try { window.__mapProbe.stallGuardSwallows = (+window.__mapProbe.stallGuardSwallows || 0) + 1; } catch { /* probe cosmetic */ }
        e.preventDefault();
        e.stopPropagation();
      }
    } catch { /* guard never breaks input */ }
  }, { capture: true, passive: false });
  // Touch pinch: two fingers spreading zooms out (reverse, free), closing
  // zooms in (forward, swallowed). Single-finger pan always passes — pan is
  // not forward intent. Non-passive so preventDefault actually blocks.
  window.addEventListener('touchstart', (e) => {
    try {
      if (e && e.touches && e.touches.length === 2) {
        const a = e.touches[0];
        const b = e.touches[1];
        stallPinchD = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      } else stallPinchD = -1;
    } catch { stallPinchD = -1; }
  }, { capture: true, passive: true });
  window.addEventListener('touchmove', (e) => {
    try {
      if (!e || !e.touches || e.touches.length !== 2 || stallPinchD <= 0) return;
      const a = e.touches[0];
      const b = e.touches[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const closing = d < stallPinchD;
      stallPinchD = d;
      if (!closing) return; // spreading = reverse, always free
      if (stallSwallowForward()) {
        e.preventDefault();
        e.stopPropagation();
      }
    } catch { /* guard never breaks input */ }
  }, { capture: true, passive: false });
  window.addEventListener('touchend', () => {
    try { stallPinchD = -1; } catch { /* reset is best-effort */ }
  }, { capture: true, passive: true });
  try { window.__mapProbe.stallGuards = 'keys+dblclick+touch'; } catch { /* probe cosmetic */ }
}
/** Single writer for the stall presentation: arms the hold clock, sets loader
 * visibility + pre-gate depth ceiling + probe. Idempotent; safe from every
 * tick/handler. Returns the holding bit so feeder gates stay one-liners. */
function refreshStallLoading() {
  let hold = false;
  let phase = null;
  let loaded = false;
  try { phase = stallPhase(); } catch { phase = null; }
  try { loaded = twinLoaded(); } catch { loaded = false; }
  // Single gate: stallArmed() owns the arm (mask/staged phase + unloaded +
  // the pre-phase approach bound) — the inline phase/loaded read below used
  // to bypass the approach bound, so a per-tick refresh re-armed the hold
  // (and its ceiling) below the gate and the swallow's stale-holding latch
  // kept swallowing where the arm itself refused to.
  let armed = false;
  try { armed = stallArmed(); } catch { armed = false; }
  try {
    if (armed) {
      if (stallT0 <= 0) {
        try {
          stallT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        } catch { try { stallT0 = Date.now(); } catch { stallT0 = 0; } }
      }
      hold = stallWaitMs() < HARD_STOP_HOLD_MS;
    } else {
      stallT0 = 0;
    }
  } catch { hold = false; }
  try {
    const el = ensureStallLoading();
    // Pill grace: the freeze engages from tick 0, but the pill only shows
    // after STALL_PILL_GRACE_MS of held time — fast-grant dives release
    // before the grace and never flash it (fallback-only surface).
    if (el) el.hidden = !(hold && stallWaitMs() >= STALL_PILL_GRACE_MS);
  } catch { /* cosmetic */ }
  try { applyStallCeiling(hold); } catch { /* ceiling is best-effort */ }
  // NOTE: non-wheel forward input (touch pinch-in, keyboard +, double-click)
  // is swallowed by installStallForwardGuards (boot-wired below) — no
  // enable/disable lock here, so reverse retreat is never trapped.
  try {
    window.__mapProbe.stall = {
      holding: hold,
      phase,
      loaded,
      s: +((+stagedS || 0)).toFixed(1),
      waitMs: Math.round(stallWaitMs()),
      escape: !hold && phase !== null && !loaded,
    };
    window.__mapProbe.twinLoaded = loaded;
  } catch { /* probe cosmetic */ }
  // HARD-STOP presentation poll: while the hold is up, re-evaluate at ~2Hz
  // so a content grant that lands with idle fingers still clears the loader
  // and restores the ceiling promptly. Presentation-only (never motion); the
  // chain ends on release or when the arm drops, so it cannot outlive the
  // hold — the long cap bounds it absolutely. The chain also runs while a
  // ceiling this set is still flagged (no hold): a pinned ceiling lifts
  // only inside refresh, and a frozen frame emits no zoom ticks to run it —
  // without the poll the pin would outlive its condition forever.
  try {
    if (hold || stallCeilingOn) {
      if (!stallPollT) {
        try {
          stallPollT = setTimeout(() => {
            stallPollT = 0;
            try { refreshStallLoading(); } catch { /* poll is best-effort */ }
          }, 500);
        } catch { stallPollT = 0; }
      }
    } else if (stallPollT) {
      try { clearTimeout(stallPollT); } catch { /* best-effort */ }
      stallPollT = 0;
    }
  } catch { /* poll is best-effort */ }
  return hold;
}
// Task-37 staged-S producer: last S value posted to the twin frame
// (postTwinStagedS throttles to value-change; null = nothing posted yet).
let lastPostedStagedS = null;
let lastStagedPostT = 0; // 60ms min interval alongside the value-change check: wheel bursts post dozens per frame otherwise
let cachedVectorStyle = null;
let recedeStartT = 0;
let lastCursor = null; // {x,y} client px, passive mousemove only
let isoScrubOwned = false;
let isoRestoreDue = false; // latched on iso engage; cleared only when a settle glides pitch home — the strand guarantor
const ISO_SCRUB_SLACK_DEG = 2; // engage only when pitch is at/below target+slack: never yanks a user oblique
const ISO_SCRUB_EPS_DEG = 0.3; // skip transform writes inside this of target
const ISO_SCRUB_SLEW_DEG = 10; // per-step tilt cap: a flick jumping the band glides over following steps instead of snapping 0->45 in one frame
const ISO_SCRUB_RELEASE = 0.3; // release band below Z_ISO_START: ownership ends only once the pitch actually flattened (see the line-1159 release) — never on zoom alone
const ISO_SETTLE_TOL_DEG = 0.5; // settle landings treat bearing/pitch inside this of target as arrived — never fights damping
const STAGED_EXIT_BELOW = 0.05; // zoomend settle this far below Z_TOP unwinds the staged hold (at-gate holds)
const STAGED_COMMIT_Z_TOL = 0.05; // commit-time scale nearness: live zoom must read at the handoff gate (the clamp holds it there — drift means the ceiling lost and S no longer matches the staged frame)
let isoPumpOn = false; // per-frame tilt pump flight flag (single rAF loop while the band owns pitch)
/** Live pitch write (DIM-MATCH): maplibre-gl 6.13.0 exposes no public
 * `map.transform` at runtime (the d.ts `get transform()` is absent — the
 * transform lives at `map._camera.transform`, verified live). Every direct
 * pitch write in this file goes through here: the guarded
 * `mapRef.transform.setPitch` sites (tilt pump, per-tick scrub, staged-hold
 * travel, unwind glide) otherwise silently no-op, and the rendered tilt
 * strands below the law — the drawn enclosure ellipse (law pitch) then
 * disagrees with the true ground projection AND the twin hold (which adopts
 * the handed live pitch) for the whole load window. Pitch-only, never
 * touches zoom/center; same slew/EPS gating as the call sites. Returns true
 * when the write landed. Never throws. */
function setLivePitch(p) {
  try {
    const v = +p;
    if (!Number.isFinite(v)) return false;
    if (!mapRef) return false;
    const t = mapRef.transform || (mapRef._camera && mapRef._camera.transform) || null;
    if (!t || typeof t.setPitch !== 'function') return false;
    t.setPitch(v);
    try {
      if (typeof mapRef.triggerRepaint === 'function') mapRef.triggerRepaint();
    } catch { /* repaint is best-effort */ }
    return true;
  } catch { return false; }
}
/** Per-frame tilt pump: while the iso band owns pitch, drive it toward the
 * LIVE law target every animation frame — not per zoom tick. Mid-glide the
 * native zoom animation re-applies the gesture-start pitch per frame, so
 * per-tick writes only land on settle (pitch becomes a function of cadence:
 * 44deg at 800ms, 18deg at 250ms, 0 in a dense burst). The pump re-asserts
 * the slew-capped target each frame, so the tilt converges mid-gesture at
 * any cadence; zoom is never touched (setPitch only), ownership/engage/
 * release laws stay per-tick, and the settle reconcile stays the guarantor.
 * Started on engage; self-stops the frame ownership ends. Never throws. */
function pumpIsoPitch() {
  if (isoPumpOn) return; // one flight — engages re-fire per step, the loop persists
  if (typeof requestAnimationFrame !== 'function') return;
  isoPumpOn = true;
  const frame = () => {
    try {
      // Live-hold carry: while the staged hold owns the frame (twin booting
      // under the clamp), the pump keeps running and carries the S-driven
      // hold tilt per-frame — otherwise tilt freezes mid-gesture exactly when
      // the fingers need it. Flights still park (they own the camera), and
      // the translucent dissolve start still parks. Prewarm-hidden, recede,
      // and the opaque reverse-walk let the pump through: pitch-only, the map
      // is visible, and the law has to track there (measured: parking on
      // pendingReveal froze pitch at the first slew-capped write).
      const holdOwned = stagedActive && !stagedCommitted;
      let revThrough = false;
      try {
        revThrough = !!reverseWait && typeof twinOverlayOpaque === 'function' && twinOverlayOpaque();
      } catch { revThrough = false; }
      const revPark = !!reverseWait && !revThrough;
      if (!isoScrubOwned || !mapRef || (((twinOpen && !revThrough) || transitId || revPark) && !holdOwned)) {
        isoPumpOn = false; // ownership ended — park, never fight the camera
        return;
      }
      let z = null;
      try {
        z = +mapRef.getZoom();
      } catch { z = null; }
      if (Number.isFinite(z)) {
        // Live-hold carry: the S-driven hold tilt rides on top of the zoom
        // law while the hold owns the frame (relaxes to the pole by commit),
        // so the per-frame pump converges the fingers' tilt, not just the law.
        const pLaw = pitchTargetForZoom(z)
          + ((stagedActive && !stagedCommitted) ? stagedHoldPitchForS(stagedS) : 0);
        let pCur = null;
        try {
          pCur = +mapRef.getPitch();
        } catch { pCur = null; }
        if (Number.isFinite(pCur)) {
          let pT = pLaw;
          const d = pLaw - pCur;
          if (Math.abs(d) > ISO_SCRUB_SLEW_DEG) pT = pCur + Math.sign(d) * ISO_SCRUB_SLEW_DEG;
          if (Math.abs(pCur - pT) > ISO_SCRUB_EPS_DEG) {
            try {
              setLivePitch(pT);
            } catch { /* frame write is best-effort */ }
          }
        }
      }
    } catch { /* pump never breaks the frame */ }
    try {
      requestAnimationFrame(frame);
    } catch {
      isoPumpOn = false;
    }
  };
  try {
    requestAnimationFrame(frame);
  } catch {
    isoPumpOn = false;
  }
}

function clamp01(v) {
  const n = +v;
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function smooth01(t) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}
/** Mask arm (the single zoom-anchor gate): true exactly when the enclosing
 * mask is up — the live zoom is past Z_CENTER (shared blend > 0) AND the
 * hotspot reads near, with no twin owning the frame. This is the same
 * predicate as the vignette write below (near && blend > 0 under !twinOpen),
 * so center-anchored zoom starts on the exact tick the mask appears and
 * cursor-anchored zoom runs only while the mask is down. Busy flags are
 * deliberately NOT consulted: the mask stays up through recede/prewarm, and
 * the anchor must follow the mask, not the lock. Replaces lockEngaged. */
function maskArmed() {
  try {
    if (twinOpen || !mapRef) return false;
    const z = +mapRef.getZoom();
    if (!Number.isFinite(z) || centerBlendForZoom(z) <= 0) return false;
    const prox = proximityInfo();
    return !!(prox && prox.near);
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
      sx: Math.round(pt.x), sy: Math.round(pt.y),
      distCursor: distCursor == null ? null : +distCursor.toFixed(1),
      distCenter: +distCenter.toFixed(1),
      cursorNear, centerNear, near: cursorNear || centerNear,
    };
  } catch {
    return null;
  }
}

/** Ring clip: --clip gates bracket APPEARANCE (fades in above ~0.02).
 * Positioning rides the shared enclosure vars (--vx/--vy/--vr on #app,
 * written by the journey driver) — glyph centres sit on the ring
 * bounding-square corners, so k only needs to fade, never to place. */
let lastClipK = -1; // last written clip-k: per-tick repeats write nothing
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
    // Unchanged k writes nothing: per-tick var + class churn forces style
    // recalc for an identical frame.
    const key = +v.toFixed(4);
    if (key !== lastClipK) {
      lastClipK = key;
      clip.style.setProperty('--clip', v.toFixed(4));
      clip.classList.toggle('on', v > 0.02);
    }
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
 * Visibility stays on through the journey so tiles never reload mid-fade.
 * Layout + transition writes are idempotent after the first write in a
 * visible stretch — only the opacity value moves per tick. */
let satScrubPrimed = false;
function setSatScrubbed(p) {
  const v = clamp01(p);
  try {
    if (mapRef && mapRef.getLayer(SAT_LAYER_ID)) {
      if (!satScrubPrimed) {
        try {
          mapRef.setLayoutProperty(SAT_LAYER_ID, 'visibility', 'visible');
        } catch { /* layout is best-effort */ }
        try {
          mapRef.setPaintProperty(SAT_LAYER_ID, 'raster-opacity-transition', { duration: 0, delay: 0 });
        } catch { /* transition reset is best-effort */ }
        satScrubPrimed = true;
      }
      try {
        mapRef.setPaintProperty(SAT_LAYER_ID, 'raster-opacity', v);
      } catch (err) {
        errors.push('SAT-SCRUB: ' + (err && err.message));
      }
    } else {
      satScrubPrimed = false;
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
let lastEllipseRx = null; // last live enclosure radii: the park fallback, so a null step reuses the ring instead of snapping to the 260px registered initial
let lastEllipseRy = null;
let lastVrWritten = null; // last WRITTEN enclosure strings on #app: per-tick dedupe, so an unchanged
let lastVrYWritten = null; // radius/center never forces style recalc mid-tick (one cache shared by the
let lastVxWritten = null; // live write, the park fallback, and the hold blend — same element, same props).
let lastVyWritten = null; // Guards stay inline at each setProperty site (never a shared writer), so the
// driver keeps one literal per-site write of the horizontal and vertical radii.
let entryRx = null; // staged-entry radii: the arrival's live-law write, cached so the hold ring blends entry->seam on scroll instead of snapping to the seam constant (cleared on unwind)
let entryRy = null;
/** SINGLE RADIUS LAW: viewport-clamped farthest-corner distance. An
 * off-screen hotspot inflates the true corner 100x (measured 21000px
 * blowups that parked the mask off-frame), while the staged-hold entry
 * refresh already clamps the spot to the viewport — two corner laws whose
 * mid-band radii disagreed by ~2x (park vs entry). Both writers now share
 * this clamp: bounded, smooth, converging exact as the enclosure span
 * closes (t->1 yields the ring radius whatever the corner). Pure. */
function viewportCornerPx(sx, sy, cw, ch) {
  const w = Number.isFinite(+cw) && +cw > 0 ? +cw : 800;
  const h = Number.isFinite(+ch) && +ch > 0 ? +ch : 600;
  const csx = Math.min(Math.max(+sx, 0), w);
  const csy = Math.min(Math.max(+sy, 0), h);
  const fx = Math.max(csx, w - csx);
  const fy = Math.max(csy, h - csy);
  return Math.sqrt(fx * fx + fy * fy);
}
/** Write the live enclosure ellipse (center + radii) onto #app from a proximity
 * read and a zoom. Returns the ellipse, or null when it parks (no corner /
 * below band / unreadable frame). Every radii write caches, so the park path
 * below can reuse the last live size. Callers own visibility (.on gates). */
function writeEnclosureEllipse(proxArg, zArg) {
  try {
    const app = document.getElementById('app');
    if (!app || !mapRef) return null;
    let z = Number.isFinite(+zArg) ? +zArg : NaN;
    if (!Number.isFinite(z)) {
      try { z = +mapRef.getZoom(); } catch { z = NaN; }
    }
    if (!Number.isFinite(z)) return null;
    const prox = proxArg || proximityInfo();
    if (!prox) return null;
    // Center follows proximity only: an off-screen projection parks the spot
    // 100k+ px out, and writing it would snap the mask + brackets across the
    // frame when nearness resumes. Radii still write (the arrival path needs
    // true sizes off-centre); the stale center is simply left at last-near —
    // UNLESS a site-anchored hold owns the frame: then the mask rides the
    // ANCHOR projection (the twin's handed center, SITE by construction),
    // so mask and twin agree even off-centre, zero lateral offset.
    if (prox.near) {
      const vxStr = Math.round(prox.sx) + 'px';
      const vyStr = Math.round(prox.sy) + 'px';
      if (lastVxWritten !== vxStr) { app.style.setProperty('--vx', vxStr); lastVxWritten = vxStr; }
      if (lastVyWritten !== vyStr) { app.style.setProperty('--vy', vyStr); lastVyWritten = vyStr; }
    } else if (stagedActive && stagedAnchor && stagedAnchor.site && mapRef) {
      try {
        const pa = mapRef.project([stagedAnchor.cx, stagedAnchor.cy]);
        if (pa && Number.isFinite(+pa.x) && Number.isFinite(+pa.y)) {
          const vxStr = Math.round(pa.x) + 'px';
          const vyStr = Math.round(pa.y) + 'px';
          if (lastVxWritten !== vxStr) { app.style.setProperty('--vx', vxStr); lastVxWritten = vxStr; }
          if (lastVyWritten !== vyStr) { app.style.setProperty('--vy', vyStr); lastVyWritten = vyStr; }
        }
      } catch { /* anchor-center write is best-effort */ }
    }
    let corner = null;
    try {
      const el = mapRef.getContainer();
      const w = (el && el.clientWidth) || window.innerWidth || 800;
      const h = (el && el.clientHeight) || window.innerHeight || 600;
      // SINGLE RADIUS LAW: the clamped corner (shared with the staged-hold
      // entry refresh below) — never the true off-screen projection.
      corner = viewportCornerPx(prox.sx, prox.sy, w, h);
    } catch { corner = null; }
    const ellipse = enclosureEllipsePxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M, corner);
    if (ellipse && Number.isFinite(ellipse.rx) && Number.isFinite(ellipse.ry)) {
      const vrStr = ellipse.rx.toFixed(1) + 'px';
      const vrYStr = ellipse.ry.toFixed(1) + 'px';
      if (lastVrWritten !== vrStr) { app.style.setProperty('--vr', vrStr); lastVrWritten = vrStr; }
      if (lastVrYWritten !== vrYStr) { app.style.setProperty('--vr-y', vrYStr); lastVrYWritten = vrYStr; }
      lastEllipseRx = +ellipse.rx.toFixed(1);
      lastEllipseRy = +ellipse.ry.toFixed(1);
      try {
        window.__mapProbe.vignetteR = +ellipse.rx.toFixed(1);
        window.__mapProbe.vignetteRy = +ellipse.ry.toFixed(1);
      } catch { /* probe cosmetic */ }
      return ellipse;
    }
    return null;
  } catch { return null; }
}
/** Park the enclosure on the last live radii (else the seam constant) instead
 * of removing to the 260px registered initial: the seam is 484.5px, so the
 * old park breathed ~18px on any visible null-ellipse step. */
function parkEnclosureEllipse() {
  try {
    const app = document.getElementById('app');
    if (!app) return;
    let rx = lastEllipseRx;
    let ry = lastEllipseRy;
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) {
      try {
        const seam = seamHoldEllipseForS(0);
        if (seam && Number.isFinite(seam.rx) && Number.isFinite(seam.ry)) { rx = seam.rx; ry = seam.ry; }
      } catch { /* seam fallback is best-effort */ }
    }
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || !(rx > 0)) return;
    const parkVr = rx.toFixed(1) + 'px';
    const parkVrY = ry.toFixed(1) + 'px';
    if (lastVrWritten !== parkVr) { app.style.setProperty('--vr', parkVr); lastVrWritten = parkVr; }
    if (lastVrYWritten !== parkVrY) { app.style.setProperty('--vr-y', parkVrY); lastVrYWritten = parkVrY; }
  } catch { /* cosmetic */ }
}
/** THE native-zoom driver: reads ONE zoom snapshot (the map owns zoom —
 * this never sets zoom, never jumpTo's depth). Fade tracks zoom at the
 * CURRENT center; center rides the shared blend onto the spot continuously
 * (takeover tick-write), never a settle snap; deep
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
    // Journey enclosure: the vignette ellipse starts at the hotspot's farthest
    // screen corner (clear frame, darkness biasing in from the edges) and
    // closes onto the PROJECTED ring radius across the shared enclosure
    // span Z_CENTER..Z_HANDOFF (enclosureEllipsePxForZoom: rx is the forming
    // law circle corner*(1-t) + R/mpp*t — the SAME law as the bracket
    // clip-k, so ellipse and brackets stay in sync — ry is rx squashed by
    // the tilt projection cos(pitch), exact R at/above Z_HANDOFF: the same
    // ground circle the twin clip cuts), so the enclosing coincides with
    // the twin clip exactly at handoff and never shrinks past it. The
    // corner brackets ride the SAME --vx/--vy/--vr/--vr-y (lefts on the
    // horizontal axis, tops on the vertical axis), so one write moves
    // both — the old canvas-percentage corner law is gone. Gate: blend>0 (z>7) — below
    // that the ring is sub-pixel and the surround would black the frame.
    // Zoom-out retraces it symmetrically (pure function of z + viewport).
    // Twin paths own it while open.
    // Written on #app (not the vignette node): #map-vignette and #ring-clip
    // are both inset:0 over #app, so both inherit identical values.
    if (!twinOpen && prox) {
      try {
        // One law writes center + radii; the park reuses the last live size
        // instead of snapping to the 260px initial (ghost breathe). Off-centre
        // steps PARK instead of writing: an off-screen projection inflates the
        // corner law 100x (measured 21000px radii) — invisible while the wash
        // is off, but a stale giant the moment anything re-arms it. The
        // arrival path still writes true off-centre sizes directly (its clamp
        // must not depend on nearness); the driver only tracks nearness.
        if (prox.near) {
          if (!writeEnclosureEllipse(prox, z)) parkEnclosureEllipse();
        } else {
          parkEnclosureEllipse();
        }
      } catch { /* cosmetic */ }
      // MASK-SYNC: the arrival flight owns the wash — flyToSectorThenTwin
      // washes staged arrivals now, revealTwin co-fires unstaged at the
      // reveal tick — so the driver must not wash mid-jump, or the mask
      // parks seconds before a timer-fired twin. Radii/park writes above
      // still run (the staged entry caches them); maskArmed below is
      // untouched (telemetry still reads the arm predicate).
      if (!transitId) showVignette(prox.near && blend > 0);
      try {
        window.__mapProbe.maskArmed = !!(prox.near && blend > 0);
      } catch { /* probe cosmetic */ }
    } else {
      try {
        window.__mapProbe.maskArmed = false;
      } catch { /* probe cosmetic */ }
    }
    // CACHE-FAST: far-intent tile warm — one zoom level below the mask arm
    // (near && z >= Z_FAR_INTENT, ~6): warms the CURRENT-level site patch
    // hotspot-first, so the frame under the fingers resolves before the
    // arrival band streams. Tiles only — never boots, never flips twin
    // state, so the mask-arm abort lifecycle is untouched.
    try {
      if (prox && prox.near && z >= Z_FAR_INTENT && !twinOpen) {
        const fz = Math.floor(z);
        if (fz !== lastFarWarmZ) {
          lastFarWarmZ = fz;
          try { prefetchSatTiles(SITE_LNGLAT, fz); } catch { /* warm is best-effort */ }
        }
        try {
          if (!window.__mapProbe.bootTiming.intentMs) window.__mapProbe.bootTiming.intentMs = nowMs();
        } catch { /* probe cosmetic */ }
      } else if (lastFarWarmZ !== -1 && !(prox && prox.near)) {
        lastFarWarmZ = -1; // intent lost: re-arm for the next dive
      }
    } catch { /* far-intent warm never breaks the journey */ }
    // INTENT-PRECACHE: earliest reliable lock-intent signal (pre-iso,
    // center-predictable) — the mask arm itself (near && blend>0, first
    // true just past Z_CENTER, ~1 level before the takeover band and ~3-4
    // before the staging gate). Boots the twin iframe + warms the
    // arrival-level site tiles HERE so both land before the dissolve
    // instead of mid-dissolve. Sets no twinOpen/clamp/history/timers —
    // the ONLY opener stays flyToSectorThenTwin at the gate, so an
    // unintended handoff is structurally impossible (this block names no
    // opener). Twin-side autoplay laws untouched (same boot URL + the same
    // grant/release contract the dive-start path uses; arrival reuses the
    // warm shell via retarget — no reload).
    // Runs on every zoom tick (native + takeover-driven), so the
    // in-band takeover call below stays a backstop, never the first boot.
    try {
      if (prox && prox.near && blend > 0) {
        if (!twinOpen && !transitId && !pendingReveal && !stagedActive && !earlyTwinArmed) {
          try {
            earlyBootTwin();
          } catch { /* intent boot is best-effort */ }
        }
        const iz = Math.floor(z);
        if (!intentWarmed || iz !== intentWarmedZ) {
          intentWarmed = true;
          intentWarmedZ = iz;
          try { prefetchSatTiles(SITE_LNGLAT, 9); } catch { /* warm is best-effort */ }
          try { prefetchSatTiles(SITE_LNGLAT, 10); } catch { /* warm is best-effort */ }
          try { prefetchSatTiles(SITE_LNGLAT, 11); } catch { /* warm is best-effort */ }
          try {
            if (!window.__mapProbe.bootTiming.intentMs) window.__mapProbe.bootTiming.intentMs = nowMs();
          } catch { /* probe cosmetic */ }
        }
      } else if (intentWarmed) {
        intentWarmed = false; // intent lost: re-arm for the next dive
      }
    } catch { /* intent precache never breaks the journey */ }
    // CONTENT-READY: stream the twin's arrival tiles DURING the dive. The
    // armed/idle shell sits in hold pre-release, so re-pinning it onto the
    // predicted arrival frame as the climb proceeds starts its tile stream
    // early — by the arm the arrival zoom is cached/decoding instead of
    // cold. Posts only: never boots, never flips twin state (same contract
    // as the tile warms above); unreadable shells (still loading) skip and
    // the next tick retries. The band stops below the handoff: a deep frame
    // would trip the twin's painted deep-release pre-arm
    // (see progressiveRetargetDue).
    try {
      if (prox && prox.near && !twinOpen && !transitId && !pendingReveal && !stagedActive) {
        if (progressiveRetargetDue({ z, lastZ: lastRetargetZ, lastT: lastRetargetT, nowT: nowMs() })) {
          try {
            const h3 = h3map[siteSector];
            const shellLive = !!h3 && (earlyTwinArmed || twinBootKey === h3) && overlayEls && overlayEls.frame;
            let posted = false;
            if (shellLive) {
              const win = overlayEls.frame.contentWindow;
              const probe = win && win.__ring2;
              const phase = probe && typeof probe.handoffPhase === 'function' ? probe.handoffPhase() : null;
              // Hold pre-release only. A shell that already matched an
              // earlier pin re-arms on the retarget (twin-side), so posting
              // stays safe — the pin keeps tracking the dive instead of
              // going stale behind a pre-arm grant.
              if (phase === 'hold') {
                // CONTENT-READY prefetch: pin the PREDICTED arrival frame,
                // not the travelling live frame. The arm seats the map on
                // SITE at the live zoom, so stream that center now (plus a
                // half-level zoom lookahead, clamped below the handoff so a
                // deep frame can never trip the twin's painted deep-release
                // pre-arm) — the arrival retarget then lands on cached tiles
                // instead of a cold zoom + center snap.
                const pf = liveFrame();
                if (pf) {
                  pf.cx = SITE_LNGLAT[0];
                  pf.cy = SITE_LNGLAT[1];
                  if (Number.isFinite(pf.z)) pf.z = Math.min(pf.z + 0.5, Z_HANDOFF - 0.1);
                }
                // Same-frame pins are the keepalive, not overhead: every
                // accepted pin restarts the twin's hold floor (twin-side), so
                // a settled shell can never mature a pre-arm exit while pins
                // flow — including through a frozen dive, where the frame
                // stops changing but the floor keeps measuring.
                const msg = buildTwinRetargetMessage(pf);
                if (msg) {
                  win.postMessage(msg, '*');
                  posted = true;
                  try {
                    window.__mapProbe.retargetPosts = (window.__mapProbe.retargetPosts | 0) + 1;
                  } catch { /* post count is probe-only */ }
                }
              }
            }
            if (posted) {
              lastRetargetZ = Math.floor(z);
              lastRetargetT = nowMs();
            }
          } catch { /* retarget is best-effort */ }
        }
      } else if (lastRetargetZ !== -1 && (!prox || !prox.near)) {
        lastRetargetZ = -1; // intent lost: re-arm for the next dive
      }
    } catch { /* progressive retarget never breaks the journey */ }
    try {
      window.__mapProbe.intentPrewarm = intentWarmed || earlyTwinArmed;
    } catch { /* probe cosmetic */ }
    // Deep warm for the dissolve: while the spot is tracked in sat range,
    // keep the arriving level AND the level after next warm around it — the
    // arriving level used to stream in cold at every integer crossing, so its
    // raster fade-in started late mid-gesture instead of on time. One 3x3 per
    // level (gated on level change; cap + hit counting live in prefetchSatTiles).
    // Window rides the journey laws: one level below full-sat (so the +2
    // prefetch lands in-sat) to half a level past the gate (deeper, the
    // staged path owns prewarm) — numerically [8, 12), never bare literals.
    if (!twinOpen && prox && z >= Z_FADE1 - 1 && z < Z_HANDOFF + 0.5) {
      try {
        const zl = Math.floor(z) + 2;
        if (zl !== lastDeepWarmZ) { lastDeepWarmZ = zl; prefetchSatTiles(SITE_LNGLAT, zl); }
        const za = Math.floor(z) + 1;
        if (za !== lastArriveWarmZ) { lastArriveWarmZ = za; prefetchSatTiles(SITE_LNGLAT, za); }
      } catch { /* warm is best-effort */ }
    } else if (lastDeepWarmZ !== -1) {
      lastDeepWarmZ = -1;
      lastArriveWarmZ = -1;
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
          due: isoRestoreDue, src: source,
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
    const busyFlight = !!transitId;
    // Flight-only gate for pitch drivers (scrub, settles): a programmatic
    // flight owns the camera outright, but prewarm/reverse-wait/recede must
    // NOT park pitch — the map is visible through prewarm and the fade, and
    // the tilt has to track the law there (measured: parking on pendingReveal
    // froze pitch at the first slew-capped write for the whole dive).
    // (3) PROXIMITY CENTERING — R11-CENTER: centering is CONTINUOUS now. The
    // band takeover's tick write carries an explicit center derived from
    // the shared center blend, so the spot glides to center coupled to
    // scroll speed with no snap. The old settle jumpTo-center
    // fired inside the visible band (measured 120px snap with the mask up),
    // and every firing was in-band by construction (shouldCenter gates
    // z>=Z_CENTER, where blend>0) — so no settle owns the center anymore.
    // Settles leave the center finger-owned; arrival framing rides the
    // continuous law. Pitch strands keep their owners below (reconcile,
    // catch-up, pump).
    try {
      window.__mapProbe.centerEase = +blend.toFixed(4);
      window.__mapProbe.autoCenter = false;
    } catch { /* probe cosmetic */ }
    // (3b) SETTLE RECONCILE — the strand guarantor. Per-step iso writes can
    // be clobbered mid-glide (the native zoom animation re-applies the
    // gesture-start pitch per frame), so a fast flick-out may land below
    // the band with the tilt still on. If the journey ever owned the tilt
    // (isoRestoreDue) and the gesture settles below the band, glide pitch
    // home on the existing settle tempo. Center is never touched here, and
    // a camera the journey never tilted (due false) is never yanked.
    // Recede-exempt (busyFlight, not busyNow): this glide is pitch-only —
    // it never touches zoom or center — so it cannot fight the gesture-owned
    // z on the way out. Gating it on receding stranded pitch at iso all the
    // way home: the home arrival below clears due with no flattening.
    if (!twinOpen && !busyFlight && source === 'native-zoomend' && isoRestoreDue && !shouldCenter(z)) {
      let pSet = null;
      try {
        pSet = +mapRef.getPitch();
      } catch { pSet = null; }
      if (Number.isFinite(pSet)) {
        if (Math.abs(pSet) > ISO_SETTLE_TOL_DEG) {
          try {
            // Instant flatten (no glide): the below-band law is flat, so this
            // only fires when something left tilt behind — snap it, no timer.
            mapRef.jumpTo({ pitch: 0 });
          } catch (err) {
            errors.push('SETTLE-RECONCILE: ' + (err && err.message));
          }
        } else {
          isoRestoreDue = false;
        }
      }
    }
    // (4) ISO SCRUB — the tilt rides the zoom itself (Z_ISO_START..Z_TOP ->
    // pitch 0..45, held at 45 through the handoff), written straight into the
    // transform so the running scroll glide is never stopped: no latch, no
    // easeTo, no timers. Zoom-out retraces it symmetrically. Ownership: the
    // scrub engages whenever the live pitch sits
    // at/below target (+slack), near or far, so a user-set oblique is never
    // yanked; the settle landing above still zeroes bearing and holds this
    // same target.
    // Once owned, the scrub keeps driving until pitch is restored even if
    // proximity drops (pan-away-then-zoom-out), and the release step itself
    // writes the target — a fast flick-out that jumps clean over the band
    // still zeroes the tilt in the landing step instead of stranding it.
    // Twin paths own the camera while open. Task-37: the gesture recede
    // does NOT block this — pitch 45->0 IS the mirrored checkpoint on the
    // way out, ridden by the same law.
    // GATE-3 REVISION: the scrub owns the tilt from the terrain grade
    // (Z_ISO_START) all the way through the handoff, on the way OUT too. The
    // engagement test used to require z >= Z_TOP, so the terrain->iso motion
    // only started at the last level; it now begins when the satellite is
    // full. The journey owns the tilt if it owned it going in
    // (isoScrubOwned) OR the law currently asks for a non-zero tilt
    // (z >= Z_ISO_START) OR the tilt is still stranded above the law's target
    // (the flatten case). The law is ONE law — pitchTargetForZoom(z) —
    // and it is 0 below the band, so the reverse retraces it exactly.
    if (!twinOpen && !busyFlight && prox && (prox.near || isoScrubOwned || z >= Z_ISO_START || isoRestoreDue)) {
      const pLaw = pitchTargetForZoom(z);
      let pCur = null;
      try {
        pCur = +mapRef.getPitch();
      } catch { pCur = null; }
      if (Number.isFinite(pCur)) {
        let releaseNow = false;
        if (!isoScrubOwned) {
          if (z >= Z_ISO_START && pCur <= pLaw + ISO_SCRUB_SLACK_DEG) {
            isoScrubOwned = true;
            isoRestoreDue = true;
            try {
              pumpIsoPitch(); // per-frame carry from here — cadence-independent tilt
            } catch { /* pump is best-effort */ }
          }
        } else if (z < Z_ISO_START - ISO_SCRUB_RELEASE && Math.abs(pCur) <= ISO_SCRUB_EPS_DEG) {
          // GATE-3 REVISION: the journey releases the tilt only once the law
          // has actually flattened it. The old test released on ZOOM alone
          // (z < Z_TOP - release), which handed the camera back mid-retrace
          // with the tilt still at ISO_PITCH_DEG — the strand. The law is
          // 0 below the band, so the release is now "the law's value is
          // reached", which is the same condition the write enforces.
          isoScrubOwned = false;
          releaseNow = true;
        }
        // Slew cap on the WRITE only (engage/release above still read the
        // pure law, so a user oblique never gets owned): normal scrub steps
        // pass through untouched, flick jumps glide over following steps.
        let pTarget = pLaw;
        const pDelta = pLaw - pCur;
        if (Math.abs(pDelta) > ISO_SCRUB_SLEW_DEG) pTarget = pCur + Math.sign(pDelta) * ISO_SCRUB_SLEW_DEG;
        if ((isoScrubOwned || releaseNow) && Math.abs(pCur - pTarget) > ISO_SCRUB_EPS_DEG) {
          try {
            // Mid-glide this write may be clobbered by the native zoom
            // animation (it re-applies the gesture-start pitch per frame) —
            // never stop the glide for it (stair-steps zoom). The per-frame
            // pump carries the tilt between ticks; the settle
            // reconcile below is the guarantor: isoRestoreDue stays latched
            // until a zoomend glides pitch home.
            // Prefer the public transform when a future maplibre exposes it;
            // at 6.13.0 runtime it is absent (lives at map._camera.transform),
            // so the else leg writes through setLivePitch instead of dropping
            // the tilt (DIM-MATCH: a dropped write strands pitch below the law
            // and the drawn circle disagrees with the plane for the load).
            if (mapRef.transform && typeof mapRef.transform.setPitch === 'function') {
              mapRef.transform.setPitch(pTarget);
              if (typeof mapRef.triggerRepaint === 'function') mapRef.triggerRepaint();
            } else {
              setLivePitch(pTarget);
            }
          } catch (err) {
            errors.push('ISO-SCRUB: ' + (err && err.message));
          }
        }
        try {
          window.__mapProbe.isoBridge = isoScrubOwned;
          window.__mapProbe.pitch = pCur == null ? null : +(+pCur).toFixed(2);
        } catch { /* probe cosmetic */ }
      }
    } else if (isoScrubOwned) {
      isoScrubOwned = false;
      try {
        window.__mapProbe.isoBridge = false;
      } catch { /* probe cosmetic */ }
    }
    // (4b) SETTLE CATCH-UP — the slew cap above can strand pitch mid-band
    // when a flick ends there (no more steps arrive to finish the glide).
    // On settle, finish the tilt the fingers started on the shared settle
    // tempo instead of parking it. Below-band strands ride the reconcile in
    // (3b); near arrivals already rode the center-ease above (same tempo —
    // a second ease here would supersede its center glide, so this covers
    // far settles only). At-target settles no-op here. Zoom is never touched.
    // Recede-exempt like the reconcile above: pitch-only, same settle tempo.
    if (!twinOpen && !busyFlight && source === 'native-zoomend' && isoRestoreDue && shouldCenter(z) && prox && !prox.near) {
      let pCatch = null;
      try {
        pCatch = +mapRef.getPitch();
      } catch { pCatch = null; }
      const pCatchT = pitchTargetForZoom(z);
      if (Number.isFinite(pCatch) && Number.isFinite(pCatchT) && Math.abs(pCatch - pCatchT) > 1) {
        try {
          // Instant catch-up (no glide): exact journeys never reach here
          // (|p-law|<=1 skips); a stale pitch snaps onto the law, no timer.
          mapRef.jumpTo({ pitch: pCatchT });
        } catch (err) {
          errors.push('SETTLE-CATCHUP: ' + (err && err.message));
        }
      }
    }
    if (!twinOpen && !busyNow && z >= Z_TOP) {
      if (!scrubFired) {
        scrubFired = true; // latched now; staging runs next frame (afterFrame)
        // Clamp the ceiling SYNCHRONOUSLY on the latch tick — never deferred
        // to the arrival frame. The old order (setMaxZoom inside the
        // afterFrame arrival) left a one-frame gap where fast wheel ticks
        // deepened native zoom past the handoff while the mask already
        // saturated at the seam: static circle, zooming terrain. setMaxZoom
        // moves no camera, so it is safe mid-gesture. Mirrors the arrival's
        // reduced-motion skip; every abort below restores, so a clamp that
        // never stages never sticks.
        try {
          let reducedLatch = false;
          try {
            reducedLatch = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          } catch { /* cosmetic */ }
          if (!reducedLatch && mapRef && typeof mapRef.setMaxZoom === 'function') {
            mapRef.setMaxZoom(Z_HANDOFF);
          }
        } catch { /* clamp is best-effort */ }
        try {
          window.__mapProbe.deepHandoff = { z: +z.toFixed(2), scrub: +handoffScrubForZoom(z).toFixed(4) };
        } catch { /* probe cosmetic */ }
        afterFrame(() => {
          try {
            if (twinOpen || transitId || receding) { scrubFired = false; restoreMaxZoom(); return; } // twin/staging owns it
            if (!Number.isFinite(mapRef.getZoom()) || mapRef.getZoom() < Z_TOP) { scrubFired = false; restoreMaxZoom(); return; }
            flyToSectorThenTwin(siteSector);
          } catch { /* handoff best-effort */ }
        });
      }
    } else if (z < REARM_DOWN_BELOW && scrubFired && !twinOpen) {
      scrubFired = false; // re-arm: a fresh deep zoom may hand off again
      // Keep tilt ownership until the pitch actually flattened — clearing on
      // zoom alone strands 45deg through the whole reverse (the law below the
      // band is 0; the line-1159 release owns the handoff on pitch, not zoom).
      let rearmFlat = true;
      try {
        const rearmP = mapRef ? +mapRef.getPitch() : NaN;
        rearmFlat = !Number.isFinite(rearmP) || Math.abs(rearmP - pitchTargetForZoom(z)) <= ISO_SETTLE_TOL_DEG;
      } catch { rearmFlat = true; }
      if (rearmFlat) isoScrubOwned = false;
    }
    // S OWNERSHIP: the wheel accumulator owns S after staged entry (the KEEP
    // +100/tick law). S is NOT re-derived from zoom per step: the clamp
    // freezes zoom post-gate, so a zoom law cannot express finger progress
    // where the fingers actually are — and every zoom event would silently
    // discard accumulated wheel intent, making dwell/commit depend on event
    // interleaving instead of either law. The entry seed below maps live
    // zoom onto the reveal band once; the accumulator carries it from there,
    // including the clamped post-gate hold and the reverse retrace.
    // Task-35 staged exit (reverse): zoomend settle below the iso checkpoint
    // unwinds the hold — unclamp, drop accumulated scroll, quietly tear down
    // the uncommitted prewarm. Settle inside the band holds (no-op). Forward
    // exit is twin-ready + S-commit (driveStagedOverlay/finalizeStagedReveal).
    // Round-10: a dive-start boot that retreats below the band before
    // arrival aborts here — frame blanked, overlay re-hidden, map untouched.
    // INTENT-PRECACHE: the boot now arms at the mask arm (z>Z_CENTER, below
    // the old band floor), so the abort keys off intent-loss — the same
    // near && blend>0 predicate — instead of the z-band. Retreating below
    // the mask or drifting off-site aborts; holding intent keeps the boot
    // through the whole pre-iso climb the old floor would have killed.
    if (earlyTwinArmed && !twinOpen && !stagedActive && !pendingReveal && !(prox && prox.near && blend > 0)) {
      try {
        abortEarlyBootTwin();
      } catch { /* abort is best-effort */ }
    }
    // INTENT-LOCK: the hotspot lock engages at intent (the mask arm,
    // near && blend>0, first true just past Z_CENTER) — not at the late
    // staged arm. Snapshot-only freeze (seat=false): the SITE anchor is
    // recorded and pan inputs lock, but the center is NOT seated — the
    // phantom/correctTo writers are already gliding it and seating a fresh
    // ~175px drift here would snap. The staged arm re-freezes with seat=true
    // once drift is ~0. Intent loss releases (same predicate as the boot
    // abort above) so pan restores the moment the journey is abandoned;
    // Esc/close/commit/unwind release through the existing unfreeze sites.
    if (!twinOpen && !transitId && !stagedActive && prox && prox.near && blend > 0) {
      if (!stagedFrozen) {
        try {
          freezeStagedFrame(false);
        } catch { /* intent lock is best-effort */ }
      }
    } else if (stagedFrozen && !stagedActive) {
      try {
        unfreezeStagedFrame();
      } catch { /* intent unlock is best-effort */ }
    }
    if (stagedActive && source === 'native-zoomend' && z < Z_TOP - STAGED_EXIT_BELOW) {
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
        // Same ownership rule as the re-arm above: never park a tilt at world
        // zoom — when the pitch has not flattened yet the flags stay latched
        // so the below-band settle reconcile owns the flatten on zoomend.
        let homeFlat = true;
        try {
          const homeP = mapRef ? +mapRef.getPitch() : NaN;
          homeFlat = !Number.isFinite(homeP) || Math.abs(homeP) <= ISO_SETTLE_TOL_DEG;
        } catch { homeFlat = true; }
        if (homeFlat) {
          isoScrubOwned = false;
          isoRestoreDue = false;
        }
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
    // HARD-STOP presentation: loader + ceiling track the mask/content gate on
    // every zoom tick (re-freezes the ceiling as reverse descends, releases
    // on grant). Reverse never stalls — this only presents.
    try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
  } catch (err) {
    errors.push('ZOOM-STEP: ' + (err && err.message));
  }
}
/** Reset the journey after a close lands home (progress + edge re-arm). */
function resetScrubJourney() {
  scrubProgress = 0;
  scrubFired = false;
  isoScrubOwned = false;
  isoRestoreDue = false;
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
const PRECACHE_MAX_TILES = 128; // cap the warm image cache: the journey crosses integer zooms 6..11 at two centers plus deep-warm levels, ~54 tiles before headroom
const satTileSeen = new Set(); // url -> warm (insertion-ordered oldest-first evict)
let precachePrefetched = 0;
let precacheHits = 0;
let lastPrecProgP = 0;
let lastPrecT = 0;
let precVel = 0; // journey progress per second (EMA)
let lastPrefetchPred = -1;
let lastPrefetchT = 0;
let lastPrecLevel = -1; // live integer zoom already gated: crossings prefetch even when the prediction barely moved
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
    // CACHE-FAST hotspot-first: the center tile (the dive target) heads the
    // patch so it wins the connection race; the ring follows. Order only —
    // same 9 URLs, same cap, same dedupe.
    const order = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of order) {
      const x = t.x + dx;
      const y = t.y + dy;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= n || y >= n) continue;
      urls.push({ url: satTileUrl(z, x, y), hot: dx === 0 && dy === 0 });
    }
    try {
      window.__mapProbe.precache.tiles = { z, x: t.x, y: t.y, n: urls.length };
    } catch { /* probe cosmetic */ }
    for (const { url, hot } of urls) {
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
          // CACHE-FAST: the hotspot tile loads first (high), the ring deprioritized (low) so speculative warms never contend the live frame.
          try { img.fetchPriority = hot ? 'high' : 'low'; } catch { /* priority hint is best-effort */ }
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
    // Reversal reset: the EMA still predicts the old direction for 2-3 ticks
    // after the fingers turn, prefetching the wrong level while the true one
    // faults cold — drop it on a signed direction flip.
    if (Number.isFinite(inst) && Number.isFinite(precVel) && inst !== 0 && Math.sign(inst) !== Math.sign(precVel) && Math.abs(inst) > 0.05) precVel = 0;
    precVel = Number.isFinite(inst) ? precVel * 0.6 + inst * 0.4 : precVel * 0.6;
    if (!Number.isFinite(precVel)) precVel = 0;
    lastPrecT = now;
    lastPrecProgP = p;
    const pPred = clamp01(p + precVel * PRECACHE_LOOKAHEAD_S);
    try {
      window.__mapProbe.precache.predicted = +pPred.toFixed(4);
      window.__mapProbe.precache.velocity = +precVel.toFixed(4);
    } catch { /* probe cosmetic */ }
    // Integer-crossing trigger: tile swaps happen at whole zooms, so a slow
    // scroll that barely moves the prediction still prefetches the new level.
    let levelNow = -1;
    try {
      const lz = mapRef ? +mapRef.getZoom() : NaN;
      if (Number.isFinite(lz)) levelNow = Math.floor(lz);
    } catch { levelNow = -1; }
    if (Math.abs(pPred - lastPrefetchPred) >= PRECACHE_MIN_P_DELTA || now - lastPrefetchT >= PRECACHE_MIN_MS || levelNow !== lastPrecLevel) {
      lastPrefetchPred = pPred;
      lastPrefetchT = now;
      lastPrecLevel = levelNow;
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
    restoreMaxZoom(); // latch may have clamped a frame earlier — an unstaged open must never inherit it
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
  // Staging starts at the ISO checkpoint (Z_TOP), not the final handoff: the
  // terrain->iso motion is already complete there, so the twin prewarm and the
  // iso->twin dissolve get a full zoom level to run instead of starting after
  // the map has already clamped. Click/fallback entries below Z_TOP keep the
  // discrete jump path.
  const deep = Number.isFinite(liveZ) && liveZ >= Z_TOP;
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
        else mapRef.fitBounds(bounds, { bearing: 0, pitch: 0, duration: 0, padding: wideFitPadding(), maxZoom: Z_MAX });
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
    const proxNow = proximityInfo();
    const nearNow = !!(proxNow && proxNow.near);
    // Reduced-motion never stages (no scroll-driven dissolve to follow) —
    // the unstaged prewarm below reveals instantly inside prewarmThenReveal.
    // Read here (hoisted above the wash write) so the wash decision knows
    // the path: staged arrivals wash now, unstaged arrivals defer to the
    // reveal tick (MASK-SYNC co-fire in revealTwin).
    let reducedMotion = false;
    try {
      reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch { /* cosmetic */ }
    // Wash only when ARMED: re-derive the center from the live projection and
    // require the proximity predicate. An off-screen arrival (zoom-around-
    // cursor can park the spot 100k+ px out) skips the wash — never the
    // handoff below. Showing the wash on a stale/off-screen center blacks
    // the frame in one tick; the per-step driver keeps writing live values,
    // so the wash appears honestly the moment the spot is near.
    // MASK-SYNC: STAGED arrivals wash now — the S scrub owns the joint
    // mask+twin motion from the first post-gate tick. UNSTAGED arrivals
    // defer the wash to the reveal tick: revealTwin co-fires it (live-near
    // gated), so the 450ms mask fade and the 450ms twin crossfade start on
    // the same tick as one motion instead of the mask parking seconds
    // before the twin-ready/fallback timer fires the twin.
    if (nearNow) {
      try {
        // Wash opens at the true radius after jumps — never the stale size or
        // the 260px initial. The return is cached as the staged-entry radii:
        // the hold ring blends entry->seam on scroll (no snap when arrival
        // lands below the handoff).
        const entry = writeEnclosureEllipse(proxNow, Number.isFinite(liveZ) ? liveZ : Z_HANDOFF);
        try {
          entryRx = entry && Number.isFinite(entry.rx) ? +entry.rx.toFixed(1) : null;
          entryRy = entry && Number.isFinite(entry.ry) ? +entry.ry.toFixed(1) : null;
        } catch { /* entry cache is best-effort */ }
      } catch { /* radii re-derive is best-effort */ }
      if (deep && !reducedMotion) showVignette(true);
    }
    // Handoff-5-close: publish the staged zoom for the framing probe.
    try {
      window.__mapProbe.mapZoom = liveFrame()?.z ?? null;
    } catch { /* probe cosmetic */ }
    // Arrival owns staging (synchronous — no 180ms settle, no 3500ms moveend
    // fallback). Near the hotspot the hold becomes STAGED: z clamps at the
    // gate and further scroll ticks accumulate as stage advances (the twin-
    // ready message + zoomend settle are the only exits). Far away there is
    // nothing to hold against — stage unstaged, reveal on twin-ready as
    // before, native zoom untouched.
    try {
      window.__mapProbe.deepHandoff = Number.isFinite(liveZ)
        ? { z: +liveZ.toFixed(2), scrub: +handoffScrubForZoom(liveZ).toFixed(4), staged: deep && !reducedMotion }
        : null;
    } catch { /* probe cosmetic */ }
    // GATE-3 REVISION: the DEEP arrival clamps REGARDLESS of `near`.
    // `near` decided only whether the WASH shows (a separate, correct
    // behaviour — the surround stays proximity-armed). It must NOT decide
    // whether the handoff is clamped: an off-centre arrival skipped the
    // clamp, native zoom ran free to z 12.1-13.4, and the twin revealed
    // with the site outside the frame. The clamp is a ZOOM CEILING, not a
    // proximity behaviour — the staged hold is the only thing that owns
    // the extra scroll past the gate.
    if (deep && !reducedMotion) {
      // Off-centre arrivals skip the wash write above (nearNow false), so a
      // stale entry from an older arrival must not steer this hold — clear it
      // and the ring parks the seam (previous behaviour, still synced: zoom
      // is static while the hold owns the frame).
      if (!nearNow) {
        entryRx = null;
        entryRy = null;
      }
      try {
        if (mapRef && typeof mapRef.setMaxZoom === 'function') mapRef.setMaxZoom(Z_HANDOFF);
      } catch { /* clamp is best-effort */ }
      stagedActive = true;
      try {
        freezeStagedFrame(); // MAP FRAME FREEZE: snapshot anchor + kill pan drift
      } catch { /* freeze is best-effort */ }
      // Seed S from the LIVE zoom, not the band start: a fast wheel burst can
      // arrive at 11.5 in one step, and there may be no further zoom step to
      // drive the band. MASK-SYNC: the seed spans the FULL S band (0 at the
      // iso checkpoint, S_MAX at the gate) because the reveal now dissolves
      // across the whole hold — seeding into a sub-band would replay the old
      // 0->0.74 jump on the first staged tick. The overlay is a pure function
      // of S, so a deep arrival already holds its matching partial dissolve
      // on the first drive tick instead of stalling at 0 while the twin
      // boots.
      // The twin intro is scroll-scrubbed to the same S (postTwinStagedS +
      // the grant-time re-emit), so a zeroed hold replays as matching stillness
      // on both sides — and scroll-up retraces it symmetrically through
      // accumStagedS once the twin holds content.
      const tSeed = clamp01(
        ((Number.isFinite(liveZ) ? liveZ : Z_TOP) - Z_TOP) / (Z_HANDOFF - Z_TOP),
      );
      stagedS = HANDOFF_STAGED_S_MAX * smooth01(tSeed);
      // HARD-STOP: hold at zero — arrival re-hands the frame (reload resets
      // content), so the continuity seed above is stale by construction and
      // would paint a mid-dissolve jump on first content. Park S at 0;
      // forward ticks stall there until the twin holds content
      // (feedStagedScroll) and the loader shows. The scrub laws are
      // untouched — only the seeded start value is held.
      stagedS = 0;
      try { window.__mapProbe.stallSeedHeld = true; } catch { /* probe cosmetic */ }
      // HARD-STOP: the staged clamp supersedes any pre-gate ceiling freeze.
      stallCeilingOn = false;
      // HARD-STOP: no parked seed — S opens at 0 and the first drive tick
      // paints the hold (not a partial dissolve) while the twin boots. The
      // twin intro is scroll-scrubbed to the same S (postTwinStagedS + the
      // grant-time re-emit), so the hold replays as matching stillness on
      // both sides — and scroll-up retraces it symmetrically through
      // accumStagedS once the twin holds content.
      stagedCommitted = false;
      lastPostedStagedS = null; // Task-37: the S producer re-arms (S=0 posts on first drive)
      // HARD-STOP: arm the long bounded tiles hold (shares HARD_STOP_HOLD_MS).
      try {
        stagedTilesT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      } catch { try { stagedTilesT0 = Date.now(); } catch { stagedTilesT0 = 0; } }
      stagedTilesGranted = false; // HYSTERESIS: re-entry restages cold — the old grant died with the reloaded frame
      try {
        pumpIsoPitch(); // live-hold carry: keep the per-frame tilt pump running under the clamp (it now converges the S-driven hold tilt, never parks on the prewarm)
      } catch { /* pump is best-effort */ }
      try {
        window.__mapProbe.staged = { active: true, s: 0, committed: false };
      } catch { /* probe cosmetic */ }
      // CENTER CONVERGENCE: the twin boots on the hotspot by construction
      // (handed cx/cy = SITE, the mask center) — never the drifted live
      // camera — so the dissolve superimposes with zero lateral offset.
      // The S-glide (driveStagedHold b2) slides the live map onto the same
      // point over the hold; the release re-derivation (round-8) already
      // re-seats range from the grant-time zoom.
      const stagedFrame = liveFrame();
      if (stagedFrame) {
        stagedFrame.cx = SITE_LNGLAT[0];
        stagedFrame.cy = SITE_LNGLAT[1];
      }
      prewarmThenReveal(id, stagedFrame || liveFrame(), { ...opts, staged: true });
      // HARD-STOP idle poll: one fallback slide so content detection retries
      // even with no scroll ticks (the staged branch never blind-reveals;
      // each fire re-drives the frozen hold and refreshes the loader, so the
      // pill clears when content lands even if the fingers are still).
      try { armRevealFallback(); } catch { /* poll is best-effort */ }
      try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
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

/** MAP FRAME FREEZE (lane super-map): staging-arm camera lock.
 * The handed URL frame is read once at the prewarm build, but the twin boots
 * on it only at the grant — and the center keeps drifting in between (drag /
 * pinch pan, lock-anchored wheel clones) while the zoom clamp holds depth.
 * So the arm snapshots the full anchor (center/zoom/pitch/bearing) and
 * disables finger panning for the hold; the grant re-asserts the anchor
 * (reassertStagedAnchor) instead of trusting the live camera; the commit and
 * unwind paths release the lock. Zoom stays clamped (existing maxZoom) and
 * pitch stays on the law (frozen zoom = frozen pitch) — only pan needed a
 * lock. Idempotent; never throws.
 * seat=false (intent-lock): snapshot the SITE anchor + lock pan inputs
 * WITHOUT seating the center — the phantom/correctTo writers are already
 * gliding it (seating here would snap ~175px). The arm re-freezes with
 * seat=true once drift is ~0. Pan-only inputs lock here (drag + box);
 * pinch/keyboard stay live so depth gestures keep working pre-arm. */
let stagedAnchor = null;
let stagedFrozen = false;
// Arrival-seat record: the live camera center at freeze (kept for the probe;
// the LOCK-EARLY pin seats the map on SITE directly, so no glide reads it).
let stagedFreezeCenter = null;
function freezeStagedFrame(seat = true) {
  try {
    if (mapRef) {
      let c = null;
      let z = null;
      let p = null;
      let b = null;
      try { c = mapRef.getCenter(); } catch { c = null; }
      try { z = +mapRef.getZoom(); } catch { z = null; }
      try { p = +mapRef.getPitch(); } catch { p = null; }
      try { b = +mapRef.getBearing(); } catch { b = null; }
      if (c && Number.isFinite(+c.lng) && Number.isFinite(+c.lat)) {
        const zz = Number.isFinite(z) ? z : Z_HANDOFF;
        stagedAnchor = {
          // CENTER CONVERGENCE: the anchor sits ON the hotspot by
          // construction — the mask writes the anchor projection and the
          // twin boots on the handed anchor frame, so mask center and twin
          // center agree even for off-centre arrivals (never the drifted
          // live camera). Zoom/pitch/bearing stay live (depth + tilt laws
          // own those); only pan needed the lock.
          site: true,
          cx: SITE_LNGLAT[0],
          cy: SITE_LNGLAT[1],
          z: zz,
          pitch: Number.isFinite(p) ? p : pitchTargetForZoom(zz),
          bearing: Number.isFinite(b) ? b : 0,
          intent: seat ? undefined : true,
        };
        stagedFreezeCenter = { lng: +c.lng, lat: +c.lat };
      }
      try { if (mapRef.dragPan) mapRef.dragPan.disable(); } catch { /* lock best-effort */ }
      try { if (mapRef.boxZoom) mapRef.boxZoom.disable(); } catch { /* lock best-effort */ }
      if (seat) {
        try { if (mapRef.touchZoomRotate) mapRef.touchZoomRotate.disable(); } catch { /* lock best-effort */ }
        try { if (mapRef.keyboard) mapRef.keyboard.disable(); } catch { /* lock best-effort */ }
      }
      // LOCK-EARLY lock tick: recenter onto the SITE anchor AS the hold arms
      // (not at S-max recovery) — the twin boots on this frame, so lock-in
      // happens on the first staged tick. jumpTo is instant (scroll-pure, no
      // timer); an aimed arrival already sits here, so this is a no-op
      // correction, and the S-max re-park below stays the invisible backstop.
      // Intent-lock (seat=false) skips the seating: the glide owns the
      // center and seating a ~175px drift here would snap.
      if (seat) {
        try { if (mapRef && stagedAnchor) mapRef.jumpTo({ center: SITE_LNGLAT }); } catch { /* lock tick is best-effort */ }
      }
    }
  } catch { /* freeze never breaks staging */ }
  stagedFrozen = true;
  try {
    window.__mapProbe.stagedFreeze = stagedAnchor ? { ...stagedAnchor } : false;
  } catch { /* probe cosmetic */ }
}

/** Grant-time re-hand: snap the map back onto the staged anchor when drift is
 * detected (center >2px or zoom >0.02 off), so the twin boots on the true end
 * pose — the handed URL frame. Pitch/bearing ride the frozen law and are
 * never touched here. Returns drift px (>=0) or -1 when unreadable. */
function reassertStagedAnchor(reason) {
  let driftPx = -1;
  let reasserted = false;
  try {
    if (!stagedAnchor || !mapRef) return -1;
    let c = null;
    let z = null;
    try { c = mapRef.getCenter(); } catch { c = null; }
    try { z = +mapRef.getZoom(); } catch { z = null; }
    if (!c || !Number.isFinite(+c.lng) || !Number.isFinite(+c.lat)) return -1;
    try {
      const pa = mapRef.project([stagedAnchor.cx, stagedAnchor.cy]);
      const pl = mapRef.project([+c.lng, +c.lat]);
      if (pa && pl && Number.isFinite(+pa.x) && Number.isFinite(+pa.y) && Number.isFinite(+pl.x) && Number.isFinite(+pl.y)) {
        driftPx = Math.hypot(pa.x - pl.x, pa.y - pl.y);
      }
    } catch { /* measure best-effort */ }
    const zDrift = Number.isFinite(z) && Number.isFinite(stagedAnchor.z)
      ? Math.abs(z - stagedAnchor.z) : 0;
    if ((driftPx >= 0 && driftPx > 2) || zDrift > 0.02) {
      try {
        if (stagedActive && stagedAnchor && stagedAnchor.site) {
          // CENTER CONVERGENCE: the S-glide owns centering mid-hold (it
          // converges the arrival center onto the hotspot as a pure fn of
          // S) — a center snap here would replay the lateral offset the
          // glide removes. Correct depth only; leave pan to the glide.
          if (zDrift > 0.02) mapRef.jumpTo({ zoom: stagedAnchor.z });
        } else {
          mapRef.jumpTo({ center: [stagedAnchor.cx, stagedAnchor.cy], zoom: stagedAnchor.z });
        }
      } catch { /* re-assert is best-effort */ }
      reasserted = true;
    }
  } catch { /* re-hand never breaks the grant */ }
  try {
    const prev = window.__mapProbe.stagedFreeze;
    if (!(prev && prev.reasserted)) {
      window.__mapProbe.stagedFreeze = {
        ...(stagedAnchor || {}),
        driftPx: driftPx >= 0 ? +driftPx.toFixed(1) : null,
        reasserted,
        reason: reason || null,
      };
    }
  } catch { /* probe cosmetic */ }
  return driftPx;
}

/** Release the staging-arm camera lock (commit + unwind paths). */
function unfreezeStagedFrame() {
  stagedFrozen = false;
  stagedAnchor = null;
  stagedFreezeCenter = null; // S-glide source dies with the anchor
  try {
    if (mapRef) {
      try { if (mapRef.dragPan) mapRef.dragPan.enable(); } catch { /* unlock best-effort */ }
      try { if (mapRef.touchZoomRotate) mapRef.touchZoomRotate.enable(); } catch { /* unlock best-effort */ }
      try { if (mapRef.boxZoom) mapRef.boxZoom.enable(); } catch { /* unlock best-effort */ }
      try { if (mapRef.keyboard) mapRef.keyboard.enable(); } catch { /* unlock best-effort */ }
    }
  } catch { /* unlock never breaks teardown */ }
  try {
    window.__mapProbe.stagedFreeze = false;
  } catch { /* probe cosmetic */ }
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
    let nowPost = 0;
    try {
      nowPost = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    } catch { nowPost = Date.now(); }
    if (nowPost - lastStagedPostT < 60) return false;
    const fr = overlayEls && overlayEls.frame;
    if (!fr || fr.getAttribute('data-url') === 'about:blank') return false;
    const win = fr.contentWindow;
    if (!win) return false;
    // Round-8: ride the live zoom along — the twin recomputes its release
    // anchors from the grant-time post (the park ride stale-dates the
    // arrival frame). Best-effort: a missing zoom still posts S.
    let zPost = null;
    try { zPost = mapRef ? +mapRef.getZoom() : null; } catch { zPost = null; }
    win.postMessage(buildTwinStagedMessage(s, zPost), '*');
    lastPostedStagedS = s;
    lastStagedPostT = nowPost;
    try {
      window.__mapProbe.stagedPost = +s.toFixed(1);
    } catch { /* probe cosmetic */ }
    return true;
  } catch {
    return false;
  }
}

/** Live-hold travel: apply the S stages to VISIBLE map chrome on every staged
 * tick — ready or not. The zoom clamp freezes every zoom-keyed law while the
 * twin boots, so without this each wheel tick paints nothing until first
 * paint (the dead hold). Tilt creeps past the pole under the fingers (owned
 * tilt only — a user oblique is never yanked) and the enclosure circle closes
 * onto the ring; both are pure fns of S, so scroll-up retraces them, and the
 * tilt extra relaxes to 0 across the reveal band so the commit still meets
 * the twin iso pole exactly. Satellite holds full (both laws agree it is 1
 * here — glued to the fingers, never to the clamped z). Best-effort
 * throughout; never throws. */
function driveStagedHold(st) {
  let pitchExtra = 0;
  let ringClose = 0;
  try {
    pitchExtra = stagedHoldPitchForS(stagedS);
  } catch { pitchExtra = 0; }
  try {
    ringClose = stagedHoldRingCloseForS(stagedS);
  } catch { ringClose = 0; }
  // (a) tilt travel past the pole — journey-owned tilt only.
  try {
    if (mapRef && isoScrubOwned) {
      let zNow = null;
      try {
        zNow = +mapRef.getZoom();
      } catch { zNow = null; }
      const base = pitchTargetForZoom(Number.isFinite(zNow) ? zNow : Z_HANDOFF);
      const target = base + pitchExtra;
      let cur = null;
      try {
        cur = +mapRef.getPitch();
      } catch { cur = null; }
      if (Number.isFinite(cur) && Math.abs(cur - target) > ISO_SCRUB_EPS_DEG) {
        setLivePitch(target);
      }
    }
  } catch { /* hold tilt is best-effort */ }
  // (b) ring travel: the hold ring blends the ARRIVAL's live radii onto the
  // seam across the reveal band (st.reveal 0..1 — the same S the twin
  // dissolves on), instead of snapping to the handoff constant on the first
  // staged tick. Arrivals below the handoff (the normal case — the edge
  // fires at Z_TOP) open at their true size and the circle breathes closed
  // onto the twin clip AS the twin dissolves in: mask and map stay in
  // lockstep because both are pure functions of scroll (S for the ring, the
  // clamped zoom for everything else — nothing moves on a timer). At/above-
  // handoff entries open on the seam already (entry==seam, zero behaviour
  // change); scroll-up retraces the blend symmetrically. The staged ring law
  // still rides through the (1 - ringClose) multiplier (zero today).
  try {
    const app = document.getElementById('app');
    if (app && mapRef) {
      // Reveal continuity: while the twin is still booting (pre-grant), the
      // blend's entry endpoint tracks the live zoom — the ceiling clamps at
      // 11.5 but zoom still travels under it (measured 10.94->11.48 over 3
      // ticks with the ring frozen at 286: static circle, zooming terrain =
      // the owner's report). Refreshing the entry from the live law keeps
      // blend==driver==zoom; at grant the entry freezes and the S-sweep
      // continues from exactly what the ring shows.
      try {
        const grantedHold = !!(window.__mapProbe && (window.__mapProbe.twinReady || window.__mapProbe.twinPainted));
        if (!grantedHold) {
          let zLive = NaN;
          try { zLive = +mapRef.getZoom(); } catch { zLive = NaN; }
          const proxLive = proximityInfo();
          if (Number.isFinite(zLive) && proxLive) {
            if (proxLive.near) {
              const e = writeEnclosureEllipse(proxLive, zLive);
              if (e && Number.isFinite(e.rx) && e.rx > 0) { entryRx = +e.rx.toFixed(1); entryRy = +e.ry.toFixed(1); }
            } else {
              // Off-centre: the spot clamps to the viewport via the SINGLE
              // RADIUS LAW corner (viewportCornerPx, shared with the live
              // enclosure writer above) — bounded, smooth, and tracking zoom
              // with the spot clamped to the viewport (converges exact as
              // t->1). Center stays parked at last-near (untouched here, as
              // before) — the live writer above owns the anchor center.
              let cw = 0, chh = 0;
              try {
                const el = mapRef.getContainer();
                cw = (el && el.clientWidth) || window.innerWidth || 800;
                chh = (el && el.clientHeight) || window.innerHeight || 600;
              } catch { cw = 800; chh = 600; }
              const corner = viewportCornerPx(proxLive.sx, proxLive.sy, cw, chh);
              const ec = enclosureEllipsePxForZoom(zLive, SITE.lat, MAP_VIGNETTE_RING_M, corner);
              if (ec && Number.isFinite(ec.rx) && ec.rx > 0) { entryRx = +ec.rx.toFixed(1); entryRy = +ec.ry.toFixed(1); }
            }
          }
        }
      } catch { /* entry refresh is best-effort; stale entry still blends */ }
      const seam = seamHoldEllipseForS(stagedS);
      if (seam && Number.isFinite(seam.rx) && Number.isFinite(seam.ry) && seam.rx > 0) {
        const rev = clamp01(st && Number.isFinite(st.reveal) ? st.reveal : 0);
        const eRx = Number.isFinite(entryRx) && entryRx > 0 ? entryRx : seam.rx;
        const eRy = Number.isFinite(entryRy) && entryRy > 0 ? entryRy : seam.ry;
        const rx = (eRx * (1 - rev) + seam.rx * rev) * (1 - ringClose);
        const ry = (eRy * (1 - rev) + seam.ry * rev) * (1 - ringClose);
        const holdVr = rx.toFixed(1) + 'px';
        const holdVrY = ry.toFixed(1) + 'px';
        if (lastVrWritten !== holdVr) { app.style.setProperty('--vr', holdVr); lastVrWritten = holdVr; }
        if (lastVrYWritten !== holdVrY) { app.style.setProperty('--vr-y', holdVrY); lastVrYWritten = holdVrY; }
        try {
          window.__mapProbe.vignetteR = +rx.toFixed(1);
          window.__mapProbe.vignetteRy = +ry.toFixed(1);
        } catch { /* probe cosmetic */ }
      }
    }
  } catch { /* hold ring is best-effort */ }
  // (b2) LOCK-EARLY hard center pin: after lock-in the map stays on the SITE
  // anchor on EVERY staged tick — no pan possible. This replaces the old
  // S-glide (arrival seat -> hotspot as a fn of reveal): centering now lands
  // at the arm tick, so mid-hold the frame is pinned, not travelled. Any
  // drift (a drag that beat the handler lock, a synthetic panBy/jumpTo, a
  // settle correction) is re-seated here, and scroll-up unwinds through
  // exitStaged, never through this pin. jumpTo is instant (scroll-pure, no
  // timers). The S-max recovery re-park stays the invisible backstop.
  try {
    if (mapRef && stagedActive && stagedAnchor && stagedAnchor.site) {
      try { mapRef.jumpTo({ center: [stagedAnchor.cx, stagedAnchor.cy] }); } catch { /* pin is best-effort */ }
    }
  } catch { /* center pin never breaks the hold */ }
  // (c) satellite rides the same S progress as the overlay (the staged blend
  // stage holds full sat): glued to the fingers through the hold, never to
  // the clamped z both laws agree on anyway.
  try {
    let zNow = null;
    try {
      zNow = mapRef ? +mapRef.getZoom() : null;
    } catch { zNow = null; }
    const zSat = Number.isFinite(zNow) ? satOpacityForZoom(zNow) : 1;
    setSatScrubbed(Math.max(zSat, st.blend));
  } catch { /* sat stage is best-effort */ }
  return { pitchExtra, ringClose };
}

/** Drive the staged overlay dissolve from accumulated scroll S. Twin TILE
 * readiness GRANTS the ramp (opacity stays 0 until the twin holds real
 * tiles, then follows the law); past a bounded hold the ramp releases
 * anyway, flagged, so dead frames never stall the fingers. The S law owns
 * the progress — a fast twin still dissolves on the fingers, never its own
 * rhythm — so the law stays a pure function of S and only the written
 * opacity is gated. At full reveal the hold commits (finalizeStagedReveal).
 * Pure-law in, DOM out. */
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
  // R11-FADE: one writer for every S-owned opacity value. The scrubbed leg
  // below suspends the CSS transition (`.scrubbing`) — but the HOLD legs
  // above ran under the live 0.45s transition, so each hold write restarted
  // an ease between committed values and the rendered opacity lagged the
  // law. Every value here derives from S (holds pin the law's 0 floor, the
  // dissolve writes the law, the commit pre-writes the law's clamp), so all
  // of them go through this helper: transition suspended first, then the
  // synchronous inline write. Rendered IS the law on every tick.
  const scrubWrite = (v) => {
    try {
      if (!root.classList.contains('scrubbing')) root.classList.add('scrubbing');
      const s = String(v);
      if (root.style.opacity !== s) root.style.opacity = s;
    } catch { /* cosmetic */ }
  };
  let ready = false;
  try {
    ready = !!window.__mapProbe.twinReady || !!window.__mapProbe.twinPainted;
  } catch {
    ready = false;
  }
  // HARD-STOP: the ramp gates on twin TILE readiness, not on the
  // ready/painted listener grants — those only prove the twin is alive, and
  // a painted-but-tileless boot is the exact ghost (dissolve over a dark,
  // untextured frame). The S law above stays pure (probe .reveal still
  // reports it); only the WRITTEN opacity is gated: 0 until the twin holds
  // real tiles, then the law. Forward S itself stalls at the feeder
  // (feedStagedScroll) while tilesHold, so the hold is a true zero-hold, not
  // a 0 ramp under a running S. Past STAGED_TILES_HOLD_MS (the long
  // HARD_STOP_HOLD_MS bound) the hold releases anyway (tilesFallback,
  // flagged) so a dead frame can never trap the fingers — the commit below
  // still requires content, and the silent-twin unwind chain still owns the
  // dead-frame exit. Reverse never consults any of this.
  let tilesReady = false;
  try {
    tilesReady = twinFrameHasContent();
  } catch { tilesReady = false; }
  let tilesWaitMs = 0;
  try {
    const nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    tilesWaitMs = stagedTilesT0 > 0 ? Math.max(0, nowT - stagedTilesT0) : 0;
  } catch { tilesWaitMs = 0; }
  const tilesFallback = tilesWaitMs > STAGED_TILES_HOLD_MS;
  // READINESS-HYSTERESIS: the grant latches — first content (or the fallback
  // escape) releases the hold for the life of this staged hold, so
  // mid-dissolve tile gaps (camera moves => mapIdle false for a few frames)
  // never re-arm it and the written opacity never flaps 0<->law. Pre-grant
  // the hold is a true zero (ov=0); the commit below still samples LIVE
  // content, so the latch can never commit a blank twin.
  if (tilesReady || tilesFallback) stagedTilesGranted = true;
  const tilesHold = !stagedTilesGranted;
  // Effective ramp: the law when granted, 0 while held. Single writer: every
  // opacity value on this path goes through scrubWrite (transition suspended,
  // synchronous inline write) — revealTwin's timed leg is barred mid-hold
  // (see its guard), so no second writer can ease against the law.
  const effReveal = tilesHold ? 0 : st.reveal;
  let released = false;
  try {
    released = twinReleased();
  } catch {
    released = false;
  }
  try {
    window.__mapProbe.staged = {
      active: true,
      s: +stagedS.toFixed(1),
      ring: +st.ring.toFixed(4),
      blend: +st.blend.toFixed(4),
      tilt: +st.tilt.toFixed(4),
      reveal: +st.reveal.toFixed(4),
      eff: +effReveal.toFixed(4),
      ready,
      released,
      committed: false,
      tilesReady,
      tilesHold,
      tilesFallback,
      tilesGranted: stagedTilesGranted,
      tilesWaitMs: Math.round(tilesWaitMs),
    };
  } catch { /* probe cosmetic */ }
  // HARD-STOP presentation: loader + ceiling + probe track the content gate
  // on every drive (holds while tileless, clears on grant even if idle).
  try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
  // Live-hold travel FIRST — every S tick moves the frame even while the
  // twin is dark (pre-grant). The grant below gates only the overlay
  // dissolve, never finger motion.
  let hold = null;
  try {
    hold = driveStagedHold(st);
  } catch { /* hold travel is best-effort */ }
  try {
    window.__mapProbe.staged.holdPitch = hold ? +hold.pitchExtra.toFixed(3) : 0;
    window.__mapProbe.staged.ringClose = hold ? +hold.ringClose.toFixed(4) : 0;
  } catch { /* probe cosmetic */ }
  // HARD-STOP: the ramp holds at 0 while the twin is tileless — forward S
  // stalls at the feeder (feedStagedScroll) so the fingers hold still with
  // it; only the overlay opacity waits. Reverse still drains and retraces.
  // Falling through writes the EFFECTIVE ramp (law when granted, 0 held).
  // Commit gate (gaps direction: near-and-non-blank): the fingers dissolved
  // the twin to full, but the commit lands only when the map side is still
  // NEAR the staged frame and the twin holds REAL CONTENT. `ready` only
  // proves the twin LISTENER is alive, not that it drew anything — a
  // painted-but-black overlay is the exact failure (off-centre runs: the
  // twin canvas held 97.4% #0b0c0c, luma 94.7 -> 15.7, and never
  // recovered). Nearness is two-sided: proximity-near (the spot reads near
  // cursor or canvas center — an off-frame commit lands the mixed-rectangle
  // cut) and scale-near (live zoom still at the handoff gate — the clamp
  // holds it there; drift means the ceiling lost and S no longer matches
  // the staged frame). A failed gate HOLDS the map at opacity 0 and retries
  // on the next tick/timer — never commits blind, never strands.
  if (st.reveal >= 1) {
    const hasContent = twinFrameHasContent();
    let proxNear = false;
    try {
      const proxGate = proximityInfo();
      proxNear = !!(proxGate && proxGate.near);
    } catch { proxNear = false; }
    let scaleNear = false;
    try {
      const zGate = mapRef ? +mapRef.getZoom() : NaN;
      scaleNear = Number.isFinite(zGate) && Math.abs(zGate - Z_HANDOFF) <= STAGED_COMMIT_Z_TOL;
    } catch { scaleNear = false; }
    if (!hasContent) {
      scrubWrite(String(+effReveal.toFixed(4))); // blank guard HOLDS the effective ramp — via the one writer (no transition). While the tiles hold is armed this is 0 (nothing dissolved yet, so no snap to replay); past the fallback it holds the law and the silent-twin chain owns the exit.
      try {
        window.__mapProbe.staged.blankTwin = true;
        window.__mapProbe.staged.notNear = !proxNear;
        window.__mapProbe.staged.scaleFar = !scaleNear;
      } catch { /* probe cosmetic */ }
      return; // no commit — hold the map, retry when the twin reports content
    }
    if (!proxNear || !scaleNear) {
      // NEAR-FAIL RECOVERY: S is maxed and the overlay is opaque (the map is
      // hidden), so a recenter is invisible. Re-park the map onto the staged
      // anchor (SITE by construction) instead of stranding uncommitted with
      // no recovery: the next tick reads near and the commit lands.
      // Single-shot by construction (the post-jump drift reads ~0, so the
      // jump arm goes quiet). Never commits blind — the gates below still
      // decide on the retried tick.
      let recovered = false;
      try {
        const ax = stagedAnchor && Number.isFinite(stagedAnchor.cx) ? stagedAnchor.cx : SITE_LNGLAT[0];
        const ay = stagedAnchor && Number.isFinite(stagedAnchor.cy) ? stagedAnchor.cy : SITE_LNGLAT[1];
        if (mapRef && typeof mapRef.jumpTo === 'function' && (!proxNear || !scaleNear)) {
          const jump = {};
          if (!proxNear) jump.center = [ax, ay];
          if (!scaleNear && stagedAnchor && Number.isFinite(stagedAnchor.z)) jump.zoom = stagedAnchor.z;
          if (jump.center || jump.zoom) {
            mapRef.jumpTo(jump);
            recovered = true;
          }
        }
      } catch { /* recovery never breaks the hold */ }
      scrubWrite(String(+effReveal.toFixed(4))); // near-guard HOLDS the effective ramp — via the one writer (no transition). Same hold semantics as the blank guard above.
      try {
        window.__mapProbe.staged.blankTwin = false;
        window.__mapProbe.staged.notNear = !proxNear;
        window.__mapProbe.staged.scaleFar = !scaleNear;
        window.__mapProbe.staged.recovering = recovered;
      } catch { /* probe cosmetic */ }
      return; // no commit — hold the map, retry when the frame is near again
    }
    try {
      window.__mapProbe.staged.blankTwin = false;
      window.__mapProbe.staged.notNear = false;
      window.__mapProbe.staged.scaleFar = false;
    } catch { /* probe cosmetic */ }
    // R11-FADE: the commit tick pre-writes the law's clamped end value (the
    // reveal branch only runs at st.reveal >= 1, so this is the S law's 1,
    // not a literal) through the one writer WHILE the transition is still
    // suspended — the rendered opacity is exactly 1 before the handoff.
    // finalizeStagedReveal then restores the transition and releases the
    // inline value with nothing left to ease or snap (1 -> stylesheet 1).
    // (Commit implies content, so the hold has released: eff == law == 1.)
    scrubWrite(String(+effReveal.toFixed(4)));
    finalizeStagedReveal(root);
    return;
  }
  try {
    // GATE-3 REVISION: the dissolve must READ as a fade, not a cut.
    // The staged dissolve is SCRUBBED — the S law rewrites the inline opacity
    // on every scroll tick. The CSS transition must be suspended while that
    // happens (`.scrubbing`), because a transition eases between COMMITTED
    // values: each per-tick write would restart it from the current value,
    // the rendered opacity would lag the law (measured: target 1.0, rendered
    // 0.89), and the commit would then snap it up — a cut. With the
    // transition suspended the law's value IS the rendered value, so the
    // dissolve tracks the fingers exactly and the commit has nothing to snap.
    // The law stays the single source of the opacity; the transition is only
    // the easing for the UNSCRUBBED legs (the prewarm->reveal crossfade and
    // the timed reverse), which the class is removed for. R11-FADE: routed
    // through the one writer above so the suspend-then-write order is
    // identical on every S-owned leg (holds, dissolve, commit pre-write).
    // READINESS-HOLD: the written value is the EFFECTIVE ramp — the law once
    // the twin holds tiles (or past the fallback), 0 while it doesn't.
    scrubWrite(effReveal <= 0 ? '0' : String(+effReveal.toFixed(4)));
  } catch { /* cosmetic */ }
  // S owns the dissolve: the paint-gated fallback window slides while the hold
  // flows (re-armed at most once/sec — the window only fires after S stalls a
  // full timeout, so every-tick clear+set is pure churn). The commit path
  // above never slides: revealTwin already disarmed it.
  try {
    let nowFb = 0;
    try {
      nowFb = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    } catch { nowFb = Date.now(); }
    if (nowFb - lastFallbackArmT >= 1000) {
      lastFallbackArmT = nowFb;
      armRevealFallback();
    }
  } catch { /* timer is best-effort */ }
}

/** Round-9 junction fix: has the twin RELEASED its intro (pose applied)?
 * The grant (ready/painted) only proves the listener is alive — the release
 * (handoff.fwd allocated, phase hold->swoop) proves a pose was applied. The
 * overlay dissolve must stay at 0 until release, or the twin's top-down boot
 * frame (dark, untextured) becomes visible mid-dissolve — the measured
 * one-frame basemap+pitch cut (luma halving, same mask) and the two-zooms
 * composite. Same-origin read (same pattern as twinFrameHasContent);
 * unreadable counts as unreleased (fail-safe: invisible twin, hold persists).
 * Never throws. */
function twinReleased() {
  try {
    const fr = overlayEls && overlayEls.frame;
    const win = fr && fr.contentWindow;
    const h = win && win.__ring2 && win.__ring2.handoff;
    if (!h || typeof h !== 'object') return false;
    if (h.fwd) return true;
    const ph = h.phase;
    return ph === 'swoop' || ph === 'push' || ph === 'settle';
  } catch {
    return false;
  }
}

/** GATE-3 REVISION: does the twin overlay have a REAL frame?
 * The commit must never land on a blank twin. `twinReady`/`twinPainted` only
 * prove the twin LISTENER is alive — a painted-but-black canvas is the exact
 * failure (97.4% #0b0c0c, luma 94.7 -> 15.7, no recovery).
 * The twin is a same-origin iframe, so the map can read its own state: the
 * twin exposes `window.__ring2` (map, frame counter, handoff phase). A frame
 * counts as CONTENT when the twin has painted past its prewarm floor AND the
 * twin's map reports loaded. A frame that is black-but-painted fails the
 * second test, so a boot that has not laid down imagery cannot commit.
 * Conservative by design: if the twin's state cannot be read at all the
 * answer is FALSE (never commit blind) and the next S tick retries.
 * Never throws. */
const TWIN_MIN_CONTENT_FRAMES = 1; // twin paint frames required before a commit
function twinFrameHasContent() {
  try {
    const fr = overlayEls && overlayEls.frame;
    if (!fr || fr.getAttribute('data-url') === 'about:blank') return false;
    const win = fr.contentWindow;
    if (!win) return false;
    const r2 = win.__ring2;
    if (!r2) return false;
    // The twin reports the same signals its first-paint post computes:
    // painted frames, basemap tile-idle, terrain live. A frame that is
    // painted-but-black fails the idle/live tests, so a twin that has not
    // laid down imagery cannot commit.
    let c = null;
    try {
      c = typeof r2.content === 'function' ? r2.content() : null;
    } catch { c = null; }
    if (!c || typeof c !== 'object') return false;
    const ok =
      !!c.mapIdle &&
      !!c.sceneLive &&
      Number.isFinite(c.frames) &&
      c.frames >= TWIN_MIN_CONTENT_FRAMES;
    try {
      window.__mapProbe.twinContent = {
        loaded: !!c.mapIdle,
        sceneLive: !!c.sceneLive,
        frames: c.frames,
        ok,
      };
    } catch { /* probe cosmetic */ }
    return ok;
  } catch {
    return false;
  }
}

/** Commit the staged hold: the fingers dissolved the twin to full — drop the
 * inline staging opacity, run the standard dissolve reveal bookkeeping
 * (flags, probe, focus) and unclamp native zoom. Idempotent. */
function finalizeStagedReveal(root) {
  if (stagedCommitted) return;
  stagedCommitted = true;
  stagedActive = false;
  stagedTilesT0 = 0; // HARD-STOP: commit disarms the hold (loader already cleared by content)
  stagedTilesGranted = false; // HYSTERESIS: commit consumes the grant — the next hold restages cold
  try {
    unfreezeStagedFrame(); // MAP FRAME FREEZE: commit releases the camera lock
  } catch { /* unlock is best-effort */ }
  lastPostedStagedS = null; // commit ends the S stream (producer guards on flags anyway)
  revealTwin(true); // CUT, never the timed crossfade: the S scrub already dissolved the overlay to 1 on the fingers and the twin frame matches the staged end-frame by construction (ready gate above) — a crossfade here would re-animate a finished dissolve on a timer. The instant path keeps flags/probe/focus/unclamp identical.
  // GATE-3 REVISION: hand the opacity back to the CSS WITHOUT snapping it.
  // The scrub suspended the transition (`.scrubbing`) so the law's value was
  // the rendered value. At the commit the law has reached 1, so the inline
  // value and the stylesheet's agree — the transition can be restored and the
  // inline value released with NOTHING to snap. Restoring the class BEFORE
  // releasing the inline opacity matters: the class removal re-enables the
  // transition, and the inline release then eases from 1 to 1 (no change).
  try {
    if (root) {
      // Content-verified commit: the twin holds real pixels, so a stale
      // inline opacity (the blank guard's "0") must never survive — it left
      // committed-but-invisible twins. The scrub suspended the transition and
      // revealTwin just restored it, so releasing the inline value eases from
      // the rendered value to the stylesheet's 1: a fade, never a snap.
      root.classList.remove('scrubbing');
      root.style.opacity = '';
    }
  } catch { /* cosmetic */ }
  // The ceiling stays clamped while the twin owns the frame — restoring here
  // handed post-gate wheel ticks a runaway (measured 11.651, one 14.0).
  // doCloseTwin releases it on close; exitStaged on unwind.
  try {
    window.__mapProbe.staged = { active: false, s: +stagedS.toFixed(1), committed: true };
  } catch { /* probe cosmetic */ }
  // HARD-STOP presentation: the commit implies content — the loader clears.
  try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
}

/** Unwind the staged hold (reverse exit): zoomend settle below the gate.
 * Unclamps, drops accumulated scroll, hides the staged dissolve, and quietly
 * tears down the uncommitted prewarm (overlay hidden, frame blanked, twin
 * flags cleared) so no invisible twin-open state lingers — the map is never
 * stranded and re-entry restages cold. The twin-ready/paint grant is the
 * only other exit (forward, via driveStagedOverlay). */
function exitStaged() {
  const had = stagedActive || stagedS !== 0;
  stagedActive = false;
  stagedS = 0;
  stagedCommitted = false;
  stagedTilesT0 = 0; // HARD-STOP: unwind disarms the hold
  stagedTilesGranted = false; // HYSTERESIS: unwind consumes the grant — the next hold restages cold
  entryRx = null; // unwind clears the entry radii — the next hold re-caches its own arrival
  entryRy = null;
  lastPostedStagedS = null; // symmetric unwind: the S stream ends with the hold
  const hadOpen = twinOpen; // an open twin killed here skips the close chain — it still needs the flatten guarantor below
  restoreMaxZoom();
  try {
    unfreezeStagedFrame(); // MAP FRAME FREEZE: unwind releases the camera lock
  } catch { /* unlock is best-effort */ }
  // Live-hold unwind: glide the S-driven hold tilt back onto the zoom law so
  // a scroll-up unwind never strands extra pitch at the gate (pitch-only,
  // same settle tempo; zoom/center untouched — the next zoom step re-derives
  // the enclosure chrome from z the same way).
  try {
    if (had && mapRef) {
      let zNow = null;
      try {
        zNow = +mapRef.getZoom();
      } catch { zNow = null; }
      const base = pitchTargetForZoom(Number.isFinite(zNow) ? zNow : Z_HANDOFF);
      let cur = null;
      try {
        cur = +mapRef.getPitch();
      } catch { cur = null; }
      if (Number.isFinite(cur) && Math.abs(cur - base) > ISO_SCRUB_EPS_DEG) {
        setLivePitch(base);
      }
    }
  } catch { /* hold unwind is best-effort */ }
  try {
    window.__mapProbe.staged = { active: false, s: 0, committed: false };
  } catch { /* probe cosmetic */ }
  if (!had) return; // nothing staged: flags + unclamp only, never touch live state
  try {
    const root = document.getElementById('twin-overlay');
    if (root) {
      // GATE-3 REVISION: the unwind releases the scrubbed opacity AND
      // restores the transition — a staged hold that is unwound must leave
      // the overlay in the same state a non-staged one would be in.
      root.classList.remove('scrubbing');
      root.style.opacity = ''; // fall back to .prewarm CSS 0
    }
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
  // Shared guarantor: this teardown moves no camera either — a journey tilt
  // killed with the twin flattens onto the law (fork case: staged armed
  // while the direct path committed; the retreat zoomend exits the OPEN
  // twin with no fade, no recede — measured silent kill parking 45deg).
  try {
    if (hadOpen) flattenJourneyTiltToLaw('exit-staged');
  } catch { /* guarantor never breaks teardown */ }
  // HARD-STOP presentation: unwind may land back under an armed mask with an
  // unloaded twin — re-freeze the ceiling and show the loader there.
  try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
}

/** Round-10 dive-start prewarm: boot the twin iframe EARLY at first aimed
 * takeover engagement so grant+release land near arrival. Mounts the
 * overlay at opacity 0 (.prewarm still paints — display:none suspends rAF
 * so a hidden frame never paints or posts) with the live frame, but sets
 * no twinOpen, no pendingReveal, no clamp, no history, no timers.
 * Boot-once: the shell boots at most once per hotspot per dive — a second
 * call for the same h3 while armed is already warm (true, no second boot);
 * arrival reuses the warm shell via retarget, never a reload. */
function earlyBootTwin() {
  try {
    if (earlyTwinArmed || twinOpen || transitId || pendingReveal || stagedActive) {
      // Boot-once warm re-entry: the shell for this hotspot already lives —
      // report warm so repeat intent/takeover ticks reuse it, never re-boot.
      try {
        if (earlyTwinArmed && twinBootKey && twinBootKey === h3map[siteSector]) return true;
      } catch { /* key read is best-effort */ }
      return false;
    }
    if (!mapRef) return false;
    const frame = liveFrame();
    if (!frame) return false;
    const h3 = h3map[siteSector];
    if (!h3) return false;
    if (earlyTwinArmed) return twinBootKey === h3; // already booted: warm for this hotspot, cold never reuses
    // CACHE-FAST: adopt the page-idle preloaded shell (same hotspot, live
    // frame, bootMs stays the shell's birth) — no second navigation; the
    // arrival retarget re-pins the frame. Falls through to a fresh boot when
    // the shell is blank, dead, or for another hotspot.
    try {
      if (!earlyTwinArmed && twinBootKey === h3 && overlayEls && overlayEls.frame) {
        const cur = overlayEls.frame.getAttribute('data-url');
        if (typeof cur === 'string' && cur !== 'about:blank' && cur.length > 0) {
          earlyTwinArmed = true;
          try {
            window.__mapProbe.earlyPrewarm = true;
            window.__mapProbe.twinBootKey = h3;
          } catch { /* probe cosmetic */ }
          return true;
        }
      }
    } catch { /* adopt is best-effort — fall through to a fresh boot */ }
    const ov = ensureOverlay();
    try {
      ov.root.classList.remove('closing');
      ov.root.classList.add('prewarm');
    } catch { /* cosmetic */ }
    try {
      void ov.root.offsetWidth;
    } catch { /* reflow nudge is best-effort */ }
    setFrameUrl(ov.frame, twinUrl(h3, frame));
    ov.root.hidden = false;
    earlyTwinArmed = true;
    twinBootKey = h3; // the shell now lives: takeover + arrival reuse it
    try {
      window.__mapProbe.earlyPrewarm = true;
      window.__mapProbe.twinBootKey = h3;
      window.__mapProbe.twinBoots = (window.__mapProbe.twinBoots | 0) + 1;
      window.__mapProbe.bootTiming.bootMs = nowMs();
      if (!window.__mapProbe.bootTiming.firstBootMs) window.__mapProbe.bootTiming.firstBootMs = window.__mapProbe.bootTiming.bootMs;
    } catch { /* probe cosmetic */ }
    return true;
  } catch { return false; }
}

/** CACHE-FAST retarget gate: the warm shell takes the arrival frame via
 * retarget ONLY while it can (twin-side contract: hold, pre-release). A
 * shell that is still loading (no probe yet) or autoplaying past hold would
 * drop or ignore the retarget and strand the arrival on the wrong frame —
 * navigate fresh instead (caches stay warm, so the reload is cheap and
 * always lands the arrival frame). A shell that already matched an earlier
 * pin re-arms on retarget (twin-side: the post + settle count reset), so
 * readiness no longer blocks reuse — the arrival frame re-settles within
 * frames on warm tiles. Same-origin probe read; unreadable = not provably
 * safe = fresh. */
function shellRetargetable(h3) {
  try {
    if (!twinBootKey || twinBootKey !== h3) return false;
    if (!overlayEls || !overlayEls.frame) return false;
    const win = overlayEls.frame.contentWindow;
    if (!win) return false;
    const probe = win.__ring2;
    if (!probe || typeof probe.handoffPhase !== 'function') return false;
    if (probe.handoffPhase() !== 'hold') return false;
    return true;
  } catch { return false; }
}

/** Boot-once reuse: arrival on an armed boot for the SAME hotspot skips the
 * iframe navigation entirely and hands the arrival frame to the live shell
 * via retarget — the twin re-pins its hold pose while tiles/details stream
 * in (selective update, no shell reboot). False when there is no warm
 * shell (different hotspot, no boot, dead frame) or the shell already left
 * the retarget window (loading/past-hold) — the caller navigates. A shell
 * that matched an earlier pin re-arms on the retarget (twin-side), so reuse
 * never strands on a stale grant. */
function reuseWarmTwin(h3, frame) {
  try {
    if (!earlyTwinArmed || !twinBootKey || twinBootKey !== h3) return false;
    if (!shellRetargetable(h3)) return false;
    if (!overlayEls || !overlayEls.frame) return false;
    const win = overlayEls.frame.contentWindow;
    if (!win) return false;
    const msg = buildTwinRetargetMessage(frame);
    if (!msg) return false;
    // CONTENT-READY: this pin IS the arrival — it flips the twin's arrival
    // gate (see handoff.arrived) so the hold may release. Progressive
    // (non-arrival) pins carry no flag and can never release the hold.
    msg.arrival = true;
    try {
      win.postMessage(msg, '*');
    } catch { return false; }
    return true;
  } catch { return false; }
}

/** Abort a dive-start prewarm that never reached arrival: blank the frame
 * and re-hide the overlay. Touches nothing else — twinOpen stays false,
 * no timers (none armed), no clamp (never set), no history, probe flag
 * cleared so no aborted-boot state leaks. */
function abortEarlyBootTwin() {
  if (!earlyTwinArmed) return false;
  earlyTwinArmed = false;
  twinBootKey = null; // the shell is blanked below: no live boot to reuse
  try {
    if (overlayEls && overlayEls.frame) setFrameUrl(overlayEls.frame, 'about:blank');
  } catch { /* frame teardown is best-effort */ }
  try {
    if (overlayEls && overlayEls.root) {
      overlayEls.root.classList.remove('prewarm');
      overlayEls.root.hidden = true;
    }
  } catch { /* cosmetic */ }
  try {
    window.__mapProbe.earlyPrewarm = false;
    window.__mapProbe.twinBootKey = null;
  } catch { /* probe cosmetic */ }
  // HARD-STOP presentation: aborting the early boot unloads the twin — the
  // loader tracks whatever the mask gate reads now.
  try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
  return true;
}

/** CACHE-FAST page-idle shell preload: boot the twin shell on idle after
 * load (no intent needed), so the shell compile + first-frame cost lands
 * before the first dive instead of mid-dive. Same-origin iframe — the
 * navigation itself is the preload (preconnect N/A); Esri + CARTO
 * preconnects ride in ops3d-map.html <head>.
 * The shell is UNARMED (earlyTwinArmed stays false): the zoom-step abort
 * keys on the armed flag, so an idle shell survives until the first
 * intent/takeover adopts it via earlyBootTwin (no second navigation — the
 * arrival retarget re-pins the frame). A TTL blanks shells no dive arms
 * (frees the hidden rAF); the next intent reboots, no worse than today.
 * Never opens, never flips twin state, never touches the camera. */
let idleShellTimer = 0;
function preloadTwinShellIdle() {
  try {
    if (twinOpen || transitId || pendingReveal || stagedActive || earlyTwinArmed) return false;
    if (!mapRef) return false;
    const frame = liveFrame();
    if (!frame) return false;
    const h3 = h3map[siteSector];
    if (!h3) return false;
    if (twinBootKey) return true; // a shell already lives — nothing to preload
    const ov = ensureOverlay();
    try {
      ov.root.classList.remove('closing');
      ov.root.classList.add('prewarm');
    } catch { /* cosmetic */ }
    try {
      void ov.root.offsetWidth;
    } catch { /* reflow nudge is best-effort */ }
    setFrameUrl(ov.frame, twinUrl(h3, frame));
    ov.root.hidden = false;
    twinBootKey = h3; // live shell, unarmed: adopted (not rebooted) at first intent
    try {
      window.__mapProbe.twinBootKey = h3;
      window.__mapProbe.twinBoots = (window.__mapProbe.twinBoots | 0) + 1;
      window.__mapProbe.bootTiming.bootMs = nowMs();
      window.__mapProbe.bootTiming.idleFiredMs = nowMs();
      if (!window.__mapProbe.bootTiming.firstBootMs) window.__mapProbe.bootTiming.firstBootMs = window.__mapProbe.bootTiming.bootMs;
    } catch { /* probe cosmetic */ }
    try {
      if (idleShellTimer) clearTimeout(idleShellTimer);
      idleShellTimer = setTimeout(() => {
        try {
          if (!earlyTwinArmed && !twinOpen && twinBootKey === h3) {
            try { if (overlayEls && overlayEls.frame) setFrameUrl(overlayEls.frame, 'about:blank'); } catch { /* teardown is best-effort */ }
            try {
              if (overlayEls && overlayEls.root) {
                overlayEls.root.classList.remove('prewarm');
                overlayEls.root.hidden = true;
              }
            } catch { /* cosmetic */ }
            twinBootKey = null;
            try { window.__mapProbe.twinBootKey = null; } catch { /* probe cosmetic */ }
          }
        } catch { /* ttl release never breaks the map */ }
        idleShellTimer = 0;
      }, CACHE_FAST_IDLE_TTL_MS);
    } catch { /* ttl is best-effort */ }
    return true;
  } catch { return false; }
}

/** Handoff-4 Lane A seeded reveal: PRE-WARM the twin at the ring frame —
 * create the overlay iframe hidden (opacity 0 via .prewarm, still loading
 * ?sector&cx&cy&z&embed=1) and HOLD the map end-frame until the twin posts
 * {type:'safepipe-twin-ready'} (Lane B). Timeout fallback (~4s, paint-gated)
 * reveals anyway so a silent twin can never strand the map — staged
 * prewarms (opts.staged) arm the same paint-gated fallback: paint grants
 * the dissolve through driveStagedOverlay, and scroll-up still unwinds the
 * hold while nothing has painted. On ready,
 * CROSSFADE map->twin over ~450ms (overlay opacity 0->1 above the matched
 * sat frame). Reduced-motion: reveal instantly. */
function prewarmThenReveal(id, frame, opts = {}) {
  const s = sectors.find((x) => x.id === id);
  if (!s) return false;
  selectSector(id);
  const h3 = h3map[id];
  try { stampArm(); } catch { /* arm stamp never breaks arrival */ }
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
  pendingReveal = { id, timer: null, revealed: false, tries: 0 };
  window.__mapProbe.prewarm = true;
  window.__mapProbe.twinReady = false;
  window.__mapProbe.twinPainted = false;
  window.__mapProbe.reveal = 'prewarm';
  // Boot-once: an armed boot for this hotspot IS the twin — retarget the
  // live shell onto the arrival frame instead of navigating (no reload, no
  // unload echo, so no stale-close guard for the reused shell: a fast
  // genuine close must land). Only an actual navigation arms the guard.
  const warmReused = reuseWarmTwin(h3, frame);
  if (earlyTwinArmed && !warmReused) {
    try {
      const nowG = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      staleCloseGuardUntil = nowG + 1500; // the replaced early twin's pagehide echo lands in this window — drop it
    } catch { /* guard is best-effort */ }
  }
  // CACHE-FAST: replacing a live UNARMED idle shell unloads it too — its
  // pagehide echo lands after twinOpen flips and would tear down the fresh
  // arrival (the round-10 stale echo, unarmed variant). Same 1.5s drop
  // window; reuse posts no unload so the guard stays down there, and a
  // genuine close past the window still lands. twinBootKey aliveness proves
  // a shell lived (null = plain first navigation, no echo possible).
  if (!warmReused && !earlyTwinArmed && twinBootKey) {
    try {
      const nowI = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      staleCloseGuardUntil = nowI + 1500;
    } catch { /* guard is best-effort */ }
  }
  earlyTwinArmed = false; // arrival consumes the dive-start boot (warm shell reused via retarget, never reloaded)
  try {
    window.__mapProbe.earlyPrewarm = false;
  } catch { /* probe cosmetic */ }
  window.__mapProbe.revealFallback = false;
  window.__mapProbe.revealLate = false;
  window.__mapProbe.revealPaint = false;
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
  // Boot-once: the warm shell already lives — navigating here would reboot
  // it mid-dive (the double-load). Reused shells only get the retarget.
  if (!warmReused) setFrameUrl(frameEl, url);
  if (!warmReused) resetGrantStampsForFreshShell(); // new shell = new race: old grants describe the discarded shell
  root.hidden = false;
  try {
    document.body.classList.add('twin-open');
  } catch { /* chrome class is cosmetic */ }
  if (label) label.textContent = s.name + ' — ' + worstAssetId(s) + ' · ' + h3;
  // Fork guard: a commit while a staged hold is armed resolves the hold —
  // the twin it was holding for is revealed. STAGED arming calls pass
  // staged:true and must NOT resolve their own hold here: killing it at
  // entry murders the S stream (feeder + driver early-return on committed),
  // so no scroll tick can ever dissolve the overlay and the commit falls
  // back to the timed crossfade behind an autoplaying twin — the exact
  // out-of-sync/self-zoom failure. The staged hold exits only forward
  // (finalizeStagedReveal on S-commit) or backward (exitStaged on unwind).
  // Without this the hold lingers and a later retreat zoomend exitStaged()s
  // the OPEN twin with no fade, no recede (measured silent kill). The S
  // stream is over; the clamp stays for the close to release.
  if (stagedActive && !stagedCommitted && !opts.staged) {
    stagedActive = false;
    stagedCommitted = true;
    lastPostedStagedS = null;
    try {
      unfreezeStagedFrame(); // LOCK-EARLY: a resolved hold must not keep the camera lock — pan restores now
    } catch { /* unlock is best-effort */ }
    try {
      window.__mapProbe.staged = { active: false, s: +stagedS.toFixed(1), committed: true };
    } catch { /* probe cosmetic */ }
  }
  twinOpen = true;
  window.__mapProbe.twinOpen = true;
  window.__mapProbe.sectorH3 = h3;
  window.__mapProbe.handoff = frame ?? null;
  // CONTENT-READY: a reused warm shell posted its once-per-life paint
  // pre-open (dropped parent-side while twinOpen was false) and never
  // re-posts — adopt the shell's paint log so the paint grant fires and
  // paintedMs stays honest. The staged dissolve still rides the LIVE
  // content gate, so an adopted paint can never dissolve a blank twin.
  try {
    if (warmReused && !window.__mapProbe.twinPainted) {
      const win = overlayEls && overlayEls.frame && overlayEls.frame.contentWindow;
      const log = win && win.__ring2paintOut;
      if (Array.isArray(log) && log.length > 0) {
        window.__mapProbe.twinPainted = true;
        try { stampGrant('painted'); } catch { /* grant stamp is best-effort */ }
      }
    }
  } catch { /* paint adoption is best-effort */ }
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
  // Staged prewarms do NOT arm the timer: S owns the dissolve — every staged
  // grant slides the same paint-gated fallback (see driveStagedOverlay), so
  // a flowing hold can never be preempted mid-dissolve, and scroll-up still
  // unwinds the hold while nothing has painted. Unstaged prewarms arm here.
  if (!opts.staged) armRevealFallback();
  return true;
}

/* Unstaged + staged fallback reveal, paint-gated: Lane B ready normally reveals via
 * its message listener; this covers a twin whose ready-match never agrees
 * (off-site arrivals fail the map-cam check structurally). It reveals on
 * first-painted-frame (twinPainted), never on a black canvas: unpainted at
 * fire re-arms (up to REVEAL_PAINT_TRIES), and only a fully silent twin
 * takes the flagged blind reveal so the map never strands behind a dead
 * frame. Staged prewarms never arm this directly (S owns their dissolve);
 * every staged grant slides it instead (see driveStagedOverlay), and
 * scroll-up unwinds while nothing has painted. */
const REVEAL_PAINT_TRIES = 3;
function armRevealFallback() {
  try {
    if (pendingReveal && pendingReveal.timer) clearTimeout(pendingReveal.timer);
  } catch { /* timer teardown is best-effort */ }
  if (!pendingReveal) return;
  try {
    pendingReveal.timer = setTimeout(() => {
      try {
        if (!pendingReveal || pendingReveal.revealed) return;
        // Staged holds never reveal directly: a direct revealTwin would cut
        // to a parked frame (and the next S tick would jump opacity back
        // down). First paint grants the dissolve through the staged driver
        // instead, and scroll-up still unwinds the hold while nothing has
        // painted. A fully silent twin unwinds the hold (map stays live)
        // rather than blind-revealing a dead frame.
        if (stagedActive && !stagedCommitted) {
          lastPostedStagedS = null; // re-emit the live S (boot-raced seeds)
          try {
            driveStagedOverlay();
          } catch { /* staged drive is best-effort */ }
          if (!pendingReveal || pendingReveal.revealed || stagedCommitted) return;
          const tries = (pendingReveal.tries ?? 0) + 1;
          pendingReveal.tries = tries;
          if (tries <= REVEAL_PAINT_TRIES) {
            armRevealFallback();
            return;
          }
          // Unwind guard: never exit while deep with a staged hold alive —
          // unclamping at z>=band handed runaways to Z_MAX (measured 14.0).
          // Below the band the exit is the normal unwind; deep, the hold
          // stays (opacity 0, clamp on) and a zoom-out unwinds it through the
          // native-zoomend path — a stranded twin that still unwinds cleanly.
          let zExit = NaN;
          try { zExit = mapRef ? +mapRef.getZoom() : NaN; } catch { zExit = NaN; }
          if (Number.isFinite(zExit) && zExit >= Z_TOP - STAGED_EXIT_BELOW) {
            try { window.__mapProbe.staged.deepHold = true; } catch { /* probe cosmetic */ }
            return;
          }
          try {
            exitStaged();
          } catch { /* unwind is best-effort */ }
          return;
        }
        if (window.__mapProbe.twinReady) {
          revealTwin(false);
          return;
        }
        if (window.__mapProbe.twinPainted) {
          window.__mapProbe.revealPaint = true;
          revealTwin(false);
          return;
        }
        const tries = (pendingReveal.tries ?? 0) + 1;
        pendingReveal.tries = tries;
        if (tries <= REVEAL_PAINT_TRIES) {
          armRevealFallback();
          return;
        }
        window.__mapProbe.revealFallback = true;
        revealTwin(false);
      } catch { /* fallback reveal is best-effort */ }
    }, REVEAL_TIMEOUT_MS);
  } catch { /* timer is best-effort */ }
}

/** Crossfade the pre-warmed overlay in (opacity 0->1, ~450ms). Idempotent. */
function revealTwin(instant = false) {
  try {
    if (pendingReveal && pendingReveal.revealed) return true;
    // Reveal continuity / single writer: while the staged hold owns the
    // dissolve, the S law (driveStagedOverlay) is the ONLY opacity writer. A
    // timed crossfade here would ease 0->1 on a timer while the law still
    // reads mid-dissolve, and the next S tick would snap it back — the 0->1
    // jump. Route through the driver instead; the instant commit path
    // (finalizeStagedReveal, law already at 1) and the unstaged path still
    // proceed below.
    if (stagedActive && !stagedCommitted && !instant) {
      try {
        driveStagedOverlay();
      } catch { /* staged drive is best-effort */ }
      return false;
    }
    if (pendingReveal) pendingReveal.revealed = true;
    try {
      if (pendingReveal && pendingReveal.timer) clearTimeout(pendingReveal.timer);
    } catch { /* timer teardown is best-effort */ }
    if (!overlayEls || overlayEls.root.hidden) return false;
    // MASK-SYNC: the enclosing wash fires on the reveal tick, live-near
    // gated — the 450ms mask fade and the twin crossfade start together as
    // one motion. Staged holds already washed at arrival (re-asserting true
    // is a no-op); unstaged arrivals deferred the wash here so the mask
    // cannot park seconds ahead of the twin-ready/painted/fallback timer.
    // The live read (not the arrival flag) keeps off-screen grants honest:
    // a spot that drifted away keeps the frame clear instead of blacking it
    // on a stale center.
    try {
      const pxNow = proximityInfo();
      if (pxNow && pxNow.near) showVignette(true);
    } catch { /* wash co-fire is best-effort */ }
    // GATE-3 REVISION: the timed crossfade needs its transition BACK. The
    // staged scrub suspends it (`.scrubbing`) so the law's value is the
    // rendered value; once the scrub is done, the prewarm->reveal crossfade
    // is a TIMED leg, so the transition must be live again. Removing the
    // class here (and not only at the commit) keeps both legs correct: the
    // scrubbed leg is instant-by-law, the timed leg eases.
    try {
      overlayEls.root.classList.remove('scrubbing');
    } catch { /* cosmetic */ }
    if (!instant) {
      // A fork-guard-resolved staged hold can leave a stale inline opacity
      // (mid-dissolve S value) + .scrubbing behind — inline beats the
      // stylesheet, so the timed leg would run 0→mid and STICK there. Clear
      // it while .prewarm (opacity 0) still applies: computed stays 0, then
      // the prewarm removal below runs the clean 0→1 timed fade.
      try {
        if (overlayEls.root.style.opacity !== '') overlayEls.root.style.opacity = '';
      } catch { /* cosmetic */ }
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
    // HARD-STOP presentation: a reveal implies the twin owns the frame —
    // the loader clears (refresh is a no-op when already clear).
    try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
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
  // Boot-once: a direct open over an armed boot for the same hotspot reuses
  // the warm shell via retarget — no second navigation. Only an actual
  // navigation arms the stale-close guard (no unload echo on reuse).
  const warmReused = reuseWarmTwin(h3, handoff);
  if (!warmReused) setFrameUrl(frame, url);
  if (!warmReused) resetGrantStampsForFreshShell(); // new shell = new race (see arrival path)
  try { stampArm(); } catch { /* arm stamp never breaks a direct open */ }
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
  window.__mapProbe.twinPainted = false;
  window.__mapProbe.reveal = 'revealed';
  if (earlyTwinArmed && !warmReused) {
    try {
      const nowG = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      staleCloseGuardUntil = nowG + 1500; // the replaced early twin's pagehide echo lands in this window — drop it
    } catch { /* guard is best-effort */ }
  }
  // CACHE-FAST: same unarmed-idle-shell echo cover as the arrival path —
  // a direct open over a live idle shell replaces it (no retarget), so its
  // pagehide echo must not tear down the fresh open.
  if (!warmReused && !earlyTwinArmed && twinBootKey) {
    try {
      const nowI = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      staleCloseGuardUntil = nowI + 1500;
    } catch { /* guard is best-effort */ }
  }
  earlyTwinArmed = false; // direct open consumes any dive-start boot
  try {
    window.__mapProbe.earlyPrewarm = false;
  } catch { /* probe cosmetic */ }
  window.__mapProbe.revealFallback = false;
  window.__mapProbe.revealLate = false;
  try {
    document.body.classList.add('twin-open');
  } catch { /* chrome class is cosmetic */ }
  if (label) label.textContent = s.name + ' — ' + worstAssetId(s) + ' · ' + h3;
  // Fork guard (same as above — both commit sites resolve an armed hold).
  // A resolved hold can leave a stale inline opacity (mid-dissolve S value)
  // with .scrubbing suspending the transition — the discrete open would sit
  // at partial opacity forever. Release both: the transition goes live and
  // the value eases to the stylesheet's 1 (one short honest fade on a
  // discrete cut path, never the scroll journey).
  if (stagedActive && !stagedCommitted) {
    stagedActive = false;
    stagedCommitted = true;
    lastPostedStagedS = null;
    try {
      unfreezeStagedFrame(); // LOCK-EARLY: a resolved hold must not keep the camera lock — pan restores now
    } catch { /* unlock is best-effort */ }
    try {
      root.classList.remove('scrubbing');
      if (root.style.opacity !== '') root.style.opacity = '';
    } catch { /* cosmetic */ }
    try {
      window.__mapProbe.staged = { active: false, s: +stagedS.toFixed(1), committed: true };
    } catch { /* probe cosmetic */ }
  }
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
  // HARD-STOP presentation: a direct open hands the frame to the twin —
  // the loader clears.
  try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
  return true;
}

/** Actual teardown: instant cut to the map (never a timed fade), keeps hex
 * + selection (Task 19). Handoff-5-close single chain: EVERY close path
 * (X/Esc/back/twin-Esc) runs the same reverse — overlay hidden
 * synchronously, then the map sits at its law pose awaiting the fingers
 * (scroll owns every following motion; no auto recede, no timed legs).
 * Pending hide/recede steps are seq-guarded so a fresh open cancels them
 * (no blanked twin, no yanked map). No timers anywhere on this path: the
 * 450ms fade + recede-delay choreography is removed — the map underneath
 * is already at the law pose, so there is nothing to blend toward. */
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
  // LOCK-EARLY: Esc/reverse during a staged hold must restore pan — unwind
  // the hold (no-op when nothing is staged) and release the camera lock even
  // for holds a fork guard already resolved (those leak frozen handlers).
  try { if (stagedActive && !stagedCommitted) exitStaged(); } catch { /* unwind is best-effort */ }
  try { unfreezeStagedFrame(); } catch { /* unlock is best-effort */ }
  try {
    if (pendingReveal && pendingReveal.timer) clearTimeout(pendingReveal.timer);
  } catch { /* timer teardown is best-effort */ }
  pendingReveal = null;
  window.__mapProbe.prewarm = false;
  window.__mapProbe.twinReady = false;
  window.__mapProbe.twinPainted = false;
  window.__mapProbe.reveal = null;
  window.__mapProbe.revealFallback = false;
  window.__mapProbe.revealLate = false;
  window.__mapProbe.revealPaint = false;
  // Handoff-5-close: seq-guard for the teardown below.
  const seq = ++closeSeq;
  const seqGuard = () => closeSeq;
  const finishHide = () => {
    if (seqGuard() !== seq) return; // reopened mid-teardown: leave the fresh twin alone
    if (overlayEls) {
      overlayEls.root.hidden = true;
      overlayEls.root.classList.remove('closing');
      overlayEls.root.classList.remove('prewarm');
      try {
        setFrameUrl(overlayEls.frame, 'about:blank');
      } catch { /* frame teardown is best-effort */ }
      // Boot-once: the shell is blanked — the next dive boots fresh.
      twinBootKey = null;
      try {
        window.__mapProbe.twinBootKey = null;
      } catch { /* probe cosmetic */ }
    }
  };
  // Instant cut: hide synchronously — no fade class, no fade timer. The
  // map underneath sits at its law pose, so there is no blend to run.
  try {
    finishHide();
  } catch { /* hide is best-effort */ }
  // Vignette stays through the cut (forward-symmetric); the recede below
  // lifts it while sat->flat + zoom-out run.
  window.__mapProbe.recede = 'fading';
  // No recede-delay timer: run the recede synchronously. With no auto leg
  // this only asserts the frame + lands already-home arrivals; every other
  // motion waits for the fingers.
  try {
    // Skip the forced off when the live driver re-armed the wash inside the
    // teardown (fresh zoom steps): the driver owns it now, and forcing
    // off restarts the 0.45s transition mid-fade — the ghost shimmer.
    const lz = mapRef ? +mapRef.getZoom() : NaN;
    const lp = proximityInfo();
    const driverOwns = Number.isFinite(lz) && lp && lp.near && centerBlendForZoom(lz) > 0;
    if (!driverOwns) showVignette(false);
  } catch { /* cosmetic */ }
  try {
    recedeToHome();
  } catch { /* recede is best-effort */ }
  try {
    document.body.classList.remove('twin-open');
  } catch { /* chrome class is cosmetic */ }
  twinOpen = false;
  window.__mapProbe.twinOpen = false;
  // The commit keeps the ceiling clamped while the twin owns the frame; the
  // close releases it so the next journey can climb again (and a post-close
  // recede only ever zooms out, which the clamp never blocks).
  try { restoreMaxZoom(); } catch { /* unclamp is best-effort */ }
  // Shared guarantor: flatten a journey-owned tilt onto the law (see def).
  flattenJourneyTiltToLaw('close');
}

/** Close-time flatten guarantor (shared): the last zoomend fired while the
 * twin was open (the settle reconcile was blocked), and teardowns move no
 * camera — so without this, a journey tilt parks at the teardown zoom
 * forever (measured: pitch 10 frozen at z=1.49, pitch 45 frozen at z=1.49,
 * through every later rest). If the journey ever owned the tilt, SNAP pitch
 * onto the law at the teardown zoom (jumpTo — instant, no timers): below-band
 * that is flat; at deep zoom it holds the handoff pose for the fingers to
 * retrace. Pitch-only; zoom/center untouched; a camera the journey never
 * tilted (due false) is never yanked. At-target teardowns no-op here. */
function flattenJourneyTiltToLaw(reason) {
  try {
    if (!isoRestoreDue || !mapRef) return;
    let gz = null;
    try { gz = +mapRef.getZoom(); } catch { gz = null; }
    let gp = null;
    try { gp = +mapRef.getPitch(); } catch { gp = null; }
    if (Number.isFinite(gz) && Number.isFinite(gp)) {
      const gLaw = pitchTargetForZoom(gz);
      if (Math.abs(gp - gLaw) > 1) {
        try {
          mapRef.jumpTo({ pitch: gLaw });
        } catch { /* guarantor snap is best-effort */ }
      }
    }
  } catch { /* guarantor never breaks teardown */ }
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
 * never strand the map (capped near the walk duration + margin, not minutes).
 * Probe: __mapProbe.reverseWait/reverseFallback. */
const TWIN_REVERSE_WAIT_MS = 2000;
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
  // Seat the enclosure on the live frame at recede start: the staged seam
  // would otherwise sit frozen while the map retreats beneath it (ghost).
  try {
    const rz = mapRef ? +mapRef.getZoom() : NaN;
    const rprox = proximityInfo();
    if (Number.isFinite(rz) && rprox) writeEnclosureEllipse(rprox, rz);
  } catch { /* recede radii are best-effort */ }
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
    // Last-chance flatten: the home arrival below clears isoRestoreDue, so a
    // tilt that never retraced (fast flick over the band landing home on a
    // live step, where the zoomend-gated reconcile above cannot fire) would
    // strand at iso at world zoom. Pitch-only INSTANT snap (jumpTo, no
    // timers) — zoom and center untouched, flat arrivals no-op inside
    // tolerance. No timer ever owns camera motion on this path.
    try {
      const pHome = mapRef ? +mapRef.getPitch() : null;
      if (Number.isFinite(pHome) && Math.abs(pHome) > ISO_SETTLE_TOL_DEG) {
        mapRef.jumpTo({ pitch: 0 });
      }
    } catch (err) {
      errors.push('RECEDE-HOME-PITCH: ' + (err && err.message));
    }
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
      // No auto leg, by owner rule: every motion after a close is owned by
      // the fingers. A close with no following gesture sits at its law pose
      // (flat below the band, handoff pose deep) until the next scroll tick
      // — the takeover carries zoom + pitch exactly from there, so there is
      // no strand to rescue and no timer to arm.
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
    try { stampGrant('ready'); } catch { /* grant stamp is best-effort */ }
  } catch { /* probe cosmetic */ }
  // Task-35 staged: ready GRANTS the dissolve but the fingers own its
  // progress — route through the staged driver, never revealTwin directly.
  // Re-emit the live S first: posts made while the twin iframe was still
  // booting raced its listener attach and were lost, and the value-change
  // throttle would otherwise never resend them (a lost seed reads as
  // "no staged driver" twin-side — autoplay behind the overlay, the
  // zoom-in cut). The ready post proves the listener exists, so the
  // re-emit always lands.
  if (stagedActive && !stagedCommitted) {
    try {
      lastPostedStagedS = null;
      try {
        reassertStagedAnchor('grant'); // MAP FRAME FREEZE: re-hand the true end pose at grant
      } catch { /* re-hand is best-effort */ }
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
// Painted-frame arm (twin->parent first-paint, no match required): records
// paint so the fallback reveals on a painted frame instead of
// blind. Never reveals directly on the unstaged path — ready owns the
// reveal there; staged dissolves ride the same grant through the staged
// driver. Stale paints with no open twin are ignored.
window.addEventListener('message', (e) => {
  let p = null;
  try { p = parseTwinPaintedMessage(e && e.data); } catch { p = null; }
  if (!p) return;
  if (!twinOpen) return;
  try {
    window.__mapProbe.twinPainted = true;
    try { stampGrant('painted'); } catch { /* grant stamp is best-effort */ }
  } catch { /* probe cosmetic */ }
  // Staged paint grants the dissolve — route through the staged driver,
  // never revealTwin directly (the S law still owns the progress). The
  // painted post proves the twin listener exists, so re-emit the live S
  // first (boot-raced seeds were lost; the throttle would never resend).
  if (stagedActive && !stagedCommitted) {
    try {
      lastPostedStagedS = null;
      try {
        reassertStagedAnchor('grant'); // MAP FRAME FREEZE: re-hand the true end pose at grant
      } catch { /* re-hand is best-effort */ }
      driveStagedOverlay();
    } catch { /* staged drive is best-effort */ }
  }
});
window.addEventListener('message', (e) => {
  if (!twinOpen || !isTwinCloseData(e && e.data)) return;
  // Round-10 stale-echo guard: the replaced early twin's pagehide echo is
  // already in flight when arrival flips twinOpen — it must not tear down
  // the fresh prewarm. Genuine closes land outside this window.
  try {
    const nowE = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    if (nowE < staleCloseGuardUntil) return;
  } catch { /* guard never blocks the close */ }
  const recede = !!(e.data && typeof e.data === 'object' && e.data.recede);
  if (recede) {
    // Handoff-5-close: the twin already returned to ring-iso sat — keep
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
  try { installWheelFlip(b, map.getCanvasContainer(), { map, maskArmed }); } catch { /* flip best-effort */ }
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
      p.style.left = Math.round(pt.x) + 'px';
      p.style.top = Math.round(pt.y) + 'px';
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
/** Band takeover: inside the tilt band, aimed or journeying, each wheel tick
 * drives the camera INSTANTLY (duration 0 — one synchronous write, no
 * timers, no lag). Measured reason: a 120ms ease per tick supersedes the
 * previous one, so fast scrolling completed a fraction of each leg and the
 * dive crawled (~0.06 zoom/tick). Duration 0 keeps the exact event path the
 * eases used (zoom events fire, the hook passes the law value through
 * untouched, the driver runs per tick) with zero lag: the camera IS the
 * scroll. Zoom + law pitch + around in ONE write (single writer). Rate
 * mirrors the native wheel/trackpad rates so in-band speed == out-of-band
 * speed. Each tick also feeds staged S (flip-space sign) so the S-scrubbed
 * hold, dissolve, and commit advance on the fingers even though this
 * listener stopPropagations the canvas lane. Scoped tight: tilt band only,
 * no twin, no flight, no twin-busy states; the gesture-owned recede keeps
 * its ticks (they execute exactly). Everything else stays native.
 * Window-capture so it runs before the flip clone; preventDefault +
 * stopPropagation so the native handler never double-drives the tick. */
function installBandTakeover() {
  // Native rates, mirrored from the scroll handler so in-band speed matches:
  // trackpad ticks are small and fast, wheel ticks large and slow; line-mode
  // deltas scale like the native lane.
  const TRACK_RATE = 1 / 100;
  const WHEEL_RATE = 1 / 450;
  const onWheel = (e) => {
    try {
      if (!mapRef || !e || e.ctrlKey) return;
      let dy = +e.deltaY;
      if (!Number.isFinite(dy) || dy === 0) return;
      try {
        if (e.deltaMode === 1) dy = dy * 40;
      } catch { /* deltaMode read is best-effort */ }
      if (twinOpen || transitId || pendingReveal || reverseWait) return;
      // HARD-STOP staged hold: staging never drives here (the clamp owns
      // depth), but forward intent must still stall — returning before the
      // gate below lets zoom leak under the hold below the gate
      // (10.5->11.5) through this lane. Swallowed ticks repaint the frozen
      // hold so the S=0 pin + loader stay live without the S feed.
      if (stagedActive) {
        try {
          if (dy > 0 && stallSwallowForward()) {
            e.preventDefault();
            e.stopPropagation();
            try { if (!stagedCommitted) driveStagedOverlay(); } catch { /* frozen repaint is best-effort */ }
          }
        } catch { /* stall never breaks input */ }
        return;
      }
      let z = null;
      try { z = +mapRef.getZoom(); } catch { z = null; }
      if (!Number.isFinite(z)) return;
      if (z < Z_ISO_START - 1 || z > Z_HANDOFF + 0.5) return;
      let prox = null;
      try { prox = proximityInfo(); } catch { prox = null; }
      // Aimed (hotspot near cursor/center) OR already journeying (the scrub
      // engaged): below the band the law is flat so native is exact there;
      // inside the band an engaged journey must stay single-writer even when
      // the projection drifts off the cursor.
      let journeying = false;
      try { journeying = isoScrubOwned || isoRestoreDue || scrubProgress > 0; } catch { journeying = false; }
      if (!prox || !(prox.near || (z >= Z_ISO_START && journeying))) return;
      // Round-10 dive-start prewarm: first aimed engagement boots the twin
      // iframe early (once per dive — guarded inside). No state flips.
      if (prox && prox.near) {
        try {
          earlyBootTwin();
        } catch { /* prewarm never breaks input */ }
      }
      // HARD-STOP: forward (raw dy>0 = dive) stalls pre-grant while the mask
      // is armed and the twin holds no content: swallowed, so neither the
      // camera write below nor any downstream native lane advances depth.
      // Reverse flows untouched. Past the long cap forward escapes (flagged).
      try {
        if (dy > 0 && stallSwallowForward()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      } catch { /* stall never breaks input */ }
      e.preventDefault();
      e.stopPropagation();
      const rate = Math.abs(dy) < 4 ? TRACK_RATE : WHEEL_RATE;
      // GAIN-LINK: while the enclosing mask is armed (hotspot near — the
      // blend itself is the mask's forming parameter, 0 while the mask is
      // down), the tick runs at the mask-anchored dip gain — a pure
      // function of live mask state, so no timer owns the motion and
      // zoom-out retraces it symmetrically. The slowdown starts exactly on
      // the tick the mask appears and releases at iso (gain 1 there, so
      // the commit is intact). S feed below stays unscaled so the staged
      // commit keeps its full scroll budget.
      let dipGain = 1;
      try { dipGain = maskGainForBlend(centerBlendForZoom(z), !!(prox && prox.near)); } catch { dipGain = 1; }
      if (!Number.isFinite(dipGain) || dipGain <= 0) dipGain = 1;
      const target = z + dy * rate * dipGain;
      let around = null;
      try {
        const ctn = mapRef.getContainer();
        const r = ctn ? ctn.getBoundingClientRect() : null;
        if (r && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
          around = mapRef.unproject([e.clientX - r.left, e.clientY - r.top]);
        }
      } catch { around = null; }
      // R11-CENTER continuous centering: diving in while near, the tick
      // write carries an explicit center on the SHARED center blend — the
      // spot glides to center coupled to scroll speed inside the SAME
      // synchronous write (no extra Camera call, no ease curve, no settle
      // snap). Applied factor is 1-(1-b)^2: still a pure function of the
      // shared scalar (no new constants, no magic px), but it closes the
      // gap inside the band's tick budget — a plain b-fraction leaves a
      // ~6px residual at the handoff because zoom magnification inflates
      // each tick's remainder. Every value is the shared scalar + live
      // camera/site state. Zoom-out and far frames keep the cursor anchor
      // (finger-owned framing, park-safe) — EXCEPT under the mask (see
      // maskNow below): once the enclosing mask is up the write never
      // carries the cursor anchor in either direction. Around stays off a
      // center-carrying write (around re-anchors and would void it).
      let correctTo = null;
      let cBlend = 0;
      if (target > z && prox && prox.near) {
        try {
          const b = centerBlendForZoom(z);
          const c = mapRef.getCenter();
          if (Number.isFinite(b) && b > 0 && c && Number.isFinite(+c.lng) && Number.isFinite(+c.lat)) {
            const f = 1 - (1 - b) * (1 - b);
            cBlend = f;
            correctTo = [
              +c.lng + (SITE_LNGLAT[0] - +c.lng) * f,
              +c.lat + (SITE_LNGLAT[1] - +c.lat) * f,
            ];
          }
        } catch { correctTo = null; cBlend = 0; }
      }
      // Mask-arm hold: same predicate as the vignette write (near && shared
      // blend > 0 — the mask is up). While it holds, the write never carries
      // the cursor anchor — zoom-out ticks hold the live center instead, so
      // framing never pans around the cursor after the mask appears. Mask
      // down keeps the cursor anchor (finger-owned framing, park-safe).
      const maskNow = centerBlendForZoom(z) > 0 && !!(prox && prox.near);
      let holdCenter = null;
      if (maskNow && !correctTo) {
        try {
          const hc = mapRef.getCenter();
          if (hc && Number.isFinite(+hc.lng) && Number.isFinite(+hc.lat)) holdCenter = hc;
        } catch { holdCenter = null; }
      }
      try {
        // Instant drive: duration 0 writes synchronously on this tick — the
        // camera cannot lag the fingers and no timer ever owns the motion.
        const opts = {
          zoom: target,
          pitch: pitchTargetForZoom(target),
          duration: 0,
        };
        if (correctTo) opts.center = correctTo;
        else if (holdCenter) opts.center = holdCenter;
        else if (around) opts.around = around;
        mapRef.easeTo(opts);
      } catch { /* drive is best-effort */ }
      // Feed staged S in flip-space sign (dive is negative there): the
      // stopPropagation above starves the canvas accumulator, and without
      // this S sticks at 0 and the commit falls back to timeouts.
      try {
        feedStagedScroll(-dy);
      } catch { /* S feed is best-effort */ }
      try { window.__mapProbe.takeover = true; window.__mapProbe.zoomGain = +dipGain.toFixed(3); } catch { /* probe cosmetic */ }
      try { window.__mapProbe.centerSteer = +cBlend.toFixed(3); } catch { /* probe cosmetic */ }
    } catch { /* takeover never breaks input */ }
  };
  try {
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  } catch { /* takeover wiring is best-effort */ }
}
/** Owner wheel preference: two-finger drag UP zooms OUT, drag DOWN zooms */
// in (reverse of the MapLibre default). Trackpad pinch (ctrl+wheel) stays
// native. Capture-phase flip on the map root: the original wheel is
// stopped, then a sign-flipped clone is dispatched to the canvas lane, so
// the native handler (zoom-to-cursor, pinch path, zoomend) runs untouched
// — only the direction changes. Fail-open: if the clone cannot be built,
// the native event is left alone.
//
// Journey lock: while maskArmed() holds (the enclosing mask is up — live
// zoom past Z_CENTER with the hotspot near), the clone carries a phantom
// zoom anchor — beyond the spot when zooming in, canvas center when zooming
// out — so the NATIVE handler glides the spot to center itself. No custom
// animation exists to stutter. Mask down keeps the user's cursor anchor.
// ctx = { map, maskArmed } (optional; without it this is flip-only).
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
      // (zoom-in) or at canvas center (zoom-out) — but ONLY while the mask
      // is armed. The native handler keeps its around-point fixed, so the
      // spot glides toward center coupled to the user's own scroll speed —
      // one motion, never a yank, easing in as it centers. Fully native
      // downstream (zoom math, events, zoomend) — only the anchor moves.
      let px = null, py = null;
      let locked = false;
      try { locked = !!(ctx && ctx.map && ctx.maskArmed && ctx.maskArmed()); } catch { locked = false; }
      if (locked) {
        try {
          const H = ctx.map.project(SITE_LNGLAT);
          const r = laneEl.getBoundingClientRect();
          const P = lockAroundPoint(+H.x, +H.y, (r.width || 800) / 2, (r.height || 600) / 2, dy > 0);
          if (P) { px = r.left + P.x; py = r.top + P.y; }
          else locked = false;
        } catch { locked = false; }
      }
      // GAIN-LINK: while the lock holds (mask armed) the flipped clone
      // carries the mask-anchored dip gain — a pure function of the live
      // enclosure blend (0 while the mask is down, so the slowdown starts
      // exactly when the mask appears) releasing to 1 at iso, so the
      // fingers dwell longer through mask formation with no timer owning
      // the motion. Zoom-out retraces symmetrically (gain is
      // direction-free); far frames never lock so they keep full rate.
      // Pinch (ctrl+wheel) bypasses here.
      let dipGain = 1;
      if (locked) {
        try { dipGain = maskGainForBlend(centerBlendForZoom(+ctx.map.getZoom()), true); } catch { dipGain = 1; }
        if (!Number.isFinite(dipGain) || dipGain <= 0) dipGain = 1;
      }
      try { window.__mapProbe.zoomLock = locked; window.__mapProbe.zoomGain = +dipGain.toFixed(3); } catch { /* probe cosmetic */ }
      // HARD-STOP: mask armed + twin unloaded → forward stalls HERE (raw dy>0
      // = dive under the up-out convention): swallowed, loader on, depth
      // frozen by the ceiling in refresh. Reverse always passes to the clone.
      // Staged holds swallow here too (no exemption): the clone must NOT
      // reach the canvas lane or native zoom advances under the hold below
      // the gate — the frozen hold repaints inline instead (same drive the
      // accumulator's stall branch runs), so nothing starves. Past the long
      // cap forward escapes (flagged in probe.stall).
      try {
        if (dy > 0 && stallSwallowForward()) {
          try { window.__mapProbe.stallSwallowed = true; } catch { /* probe cosmetic */ }
          try { if (stagedActive && !stagedCommitted) driveStagedOverlay(); } catch { /* frozen repaint is best-effort */ }
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      } catch { /* stall never breaks input */ }
      let clone = null;
      try {
        clone = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: flipWheelDelta(+e.deltaX || 0),
          deltaY: flipWheelDelta(dy) * dipGain,
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
/** Pinch guard (mask-armed center anchor, third zoom path): the native
 * scrollZoom lane runs untouched when neither the band takeover nor the
 * flip claims the tick — trackpad-pinch ctrl+wheel always bypasses the
 * flip. Post-mask that lane would zoom around the cursor and drag the
 * masked frame off the hotspot, so a window-capture guard re-anchors
 * pinch ticks to dead canvas center (direction and deltas pass through
 * unchanged — only the anchor moves) and lets the native handler drive
 * the centered clone. Plain wheel never reaches here (the flip always
 * claims it); pre-mask everything passes through untouched. Touch pinch
 * stays native (not a scrollZoom path). */
function installAnchorGuard() {
  try {
    if (window.__anchorGuardInstalled) return;
    window.__anchorGuardInstalled = true;
  } catch { /* flag best-effort */ }
  window.addEventListener('wheel', (e) => {
    try {
      if (!e || !e.ctrlKey) return;
      if (e.__zoomFlipped || e.__anchorCentered) return;
      // HARD-STOP FIRST: forward pinch stalls whenever the hold owns the
      // frame — checked BEFORE the mask predicate below, which reads false
      // during staged holds (twinOpen) and would otherwise let every pinch
      // tick through to native zoom (measured +0.09/tick ratchet 10.96→11.5
      // under tilesHold). The gate is self-arming (true only while phase-set
      // and unloaded), so pre-mask ticks still fall through untouched.
      // Reverse pinch always passes through.
      try {
        if (+e.deltaY < 0 && stallSwallowForward()) {
          try { window.__mapProbe.stallSwallowed = true; } catch { /* probe cosmetic */ }
          try { if (stagedActive && !stagedCommitted) driveStagedOverlay(); } catch { /* frozen repaint is best-effort */ }
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      } catch { /* stall never breaks input */ }
      let armed = false;
      try { armed = maskArmed(); } catch { armed = false; }
      if (!armed) return;
      if (!mapRef || typeof mapRef.getCanvasContainer !== 'function') return;
      const lane = mapRef.getCanvasContainer();
      if (!lane || typeof lane.contains !== 'function' || !lane.contains(e.target)) return;
      const r = lane.getBoundingClientRect();
      const cx = r.left + (r.width || 800) / 2;
      const cy = r.top + (r.height || 600) / 2;
      // GAIN-LINK (pinch parity with the wheel/flip lanes): the centered
      // clone carries the same mask-anchored dip gain the flip lane applies
      // at 4031 — without it every pinch tick runs at full rate through
      // mask formation while wheel dwells. Same law, same arm (mask armed
      // checked above), direction-free so zoom-out retraces symmetrically.
      let pinchDip = 1;
      try {
        const pz = +mapRef.getZoom();
        if (Number.isFinite(pz)) pinchDip = maskGainForBlend(centerBlendForZoom(pz), true);
      } catch { pinchDip = 1; }
      if (!Number.isFinite(pinchDip) || pinchDip <= 0) pinchDip = 1;
      try { window.__mapProbe.zoomGain = +pinchDip.toFixed(3); } catch { /* probe cosmetic */ }
      let clone = null;
      try {
        clone = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: +e.deltaX || 0,
          deltaY: (+e.deltaY || 0) * pinchDip,
          deltaZ: +e.deltaZ || 0,
          deltaMode: e.deltaMode,
          clientX: cx, clientY: cy,
          screenX: cx, screenY: cy,
          ctrlKey: true, shiftKey: !!e.shiftKey,
          altKey: !!e.altKey, metaKey: !!e.metaKey,
        });
        clone.__anchorCentered = true;
      } catch { return; }
      e.preventDefault();
      e.stopPropagation();
      try { lane.dispatchEvent(clone); } catch { /* fail-open */ }
      try { window.__mapProbe.anchorGuard = true; } catch { /* probe cosmetic */ }
    } catch { /* guard never breaks input */ }
  }, { capture: true, passive: false });
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
      feedStagedScroll(+e.deltaY);
    } catch { /* accumulator never breaks the map */ }
  }, { passive: true });
}
/** Shared S feeder (flip-space delta: forward/dive is negative — the flip
 * lane negates raw wheel so intent is -deltaY in both conventions). Called
 * from the passive canvas listener AND from the band takeover (whose
 * stopPropagation would otherwise starve S: measured S=0 through whole
 * dives, so the S-scrubbed dissolve/hold/commit never advanced and the
 * commit fell back to timeouts). Same guards, same drive, both lanes. */
function feedStagedScroll(dyFlip) {
  try {
    if (!stagedActive || stagedCommitted) return;
    if (!pendingReveal || pendingReveal.revealed) {
      // A close tore the prewarm down mid-hold — unwind, never drive.
      try {
        exitStaged();
      } catch { /* unwind is best-effort */ }
      return;
    }
    const dy = +dyFlip;
    if (!Number.isFinite(dy) || dy === 0) return;
    // HARD-STOP: forward (flip-space dy<0) stalls at frozen S until the twin
    // holds content — no accumulate, so neither the overlay dissolve nor the
    // twin-plane scrub (both pure fns of the same S) advances. The frozen
    // drive below repaints the hold and posts S (the first post pins the twin
    // intro at its start); the loader shows via refresh. Reverse (dy>0)
    // always drains through the same law. Past the long cap forward escapes
    // anyway (flagged in probe.stall).
    if (dy < 0 && stallSwallowForward()) {
      try { driveStagedOverlay(); } catch { /* frozen repaint is best-effort */ }
      return;
    }
    stagedS = accumStagedS(stagedS, dy); // symmetric: scroll-up retraces the same law
    // HARD-STOP: S advances only past the content grant (or the long-cap
    // escape) — the overlay stays a pure function of scroll, so every tick
    // paints. Forward intent while unloaded never reaches this line (stalled
    // above at frozen S); the grant-time re-emit in the Lane B handlers
    // replays the live S to the twin so both sides stay matched. Scroll-up
    // drains symmetrically; the silent-twin unwind still owns the
    // never-grant case.
    driveStagedOverlay(); // repaints the overlay AND posts S to the twin (throttled)
  } catch { /* accumulator never breaks the map */ }
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
    // events; the ONLY capture is the band takeover's in-band aimed ticks
    // (instant duration-0 drive per tick — the camera IS the scroll, no
    // timers, no lag) plus the flip's direction clone. First load sits AT
    // the floor (full map); zoom-in travels the whole
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
    // GATE-3 REVISION: the iso must GLIDE, never stair-step, IN BOTH
    // directions. MapLibre's native zoom animation re-applies the gesture-
    // start pitch on EVERY frame, so a per-tick write only lands on settle —
    // the tilt then becomes a function of gesture cadence (0deg at the gate
    // for 60/120ms, ~30deg at 250ms, 44.85deg only at 800ms, in 8-27deg
    // stair-steps). This hook runs BEFORE the camera moves, so the law's
    // target wins by construction on every frame of the native zoom.
    // One law: pitchTargetForZoom(z) — 0 at/below Z_TOP, ISO_PITCH_DEG at
    // the handoff, and it RETRACES on the way out.
    //
    // The law applies on BOTH sides of the band. Gating it to z >= Z_TOP
    // stranded the tilt: the reverse leg dropped below Z_TOP, the law
    // stopped writing, and the pitch sat at 45deg for the whole way home
    // (the settle-reconcile only fires on zoomend, i.e. after the gesture
    // stops — so during a continuous scroll-out nothing owned the pitch).
    // The law's value below Z_TOP is 0, so writing it there is the flatten,
    // not a yank.
    transformCameraUpdate: (next) => {
      try {
        try {
          window.__mapProbe.hookCalls = (+window.__mapProbe.hookCalls || 0) + 1;
        } catch { /* probe cosmetic */ }
        // Law ownership: the hook is the pitch-only writer of the ONE law, so
        // it runs everywhere except under an opaque twin (the twin owns the
        // pose there). Flights, prewarm, recede, and the reverse walk all keep
        // the law: every explicit pitch target in this file IS the law, and
        // the ease path applies hook approvals (measured), while the scroll
        // path is carried by the pump. The hook still holds while the overlay
        // reads translucent (dissolve start) — releasing then lets the native
        // ease re-apply gesture-start pitch 0 under the fade (a minus-45
        // snap). The user-oblique guard below is unchanged.
        let dissolving = false;
        try {
          dissolving = !!((twinOpen || pendingReveal) && !twinOverlayOpaque());
        } catch { dissolving = false; }
        let hookRevThrough = false;
        try {
          hookRevThrough = !!reverseWait && !twinOverlayOpaque();
        } catch { hookRevThrough = false; }
        if (!dissolving && (twinOpen && !hookRevThrough)) return next;
        const z = +next.zoom;
        if (!Number.isFinite(z)) return next;
        const pLaw = pitchTargetForZoom(z);
        const pCur = +next.pitch;
        if (!Number.isFinite(pCur)) return next;
        // Ownership — the journey's own tilt vs the user's.
        // If the journey took the tilt (isoScrubOwned), the law owns it and
        // writes unconditionally: the reverse leg must be able to flatten a
        // 45deg tilt, and the slack guard would otherwise block exactly
        // that (45 > 0 + slack). If the journey never took it, the guard
        // applies and a user-set oblique is never yanked.
        if (!isoScrubOwned && pCur > pLaw + ISO_SCRUB_SLACK_DEG) return next;
        // Slew cap inside the hook: the per-write path above can land several
        // wheel deltas in one painted frame (23.4 deg observed at 60 ms), so the
        // raw law write would bypass ISO_SCRUB_SLEW_DEG. Cap the step here and
        // the jump glides over following hook calls instead of snapping.
        const pStep = pLaw - pCur;
        const pCapped =
          Math.abs(pStep) > ISO_SCRUB_SLEW_DEG ? pCur + Math.sign(pStep) * ISO_SCRUB_SLEW_DEG : pLaw;
        return { ...next, pitch: pCapped };
      } catch {
        return next;
      }
    },
  });
  // No key prompts anywhere: suppress geolocate, never request tokens.
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: true }), 'top-right');
  try {
    window.__mapHandle = map; // headless measurement handle (getPitch/getZoom/easeTo for the journey loop)
  } catch { /* handle is best-effort */ }
  // Ease-queue guard: a stale duplicate ease frame skips instead of throwing
  // `_onEaseFrame is not a function` (see afterFrame for the full story).
  try { guardEaseQueue(map); } catch { /* guard best-effort */ }
  // Owner preference: drag-up zooms out (flip); pinch stays native.
  // Mask-aware: with the mask up the clone carries a phantom anchor so
  // native glides the spot to center (see installWheelFlip).
  try { installWheelFlip(document.getElementById('map'), map.getCanvasContainer(), { map, maskArmed }); } catch { /* flip best-effort */ }
  // Band takeover owns in-band aimed wheel ticks (single-writer tilt); the
  // flip lane stays for everything outside the band.
  try { installBandTakeover(); } catch { /* takeover best-effort */ }
  // Pinch guard: center-anchored native pinch past the mask arm.
  try { installAnchorGuard(); } catch { /* guard best-effort */ }
  // Stall guards: touch pinch-in / keyboard + / double-click carry forward
  // intent with no wheel tick — swallowed while holding, reverse always free.
  try { installStallForwardGuards(); } catch { /* guards best-effort */ }
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
          // GATE-3 REVISION tempo: CLOSE_FADE_MS ramp completes inside the flight.
          paint: {
            'raster-opacity': 0,
            'raster-opacity-transition': { duration: CLOSE_FADE_MS, delay: 0 },
            // Tile-level crossfade: Esri swaps source captures across zooms
            // ("inevitably different" images) — this fades old->new tiles
            // instead of popping. Independent of the opacity ramp above.
            // SAT_FADE_DURATION_MS so a deeper-zoom tone change reads as a dissolve.
            'raster-fade-duration': SAT_FADE_DURATION_MS,
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
          }, SAT_HIDE_DELAY_MS); // GATE-3 REVISION tempo: tracks the 450ms ramp
        }
      } catch (err) {
        errors.push('SAT-TOGGLE: ' + (err && err.message));
      }
    };
    mapRef = map;
    setSatRef = setSat;
    // CACHE-FAST: page-idle shell preload — boot the twin shell on idle
    // after init (no intent needed): the shell compile + first-frame cost
    // lands before the first dive instead of mid-dive. Same-origin iframe
    // (preconnect N/A — the navigation itself is the preload); Esri +
    // CARTO preconnects ride in ops3d-map.html <head>. Best-effort.
    try {
      window.__mapProbe.bootTiming.idleArmed = true;
      const fireIdle = () => { try { preloadTwinShellIdle(); } catch { /* idle preload never breaks init */ } };
      if (typeof requestIdleCallback === 'function') {
        try { requestIdleCallback(fireIdle, { timeout: CACHE_FAST_IDLE_DELAY_MS + 2000 }); }
        catch { setTimeout(fireIdle, CACHE_FAST_IDLE_DELAY_MS); }
      } else setTimeout(fireIdle, CACHE_FAST_IDLE_DELAY_MS);
    } catch { /* idle scheduling never breaks init */ }
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
    // the first scroll-down already travels over warm tiles — country home
    // plus the deep-band site levels (the z9-11 site patches faulted cold on
    // every first fast run).
    try { prefetchSatTiles(COUNTRY_CENTER, COUNTRY_ZOOM); } catch { /* best-effort */ }
    try {
      for (let zb = 9; zb <= 11; zb++) prefetchSatTiles(SITE_LNGLAT, zb);
    } catch { /* best-effort */ }
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
