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
  centerSettleForZoom,
  centerSettleOffsetPx,
  centerForSiteOffset,
  CENTER_SETTLE_SPAN_Z,
  shouldCenter,
  journeyArmed,
  isTopDown,
  needsHandoff,
  retraceOpacityForZoom,
  handoffScrubForZoom,
  handoffStagesForScroll,
  HANDOFF_STAGED_S_MAX,
  accumStagedS,
  autoStagedSForDt,
  stagedBaseParity,
  stagedPostStep,
  stagedPostSettled,
  STAGED_POST_EPS_PX,
  stagedHoldPitchForS,
  stagedHoldRingCloseForS,
  seamHoldEllipseForS,
  enclosureEllipsePxForZoom,
  MAP_VIGNETTE_RING_M,
  isHomeZoom,
  flipWheelDelta,
  lockAroundPoint,
  pitchTargetForZoom,
  settleFlattenDue,
  metersPerPixel,
  formatGround,
  spanFrac,
  EARTH_CIRC_M,
  Z_MIN,
  Z_CENTER,
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
  releaseImpossibleReason,
  RELEASE_WAIT_BOUND_MS,
} from './scrolltrigger.js';
import { coalesceStepSource } from './frame-pacing.js';
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
// DEM-PRECACHE: the flat map draws no raster-dem layer of its own, but the
// twin's terrain stages read this EXACT tile source (src/ops3d/dem.js
// terrariumTileUrl, sat-base.js TERRARIUM_TERRAIN) through the one HTTP cache
// the page and its same-origin iframe share — so warming here is warming the
// twin's first DEM stage. Same source string, never a second host.
const TERRARIUM_TILE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TERRARIUM_MAXZOOM = 15; // z16 404s (dem.js pins the same ceiling)
const DEM_COARSE_ZOOM = 12; // mirrors dem.js TERRARIUM_COARSE_ZOOM: the twin's first DEM stage
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
// CLICK FLIGHT (owner rev 2026-10-30): a hotspot click is explicit intent, so
// the arrival is ONE continuous camera move from the live pose to the site at
// the gate — never the old one-frame jumpTo that read as "no zoom at all".
// The tempo sits under the prewarm it overlaps, so the twin boot is never
// extended by the flight: the reveal only waits for the move to LAND, not for
// a timer (see clickFlightActive / deferRevealToFlightLand).
// Owner rev 2026-10-30: 560 ms read as a cut — the world map never showed
// its arrival at the twin plate. The flight is the EXPLANATION of the handoff,
// not a shortcut: 1.4 s keeps the full world->site sweep legible while still
// landing well before the twin's paint grant. Reduced motion keeps the honest
// single cut below.
const CLICK_FLIGHT_MS = 1400;
/** The auto-S pump uses the OLD 560 ms beat: the camera flight got slower to
 * be readable, but the post-grant dissolve must not become a second wait. */
const CLICK_DISSOLVE_MS = 560;
// CLICK STAGING: a click is the same intent as a scroll arrival, so it must
// enter the SAME enclosure + S-dissolve hold at the landing, not open an
// unstaged overlay. `clickStagedPending` kills any timed reveal during the
// flight (the ready/paint grants may land mid-move); the arm timer promotes
// the hold on the landing frame. A sequence token makes a stale timer inert
// after an unwind/re-entry. The auto-S pump is the other half: once the twin
// is released, the dissolve may finish without demanding one more notch.
let clickStagedPending = false;
let clickStagedSeq = 0;
let clickArmTimer = null;
let stagedAutoOn = false;
const STAGED_AUTO_IDLE_MS = 180; // wheel debounce: the auto pump never races an active finger
const STAGED_AUTO_STOP_EPS_PX = 0.25; // S epsilon: the pump stops when the law owns the last step
// The live click flight: { t0, ms, timer } while the camera is moving to the
// site; null once landed (or when the entry was a discrete reduced-motion cut).
let clickFlight = null;
let lastFallbackArmT = 0; // staged fallback re-arms at most once/sec while the hold flows: every-tick clear+set churns a 4000ms timer that only matters after S stalls
let earlyTwinArmed = false; // round-10 dive-start prewarm: early iframe boot armed, consumed at arrival or aborted on retreat
let staleCloseGuardUntil = 0; // round-10 stale-echo guard: arrival replaces a LIVE early twin, whose pagehide posts a close echo that lands after twinOpen flips and would tear down the fresh prewarm — closes inside this window are dropped (set only when consuming an armed early boot, so plain opens keep exact Esc behavior). UNWIND LAW: the window is short (a replaced frame's echo lands within a frame) and is bypassed the moment the fresh shell grants or releases, so a genuine close is never lost.
const STALE_CLOSE_GUARD_MS = 1500; // round-10's window is kept (a slow boot can echo late); the grant/release bypass below is what makes a genuine close land
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
  // UNWIND LAW (resilience half): the frame this dive left, the last unwind
  // (named reason + what it left/restored), Esc routing, close-echo drops, and
  // the release-impossible watch. A harness proves escape by reading these.
  diveCam: null, unwind: null, unwindCount: 0, escSource: null, escRequests: 0,
  closeDropped: 0, releaseWatch: null,
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
  // UNWIND LAW: live camera read for the escape harness (center/zoom/pitch/
  // bearing) — the same read the dive-frame capture and the restore use, so a
  // measurement compares like with like.
  readCam: liveCamFrame,
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
    // ONE box read per pass (frameSize — shared with proximity + enclosure).
    const box = frameSize();
    w = box.w;
    h = box.h;
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
    '<button id="twin-fs" type="button" aria-pressed="false" title="Fullscreen twin">&#x26F6; FULLSCREEN</button>' +
    '<button id="twin-close" type="button" title="Close twin (Esc)">&#x2715; CLOSE</button>' +
    '</div>' +
    '<iframe id="twin-frame" title="Sector twin" data-url="about:blank"></iframe>';
  document.getElementById('app').appendChild(root);
  const frame = root.querySelector('#twin-frame');
  const closeBtn = root.querySelector('#twin-close');
  const fsBtn = root.querySelector('#twin-fs');
  const label = root.querySelector('#twin-label');
  closeBtn.addEventListener('click', () => closeTwin());
  // PARENT-OWNED FULLSCREEN: requestFullscreen needs a real user activation in
  // the document that calls it. The twin's posted message handler has none (a
  // message event is not a gesture), so Safari rejects it outright — the
  // control has to live here, on the parent's own overlay bar, and be clicked.
  // It is inside #twin-overlay, so it stays visible windowed AND in
  // overlay-fullscreen (close keeps its place beside it).
  // The toggle reads the DOCUMENT, not the twinFs mirror: the twin may post its
  // own fullscreen state at any time, so a mirror-driven toggle can drift and
  // a second click would re-request instead of exiting.
  fsBtn.addEventListener('click', () => {
    let isFs = false;
    try { isFs = document.fullscreenElement === root; } catch { isFs = false; }
    setTwinFs(!isFs);
    syncFsProbe();
  });
  overlayEls = { root, frame, closeBtn, fsBtn, label };
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
  // REBOOT LOCK: once the twin overlay is opaque, the frame may only be torn
  // down (about:blank), never re-pointed at another document. A dblclick or a
  // late retarget there restarted the frame under a 100% overlay (measured
  // frames 318 -> 1, blank document, controls only) with nothing to show for
  // it — the worst state the owner has reported. Teardown stays allowed.
  try {
    const tearing = url === 'about:blank';
    if (!tearing && twinOverlayOpaque() && stagedActive && !stagedCommitted) {
      try {
        window.__mapProbe.frameRebootBlocked = {
          url: String(url).slice(0, 120),
          z: mapRef && typeof mapRef.getZoom === 'function' ? +mapRef.getZoom() : null,
        };
      } catch { /* probe cosmetic */ }
      return;
    }
  } catch { /* the lock never blocks a legitimate navigation */ }
  try {
    frame.contentWindow.location.replace(url);
  } catch (err) {
    frame.setAttribute('src', url); // same-origin fallback, shouldn't fire
    errors.push('FRAME: ' + (err && err.message));
  }
  // FRAME EPOCH: a navigation invalidates the previous document's proof. Its
  // pagehide echo arrives after this dive's twinOpen flips, and "proven"
  // (ready/painted/released) left over from the OLD document let that echo
  // tear down the fresh frame — a blank document under an opaque overlay.
  // Resetting here makes the stale-close guard cover the new boot instead.
  if (url !== 'about:blank') {
    try {
      const nowN = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      staleCloseGuardUntil = Math.max(staleCloseGuardUntil, nowN + STALE_CLOSE_GUARD_MS);
      window.__mapProbe.twinReady = false;
      window.__mapProbe.twinPainted = false;
      window.__mapProbe.frameEpoch = (+window.__mapProbe.frameEpoch || 0) + 1;
    } catch { /* epoch is best-effort */ }
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
// ENCLOSURE ZOOM LOCK: once the mask has converged at the handoff, the map
// camera is a still plate. Scroll owns the PLANE (S), never depth. Pinning
// both bounds (not only maxZoom) closes the reverse hole: wheel/pinch-out
// could still zoom the map under a held mask, which read as "the map inside
// the mask becomes zoomable". Released by every staged exit/close path.
let stagedZoomLocked = false;
// SEAM POP / APPLY ORDER: the frame this hold handed to the twin ({ z, cx, cy }
// at arm — SITE-centered by construction) and the patience flags that bound
// the base-parity gate. The twin's own satellite base applies that handed
// frame a beat late (measured: z10.687 inside a z11.5 clip on the first
// visible dissolve tick), so the written overlay may not rise until the
// frame's base has APPLIED it (see stagedBaseParity). The gate is forward
// only — reverse never waits on it — and is bounded by the same patience the
// pixel verdict gets, so a dead frame can never park the dive.
let stagedHanded = null;
let stagedFeedFwd = true; // last staged tick direction: true = forward/dive
let baseParityFalseMs = 0;
let baseParityIgnored = false;
let stagedDriveBusy = false; // re-entrancy guard: the eased-S pump retries the commit
// STAGED DISSOLVE FOLLOWER: the S law advances in per-tick stairs (~0.14
// per wheel notch) — the rendered inline opacity eases toward the law's
// latest target every animation frame, so the dissolve glides at any input
// cadence instead of stair-stepping. The law stays pure: probe, commit,
// and the release watch read S and the law, never the rendered value —
// only the inline write is eased. The commit path already hands the
// remainder to the live CSS transition (no snap), and the holds (blank /
// near guards) ease down to their 0 floor instead of cutting. Reduced
// motion jumps straight to the target. Self-stops when the hold ends.
let scrubRenderTarget = 0;
let scrubRenderShown = 0;
let scrubPumpOn = false;
const SCRUB_FOLLOW_PER_FRAME = 0.5; // exponential chase: ~120ms to converge
function pumpScrubOpacity() {
  if (scrubPumpOn) return;
  if (typeof requestAnimationFrame !== 'function') return;
  scrubPumpOn = true;
  const frame = () => {
    try {
      const root = document.getElementById('twin-overlay');
      const alive = stagedActive && !stagedCommitted && root && !root.hidden
        && root.classList.contains('scrubbing');
      if (!alive) { scrubPumpOn = false; return; }
      let reduce = false;
      try {
        reduce = typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch { reduce = false; }
      const d = scrubRenderTarget - scrubRenderShown;
      if (reduce || Math.abs(d) * 10000 < 1) {
        if (root.style.opacity !== String(scrubRenderTarget)) root.style.opacity = String(scrubRenderTarget);
        scrubRenderShown = scrubRenderTarget;
      } else {
        const next = scrubRenderShown + d * SCRUB_FOLLOW_PER_FRAME;
        const s = String(+next.toFixed(4));
        if (root.style.opacity !== s) root.style.opacity = s;
        scrubRenderShown = next;
      }
    } catch { /* pump never breaks the frame */ }
    try {
      requestAnimationFrame(frame);
    } catch {
      scrubPumpOn = false;
    }
  };
  try {
    requestAnimationFrame(frame);
  } catch {
    scrubPumpOn = false;
  }
}
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
// The twin's pixel verdict (contentOk) may delay a commit, never deadlock it:
// a blank sample buys this much patience, then the journey proceeds flagged.
const CONTENT_VERDICT_HOLD_MS = 1200;
let contentVerdictFalseMs = 0;
let contentVerdictIgnored = false;
// SEAM POP (base parity) patience: the twin's own satellite base must APPLY the
// handed frame before the overlay may rise over it. Same bound as the pixel
// verdict — a frame that never applies it buys this much patience, then the
// dissolve proceeds flagged (baseParityIgnored), so a dead/wedged frame can
// never park the dive.
const BASE_PARITY_HOLD_MS = CONTENT_VERDICT_HOLD_MS;
// Post dedupe epsilon (px of S): a gliding follower changes every frame; this
// only suppresses true no-ops, never a step of the glide.
const STAGED_POST_VALUE_EPS_PX = 0.25;
// Commit retry cadence while the eased post is still landing the melt.
const STAGED_COMMIT_RETRY_MS = 120;
// READINESS-HYSTERESIS: the tiles grant latches. twinFrameHasContent flaps
// mid-dissolve (the twin camera moves => fresh tiles => mapIdle false for a
// few frames), and without a latch each gap re-armed the zero-hold and the
// overlay strobed 0<->law with S freezing under it. Once granted the hold
// stays released for the life of the staged hold (commit/unwind/entry reset
// it); pre-grant ov stays 0 and the commit gates still sample live content.
let stagedTilesGranted = false;

// HARD-STOP state: wall-clock arming of the zero-hold (0 = none armed).
// stallPhase() names where the fingers are: 'staged' while the staged hold
// owns S. The old pre-gate ('pre') hold is retired with the arrival gate:
// the camera runs to Z_HANDOFF continuously, and a cold twin waits at the
// gate with the overlay dark instead of freezing mid-dive. stallArmed()
// adds the unloaded twin; stallHolding() adds the long cap.
// Reverse (scroll-up) never consults any of this — every reverse path runs
// untouched, so fingers always escape by going back.
let stallT0 = 0;
let stallCeilingOn = false; // pre-gate depth freeze applied (restored only when set here)
let lastCeilingPin = null; // last applied ceiling value (unchanged pins write nothing)
let stallPollT = 0; // bounded presentation poll: one 500ms chain while holding (cleared on release)
// HARD-STOP pill grace: the loader is a FALLBACK surface, not a dive badge.
// The staged hold arms at arrival while fast-grant dives release almost
// immediately — showing the pill from tick 0 flashes it on every healthy
// dive. Visibility waits STALL_PILL_GRACE_MS of held time; the feeder gate
// (zoom freeze) is unaffected and engages from tick 0.
const STALL_PILL_GRACE_MS = 2000;
// FAST-INTENT (pill PRESENTATION only): the loader is a FAST-DIVE fallback,
// not a dive badge. A slow approach boots the twin while the fingers travel,
// so it is already preloaded at the gate and must never see the message even
// when the arrival frame is still cold; only a burst can outrun the boot.
// Intent is measured from the dive itself, not asserted from a new threshold
// on the dive's shape: wheel distance and time are stamped at the MASK ARM
// (centerBlendForZoom owning the frame — the mask law's own threshold) and at
// the GATE ARRIVAL (Z_HANDOFF — the handoff law's own threshold), so the two
// stamps read laws that already exist. Only the intent rate / travel bound
// are new, and they never touch the hold, the ceiling, S or any camera law:
// they gate the pill's visibility alone (the hold still protects the commit).
const STALL_PILL_MIN_INTENT_PX_PER_S = 3200; // gesture px/s across mask->gate
const STALL_PILL_MAX_ARM_TO_GATE_MS = 900; // ... or the whole approach fit in this
// Measured on the frozen base (live chromium, 1000x620): a slow dive
// (100 px / 85 ms) crosses mask->gate at 2136 px/s over 1217 ms, a fast burst
// (320 px / 16 ms) at 4457-18174 px/s over 291-718 ms. Both bounds sit
// between the two with margin, and the EITHER clause keeps a janky-but-fast
// burst qualifying on rate alone when frame pacing stretches its wall time.
let diveIntentArmT = 0; // mask-arm stamp (0 = the mask is not up yet this dive)
let diveIntentArmPx = 0; // wheel px already travelled at the mask arm
let diveIntentGateT = 0; // gate-arrival stamp (0 = not at the gate yet)
let diveIntentGatePx = 0; // wheel px already travelled at the gate arrival
let diveIntentPx = 0; // forward wheel px accumulated in the current dive window
let diveIntentSeen = false; // a forward wheel sampled inside the window
/** Close the dive-intent window (mask down or the dive unwound): the next
 * dive measures itself from scratch. Presentation-only, never throws. */
function resetDiveIntent() {
  diveIntentArmT = 0;
  diveIntentArmPx = 0;
  diveIntentGateT = 0;
  diveIntentGatePx = 0;
  diveIntentPx = 0;
  diveIntentSeen = false;
  try {
    if (window.__mapProbe) window.__mapProbe.diveIntent = null;
  } catch { /* probe cosmetic */ }
}
/** Measure one sample of the dive (a forward wheel tick, or a bare refresh).
 * Stamps the mask arm and the gate arrival once each, accumulating forward
 * wheel px between them. Reads the live zoom only — writes no camera state,
 * touches no hold/ceiling/S value. Never throws. */
function noteDiveIntent(dy) {
  let z = NaN;
  let masked = false;
  try { z = mapRef ? +mapRef.getZoom() : NaN; } catch { z = NaN; }
  if (!Number.isFinite(z)) return;
  try { masked = centerBlendForZoom(z) > 0; } catch { masked = false; }
  if (!masked) {
    // Mask down: pre-dive or a reverse retreat past the arm — the window is
    // over, so a re-dive re-measures instead of inheriting stale travel.
    if (diveIntentArmT || diveIntentGateT || diveIntentPx || diveIntentSeen) resetDiveIntent();
    return;
  }
  if (+dy > 0) {
    diveIntentPx += +dy;
    diveIntentSeen = true;
  }
  const now = nowMs();
  if (!diveIntentArmT) {
    diveIntentArmT = now;
    diveIntentArmPx = diveIntentPx;
  }
  if (!diveIntentGateT && z >= Z_HANDOFF - 0.01) {
    diveIntentGateT = now;
    diveIntentGatePx = diveIntentPx;
  }
  try {
    if (window.__mapProbe) window.__mapProbe.diveIntent = diveIntentReadout();
  } catch { /* probe cosmetic */ }
}
/** The measured fast-intent decision: rate = wheel px/s across mask->gate,
 * travel = arm->gate wall time. A dive qualifies when EITHER its gesture
 * rate clears the intent rate OR its whole approach fits the travel bound.
 * Unmeasured dives (no wheel in the window: pinch, keys, a bare arrival)
 * never qualify — the pill stays a wheel-burst surface. Never throws. */
function stallPillIntent() {
  let z = NaN;
  try { z = mapRef ? +mapRef.getZoom() : NaN; } catch { z = NaN; }
  // Late gate stamp: a dive whose ease tail settles on the gate with no
  // further wheel tick still gets its arrival measured (the dive's own trip
  // time, never a poll guess).
  try {
    if (diveIntentArmT && !diveIntentGateT && Number.isFinite(z) && z >= Z_HANDOFF - 0.01) {
      diveIntentGateT = nowMs();
      diveIntentGatePx = diveIntentPx;
    }
  } catch { /* stamp is best-effort */ }
  return diveIntentReadout();
}
/** Readout shared by the decision and the probe (no side effects). */
function diveIntentReadout() {
  const hasArm = diveIntentArmT > 0;
  const hasGate = diveIntentGateT > 0;
  const travelMs = hasArm && hasGate ? Math.max(0, diveIntentGateT - diveIntentArmT) : -1;
  const px = hasArm && hasGate ? Math.max(0, diveIntentGatePx - diveIntentArmPx) : -1;
  let rate = null;
  if (hasArm && hasGate && diveIntentSeen) {
    if (travelMs > 0) rate = (px / travelMs) * 1000;
    else if (px > 0) rate = Infinity; // one-gate-free burst: no elapsed window
  }
  const measured = rate != null;
  const fastRate = measured && rate >= STALL_PILL_MIN_INTENT_PX_PER_S;
  const fastTravel = measured && travelMs >= 0 && travelMs <= STALL_PILL_MAX_ARM_TO_GATE_MS;
  return {
    ok: !!(fastRate || fastTravel),
    basis: measured ? 'wheel' : 'none',
    armToGateMs: travelMs,
    wheelPx: px,
    ratePxPerS: rate == null ? null : (Number.isFinite(rate) ? Math.round(rate) : -1),
    basisBy: fastRate ? 'rate' : (fastTravel ? 'travel' : 'none'),
  };
}
function stallPhase() {
  try {
    if (transitId) return null;
    // Staged only: the hold owns S while twinOpen is already true (prewarm),
    // so the twinOpen check below must not mask it — the loader and the S
    // freeze apply at the gate exactly as on the climb.
    if (stagedActive && !stagedCommitted) return 'staged';
    if (twinOpen) return null;
  } catch { /* predicate is best-effort */ }
  return null;
}
function twinLoaded() {
  // READINESS-HYSTERESIS: a latched staged grant survives tile gaps — the
  // feeder (stallSwallowForward) and the loader share this predicate, so
  // without the latch each mid-dissolve gap re-froze S and re-lit the pill.
  // RELEASE-GATED: content alone is not a revealable twin — the consumer must
  // have applied the handed pose and left its intro hold. A painted frame
  // that has not released would let the law run to 1 under a zero opacity and
  // commit as a cut. Scoped to the live staged hold; the pre-gate climb stays
  // strict.
  try {
    if (stagedActive && !stagedCommitted) {
      if (!stagedTilesGranted) return false;
      try { return twinReleased(); } catch { return false; }
    }
  } catch { /* latch read is best-effort */ }
  try { return twinFrameHasContent(); } catch { return false; }
}
/** Loading actually in flight (pill gate): the twin shell exists (boot
 * started — non-blank frame URL) but holds no content yet (navigating,
 * compiling, or streaming tiles). A cold twin (blank frame — nothing
 * booted, nothing fetching) is NOT loading: the pill would serve no
 * purpose there, so it stays dark (the hold/ceiling mechanics underneath
 * are untouched — this gates presentation only). Never throws. */
function twinLoadingInFlight() {
  try {
    const fr = overlayEls && overlayEls.frame;
    if (!fr || fr.getAttribute('data-url') === 'about:blank') return false;
    if (twinLoaded()) return false;
    return true;
  } catch { return false; }
}
function stallArmed() {
  try {
    // A gesture-owned recede just closed the twin: the frame is intentionally
    // twinless while the fingers retrace home. Swallowing forward here would
    // stall a re-dive behind a loader for a twin the user just closed (the
    // retrace teardown lands mid-mask with a blanked frame) — forward stays
    // free, the intent precache re-boots on the climb, and staging re-fires
    // at the next deep arrival.
    if (receding) return false;
    const phase = stallPhase();
    if (phase === null || twinLoaded()) return false;
    // ARRIVAL-ONLY HOLD: below the gate the camera must reach the handoff —
    // the final level is the enclosure scaling with the ring, and freezing
    // here was the pause-then-zoom the owner reported. The S gate owns the
    // wait once the camera is at the gate (overlay still dark), and the
    // staged hold protects the dissolve from there.
    let zNow = NaN;
    try { zNow = mapRef ? +mapRef.getZoom() : NaN; } catch { zNow = NaN; }
    if (!(zNow >= Z_HANDOFF - 0.01)) return false;
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
    el.innerHTML = '<b>TWIN LOADING</b><span>loading terrain &middot; scroll up to cancel</span>';
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
      if (Number.isFinite(z)) {
        // No-op dedupe (frame pacing): the pin is a pure function of the
        // live zoom and the hold refreshes on every pass, so re-applying an
        // unchanged ceiling re-ran MapLibre's constrain setup per frame for
        // the whole stall window (the region the owner reports as worst).
        // Phase floor: a staged hold needs the gate reachable (Z_HANDOFF);
        // a legacy ceiling outside the staged hold keeps the staging arm
        // (Z_TOP). Pinning staged at Z_TOP parked a 100%-opaque dive at
        // z10.59 forever.
        const floorZ = stagedActive && !stagedCommitted ? Z_HANDOFF : Z_TOP;
        const pin = stallCeilingPin(z, floorZ);
        if (!stallCeilingOn || pin !== lastCeilingPin) {
          mapRef.setMaxZoom(pin);
          lastCeilingPin = pin;
        }
        stallCeilingOn = true;
      }
      return;
    }
    if (stallCeilingOn) {
      // Release to the phase owner's ceiling, never past it: granting while
      // staged re-hands the staged clamp (the sprint still needs its gate);
      // anywhere else the native cap returns. Unwind/commit paths restore
      // the native cap themselves and clear the arm, so this never fights
      // them — and a ceiling set by nobody is never touched.
      try {
        if (stagedActive && !stagedCommitted) {
          if (lastCeilingPin !== Z_HANDOFF) {
            mapRef.setMaxZoom(Z_HANDOFF);
            lastCeilingPin = Z_HANDOFF;
          }
        } else restoreMaxZoom();
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
  // FAST-INTENT meter: a refresh samples the dive too, so a gate reached by
  // an ease tail (or a non-wheel dive) still closes/advances the intent
  // window. Read-only: one zoom read, no camera write.
  try { noteDiveIntent(0); } catch { /* meter is best-effort */ }
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
    // LOADING-GATED: the pill additionally requires loading actually in
    // flight (live shell, no content yet) — lingering mask-armed on a cold
    // twin (blank frame, nothing booting/fetching) holds the pill dark,
    // because the message serves no purpose there.
    let loading = false;
    try { loading = twinLoadingInFlight(); } catch { loading = false; }
    // FAST-INTENT is telemetry only now: the owner asked for a loading delay
    // whenever the arrival still waits. A slow arrival that boots past the
    // grace would otherwise show a silent, frozen gate. The hold and ceiling
    // are unchanged; this gates the message only.
    let intent = { ok: false, basis: 'none', armToGateMs: -1, wheelPx: -1, ratePxPerS: null, basisBy: 'none' };
    try { intent = stallPillIntent(); } catch { intent = { ok: false, basis: 'none', armToGateMs: -1, wheelPx: -1, ratePxPerS: null, basisBy: 'none' }; }
    const show = hold && loading && stallWaitMs() >= STALL_PILL_GRACE_MS;
    if (el) el.hidden = !show;
    try { window.__mapProbe.stall.loading = loading; } catch { /* probe cosmetic */ }
    try { window.__mapProbe.pill = { shown: show, intent }; } catch { /* probe cosmetic */ }
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
      loading: twinLoadingInFlight(),
      s: +((+stagedS || 0)).toFixed(1),
      waitMs: Math.round(stallWaitMs()),
      escape: !hold && phase !== null && !loaded,
      // FAST-INTENT: the measured dive values + the pill decision, published
      // so a harness reads the same numbers the presentation acted on.
      intent: (() => { try { return stallPillIntent(); } catch { return null; } })(),
      pill: (() => {
        try {
          const el = document.getElementById('twin-loading');
          return { visible: el ? !el.hidden : false, graceMs: STALL_PILL_GRACE_MS, minIntentPxPerS: STALL_PILL_MIN_INTENT_PX_PER_S, maxArmToGateMs: STALL_PILL_MAX_ARM_TO_GATE_MS };
        } catch { return null; }
      })(),
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
  // RELEASE-IMPOSSIBLE WATCH: the presentation refresh is the one surface that
  // runs on the 500ms poll, on every staged tick and on every stall refresh,
  // so sampling here bounds a parked hold even with no scroll ticks at all.
  // Self-disarming when nothing is staged.
  try { releaseWatchTick(); } catch { /* watch never breaks presentation */ }
  return hold;
}
// Task-37 staged-S producer: last S value posted to the twin frame
// (postTwinStagedS dedupes on value change; null = nothing posted yet, so the
// grant-time re-emits force a fresh post).
let lastPostedStagedS = null;
let lastStagedPostT = 0; // diagnostics stamp of the last post (the 60ms gate is gone: the pump glides per frame)
// EASED POSTED S: stagedS is the exact law (probe/commit/laws read it); the
// twin's melt only ever sees what we POST, so the posted value rides this
// per-frame follower toward stagedS (stagedPostStep). That is what turns the
// forward mix from seven per-notch stairs into a glide — the reverse already
// drained continuously only because its law happened to move on every frame.
let stagedPostCur = 0;
let stagedPostPumpOn = false;
let stagedCommitRetryT = 0;
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
    return !!(prox && prox.armed);
  } catch { return false; }
}
/** Proximity read: hotspot screen px vs cursor + vs canvas center.
 * Returns { sx, sy, distCursor, distCenter, cursorNear, centerNear,
 * near } or null pre-ready. Passive read only — never moves the map. */
function proximityInfo() {
  if (inDriverPass && frameProxCache) return frameProxCache;
  try {
    if (!mapRef || typeof mapRef.project !== 'function') return null;
    const pt = mapRef.project(SITE_LNGLAT);
    if (!pt || !Number.isFinite(+pt.x) || !Number.isFinite(+pt.y)) return null;
    // ONE box read per pass (frameSize): this used to read clientWidth and
    // clientHeight here AND in the enclosure writer AND in the scale HUD, so
    // every pass forced several fresh layouts between its own style writes.
    const box = frameSize();
    const cw = box.w;
    const ch = box.h;
    const dxC = pt.x - cw / 2;
    const dyC = pt.y - ch / 2;
    const distCenter = Math.sqrt(dxC * dxC + dyC * dyC);
    let distCursor = null;
    let cursorNear = false;
    if (lastCursor && Number.isFinite(+lastCursor.x) && Number.isFinite(+lastCursor.y)) {
      try {
        const r = frameRect();
        const lx = lastCursor.x - (r ? r.left : 0);
        const ly = lastCursor.y - (r ? r.top : 0);
        const dx = pt.x - lx;
        const dy = pt.y - ly;
        distCursor = Math.sqrt(dx * dx + dy * dy);
        cursorNear = distCursor <= PROX_CURSOR_PX;
      } catch { /* cursor math is best-effort */ }
    }
    const centerNear = distCenter <= PROX_CENTER_PX;
    // SITE-IN-VIEW (DIAGNOSTIC ONLY — never a gate): whether the hotspot is
    // on screen at all, with the cursor radius reused as the margin so a spot
    // just outside the frame still reads. This used to feed `armed`, which
    // armed the whole journey (mask, prewarm, settle, deep latch) the moment
    // the hotspot sat anywhere in the frame — a periphery hotspot hijacked
    // ordinary scroll-to-zoom exploration. Intent is near-only now
    // (journeyArmed); inView survives for telemetry.
    const inView =
      pt.x >= -PROX_CURSOR_PX && pt.x <= cw + PROX_CURSOR_PX &&
      pt.y >= -PROX_CURSOR_PX && pt.y <= ch + PROX_CURSOR_PX;
    const out = {
      sx: Math.round(pt.x), sy: Math.round(pt.y),
      distCursor: distCursor == null ? null : +distCursor.toFixed(1),
      distCenter: +distCenter.toFixed(1),
      cursorNear, centerNear, inView,
      near: cursorNear || centerNear,
      // Every journey predicate (mask, settle, takeover, prewarm, abort,
      // intent-lock, deep latch) reads `armed`: cursor-near OR centre-near,
      // one gate, no second door. On-screen is not intent.
      armed: journeyArmed({ cursorNear, centerNear }),
    };
    // Memoised for the rest of THIS pass only: the driver, the ring clip and
    // the staged hold ask the same question about the same camera. Reads
    // outside a pass (wheel lane, commit gate) always project live.
    if (inDriverPass) frameProxCache = out;
    return out;
  } catch {
    return null;
  }
}

/* CENTRE-SETTLE (owner rev 2026-10-26: "make sure the hotspot becomes locked
 * to the center by animating it to the center even sooner").
 *
 * The arm frame is captured the moment the mask appears: the live zoom plus
 * the site's screen offset (magnitude + unit direction). From there the camera
 * centre is a PURE FUNCTION OF ZOOM — the offset follows centerSettleOffsetPx
 * (arm offset -> 0 across CENTER_SETTLE_SPAN_Z levels) — so:
 *   - the ring, the mask ellipse, the pin and the camera all ride one scalar,
 *     which is what makes the pan read as one motion instead of a glide the
 *     eye can catch up with;
 *   - it is frame-rate independent (no per-tick factor, no timer);
 *   - it cannot overshoot (smoothstep: at rest at the arm, at rest on centre);
 *   - dead centre from arm+span through the commit (the staged pin and this
 *     law both resolve to SITE there, so the two writers agree exactly);
 *   - reading it backwards returns the camera to the EXACT arm frame at
 *     z = armZ, so when the mask disarms on the way out the native cursor
 *     dolly takes over with no jump.
 * Measured before: 154.5px off centre at the arm (z7.04), 16.4 at z8.84, 0
 * only at z9.65 — the ring was off-centre for 2.6 zoom levels. */
let centerArm = null; // { z, offPx, ux, uy } — the frame the mask armed on
let centerArmWrites = 0; // probe: law-driven centre corrections this dive
function noteCenterArm(prox, z) {
  try {
    if (centerArm) return centerArm;
    const zz = +z;
    if (!Number.isFinite(zz) || !prox) return centerArm;
    const sx = +prox.sx;
    const sy = +prox.sy;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return centerArm;
    const box = frameSize();
    const dx = sx - box.w / 2;
    const dy = sy - box.h / 2;
    const off = Math.hypot(dx, dy);
    centerArm = {
      z: zz,
      offPx: off,
      ux: off > 0.5 ? dx / off : 0,
      uy: off > 0.5 ? dy / off : 0,
    };
    centerArmWrites = 0;
    try {
      window.__mapProbe.centerArm = { z: +zz.toFixed(3), offPx: +off.toFixed(1) };
      window.__mapProbe.centerArmRelease = null;
    } catch { /* probe cosmetic */ }
  } catch { /* arm capture is best-effort */ }
  return centerArm;
}
function clearCenterArm(why) {
  if (!centerArm) return;
  centerArm = null;
  try {
    window.__mapProbe.centerArm = false;
    window.__mapProbe.centerArmRelease = why || null;
    window.__mapProbe.centerArmWrites = centerArmWrites;
  } catch { /* probe cosmetic */ }
}
/** Camera centre the settle law asks for at a zoom: the site plus the arm's
 * unit direction scaled to the law's remaining offset. Null when there is no
 * arm or the frame is unreadable; exactly SITE once the span is spent. */
function centerSettleTargetFor(z) {
  try {
    if (!centerArm) return null;
    const zz = +z;
    if (!Number.isFinite(zz)) return null;
    const off = centerSettleOffsetPx(centerArm.offPx, zz, centerArm.z, CENTER_SETTLE_SPAN_Z);
    return centerForSiteOffset({
      siteLng: SITE_LNGLAT[0],
      siteLat: SITE_LNGLAT[1],
      ux: centerArm.ux,
      uy: centerArm.uy,
      offPx: off,
      zoom: zz,
    });
  } catch {
    return null;
  }
}
/** Apply the settle law to the live camera. Returns true when it moved the
 * camera (the caller must re-read proximity for this pass). Sub-pixel drift
 * writes nothing — the law and the camera already agree. Flights and the
 * staged hold keep ownership: the hold pins SITE, which IS the law's value
 * there, so skipping it only avoids a duplicate write. */
function applyCenterSettle(z) {
  try {
    if (!mapRef || twinOpen || transitId || stagedActive) return false;
    const t = centerSettleTargetFor(z);
    if (!t || typeof mapRef.jumpTo !== 'function' || typeof mapRef.project !== 'function') return false;
    const p = mapRef.project(t);
    if (!p || !Number.isFinite(+p.x) || !Number.isFinite(+p.y)) return false;
    const box = frameSize();
    const drift = Math.hypot(+p.x - box.w / 2, +p.y - box.h / 2);
    if (!(drift > 0.5)) return false;
    mapRef.jumpTo({ center: t });
    centerArmWrites += 1;
    try {
      window.__mapProbe.centerSettle = {
        z: +(+z).toFixed(3),
        driftPx: +drift.toFixed(1),
        writes: centerArmWrites,
        offPx: centerArm ? +centerArm.offPx.toFixed(1) : null,
        armZ: centerArm ? +centerArm.z.toFixed(3) : null,
      };
    } catch { /* probe cosmetic */ }
    return true;
  } catch {
    return false;
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
  // VECTOR-TILE WARM: the held style names its own MVT templates — warm the
  // site patch at the live integer zoom so the refill reads cache (best-effort;
  // a style with no template records the blocker instead).
  try { warmVectorTiles(reason); } catch { /* vector warm is best-effort */ }
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
let lastSatOpacity = null; // last WRITTEN raster-opacity: unchanged values write nothing
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
      // No-op dedupe (frame pacing): at the ends of the band this value is
      // pinned (0 or 1) for seconds, and re-writing an unchanged paint
      // property makes MapLibre re-evaluate the layer style every pass.
      if (lastSatOpacity !== v) {
        try {
          mapRef.setPaintProperty(SAT_LAYER_ID, 'raster-opacity', v);
          lastSatOpacity = v;
        } catch (err) {
          errors.push('SAT-SCRUB: ' + (err && err.message));
        }
      }
    } else {
      satScrubPrimed = false;
      lastSatOpacity = null; // layer swapped/removed: the next write must land
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
let entryCy = null; // staged-entry ellipse centre offset (projected near half sits lower than the site)
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
    let corner = null;
    let h = null;
    try {
      // ONE box read per pass (frameSize — shared with proximity + the HUD).
      const box = frameSize();
      h = box.h;
      corner = viewportCornerPx(prox.sx, prox.sy, box.w, box.h);
    } catch { corner = null; }
    const ellipse = enclosureEllipsePxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M, corner, h);
    if (ellipse && Number.isFinite(ellipse.rx) && Number.isFinite(ellipse.ry)) {
      // Center follows the journey arm (near OR in view): an off-screen
      // projection parks the spot 100k+ px out, and writing it would snap the
      // mask across the frame when nearness resumes. The ellipse centre adds
      // the projection's own cy — the pitched near half projects farther than
      // the far half, so the mask and the twin clip share one centre instead
      // of the old site-centred circle.
      const cy = Number.isFinite(ellipse.cy) ? ellipse.cy : 0;
      if (prox.armed) {
        const vxStr = Math.round(prox.sx) + 'px';
        const vyStr = Math.round(prox.sy + cy) + 'px';
        if (lastVxWritten !== vxStr) { app.style.setProperty('--vx', vxStr); lastVxWritten = vxStr; }
        if (lastVyWritten !== vyStr) { app.style.setProperty('--vy', vyStr); lastVyWritten = vyStr; }
      } else if (stagedActive && stagedAnchor && stagedAnchor.site && mapRef) {
        try {
          const pa = mapRef.project([stagedAnchor.cx, stagedAnchor.cy]);
          if (pa && Number.isFinite(+pa.x) && Number.isFinite(+pa.y)) {
            const vxStr = Math.round(pa.x) + 'px';
            const vyStr = Math.round(pa.y + cy) + 'px';
            if (lastVxWritten !== vxStr) { app.style.setProperty('--vx', vxStr); lastVxWritten = vxStr; }
            if (lastVyWritten !== vyStr) { app.style.setProperty('--vy', vyStr); lastVyWritten = vyStr; }
          }
        } catch { /* anchor-center write is best-effort */ }
      }
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
        const seam = seamHoldEllipseForS(0, frameSize().h);
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
/* ONE COHERENT PASS PER FRAME (frame pacing, measured): a native zoom emits
 * BOTH 'move' and 'zoom' on every animation frame, so the whole driver used
 * to run ~2x per frame — measured 1.92 passes/frame mid-dive, each pass doing
 * 6-16 forced-layout reads (clientWidth/clientHeight/getBoundingClientRect)
 * plus the same CSS-var and paint-property writes again. The driver reads the
 * LIVE map state and is idempotent, so collapsing queued steps into one pass
 * on the next animation frame is behaviour-preserving: the last snapshot of
 * the frame IS the frame. Source priority matters — a settle ('zoomend')
 * carries laws a running gesture never runs (reconcile, catch-up, staged
 * exit), so it wins over 'zoom'/'move' when both are queued. */
let pendingStep = null; // { snap, source } — latest queued step of the frame
let pendingStepRaf = 0; // in-flight rAF handle (0 = none)
let frameSeq = 0; // bumped once per pass: scopes the per-frame caches
let frameSizeCache = null; // { w, h } container box, read ONCE per pass
let frameRectCache = null; // container client rect, read ONCE per pass
let frameProxCache = null; // proximity read, shared WITHIN one pass only
let inDriverPass = false; // true only while the coalesced pass runs
function scheduleNativeZoomStep(snap, source) {
  try {
    const prev = pendingStep;
    pendingStep = { snap, source: coalesceStepSource([prev && prev.source, source]) };
    if (pendingStepRaf) return;
    if (typeof requestAnimationFrame !== 'function') {
      pendingStep = null;
      onNativeZoomStep(snap, source);
      return;
    }
    pendingStepRaf = requestAnimationFrame(() => {
      pendingStepRaf = 0;
      const p = pendingStep;
      pendingStep = null;
      if (!p) return;
      frameSeq += 1;
      frameSizeCache = null;
      frameRectCache = null;
      frameProxCache = null;
      inDriverPass = true;
      try {
        onNativeZoomStep(p.snap, p.source);
      } catch (err) {
        errors.push('ZOOM-STEP: ' + (err && err.message));
      } finally {
        inDriverPass = false;
        // The pass may have MOVED the camera (jumpTo/easeTo); a proximity
        // read taken inside it must not outlive it, so the wheel/commit
        // gates always project the live camera.
        frameProxCache = null;
      }
    });
  } catch {
    try {
      onNativeZoomStep(snap, source);
    } catch (err) {
      errors.push('ZOOM-STEP: ' + (err && err.message));
    }
  }
}
/** Container box for THIS pass: one layout read, shared by every consumer
 * (proximity, enclosure, scale HUD). Reading clientWidth in each of them
 * forced a fresh layout between the writes they sit behind. */
function frameSize() {
  if (frameSizeCache) return frameSizeCache;
  let w = 800;
  let h = 600;
  try {
    const el = mapRef && typeof mapRef.getContainer === 'function' ? mapRef.getContainer() : null;
    w = (el && el.clientWidth) || window.innerWidth || 800;
    h = (el && el.clientHeight) || window.innerHeight || 600;
  } catch {
    w = 800;
    h = 600;
  }
  frameSizeCache = { w, h };
  return frameSizeCache;
}
/** Container client rect for THIS pass (cursor math only). */
function frameRect() {
  if (frameRectCache) return frameRectCache;
  try {
    const el = mapRef && typeof mapRef.getContainer === 'function' ? mapRef.getContainer() : null;
    frameRectCache = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { left: 0, top: 0 };
  } catch {
    frameRectCache = { left: 0, top: 0 };
  }
  return frameRectCache;
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
    // ZOOM-OUT WARM: arm the next lower viewport patch before the camera
    // reaches it. Runs on every step (both directions; the function gates to
    // actual outbound movement) so a recede, a wheel-out or an ease all warm
    // the world the eye is about to see.
    try { noteZoomDirection(z); } catch { /* outbound warm is best-effort */ }
    // ENCLOSURE ZOOM LOCK: the instant the live frame reaches the converged
    // handoff, seal both zoom bounds. From here the scroll is the PLANE's
    // scale (S), never the map's depth — wheel, pinch, keys and buttons all
    // clamp to a still plate until the hold is exited/closed.
    if ((stagedActive || clickStagedPending) && !stagedCommitted) {
      try { lockStagedZoomAtGate(); } catch { /* lock is best-effort */ }
    }
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
    const clipK = prox && prox.armed ? blend : 0;
    updateRingClip(clipK, prox);
    // Journey enclosure: the clear core IS the projected ground ring, so the
    // mask and the twin clip are one ellipse at every zoom. It forms from the
    // hotspot's farthest screen corner onto the ring by the iso checkpoint
    // (Z_TOP), then SCALES WITH the ring to the handoff seam (Z_HANDOFF),
    // where it holds. Owner rev 2026-10-29: the final level reads as the
    // enclosure growing to meet the twin, not the map zooming inside a fixed
    // porthole. rx/ry/cy come from enclosureEllipsePxForZoom (the camera's own
    // pitched projection); the corner brackets ride the SAME
    // --vx/--vy/--vr/--vr-y (lefts on the horizontal axis, tops on the
    // vertical axis), so one write moves both. Gate: blend>0 (z>7) — below
    // that the ring is sub-pixel and the surround would black the frame.
    // Zoom-out retraces it symmetrically (pure function of z + viewport).
    // Twin paths own it while open.
    // Written on #app (not the vignette node): #map-vignette and #ring-clip
    // are both inset:0 over #app, so both inherit identical values.
    if (!twinOpen && prox) {
      // CENTRE-SETTLE FIRST (see the law above): it may move the camera, so
      // the enclosure write below must read the camera it produced — a
      // one-frame stale --vx/--vy would put the ring off-centre by exactly
      // the drift this law exists to remove. The arm is captured on the mask
      // edge and released when the mask goes down (zoom-out) or the twin
      // takes the frame.
      let proxUse = prox;
      try {
        if (prox.armed) {
          noteCenterArm(prox, z);
          if (blend > 0 && applyCenterSettle(z)) {
            frameProxCache = null; // the pass memo predates the camera jump
            const fresh = proximityInfo();
            if (fresh) proxUse = fresh;
          }
        } else {
          clearCenterArm('mask-down');
        }
      } catch { /* settle never breaks the driver */ }
      try {
        // One law writes center + radii; the park reuses the last live size
        // instead of snapping to the 260px initial (ghost breathe). Off-centre
        // steps PARK instead of writing: an off-screen projection inflates
        // the corner law 100x (measured 21000px radii) — invisible while the
        // wash is off, but a stale giant the moment anything re-arms it. The
        // arrival path still writes true off-centre sizes directly (its clamp
        // must not depend on nearness); the driver only tracks nearness.
        if (proxUse.armed) {
          if (!writeEnclosureEllipse(proxUse, z)) parkEnclosureEllipse();
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
      if (!transitId) showVignette(proxUse.armed && blend > 0);
      try {
        window.__mapProbe.maskArmed = !!(proxUse.armed && blend > 0);
      } catch { /* probe cosmetic */ }
    } else {
      // The twin owns the frame: the settle arm dies with it, so a close at
      // the gate starts the way-out from the SITE (dead centre) rather than
      // re-using the offset of the dive that opened it.
      try { clearCenterArm('twin'); } catch { /* settle release is best-effort */ }
      try {
        window.__mapProbe.maskArmed = false;
      } catch { /* probe cosmetic */ }
    }
    // GESTURE-REVERSE DISSOLVE: repaint the zoom-keyed overlay fade on every
    // native zoom step while it owns the overlay (begin/end own the state;
    // this only repaints, so a parked retrace costs one pure-function read
    // per tick and never strands).
    try { if (retraceDissolve) driveRetraceDissolve(); } catch { /* dissolve repaint is best-effort */ }
    // CACHE-FAST: far-intent tile warm — one zoom level below the mask arm
    // (near && z >= Z_FAR_INTENT, ~6): warms the CURRENT-level site patch
    // hotspot-first, so the frame under the fingers resolves before the
    // arrival band streams. Tiles only — never boots, never flips twin
    // state, so the mask-arm abort lifecycle is untouched.
    try {
      if (prox && prox.armed && z >= Z_FAR_INTENT && !twinOpen) {
        const fz = Math.floor(z);
        if (fz !== lastFarWarmZ) {
          lastFarWarmZ = fz;
          try { prefetchSatTiles(SITE_LNGLAT, fz); } catch { /* warm is best-effort */ }
        }
        try {
          if (!window.__mapProbe.bootTiming.intentMs) window.__mapProbe.bootTiming.intentMs = nowMs();
        } catch { /* probe cosmetic */ }
      } else if (lastFarWarmZ !== -1 && !(prox && prox.armed)) {
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
      if (prox && prox.armed && blend > 0) {
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
          // DEM-PRECACHE: same intent gate, the twin's OWN terrain levels —
          // the coarse stage (z12) and the fine stage (z15, clamped by
          // TERRARIUM_MAXZOOM). Dedupe makes the repeat free.
          try { prefetchDemTiles(SITE_LNGLAT, DEM_COARSE_ZOOM); } catch { /* warm is best-effort */ }
          try { prefetchDemTiles(SITE_LNGLAT, TERRARIUM_MAXZOOM); } catch { /* warm is best-effort */ }
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
      if (prox && prox.armed && !twinOpen && !transitId && !pendingReveal && !stagedActive) {
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
      } else if (lastRetargetZ !== -1 && (!prox || !prox.armed)) {
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
        // DEM-PRECACHE: the same two levels for Terrarium (dedupe makes the
        // overlap with the intent seed free); the twin's coarse stage is z12,
        // which this band reaches exactly as the camera approaches the gate.
        try { prefetchDemTiles(SITE_LNGLAT, zl); } catch { /* warm is best-effort */ }
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
      // While the reverse dissolve owns the overlay, the gate arrival is a
      // re-open (driveRetraceDissolve), not a disarm — cancelling here would
      // strand an opaque overlay with no twin behind it. Past the teardown
      // (pure recede phase) the journey owns forward again as before.
      if (retraceDissolve) {
        try { driveRetraceDissolve(); } catch { /* re-open is best-effort */ }
      } else {
        receding = false;
        recedeLandHome = null;
        try {
          window.__mapProbe.recede = null;
        } catch { /* probe cosmetic */ }
      }
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
    if (!twinOpen && !busyFlight && prox && (prox.armed || isoScrubOwned || z >= Z_ISO_START || isoRestoreDue)) {
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
    if (!twinOpen && !busyFlight && source === 'native-zoomend' && isoRestoreDue && shouldCenter(z) && prox && !prox.armed) {
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
    // (4c) TERMINAL FLATTEN — every reverse SETTLE below the iso band ends
    // FLAT (pitch 0, bearing 0) with ONE instant jumpTo, no timer. The
    // slew-capped retrace needs intermediate steps and the reconcile above
    // needs isoRestoreDue, so a fast flick that clears the band in a single
    // step settles with the large plane still skewed and nothing left to
    // restore it — the owner's "it never becomes fully flat in time". Below
    // the band the law IS flat, so this only ever writes the law.
    if (!twinOpen && !busyFlight && source === 'native-zoomend') {
      let pSettle = null;
      let bSettle = null;
      try { pSettle = +mapRef.getPitch(); } catch { pSettle = null; }
      try { bSettle = +mapRef.getBearing(); } catch { bSettle = null; }
      if (settleFlattenDue({ z, pitch: pSettle, bearing: bSettle, twinOpen })) {
        try {
          mapRef.jumpTo({ pitch: 0, bearing: 0 });
          isoScrubOwned = false;
          isoRestoreDue = false;
          try { window.__mapProbe.flatten = 'settle'; } catch { /* probe cosmetic */ }
        } catch (err) {
          errors.push('SETTLE-FLATTEN: ' + (err && err.message));
        }
      }
    }
    // DEEP-INTENT: the automatic handoff is reserved for REAL lock-in intent.
    // Native zoom alone is not intent — this latch used to fire on `z >= Z_TOP`
    // with no proximity test, so zooming into any location at all clamped the
    // ceiling at Z_HANDOFF and jumped the camera to Sangachal. The latch now
    // reads the same arm predicate as every other journey stage (prox.armed:
    // cursor-near or centre-near). With intent absent nothing clamps and
    // nothing flies: the dive stays a plain terrain + iso zoom. Stage at the
    // GATE, not the iso checkpoint: once the enclosing hold exists the map is
    // a still plate (only S scales), so there is no final level of map zoom
    // inside the mask. The prewarm already runs at mask intent, so the extra
    // level is boot time, not a cold start.
    const deepIntent = !!(prox && prox.armed);
    if (!twinOpen && !busyNow && z >= Z_HANDOFF - 0.01 && deepIntent) {
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
            if (!Number.isFinite(mapRef.getZoom()) || mapRef.getZoom() < Z_HANDOFF - 0.01) { scrubFired = false; restoreMaxZoom(); return; }
            // INTENT GATE (one frame later): the cursor or the camera can
            // leave the hotspot between the latch and this callback, and a
            // clamped ceiling plus a flight to SITE on a stale latch is the
            // exact hijack this lane removes. Re-read the arm predicate live
            // (drop the pass memo first) and unclamp + re-arm when it is gone.
            frameProxCache = null;
            const lateProx = proximityInfo();
            if (!(lateProx && lateProx.armed)) { scrubFired = false; restoreMaxZoom(); return; }
            flyToSectorThenTwin(siteSector);
          } catch { /* handoff best-effort */ }
        });
      }
    } else if (scrubFired && !twinOpen && !stagedActive && !pendingReveal && (z < REARM_DOWN_BELOW || !deepIntent)) {
      scrubFired = false; // re-arm: a fresh deep zoom may hand off again
      // Intent-less depth owns the whole ceiling: restore it so the frame the
      // user is actually looking at keeps zooming (Z_MAX) instead of parking
      // at the handoff clamp it never earned. Restoring on the re-arm tick
      // also means a later INTENDED dive starts from an unclamped ceiling.
      // Only the LATCH's clamp is released here — a staged hold or a pending
      // reveal clamps on purpose and its own exits restore the ceiling.
      restoreMaxZoom();
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
    if (earlyTwinArmed && !twinOpen && !stagedActive && !pendingReveal && !(prox && prox.armed && blend > 0)) {
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
    if (!twinOpen && !transitId && !stagedActive && prox && prox.armed && blend > 0) {
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
/* LADDER-DEPTH: one integer level per trigger left the level the camera was
 * about to cross cold every time — the warm always landed one crossing late.
 * A trigger now warms the LIVE integer level plus the next two along the
 * predicted climb around the site (3 levels x the 3x3 patch = 27 URLs, the
 * hard per-trigger budget), on intent/mask arm and on integer-level
 * crossings only — never per tick, so a speculative ladder never contends
 * the live frame. The cap steps up as the set fills (oldest-first eviction
 * beyond the current step) instead of refusing the deeper levels. */
const PRECACHE_LADDER_LEVELS = 3; // live integer level + the next two along the climb
const PRECACHE_LADDER_MAX_LEVELS = 6; // ... and further while the 27-URL budget is unspent (ahead levels already warm are free)
const PRECACHE_LEVEL_MAX = Math.ceil(Z_MAX); // never warm past the map's own ceiling (14): those tiles can never be shown
const PRECACHE_TRIGGER_MAX_URLS = 27; // hard per-trigger budget: 3 levels x the 3x3 patch
const PRECACHE_CAP_STEPS = Object.freeze([192, 256]); // stepped warm-set cap (oldest-first beyond it)
const PRECACHE_CAP_STEP_HEADROOM = 12; // step up when the set sits this close to the current cap
let precacheCapStep = 0;
let precacheLadderActive = false; // a ladder owns the per-trigger budget across its levels
let precacheTriggerAttempts = 0; // attempted fetches in the CURRENT trigger
let precacheTriggerName = ''; // named trigger (probe: 'intent' | 'crossing' | 'predict' | 'single')
const satTileSeen = new Set(); // url -> warm (insertion-ordered oldest-first evict)
let precachePrefetched = 0;
let precacheHits = 0;
let lastPrecProgP = 0;
let lastPrecT = 0;
let precVel = 0; // journey progress per second (EMA)
let lastPrefetchPred = -1;
let lastPrefetchT = 0;
let lastPrecLevel = -1; // live integer zoom already gated: crossings prefetch even when the prediction barely moved
let satLadderDive = false; // mask-arm/intent latched per dive (re-arms on intent loss)
let satLadderDeepest = -1; // deepest integer level the last ladder warmed
/** Current warm-set cap (the stepped ceiling, never a bare literal at a call site). */
function precacheCapNow() {
  return PRECACHE_CAP_STEPS[precacheCapStep] | 0;
}
/** Step the cap up one rung (192 -> 256) once, when the set is nearly full. */
function stepPrecacheCap() {
  if (precacheCapStep < PRECACHE_CAP_STEPS.length - 1) precacheCapStep += 1;
}
/** Live precache probe row (never throws; created lazily so the probe shape
 * stays additive for harnesses that predate the ladder telemetry). */
function precacheProbe() {
  try {
    const p = window.__mapProbe && window.__mapProbe.precache;
    return p && typeof p === 'object' ? p : null;
  } catch {
    return null;
  }
}
function precacheNowMs() {
  try {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  } catch {
    return Date.now();
  }
}
/** Per-integer-level coverage row: when the level was warmed, when the camera
 * first reached it, and how much of the site 3x3 was already warm then. */
function satLevelRow(z, create) {
  const p = precacheProbe();
  if (!p) return null;
  try {
    if (!p.levels || typeof p.levels !== 'object') p.levels = {};
    let row = p.levels[z];
    if (!row && create !== false) {
      row = { z, warmT: null, attempts: 0, warm: 0, ladder: false, arrivedT: null, patchAtArrival: null, fullBefore: null };
      p.levels[z] = row;
    }
    return row || null;
  } catch {
    return null;
  }
}
/** Note that the 3x3 patch at integer level z was warmed (first time wins). */
function noteSatLevelWarm(z, attempts, trigger) {
  const row = satLevelRow(z);
  if (!row) return;
  try {
    if (row.warmT === null) row.warmT = +precacheNowMs().toFixed(1);
    row.attempts = (row.attempts | 0) + (attempts | 0);
    row.warm = Math.min(9, (row.warm | 0) + (attempts | 0));
    if (trigger && trigger !== 'single' && trigger !== 'predict') row.ladder = true;
  } catch { /* probe cosmetic */ }
}
/** Count the site 3x3 URLs already in the warm set at integer level z (read
 * only: never fetches). Used by the arrival snapshot. */
function satPatchWarmCount(center, z) {
  try {
    const c = Array.isArray(center) && center.length === 2 ? center : COUNTRY_CENTER;
    if (!Number.isFinite(+c[0]) || !Number.isFinite(+c[1])) return 0;
    const n = Math.pow(2, z);
    const t = lngLatToTile(c[0], c[1], z);
    let warm = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const x = t.x + dx;
        const y = t.y + dy;
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= n || y >= n) continue;
        if (satTileSeen.has(satTileUrl(z, x, y))) warm += 1;
      }
    }
    return warm;
  } catch {
    return 0;
  }
}
/** Snapshot level coverage the moment the camera reaches integer level z:
 * 9/9 means the whole 3x3 was warm BEFORE arrival. First arrival in a dive
 * wins; the table resets when intent re-arms so each dive reads clean. */
function noteSatLevelArrival(z, now) {
  try {
    if (!Number.isFinite(+z)) return;
    const row = satLevelRow(z);
    if (!row || row.arrivedT !== null) return;
    const patch = satPatchWarmCount(SITE_LNGLAT, z);
    row.arrivedT = +(Number.isFinite(+now) ? +now : precacheNowMs()).toFixed(1);
    row.patchAtArrival = patch;
    row.fullBefore = patch >= 9;
  } catch { /* probe cosmetic */ }
}
/** Reset the per-dive coverage table (intent lost / new dive). */
function resetPrecacheLevels() {
  const p = precacheProbe();
  if (!p) return;
  try {
    p.levels = {};
  } catch { /* probe cosmetic */ }
}
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
/** Viewport patch offsets for a zoom-out warm, centre tile first.
 * The dive ladder warms a 3x3 around the site (the twin's target), but a
 * zoom-out frame is the whole viewport: at 1122×700 that is ~5×4 256px tiles,
 * so a 3x3 leaves the edge tiles cold and they visibly stream in as the world
 * widens. Derive the radius from the live frame and sort centre-out; the
 * caller's URL budget trims the excess. Pure math (no DOM read inside). */
function viewportTileOffsets(wPx, hPx, tilePx = 256) {
  const w = Number.isFinite(+wPx) && +wPx > 0 ? +wPx : 1122;
  const h = Number.isFinite(+hPx) && +hPx > 0 ? +hPx : 700;
  const rx = Math.max(1, Math.ceil(w / (2 * tilePx)) + 1);
  const ry = Math.max(1, Math.ceil(h / (2 * tilePx)) + 1);
  const out = [];
  for (let dx = -rx; dx <= rx; dx += 1) {
    for (let dy = -ry; dy <= ry; dy += 1) {
      // Normalise the ellipse so the near-square viewport is not over-warmed
      // vertically; the centre tile always wins the first slot.
      out.push([dx, dy, Math.hypot(dx / rx, dy / ry), Math.abs(dx) + Math.abs(dy)]);
    }
  }
  out.sort((a, b) => a[2] - b[2] || a[3] - b[3] || (a[0] - b[0]) || (a[1] - b[1]));
  return out.map(([dx, dy]) => [dx, dy]);
}

/** Pre-fetch the 3x3 sat tile patch around center at zoom (best-effort).
 * `reason` names the trigger for the probe + the coverage table. Unwrapped
 * calls are their own trigger (fresh budget); a ladder (warmSatLadder) owns
 * ONE budget across its three levels. */
function prefetchSatTiles(center, zoom, reason, opts = {}) {
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
    const order = opts.viewport
      ? viewportTileOffsets(opts.wPx, opts.hPx)
      : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of order) {
      const x = t.x + dx;
      const y = t.y + dy;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= n || y >= n) continue;
      urls.push({ url: satTileUrl(z, x, y), hot: dx === 0 && dy === 0 });
    }
    if (!precacheLadderActive) { // an unwrapped patch is its own single trigger
      precacheTriggerAttempts = 0;
      precacheTriggerName = reason || 'single';
    }
    const probe = precacheProbe();
    try {
      if (probe) probe.tiles = { z, x: t.x, y: t.y, n: urls.length };
    } catch { /* probe cosmetic */ }
    let attempts = 0;
    for (const { url, hot } of urls) {
      try {
        if (satTileSeen.has(url)) {
          precacheHits += 1;
          continue;
        }
        // Per-trigger budget: a ladder's three patches share it, so one
        // trigger can never exceed 27 attempts (dedupe hits are free).
        if (precacheTriggerAttempts >= PRECACHE_TRIGGER_MAX_URLS) break;
        precacheTriggerAttempts += 1;
        attempts += 1;
        satTileSeen.add(url);
        // Stepped cap: oldest-first eviction beyond the CURRENT rung.
        while (satTileSeen.size > precacheCapNow()) {
          const oldest = satTileSeen.values().next();
          if (oldest && !oldest.done) {
            try { satTileSeen.delete(oldest.value); } catch { break; }
          } else break;
        }
        // Filling up: open the next rung so the deeper levels still fit.
        if (satTileSeen.size >= precacheCapNow() - PRECACHE_CAP_STEP_HEADROOM) stepPrecacheCap();
        try {
          const img = new Image();
          img.decoding = 'async';
          // CACHE-FAST: the hotspot tile loads first (high), the ring deprioritized (low) so speculative warms never contend the live frame. Zoom-out warms are ALL low: they are for the next frame, never the one on screen.
          try { img.fetchPriority = opts.lowPriority ? 'low' : (hot ? 'high' : 'low'); } catch { /* priority hint is best-effort */ }
          img.src = url; // warm the HTTP cache; never inserted in the DOM
        } catch { /* preload is best-effort */ }
        precachePrefetched += 1;
      } catch { /* per-tile best-effort */ }
    }
    // Only a level that actually cost a fetch mints a warm stamp: a dedupe-only
    // pass means the level was warmed earlier, and stamping it now would report
    // a warm that never happened at this point in the dive.
    if (attempts > 0) noteSatLevelWarm(z, attempts, precacheTriggerName);
    try {
      if (probe) {
        probe.prefetched = precachePrefetched;
        probe.fetched = precachePrefetched; // alias: the probe contract names `fetched`
        probe.hits = precacheHits;
        probe.warm = satTileSeen.size;
        probe.cap = precacheCapNow();
        probe.capStep = precacheCapStep;
        probe.trigger = { name: precacheTriggerName, attempts, budget: PRECACHE_TRIGGER_MAX_URLS };
        probe.maxTrigger = Math.max(probe.maxTrigger | 0, precacheTriggerAttempts);
        probe.deepest = satLadderDeepest;
      }
    } catch { /* probe cosmetic */ }
  } catch { /* precache never breaks the map */ }
}
/** LADDER-DEPTH trigger: warm the live integer level plus the next two along
 * the predicted climb around the site. At most PRECACHE_TRIGGER_MAX_URLS
 * attempts per call (3 x 9 cold levels, hotspot-first per level, live level
 * first) — and it keeps walking deeper while the budget is unspent, because
 * a level that is already warm costs dedupe hits, not URLs. So a dive that
 * crosses into z8 with 9/10/11 pre-warmed spends its 27 URLs on z8, z12, z13
 * instead of refetching what is already there. */
function warmSatLadder(center, levelNow, dir, reason) {
  const before = precachePrefetched;
  try {
    const base = Math.floor(+levelNow);
    if (!Number.isFinite(base)) return 0;
    const d = dir < 0 ? -1 : 1;
    const name = reason || 'crossing';
    precacheLadderActive = true;
    precacheTriggerAttempts = 0;
    precacheTriggerName = name;
    let levels = 0;
    let deepest = base;
    for (let i = 0; i < PRECACHE_LADDER_MAX_LEVELS; i += 1) {
      if (precacheTriggerAttempts >= PRECACHE_TRIGGER_MAX_URLS) break;
      const z = base + d * i;
      if (z < 0 || z > 19 || z > PRECACHE_LEVEL_MAX) continue;
      prefetchSatTiles(center, z, name);
      levels += 1;
      deepest = z;
      // The first three levels are the contract; beyond that the walk only
      // continues while a whole cold patch still fits the remaining budget.
      if (i + 1 >= PRECACHE_LADDER_LEVELS && precacheTriggerAttempts > PRECACHE_TRIGGER_MAX_URLS - 9) break;
    }
    satLadderDeepest = deepest;
    const probe = precacheProbe();
    try {
      if (probe) {
        const prevT = (probe.ladder && probe.ladder.triggers) | 0;
        probe.ladder = {
          triggers: prevT + 1,
          reason: name,
          dir: d,
          levels,
          attempts: precachePrefetched - before,
          budget: PRECACHE_TRIGGER_MAX_URLS,
          base,
          deepest: satLadderDeepest,
        };
        probe.deepest = satLadderDeepest;
      }
    } catch { /* probe cosmetic */ }
    return precachePrefetched - before;
  } catch {
    return precachePrefetched - before;
  } finally {
    precacheLadderActive = false;
  }
}

/* DEM-PRECACHE: warm the Terrarium patches the twin's terrain stages read.
 * The flat map has no raster-dem layer of its own, so this is pure cache work
 * for the twin's first DEM stage (z12 coarse; z15 fine once intent is real) —
 * the page and its same-origin iframe share ONE HTTP cache, so a tile warmed
 * here is a tile the twin's fetch() reads without a network round-trip. Same
 * discipline as the satellite warm: one 3x3 patch per level, hotspot-first,
 * dedupe hits are free, a stepped cap with oldest-first eviction, and a hard
 * per-trigger URL budget. Requests go out as CORS fetches because the twin
 * reads these tiles with fetch() — a no-cors image warm would not be the
 * cache entry its fetch reuses. Best-effort: an offline DEM fetch must never
 * error the journey. */
const DEM_TRIGGER_MAX_URLS = 18; // one trigger: two levels x the 3x3 patch
const DEM_CAP_STEPS = Object.freeze([48, 96]); // stepped warm-set cap (oldest-first beyond it)
const DEM_CAP_STEP_HEADROOM = 6; // step up when the set sits this close to the current cap
const DEM_LADDER_LEVELS = 2; // live integer level + the next along the climb
let demCapStep = 0;
let demLadderActive = false; // a ladder owns the per-trigger budget across its levels
let demTriggerAttempts = 0; // attempted DEM fetches in the CURRENT trigger
let demTriggerName = '';
const demTileSeen = new Set(); // url -> warm (insertion-ordered oldest-first evict)
let demPrefetched = 0;
let demHits = 0;
let demDeepest = -1;
/** Current DEM warm-set cap (the stepped ceiling, never a bare literal). */
function demCapNow() {
  return DEM_CAP_STEPS[demCapStep] | 0;
}
function stepDemCap() {
  if (demCapStep < DEM_CAP_STEPS.length - 1) demCapStep += 1;
}
function demTileUrl(z, x, y) {
  return TERRARIUM_TILE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}
/** Per-level DEM coverage row (warm stamp only; the map never "arrives" at a
 * DEM level, so no arrival column). */
function demLevelRow(z) {
  const p = precacheProbe();
  if (!p) return null;
  try {
    if (!p.dem || typeof p.dem !== 'object') p.dem = {};
    const d = p.dem;
    if (!d.levels || typeof d.levels !== 'object') d.levels = {};
    let row = d.levels[z];
    if (!row) {
      row = { z, warmT: null, attempts: 0 };
      d.levels[z] = row;
    }
    return row;
  } catch {
    return null;
  }
}
/** Pre-fetch the 3x3 Terrarium patch around center at zoom (best-effort).
 * `reason` names the trigger for the probe + the per-level table. Unwrapped
 * calls are their own trigger; warmDemLadder owns ONE budget across levels. */
function prefetchDemTiles(center, zoom, reason) {
  try {
    const z = Math.max(0, Math.min(TERRARIUM_MAXZOOM, Math.floor(+zoom)));
    if (!Number.isFinite(z)) return;
    // Band gate: the twin's terrain stages read Terrarium at the coarse stage
    // (z12) and the fine ceiling (z15) only — a patch below z12 is bytes no
    // stage can read, so the warm never leaves that band.
    if (z < DEM_COARSE_ZOOM) return;
    const c = Array.isArray(center) && center.length === 2 ? center : SITE_LNGLAT;
    if (!Number.isFinite(+c[0]) || !Number.isFinite(+c[1])) return;
    const t = lngLatToTile(c[0], c[1], z);
    const n = Math.pow(2, z);
    if (!demLadderActive) { // an unwrapped patch is its own single trigger
      demTriggerAttempts = 0;
      demTriggerName = reason || 'single';
    }
    let attempts = 0;
    // Hotspot-first: the site tile is the twin's first DEM read.
    const order = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of order) {
      const x = t.x + dx;
      const y = t.y + dy;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= n || y >= n) continue;
      const url = demTileUrl(z, x, y);
      try {
        if (demTileSeen.has(url)) {
          demHits += 1;
          continue;
        }
        // Per-trigger budget: a ladder's levels share it, so one trigger can
        // never exceed DEM_TRIGGER_MAX_URLS (dedupe hits are free).
        if (demTriggerAttempts >= DEM_TRIGGER_MAX_URLS) break;
        demTriggerAttempts += 1;
        attempts += 1;
        demTileSeen.add(url);
        while (demTileSeen.size > demCapNow()) { // stepped cap: oldest-first
          const oldest = demTileSeen.values().next();
          if (oldest && !oldest.done) {
            try { demTileSeen.delete(oldest.value); } catch { break; }
          } else break;
        }
        if (demTileSeen.size >= demCapNow() - DEM_CAP_STEP_HEADROOM) stepDemCap();
        // CORS fetch (not an <img>): the twin reads these with fetch(), so the
        // stored response must be the one a CORS request may reuse. Body is
        // consumed so the entry actually lands; low priority = a speculative
        // warm never contends the live frame.
        try {
          const p = fetch(url, {
            mode: 'cors',
            credentials: 'omit',
            priority: dx === 0 && dy === 0 ? 'high' : 'low',
          });
          p.then((res) => (res && res.ok ? res.arrayBuffer() : null)).catch(() => {});
        } catch { /* preload is best-effort */ }
        demPrefetched += 1;
      } catch { /* per-tile best-effort */ }
    }
    // Only a level that actually cost a fetch mints a warm stamp.
    if (attempts > 0) {
      const row = demLevelRow(z);
      if (row) {
        try {
          if (row.warmT === null) row.warmT = +precacheNowMs().toFixed(1);
          row.attempts = (row.attempts | 0) + attempts;
        } catch { /* probe cosmetic */ }
      }
    }
    try {
      const probe = precacheProbe();
      if (probe) {
        if (!probe.dem || typeof probe.dem !== 'object') probe.dem = {};
        probe.dem.fetched = demPrefetched;
        probe.dem.hits = demHits;
        probe.dem.warm = demTileSeen.size;
        probe.dem.cap = demCapNow();
        probe.dem.capStep = demCapStep;
        probe.dem.deepest = demDeepest;
        probe.dem.trigger = { name: demTriggerName, attempts, budget: DEM_TRIGGER_MAX_URLS };
      }
    } catch { /* probe cosmetic */ }
  } catch { /* DEM precache never breaks the map */ }
}
/** DEM ladder: the live integer level plus the next along the predicted climb
 * (at most DEM_LADDER_LEVELS levels, DEM_TRIGGER_MAX_URLS URLs per call, live
 * level first) — the same shape as warmSatLadder, so intent/level crossings
 * gate both warms with one signal and neither can starve the other. */
function warmDemLadder(center, levelNow, dir, reason) {
  const before = demPrefetched;
  try {
    const base = Math.floor(+levelNow);
    if (!Number.isFinite(base)) return 0;
    const d = dir < 0 ? -1 : 1;
    const name = reason || 'crossing';
    demLadderActive = true;
    demTriggerAttempts = 0;
    demTriggerName = name;
    let levels = 0;
    let deepest = base;
    for (let i = 0; i < DEM_LADDER_LEVELS; i += 1) {
      if (demTriggerAttempts >= DEM_TRIGGER_MAX_URLS) break;
      const z = base + d * i;
      if (z < DEM_COARSE_ZOOM || z > TERRARIUM_MAXZOOM) continue;
      prefetchDemTiles(center, z, name);
      levels += 1;
      deepest = z;
    }
    demDeepest = deepest;
    try {
      const probe = precacheProbe();
      if (probe) {
        if (!probe.dem || typeof probe.dem !== 'object') probe.dem = {};
        const prevT = (probe.dem.ladder && probe.dem.ladder.triggers) | 0;
        probe.dem.ladder = {
          triggers: prevT + 1,
          reason: name,
          dir: d,
          levels,
          attempts: demPrefetched - before,
          budget: DEM_TRIGGER_MAX_URLS,
          base,
          deepest,
        };
        probe.dem.deepest = deepest;
      }
    } catch { /* probe cosmetic */ }
    return demPrefetched - before;
  } catch {
    return demPrefetched - before;
  } finally {
    demLadderActive = false;
  }
}

/* VECTOR-TILE WARM: the vector basemap is MVT tiles named by the LIVE style's
 * own source templates (CARTO positron ships explicit `tiles` templates, so no
 * TileJSON round-trip is needed; the versioned path v/<stamp>/... is read from
 * the style, never hardcoded). Warm the site patch at the live integer zoom so
 * the zoom-out refill reads cache instead of the CDN. A style whose sources
 * expose no template (url-only TileJSON, or no vector source) records the
 * blocker on the probe and warms nothing — never a throw, never a guess. */
const VECTOR_TRIGGER_MAX_URLS = 9; // one trigger: one 3x3 patch
const VECTOR_CAP_STEPS = Object.freeze([32, 64]);
const VECTOR_CAP_STEP_HEADROOM = 4;
let vectorCapStep = 0;
let vectorPrefetched = 0;
let vectorHits = 0;
let lastVectorWarmZ = -1;
const vectorTileSeen = new Set();
function vectorCapNow() {
  return VECTOR_CAP_STEPS[vectorCapStep] | 0;
}
/** Tile templates the live style exposes, with the source maxzoom that bounds
 * them. Reads the RUNTIME source first (a TileJSON `url` source resolves its
 * templates there), then the style JSON. Null when nothing is warmable. */
function vectorTileTemplates() {
  try {
    if (!mapRef || typeof mapRef.getStyle !== 'function') return null;
    const style = mapRef.getStyle();
    const out = [];
    const sources = (style && style.sources) || {};
    for (const id of Object.keys(sources)) {
      const src = sources[id];
      if (!src || src.type !== 'vector') continue;
      let tiles = Array.isArray(src.tiles) ? src.tiles : null;
      let maxzoom = Number.isFinite(+src.maxzoom) ? +src.maxzoom : 15;
      if (!tiles || !tiles.length) {
        try {
          const live = typeof mapRef.getSource === 'function' ? mapRef.getSource(id) : null;
          if (live && Array.isArray(live.tiles) && live.tiles.length) {
            tiles = live.tiles;
            if (Number.isFinite(+live.maxzoom)) maxzoom = +live.maxzoom;
          }
        } catch { /* runtime source read is best-effort */ }
      }
      if (!tiles || !tiles.length) continue;
      for (const t of tiles) {
        if (typeof t === 'string' && t.includes('{z}') && t.includes('{x}') && t.includes('{y}')) {
          out.push({ template: t, maxzoom });
        }
      }
    }
    return out;
  } catch {
    return null;
  }
}
/** Warm the site vector patch at the live integer zoom (best-effort). */
function warmVectorTiles(reason, opts = {}) {
  const before = vectorPrefetched;
  try {
    const templates = vectorTileTemplates();
    const probe = precacheProbe();
    if (!templates || !templates.length) {
      try {
        if (probe) {
          probe.vector = probe.vector || {};
          probe.vector.blocker = 'no vector tile template in the live style (url-only source or no vector source)';
          probe.vector.warm = vectorTileSeen.size;
          probe.vector.fetched = vectorPrefetched;
        }
      } catch { /* probe cosmetic */ }
      return 0;
    }
    let liveZ = 0;
    try { liveZ = Math.floor(+mapRef.getZoom()); } catch { liveZ = 0; }
    if (!Number.isFinite(liveZ)) liveZ = 0;
    // Outbound warms name the TARGET level (the viewport the camera is about
    // to show); the default path follows the live camera as before.
    const warmZ = Number.isFinite(+opts.level) ? Math.floor(+opts.level) : liveZ;
    const levelGate = opts.levelGate !== false;
    const maxUrls = Number.isFinite(+opts.maxUrls) ? Math.max(1, Math.min(64, +opts.maxUrls)) : VECTOR_TRIGGER_MAX_URLS;
    // Visibility gate: the vector basemap is only on screen below the sat fade
    // ceiling (Z_FADE1) — warming vector tiles under full satellite would be
    // bytes no frame can show. Recede re-warms as it descends through the band.
    if (warmZ > Math.ceil(Z_FADE1)) {
      try {
        if (probe) {
          probe.vector = {
            level: warmZ,
            skipped: 'above-vector-band',
            fetched: vectorPrefetched,
            hits: vectorHits,
            warm: vectorTileSeen.size,
          };
        }
      } catch { /* probe cosmetic */ }
      return 0;
    }
    // Level gate: one patch per integer level (a re-warm of the same level is
    // dedupe hits only, so the gate is about not walking the set per tick).
    if (levelGate && warmZ === lastVectorWarmZ && vectorTileSeen.size > 0) {
      try { if (probe) probe.vector = { ...(probe.vector || {}), level: warmZ, hits: vectorHits, fetched: vectorPrefetched, warm: vectorTileSeen.size }; } catch { /* probe cosmetic */ }
      return 0;
    }
    lastVectorWarmZ = warmZ;
    const c = Array.isArray(opts.center) && opts.center.length === 2 ? opts.center : SITE_LNGLAT;
    const t = lngLatToTile(c[0], c[1], Math.max(0, Math.min(15, warmZ)));
    const n = Math.pow(2, Math.max(0, Math.min(15, warmZ)));
    const order = opts.viewport
      ? viewportTileOffsets(opts.wPx, opts.hPx)
      : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let attempts = 0;
    for (const { template, maxzoom } of templates) {
      if (attempts >= maxUrls) break;
      const z = Math.max(0, Math.min(maxzoom, warmZ));
      for (const [dx, dy] of order) {
        if (attempts >= maxUrls) break;
        const x = t.x + dx;
        const y = t.y + dy;
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= n || y >= n) continue;
        const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        try {
          if (vectorTileSeen.has(url)) {
            vectorHits += 1;
            continue;
          }
          vectorTileSeen.add(url);
          attempts += 1;
          while (vectorTileSeen.size > vectorCapNow()) {
            const oldest = vectorTileSeen.values().next();
            if (oldest && !oldest.done) {
              try { vectorTileSeen.delete(oldest.value); } catch { break; }
            } else break;
          }
          if (vectorTileSeen.size >= vectorCapNow() - VECTOR_CAP_STEP_HEADROOM
            && vectorCapStep < VECTOR_CAP_STEPS.length - 1) vectorCapStep += 1;
          // CORS fetch: the vector source reads these with fetch(), so the warm
          // must store a response a CORS request may reuse.
          try {
            const p = fetch(url, {
              mode: 'cors',
              credentials: 'omit',
              priority: opts.lowPriority ? 'low' : (dx === 0 && dy === 0 ? 'high' : 'low'),
            });
            p.then((res) => (res && res.ok ? res.arrayBuffer() : null)).catch(() => {});
          } catch { /* preload is best-effort */ }
          vectorPrefetched += 1;
        } catch { /* per-tile best-effort */ }
      }
    }
    try {
      if (probe) {
        probe.vector = {
          level: warmZ,
          attempts,
          fetched: vectorPrefetched,
          hits: vectorHits,
          warm: vectorTileSeen.size,
          cap: vectorCapNow(),
          reason: reason || null,
          sources: templates.length,
        };
      }
    } catch { /* probe cosmetic */ }
    return vectorPrefetched - before;
  } catch {
    return vectorPrefetched - before;
  }
}

/** Zoom-out warm: the opposite direction of the dive ladder. A lower level
 * is warmed while the camera is still a level above it, using the VIEWPORT
 * patch (not the site 3x3) so the widened world arrives from cache instead of
 * streaming tile-by-tile. One level per integer crossing is enough lead: the
 * next crossing arms the one after it. Low priority — the live frame always
 * outranks the speculative frame. Also warms the vector basemap once the
 * target is inside the visible vector band. Never throws. */
let lastOutboundLevel = null;
let lastOutboundAt = 0;
function warmOutboundLevel(levelNow, reason) {
  try {
    const level = Math.floor(+levelNow);
    if (!Number.isFinite(level)) return 0;
    const now = precacheNowMs();
    if (lastOutboundLevel === level && now - lastOutboundAt < 350) return 0;
    lastOutboundLevel = level;
    lastOutboundAt = now;
    const target = level - 1;
    if (target < MAP_FLOOR || target > PRECACHE_LEVEL_MAX) return 0;
    let center = COUNTRY_CENTER;
    try {
      const c = mapRef && mapRef.getCenter ? mapRef.getCenter() : null;
      if (c && Number.isFinite(+c.lng) && Number.isFinite(+c.lat)) center = [+c.lng, +c.lat];
    } catch { /* center is best-effort */ }
    const fs = frameSize();
    const before = precachePrefetched;
    // Only warm pixels that frame can actually show: satellite is fully faded
    // below Z_FADE0, so low-level sat warms are pure waste (the vector basemap
    // is the visible surface there); vector is invisible under full satellite
    // above the fade. This keeps the outbound budget on the surface that will
    // paint, instead of doubling traffic for layers behind another.
    const satVisible = satOpacityForZoom(target) > 0.02;
    const vectorVisible = target < Z_FADE1;
    if (satVisible) {
      prefetchSatTiles(center, target, reason || 'outbound', {
        viewport: true,
        wPx: fs.w,
        hPx: fs.h,
        lowPriority: true,
      });
    }
    let vector = 0;
    try {
      if (vectorVisible) {
        vector = warmVectorTiles(reason || 'outbound', {
          center,
          level: target,
          viewport: true,
          wPx: fs.w,
          hPx: fs.h,
          levelGate: false,
          maxUrls: 27,
          lowPriority: true,
        });
      }
    } catch { vector = 0; }
    try {
      const p = precacheProbe();
      if (p) {
        p.outbound = {
          level: target,
          from: level,
          sat: precachePrefetched - before,
          vector,
          at: +now.toFixed(1),
        };
      }
    } catch { /* probe cosmetic */ }
    return precachePrefetched - before;
  } catch {
    return 0;
  }
}

/** Detect a zoom-out crossing from the per-step driver and arm the next lower
 * level. Camera direction only — never inferred from wheel sign (a pinch, a
 * click flight and a programmatic ease all converge here). */
let lastDirectionalZoom = null;
function noteZoomDirection(z) {
  try {
    const zz = +z;
    if (!Number.isFinite(zz)) return;
    const prev = lastDirectionalZoom;
    lastDirectionalZoom = zz;
    if (prev == null || !(zz < prev - 1e-4)) return;
    if (zz < MAP_FLOOR + 0.001) return;
    warmOutboundLevel(zz, 'outbound');
  } catch { /* direction note never breaks the driver */ }
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
    let liveZoom = NaN;
    try {
      liveZoom = mapRef ? +mapRef.getZoom() : NaN;
      if (Number.isFinite(liveZoom)) levelNow = Math.floor(liveZoom);
    } catch { levelNow = -1; }
    /* LADDER-DEPTH intent latch: the mask arm (or a hotspot near/in view) is
     * the per-dive warm intent. The tick publishes proximity one frame ahead
     * of this read at worst — a latched boolean, so staleness costs nothing.
     * On the arm edge (and only there) warm the live level + the next two
     * around the site; intent loss re-arms the latch and clears the per-dive
     * coverage table. */
    let intentOn = false;
    let warmedThisTick = false; // one trigger per tick: the budget is per trigger
    try {
      const prox = window.__mapProbe.proximity;
      intentOn = !!(prox && prox.armed) && Number.isFinite(liveZoom) && liveZoom >= Z_FAR_INTENT - 0.5;
    } catch { intentOn = false; }
    if (!intentOn) {
      if (satLadderDive) {
        satLadderDive = false;
        resetPrecacheLevels(); // next dive reads a clean coverage table
      }
    } else if (!satLadderDive) {
      satLadderDive = true;
      resetPrecacheLevels();
      if (levelNow !== -1) {
        try {
          noteSatLevelArrival(levelNow, now);
          warmSatLadder(SITE_LNGLAT, levelNow, precVel < -0.05 ? -1 : 1, 'intent');
          warmedThisTick = true; // one ladder per tick: no crossing ladder this frame
        } catch { /* intent ladder is best-effort */ }
      }
    } else if (levelNow !== -1 && levelNow !== lastPrecLevel) {
      // Level crossing: snapshot coverage BEFORE warming (was the patch warm
      // when the camera got here?), then ladder the live level + two ahead.
      try {
        noteSatLevelArrival(levelNow, now);
      } catch { /* arrival snapshot is best-effort */ }
    }
    if (Math.abs(pPred - lastPrefetchPred) >= PRECACHE_MIN_P_DELTA || now - lastPrefetchT >= PRECACHE_MIN_MS || levelNow !== lastPrecLevel) {
      const crossed = !warmedThisTick && levelNow !== -1 && lastPrecLevel !== -1 && levelNow !== lastPrecLevel;
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
      if (warmedThisTick) {
        // The intent ladder owns this tick's budget (see above): nothing to
        // add here, the gate bookkeeping above already advanced.
      } else if (crossed && intentOn && levelNow >= Math.floor(Z_FAR_INTENT) - 1) {
        // Level crossing on an armed dive: the ladder owns this trigger
        // (live + two ahead along the predicted climb, <= 27 URLs).
        warmSatLadder(SITE_LNGLAT, levelNow, precVel < -0.05 ? -1 : 1, 'crossing');
        // DEM-PRECACHE: the same crossing trigger, its own 18-URL budget
        // (live level + the next along the climb) — never the sat budget.
        try { warmDemLadder(SITE_LNGLAT, levelNow, precVel < -0.05 ? -1 : 1, 'crossing'); } catch { /* warm is best-effort */ }
      } else {
        prefetchSatTiles(predCenter, predZoom, 'predict');
      }
      if (Math.abs(precVel) > 0.5) holdVectorWarm('predict');
    }
  } catch { /* precache never breaks the map */ }
}

/** CLICK FLIGHT — the arrival pose for a click that starts BELOW the gate.
 * One law, no fit heuristics: the site dead centre, the handoff gate zoom,
 * the shared pitch law at that zoom (45 through the handoff), bearing flat.
 * The same pose the scroll path ends on, so the twin is handed a frame it can
 * superimpose on (the old wide ring fit handed it a pose the gesture never
 * reached). */
function clickArrivalPose() {
  const z = Z_HANDOFF;
  return {
    cx: SITE_LNGLAT[0],
    cy: SITE_LNGLAT[1],
    z,
    pitch: pitchTargetForZoom(z),
    bearing: 0,
  };
}

/** Live click flight? True until the move lands (or is superseded). */
function clickFlightActive() {
  if (!clickFlight) return false;
  let now = Date.now();
  try {
    if (typeof performance !== 'undefined' && performance.now) now = performance.now();
  } catch { now = Date.now(); }
  return now < clickFlight.t0 + clickFlight.ms;
}

/** Start the click flight: ONE continuous camera move (live pose -> arrival
 * pose) that the eye can follow, with the prewarm booting underneath it. The
 * pitch rides pitchTargetForZoom on the same move (no second writer), so the
 * iso tilt arrives with the zoom instead of snapping at the end. `essential`
 * keeps the animation running regardless of the OS motion query — reduced
 * motion is handled here by keeping the discrete cut instead. Never throws;
 * returns true when a real flight is running. */
function startClickFlight(dest, reduced) {
  try {
    clickFlight = null;
    if (!mapRef || !dest) return false;
    if (reduced) {
      // Reduced motion: one honest cut to the SAME arrival pose (no animation
      // by request) — never the old wide fit, so the twin frame still matches.
      mapRef.jumpTo({
        center: [dest.cx, dest.cy], zoom: dest.z, pitch: dest.pitch, bearing: dest.bearing,
      });
      try { window.__mapProbe.clickFlight = { reduced: true, z: +dest.z.toFixed(2) }; } catch { /* probe cosmetic */ }
      return false;
    }
    let t0 = Date.now();
    try {
      if (typeof performance !== 'undefined' && performance.now) t0 = performance.now();
    } catch { t0 = Date.now(); }
    clickFlight = { t0, ms: CLICK_FLIGHT_MS, timer: null };
    try {
      window.__mapProbe.clickFlight = {
        reduced: false, ms: CLICK_FLIGHT_MS, z: +dest.z.toFixed(2), from: liveCamFrame(),
      };
    } catch { /* probe cosmetic */ }
    try {
      // easeTo supersedes any glide still running under the click (it stops
      // the previous ease itself) — the click owns the camera from here.
      mapRef.easeTo({
        center: [dest.cx, dest.cy],
        zoom: dest.z,
        bearing: dest.bearing,
        pitch: dest.pitch,
        duration: CLICK_FLIGHT_MS,
        essential: true,
        easing: smooth01,
      });
    } catch (err) {
      clickFlight = null;
      errors.push('CLICK-FLIGHT: ' + (err && err.message));
      return false;
    }
    return true;
  } catch (err) {
    clickFlight = null;
    errors.push('CLICK-FLIGHT: ' + (err && err.message));
    return false;
  }
}

/** Defer the timed reveal to the flight's landing: the crossfade must land on
 * the pose the twin was handed, not fade in over a moving camera. The prewarm
 * is already booting under the flight, so this defers the FADE only — the
 * click->twin time is unchanged (the flight is shorter than the boot). */
function deferRevealToFlightLand() {
  try {
    if (!clickFlight || clickFlight.timer) return;
    let now = Date.now();
    try {
      if (typeof performance !== 'undefined' && performance.now) now = performance.now();
    } catch { now = Date.now(); }
    const wait = Math.max(0, Math.round(clickFlight.t0 + clickFlight.ms - now)) + 16;
    clickFlight.timer = setTimeout(() => {
      try {
        if (clickFlight) clickFlight.timer = null;
        if (!pendingReveal || pendingReveal.revealed) return;
        revealTwin(false);
      } catch { /* deferred reveal is best-effort */ }
    }, wait);
  } catch { /* deferral is best-effort */ }
}

/** AUTO-ARRIVAL S: the user stopped at the gate; the twin has released; the
 * hold must not wait for one more wheel notch. Feed the same S law from a
 * frame clock (pure dt -> S), pausing while the stall owns the frame and
 * while fingers are active. Any reverse stops it (the user is leaving); the
 * commit path stops it when S_MAX lands. Never throws. */
function startStagedAutoPump() {
  if (stagedAutoOn) return;
  if (typeof requestAnimationFrame !== 'function') return;
  stagedAutoOn = true;
  let last = nowMs();
  const step = () => {
    if (!stagedAutoOn) return;
    try {
      if (!stagedActive || stagedCommitted || receding) {
        stagedAutoOn = false;
        return;
      }
      const now = nowMs();
      const dt = Math.min(80, Math.max(0, now - last));
      last = now;
      let z = NaN;
      try { z = mapRef ? +mapRef.getZoom() : NaN; } catch { z = NaN; }
      // The arrival seat owns the gate; below it the flight/gesture still
      // travels, so the pump waits instead of advancing S over a moving frame.
      if (!(z >= Z_HANDOFF - 0.01)) {
        requestAnimationFrame(step);
        return;
      }
      let holding = false;
      try { holding = stallArmed(); } catch { holding = false; }
      let hardExpired = false;
      try { hardExpired = stagedActive && !stagedCommitted && stallWaitMs() >= HARD_STOP_HOLD_MS; } catch { hardExpired = false; }
      if (holding && !hardExpired) {
        try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
        try { driveStagedOverlay(); } catch { /* frozen repaint is best-effort */ }
        requestAnimationFrame(step);
        return;
      }
      // RELEASE-GATED, not just content-gated: a painted/tile-ready twin still
      // has not applied the handed pose (base parity) and its intro has not
      // reached the release. Advancing S there would run the law to 1 under a
      // zero opacity and commit as a cut on release. The pump holds at the
      // gate until the consumer is actually released, then dissolves. The
      // hard-stop cap keeps a dead frame from parking the pump forever.
      let released = false;
      try { released = twinReleased(); } catch { released = false; }
      if (!released && !hardExpired) {
        try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
        requestAnimationFrame(step);
        return;
      }
      try {
        const parity = stagedBaseParityCheck(true, released);
        if (parity && parity.gate) {
          try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
          requestAnimationFrame(step);
          return;
        }
      } catch { /* parity read is best-effort */ }
      // Active fingers own S; the pump resumes only after the wheel settles.
      if (lastStagedInputMs > 0 && now - lastStagedInputMs < STAGED_AUTO_IDLE_MS) {
        requestAnimationFrame(step);
        return;
      }
      if (stagedS < HANDOFF_STAGED_S_MAX - STAGED_AUTO_STOP_EPS_PX) {
        stagedS = autoStagedSForDt(stagedS, dt, { durationMs: CLICK_DISSOLVE_MS });
        try { driveStagedOverlay(); } catch { /* staged drive is best-effort */ }
        try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
      }
      if (!stagedActive || stagedCommitted) {
        stagedAutoOn = false;
        return;
      }
      requestAnimationFrame(step);
    } catch {
      stagedAutoOn = false;
    }
  };
  try { requestAnimationFrame(step); } catch { stagedAutoOn = false; }
}
function stopStagedAutoPump() {
  stagedAutoOn = false;
}

/** Promote a CLICK arrival (or any explicit arrival) into the SAME staged
 * enclosure hold the scroll path uses. The prewarm already booted under the
 * flight; this arms the gate state on the landing frame, paints the seam
 * enclosure and lets the shared auto-S pump finish the dissolve once the twin
 * releases. It must never run while the camera is still flying. */
function armStagedHoldAtGate(id, frame, opts = {}) {
  try {
    const s = sectors.find((x) => x.id === id);
    if (!s || !mapRef) return false;
    if (stagedActive && !stagedCommitted) return true; // already holding
    try { mapRef.setMaxZoom(Z_HANDOFF); } catch { /* clamp is best-effort */ }
    stagedActive = true;
    // The click (and any explicit arrival) lands ON the gate; seal both
    // bounds now so the first wheel tick after the hold cannot move the map.
    try { lockStagedZoomAtGate(); } catch { /* lock is best-effort */ }
    stagedS = 0;
    stagedCommitted = false;
    stagedHanded = null;
    stagedFeedFwd = true;
    stagedTilesT0 = nowMs();
    stagedTilesGranted = false;
    contentVerdictFalseMs = 0;
    contentVerdictIgnored = false;
    baseParityFalseMs = 0;
    baseParityIgnored = false;
    stagedPostCur = 0;
    stagedCommitRetryT = 0;
    lastPostedStagedS = null;
    lastStagedInputMs = 0; // no finger owns S yet: the arrival pump may finish
    try { freezeStagedFrame(); } catch { /* freeze is best-effort */ }
    // GATE-ANCHORED SCALE: the staged frame must be the LIVE gate frame, not
    // the frame captured when the dive armed. The arm frame is earlier in the
    // climb (measured z10.67 vs gate 11.5); the twin measures its opening
    // range from the handed z, so booting from the arm frame made the 10 km
    // ring ~1.78x too small under the 512.5 px mask — the owner's "scale
    // mismatch between states". Pin the live gate z on every hold; the twin
    // re-pins its hold range to it through an arrival retarget below.
    const gateFrame = liveFrame();
    if (gateFrame) {
      gateFrame.cx = SITE_LNGLAT[0];
      gateFrame.cy = SITE_LNGLAT[1];
      try {
        const zLive = +mapRef.getZoom();
        if (Number.isFinite(zLive)) gateFrame.z = zLive;
      } catch { /* live zoom is best-effort */ }
    }
    const stagedFrame = gateFrame || frame || liveFrame();
    stagedHanded = stagedFrame && Number.isFinite(+stagedFrame.z)
      ? { z: +stagedFrame.z, cx: +stagedFrame.cx, cy: +stagedFrame.cy }
      : null;
    // Reuse the booted shell; the initial staged prewarm under the click
    // already opened it. Only arm the reveal record when there is none (a
    // direct arrival that did not prewarm) — re-running prewarmThenReveal
    // here would reset a paint/ready grant the warm frame already posted.
    // Either way the live shell must re-pin to the GATE frame (arrival
    // retarget), never keep the arm frame's range.
    let gateRetargeted = false;
    if (twinOpen && pendingReveal && overlayEls && overlayEls.frame) {
      try {
        const win = overlayEls.frame.contentWindow;
        const probe = win && win.__ring2;
        if (probe && typeof probe.handoffPhase === 'function' && probe.handoffPhase() === 'hold') {
          const msg = buildTwinRetargetMessage(stagedFrame);
          if (msg) {
            msg.arrival = true;
            win.postMessage(msg, '*');
            gateRetargeted = true;
            window.__mapProbe.gateRetarget = { z: stagedFrame.z, at: nowMs() };
          }
        }
      } catch { /* gate retarget is best-effort */ }
    }
    if (!gateRetargeted) {
      // No live hold shell to re-pin: arm the arrival through the normal
      // prewarm (a cold navigation is still exact; a stale warm range is
      // not). This is the only path that resets grants at the gate.
      prewarmThenReveal(id, stagedFrame || liveFrame(), { ...opts, staged: true });
    }
    try { pumpIsoPitch(); } catch { /* pump is best-effort */ }
    try {
      scrubRenderTarget = 0;
      scrubRenderShown = 0;
      const ov = document.getElementById('twin-overlay');
      if (ov && ov.style.opacity !== '0') ov.style.opacity = '0';
    } catch { /* follower seed is best-effort */ }
    // Seam enclosure: the click path skipped the wash during the flight, so
    // paint the gate's projected seam now — the same shape the scroll hold
    // shows at the gate.
    try {
      const proxNow = proximityInfo();
      const entry = writeEnclosureEllipse(proxNow, Z_HANDOFF);
      entryRx = entry && Number.isFinite(entry.rx) ? +entry.rx.toFixed(1) : null;
      entryRy = entry && Number.isFinite(entry.ry) ? +entry.ry.toFixed(1) : null;
      entryCy = entry && Number.isFinite(entry.cy) ? +entry.cy.toFixed(1) : null;
      showVignette(true);
    } catch { /* enclosure paint is best-effort */ }
    try {
      window.__mapProbe.staged = { active: true, s: 0, committed: false, source: opts.source || 'click' };
      window.__mapProbe.stagedHanded = stagedHanded ? { ...stagedHanded } : null;
    } catch { /* probe cosmetic */ }
    try { armRevealFallback(); } catch { /* idle fallback is best-effort */ }
    try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
    startStagedAutoPump();
    return true;
  } catch {
    return false;
  }
}

/** Arm the click hold on the landing frame, never mid-flight. The sequence
 * token makes a stale timer harmless after Esc/re-entry. */
function scheduleClickStagedArm(id, frame, opts = {}) {
  try {
    if (!clickFlight) return;
    const seq = clickStagedSeq;
    let now = Date.now();
    try {
      if (typeof performance !== 'undefined' && performance.now) now = performance.now();
    } catch { now = Date.now(); }
    const wait = Math.max(0, Math.round(clickFlight.t0 + clickFlight.ms - now)) + 8;
    clickArmTimer = setTimeout(() => {
      try {
        if (seq !== clickStagedSeq || !clickStagedPending) return;
        if (!twinOpen || !pendingReveal || pendingReveal.revealed) return;
        const ok = armStagedHoldAtGate(id, frame, { ...opts, source: 'click', replace: true });
        clickStagedPending = false;
        if (!ok) {
          // The hold could not arm (map/frame gone): never leave the pending
          // bit blocking the ordinary reveal — fall back to the timed path.
          try { revealTwin(false); } catch { /* fallback reveal is best-effort */ }
        }
      } catch { /* arm is best-effort; the map stays live */ }
    }, wait);
  } catch { /* scheduling is best-effort */ }
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
  // UNWIND LAW: the click/pin entry is the other way a dive starts — record
  // the frame it leaves BEFORE the jump/flight moves the camera, so Esc from
  // any state it reaches returns here.
  try { noteDiveFrame('click'); } catch { /* dive frame is best-effort */ }
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
  if (transitId || clickFlightActive()) return false;
  // Live arrival: native zoom owns z — read it, never set it on this path.
  let liveZ = null;
  try {
    liveZ = +mapRef.getZoom();
  } catch {
    liveZ = null;
  }
  // STAGING STARTS AT THE GATE. The old checkpoint arm (Z_TOP) left one
  // whole level of native camera zoom to run AFTER the enclosure existed —
  // the owner's intermittent "map inside the mask zooms" sighting. Gate-only
  // staging makes the held mask a still plate from its first frame. The
  // prewarm still starts at mask intent, so this costs no boot lead.
  const deep = Number.isFinite(liveZ) && liveZ >= Z_HANDOFF - 0.01;
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
  // Reduced-motion never stages (no scroll-driven dissolve to follow) — the
  // unstaged prewarm below reveals instantly inside prewarmThenReveal. Read
  // before the entry so the click flight knows whether to animate.
  let reducedMotion = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { /* cosmetic */ }
  // CLICK FLIGHT state for THIS entry: a click below the gate flies in.
  let clickFlying = false;
  let clickDest = null;
  try {
    if (!deep) {
      // CLICK ENTRY (owner rev): the click is EXPLICIT INTENT, so the arrival
      // is ONE continuous camera move from the live pose to the site at the
      // gate — never the old duration-0 jump to a wide ring fit, which the
      // owner could not see at all (the map was already somewhere else by the
      // first painted frame). The prewarm boots UNDER the flight, so the twin
      // never waits on it; the reveal waits only for the landing (see
      // revealTwin). Reduced motion keeps one honest cut to the same pose.
      clickDest = clickArrivalPose();
      clickFlying = startClickFlight(clickDest, reducedMotion);
      // The arrival pose is what this entry ends on — the probe, the staged
      // seed and the handed twin frame all read the destination, not the
      // pre-flight live pose.
      liveZ = +clickDest.z;
    }
  } catch { /* flight is best-effort; the prewarm below still opens */ }
  try {
    // Forward-path sat: PURE function of z (the scrub law) — never the timed
    // setSatForced ramp. Past the fade band this is already ~1 (asserted by
    // every zoom step); the re-assert covers the reduced-motion cut. During a
    // click flight the per-zoom-step driver scrubs it along the move instead:
    // asserting the destination here would snap the whole world to satellite
    // while the camera is still wide.
    if (!clickFlying) {
      try {
        setSatScrubbed(satOpacityForZoom(Number.isFinite(liveZ) ? liveZ : Z_HANDOFF));
      } catch { /* sat stage is best-effort */ }
    }
    const proxNow = proximityInfo();
    const nearNow = !!(proxNow && proxNow.armed);
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
    // CLICK FLIGHT: the frame here is still the PRE-FLIGHT camera (the move
    // has only just been issued), so its projection/radii would be the wide
    // pose's, not the arrival's — the reveal tick re-derives both from the
    // landed camera instead (see revealTwin), so nothing is written now.
    if (nearNow && !clickFlying) {
      try {
        // Wash opens at the true radius after jumps — never the stale size or
        // the 260px initial. The return is cached as the staged-entry radii:
        // the hold ring blends entry->seam on scroll (no snap when arrival
        // lands below the handoff).
        const entry = writeEnclosureEllipse(proxNow, Number.isFinite(liveZ) ? liveZ : Z_HANDOFF);
        try {
          entryRx = entry && Number.isFinite(entry.rx) ? +entry.rx.toFixed(1) : null;
          entryRy = entry && Number.isFinite(entry.ry) ? +entry.ry.toFixed(1) : null;
          entryCy = entry && Number.isFinite(entry.cy) ? +entry.cy.toFixed(1) : null;
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
        ? { z: +liveZ.toFixed(2), scrub: +handoffScrubForZoom(liveZ).toFixed(4), staged: deep && !reducedMotion, flight: clickFlying }
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
        entryCy = null;
      }
      try {
        if (mapRef && typeof mapRef.setMaxZoom === 'function') mapRef.setMaxZoom(Z_HANDOFF);
      } catch { /* clamp is best-effort */ }
      stagedActive = true;
      // If this arrival is already AT the gate, seal it now; a climb that
      // stages at Z_TOP keeps its last level of native zoom and the per-step
      // driver seals the instant z reaches Z_HANDOFF.
      try { lockStagedZoomAtGate(); } catch { /* lock is best-effort */ }
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
      contentVerdictFalseMs = 0; contentVerdictIgnored = false;
      // SEAM POP: the parity gate and the eased post are per-hold state — a
      // fresh hold starts with nothing applied, no patience spent and nothing
      // posted.
      baseParityFalseMs = 0; baseParityIgnored = false;
      stagedPostCur = 0; stagedCommitRetryT = 0; stagedFeedFwd = true;
      try {
        pumpIsoPitch(); // live-hold carry: keep the per-frame tilt pump running under the clamp (it now converges the S-driven hold tilt, never parks on the prewarm)
      } catch { /* pump is best-effort */ }
      try {
        // Fresh hold renders from the 0 floor: reset the dissolve follower so
        // no eased value from the last hold leaks into this arm, and pin the
        // inline 0 synchronously (prewarm stylesheet agrees — no flash).
        scrubRenderTarget = 0; scrubRenderShown = 0;
        const ov = document.getElementById('twin-overlay');
        if (ov && ov.style.opacity !== '0') ov.style.opacity = '0';
      } catch { /* follower seed is best-effort */ }
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
        // GATE-ANCHORED SCALE + POLAR: this arm runs at the deep checkpoint
        // (measured z10.67), but the hold it starts ends at the gate. Handing
        // the checkpoint z made the twin measure its opening range from a
        // lower zoom (10 km ring ~1.78x too small under the 512.5 px mask at
        // 11.5) and hold at the shallow-frame polar instead of the gate's
        // iso. Hand the GATE frame — the pose the reveal actually opens on.
        stagedFrame.z = Z_HANDOFF;
      }
      // SEAM POP: remember exactly the frame this hold HANDS OVER (SITE-centered,
      // gate zoom). The base-parity gate compares the twin's OWN satellite base
      // against this — not against whatever the map's zoom reads later.
      stagedHanded = stagedFrame && Number.isFinite(+stagedFrame.z)
        ? { z: +stagedFrame.z, cx: +stagedFrame.cx, cy: +stagedFrame.cy }
        : null;
      try {
        window.__mapProbe.stagedHanded = stagedHanded ? { ...stagedHanded } : null;
      } catch { /* probe cosmetic */ }
      prewarmThenReveal(id, stagedFrame || liveFrame(), { ...opts, staged: true });
      // HARD-STOP idle poll: one fallback slide so content detection retries
      // even with no scroll ticks (the staged branch never blind-reveals;
      // each fire re-drives the frozen hold and refreshes the loader, so the
      // pill clears when content lands even if the fingers are still).
      try { armRevealFallback(); } catch { /* poll is best-effort */ }
      try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
      startStagedAutoPump();
    } else {
      // CLICK FLIGHT: hand the twin the ARRIVAL pose the camera is flying to
      // (the site at the gate), not the pre-flight live frame — the twin
      // boots on the pose the flight lands on, so the crossfade superimposes.
      // A click is the same intent as a scroll arrival: boot staged (no timed
      // fallback), then promote to the SAME gate enclosure + S-dissolve on
      // the landing frame (scheduleClickStagedArm). `clickStagedPending`
      // suppresses any ready/paint reveal that lands mid-flight.
      const clickFrame = clickFlying && clickDest ? clickDest : liveFrame();
      if (clickFlying) {
        clickStagedPending = true;
        clickStagedSeq += 1;
        if (clickArmTimer) {
          try { clearTimeout(clickArmTimer); } catch { /* timer teardown is best-effort */ }
          clickArmTimer = null;
        }
        prewarmThenReveal(id, clickFrame, { ...opts, staged: true });
        scheduleClickStagedArm(id, clickFrame, opts);
      } else {
        prewarmThenReveal(id, clickFrame, opts);
      }
    }
  } finally {
    transitId = null;
    window.__mapProbe.transit = null;
  }
  return true;
}

/** Enclosure zoom lock: at the converged handoff the map is a STILL plate.
 * The scroll owns the plane (S) and the twin; depth must not move at all —
 * not in (maxZoom already clamped) and not OUT (the hole the owner saw as
 * "the map inside the mask becomes zoomable"). Pin both bounds at the gate;
 * `applyStallCeiling` may re-pin the ceiling while holding, but the min bound
 * keeps the floor sealed until a staged exit/close releases it. */
function lockStagedZoomAtGate() {
  try {
    if (!mapRef || stagedZoomLocked) return false;
    let z = NaN;
    try { z = +mapRef.getZoom(); } catch { z = NaN; }
    if (!(z >= Z_HANDOFF - 0.02)) return false;
    if (typeof mapRef.setMaxZoom === 'function') mapRef.setMaxZoom(Z_HANDOFF);
    if (typeof mapRef.setMinZoom === 'function') mapRef.setMinZoom(Z_HANDOFF);
    stagedZoomLocked = true;
    lastCeilingPin = Z_HANDOFF;
    try {
      window.__mapProbe.stagedZoomLock = { locked: true, min: Z_HANDOFF, max: Z_HANDOFF, z: +z.toFixed(3) };
    } catch { /* probe cosmetic */ }
    return true;
  } catch {
    return false;
  }
}

/** Release the enclosure zoom lock on every staged exit/close/unwind. Sets
 * the floor FIRST so the max write can never transiently invert the bounds. */
function releaseStagedZoomLock() {
  if (!stagedZoomLocked) return false;
  stagedZoomLocked = false;
  try {
    if (mapRef && typeof mapRef.setMinZoom === 'function') mapRef.setMinZoom(MAP_FLOOR);
    if (mapRef && typeof mapRef.setMaxZoom === 'function') mapRef.setMaxZoom(Z_MAX);
    lastCeilingPin = Z_MAX;
    try {
      window.__mapProbe.stagedZoomLock = { locked: false, min: MAP_FLOOR, max: Z_MAX };
    } catch { /* probe cosmetic */ }
    return true;
  } catch {
    return false;
  }
}

/** Task-35 staged-scrub helpers: restore the native zoom ceiling (unclamp).
 * Idempotent — safe from every staged exit path. The enclosure lock keeps its
 * own max bound while active, so a stall-ceiling release can never unseal the
 * upper bound under a held mask. */
function restoreMaxZoom() {
  try {
    const cap = stagedZoomLocked ? Z_HANDOFF : Z_MAX;
    if (mapRef && typeof mapRef.setMaxZoom === 'function') mapRef.setMaxZoom(cap);
    lastCeilingPin = cap; // the pin cache follows every ceiling write
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

/** Grant-time re-hand: adopt the fingers' live frame into the staged anchor,
 * never move the camera. A grant (ready/painted) can land mid-hold while a
 * native zoom ease is still travelling toward the gate — a jumpTo here
 * (center or depth) calls MapLibre's stop(), kills that ease, and parks
 * depth short of the gate under an opaque overlay (measured: 700px of S
 * advancing depth 0.15 levels, limit cycle z 10.511<->10.663, then a
 * release-starved eject to z 1.13). The twin already rides the live frame
 * (the grant-time S re-emit posts live S + live zoom), so the anchor only
 * needs to agree with it — depth adopts live, center stays on SITE (the
 * freeze seat + takeover center law own pan). Returns drift px (>=0) for
 * the probe, or -1 when unreadable.
 */
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
    // ADOPT-ONLY: the anchor follows the fingers, never leads them. Any
    // jumpTo here — depth back to the entry zoom, center back to the
    // anchor — calls MapLibre's stop() and kills the native zoom ease the
    // fingers just started, parking depth below the gate (the measured
    // grant-time snap z 10.74->10.52 is this write). The twin already rides
    // the live frame via the grant-time S re-emit, so agreement means the
    // anchor adopts live depth. Center is not adopted (it stays SITE by
    // construction — the freeze seat + center laws own pan, not the anchor).
    if (zDrift > 0.02) {
      try {
        if (Number.isFinite(z)) {
          stagedAnchor.z = z;
          reasserted = true;
        }
      } catch { /* adopt is best-effort */ }
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
 * the fingers instead of its autoplay clock. The value posted is the EASED
 * follower (pumpStagedPostS), never the raw per-notch law — that is what makes
 * the forward melt glide (see STAGED_POST_EASE). Deduped on value change
 * (lastPostedStagedS, STAGED_POST_VALUE_EPS_PX) so a gliding follower posts
 * once per frame; mirrors the postTwinReverseRequest pattern (contentWindow +
 * '*' — same-origin iframe). The twin consumes it through its existing staged
 * listener; with no twin/no frame this is a silent no-op and autoplay still
 * owns the intro. Never throws. */
function postTwinStagedS(sPost) {
  try {
    if (!stagedActive || stagedCommitted) return false;
    const raw = Number(sPost);
    const s = Number.isFinite(raw) ? Math.max(0, raw) : Math.max(0, +stagedS || 0);
    if (lastPostedStagedS !== null && Math.abs(s - lastPostedStagedS) < STAGED_POST_VALUE_EPS_PX) return false;
    let nowPost = 0;
    try {
      nowPost = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    } catch { nowPost = Date.now(); }
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

/** EASED S STREAM (stair steps): the twin's melt is a pure function of the S
 * WE POST, so posting the raw per-notch law made the forward mix stair-step
 * 0,35,50,75,87,100 over seven wheel ticks while the reverse retraced
 * continuously — one direction glided, the other stepped. The fix is on this
 * side of the wire only: stagedS stays the exact law (probe, commit, the hold
 * laws and the release watch all read it) and this pump advances a follower
 * (stagedPostCur) toward it every animation frame, posting each step. Same
 * tempo as the opacity follower (STAGED_POST_FOLLOW, ~120ms), reduced motion
 * jumps, and the follower self-stops with the hold. It also LAND THE CUT: once
 * the eased post has reached S max the twin has finished its melt, so a commit
 * left waiting on it is retried here (the fingers may already have stopped,
 * and no further tick would ever retry it). Never throws. */
function pumpStagedPostS(snapToLaw = false) {
  try {
    if (snapToLaw) stagedPostCur = Math.max(0, +stagedS || 0);
    if (stagedPostPumpOn) return;
    if (typeof requestAnimationFrame !== 'function') {
      // No frame clock (headless/odd host): post the law directly rather than
      // starving the twin of S entirely — correctness over smoothness.
      stagedPostCur = Math.max(0, +stagedS || 0);
      postTwinStagedS(stagedPostCur);
      return;
    }
    stagedPostPumpOn = true;
    const frame = () => {
      try {
        const alive = stagedActive && !stagedCommitted;
        if (!alive) { stagedPostPumpOn = false; return; }
        let reduce = false;
        try {
          reduce = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch { reduce = false; }
        stagedPostCur = stagedPostStep({ cur: stagedPostCur, target: stagedS, reduce });
        postTwinStagedS(stagedPostCur);
        try {
          window.__mapProbe.stagedPostEased = +stagedPostCur.toFixed(2);
        } catch { /* probe cosmetic */ }
        // LAND THE CUT (see above): the eased post owns the last ~120ms of the
        // melt, so the commit waits on it here rather than on the fingers.
        try {
          if (stagedS >= HANDOFF_STAGED_S_MAX - STAGED_POST_EPS_PX && stagedPostSettled({ cur: stagedPostCur })) {
            let nowR = 0;
            try {
              nowR = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            } catch { nowR = Date.now(); }
            // Bounded retry cadence: the commit path can jumpTo a recovery
            // park, so it must not run on every frame of a standing hold.
            if (nowR - stagedCommitRetryT >= STAGED_COMMIT_RETRY_MS) {
              stagedCommitRetryT = nowR;
              driveStagedOverlay();
            }
          }
        } catch { /* commit retry is best-effort */ }
      } catch { /* pump never breaks the frame */ }
      try {
        requestAnimationFrame(frame);
      } catch {
        stagedPostPumpOn = false;
      }
    };
    try {
      requestAnimationFrame(frame);
    } catch {
      stagedPostPumpOn = false;
    }
  } catch { /* producer never breaks the drive */ }
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
      // Reveal continuity: the blend's entry endpoint tracks the live zoom
      // until the camera actually reaches the handoff. The twin can be
      // granted early (prewarm) — freezing the entry on grant left the ring
      // at ~280 while the map travelled the last level to a 512px ring
      // (measured: static circle, zooming terrain = the owner's report).
      // Below the gate, refresh from the live law every tick; at the gate the
      // entry is pinned to the seam, so the S-sweep holds the twin clip and
      // the mask does not grow during the fade.
      let atGate = false;
      try { atGate = +mapRef.getZoom() >= Z_HANDOFF - 0.01; } catch { atGate = false; }
      try {
        const grantedHold = !!(window.__mapProbe && (window.__mapProbe.twinReady || window.__mapProbe.twinPainted));
        if (!grantedHold || !atGate) {
          let zLive = NaN;
          try { zLive = +mapRef.getZoom(); } catch { zLive = NaN; }
          const proxLive = proximityInfo();
          if (Number.isFinite(zLive) && proxLive) {
            if (proxLive.armed) {
              const e = writeEnclosureEllipse(proxLive, zLive);
              if (e && Number.isFinite(e.rx) && e.rx > 0) {
                entryRx = +e.rx.toFixed(1); entryRy = +e.ry.toFixed(1);
                entryCy = Number.isFinite(e.cy) ? +e.cy.toFixed(1) : 0;
              }
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
              const ec = enclosureEllipsePxForZoom(zLive, SITE.lat, MAP_VIGNETTE_RING_M, corner, chh);
              if (ec && Number.isFinite(ec.rx) && ec.rx > 0) {
                entryRx = +ec.rx.toFixed(1); entryRy = +ec.ry.toFixed(1);
                entryCy = Number.isFinite(ec.cy) ? +ec.cy.toFixed(1) : 0;
              }
            }
          }
        }
      } catch { /* entry refresh is best-effort; stale entry still blends */ }
      const seam = seamHoldEllipseForS(stagedS, frameSize().h);
      if (seam && atGate) {
        // At the gate the mask IS the twin clip: pin the entry to the seam so
        // the S-sweep cannot grow the ring during the fade (the entry caches
        // one tick behind the camera; without this it lags the seam by ~20px).
        entryRx = +seam.rx.toFixed(1);
        entryRy = +seam.ry.toFixed(1);
        entryCy = Number.isFinite(seam.cy) ? +seam.cy.toFixed(1) : 0;
      }
      if (seam && Number.isFinite(seam.rx) && Number.isFinite(seam.ry) && seam.rx > 0) {
        const rev = clamp01(st && Number.isFinite(st.reveal) ? st.reveal : 0);
        const eRx = Number.isFinite(entryRx) && entryRx > 0 ? entryRx : seam.rx;
        const eRy = Number.isFinite(entryRy) && entryRy > 0 ? entryRy : seam.ry;
        const eCy = Number.isFinite(entryCy) ? entryCy : (Number.isFinite(seam.cy) ? seam.cy : 0);
        const sCy = Number.isFinite(seam.cy) ? seam.cy : 0;
        const rx = (eRx * (1 - rev) + seam.rx * rev) * (1 - ringClose);
        const ry = (eRy * (1 - rev) + seam.ry * rev) * (1 - ringClose);
        const cy = (eCy * (1 - rev) + sCy * rev) * (1 - ringClose);
        const holdVr = rx.toFixed(1) + 'px';
        const holdVrY = ry.toFixed(1) + 'px';
        if (lastVrWritten !== holdVr) { app.style.setProperty('--vr', holdVr); lastVrWritten = holdVr; }
        if (lastVrYWritten !== holdVrY) { app.style.setProperty('--vr-y', holdVrY); lastVrYWritten = holdVrY; }
        // The hold owns the vertical centre too: the projected ellipse's cy
        // rides the same entry->seam reveal blend, so the mask's centre and
        // the twin clip's centre stay identical through the dissolve.
        try {
          const sp = mapRef.project(SITE_LNGLAT);
          if (sp && Number.isFinite(+sp.y)) {
            const vyStr = Math.round(+sp.y + cy) + 'px';
            if (lastVyWritten !== vyStr) { app.style.setProperty('--vy', vyStr); lastVyWritten = vyStr; }
          }
        } catch { /* hold centre is best-effort */ }
        try {
          window.__mapProbe.vignetteR = +rx.toFixed(1);
          window.__mapProbe.vignetteRy = +ry.toFixed(1);
          window.__mapProbe.vignetteCy = +cy.toFixed(1);
        } catch { /* probe cosmetic */ }
      }
    }
  } catch { /* hold ring is best-effort */ }
  // (b2) NO per-tick center pin: the freeze seat (arm tick) + the takeover
  // center law + the canvas-center flip anchor already keep the frame on
  // SITE, and every source of lateral drift they leave is finger-owned.
  // An unconditional jumpTo({center}) on every staged tick calls MapLibre's
  // stop(), which kills the native zoom ease the fingers just started:
  // measured 700px of staged S moving depth only 0.15 levels (limit cycle
  // z 10.511<->10.663), so the scale-near gate never reads true, S
  // saturates under a 100%-opaque overlay, and the release watch ejects the
  // dive (release-starved, 2.6s) to z 1.13. The S-max near-fail recovery
  // below stays the single invisible backstop; nothing here moves the
  // camera mid-hold.
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

/** SEAM POP reader: the twin frame's OWN satellite base. The twin is a
 * same-origin iframe and exposes window.__ring2.map (the LiveMap under the 3D
 * draw), so the map side can read the pose the dissolve would open over
 * instead of assuming it applied. Unreadable (no frame, about:blank, booting
 * map) returns null — the caller treats that as no parity, never as approval.
 * Never throws. */
function twinBasePose() {
  try {
    const fr = overlayEls && overlayEls.frame;
    if (!fr || fr.getAttribute('data-url') === 'about:blank') return null;
    const win = fr.contentWindow;
    const r2 = win && win.__ring2;
    const m = r2 && r2.map;
    if (!m || typeof m.getZoom !== 'function' || typeof m.getCenter !== 'function') return null;
    const z = +m.getZoom();
    const c = m.getCenter();
    if (!Number.isFinite(z) || !c || !Number.isFinite(+c.lng) || !Number.isFinite(+c.lat)) return null;
    return { z, lng: +c.lng, lat: +c.lat };
  } catch {
    return null;
  }
}

/** The zoom the dissolve is actually DRAWN OVER (parity target). The arm-time
 * frame z is the arrival's ENTRY depth — the staged edge fires at the iso
 * checkpoint and the clamp then holds the map at Z_HANDOFF for the whole band,
 * so the clip (and the twin base the frame re-derives from our posts) sits at
 * the gate, not at the entry zoom. Read the live (clamped) zoom and fall back
 * to the handed frame. Never throws. */
function stagedBaseTargetZ() {
  let live = NaN;
  try { live = mapRef ? +mapRef.getZoom() : NaN; } catch { live = NaN; }
  if (Number.isFinite(live)) return Math.min(Z_HANDOFF, live);
  return stagedHanded && Number.isFinite(+stagedHanded.z) ? +stagedHanded.z : NaN;
}

/** SEAM POP verdict + patience: has the twin's base APPLIED the frame this hold
 * handed it (stagedHanded — SITE-centered, gate zoom)? Forward only: reverse
 * never waits on this, because the drain must never be gated by the thing it is
 * retreating from. Bounded exactly like the pixel verdict — a base that stays
 * behind buys BASE_PARITY_HOLD_MS, then the gate releases flagged, so a dead or
 * wedged frame can never park the dive. Publishes the read values for the
 * probe. Never throws. */
function stagedBaseParityCheck(inBand = false, released = false) {
  const pose = twinBasePose();
  const handed = stagedHanded;
  const targetZ = stagedBaseTargetZ();
  const v = stagedBaseParity({
    handedZ: targetZ,
    handedLng: handed ? +handed.cx : NaN,
    handedLat: handed ? +handed.cy : NaN,
    baseZ: pose ? pose.z : NaN,
    baseLng: pose ? pose.lng : NaN,
    baseLat: pose ? pose.lat : NaN,
  });
  const now = nowMs();
  let waitMs = 0;
  // Patience runs while the gate can actually be satisfied FAILING: inside the
  // band, with the frame's base readable. It is bounded whether or not the
  // twin has released yet, because the FEEDER now freezes S on this gate too
  // (a pre-release wait that never expired would park the forward scroll with
  // nothing to escape it). Past BASE_PARITY_HOLD_MS the gate releases flagged,
  // so a frame that never applies the pose can never park the dive; the
  // tiles/grant hold still owns an absent frame.
  if (inBand && v.readable && !v.ok) {
    if (baseParityFalseMs === 0) baseParityFalseMs = now;
    waitMs = Math.max(0, now - baseParityFalseMs);
    if (waitMs >= BASE_PARITY_HOLD_MS) baseParityIgnored = true;
  } else if (v.ok) {
    baseParityFalseMs = 0;
    baseParityIgnored = false;
  }
  // GATE: inside the band only, forward only, readable only, and only while it
  // has not been ignored.
  const gate = inBand && !!handed && v.readable && !v.ok && !baseParityIgnored && stagedFeedFwd;
  return {
    ...v,
    handed: handed ? { z: +handed.z, cx: +handed.cx, cy: +handed.cy } : null,
    read: pose,
    targetZ: Number.isFinite(targetZ) ? +targetZ.toFixed(3) : null,
    waitMs: Math.round(waitMs),
    ignored: baseParityIgnored,
    feedFwd: stagedFeedFwd,
    gate,
  };
}

/** RE-ENTRANCY GUARD: driveStagedOverlay is called from the wheel feeder, the
 * grant handlers, the idle fallback and the eased-S pump (which retries the
 * commit once the post has landed). The wrapper makes nested calls no-ops
 * instead of re-running the hold writes or the commit path mid-commit. */
function driveStagedOverlay() {
  if (stagedDriveBusy) return;
  stagedDriveBusy = true;
  try {
    return driveStagedOverlayInner();
  } finally {
    stagedDriveBusy = false;
  }
}

/** Drive the staged overlay dissolve from accumulated scroll S. Twin TILE
 * readiness GRANTS the ramp (opacity stays 0 until the twin holds real
 * tiles, then follows the law); past a bounded hold the ramp releases
 * anyway, flagged, so dead frames never stall the fingers. The S law owns
 * the progress — a fast twin still dissolves on the fingers, never its own
 * rhythm — so the law stays a pure function of S and only the written
 * opacity is gated. At full reveal the hold commits (finalizeStagedReveal).
 * Pure-law in, DOM out. */
function driveStagedOverlayInner() {
  if (!stagedActive || stagedCommitted) return;
  // RELEASE-IMPOSSIBLE WATCH: sampled on every drive (it also self-chains at
  // 200ms while armed, so a hold with idle fingers is still bounded). Firing
  // here means the dive was just unwound — stop driving.
  try {
    if (releaseWatchTick()) return;
  } catch { /* watch never breaks the drive */ }
  // Task-37: feed S to the twin on every drive — moved below the effective
  // ramp (the eased pump needs to know whether the dissolve is still invisible
  // so a grant-time re-emit may snap instead of glide).
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
  // DISSOLVE FOLLOWER eases the rendered inline value toward the law's
  // target every animation frame (pumpScrubOpacity). The law's value IS the
  // target on every tick; the rendered value glides instead of stair-stepping
  // (~0.14 per wheel notch). Commit/unwind paths release or clear the inline
  // value as before — the follower self-stops when the hold ends.
  const scrubWrite = (v) => {
    try {
      if (!root.classList.contains('scrubbing')) root.classList.add('scrubbing');
      const n = +v;
      if (!Number.isFinite(n)) return;
      scrubRenderTarget = Math.min(1, Math.max(0, n));
      pumpScrubOpacity();
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
  // SEAM POP (apply order): the twin's own satellite base applies the handed
  // frame a beat AFTER the band opens, so a dissolve that rose on the S law
  // alone opened over the PREVIOUS zoom's imagery and popped when the base
  // snapped (measured on the frozen base: overlay 0 -> 0.131 at base z10.908
  // inside the z11.5 clip, base corrected two ticks later). The S laws are
  // untouched; only the written ramp waits: 0 until the frame's base has
  // APPLIED the handed zoom/centre, then the law. Forward only (reverse never
  // waits on the thing it is retreating from) and bounded by BASE_PARITY_HOLD_MS,
  // so a frame that never applies it releases flagged instead of parking the
  // dive — the commit gate below samples parity live as well.
  let parity = null;
  const releasedNow = (() => { try { return twinReleased(); } catch { return false; } })();
  try {
    parity = stagedBaseParityCheck(st.reveal > 0, releasedNow);
  } catch { parity = null; }
  const parityHold = !!(parity && parity.gate);
  // EASED S STREAM: post the follower (one eased step per animation frame,
  // ~120ms), never the raw per-notch law — the twin's melt reads what we post.
  // stagedS itself stays exact for the probe/commit/laws. A re-emit forced by
  // a grant (lastPostedStagedS reset) snaps while the dissolve is still
  // invisible, so a boot-raced stream seeds the twin with the true S at once.
  try {
    pumpStagedPostS(lastPostedStagedS === null && tilesHold);
  } catch { /* producer never breaks the drive */ }
  // Effective ramp: the law when granted — and only once the twin's base has
  // applied the handed frame — 0 while either holds. Single writer: every
  // opacity value on this path goes through scrubWrite (transition suspended,
  // synchronous inline write) — revealTwin's timed leg is barred mid-hold
  // (see its guard), so no second writer can ease against the law.
  const effReveal = (tilesHold || parityHold) ? 0 : st.reveal;
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
      // SEAM POP probe: the verdict AND the values it was read from, so the
      // apply-order defect is measurable from outside (first visible tick =>
      // baseParity true, baseZ within STAGED_BASE_Z_TOL of the handed z).
      baseParity: parity ? !!parity.ok : null,
      baseGate: parityHold,
      baseZ: parity && parity.read ? +parity.read.z.toFixed(4) : null,
      baseCenter: parity && parity.read ? [+parity.read.lng.toFixed(6), +parity.read.lat.toFixed(6)] : null,
      handedZ: parity && Number.isFinite(parity.targetZ) ? parity.targetZ : null,
      armZ: parity && parity.handed ? parity.handed.z : null,
      baseDz: parity && Number.isFinite(parity.dz) ? +parity.dz.toFixed(4) : null,
      baseCenterM: parity && Number.isFinite(parity.centerM) ? +parity.centerM.toFixed(2) : null,
      baseWaitMs: parity ? parity.waitMs : 0,
      baseIgnored: parity ? !!parity.ignored : false,
      feedFwd: parity ? !!parity.feedFwd : null,
      postS: +stagedPostCur.toFixed(2),
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
    // SEAM POP: never cut while the twin's base still trails the handed pose —
    // a commit over a stale base pops the seam at exactly the frame the overlay
    // goes opaque. Bounded by the same patience as the ramp gate above, so a
    // frame that never applies it releases flagged (baseIgnored) and the cut
    // still lands.
    if (parityHold) {
      scrubWrite('0');
      try {
        window.__mapProbe.staged.baseHold = true;
        window.__mapProbe.staged.postWait = false;
      } catch { /* probe cosmetic */ }
      return;
    }
    // EASED-POST SETTLE: the cut may only land once the POSTED S has reached S
    // max. The melt follows the eased post (~120ms behind the fingers), so a
    // commit that outran it would cut away the last steps of the crossfade the
    // fingers paid for. The eased pump retries this path the moment the post
    // lands, so standing fingers still commit with no extra scroll.
    if (!stagedPostSettled({ cur: stagedPostCur })) {
      scrubWrite(String(+effReveal.toFixed(4)));
      try {
        window.__mapProbe.staged.baseHold = false;
        window.__mapProbe.staged.postWait = true;
      } catch { /* probe cosmetic */ }
      try { pumpStagedPostS(); } catch { /* pump retries the commit */ }
      return;
    }
    const hasContent = twinFrameHasContent();
    let proxNear = false;
    try {
      const proxGate = proximityInfo();
      proxNear = !!(proxGate && proxGate.armed);
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
          // Depth recovery parks on the GATE, never the entry zoom: the
          // anchor froze at staging-arm depth (~10.5) and re-parking there
          // pins the frame below the gate permanently (measured limit cycle
          // z 10.511<->10.663 -> release-starved -> eject to z 1.13). The
          // overlay is opaque at S-max so the correction is invisible; the
          // next tick reads near and the commit lands.
          if (!scaleNear) jump.zoom = Z_HANDOFF;
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
    // PIXEL VERDICT: idle + live is not enough — a twin that has settled its
    // tiles while pointed at the wrong world paints black (coverage 0). The
    // twin folds its own readback through its single content law and reports
    // contentOk; a false or withheld verdict (null) keeps the hold instead of
    // committing blind. The staged long-cap fallback still bounds the hold.
    let ok =
      !!c.mapIdle &&
      !!c.sceneLive &&
      Number.isFinite(c.frames) &&
      c.frames >= TWIN_MIN_CONTENT_FRAMES;
    // BOUNDED: the pixel verdict may only delay a commit briefly. It caught a
    // real bug (boot-pose commit painted black), but as an unbounded gate it
    // turns a blank sample into a 30s deadlock with no escape — measured on
    // the gallery path. So it buys CONTENT_VERDICT_HOLD_MS of patience, then
    // the journey proceeds and the failure is recorded rather than hidden.
    if (ok && c.contentOk === false) {
      if (contentVerdictFalseMs === 0) contentVerdictFalseMs = nowMs();
      const waited = nowMs() - contentVerdictFalseMs;
      if (waited < CONTENT_VERDICT_HOLD_MS) ok = false;
      else contentVerdictIgnored = true;
    } else if (c.contentOk === true) {
      contentVerdictFalseMs = 0;
      contentVerdictIgnored = false;
    }
    try {
      window.__mapProbe.twinContent = {
        loaded: !!c.mapIdle,
        sceneLive: !!c.sceneLive,
        frames: c.frames,
        coverage: c.coverage ?? null,
        spread: c.spread ?? null,
        contentOk: c.contentOk ?? null,
        ignored: contentVerdictIgnored,
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
  // The commit lands on the gate: keep the map plate sealed under the twin.
  // doCloseTwin is the release point (a committed twin still owns the frame).
  try { lockStagedZoomAtGate(); } catch { /* lock is best-effort */ }
  stopStagedAutoPump();
  clickStagedPending = false;
  stagedCommitted = true;
  stagedActive = false;
  stagedTilesT0 = 0; // HARD-STOP: commit disarms the hold (loader already cleared by content)
  stagedTilesGranted = false; // HYSTERESIS: commit consumes the grant — the next hold restages cold
  contentVerdictFalseMs = 0;
  baseParityFalseMs = 0; baseParityIgnored = false; // SEAM POP: the parity wait dies with the hold
  stagedPostCur = 0; // eased post ends with the S stream
  stagedCommitRetryT = 0;
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
  // Release the enclosure seal BEFORE restoring the ceiling: the reverse exit
  // must hand the fingers a map that can zoom out again.
  try { releaseStagedZoomLock(); } catch { /* unlock is best-effort */ }
  // Head start for the way out: warm the level below while the release still
  // has the gate on screen. The per-step detector will continue the ladder.
  try { warmOutboundLevel(Z_HANDOFF, 'exit'); } catch { /* warm is best-effort */ }
  stopStagedAutoPump();
  stagedActive = false;
  stagedS = 0;
  stagedCommitted = false;
  stagedTilesT0 = 0; // HARD-STOP: unwind disarms the hold
  stagedTilesGranted = false; // HYSTERESIS: unwind consumes the grant — the next hold restages cold
  contentVerdictFalseMs = 0;
  baseParityFalseMs = 0; baseParityIgnored = false; // SEAM POP: unwind releases the parity wait
  stagedPostCur = 0; stagedCommitRetryT = 0; // eased post ends with the S stream
  stagedHanded = null;
  entryRx = null; // unwind clears the entry radii — the next hold re-caches its own arrival
  entryRy = null;
  entryCy = null;
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

/* ===== UNWIND LAW (Phase-03 resilience half) ==============================
 * The dive is cumulative: intent lock -> staged arm -> dissolve ramp ->
 * commit, and each state owns a slice of the camera plus a slice of the
 * pending-work set (hold clock, ceiling pin, prewarm timer, reverse-wait
 * timer, live iframe). Measured failures proved that ONE slice left behind
 * traps the page: Esc was ignored for the whole session once a stale
 * reverse-wait stayed armed, Esc was ignored whenever the pointer/focus sat
 * outside the map iframe (gallery embeds this page), and a staged hold could
 * park 30s waiting for a twin release that could never arrive.
 *
 * So the escape is ONE function with one contract:
 *   unwindDive(reason) drives ANY state back to the frame the dive left.
 * Idempotent, it always clears the pending-work set, always restores the
 * recorded camera, and always publishes why on the probe. New waits must
 * route their exit through it (the release watch does).
 */
let diveCam = null; // the frame this dive left (center/zoom/pitch/bearing)
let diveCamAt = 0;
const FRAME_BOOT_GRACE_MS = 600; // a just-armed prewarm may still be navigating
let unwindLast = null; // mirrored on the probe (__mapProbe.unwind)
let unwindActive = false; // inside unwindDive: the close chain must not restore twice
let closeSource = null; // 'esc' when the ordinary close chain was started by an Escape (probe reason)

/** Live camera frame, or null when the map is not readable yet. Never throws. */
function liveCamFrame() {
  try {
    if (!mapRef) return null;
    const c = mapRef.getCenter();
    if (!c || !Number.isFinite(+c.lng) || !Number.isFinite(+c.lat)) return null;
    const z = +mapRef.getZoom();
    const p = +mapRef.getPitch();
    const b = +mapRef.getBearing();
    return {
      center: { lng: +c.lng, lat: +c.lat },
      zoom: Number.isFinite(z) ? z : null,
      pitch: Number.isFinite(p) ? p : null,
      bearing: Number.isFinite(b) ? b : null,
    };
  } catch { return null; }
}

/** Is any part of the dive live right now? Used by the escape routing and by
 * the dive-frame capture (a dive in progress must never overwrite the frame
 * it left). Never throws. */
function diveInProgress() {
  try {
    if (twinOpen || stagedActive || stagedCommitted || pendingReveal) return true;
    if (transitId || reverseWait || receding) return true;
    if (stagedS > 0 || stagedFrozen || stallCeilingOn || isoRestoreDue) return true;
    return !!stallArmed();
  } catch { return false; }
}

/** Record the frame a dive leaves. Captured on forward intent BEFORE any
 * camera write, and only while the camera still SITS on the recorded frame:
 * once it has moved, the dive owns that frame and no later tick may overwrite
 * it (a mid-dive pause is not a new dive). */
function noteDiveFrame(reason = 'forward') {
  try {
    if (diveInProgress()) return false;
    const cam = liveCamFrame();
    if (!cam) return false;
    if (diveCam) {
      const dz = cam.zoom == null || diveCam.zoom == null ? 0 : Math.abs(cam.zoom - diveCam.zoom);
      const dc = cam.center && diveCam.center
        ? Math.max(Math.abs(cam.center.lng - diveCam.center.lng), Math.abs(cam.center.lat - diveCam.center.lat))
        : 0;
      if (dz > 0.01 || dc > 1e-4) return false; // camera left the frame: dive is under way
    }
    diveCam = { ...cam, reason, at: nowMs() };
    diveCamAt = diveCam.at;
    try {
      window.__mapProbe.diveCam = {
        zoom: cam.zoom == null ? null : +cam.zoom.toFixed(3),
        pitch: cam.pitch == null ? null : +cam.pitch.toFixed(2),
        bearing: cam.bearing == null ? null : +cam.bearing.toFixed(2),
        center: cam.center,
        reason,
      };
    } catch { /* probe cosmetic */ }
    return true;
  } catch { return false; }
}

/** Snapshot of every state the unwind has to clear (published on the probe so
 * a harness can prove which pathological state it escaped from). */
function escapeStateSnapshot() {
  let overlayVisible = false;
  try { overlayVisible = !!(overlayEls && overlayEls.root && !overlayEls.root.hidden); } catch { overlayVisible = false; }
  let stall = null;
  try {
    const s = window.__mapProbe.stall;
    if (s) stall = { holding: !!s.holding, phase: s.phase, waitMs: s.waitMs };
  } catch { stall = null; }
  return {
    twinOpen: !!twinOpen,
    staged: !!stagedActive,
    stagedS: +((+stagedS || 0)).toFixed(1),
    committed: !!stagedCommitted,
    prewarm: !!pendingReveal,
    reverseWait: !!reverseWait,
    transit: !!transitId,
    intentLock: !!stagedFrozen,
    ceilingPinned: !!stallCeilingOn,
    overlayVisible,
    stall,
  };
}

/** Restore the frame the dive left: center/zoom/pitch/bearing in one instant
 * jump (no timer owns camera motion on this path — scroll-pure rule), then
 * re-derive the zoom-keyed chrome (imagery, enclosure, journey flags) so the
 * restored frame renders exactly as it did before the dive. Never throws. */
function restoreDiveCam(reason = 'unwind') {
  const cam = diveCam;
  if (!cam || !mapRef) return false;
  // The restore IS the landing — drop any gesture-owned recede armed by
  // recedeToHome (otherwise it keeps waiting on fingers that never come).
  receding = false;
  recedeDone = false;
  recedeLandHome = null;
  try { showVectorHold(false); } catch { /* veil teardown is best-effort */ }
  const target = {};
  if (cam.center && Number.isFinite(+cam.center.lng) && Number.isFinite(+cam.center.lat)) {
    target.center = [+cam.center.lng, +cam.center.lat];
  }
  if (Number.isFinite(cam.zoom)) target.zoom = cam.zoom;
  if (Number.isFinite(cam.pitch)) target.pitch = cam.pitch;
  if (Number.isFinite(cam.bearing)) target.bearing = cam.bearing;
  let jumpErr = null;
  try {
    mapRef.jumpTo(target);
  } catch (err) {
    jumpErr = err && err.message;
    errors.push('UNWIND-CAM: ' + jumpErr);
  }
  // Ceilings the hold may have pinned (stall pin / staged clamp).
  stallCeilingOn = false;
  lastCeilingPin = null;
  stallT0 = 0;
  try { releaseStagedZoomLock(); } catch { /* unlock is best-effort */ }
  try { restoreMaxZoom(); } catch { /* unclamp is best-effort */ }
  const landed = liveCamFrame();
  const zLand = landed && Number.isFinite(landed.zoom) ? landed.zoom : cam.zoom;
  // Imagery + chrome follow the restored zoom (the journey pose is gone).
  try { if (Number.isFinite(zLand)) setSatScrubbed(satOpacityForZoom(zLand)); } catch { /* sat is best-effort */ }
  try { showVignette(false); } catch { /* cosmetic */ }
  try { isoScrubOwned = false; isoRestoreDue = false; } catch { /* flags are best-effort */ }
  try { resetScrubJourney(); } catch { /* reset never breaks the unwind */ }
  try {
    window.__mapProbe.recede = 'home';
    window.__mapProbe.mapZoom = Number.isFinite(zLand) ? +zLand.toFixed(2) : null;
    window.__mapProbe.vectorReturnMs = 0;
    window.__mapProbe.diveCam = null;
  } catch { /* probe cosmetic */ }
  const out = {
    reason,
    target: {
      zoom: cam.zoom == null ? null : +cam.zoom.toFixed(3),
      pitch: cam.pitch == null ? null : +cam.pitch.toFixed(2),
      bearing: cam.bearing == null ? null : +cam.bearing.toFixed(2),
      center: cam.center,
    },
    landed: landed
      ? {
        zoom: landed.zoom == null ? null : +landed.zoom.toFixed(3),
        pitch: landed.pitch == null ? null : +landed.pitch.toFixed(2),
        bearing: landed.bearing == null ? null : +landed.bearing.toFixed(2),
        center: landed.center,
      }
      : null,
    exact: !!(landed && landed.zoom != null && cam.zoom != null && Math.abs(landed.zoom - cam.zoom) <= 0.001),
    jumpErr,
  };
  diveCam = null;
  diveCamAt = 0;
  return out;
}

/** Hide + blank the twin layers without the close theatre (used when the
 * overlay is mounted but no twin is open, e.g. a fork-resolved hold). */
function quiesceTwinLayers() {
  try {
    clickStagedSeq += 1;
    clickStagedPending = false;
    if (clickArmTimer) clearTimeout(clickArmTimer);
    clickArmTimer = null;
    stopStagedAutoPump();
    if (overlayEls && overlayEls.root) {
      overlayEls.root.hidden = true;
      overlayEls.root.classList.remove('closing');
      overlayEls.root.classList.remove('prewarm');
      overlayEls.root.classList.remove('scrubbing');
      try { overlayEls.root.style.opacity = ''; } catch { /* inline release is best-effort */ }
      try { if (overlayEls.root.style.pointerEvents === 'none') overlayEls.root.style.pointerEvents = ''; } catch { /* pointer restore is best-effort */ }
      try { setFrameUrl(overlayEls.frame, 'about:blank'); } catch { /* frame teardown is best-effort */ }
    } else {
      const root = document.getElementById('twin-overlay');
      if (root) root.hidden = true;
    }
  } catch { /* overlay teardown is best-effort */ }
  try { document.body.classList.remove('twin-open'); } catch { /* chrome class is cosmetic */ }
  twinOpen = false;
  twinBootKey = null;
  try {
    window.__mapProbe.twinOpen = false;
    window.__mapProbe.prewarm = false;
    window.__mapProbe.twinReady = false;
    window.__mapProbe.twinPainted = false;
    window.__mapProbe.reveal = null;
    window.__mapProbe.revealFallback = false;
    window.__mapProbe.revealLate = false;
    window.__mapProbe.revealPaint = false;
    window.__mapProbe.handoff = null;
    window.__mapProbe.twinBootKey = null;
    window.__mapProbe.staged = { active: false, s: 0, committed: false };
  } catch { /* probe cosmetic */ }
  try { history.replaceState(null, '', mapUrlWithSector(null)); } catch { /* history is best-effort */ }
}

/** Flags-only staged reset for the close chain: a committed twin must not
 * leave `stagedCommitted` (or a parked S) behind after its overlay is gone,
 * or a later slow reverse can keep reading a stage that no longer exists.
 * Never touches the camera, overlay, or prewarm — doCloseTwin owns those. */
function resetStagedOwnership() {
  stopStagedAutoPump();
  stagedActive = false;
  stagedS = 0;
  stagedCommitted = false;
  stagedTilesT0 = 0;
  stagedTilesGranted = false;
  contentVerdictFalseMs = 0;
  baseParityFalseMs = 0;
  baseParityIgnored = false;
  stagedPostCur = 0;
  stagedCommitRetryT = 0;
  stagedHanded = null;
  entryRx = null; entryRy = null; entryCy = null;
  lastPostedStagedS = null;
  try { window.__mapProbe.staged = { active: false, s: 0, committed: false }; } catch { /* probe cosmetic */ }
}

/** THE ESCAPE. Drives every dive state (intent lock, staged hold, dissolve
 * ramp, stalled arm, parked ceiling, mid-commit, committed twin) back to the
 * pre-dive camera with the twin closed and every staged flag cleared.
 * Idempotent — a second Esc on an already-unwound map is a quiet no-op.
 * Returns the unwind record (also published on __mapProbe.unwind). */
function unwindDive(reason = 'esc', opts = {}) {
  const t0 = nowMs();
  const from = escapeStateSnapshot();
  const restore = opts.restore !== false;
  unwindActive = true;
  try { window.__mapProbe.escRequests = (+window.__mapProbe.escRequests || 0) + 1; } catch { /* probe cosmetic */ }
  // (1) PENDING-WORK SET — every timer/wait the dive can own. The reverse
  // wait is first: a timer that bailed on its seq guard used to leave
  // reverseWait armed forever, and closeTwin() returns early while it holds —
  // that alone made Esc a permanent no-op (measured).
  try { clearReverseWait(); } catch { /* timer teardown is best-effort */ }
  try { releaseWatchDisarm(); } catch { /* watch teardown is best-effort */ }
  try {
    if (pendingReveal && pendingReveal.timer) clearTimeout(pendingReveal.timer);
  } catch { /* timer teardown is best-effort */ }
  pendingReveal = null;
  // CLICK FLIGHT: the escape owns the camera (restoreDiveCam jumpTo's the
  // pre-dive frame, which stops the ease) — drop the flight record and its
  // deferred reveal so no later entry is refused by a stale in-flight window.
  try {
    if (clickFlight && clickFlight.timer) clearTimeout(clickFlight.timer);
  } catch { /* timer teardown is best-effort */ }
  clickFlight = null;
  // CLICK STAGING: a stale arm timer must never promote a dive the escape
  // already tore down. Bump the token, drop the pending bit and the timer.
  clickStagedSeq += 1;
  clickStagedPending = false;
  try {
    if (clickArmTimer) clearTimeout(clickArmTimer);
  } catch { /* timer teardown is best-effort */ }
  clickArmTimer = null;
  stopStagedAutoPump();
  try { if (stallPollT) clearTimeout(stallPollT); } catch { /* timer teardown is best-effort */ }
  stallPollT = 0;
  stallT0 = 0;
  contentVerdictFalseMs = 0;
  contentVerdictIgnored = false;
  // (2) STAGED FLAGS + the clamp/hold they own (exitStaged is idempotent and
  // does the unlock, unclamp, overlay release, quiet prewarm teardown, and
  // clears the S/grant/entry-radii/committed flags — single writer, no
  // duplicate resets here).
  try { exitStaged(); } catch { /* staged unwind is best-effort */ }
  stallCeilingOn = false;
  lastCeilingPin = null;
  try { unfreezeStagedFrame(); } catch { /* unlock is best-effort */ }
  // (3) TWIN LAYERS — the close theatre only when a twin is actually open;
  // anything else is a quiet teardown (a fork-resolved hold leaks otherwise).
  // A mid-retrace Esc lands here with the overlay mounted but twinOpen
  // false: end the zoom-keyed dissolve (hide + blank, no camera move — the
  // restore below owns the camera, and the dive record is already consumed).
  try { if (retraceDissolve) endRetraceDissolve(); } catch { /* dissolve teardown is best-effort */ }
  if (twinOpen) {
    try { finishTwinClose(); } catch (err) { errors.push('UNWIND-CLOSE: ' + (err && err.message)); }
  }
  let overlayVisible = false;
  try { overlayVisible = !!(overlayEls && overlayEls.root && !overlayEls.root.hidden); } catch { overlayVisible = false; }
  if (twinOpen || overlayVisible) {
    try { quiesceTwinLayers(); } catch { /* teardown is best-effort */ }
  }
  // (4) CAMERA — back to the frame this dive left (zoom/pitch/bearing/pan).
  let restored = null;
  if (restore) {
    try { restored = restoreDiveCam(reason); } catch (err) { errors.push('UNWIND-RESTORE: ' + (err && err.message)); }
  }
  // (5) PROBE — name the reason, what was left, what came back.
  const rec = publishUnwind(reason, opts.source || null, restored, from, t0);
  unwindActive = false;
  try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
  return rec;
}

/** Publish one unwind record (single writer for the probe + the module copy).
 * Used by the escape path AND by the ordinary close chain, so every way out of
 * a dive reports the same shape: reason, what it left, what came back. */
function publishUnwind(reason, source, restored, from, t0) {
  const rec = {
    reason,
    source: source || null,
    at: Math.round(t0 == null ? nowMs() : t0),
    ms: Math.round(nowMs() - (t0 == null ? nowMs() : t0)),
    from: from || null,
    restored: restored || null,
    ok: !!(restored && restored.exact),
  };
  unwindLast = rec;
  try {
    window.__mapProbe.unwind = rec;
    window.__mapProbe.unwindCount = (+window.__mapProbe.unwindCount || 0) + 1;
  } catch { /* probe cosmetic */ }
  return rec;
}

/** Esc routing (map + same-origin parent document). True when Esc was
 * consumed by the dive. A HEALTHY committed twin keeps its reverse walk
 * (product: the twin retraces its stages, bounded by TWIN_REVERSE_WAIT_MS);
 * every other state — held, stalled, unreadable, mid-dissolve, mid-commit —
 * unwinds immediately, because there is no walk to wait for. */
function escapeKeyDown(e, source) {
  try {
    if (!e || e.key !== 'Escape') return false;
    if (e.defaultPrevented) return false;
    const t = e.target;
    try {
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false;
    } catch { /* target read is best-effort */ }
    let healthy = false;
    try { healthy = !!(twinOpen && !stagedActive && !stallArmed() && twinFrameHasContent()); } catch { healthy = false; }
    if (!healthy && !diveInProgress()) return false;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    try { window.__mapProbe.escSource = source; } catch { /* probe cosmetic */ }
    if (healthy) {
      closeSource = 'esc'; // the probe names the close an Escape even when the twin walks back first
      if (reverseWait) {
        // A reverse walk is already in flight: a second Esc takes the cut
        // immediately instead of waiting out the walk (an Esc that answers
        // nothing is the exact failure this law exists to remove).
        try { clearReverseWait(); } catch { /* timer teardown is best-effort */ }
        try { finishTwinClose(); } catch { /* close is best-effort */ }
        return true;
      }
      closeTwin(); // reverse-first: the twin walks back, teardown + restore follow
      return true;
    }
    unwindDive('esc-' + source, { source: 'esc' });
    return true;
  } catch { return false; }
}

/** Esc must work when focus sits OUTSIDE this iframe: the gallery embeds the
 * map, so a key pressed over the page chrome never reaches this window. The
 * parent is same-origin (our own mount page), so hook its document too —
 * defensively, and only while a dive is live (escapeKeyDown no-ops otherwise).
 * A cross-origin embed simply keeps the map-window behaviour. */
function installParentEscapeHook() {
  try {
    if (!window.parent || window.parent === window) return false;
    const pdoc = window.parent.document; // throws when cross-origin
    if (!pdoc) return false;
    if (pdoc.__safepipeEscHook) return true;
    pdoc.__safepipeEscHook = true;
    pdoc.addEventListener('keydown', (e) => { escapeKeyDown(e, 'parent'); }, true);
    try { window.__mapProbe.escParentHook = true; } catch { /* probe cosmetic */ }
    return true;
  } catch {
    try { window.__mapProbe.escParentHook = false; } catch { /* probe cosmetic */ }
    return false;
  }
}

/* ===== RELEASE-IMPOSSIBLE WATCH ==========================================
 * The staged hold freezes forward S until the twin reports content, and the
 * twin's intro is scrubbed BY that same S. When the twin's release cannot
 * arrive (no frame, JS never came up, parked in hold, or released-but-never-
 * idle because the camera only moves on the S we are holding) the two sides
 * wait on each other and the map parks until HARD_STOP_HOLD_MS (30s). This
 * watch samples the pure law every 200ms while the hold is un-granted and
 * unwinds the dive with the named reason ~2.6s in — an order of magnitude
 * before the hard stop, and far past a healthy grant. */
let releaseWatchOn = false;
let releaseWatchTimer = 0;
let releaseWatchHoldT = 0; // when the CURRENT frozen-S wait started
let releaseWatchS = NaN;
let releaseWatchFrames = -1; // last seen twin frame count (progress signal)
let releaseWatchZ = NaN; // last seen depth (progress signal for a granted hold)
let lastStagedInputMs = 0; // last staged wheel input (pressure, not progress)
const RELEASE_WATCH_POLL_MS = 200;
// A pause is not a dead end: release reasons need forward pressure this fresh.
const STAGED_PRESS_MS = 400;

function releaseWatchDisarm() {
  releaseWatchOn = false;
  releaseWatchHoldT = 0;
  releaseWatchS = NaN;
  releaseWatchFrames = -1;
  releaseWatchZ = NaN;
  try {
    if (releaseWatchTimer) clearTimeout(releaseWatchTimer);
  } catch { /* timer teardown is best-effort */ }
  releaseWatchTimer = 0;
  try {
    if (window.__mapProbe.releaseWatch) window.__mapProbe.releaseWatch = { ...window.__mapProbe.releaseWatch, armed: false };
  } catch { /* probe cosmetic */ }
}

/** Is a twin frame mounted at all (navigating counts — grace below)? */
function twinFrameLive() {
  try {
    const fr = overlayEls && overlayEls.frame;
    if (!fr) return false;
    if (fr.getAttribute('data-url') === 'about:blank') return false;
    return !!fr.contentWindow;
  } catch { return false; }
}
/** Twin frame counter (progress signal, not a verdict): a climbing count
 * means the twin is painting, so a long wait is slowness — never a freeze. */
function twinFrameCount() {
  try {
    const fr = overlayEls && overlayEls.frame;
    const win = fr && fr.contentWindow;
    const r2 = win && win.__ring2;
    const c = r2 && typeof r2.content === 'function' ? r2.content() : null;
    const n = c && Number(c.frames);
    return Number.isFinite(n) ? n : NaN;
  } catch { return NaN; }
}
/** Has the twin's own state come up (__ring2)? */
function twinStateReadable() {
  try {
    const fr = overlayEls && overlayEls.frame;
    const win = fr && fr.contentWindow;
    return !!(win && win.__ring2);
  } catch { return false; }
}
/** The twin's own handoff phase ('hold' | 'swoop' | 'push' | 'settle' | ...). */
function twinHandoffPhase() {
  try {
    const fr = overlayEls && overlayEls.frame;
    const win = fr && fr.contentWindow;
    const r2 = win && win.__ring2;
    if (!r2) return null;
    if (typeof r2.handoffPhase === 'function') {
      const p = r2.handoffPhase();
      return typeof p === 'string' ? p : null;
    }
    const h = r2.handoff;
    return h && typeof h.phase === 'string' ? h.phase : null;
  } catch { return null; }
}

/** One sample of the release watch. Returns the unwind reason it fired with
 * (null while the wait is still legitimate). Self-chaining while armed, so a
 * parked hold is detected with NO further scroll ticks. Never throws. */
function releaseWatchTick() {
  try {
    if (!stagedActive || stagedCommitted) {
      releaseWatchDisarm();
      return null;
    }
    if (stagedTilesGranted) {
      // A grant only ends the watch when the ramp can actually finish. A
      // granted hold whose depth sits short of the gate is the parked-under-
      // an-opaque-overlay state (measured 61s, nothing but Esc): keep watching
      // so the bounded reasons can unwind it.
      const gz = mapRef && typeof mapRef.getZoom === 'function' ? +mapRef.getZoom() : NaN;
      const atGate = !Number.isFinite(gz) || Math.abs(gz - Z_HANDOFF) <= 0.05;
      if (atGate) {
        releaseWatchDisarm();
        return null;
      }
    }
    const now = nowMs();
    if (!releaseWatchOn) {
      releaseWatchOn = true;
      releaseWatchS = stagedS;
      releaseWatchHoldT = now;
    }
    if (stagedS !== releaseWatchS) {
      // S moved: the wait is legitimately retrying, restart the clock.
      releaseWatchS = stagedS;
      releaseWatchHoldT = now;
    }
    // PROGRESS BEATS THE CLOCK: slow is not stuck. While UNGRANTED, a twin
    // that keeps painting means the wait is healthy; while GRANTED, the clock
    // only resets when depth actually advances toward the gate (that state
    // waits on zoom, not on the twin, so its frames climb forever and would
    // otherwise mask the freeze).
    const zNowW = mapRef && typeof mapRef.getZoom === 'function' ? +mapRef.getZoom() : NaN;
    const zMoved =
      Number.isFinite(zNowW) && Number.isFinite(releaseWatchZ) && Math.abs(zNowW - releaseWatchZ) > 0.01;
    if (Number.isFinite(zNowW)) releaseWatchZ = zNowW;
    const watchFrames = twinFrameCount();
    let framesMoved = false;
    if (Number.isFinite(watchFrames)) {
      if (releaseWatchFrames < 0) releaseWatchFrames = watchFrames;
      else if (watchFrames > releaseWatchFrames) {
        framesMoved = true;
        releaseWatchFrames = watchFrames;
      }
    }
    if (zMoved || (!stagedTilesGranted && framesMoved)) releaseWatchHoldT = now;
    const waitMs = releaseWatchHoldT > 0 ? now - releaseWatchHoldT : 0;
    const iframeAlive = twinFrameLive();
    const readable = twinStateReadable();
    const released = readable ? twinReleased() : null;
    const phase = readable ? twinHandoffPhase() : null;
    const driven = lastStagedInputMs > 0 && now - lastStagedInputMs < STAGED_PRESS_MS;
    const reason = releaseImpossibleReason({
      // A prewarm armed this instant may still be navigating (data-url not
      // applied yet) — that is a boot, not an impossibility.
      iframeAlive: iframeAlive || waitMs < FRAME_BOOT_GRACE_MS,
      readable,
      released,
      phase,
      waitMs,
      driven,
    });
    try {
      window.__mapProbe.releaseWatch = {
        armed: true,
        waitMs: Math.round(waitMs),
        s: +((+stagedS || 0)).toFixed(1),
        iframeAlive: !!iframeAlive,
        readable: !!readable,
        released,
        phase,
        driven,
        boundMs: RELEASE_WAIT_BOUND_MS,
        reason: reason || null,
      };
    } catch { /* probe cosmetic */ }
    if (reason) {
      unwindDive(reason, { source: 'release-watch' });
      return reason;
    }
    if (!releaseWatchTimer) {
      try {
        releaseWatchTimer = setTimeout(() => {
          releaseWatchTimer = 0;
          try { releaseWatchTick(); } catch { /* watch never breaks the page */ }
        }, RELEASE_WATCH_POLL_MS);
      } catch { releaseWatchTimer = 0; }
    }
    return null;
  } catch { return null; }
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
    // A gesture reverse is owning the frame: re-booting during the retrace
    // put a live iframe over a map the fingers were scrolling out, and a
    // slow wheel could land in that twin instead of the map (freeze, pinch
    // only). The next deliberate dive boots after the recede lands.
    if (receding || retraceDissolve || reverseWait) return false;
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
    // Never race a gesture reverse: the retrace owns the frame until it lands
    // (see earlyBootTwin — a mid-retrace shell is a wheel trap on slow scroll).
    if (receding || retraceDissolve || reverseWait) return false;
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
      staleCloseGuardUntil = nowG + STALE_CLOSE_GUARD_MS; // the replaced early twin's pagehide echo lands in this window — drop it
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
      staleCloseGuardUntil = nowI + STALE_CLOSE_GUARD_MS;
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
    // CLICK STAGING: the ready/paint grants can land mid-flight, before the
    // gate hold exists. A timed fade here would open the twin unenclosed and
    // the S arm would have nothing left to dissolve. The landing arm owns
    // the reveal; only an instant commit may bypass it.
    if (clickStagedPending && !instant) return false;
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
    // CLICK FLIGHT: the crossfade must land on the pose the twin was handed,
    // never fade in over a camera still flying to it. The prewarm is already
    // booting under the flight, so this defers the FADE only (the click->twin
    // time is the boot, unchanged); the instant paths (reduced motion,
    // S-commit) never wait.
    if (!instant && clickFlightActive()) {
      deferRevealToFlightLand();
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
      if (pxNow && pxNow.near) {
        // Radii + center are re-derived from the LIVE (landed) camera on the
        // same tick as the wash: the arrival write above is skipped on a click
        // flight (its frame was pre-flight), and the per-step driver is parked
        // once the twin owns the frame — without this the mask would open at
        // whatever size the last wide frame wrote.
        try { writeEnclosureEllipse(pxNow, null); } catch { /* radii are best-effort */ }
        showVignette(true);
      }
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
  // A fresh open never inherits a reverse dissolve: the zoom-keyed fade may
  // have parked a stale inline opacity / pointer-events:none on this same
  // root (re-open path restores them, but a fork-resolved hold or a
  // mid-retrace open must not start half-faded or click-dead).
  try { stopRetraceMode(); } catch { /* mode clear is best-effort */ }
  try {
    root.classList.remove('scrubbing');
    if (root.style.opacity !== '') root.style.opacity = '';
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
      staleCloseGuardUntil = nowG + STALE_CLOSE_GUARD_MS; // the replaced early twin's pagehide echo lands in this window — drop it
    } catch { /* guard is best-effort */ }
  }
  // CACHE-FAST: same unarmed-idle-shell echo cover as the arrival path —
  // a direct open over a live idle shell replaces it (no retarget), so its
  // pagehide echo must not tear down the fresh open.
  if (!warmReused && !earlyTwinArmed && twinBootKey) {
    try {
      const nowI = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      staleCloseGuardUntil = nowI + STALE_CLOSE_GUARD_MS;
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

/** AUTO-REVERSE (explicit close): the X/Esc/back path is the user's own
 * reverse intent, so it must retrace the SAME world->twin geometry the wheel
 * path does. The scroll path is finger-owned; an explicit close has no
 * fingers, so it synthesizes the user's outward wheel lane (same flipped
 * delta, same native scrollZoom path, same onNativeZoomStep laws) at a
 * readability cadence. `autoReverseCloseFlight` remains the fallback for a
 * browser that refuses synthetic wheel events. Reduced motion keeps the
 * instant restore. */
const AUTO_REVERSE_MS_PER_ZOOM = 160;
const AUTO_REVERSE_MIN_MS = 900;
const AUTO_REVERSE_MAX_MS = 1900;
// One synthetic outward tick: native scrollZoom delta (positive = out after
// the lane's flip), paced at the owner's normal wheel cadence. The close is a
// gesture retrace, not an ease: z, mask, satellite and pitch all move through
// the same per-tick driver the fingers use. While the retrace dissolve still
// owns the overlay, ticks are smaller/slower so the sat/vector crossfade is
// READ, not blinked; below Z_TOP the world can widen at normal wheel pace.
const AUTO_REVERSE_TICK_MS = 100;
const AUTO_REVERSE_TICK_DELTA = 180;
const AUTO_REVERSE_FADE_TICK_MS = 85;
const AUTO_REVERSE_FADE_DELTA = 55;
const AUTO_REVERSE_MAX_TICKS = 140;
let autoReverseWheelTimer = null;
let autoReverseLandingTarget = NaN; // NaN = no deferred auto landing armed
function stopAutoReverseWheelDrive() {
  try {
    if (autoReverseWheelTimer) clearTimeout(autoReverseWheelTimer);
  } catch { /* timer teardown is best-effort */ }
  autoReverseWheelTimer = null;
}
/** The explicit close's destination: just OUTSIDE the enclosure's forming
 * span. `enclosureEllipsePxForZoom` starts growing the mask at Z_CENTER and
 * completes the seal at Z_TOP, so stopping a hair below Z_CENTER is literally
 * "right before the enclosing mask begins to appear": no mask, no twin, no
 * satellite handoff, and no unnecessary trip to the flat world. The close
 * still uses the full gesture retrace to get here; the gesture reverse itself
 * remains finger-owned and can continue past this checkpoint if the user
 * keeps scrolling. */
const CLOSE_BEFORE_MASK_EPS = 0.02;
function autoReverseTargetFrame() {
  return {
    center: { lng: SITE.lon, lat: SITE.lat },
    zoom: Z_CENTER - CLOSE_BEFORE_MASK_EPS,
    pitch: 0,
    bearing: 0,
  };
}
function autoReverseCloseFlight(target) {
  try {
    if (!mapRef || !target) return false;
    const live = liveCamFrame();
    const fromZ = live && Number.isFinite(+live.zoom) ? +live.zoom : Z_HANDOFF;
    const toZ = Number.isFinite(+target.zoom) ? +target.zoom : MAP_FLOOR;
    if (Math.abs(fromZ - toZ) < 0.01) return false;
    const ms = Math.max(AUTO_REVERSE_MIN_MS, Math.min(AUTO_REVERSE_MAX_MS,
      Math.round(Math.abs(fromZ - toZ) * AUTO_REVERSE_MS_PER_ZOOM)));
    mapRef.easeTo({
      center: [target.center.lng, target.center.lat],
      zoom: target.zoom,
      pitch: target.pitch,
      bearing: target.bearing,
      duration: ms,
      essential: true,
      easing: smooth01,
    });
    try {
      window.__mapProbe.autoReverse = { from: +fromZ.toFixed(3), to: +toZ.toFixed(3), ms, mode: 'flight' };
    } catch { /* probe cosmetic */ }
    return true;
  } catch (err) {
    errors.push('AUTO-REVERSE: ' + (err && err.message));
    return false;
  }
}
/** Gesture-shaped auto reverse: feed the SAME outward wheel lane the owner
 * uses (positive native delta on the canvas container, marked as an already
 * flipped clone) at a normal wheel cadence. Native scrollZoom then supplies
 * every transition the close was missing — per-tick zoom animation, cursor
 * anchor, onNativeZoomStep pitch/sat/mask retrace, and the home landing.
 * The one difference from a finger is the clock: the close runs the ticks
 * itself because there is no hand on the trackpad. Returns false when the
 * lane is unavailable; the caller falls back to the one-shot ease. */
function startAutoReverseWheelDrive(target) {
  try {
    if (!mapRef || !target) return false;
    const lane = mapRef.getCanvasContainer && mapRef.getCanvasContainer();
    const host = mapRef.getContainer && mapRef.getContainer();
    if (!lane || !host) return false;
    const fromZ = +mapRef.getZoom();
    const toZ = Number.isFinite(+target.zoom) ? +target.zoom : MAP_FLOOR;
    if (!Number.isFinite(fromZ) || !Number.isFinite(toZ)) return false;
    if (Math.abs(fromZ - toZ) < 0.01) return false;
    const seq = closeSeq;
    let ticks = 0;
    let lastZ = fromZ;
    let stalled = 0;
    let fallbackUsed = false;
    const stop = () => {
      try {
        if (autoReverseWheelTimer) clearTimeout(autoReverseWheelTimer);
      } catch { /* timer teardown is best-effort */ }
      autoReverseWheelTimer = null;
    };
    const land = () => {
      stop();
      if (seq !== closeSeq) return;
      autoReverseLandingTarget = NaN;
      try { if (recedeLandHome) recedeLandHome(); } catch { /* landing is best-effort */ }
    };
    const fallback = () => {
      if (fallbackUsed) return;
      fallbackUsed = true;
      stop();
      let ok = false;
      try { ok = autoReverseCloseFlight(target); } catch { ok = false; }
      if (!ok) return;
      let ms = AUTO_REVERSE_MAX_MS;
      try {
        const ar = window.__mapProbe && window.__mapProbe.autoReverse;
        if (ar && Number.isFinite(+ar.ms)) ms = +ar.ms;
      } catch { /* probe cosmetic */ }
      setTimeout(() => {
        if (seq !== closeSeq || !receding) return;
        autoReverseLandingTarget = NaN;
        try { if (recedeLandHome) recedeLandHome(); } catch { /* landing is best-effort */ }
      }, ms + 250);
    };
    const tick = () => {
      autoReverseWheelTimer = null;
      if (seq !== closeSeq || twinOpen || !receding) return;
      let z = NaN;
      try { z = +mapRef.getZoom(); } catch { z = NaN; }
      if (!Number.isFinite(z)) return;
      if (z <= toZ + 0.02 || z <= MAP_FLOOR + 0.01) { land(); return; }
      if (ticks >= AUTO_REVERSE_MAX_TICKS) { fallback(); return; }
      const inFade = z > Z_TOP + 0.001;
      const tickDelta = inFade ? AUTO_REVERSE_FADE_DELTA : AUTO_REVERSE_TICK_DELTA;
      const tickMs = inFade ? AUTO_REVERSE_FADE_TICK_MS : AUTO_REVERSE_TICK_MS;
      try {
        const r = host.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) { fallback(); return; }
        const ev = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaMode: 0,
          deltaX: 0,
          // RAW outward gesture: under the owner's up-out convention this is
          // a negative wheel. The in-band takeover reads it as an outward
          // tick (dy<0); below the band the map's capture flip turns it into
          // the native positive zoom-out clone. Sending an already-flipped
          // clone only feeds the takeover a false inward tick (measured +0.4z
          // and a twin re-open at the gate).
          deltaY: -tickDelta,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          screenX: r.left + r.width / 2,
          screenY: r.top + r.height / 2,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
        });
        host.dispatchEvent(ev);
      } catch { fallback(); return; }
      ticks += 1;
      if (z < lastZ - 0.005) stalled = 0;
      else stalled += 1;
      lastZ = z;
      if (stalled >= 10) { fallback(); return; }
      try {
        window.__mapProbe.autoReverse = {
          mode: 'wheel', from: +fromZ.toFixed(3), to: +toZ.toFixed(3),
          tickMs, delta: tickDelta, ticks,
        };
      } catch { /* probe cosmetic */ }
      autoReverseWheelTimer = setTimeout(tick, tickMs);
    };
    try {
      window.__mapProbe.autoReverse = {
        mode: 'wheel', from: +fromZ.toFixed(3), to: +toZ.toFixed(3),
        tickMs: AUTO_REVERSE_TICK_MS, delta: AUTO_REVERSE_TICK_DELTA, ticks: 0,
      };
    } catch { /* probe cosmetic */ }
    autoReverseWheelTimer = setTimeout(tick, AUTO_REVERSE_TICK_MS);
    return true;
  } catch (err) {
    errors.push('AUTO-REVERSE-WHEEL: ' + (err && err.message));
    return false;
  }
}

/** Actual teardown: keeps hex + selection (Task 19). Every close entry
 * reaches this single chain; the overlay path differs by intent:
 * the gesture reverse keeps the mounted frame for the zoom-keyed retrace,
 * an explicit close now runs the same retrace as an auto flight, and only
 * the reduced-motion / no-frame cases fall through to the instant hide.
 * The map sits at its law pose awaiting the fingers where the gesture
 * path owns it (scroll owns every following motion; no auto recede, no
 * timed legs on that path). Pending hide/recede steps are seq-guarded so a
 * fresh open cancels them (no blanked twin, no yanked map). */
function doCloseTwin(opts = {}) {
  try { stopAutoReverseWheelDrive(); } catch { /* auto drive teardown is best-effort */ }
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
  // CLOSE INTENT FIRST: an explicit close is the same reverse the wheel
  // retraces, but it has no fingers to finish the journey. Resolve that here
  // so the staged teardown below knows to keep the mounted frame for the
  // retrace. Reduced motion leaves autoReverse false and uses the instant cut.
  const gestureReverse = !!(opts && opts.gestureReverse);
  let autoReverse = false;
  let autoTarget = null;
  if (opts && opts.autoReverse && !gestureReverse) {
    try {
      let reduced = false;
      try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { reduced = false; }
      if (!reduced) {
        autoTarget = autoReverseTargetFrame();
        autoReverse = !!autoTarget;
      }
    } catch { autoReverse = false; }
  }
  // LOCK-EARLY: Esc/reverse during a staged hold must restore pan — unwind
  // the hold (no-op when nothing is staged) and release the camera lock even
  // for holds a fork guard already resolved (those leak frozen handlers).
  // A committed twin is NOT torn down here: the close chain below must keep
  // the mounted frame for the gesture-retrace dissolve. An auto-reverse keeps
  // an UNCOMMITTED but visible twin mounted for the same reason.
  // The enclosure zoom seal dies with the close chain too: the retrace and
  // the fingers' way home must be free to zoom out from the first tick.
  try { releaseStagedZoomLock(); } catch { /* unlock is best-effort */ }
  // The retrace is the world widening: warm the next lower level from the
  // live close pose so the first outbound frames are not tile-starved.
  try {
    let zClose = Z_HANDOFF;
    try { zClose = +mapRef.getZoom(); } catch { zClose = Z_HANDOFF; }
    if (Number.isFinite(zClose)) warmOutboundLevel(zClose, 'close');
  } catch { /* warm is best-effort */ }
  try { if (stagedActive && !stagedCommitted && !autoReverse) exitStaged(); } catch { /* unwind is best-effort */ }
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
  // Instant cut — every path EXCEPT the gesture reverse: hiding
  // synchronously there is the measured one-frame op 1->0 cut (the twin
  // just walked back to the handoff pose, so the frames match, but the
  // hide still drops a full overlay in one frame instead of retracing).
  // The gesture path keeps the overlay mounted and dissolves it as a pure
  // function of the live zoom (beginRetraceDissolve below) — the fingers
  // carry it home through the same laws, and the teardown lands at Z_TOP.
  // A begin that finds nothing to dissolve (already home, no frame) falls
  // back to the instant hide so no overlay ever strands.
  // The gesture/auto split was resolved before the staged teardown (see
  // CLOSE INTENT FIRST) so neither path loses the mounted frame.
  let retraced = false;
  if (!gestureReverse && !autoReverse) {
    try {
      finishHide();
    } catch { /* hide is best-effort */ }
  }
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
    if (!autoReverse && !driverOwns) showVignette(false);
  } catch { /* cosmetic */ }
  try {
    autoReverseLandingTarget = autoReverse && autoTarget && Number.isFinite(+autoTarget.zoom)
      ? +autoTarget.zoom
      : NaN;
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
  // UNWIND LAW: an aborted dive returns the frame it left (zoom/pitch/
  // bearing/pan), not merely the journey home — "home" is wrong whenever the
  // dive started anywhere else. Runs LAST so it overrides the close pose and
  // the gesture-owned recede armed above. No-op when no dive was recorded
  // (a plain reload/back open), which keeps the old close behaviour exactly.
  // Skipped inside unwindDive, which owns its own single restore.
  //
  // GESTURE REVERSE (owner rev 2026-10-26: "on the way back ... it goes
  // through the phases and not just zooms out to the full map"): a recede the
  // TWIN sent on its own — no close request from this side — is the user
  // scrolling back out. Restoring the dive frame there is the jump that ends
  // the retrace: the map is already at the handoff pose the twin just walked
  // back to, so the fingers must carry it home through the SAME laws
  // (pitch -> sat -> mask, all keyed off the live zoom) instead of teleporting
  // to wherever the dive began. Esc/X/back (closeSource set, or a close we
  // asked for) keep the restore exactly as before.
  if (!unwindActive) {
    if (gestureReverse) {
      try { holdHandoffPoseForReverse(); } catch { /* retrace hand-off never breaks teardown */ }
      try { retraced = beginRetraceDissolve(); } catch { retraced = false; }
      if (!retraced) {
        try { finishHide(); } catch { /* fallback hide is best-effort */ }
      }
    } else if (autoReverse) {
      // Explicit close: keep the overlay mounted exactly like the gesture
      // path, then feed the SAME outward wheel lane the fingers use. The
      // retrace dissolve reads the live zoom and the native scrollZoom ticks
      // own every transition (pitch, sat, mask, landing).
      // The staged auto-pump must stop first: its commit guard re-parks the
      // map on Z_HANDOFF every tick, which would cancel the reverse at the
      // gate. Flags only — the frame is deliberately kept for the retrace.
      try { stopStagedAutoPump(); } catch { /* pump teardown is best-effort */ }
      stagedActive = false;
      clickStagedPending = false;
      stagedCommitted = false;
      try { holdHandoffPoseForReverse(); } catch { /* retrace hand-off never breaks teardown */ }
      try { retraced = beginRetraceDissolve(); } catch { retraced = false; }
      if (retraced) {
        try { retraced = startAutoReverseWheelDrive(autoTarget); } catch { retraced = false; }
      }
      // Lane unavailable (or a browser without synthetic wheel): keep the
      // geometry with the one-shot ease rather than cutting home.
      if (!retraced) {
        try { retraced = autoReverseCloseFlight(autoTarget); } catch { retraced = false; }
      }
      if (retraced) {
        // The wheel drive lands from its own target check. Only the flight
        // fallback needs a bounded landing if MapLibre stops just short of
        // the recorded floor and no zoom step carries the state home.
        try {
          const ar = window.__mapProbe && window.__mapProbe.autoReverse;
          if (!ar || ar.mode !== 'wheel') {
            const ms = ar && Number.isFinite(+ar.ms) ? +ar.ms : AUTO_REVERSE_MAX_MS;
            setTimeout(() => {
              try {
                if (!receding || !recedeLandHome) return;
                autoReverseLandingTarget = NaN;
                recedeLandHome();
              } catch { /* landing fallback is best-effort */ }
            }, ms + 250);
          }
        } catch { /* bounded landing is best-effort */ }
      }
      if (!retraced) {
        try { finishHide(); } catch { /* fallback hide is best-effort */ }
        try {
          mapRef.jumpTo({
            center: [autoTarget.center.lng, autoTarget.center.lat],
            zoom: autoTarget.zoom, pitch: autoTarget.pitch, bearing: autoTarget.bearing,
          });
        } catch { /* fallback restore is best-effort */ }
      }
    } else {
      try {
        const t0 = nowMs();
        const from = escapeStateSnapshot();
        const restored = restoreDiveCam('close');
        publishUnwind(closeSource || 'close', closeSource || 'close', restored, from, t0);
      } catch { /* restore never breaks teardown */ }
    }
    closeSource = null;
  }
  // STATE HYGIENE: the overlay is gone or the retrace owns it — no staged
  // ownership may survive the close (a stale committed flag was readable by
  // the next slow reverse). Flags only: overlay/camera already handled above.
  try { resetStagedOwnership(); } catch { /* reset is best-effort */ }
}

/** GESTURE-REVERSE hand-off (see doCloseTwin): consume the dive record and
 * release every hold the dive pinned, WITHOUT moving the camera. The frame
 * stays on the handoff pose the twin just retraced to, so the next outward
 * wheel tick runs the journey's own laws backwards from where the eye already
 * is — one continuous zoom-out (pitch flattens, satellite fades, mask opens)
 * that hands over to the native cursor dolly once the mask is down. The
 * gesture-owned recede armed by recedeToHome is left armed: it lands home on
 * the zoom step that arrives there.
 * Pitch/zoom/center are untouched by construction (no jumpTo, no easeTo). */
function holdHandoffPoseForReverse() {
  diveCam = null;
  stallCeilingOn = false;
  lastCeilingPin = null;
  stallT0 = 0;
  try { restoreMaxZoom(); } catch { /* unclamp is best-effort */ }
  // The recede landing is armed by recedeToHome earlier in the close chain;
  // re-arm here if anything disarmed it, so the zoom-step home check always
  // has a landing to fire (an un-armed retrace would sit at 'out' forever).
  // recedeToHome is idempotent-safe: re-entry only re-arms the closure.
  try {
    if (!recedeLandHome && !recedeDone) recedeToHome();
  } catch { /* arming is best-effort */ }
  try {
    window.__mapProbe.diveCam = null;
    if (window.__mapProbe.recede !== 'out') window.__mapProbe.recede = 'out';
  } catch { /* probe cosmetic */ }
}

/* GESTURE-REVERSE DISSOLVE: the twin answered the user's own wheel-out, so
 * the close keeps the overlay MOUNTED and dissolves it as a pure function
 * of the live zoom (retraceOpacityForZoom: 1 at Z_HANDOFF, 0 at/below
 * Z_TOP) instead of hiding it in one frame. The zoom-step driver repaints
 * it on every tick; at 0 the twin is torn down and the native journey laws
 * own the rest of the way home. No timer, no flight, no unwind — fingers
 * own every pixel, both directions (scrolling back up re-dissolves by the
 * same law; reaching the gate re-opens the twin with nothing to snap).
 * State: retraceDissolve while the zoom-keyed fade owns the overlay. */
let retraceDissolve = false;
let retraceLastZ = NaN; // last zoom the reverse dissolve painted (direction law)
/** Stop owning the overlay fade without hiding anything (the active close /
 * unwind path owns visibility). Restores twin interaction when the twin is
 * still the frame (re-open / fresh open). Never throws. */
function stopRetraceMode() {
  retraceDissolve = false;
  retraceLastZ = NaN;
  try {
    const root = overlayEls && overlayEls.root;
    if (root) {
      if (root.style.pointerEvents === 'none') root.style.pointerEvents = '';
    }
    const fr = overlayEls && overlayEls.frame;
    if (fr && fr.style.pointerEvents === 'none') fr.style.pointerEvents = '';
  } catch { /* pointer restore is best-effort */ }
}
/** Begin the zoom-keyed reverse dissolve. True when the overlay is mounted
 * on a live twin frame above Z_TOP (something to dissolve); false otherwise
 * (the caller falls back to the instant hide). Reduced-motion skips the
 * dissolve (instant path) — a fade the fingers cannot scrub is theatre. */
function beginRetraceDissolve() {
  stopRetraceMode();
  try {
    let reduced = false;
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch { reduced = false; }
    if (reduced) return false;
    const root = overlayEls && overlayEls.root;
    const fr = overlayEls && overlayEls.frame;
    if (!root || root.hidden) return false;
    if (!fr || fr.getAttribute('data-url') === 'about:blank') return false;
    let z = NaN;
    try { z = mapRef ? +mapRef.getZoom() : NaN; } catch { z = NaN; }
    if (!Number.isFinite(z) || z <= Z_TOP) return false;
    retraceDissolve = true;
    retraceLastZ = z;
    try {
      // Suspend the transition FIRST: per-tick law writes must BE the
      // rendered value (the forward scrub lesson) — otherwise each write
      // restarts a 0.45s ease and the fade lags the fingers.
      if (!root.classList.contains('scrubbing')) root.classList.add('scrubbing');
      // The fade owns no interaction: wheels pass through to the map canvas
      // so the fingers drive the zoom the fade reads. The twin already
      // walked back; nothing up there needs the pointer. Set the frame too:
      // a child can re-enable pointer-events over an inherited none, and a
      // slow wheel that keeps landing on the hidden twin never reaches the
      // map (the owner's "scroll out too slow freezes; pinch works").
      root.style.pointerEvents = 'none';
      if (fr.style.pointerEvents !== 'none') fr.style.pointerEvents = 'none';
      try { fr.blur?.(); } catch { /* focus handoff is best-effort */ }
    } catch { /* presentation is best-effort */ }
    try { window.__mapProbe.recede = 'out'; } catch { /* probe cosmetic */ }
    driveRetraceDissolve();
    return true;
  } catch { return false; }
}
/** Repaint the reverse dissolve from the live zoom. Runs on every zoom step
 * while the dissolve owns the overlay (wired in onNativeZoomStep). */
function driveRetraceDissolve() {
  if (!retraceDissolve) return;
  try {
    let z = NaN;
    try { z = mapRef ? +mapRef.getZoom() : NaN; } catch { z = NaN; }
    if (!Number.isFinite(z)) return;
    const root = overlayEls && overlayEls.root;
    if (!root || root.hidden) { stopRetraceMode(); return; }
    if (z >= Z_HANDOFF) {
      // Pushed back to the gate mid-retrace: re-open the twin. The law reads
      // 1 there = the stylesheet's 1, so restoring the transition + releasing
      // the inline value eases 1 -> 1 (nothing to snap), and the fingers are
      // back inside the committed frame with the twin live. The reverse is
      // over: disarm the recede (a later wheel-out starts a fresh twin-posted
      // cycle), so no stale landing outlives the frame it was armed for.
      //
      // DIRECTION LAW: a SLOW reverse can leave the live zoom at the gate for
      // a frame (MapLibre writes sub-step targets); that must not count as a
      // push back into the twin. Without this, the first slow outward notch
      // re-opened the twin at z11.5, parked the map in the committed frame and
      // only pinch could leave. Re-open only when the camera actually moved
      // IN (z above the last painted zoom); otherwise keep the retrace armed
      // and let the fingers carry the same outward tick below the gate.
      const movedIn = Number.isFinite(retraceLastZ) && z > retraceLastZ + 0.005;
      if (!movedIn) {
        retraceLastZ = z;
        try {
          if (root.style.opacity !== '1') root.style.opacity = '1';
        } catch { /* cosmetic */ }
        return;
      }
      retraceDissolve = false;
      twinOpen = true;
      try { window.__mapProbe.twinOpen = true; } catch { /* probe cosmetic */ }
      receding = false;
      recedeLandHome = null;
      try { window.__mapProbe.recede = null; } catch { /* probe cosmetic */ }
      stopRetraceMode();
      try {
        root.classList.remove('scrubbing');
        root.style.opacity = '';
      } catch { /* cosmetic */ }
      try {
        document.body.classList.add('twin-open');
        if (overlayEls.frame) overlayEls.frame.focus?.();
      } catch { /* chrome is cosmetic */ }
      return;
    }
    if (z <= Z_TOP) {
      endRetraceDissolve();
      return;
    }
    retraceLastZ = z;
    const op = retraceOpacityForZoom(z);
    try {
      const s = String(+op.toFixed(4));
      if (root.style.opacity !== s) root.style.opacity = s;
    } catch { /* paint is best-effort */ }
    try {
      window.__mapProbe.recede = 'out';
      window.__mapProbe.retraceOp = +op.toFixed(4);
      window.__mapProbe.retraceZ = +z.toFixed(3);
    } catch { /* probe cosmetic */ }
  } catch { /* dissolve repaint never breaks the driver */ }
}
/** Land the reverse dissolve at Z_TOP: opacity already reads 0 by the law,
 * so hiding + blanking snaps nothing. The gesture-owned recede stays armed
 * (recede 'out') — the zoom-step home check still lands it. No camera move,
 * no unwind. Never throws. */
function endRetraceDissolve() {
  retraceDissolve = false;
  retraceLastZ = NaN;
  try {
    const root = overlayEls && overlayEls.root;
    const fr = overlayEls && overlayEls.frame;
    if (root) {
      try { root.classList.remove('scrubbing'); } catch { /* cosmetic */ }
      try { root.style.opacity = ''; } catch { /* cosmetic */ }
      try { root.style.pointerEvents = ''; } catch { /* cosmetic */ }
      try { root.hidden = true; } catch { /* hide is best-effort */ }
      try { root.classList.remove('closing'); } catch { /* cosmetic */ }
      try { root.classList.remove('prewarm'); } catch { /* cosmetic */ }
    }
    if (fr) {
      try { if (fr.style.pointerEvents === 'none') fr.style.pointerEvents = ''; } catch { /* cosmetic */ }
      try { setFrameUrl(fr, 'about:blank'); } catch { /* teardown is best-effort */ }
      twinBootKey = null;
      try { window.__mapProbe.twinBootKey = null; } catch { /* probe cosmetic */ }
    }
    try {
      window.__mapProbe.twinReady = false;
      window.__mapProbe.twinPainted = false;
      window.__mapProbe.reveal = null;
      window.__mapProbe.revealFallback = false;
      window.__mapProbe.revealLate = false;
      window.__mapProbe.revealPaint = false;
      window.__mapProbe.retraceOp = 0;
    } catch { /* probe cosmetic */ }
    try { document.body.classList.remove('twin-open'); } catch { /* chrome class is cosmetic */ }
    try {
      if (history.state && history.state.twin) history.replaceState(null, '', mapUrlWithSector(null));
    } catch { /* history is best-effort */ }
    try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
  } catch { /* teardown never breaks the driver */ }
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
function finishTwinClose(opts = {}) {
  if (!twinOpen) return;
  clearReverseWait();
  doCloseTwin(opts);
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
          // UNWIND LAW: a superseded wait must still DISARM itself. The old
          // early return left reverseWait armed with no timer, and closeTwin()
          // bails while it is armed — one stale wait made Esc a permanent
          // no-op for the rest of the session (measured run-4).
          if (seq !== closeSeq) {
            if (reverseWait && reverseWait.timer === timerHandle) clearReverseWait();
            return;
          }
          if (!twinOpen) {
            clearReverseWait();
            return;
          }
          try {
            window.__mapProbe.reverseFallback = true;
          } catch { /* probe cosmetic */ }
          finishTwinClose({ autoReverse: true });
        }, TWIN_REVERSE_WAIT_MS),
      };
      const timerHandle = reverseWait.timer;
      return;
    }
  } catch { /* request is best-effort; fall through to teardown */ }
  finishTwinClose({ autoReverse: true });
}

window.addEventListener('popstate', (e) => {
  const id = e && e.state && e.state.twin;
  if (id && !twinOpen) openTwin(id, { replace: true });
  else if (!id && twinOpen) closeTwin();
});

// UNWIND LAW (Phase-03 resilience): Esc is the guaranteed escape from EVERY
// dive state — not just "twinOpen". The old handler was gated on twinOpen, so
// a staged hold / stalled arm / intent lock / parked ceiling answered Esc with
// nothing at all (measured: staged.active + twinOpen still true after Esc, the
// page only recoverable by reload). Routing lives in escapeKeyDown (see the
// unwind block): healthy committed twin -> reverse-first close, everything
// else -> immediate unwindDive with the pre-dive camera restored.
// Capture phase so no inner handler can swallow the escape, and the same-origin
// parent document is hooked too (the gallery mounts this page in an iframe, so
// focus over the page chrome never reaches this window).
window.addEventListener('keydown', (e) => { escapeKeyDown(e, 'map'); }, true);

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
    // AUTO-REVERSE DEFERRED LANDING: the country home (Z_MIN) is an
    // intermediate checkpoint when the pre-dive frame was wider. If the pitch
    // flatten jumped here it would cancel the auto ease; wait for its true
    // target, then run the normal landing (flatten/reset/probe) once.
    try {
      if (Number.isFinite(autoReverseLandingTarget)
        && autoReverseLandingTarget < Z_MIN - 0.01) {
        const zNow = mapRef ? +mapRef.getZoom() : NaN;
        if (Number.isFinite(zNow) && zNow > autoReverseLandingTarget + 0.02) return;
      }
    } catch { /* landing guard is best-effort */ }
    autoReverseLandingTarget = NaN;
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
    // strand at iso at world zoom. TERMINAL FLATTEN law: pitch AND bearing
    // written flat in one INSTANT jumpTo (no timers) — zoom and center
    // untouched, flat arrivals no-op inside tolerance. No timer ever owns
    // camera motion on this path.
    try {
      const cHome = liveCamFrame();
      if (settleFlattenDue({
        z: cHome && cHome.zoom,
        pitch: cHome && cHome.pitch,
        bearing: cHome && cHome.bearing,
        twinOpen,
      })) {
        mapRef.jumpTo({ pitch: 0, bearing: 0 });
        try { window.__mapProbe.flatten = 'home'; } catch { /* probe cosmetic */ }
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
  // the fresh prewarm. Narrowed by the UNWIND LAW: the window is short and
  // only applies while the fresh shell has proven NOTHING (no grant, no
  // release) — once its own ready/painted/release lands, a close from that
  // frame is genuine and always honored. Dropped echoes are counted on the
  // probe instead of vanishing.
  try {
    const nowE = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    let proven = false;
    try {
      proven = !!window.__mapProbe.twinReady || !!window.__mapProbe.twinPainted || twinReleased();
    } catch { proven = false; }
    if (nowE < staleCloseGuardUntil && !proven) {
      try { window.__mapProbe.closeDropped = (+window.__mapProbe.closeDropped || 0) + 1; } catch { /* probe cosmetic */ }
      return;
    }
  } catch { /* guard never blocks the close */ }
  const recede = !!(e.data && typeof e.data === 'object' && e.data.recede);
  if (recede) {
    // Handoff-5-close: the twin already returned to ring-iso sat — keep
    // map-sat ON underneath the twin fade, then finishTwinClose() runs the
    // single close chain (fade ~450ms, then sat->flat + zoom out to the
    // blip). Never cut, never fade over flat. Handoff-6-retrace: the reply
    // also settles the reverse-first wait armed by closeTwin().
    // GESTURE REVERSE (see doCloseTwin): a recede nobody here asked for is
    // the twin answering the user's own wheel — the camera keeps the handoff
    // pose so the fingers retrace the journey continuously instead of the
    // close teleporting back to the frame the dive left. A recede while an
    // explicit close is awaited (X/Esc/back) is still the SAME retrace, but
    // there are no fingers to finish it: autoReverse drives the camera home.
    const explicitClose = !!reverseWait || !!closeSource;
    setSatForced(true);
    finishTwinClose(explicitClose ? { autoReverse: true } : { gestureReverse: true });
    return;
  }
  // Legacy/bare close (the twin's own X or an old shell): no fingers own it,
  // so use the same automatic retrace as the parent's X/Esc rather than the
  // old instant cut. A gesture recede always carries the extended payload
  // above; this branch is explicit-close intent.
  finishTwinClose({ autoReverse: true });
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
    // Parent-owned twin fullscreen button: pressed state mirrors the ACTUAL
    // fullscreen element (never the request), so an Esc exit or a rejected
    // request leaves the control honest.
    const fb = (overlayEls && overlayEls.fsBtn) || document.getElementById('twin-fs');
    if (fb) fb.setAttribute('aria-pressed', String(fsEl === (overlayEls && overlayEls.root)));
  } catch { /* probe sync is cosmetic */ }
  try {
    if (!document.fullscreenElement && twinFs) {
      twinFs = false;
      if (!twinOpen) recedeToHome();
    }
  } catch { /* recede fallback is best-effort */ }
}

let lastPinWrite = null; // last written pin px — unchanged frames write nothing
function positionDomPins(map) {
  const layer = document.getElementById('map-pins');
  if (!layer) return;
  const pins = layer.querySelectorAll('.map-pin');
  if (!pins.length) return;
  // One projection for every pin (all pins sit on the same site point) and a
  // write only when the px actually moved — the old loop projected per pin
  // and rewrote left/top every pass, forcing style recalc on a static frame.
  let pt = null;
  try {
    pt = map.project([SITE.lon, SITE.lat]);
  } catch { pt = null; }
  if (!pt || !Number.isFinite(+pt.x) || !Number.isFinite(+pt.y)) return;
  const l = Math.round(pt.x) + 'px';
  const t = Math.round(pt.y) + 'px';
  if (lastPinWrite && lastPinWrite.l === l && lastPinWrite.t === t) return;
  lastPinWrite = { l, t };
  pins.forEach((p) => {
    try {
      if (p.style.left !== l) p.style.left = l;
      if (p.style.top !== t) p.style.top = t;
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
      // UNWIND LAW: backstop capture for a dive whose wheel lane skipped the
      // flip (in-band takeover still owns its own ticks).
      if (dy > 0) {
        try { noteDiveFrame('takeover'); } catch { /* dive frame is best-effort */ }
      }
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
      if (z > Z_HANDOFF + 0.5) return;
      let prox = null;
      try { prox = proximityInfo(); } catch { prox = null; }
      // Aimed (hotspot near OR in view) OR already journeying (the scrub
      // engaged): below the mask band the whole-rate law is identical to the
      // native dolly, so claiming an aimed tick from world zoom only adds the
      // aim — the owner's "each scroll should get it aligned to center".
      let journeying = false;
      try { journeying = isoScrubOwned || isoRestoreDue || scrubProgress > 0; } catch { journeying = false; }
      if (!prox || !(prox.armed || (z >= Z_ISO_START && journeying))) return;
      // Boot on MASK-band intent, not world intent: a world-frame twin boots
      // off-site (its anchor/range clamp to the rail, tiles resolve nothing
      // useful) and the stall then freezes the dive waiting for content that
      // only the arrival retarget can deliver. The aim above still starts at
      // the first in-view tick; the prewarm keeps its 3-level lead.
      if (prox && prox.armed && centerBlendForZoom(z) > 0) {
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
      // NO MASK GAIN: the old 1.0 -> 0.700 -> 1.0 dip was a second, invisible
      // brake across the same stretch as the mask growth; the owner read it
      // as the transition slowing down enough to notice the switch. The only
      // brake left is the load-driven stall below, which exists to fit tile
      // arrival and fires only while the twin truly holds no content.
      let target = z + dy * rate;
      // Clamp to the map's own zoom limits before the settle law sees it:
      // the aim is evaluated at the zoom the camera can actually reach, so
      // the pan and the dolly cannot disagree at the world floor.
      try {
        const mn = +mapRef.getMinZoom();
        const mx = +mapRef.getMaxZoom();
        if (Number.isFinite(mn)) target = Math.max(mn, target);
        if (Number.isFinite(mx)) target = Math.min(mx, target);
      } catch { /* clamp is best-effort */ }
      let around = null;
      try {
        const ctn = mapRef.getContainer();
        const r = ctn ? ctn.getBoundingClientRect() : null;
        if (r && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
          around = mapRef.unproject([e.clientX - r.left, e.clientY - r.top]);
        }
      } catch { around = null; }
      // R11-CENTER continuous centering (CENTRE-SETTLE rev): diving in while
      // near, the tick write carries an explicit centre — the CAMERA law
      // (centerSettleTargetFor), evaluated at the zoom this tick is heading
      // to, so the same synchronous write both zooms and places the frame and
      // the driver's next pass finds zero drift. The law replaces the old
      // 1-(1-b)^2 blend factor: that closed ~2.6 zoom levels' worth of
      // off-centre glide (measured 154px at the arm, still 16px at z8.84);
      // the settle law lands dead centre within CENTER_SETTLE_SPAN_Z levels
      // with the pan at rest at both ends. Still a pure function of the shared
      // scalars (arm frame + live zoom) — no new magic px, no ease curve, no
      // settle snap, no timer.
      // Zoom-out and far frames keep the cursor anchor (finger-owned framing,
      // park-safe) — EXCEPT under the mask (see maskNow below): once the
      // enclosing mask is up the write never carries the cursor anchor in
      // either direction. Around stays off a center-carrying write (around
      // re-anchors and would void it).
      let correctTo = null;
      let cBlend = 0;
      if (prox && prox.armed) {
        try {
          noteCenterArm(prox, z);
          // Direction-free: the settle law is a pure function of zoom, so
          // the SAME write serves the dive and the retrace — one camera
          // update per tick, never a zoom-then-pan pair the eye can catch.
          // The arm now captures at the FIRST armed tick (any zoom), not at
          // the mask band, so every scroll aims from the start.
          const t = centerSettleTargetFor(target);
          if (t) {
            correctTo = t;
            cBlend = centerSettleForZoom(target, centerArm ? centerArm.z : z, CENTER_SETTLE_SPAN_Z);
          }
        } catch { correctTo = null; cBlend = 0; }
      }
      // Mask-arm hold: same predicate as the vignette write (near && shared
      // blend > 0 — the mask is up). While it holds, the write never carries
      // the cursor anchor — zoom-out ticks hold the live center instead, so
      // framing never pans around the cursor after the mask appears. Mask
      // down keeps the cursor anchor (finger-owned framing, park-safe).
      const maskNow = centerBlendForZoom(z) > 0 && !!(prox && prox.armed);
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
          duration: 0,
        };
        // Tilt ownership stays at/above the mask floor, exactly as before:
        // the aim now claims world-view ticks too, and flattening a user's
        // oblique frame there would be a new yank, not a journey law.
        if (target >= Z_CENTER) opts.pitch = pitchTargetForZoom(target);
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
      try { window.__mapProbe.takeover = true; window.__mapProbe.zoomGain = 1; } catch { /* probe cosmetic */ }
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
      // UNWIND LAW: this lane is the first wheel entry at every zoom, so the
      // frame the dive is about to leave is recorded HERE (once per dive,
      // before any camera write) — Esc later restores exactly this frame.
      if (dy > 0) {
        try { noteDiveFrame('wheel'); } catch { /* dive frame is best-effort */ }
      }
      // Journey lock: zoom AROUND the canvas centre while the mask is armed —
      // in BOTH directions. The pan onto the hotspot is the CENTRE-SETTLE
      // law's job now (a pure function of zoom, so it lands exactly and
      // retraces exactly); a beyond-spot anchor for zoom-in would move the
      // spot the law just placed, one tick at a time (measured: a 5px
      // wobble per tick after the settle completed). Fully native downstream
      // (zoom math, events, zoomend) — only the anchor moves.
      let px = null, py = null;
      let locked = false;
      let laneRect = null;
      try {
        locked = !!((ctx && ctx.map && ctx.maskArmed && ctx.maskArmed()) || stagedActive || pendingReveal);
      } catch { locked = false; }
      if (locked) {
        try {
          const H = ctx.map.project(SITE_LNGLAT);
          // The canvas CONTAINER collapses to h=0 in this layout (the canvas
          // is absolutely positioned), so its rect gives centre y=300 on a
          // 700px map — the 50px offset that drifted the site by ~41px over
          // the last level. Measure the MAP container (the element MapLibre
          // was constructed into); the clone is still dispatched to laneEl.
          const host = (ctx.map.getContainer && ctx.map.getContainer()) || laneEl;
          const r = host.getBoundingClientRect();
          laneRect = { l: +r.left.toFixed(0), t: +r.top.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) };
          if (!(r.width > 0) || !(r.height > 0)) throw new Error('host rect unreadable');
          const P = lockAroundPoint(+H.x, +H.y, r.width / 2, r.height / 2, false);
          if (P) { px = r.left + P.x; py = r.top + P.y; }
          else locked = false;
        } catch { locked = false; }
      }
      // NO MASK GAIN (parity with the takeover): the flip clone carries the
      // raw user delta. Load-driven stalls remain the only brake.
      try { window.__mapProbe.zoomLock = locked; window.__mapProbe.zoomGain = 1; } catch { /* probe cosmetic */ }
      try {
        window.__mapProbe.lastAnchor = {
          locked,
          x: px == null ? +e.clientX : +px,
          y: py == null ? +e.clientY : +py,
          ex: +e.clientX, ey: +e.clientY,
          rect: laneRect,
        };
      } catch { /* probe cosmetic */ }
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
      // UNWIND LAW: pinch-in (ctrl+wheel deltaY<0) also opens a dive — record
      // the frame it leaves before any camera write.
      if (+e.deltaY < 0) {
        try { noteDiveFrame('pinch'); } catch { /* dive frame is best-effort */ }
      }
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
      try { armed = maskArmed() || stagedActive || pendingReveal; } catch { armed = false; }
      if (!armed) return;
      if (!mapRef || typeof mapRef.getCanvasContainer !== 'function') return;
      const lane = mapRef.getCanvasContainer();
      if (!lane || typeof lane.contains !== 'function' || !lane.contains(e.target)) return;
      const host = (mapRef.getContainer && mapRef.getContainer()) || lane;
      const r = host.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // NO MASK GAIN (parity with the wheel/flip lanes): the centered pinch
      // clone carries the raw pinch delta. Load-driven stalls remain the only
      // brake.
      try { window.__mapProbe.zoomGain = 1; } catch { /* probe cosmetic */ }
      let clone = null;
      try {
        clone = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: +e.deltaX || 0,
          deltaY: +e.deltaY || 0,
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
    // Input pressure stamp: the release watch may only conclude "impossible"
    // while the fingers are actually asking for forward progress. Without
    // this, simply stopping to look at the twin ejected the dive home 2.4s
    // later — a pause is not a dead end (measured).
    lastStagedInputMs = nowMs();
    // SEAM POP direction: the parity gate is FORWARD only — a reverse tick must
    // never be gated by the pose it is retreating from, so the drain always
    // writes the law. Set before the stall/arrival guards: a swallowed forward
    // tick is still forward intent.
    stagedFeedFwd = dy < 0;
    // AUTO-S: a reverse tick is the user leaving the hold. Stop the arrival
    // pump for the rest of this hold so a parked S cannot auto-dissolve after
    // the fingers have asked to back out.
    if (!stagedFeedFwd) stopStagedAutoPump();
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
    // ARRIVAL GATE: forward S opens only once the camera is at the handoff
    // pose. Until then the dolly keeps travelling to the ceiling and the
    // mask keeps shrinking with it (the live enclosure law still owns the
    // radii); without this the dissolve ran on the same ticks as the last
    // 0.99 zoom levels, which is exactly the owner's "the masked circle
    // remains and I keep zooming inside it". Reverse always drains.
    if (dy < 0 && mapRef) {
      let zNow = null;
      try { zNow = +mapRef.getZoom(); } catch { zNow = null; }
      if (Number.isFinite(zNow) && zNow < Z_HANDOFF - 0.01) {
        try { driveStagedOverlay(); } catch { /* hold repaint is best-effort */ }
        return;
      }
    }
    // SEAM POP (feeder): a forward tick must not advance the law past the point
    // the twin frame can show. The opacity gate alone still let S run to the
    // band end while the twin applied its base, so the first visible frame
    // landed at the law's 1.0 (a 120ms follower cut) instead of dissolving
    // across the band. Freezing S BEFORE the accumulate keeps the law and the
    // twin together: the fingers pause (bounded by the same parity patience),
    // then the dissolve plays across the remaining band. Reverse never
    // consults it, and S=0 always advances (the gate arms in-band only).
    if (dy < 0 && stagedS > 0) {
      let released = false;
      try { released = twinReleased(); } catch { released = false; }
      const parity = stagedBaseParityCheck(true, released);
      if (parity.gate) {
        try { driveStagedOverlay(); } catch { /* frozen repaint is best-effort */ }
        return;
      }
    }
    // REVERSE IS ALWAYS AN EXIT: a reverse tick never needs the stall to be
    // in a particular readiness state. If the dissolve has already drained to
    // S=0, release the hold and hand the next tick to native zoom-out. This
    // is the freeze the owner hit: a ready/content twin made the stall gate
    // false, so the reverse branch was skipped, S stayed 0, and every wheel
    // was swallowed by the staged lane — only pinch (ctrlKey, outside the
    // lane) escaped. A reverse tick is the escape; Esc still restores the
    // exact pre-dive frame.
    if (dy > 0) {
      if (stagedS <= 0) {
        try { exitStaged(); } catch { /* hold release is best-effort */ }
        try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
        return;
      }
      const sPrevRev = stagedS;
      stagedS = accumStagedS(stagedS, dy);
      if (stagedS <= 0 && sPrevRev > 0) {
        try { exitStaged(); } catch { /* hold release is best-effort */ }
        try { refreshStallLoading(); } catch { /* presentation is best-effort */ }
        return;
      }
      driveStagedOverlay();
      return;
    }
    // FORWARD FROM HERE: the reversed cases returned above.
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
    // OUTBOUND RETENTION: the default out-of-view tile cache spans a few zoom
    // levels; a reversed journey crosses up to ten, so levels warmed on the
    // way in were evicted before the way out and re-streamed as the world
    // widened. Keep a deeper per-source cache (bounded; viewport-derived) and
    // a hard ceiling so a pathological viewport cannot grow unbounded.
    maxTileCacheSize: 384,
    maxTileCacheZoomLevels: 8,
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
  // UNWIND LAW: the dive frame is captured at window level, before ANY lane
  // claims the tick — the flip lane only sees ticks whose target sits inside
  // #map, and the first forward tick of a dive can land on the body/chrome
  // (measured: the record was taken 5 zoom levels late at z=6.7 instead of
  // home). Passive + capture only; it writes no camera state.
  try {
    window.addEventListener('wheel', (e) => {
      try {
        if (e && +e.deltaY > 0) noteDiveFrame('wheel-any');
      } catch { /* dive frame is best-effort */ }
    }, { capture: true, passive: true });
  } catch { /* listener is best-effort */ }
  // FAST-INTENT meter: the same first-in-line window lane, passive and
  // read-only — it accumulates forward wheel px and stamps the mask arm /
  // gate arrival so the loading pill can tell a burst from a slow approach.
  // The per-event flag keeps the flip clones (re-dispatched tick) from
  // counting the same gesture twice; it writes no camera or hold state.
  try {
    window.addEventListener('wheel', (e) => {
      try {
        if (!e || e.__diveIntent) return;
        e.__diveIntent = true;
        noteDiveIntent(+e.deltaY);
      } catch { /* meter is best-effort */ }
    }, { capture: true, passive: true });
  } catch { /* listener is best-effort */ }
  // UNWIND LAW: Esc must work with focus anywhere on the embedding page, not
  // just inside this iframe — hook the same-origin parent document (no-op for
  // a cross-origin embed, and it only acts while a dive is live).
  try { installParentEscapeHook(); } catch { /* parent hook best-effort */ }
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
    // Pins follow the camera through the journey driver (one coalesced pass
    // per frame, which calls positionDomPins) — a second 'move' listener here
    // projected and wrote the same pins again on every move frame.
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
        onProgress: (snap, source) => scheduleNativeZoomStep(snap, source),
        onDown: () => {
          try {
            // INTENT GATE: this edge is the z>=Z_HANDOFF takeover entry — a
            // journey opener just like the deep latch, so it reads the same
            // live arm predicate. Without it an intent-less dive that is no
            // longer clamped at Z_TOP would still be captured by the twin the
            // moment the fingers crossed the handoff zoom.
            frameProxCache = null;
            const p = proximityInfo();
            if (!(p && p.armed)) return;
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
    // DEM-PRECACHE: seed the twin's first terrain stage (Terrarium z12 coarse
    // window around the site) at journey start, so the first dive's DEM read
    // is a cache hit instead of 9 S3 round-trips behind the twin's boot.
    try { prefetchDemTiles(SITE_LNGLAT, DEM_COARSE_ZOOM); } catch { /* best-effort */ }
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
