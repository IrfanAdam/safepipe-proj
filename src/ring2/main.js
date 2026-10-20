/* Safepipe Ops3D Ring-2 — src/ring2/main.js (Phase 3, Task 8/9 wiring).
 * Harness entry for /ops3d-ring2.html. Wires mapbase (ground) + overlays
 * (transparent twin) + mix (one slider) + per-frame sync (twin -> map).
 *
 * Camera authority is the twin orbit at EVERY mix: each frame the twin
 * pose drives the map via applyTwinToMap with the twin's own viewport/fov
 * so zoom parity holds. The map is constructed non-interactive and the
 * twin canvas stays pointer-interactive at all mixes, so satellite mode
 * (mix 0) orbits exactly like twin mode — OrbitControls always receives
 * input and the map follows via sync, never fighting it with native
 * handlers. Mix consumes the same pose's pitch for the TOP-only
 * satellite rule.
 * Exposes window.__ring2 { map, twin, mix, getPose, setMix } for the probe
 * lane, screenshots, and console driving.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-3]
 */
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { VEX } from './site.js';
import { ensureField, getStatus } from './field.js';
import { mountMapBase, assertTerrainOn, releaseMap } from './mapbase.js';
import { applyTwinToMap, assertTerrainVex, pitchForPose, bearingForPose, groundResForZoom, niceScale, MAP_TRUE_FOV_DEG, TWIN_MAX_RANGE_M, aspectMismatch } from './sync.js';
import { createOverlayTwin } from './overlays.js';
import * as THREE from 'three';
import { buildT0, buildT1, buildBackdrops } from './facilities/index.js';
import { sampleH } from './field.js';
import { mountVectorsFromData } from './vectors.js';
import { mountMixBar, loadMix } from './mix.js';
import { buildRingHud } from './hud.js';
import { scaleForLevel } from './hud-furniture.js';
import { parseSectorQuery, resolveSector, TWIN_CLOSE_MSG, TWIN_READY_MSG, TWIN_FULLSCREEN_MSG, frameTarget, frameRange, clampHandoffRange, easeInOutCubic, easeInOutSmoother, buildTwinCloseMessage, buildTwinReadyMessage, buildTwinPaintedMessage, firstPaintDue, isTwinCloseMessage, isTwinFullscreenMessage, reversePlanForPhase, twinHoldPoseMatch, twinHoldPoseError, precacheStatus, toneGradeForMix, HANDOFF_PREWARM_MIN_FRAMES, READY_SETTLE_FRAMES, HANDOFF_HOLD_MS, HANDOFF_SWOOP_MS, HANDOFF_PUSH_MS, HANDOFF_REVERSE_MS, HANDOFF_START_MIX, HANDOFF_END_MIX, HANDOFF_ISO_RANGE_M, HANDOFF_ISO_POLAR_DEG, isAtMaxZoom, scrubProgressForWheel, scrubProgressForWalk, scrubEntryForDelta, poseForScrubProgress, TWIN_SCRUB_ENTER_DELTA, TWIN_SCRUB_PINCH_ENTER_PX, scrubTotalMs, buildForwardLegs, fwdProgressForStagedS, forwardRingPForProgress, isTwinStagedMessage, TWIN_FWD_REVEAL_START_PX } from './sector.js';
import { isSizedWH, waitForSized } from './sizeGate.js';
/* Namespace read of the inbound stage table (Handoff-6-closewalk): the
 * generic reverse walker resolves stage ORDER + values through here so a
 * Lane A constant move applies with no further edits. Named imports above
 * stay the static contract; this is the forward-compatible lookup. */
import * as sectorNs from './sector.js';
import { Z_HANDOFF } from '../map/scrolltrigger.js';
import {
  createCtxMon,
  ctxLive,
  ctxLost,
  ctxRestored,
  mapLostPending,
  noteMapAdopted,
  killGL,
  pxToken,
  ctxToken,
  cxlToken,
  tileToken,
  ldTerrToken,
  effToken,
} from './ctxmon.js';

const el = document.getElementById('ring2-dev');
if (!el) throw new Error('ring2 harness: #ring2-dev missing');

// Dev + build worker: vite serves the real worker file as an asset URL.
// (mapbase.js owns the map; this only pins the global worker config the
// map constructor reads. Without it, vite-dev 404s the derived worker.)
if (maplibregl?.config) maplibregl.config.WORKER_URL = workerUrl;

el.innerHTML =
  '<div class="ring2-map" data-ring2="map"></div>' +
  '<div class="ring2-twin" data-ring2="twin-wrap"></div>' +
  '<div class="ring2-bar" data-ring2="bar"></div>' +
  '<div class="ring2-status" data-ring2="status" aria-live="polite"></div>';

let mapDiv = el.querySelector('[data-ring2="map"]');
const twinDiv = el.querySelector('[data-ring2="twin-wrap"]');
const barDiv = el.querySelector('[data-ring2="bar"]');
const statusDiv = el.querySelector('[data-ring2="status"]');
// Console mirror of the (now hidden) status chip: log only on change so the
// 500 ms paint loop never spams. Owner steer 2026-10-12: subtext is
// console-only, never painted.
let lastConsoleStatus = '';

/* Twin vertical fov === the MapLibre camera's true fov (sync.js
 * MAP_TRUE_FOV_DEG, pinned to maplibre-gl 6.13.0 transform_helper.ts
 * _fovInRadians 0.6435011087932844 ≈36.87°). The Map class has no public
 * fov setter, so the twin adopts the map — FOV 60 agreed with the map only
 * at nadir and drifted tens of px oblique (owner rotate/tilt finding).
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-00] */
const FOV_DEG = MAP_TRUE_FOV_DEG;
// Bump on every user-visible Ring-2 change: proves from a screenshot alone
// which build Safari actually ran (stale-build confusion ends here).
const BUILD_ID = 'b67twinentry';
// Shared GL-context + tile telemetry registry (see ctxmon.js: one
// real-Safari screenshot of the six tokens discriminates every hypothesis
// in the defect-hunt report).
const mon = createCtxMon();
try {
  window.__ring2ctx = mon;
} catch { /* diag ref only */ }
let map = null;
let twin = null;
let mixCtl = null;
let vexWarned = false;
let aspectWarned = false;
// Frame heartbeat (module scope so paintStatus can read it): counts twin
// frames, keeps the first frame error. -1 = loop not started yet.
let twinFrames = -1;
let twinErr = null;
// First-painted post (once per boot): the render loop has painted PREWARM
// frames — Lane A may reveal on this when ready-match cannot agree.
let paintedPosted = false;
let paintT0 = 0;
// Sticky map failure: the 500ms paintStatus interval rebuilds the status
// line, so a one-shot map FAILED write would be erased within a blink.
// Kept here, painted every tick until the map lands.
let mapFatal = null;
// Zero-canvas escalation state (see paintStatus heal): counts consecutive
// 500ms ticks where resize() can't unstick a 0x0 canvas.
let mapZeroTicks = 0;
let remounts = 0;
let remounting = false;
// Stuck-at-zero forensics: resize attempts, last resize() error, and whether
// the fresh-container last resort has fired — all surfaced in the status bar.
let mapResizes = 0;
let mapResizeErr = null;
let freshContainerTried = false;
// Bridge: remountMap lives in boot() closure (needs mapDiv/mixCtl);
// paintStatus is module scope, so boot hands it a callable here.
let requestRemount = null;
let requestFreshContainer = null;
// Per-adoption teardown handles from mountMapBase: dispose() stops the
// instance's heal timer + RO + window listeners (P9), isCtxLost reports a
// lost GL context (skip loseContext churn on teardown when already lost).
let mapTeardown = null;
// Slow-lane retry (P4 terminal-STUCK0 fix): after the 2+1 budget is spent,
// keep one retry per 30 s while the canvas is stuck or the context is lost
// in a sized container. Alternates remount / fresh-div; counted in-status.
let slowRemounts = 0;
let lastSlowRemount = 0;
const SLOW_RETRY_MS = 30000;
// Twin re-size tracker (P6): container dims at the last twin.onResize() —
// a changed box re-kicks the twin from the status tick (cheap, idempotent).
let lastTwinWH = '';
// Hidden->sized budget re-arm: a gallery iframe flickering hidden again
// burns the old budget on a 0x0-born instance. When the container comes
// back sized after having been hidden, the escalation counters reset so a
// fresh ladder is available for the fresh visibility.
let wasHidden = false;
let rearmed = 0;
// First-mount gate: true while boot waits for a non-zero container.
let waitingViewport = false;
// Post-remount verify tokens: each adopt bumps adoptSeq so a stale verify
// tick can't fire against a newer instance.
let adoptSeq = 0;

function containerWH() {
  return [(mapDiv?.clientWidth | 0) || 0, (mapDiv?.clientHeight | 0) || 0];
}

// True while the map canvas exists but has zero pixels (stuck, not mounting:
// a mounting map has no canvas yet and reads map:-).
function isMapStuckZero() {
  try {
    const c = map?.getCanvas?.();
    return !!c && (((c.width | 0) === 0 || (c.height | 0) === 0));
  } catch {
    return false;
  }
}

function canvasDims() {
  let mapSize = 'map:-';
  try {
    const c = map?.getCanvas?.();
    if (c) {
      mapSize = `map:${c.width}x${c.height}`;
      if ((c.width | 0) === 0 || (c.height | 0) === 0) {
        // Zero-canvas diagnosis straight from any screenshot: container size
        // tells resize-vs-collapse apart (c:0x0 = layout collapse, no amount
        // of map.resize() can fix that; c:WxH = resize() misfiring).
        const w = mapDiv?.clientWidth | 0, h = mapDiv?.clientHeight | 0;
        mapSize += `(c:${w}x${h})`;
      }
    }
  } catch { /* pre-mount */ }
  let twinSize = 'twin:-';
  try {
    const c = twin?.canvas;
    if (c) twinSize = `twin:${c.width}x${c.height}`;
  } catch { /* pre-mount */ }
  return `${mapSize} ${twinSize}`;
}

/* Terrain state for the ld/terr token: off (no terrain), vex (live at the
 * shared VEX), mis (on but wrong exaggeration — sync would float/bury). */
function terrainState() {
  try {
    if (!map || typeof map.getTerrain !== 'function') return 'off';
    const t = map.getTerrain();
    if (!t) return 'off';
    return t.exaggeration === VEX ? 'vex' : 'mis';
  } catch {
    return 'off';
  }
}

function mapLoaded() {
  try {
    return !!map?.loaded?.();
  } catch {
    return false;
  }
}

function mapPixelRatio() {
  try {
    const pr = map?.getPixelRatio?.();
    return typeof pr === 'number' && Number.isFinite(pr) ? pr : null;
  } catch {
    return null;
  }
}

/* The six ship-first telemetry tokens (ctxmon.js): one screenshot
 * discriminates every defect-hunt hypothesis. All values already exist on
 * live handles — status text only, no layout/DOM/network changes. */
function telemetryTokens() {
  let cw = 0, ch = 0;
  try {
    const c = map?.getCanvas?.();
    if (c) {
      cw = c.width | 0;
      ch = c.height | 0;
    }
  } catch { /* pre-mount */ }
  const ew = mapDiv?.clientWidth | 0, eh = mapDiv?.clientHeight | 0;
  let dpr = 1;
  try {
    dpr = window.devicePixelRatio || 1;
  } catch { /* ssr-proof */ }
  const stored = mixCtl?.getMix?.() ?? loadMix(50);
  let eff = stored;
  try {
    eff = mixCtl?.getEffMix?.() ?? stored;
  } catch { /* pre-mount floor unknown */ }
  return (
    ` · ${pxToken({ cw, ch, ew, eh, dpr, pr: mapPixelRatio() })}` +
    ` · ${ctxToken(mon)}` +
    ` · ${cxlToken(mon)}` +
    ` · ${tileToken(mon)}` +
    ` · ${ldTerrToken({ loaded: mapLoaded(), terrain: terrainState() })}` +
    ` · mix:${stored} ${effToken(eff)}`
  );
}

function paintStatus() {
  if (!statusDiv) return;
  // Hidden->sized re-arm runs first: a container that was hidden and is
  // sized again gets a fresh escalation budget (the old one may have been
  // spent on a 0x0-born instance while hidden).
  try {
    const [rw, rh] = containerWH();
    if (!isSizedWH(rw, rh)) {
      wasHidden = true;
    } else if (wasHidden) {
      wasHidden = false;
      if (remounts > 0 || freshContainerTried || mapZeroTicks > 0) {
        remounts = 0;
        freshContainerTried = false;
        mapZeroTicks = 0;
        mapResizes = 0;
        mapResizeErr = null;
        rearmed++;
      }
    }
  } catch {
    /* re-arm is best-effort */
  }
  // Escalation ladder (shared by the zero-canvas and context-loss paths):
  // a wedged instance is torn down and rebuilt into the live container.
  // Budget: 2 remounts, then 1 fresh-div; past that the slow lane keeps
  // one retry per 30 s while stuck (P4 terminal-STUCK0 fix). A lost map
  // (P1/P2) escalates on restore or 5 s after loss — never via resize()
  // (that is the L3 brick). Twin size drift re-kicks twin.onResize.
  function escalate(reason) {
    if (remounting) return;
    const [vw, vh] = containerWH();
    if (!isSizedWH(vw, vh)) {
      mapZeroTicks = 0;
      return; // hidden again — wait for visibility
    }
    if (typeof requestRemount !== 'function') return;
    if (remounts < 2) {
      requestRemount(reason);
    } else if (typeof requestFreshContainer === 'function' && !freshContainerTried) {
      requestFreshContainer(reason);
    } else {
      const now = Date.now();
      if (now - lastSlowRemount < SLOW_RETRY_MS) return;
      lastSlowRemount = now;
      slowRemounts++;
      // Alternate: even slow ticks remount into the live div, odd slow
      // ticks swap a fresh div (the old div itself may hold stale layout).
      if (slowRemounts % 2 === 0) {
        remounts = 1;
        requestRemount(reason ? `${reason}+slow` : 'slow');
      } else {
        requestFreshContainer(reason ? `${reason}+slow` : 'slow', true);
      }
    }
  }
  // Self-heal: map canvas 0x0 while its container has size (hidden-at-mount
  // gallery iframe). Cheap, runs on the existing 500ms tick; twin path needs
  // no help. Without this, mix:0 (pure SAT) is a permanent black hole.
  // Escalation: if resize() fires for 10 straight ticks (5s) with a sized
  // container and the canvas is STILL zero (observed live on real Safari —
  // resize() a permanent no-op there, fresh mounts also 0x0), the map
  // instance itself is wedged — tear it down and construct a fresh one into
  // the now-sized container. A ratio-0 canvas (pr:0) or a context lost
  // without restore is condemned on sight: no resize can ever undo those.
  try {
    const lostPending = mapLostPending(mon);
    const c = map?.getCanvas?.();
    const pr = mapPixelRatio();
    if (lostPending && map) {
      // P1/P2: loss with healthy dims never tripped the zero ladder (the
      // canvas keeps its WxH while the style is dead). Remount now, or 5 s
      // after loss at the latest — restore fires a remount on its own tick.
      const ageMs = Date.now() - mon.mapLostAt;
      if (ageMs > 5000) escalate('ctxlost');
      else mapZeroTicks = 0;
    } else if (c && ((c.width | 0) === 0 || (c.height | 0) === 0)) {
      const w = mapDiv?.clientWidth | 0, h = mapDiv?.clientHeight | 0;
      if (w > 0 && h > 0 && typeof map.resize === 'function') {
        mapResizes++;
        try { map.resize(); } catch (err) {
          mapResizeErr = `${err?.message ?? err}`.slice(0, 80);
        }
        const c2 = map.getCanvas?.();
        if (c2 && ((c2.width | 0) === 0 || (c2.height | 0) === 0)) {
          mapZeroTicks++;
          if (mapZeroTicks >= 10) escalate('stuck0');
        } else mapZeroTicks = 0;
      }
    } else if (pr === 0 && map) {
      // Ratio-0 brick with non-zero canvas: _maxCanvasSize locked [0,0],
      // every resize recomputes ratio 0. Only a re-mount heals it.
      mapZeroTicks = 10;
      escalate('ratio0');
    } else mapZeroTicks = 0;
  } catch { /* heal is best-effort */ }
  // Twin re-size on drift (P6): gallery show / iframe settle / orientation
  // without a window resize leaves renderer.setSize stale (1x1 blur, wrong
  // aspect). Cheap + idempotent — fire only when the box actually changed.
  try {
    const tw = twinDiv?.clientWidth | 0, th = twinDiv?.clientHeight | 0;
    if (tw > 0 && th > 0 && twin && typeof twin.onResize === 'function') {
      const key = `${tw}x${th}`;
      if (lastTwinWH && lastTwinWH !== key) {
        try {
          twin.onResize();
        } catch { /* twin drives on without us */ }
      }
      lastTwinWH = key;
    }
  } catch { /* twin kick is best-effort */ }
  const s = getStatus();
  const info = twin?.getInfo?.();
  const mapErr = globalThis.__ring2mapErrors?.at(-1);
  statusDiv.textContent =
    `RING-2 [${BUILD_ID}] · dem:${s.stage}/${s.source} tiles:${s.tilesLoaded}/${s.tilesTotal}` +
    ` · ${canvasDims()}` +
    telemetryTokens() +
    (info && info.min !== undefined
      ? ` · relief:${(info.max - info.min).toFixed(0)}m idx:${info.indexCount ?? 0} src:${info.source ?? '?'}`
      : '') +
    (vexWarned ? ' · VEX-WARN' : '') +
    (mapErr ? ` · MAPERR:${String(mapErr).slice(0, 120)}` : '') +
    (mapFatal ? ` · MAPFAILED:${mapFatal}` : '') +
    (waitingViewport ? ' · map:waiting-viewport' : '') +
    (rearmed ? ` · rearm:${rearmed}` : '') +
    (slowRemounts ? ` · slow:${slowRemounts}` : '') +
    (isMapStuckZero() ? ` · STUCK0 rs:${mapResizes} rm:${remounts}${freshContainerTried ? ' newdiv:1' : ''}${mapResizeErr ? ` rserr:${mapResizeErr}` : ''}` : '') +
    (mapLostPending(mon) ? ' · CTXLOST' : '') +
    (twinFrames >= 0
      ? ` · frames:${twinFrames}${twinErr ? ` TWINERR:${String(twinErr).slice(0, 120)}` : ''}`
      : '');
  try {
    // frames: ticks every paint — strip it so the console only hears real
    // state changes (tiles, errors, remounts), not the heartbeat.
    const stable = statusDiv.textContent.replace(/ · frames:\d+/, '');
    if (stable !== lastConsoleStatus) {
      lastConsoleStatus = stable;
      console.debug(`[ring2] ${stable}`);
    }
  } catch { /* console never breaks paint */ }
}

async function boot() {
  // Chrome first, map second: the status chip + mix bar are plain DOM and
  // must paint even if the map/tiles hang — a black box with no message is
  // the failure mode we're eliminating. Every stage is visible in a
  // screenshot, so a user report always carries the diagnosis.
  statusDiv.textContent = 'RING-2 · boot: dom ✓ · map: loading…';
  // Tile cache (Phase 01): versioned Service Worker, CacheFirst, scoped to
  // tile hosts ONLY (see tilecache.js / public/ring2-tile-sw.js). Purely
  // best-effort — any failure, missing SW support, or non-secure context
  // silently skips; boot NEVER breaks on this.
  // [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/ring2-tile-sw.js').catch(() => {});
    }
  } catch { /* tile cache never breaks boot */ }
  // Field loads in the background; overlays start on procedural and
  // re-drape live via the status bus (no await — first paint is fast).
  ensureField().catch(() => {}).finally(() => paintStatus());

  twin = createOverlayTwin(twinDiv, {
    fovDeg: FOV_DEG,
    startRange: 26000,
    /* Task-36 flight-idle gate: the DEM auto-redrape disposes + recreates
     * every overlay mesh (a multi-frame hitch), so while the twin owns the
     * camera — intro flight or scrub reverse — the rebuild waits for the
     * settled twin (phase done/idle, no scrub owning the walk). Bounded by
     * REDRAPE_MAX_DEFERS inside overlays, so a parked hold can never pin a
     * stale drape forever. */
    isFlightIdle: () => {
      try {
        return (handoff.phase === 'done' || handoff.phase === 'idle') && !handoff.scrub?.active;
      } catch {
        return true;
      }
    },
  });
  // Phase-01 OSM vectors: draped roads/tracks/paths/coastline/terminal (osm
  // provenance). Best-effort — a missing asset never breaks boot.
  // [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
  try {
    mountVectorsFromData(twin.scene)
      .then((h) => {
        try {
          twin.addEmphasisMats?.(h?.materials ?? []);
        } catch { /* emphasis registration never breaks boot */ }
      })
      .catch(() => {});
  } catch { /* vectors never break boot */ }
  // Phase-02 T0 structures: parametric tanks/trains/racks on board seeds
  // (board F1+S1–S6). Additive group — facilities never break boot.
  // [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-02]
  try {
    for (const build of [buildT0, buildT1, buildBackdrops]) {
      const g = build();
      if (!g) continue;
      // Grounding (parent-owned): each sited structure sits on the live DEM
      // at its world bbox-center x/z. Long corridors use midpoint height —
      // ends may deviate on slopes (plain site: small; stamped approximated).
      const bb = new THREE.Box3();
      const bc = new THREE.Vector3();
      for (const cat of g.children) {
        for (const s of cat.children) {
          try {
            bb.setFromObject(s);
            bb.getCenter(bc);
            s.position.y += sampleH(bc.x, bc.z) * VEX;
          } catch { /* one ungrounded structure never blocks the rest */ }
        }
      }
      twin.scene.add(g);
    }
  } catch { /* facilities never break boot */ }
  statusDiv.textContent = 'RING-2 · boot: twin ✓ · map: loading…';
  // Twin GL census + context wiring: the twin canvas is the second context
  // in the budget. Lost → stamp (cxl:twin:lost); restored → re-size into
  // the live box (three re-inits its own GL state on restore; the size may
  // have drifted while the canvas was dead). No twin re-mount: three
  // self-heals, and rebuilding would churn a third context for nothing.
  try {
    ctxLive(mon, +1);
  } catch { /* census never breaks boot */ }
  try {
    const twinCanvas = twin?.canvas;
    twinCanvas?.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      try {
        ctxLost(mon, 'twin');
      } catch { /* stamp is best-effort */ }
      window.__ring2mapErrors = [...(window.__ring2mapErrors ?? []), 'twin WebGL context LOST (GPU)'].slice(-5);
      paintStatus();
    });
    twinCanvas?.addEventListener('webglcontextrestored', () => {
      try {
        ctxRestored(mon, 'twin');
      } catch { /* stamp is best-effort */ }
      try {
        twin?.onResize?.();
      } catch { /* twin drives on without us */ }
      paintStatus();
    });
  } catch { /* twin wiring never breaks boot */ }

  mixCtl = mountMixBar(barDiv, {
    getTwinCanvas: () => twinDiv.querySelector('[data-ring2="twin"]'),
    getTwinContainer: () => twinDiv,
    getMap: () => map,
    applyEmphasis: (t) => twin.setEmphasis(t),
    setTakeover: (u) => twin.setTakeover(u),
    getPitchDeg: () => 0,
  });
  paintStatus();

  // Phase 00 Task 1 (P1) HUD chrome + P2 Lane C camera presets (TOP/ISO/
  // NEAR over the v1 LEVELS network/segment/asset). Guarded — HUD dressing
  // + preset wiring never break boot; live feed wiring lands in P3.
  //
  // Preset geometry (twin metres, origin = Sangachal terminal pin):
  //   network/TOP: high zenith ~0 over target (straight-down survey view)
  //   segment/ISO: mid oblique (45° polar) covering the segment reach
  //   asset/NEAR:  close low oblique (60° polar, 3 km) on the terminal
  // Ranges sit inside the twin orbit clamps (1500 m … TWIN_MAX_RANGE_M) and polars
  // inside the 65° tilt clamp, so a preset never fights OrbitControls.
  const VIEW_PRESETS = {
    network: { range: 28000, polarDeg: 0, azimDeg: 0 },
    segment: { range: 12000, polarDeg: 45, azimDeg: 35 },
    asset: { range: 3000, polarDeg: 60, azimDeg: 35 },
  };
  const LEVEL_ALIASES = {
    network: 'network', top: 'network', 1: 'network',
    segment: 'segment', iso: 'segment', 2: 'segment',
    asset: 'asset', near: 'asset', 3: 'asset',
  };
  function setViewPreset(name) {
    const level = LEVEL_ALIASES[String(name ?? '').toLowerCase()];
    if (!level) return null;
    const p = VIEW_PRESETS[level];
    try {
      if (!twin?.controls || !twin?.camera) return null;
      twin.controls.target.set(0, 0, 0);
      const pol = (p.polarDeg * Math.PI) / 180;
      const az = (p.azimDeg * Math.PI) / 180;
      const sp = Math.sin(pol), cp = Math.cos(pol);
      // TOP (polar 0) mirrors the boot camera: straight above + epsilon z
      // so the up-vector never degenerates.
      twin.camera.position.set(
        p.range * sp * Math.sin(az),
        p.range * cp,
        p.range * sp * Math.cos(az) + (p.polarDeg === 0 ? 0.01 : 0),
      );
      // Settle damping + snap the orbit target to terrain NOW so getPose()
      // (and the next frame's map sync) already report the preset pose.
      twin.updateControls();
      try {
        const lbl = hud?.els?.scaleLabel;
        if (lbl) lbl.textContent = `≈ ${scaleForLevel(level).label}`;
      } catch { /* scale fallback never breaks a preset */ }
      return level;
    } catch {
      return null;
    }
  }
  // REAL backend for Lane A's 1/2/3 keys + Lane B's VIEW buttons: both lanes
  // call onLevel(name); the per-frame loop feeds the resulting pitch+range
  // to mixCtl, so telemetry/status + mix bar follow untouched.
  function handleLevel(name) {
    try {
      return setViewPreset(name);
    } catch {
      return null;
    }
  }
  let hud = null;
  try {
    hud = buildRingHud(el, { onLevel: handleLevel });
  } catch { /* hud chrome never breaks boot */ }

  /* Live chrome (Phase 02 Lane F): the compass needle + scale bar follow the
   * free camera every frame — needle rotates with the twin pose bearing,
   * scale label/bar follows the live map zoom. Cosmetic only: every read is
   * guarded (twin/map may be null) and the body + wiring are try/caught so
   * live chrome can never break boot or a frame. */
  let lastNeedleDeg = null;
  let lastScaleText = null;
  function tickChrome() {
    try {
      try {
        const needle = hud?.els?.needle;
        const pose = twin?.getPose ? twin.getPose() : null;
        if (needle && pose?.eye && pose?.target) {
          const b = bearingForPose(pose.eye, pose.target);
          if (Number.isFinite(b)) {
            const r = Math.round(b * 2) / 2;
            if (r !== lastNeedleDeg) {
              lastNeedleDeg = r;
              needle.style.transform = `rotate(${-r}deg)`;
            }
          }
        }
      } catch { /* needle is cosmetic — never breaks the frame */ }
      try {
        const scaleLabel = hud?.els?.scaleLabel;
        const scaleBar = hud?.els?.scaleBar;
        if (scaleLabel && map) {
          const z = typeof map.getZoom === 'function' ? map.getZoom() : null;
          const c = typeof map.getCenter === 'function' ? map.getCenter() : null;
          const lat = c && typeof c.lat === 'number' ? c.lat : (Array.isArray(c) ? c[1] : null);
          if (Number.isFinite(z) && Number.isFinite(lat)) {
            const { label, frac } = niceScale(groundResForZoom(z, lat), 120);
            const text = `≈ ${label}`;
            if (text !== lastScaleText) {
              lastScaleText = text;
              scaleLabel.textContent = text;
            }
            const segs = scaleBar?.children;
            if (segs && segs.length >= 2) {
              segs[0].style.flexGrow = String(frac);
              segs[1].style.flexGrow = String(1 - frac);
            }
          }
        }
      } catch { /* scale is cosmetic — never breaks the frame */ }
    } catch { /* live chrome never breaks a frame */ }
    requestAnimationFrame(tickChrome);
  }
  try {
    requestAnimationFrame(tickChrome);
  } catch { /* live chrome never breaks boot */ }

  /* LANE 3 twinlink handoff (twin-side inbound + reverse): the map overlay
   * opens this page as ?sector=<h3>&cx=<lng>&cy=<lat>&z=<zoom>[&bearing=],
   * where the frame is the RING bounds (wider than the terminal).
   * Forward flight is three stages: open at the ring frame top-down
   * satellite (pitch 0, bearing matching the map, slider at full
   * satellite), hold a beat, ease to iso at the attached angle (same
   * ring center/range, slider STAYS at 0), then a tiny push-in to the
   * terminal while the SAT->TWIN slider drives satellite->twin — the
   * push-in and the slider move together. Close plays the exact mirror:
   * pull back to the ring frame + slider->0 + pitch->0 (pull segment, then
   * pitch-back segment), then posts the close message with {recede:true}
   * so the parent fades sat->flat + zooms back out.
   * Pure math (parse/ease/message) lives in sector.js (node-checkable);
   * this block owns the camera/slider flight. Never breaks boot. */
  const handoff = {
    phase: 'idle', // idle|hold|swoop|push|reverse|done
    t0: 0,
    start: null, // pinned top-down ring footprint { tx, ty, tz, range, bearing }
    mid: null, // ring-frame iso { eye, target } (swoop end / push start)
    from: null, // flight segment start { eye, target, mix }
    to: null, // terminal iso { eye, target, mix }
    revMode: null, // reverse plan for THIS close: snap|pitch|full (sector.js reversePlanForPhase)
    walk: null, // generic reverse walk: { legs:[{name,eye,target,mix,ms,from,fromMix}], i, legT0 } or null
    scrub: null, // scroll-scrub reverse: { progress:0..1, accum, justEntered } or null (wheel owns the walk)
    fwd: null, // Task-36 intro scrub: { legs:[swoop,push], progress:0..1, t0, staged } or null (pose = pure fn of progress)
    fwdStagedS: null, // last parent-posted staged scroll S (px); null = no staged driver, autoplay advances the scalar
    fwdStagedAt: null, // handoffNow() ms of the last staged-S post (freshness stamp for the release seed cap)
    capExpired: false, // hold parked past HOLD+CAP with no ready post (shelved-cap observability for the probe)
    entryAccum: 0, // Task-37 gesture entry: accumulated outward wheel/pinch delta (px) at the zoom clamp toward scrub-reverse
    frame: null, // handed-off { cx, cy, z, bearing } (range refit source)
    anchor: null, // ring-frame center { x, z } (range refit source)
    azim: 0, // attached-angle azimuth rad (range refit source)
    readyPosted: false, // {type:'safepipe-twin-ready'} sent once per handoff
    readyHits: 0, // consecutive agreed hold frames (settle gate before post)
    closePosted: false, // {recede:true} close sent (later closes re-post, never re-fly)
    entryPose: null, // GATE-3 native-zoom: live camera pose captured BEFORE the entry pin (continuity proof)
    entryFrames: -1, // twinFrames at entry (boot entry runs pre-first-paint, so no visible jump is possible)
    refits: 0, // viewport-settle range refits applied during hold (each restarts the settle count)
    precache: null, // GATE-3 predictive precache: { kicked, warmT0, lastErr, lastT, vel, poseOk, scene, pose, warm }
  };
  /* Hold cap: the inbound waits in hold for the matched sat frame (map up +
   * first painted frame at mix 0, twin + map poses both on the hold frame)
   * before the swoop may start — but never forever. Past HOLD + CAP the
   * flight proceeds unposted; Lane A's own reveal timeout (~4 s) owns the
   * fallback reveal. The cap sits just under the 30 s map-mount timeout so
   * cold-cache / throttled-CPU boots still post on agreement instead of
   * timing out into an unposted swoop. */
  const HANDOFF_READY_CAP_MS = 25000;
  const handoffNow = () => {
    try {
      return performance.now();
    } catch {
      return Date.now();
    }
  };
  function viewportPxNow() {
    try {
      return Math.max(twinDiv.clientHeight || window.innerHeight, 1);
    } catch {
      return 600;
    }
  }
  function groundYNear(x, z) {
    try {
      return sampleH(x, z) * VEX;
    } catch {
      return 0;
    }
  }
  /* Analytic top-down eye for a pinned start (matches pinTopDown exactly). */
  function startEye(s) {
    const b = ((s.bearing || 0) * Math.PI) / 180;
    const e = Math.max(s.range * 1e-4, 0.01);
    return { x: s.tx - e * Math.sin(b), y: s.ty + s.range, z: s.tz + e * Math.cos(b) };
  }
  /* Top-down pin at the exact handoff footprint: pitch ~0, epsilon offset
   * along the map bearing so bearingForPose reports the map's bearing. */
  function pinTopDown(tx, tz, range, bearingDeg) {
    const ty = groundYNear(tx, tz);
    const s = { tx, ty, tz, range, bearing: (((Number(bearingDeg) || 0) % 360) + 360) % 360 };
    try {
      twin.controls.target.set(tx, ty, tz);
      const e = startEye(s);
      twin.camera.position.set(e.x, e.y, e.z);
      twin.updateControls();
    } catch { /* flight steps pin per-frame anyway */ }
    return s;
  }
  function poseAt(tx, ty, tz, range, polarDeg, azimRad) {
    const pol = (polarDeg * Math.PI) / 180;
    const sp = Math.sin(pol), cp = Math.cos(pol);
    return {
      x: tx + range * sp * Math.sin(azimRad),
      y: ty + range * cp,
      z: tz + range * sp * Math.cos(azimRad),
    };
  }
  function driveMix(v) {
    try {
      mixCtl.setMix(Math.round(v), { silent: true });
    } catch { /* slider drive never breaks the frame */ }
  }
  function capturePose() {
    let eye = null, tgt = null;
    try {
      const p = twin?.getPose?.();
      eye = p?.eye;
      tgt = p?.target;
    } catch { /* fall back to live objects below */ }
    try {
      return {
        eye: {
          x: eye?.x ?? twin.camera.position.x,
          y: eye?.y ?? twin.camera.position.y,
          z: eye?.z ?? twin.camera.position.z,
        },
        target: {
          x: tgt?.x ?? twin.controls.target.x,
          y: tgt?.y ?? twin.controls.target.y,
          z: tgt?.z ?? twin.controls.target.z,
        },
        mix: mixCtl?.getMix?.() ?? HANDOFF_END_MIX,
      };
    } catch {
      return null;
    }
  }
  function beginHandoffFlight(pinnedStart, ringIso, terminal) {
    handoff.start = pinnedStart;
    handoff.mid = ringIso;
    handoff.to = terminal;
    handoff.from = null;
    handoff.fwd = null;
    handoff.fwdStagedS = null;
    handoff.fwdStagedAt = null;
    handoff.capExpired = false;
    handoff.revMode = null;
    handoff.walk = null;
    handoff.scrub = null;
    handoff.entryAccum = 0;
    handoff.readyPosted = false;
    handoff.readyHits = 0;
    handoff.closePosted = false;
    handoff.refits = 0;
    // GATE-3 native-zoom entry continuity: record the staged entry pose
    // (probe: __ring2.entry()). Boot entry runs before the first frame
    // paints (twinFrames is still -1 — see entryFrames), so staging the
    // HANDED frame is jump-free by construction: the first painted pixel is
    // already the handed view, and the hold pin below re-asserts the same
    // pose every frame (painted hold steps measure 0 m).
    // The pin target is always the handed frame (never a canned pose): the
    // range came from frameRange(z) on the map's actual handed zoom and the
    // center from its handed cx/cy. Leg handoffs stay continuous downstream
    // (swoop starts from the live captured pose, push from the exact mid).
    try {
      handoff.entryPose = capturePose();
    } catch {
      handoff.entryPose = null;
    }
    try {
      handoff.entryFrames = twinFrames;
    } catch {
      handoff.entryFrames = -1;
    }
    handoff.precache = { kicked: true, warmT0: handoffNow(), lastErr: null, lastT: 0, vel: 0, poseOk: false, scene: false, pose: false, warm: false };
    // GATE-3 predictive precache (defect 6, twin side): promote the DEM fetch
    // the moment the inbound stages — the live drape + first warm frames land
    // before the ready post instead of after it. Boot already kicked this;
    // the re-kick is a deduped no-op when live (field.js inflight guard).
    try {
      ensureField().catch(() => {});
    } catch { /* boot already kicked it */ }
    handoff.phase = 'hold';
    handoff.t0 = handoffNow();
    try {
      twin.controls.enabled = false;
    } catch { /* flight still drives the camera */ }
    try {
      pinTopDown(pinnedStart.tx, pinnedStart.tz, pinnedStart.range, pinnedStart.bearing);
      driveMix(HANDOFF_START_MIX);
    } catch { /* flight steps pin per-frame anyway */ }
    // User takeover: any orbit input cancels the intro flight (never the
    // reverse — a requested close always completes).
    try {
      const c = twin?.canvas;
      const cancel = () => {
        if (handoff.phase === 'hold' || handoff.phase === 'swoop' || handoff.phase === 'push') endHandoffFlight();
      };
      c?.addEventListener?.('pointerdown', cancel, { once: true });
      c?.addEventListener?.('wheel', cancel, { once: true });
    } catch { /* user-takeover is best-effort */ }
  }
  function endHandoffFlight() {
    handoff.phase = 'done';
    handoff.walk = null;
    try {
      twin.controls.enabled = true;
    } catch { /* input stays as-is */ }
  }
  const lerp = (a, b, k) => a + (b - a) * k;
  function applyFlightPose(eye, target) {
    twin.controls.target.set(target.x, target.y, target.z);
    twin.camera.position.set(eye.x, eye.y, eye.z);
  }
  /* FRAME-MATCH read (Lane B): true once the top-down satellite start frame
   * is actually on screen — map instance up, at least one twin frame
   * painted, flight still pinned top-down in hold, slider at full satellite.
   * Satellite purity at mix 0 is mapbase-owned (Esri World Imagery primary +
   * backup at raster-opacity 1, reference 0.85, hillshade at base
   * exaggeration) with the twin takeover gated to 0 at effective mix 0, so
   * mix 0 here means the bare Esri photo under a transparent twin. Zoom
   * parity is by construction: the pinned range came from frameRange(z) with
   * this camera's own viewport/fov/lat, and the per-frame applyTwinToMap
   * drives the map from the same pose with the same viewport/fov. */
  function readyMatch() {
    try {
      if (!handoff.start || !handoff.frame || handoff.phase !== 'hold') return false;
      if (!map) return false;
      // GATE-3 precache: the scene is warm only after PREWARM frames have
      // painted (damping converged, first live drape on screen) — not one.
      if (!(twinFrames >= HANDOFF_PREWARM_MIN_FRAMES)) return false;
      // Content gate: pose + cam agreement is not enough — the reveal must
      // never land on an unpainted frame. Map tile-idle + terrain draped;
      // a streaming scene withholds exactly like a mismatched pose.
      try {
        if (typeof mapLoaded === 'function' && !mapLoaded()) return false;
      } catch {
        return false;
      }
      try {
        if (typeof terrainState === 'function' && terrainState() !== 'vex') return false;
      } catch {
        return false;
      }
      const m = mixCtl?.getMix?.();
      if (m !== HANDOFF_START_MIX) return false;
      // The LIVE twin camera must itself sit on the requested hold frame —
      // not just the pin command having been issued. A pose still settling
      // (damping residue, a viewport refit that just rebuilt the start, a
      // user input mid-flight) withholds the post; the hold re-runs this
      // every frame until it agrees (settle gate in stepHandoff).
      try {
        if (!twinHoldPoseMatch(capturePose(), handoff.start)) return false;
      } catch {
        return false;
      }
      // The live map camera must actually SHOW the frame (not just the twin
      // pin): same center/zoom within tolerance. When terrain is still off
      // the per-frame twin->map sync skips (assertTerrainVex) and the map
      // sits at its mount camera — claiming a match then would be false, so
      // hold runs to the cap instead and Lane A's timeout owns the reveal.
      try {
        const c = map.getCenter?.();
        const z = map.getZoom?.();
        const clon = Array.isArray(c) ? c[0] : c?.lng;
        const clat = Array.isArray(c) ? c[1] : c?.lat;
        if (![clon, clat, z].every(Number.isFinite)) return false;
        if (Math.abs(clon - handoff.frame.cx) > 2e-4) return false;
        if (Math.abs(clat - handoff.frame.cy) > 2e-4) return false;
        if (Math.abs(z - handoff.frame.z) > 0.05) return false;
        const b = map.getBearing?.();
        if (Number.isFinite(b)) {
          const want = ((Number(handoff.frame.bearing) || 0) % 360 + 360) % 360;
          const d = Math.abs((((b - want + 540) % 360) + 360) % 360 - 180);
          if (d > 0.5) return false;
        }
        const p = map.getPitch?.();
        if (Number.isFinite(p) && Math.abs(p) > 0.5) return false;
      } catch {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  /* Post {type:'safepipe-twin-ready'} ONCE per handoff (Lane A reveals the
   * pre-warmed overlay on this). Probe: window.__ring2.ready() +
   * window.__ring2readyOut[]. Never breaks the frame. */
  function postTwinReady() {
    if (handoff.readyPosted) return true;
    handoff.readyPosted = true;
    try {
      window.parent?.postMessage(buildTwinReadyMessage(), '*');
    } catch { /* parent notify is best-effort */ }
    try {
      (window.__ring2readyOut ?? (window.__ring2readyOut = [])).push(buildTwinReadyMessage());
    } catch { /* probe log is best-effort */ }
    return true;
  }
  /* Zoom-offset refit: the pinned range was computed at boot with the boot
   * viewport height, but the live loop drives the map from the LIVE height.
   * If the box settled differently (iframe show, orientation, gallery
   * display:none->block), the start range — and the ring-iso mid derived
   * from it — would hold a stale zoom. While still in hold (pre-swoop),
   * recompute from the stored frame z with the live viewport and rebuild
   * start + mid so the match is pixel-close at reveal time. */
  function refitHandoffRange() {
    try {
      if (!handoff.frame || !handoff.anchor || handoff.phase !== 'hold') return false;
      const vp = viewportPxNow();
      let r = frameRange(handoff.frame.z, { viewportPx: vp, lat: handoff.frame.cy });
      if (!Number.isFinite(r) || r <= 0) return false;
      // Handoff-5-close: clamp to the shared orbit rails (sync.js, via the
      // sector.js pure clampHandoffRange) — the ceiling fits the 10 km ring
      // + margin in short viewports. Counts the refit: each one restarts the
      // settle count below, so the post tracks the CURRENT pin.
      r = clampHandoffRange(r);
      if (!Number.isFinite(r) || r <= 0) return false;
      const old = handoff.start?.range;
      if (Number.isFinite(old) && Math.abs(old - r) < 1) return false;
      const s = pinTopDown(handoff.anchor.x, handoff.anchor.z, r, handoff.frame.bearing ?? 0);
      handoff.start = s;
      const aty = groundYNear(handoff.anchor.x, handoff.anchor.z);
      const eye = poseAt(handoff.anchor.x, aty, handoff.anchor.z, r, HANDOFF_ISO_POLAR_DEG, handoff.azim);
      handoff.mid = { eye, target: { x: handoff.anchor.x, y: aty, z: handoff.anchor.z } };
      driveMix(HANDOFF_START_MIX);
      handoff.refits = (handoff.refits | 0) + 1;
      return true;
    } catch {
      return false;
    }
  }
  /* Generic reverse-walk table (Handoff-6-closewalk): the inbound flight is
   * an ordered list of NAMED stages. The order is read from sector.js when
   * it names one (HANDOFF_STAGE_ORDER / INBOUND_STAGES / STAGE_ORDER),
   * else the canonical hold->swoop->push->done. Every value below comes
   * from the sector.js imports or the live handoff anchors — no pose
   * numbers live here, so Lane A moves apply with no further edits. */
  function inboundStageOrder() {
    try {
      const o = sectorNs.HANDOFF_STAGE_ORDER ?? sectorNs.INBOUND_STAGES ?? sectorNs.STAGE_ORDER;
      if (Array.isArray(o) && o.length) return o.map((s) => String(s).toLowerCase());
    } catch { /* canonical fallback below */ }
    return ['hold', 'swoop', 'push', 'done'];
  }
  /* Forward ms for undoing a stage (its own replay duration, sector-owned). */
  function stageUndoMs(name) {
    if (name === 'push' || name === 'done') return HANDOFF_PUSH_MS;
    if (name === 'hold') return HANDOFF_HOLD_MS;
    return HANDOFF_SWOOP_MS; // swoop + any future pitch-scale stage
  }
  /* Named stage pose at close time (null when its anchor is unknown — the
   * walker skips that leg and the final pin still guarantees top-down).
   * A Lane A resolver (sectorNs.stagePoseFor / *_STAGE_POSES) wins when
   * present; otherwise poses resolve from the live anchors. */
  function stagePose(name) {
    try {
      if (typeof sectorNs.stagePoseFor === 'function') {
        const p = sectorNs.stagePoseFor(name, { start: handoff.start, mid: handoff.mid, to: handoff.to });
        if (p && p.eye && p.target) {
          return {
            name,
            eye: { ...p.eye },
            target: { ...p.target },
            mix: Number.isFinite(p.mix) ? p.mix : HANDOFF_START_MIX,
          };
        }
      }
      const table = sectorNs.HANDOFF_STAGE_POSES ?? sectorNs.STAGE_POSES;
      if (table && typeof table === 'object' && table[name] && table[name].eye && table[name].target) {
        const p = table[name];
        return {
          name,
          eye: { ...p.eye },
          target: { ...p.target },
          mix: Number.isFinite(p.mix) ? p.mix : HANDOFF_START_MIX,
        };
      }
    } catch { /* live-anchor resolution below */ }
    try {
      if (name === 'hold') {
        const s = handoff.start;
        if (!s) return null;
        const se = startEye(s);
        return { name, eye: se, target: { x: s.tx, y: s.ty, z: s.tz }, mix: HANDOFF_START_MIX };
      }
      if (name === 'swoop') {
        const mid = handoff.mid;
        if (!mid) return null;
        return { name, eye: { ...mid.eye }, target: { ...mid.target }, mix: HANDOFF_START_MIX };
      }
      if (name === 'push' || name === 'done') {
        const to = handoff.to;
        if (!to) return null;
        return { name, eye: { ...to.eye }, target: { ...to.target }, mix: HANDOFF_END_MIX };
      }
    } catch { /* null below */ }
    return null;
  }
  /* Build the close-time walk: every inbound stage actually passed, newest
   * first, each leg undoing its stage over that stage's forward ms. Done
   * rests AT the push end pose, so it undoes push (no terminal leg — the
   * pull starts from wherever the camera is, never a canned start). An
   * unknown phase walks everything (terminal-side full walk). Zero legs =
   * still top-down in hold: the engine pins + posts immediately. */
  function buildReverseWalk(closePhase) {
    const order = inboundStageOrder();
    const phase = String(closePhase ?? '').toLowerCase();
    let idx = order.indexOf(phase);
    if (phase === 'done') idx = order.indexOf('push');
    if (idx < 0) idx = order.length - 1;
    const cur = capturePose();
    const curMix = Number.isFinite(cur?.mix) ? cur.mix : HANDOFF_START_MIX;
    const legs = [];
    let from = cur;
    let fromMix = curMix;
    for (let i = idx - 1; i >= 0; i--) {
      const pose = stagePose(order[i]);
      if (!pose) continue;
      const undone = order[i + 1] ?? order[idx];
      legs.push({ ...pose, ms: stageUndoMs(undone), from, fromMix });
      from = { eye: { ...pose.eye }, target: { ...pose.target } };
      fromMix = pose.mix;
    }
    return { legs, order: order.slice(0, idx), from: cur };
  }
  /* GATE-3 ring-from-corners (defect 5, twin side): flight-phase -> ring
   * reveal progress 0..1, or null when no flight owns the ring (idle/done/
   * standalone — the normal mix law stands). Hold 0, swoop 0->1 on the same
   * smootherstep as the camera, push 1 (settled site ring), reverse mirrors
   * (walk progress or scrub progress back to 0). */
  function ringFlightP() {
    try {
      const ph = handoff.phase;
      if (ph === 'hold') return 0;
      if (ph === 'swoop' || ph === 'push') {
        // Task-36: the ring reads the SAME scrub progress as the camera
        // (sector.js forwardRingPForProgress over the fwd legs) — stroke
        // and pose agree exactly, no second clock.
        return forwardRingPForProgress(handoff.fwd?.legs, handoff.fwd?.progress ?? 0);
      }
      if (ph === 'reverse') {
        if (handoff.scrub?.active) return Math.min(1, Math.max(0, 1 - handoff.scrub.progress));
        const w = handoff.walk;
        if (w && Array.isArray(w.legs) && w.legs.length) {
          return Math.min(1, Math.max(0, 1 - scrubProgressForWalk(w.legs, w.i, w.legT0, handoffNow())));
        }
        return 0;
      }
    } catch { /* normal law below */ }
    return null;
  }
  // Change cache: setToneGrade/setRingReveal re-walk every emphasis mat, so
  // the per-frame drive only calls on value change (mix steps are integers;
  // the ring quantizes to 1e-3 — no visible step, no per-frame churn).
  let lastToneApplied = -1;
  let lastRingApplied = 'x';
  /* Per-frame flight step (runs at the top of the render loop, before the
   * damped controls settle — the flight IS the pose source while active).
   * Forward: hold (ring top-down, mix 0) -> swoop (ring top-down -> ring
   * iso at the attached angle, mix STAYS 0) -> push (ring iso -> terminal
   * iso, mix 0->100 with the push-in). Reverse mirrors exactly inside the
   * single 'reverse' phase by stepping the close-time leg list (see
   * buildReverseWalk), then the {recede:true} close posts. */
  function stepHandoff() {
    if (!handoff || handoff.phase === 'idle') return;
    /* GATE-3 SCROLL-SCRUB clamp rail (handoff12-B: the cap is an EXIT
     * trigger, never a parking spot): a range strictly PAST the cap clamps
     * back onto it and exits on the SAME frame (no parking past the rail,
     * not even for a frame). Resting AT the clamp never auto-enters — entry
     * is gesture-owned (decisive/accumulated outward wheel/pinch delta in
     * onTwinScrubWheel) or explicit (Esc / parent-X / close message).
     * Gated on a flown handoff (start set) so standalone free orbit never
     * trips it; re-arms when range drops back. */
    if (handoff.phase === 'done') {
      if (handoff.start && !handoff.closePosted && !handoff.walk) {
        let r = null;
        try {
          r = twin?.camera?.position?.distanceTo?.(twin?.controls?.target);
        } catch { r = null; }
        if (Number.isFinite(r) && r > TWIN_MAX_RANGE_M * 1.001) {
          // Past the cap (damping overshoot or an external push): pull back
          // onto the rail along the current view ray, then exit NOW.
          try {
            const t = twin.controls.target;
            const e = twin.camera.position;
            const dx = e.x - t.x, dy = e.y - t.y, dz = e.z - t.z;
            const L = Math.hypot(dx, dy, dz);
            if (L > 0) {
              const k = TWIN_MAX_RANGE_M / L;
              e.set(t.x + dx * k, t.y + dy * k, t.z + dz * k);
              twin.updateControls();
            }
          } catch { /* clamp is best-effort; the exit below still runs */ }
          handoff.entryAccum = 0;
          enterScrubReverse();
          // No entering gesture owns this entry — an immediate inward wheel
          // must recover free orbit at once, not park at progress 0.
          try {
            if (handoff.scrub) handoff.scrub.justEntered = false;
          } catch { /* scrub flag is best-effort */ }
          return;
        }
        if (!Number.isFinite(r) || !isAtMaxZoom(r)) handoff.entryAccum = 0;
      } else {
        handoff.entryAccum = 0;
      }
      return;
    }
    try {
      const now = handoffNow();
      if (handoff.phase === 'hold') {
        const s = handoff.start;
        if (s) {
          try {
            pinTopDown(s.tx, s.tz, s.range, s.bearing);
          } catch { /* pin is best-effort */ }
        }
        driveMix(HANDOFF_START_MIX);
        // FRAME-MATCH + ready: keep the box honest (viewport settle refit),
        // then declare the matched sat frame the moment it is really on
        // screen. A refit rebuilds the pinned start, so the settle count
        // restarts — the post must track the CURRENT pin, never a stale one.
        // The swoop starts only after the ready signal — staged
        // inbound runs post-match — or past the hold cap (Lane A fallback).
        try {
          if (refitHandoffRange()) handoff.readyHits = 0;
        } catch { /* refit is best-effort */ }
        // GATE-3 predictive precache (defect 6, twin side): from inbound hold
        // progress + pose-settle velocity, track scene-warm / pose-warm /
        // ready BEFORE the reveal lands (probe: __ring2.precache()). Never
        // gates the post itself — the settle counter below stays the post's
        // single owner — and never breaks the frame.
        try {
          const pc = handoff.precache;
          if (pc) {
            const perr = twinHoldPoseError(capturePose(), handoff.start);
            const nowMs = handoffNow();
            if (perr && pc.lastErr && Number.isFinite(pc.lastT) && nowMs > pc.lastT) {
              const dt = Math.max(1, nowMs - pc.lastT) / 1000;
              pc.vel = (pc.lastErr.posM - perr.posM) / dt; // +m/s = converging
            }
            pc.lastErr = perr;
            pc.lastT = nowMs;
            pc.poseOk = twinHoldPoseMatch(capturePose(), handoff.start);
            const st = precacheStatus({ poseOk: pc.poseOk, mapUp: !!map, frames: twinFrames });
            pc.scene = st.scene;
            pc.pose = st.pose;
            pc.warm = st.ready;
          }
        } catch { /* precache telemetry never breaks the frame */ }
        // Settle gate: a single agreeing frame withholds — post only after
        // READY_SETTLE_FRAMES consecutive agreements, so the signal lands
        // exactly when the live camera has settled on the hold frame. Any
        // mismatch resets the count; the check re-runs every hold frame
        // (slow boot simply takes more frames, never a false post).
        try {
          if (readyMatch()) {
            handoff.readyHits += 1;
            if (handoff.readyHits >= READY_SETTLE_FRAMES) postTwinReady();
          } else {
            handoff.readyHits = 0;
          }
        } catch { /* ready is best-effort */ }
        const heldMs = now - handoff.t0;
        // Task-36: the 25 s cap is SHELVED as an advance trigger — the hold
        // exits on the ready post only, never blind. Past HOLD+CAP with no
        // post (fully-stalled loop, map down) the flight parks top-down at
        // the safe satellite frame and raises capExpired for the probe; a
        // late post still releases normally, and Lane A's own reveal timeout
        // owns the fallback reveal either way.
        if (!handoff.readyPosted && !handoff.capExpired
          && heldMs >= HANDOFF_HOLD_MS + HANDOFF_READY_CAP_MS && twinFrames >= HANDOFF_PREWARM_MIN_FRAMES) {
          handoff.capExpired = true;
        }
        // Scroll-path painted release: the timed click path never posts
        // staged S, so its ready-gated exit below is untouched. A
        // painted-but-unready twin with fingers in the reveal band exits
        // the hold on paint — same leg-freezing path — so
        // fwdProgressForStagedS scrubs swoop then push+mix under the
        // fingers instead of parking at driveMix(0). The truly unpainted
        // case stays parked (pin + mix 0, no advance).
        const preStaged = handoff.fwdStagedS;
        const preStagedS = preStaged === null || preStaged === undefined ? null : Number(preStaged);
        const stagedInReveal = preStagedS !== null && Number.isFinite(preStagedS)
          && preStagedS >= TWIN_FWD_REVEAL_START_PX;
        // Deep-frame painted release (scroll path): a handed frame at/past
        // the map-side handoff gate (Z_HANDOFF) carries map pitch 45 — release
        // on paint like the staged band so the reveal dissolves off the iso
        // seed below, never a parked top-down hold whose ready-match an
        // off-site arrival can structurally never grant.
        const frameZ = Number(handoff.frame && handoff.frame.z);
        const frameDeep = Number.isFinite(frameZ) && frameZ >= Z_HANDOFF;
        const paintedRelease = heldMs >= HANDOFF_HOLD_MS && !handoff.readyPosted
          && paintedPosted && (stagedInReveal || frameDeep);
        if ((heldMs >= HANDOFF_HOLD_MS && handoff.readyPosted) || paintedRelease) {
          // Task-36 intro scrub: freeze the anchors into one forward leg
          // list — pose/mix/ring all read it as a pure function of progress
          // from here on. Staged scroll received during the hold only seeds
          // the release progress (the pin never moved, so the ready match
          // stayed honest). The legs start from the LIVE pose (no jump on
          // release), falling back to the pinned start when uncaptured.
          const st = handoff.start;
          const live = capturePose();
          const liveStart = live && live.eye && live.target
            ? { eye: live.eye, target: live.target }
            : null;
          const legs = buildForwardLegs({
            startPose: liveStart
              ?? (st ? { eye: startEye(st), target: { x: st.tx, y: st.ty, z: st.tz } } : null),
            mid: handoff.mid,
            to: handoff.to,
          });
          if (!legs) {
            endHandoffFlight();
            return;
          }
          handoff.from = live;
          // Release seed: scroll-path (deep handed frame) releases are
          // finger-owned even when no staged seed survived the iframe-boot
          // race (early S posts predate the twin listener and are lost —
          // the map re-emits the live S at grant, but the release may land
          // first). Park at the S-mapped progress and let scroll ticks drive
          // — never the autoplay clock behind the unrevealed overlay, which
          // played the push invisibly and read as a zoom-in cut while the
          // zoom-out reverse stayed scrubbed. Legs start from the live pose,
          // so the release is jump-free and scroll-up retraces it
          // symmetrically. Shallow click frames keep the autoplay intro.
          const hasStagedSeed = handoff.fwdStagedS !== null && handoff.fwdStagedS !== undefined
            && Number.isFinite(Number(handoff.fwdStagedS));
          const staged = hasStagedSeed || frameDeep;
          handoff.fwd = {
            legs,
            progress: fwdProgressForStagedS(handoff.fwdStagedS ?? 0),
            t0: now,
            staged,
          };
          handoff.phase = 'swoop';
          handoff.t0 = now;
        }
        return;
      }
      if (handoff.phase === 'swoop' || handoff.phase === 'push') {
        // Task-36 intro scrub: ONE 0..1 progress drives eye/target/mix
        // through the shared scrub pose law (poseForScrubProgress over the
        // legs frozen at hold exit) — no per-leg wall clocks. Autoplay
        // advances the scalar on a single clock until staged scroll takes
        // over (parent posts S; symmetric — scroll-up retreats the pose).
        // The phase label follows progress so probes + the close-time
        // reverse walker (buildReverseWalk) still see swoop vs push.
        const fwd = handoff.fwd;
        if (!fwd || !Array.isArray(fwd.legs) || !fwd.legs.length) {
          endHandoffFlight();
          return;
        }
        if (fwd.staged) {
          fwd.progress = fwdProgressForStagedS(handoff.fwdStagedS ?? 0);
        } else {
          const total = scrubTotalMs(fwd.legs);
          fwd.progress = total > 0
            ? Math.min(1, Math.max(0, (now - fwd.t0) / total))
            : 1;
        }
        const fs = poseForScrubProgress(fwd.legs, fwd.progress);
        if (!fs) {
          endHandoffFlight();
          return;
        }
        try {
          applyFlightPose(fs.eye, fs.target);
        } catch { /* pose drive is best-effort */ }
        driveMix(fs.mix);
        let swoopW = 0.5;
        try {
          const total = scrubTotalMs(fwd.legs);
          const m0 = Number(fwd.legs[0]?.ms);
          if (total > 0 && Number.isFinite(m0) && m0 > 0) swoopW = m0 / total;
        } catch { /* weight is best-effort; the pose above already applied */ }
        handoff.phase = fwd.progress < swoopW ? 'swoop' : 'push';
        if (fwd.progress >= 1) {
          const to = handoff.to;
          try {
            if (to) applyFlightPose(to.eye, to.target);
          } catch { /* snap is best-effort */ }
          driveMix(HANDOFF_END_MIX);
          endHandoffFlight();
        }
        return;
      }
      if (handoff.phase === 'reverse') {
        /* GATE-3 SCROLL-SCRUB: while scrub is active the wheel owns the walk
         * — pose comes from journey progress (same legs, same smootherstep,
         * same slider law as the timed engine, so scrub and timed renders
         * agree pose-for-pose) and the timed clock below is bypassed. At
         * progress 1 the final pin + {recede:true} post run the shared path. */
        if (handoff.scrub?.active) {
          const swalk = handoff.walk;
          const s = poseForScrubProgress(swalk?.legs, handoff.scrub.progress);
          if (!s) {
            const sd = handoff.start;
            if (sd) {
              try {
                pinTopDown(sd.tx, sd.tz, sd.range, sd.bearing);
              } catch { /* pin is best-effort */ }
            }
            driveMix(HANDOFF_START_MIX);
            handoff.scrub = null;
            endHandoffFlight();
            postTwinClose();
            return;
          }
          try {
            applyFlightPose(s.eye, s.target);
          } catch { /* pose drive is best-effort */ }
          driveMix(s.mix);
          if (handoff.scrub.progress >= 1) {
            const sd = handoff.start;
            if (sd) {
              try {
                pinTopDown(sd.tx, sd.tz, sd.range, sd.bearing);
              } catch { /* pin is best-effort */ }
            }
            driveMix(HANDOFF_START_MIX);
            handoff.scrub = null;
            endHandoffFlight();
            postTwinClose();
          }
          return;
        }
        // Generic reverse walk: step the leg list built at close time from
        // the named inbound stages actually passed. Each leg flies from the
        // previous waypoint to the next stage pose over that stage's own
        // forward ms with the slider riding down to full satellite; the
        // final pin guarantees top-down + slider 0 even if an anchor went
        // missing mid-walk — then the {recede:true} close posts.
        const walk = handoff.walk;
        if (!walk || !Array.isArray(walk.legs) || walk.i >= walk.legs.length) {
          const s = handoff.start;
          if (s) {
            try {
              pinTopDown(s.tx, s.tz, s.range, s.bearing);
            } catch { /* pin is best-effort */ }
          }
          driveMix(HANDOFF_START_MIX);
          endHandoffFlight();
          postTwinClose();
          return;
        }
        const leg = walk.legs[walk.i];
        const span = Number.isFinite(leg.ms) && leg.ms > 0 ? leg.ms : HANDOFF_SWOOP_MS;
        const t = Math.min(1, Math.max(0, (now - walk.legT0) / span));
        const k = easeInOutSmoother(t); // GATE-3 REVISION tempo: mirror curve
        const fe = (leg.from && leg.from.eye) || leg.eye;
        const ft = (leg.from && leg.from.target) || leg.target;
        try {
          applyFlightPose(
            { x: lerp(fe.x, leg.eye.x, k), y: lerp(fe.y, leg.eye.y, k), z: lerp(fe.z, leg.eye.z, k) },
            { x: lerp(ft.x, leg.target.x, k), y: lerp(ft.y, leg.target.y, k), z: lerp(ft.z, leg.target.z, k) },
          );
        } catch { /* pose drive is best-effort */ }
        driveMix(lerp(Number.isFinite(leg.fromMix) ? leg.fromMix : HANDOFF_START_MIX, leg.mix, k));
        if (t >= 1) {
          walk.i += 1;
          walk.legT0 = now;
          if (walk.i >= walk.legs.length) {
            const s = handoff.start;
            if (s) {
              try {
                pinTopDown(s.tx, s.tz, s.range, s.bearing);
              } catch { /* pin is best-effort */ }
            }
            driveMix(HANDOFF_START_MIX);
            endHandoffFlight();
            postTwinClose();
          }
        }
      }
    } catch { /* flight never breaks the frame */ }
  }
  function postTwinClose() {
    // Extended payload first (parent recedes on {recede:true}), then the
    // legacy bare string — the current parent closes only on strict string
    // equality, so both fire until the parent learns the object form.
    handoff.closePosted = true;
    try {
      window.parent?.postMessage(buildTwinCloseMessage(true), '*');
    } catch { /* parent notify is best-effort */ }
    try {
      window.parent?.postMessage(TWIN_CLOSE_MSG, '*');
    } catch { /* parent notify is best-effort */ }
    try {
      (window.__ring2closeOut ?? (window.__ring2closeOut = [])).push(buildTwinCloseMessage(true));
    } catch { /* probe log is best-effort */ }
  }
  /* Close entry: REVERSE-FROM-ANYWHERE — captures the live pose + mix at
   * close time and walks back through the stages actually passed (never a
   * jump to a canned start), then signals the parent with {recede:true}.
   * X (parent chrome) + browser-back are parent-owned — the parent tears the
   * iframe down directly; Esc, the sister HUD lane, and parent close
   * messages call this. Safe standalone (no frame): notifies now.
   * Idempotent: a close after the post re-posts without re-flying.
   * Task 37: the reverse is ALWAYS scrub-owned — the walk is built from the
   * live pose, handed to handoff.scrub at the live progress, and an explicit
   * close drives that scrub to 1 through paintScrubPose (completeScrubReverse).
   * No wall clock ever restarts here; the wheel stays the analog path. */
  function requestTwinClose() {
    try {
      if (handoff.phase === 'reverse') {
        if (handoff.scrub?.active) completeScrubReverse();
        return true; // already running: drive it home, never re-fly
      }
      if (!handoff.start) {
        postTwinClose(); // standalone: no frame to reverse to
        return true;
      }
      if (handoff.closePosted && handoff.phase === 'done') {
        postTwinClose(); // repeat close: re-post, never re-fly
        return true;
      }
      const prevPhase = handoff.phase;
      // Generic reverse walk over the named inbound stages actually passed
      // (sector.js order + poses — never a jump to a canned start). The
      // sector-owned plan label stays on the probe for compat.
      handoff.revMode = reversePlanForPhase(prevPhase);
      const walk = buildReverseWalk(prevPhase);
      if (!walk.legs.length) {
        // Still top-down at the ring frame (hold): no stage was entered, so
        // the mirror is a pin + mix 0 + immediate post.
        try {
          const s = handoff.start;
          pinTopDown(s.tx, s.tz, s.range, s.bearing);
          driveMix(HANDOFF_START_MIX);
        } catch { /* pin is best-effort */ }
        handoff.walk = null;
        endHandoffFlight();
        postTwinClose();
        return true;
      }
      const cur = walk.from;
      if (!cur || !cur.eye || !cur.target) {
        postTwinClose();
        return false;
      }
      // Hand the live-posed walk to the scrub at the live progress (0: the
      // walk starts where the camera is) and drive it home now — the same
      // legs, same smootherstep, same slider law as the wheel path, so Esc
      // and the wheel agree pose-for-pose.
      handoff.from = cur;
      handoff.walk = { legs: walk.legs, i: 0, legT0: handoffNow() };
      handoff.scrub = { active: true, progress: 0, accum: 0, justEntered: false };
      handoff.entryAccum = 0;
      handoff.phase = 'reverse';
      try {
        twin.controls.enabled = false;
      } catch { /* flight still drives the camera */ }
      completeScrubReverse();
      return true;
    } catch {
      try {
        postTwinClose();
      } catch { /* parent notify is best-effort */ }
      return false;
    }
  }

  /* GATE-3 SCROLL-SCRUB, twin side: zoom-out-at-max enters the staged
   * reverse and the wheel scrubs the whole way back, stage by stage,
   * symmetric with the way in (wheel-up = outward/reverse intent, the same
   * sign the map-side scroll trigger treats as close — see sector.js
   * TWIN_SCRUB_WHEEL_PX convention). Entry has two paths: a decisive
   * OUTWARD wheel AT the zoom clamp (onTwinScrubWheel — inward wheels pass
   * through to OrbitControls, which dollies back in natively), or
   * ACCUMULATED outward wheel/pinch delta at the clamp (same handler —
   * covers pinch-outs and trackpad dust, since pinch wheels stay native).
   * An unowned reverse takes outward non-pinch wheels over the same way
   * (takeover at the live progress, no pose jump). Scrubbing back to 0
   * hands free orbit back (symmetric exit); scrubbing to 1 pins top-down +
   * posts {recede:true} on the shared path. Never breaks boot/input. */
  function rangeNow() {
    try {
      const r = twin?.camera?.position?.distanceTo?.(twin?.controls?.target);
      return Number.isFinite(r) ? r : null;
    } catch {
      return null;
    }
  }
  /* Enter the wheel-owned staged reverse from twin mode (done). Same leg
   * list as the timed close-from-done — push, swoop, hold waypoints — so the
   * journey back walks the identical stages. Non-done phases defer to the
   * timed requestTwinClose path. */
  function enterScrubReverse() {
    try {
      if (handoff.phase === 'reverse') return true;
      if (!handoff.start || handoff.closePosted) return false;
      if (handoff.phase !== 'done') {
        requestTwinClose();
        return true;
      }
      handoff.revMode = reversePlanForPhase('done');
      const walk = buildReverseWalk('done');
      if (!walk.legs.length) {
        try {
          const s = handoff.start;
          pinTopDown(s.tx, s.tz, s.range, s.bearing);
          driveMix(HANDOFF_START_MIX);
        } catch { /* pin is best-effort */ }
        handoff.walk = null;
        handoff.scrub = null;
        endHandoffFlight();
        postTwinClose();
        return true;
      }
      const cur = walk.from;
      if (!cur || !cur.eye || !cur.target) return false;
      handoff.from = cur;
      handoff.walk = { legs: walk.legs, i: 0, legT0: handoffNow() };
      handoff.scrub = { active: true, progress: 0, accum: 0, justEntered: true };
      handoff.entryAccum = 0;
      handoff.phase = 'reverse';
      try {
        twin.controls.enabled = false;
      } catch { /* flight still drives the camera */ }
      return true;
    } catch {
      return false;
    }
  }
  /* Explicit-close completion (Task 37 — Esc / parent-X / close message):
   * drives the scrub-owned reverse to progress 1 through paintScrubPose,
   * then the shared pin + {recede:true} post. Same legs, same smootherstep,
   * same slider law as the wheel path — never a wall clock, never a pose
   * jump. False when no scrub owns the reverse. */
  function completeScrubReverse() {
    try {
      const sc = handoff.scrub;
      if (!sc?.active) return false;
      sc.progress = 1;
      sc.justEntered = false;
      paintScrubPose();
      finishScrubReverse();
      return true;
    } catch {
      return false;
    }
  }
  /* Paint the scrubbed pose immediately (called from the wheel handler so
   * high-frequency bursts read continuously instead of waiting a frame).
   * True when the journey completed (caller pins + posts). */
  function paintScrubPose() {
    try {
      const sc = handoff.scrub;
      if (!sc?.active) return false;
      const s = poseForScrubProgress(handoff.walk?.legs, sc.progress);
      if (!s) return false;
      try {
        applyFlightPose(s.eye, s.target);
      } catch { /* pose drive is best-effort */ }
      driveMix(s.mix);
      return sc.progress >= 1;
    } catch {
      return false;
    }
  }
  function finishScrubReverse() {
    try {
      const s = handoff.start;
      if (s) {
        try {
          pinTopDown(s.tx, s.tz, s.range, s.bearing);
        } catch { /* pin is best-effort */ }
      }
      driveMix(HANDOFF_START_MIX);
    } catch { /* pin is best-effort */ }
    handoff.scrub = null;
    endHandoffFlight();
    postTwinClose();
  }
  /* Task-36 staged forward driver (parent -> twin): the map-side staged
   * scrub posts { type:'safepipe-twin-staged', s } as S accumulates past
   * the gate. Receiving the first one flips the intro scrub from autoplay
   * to staged (progress follows the S mapping; symmetric on scroll-up).
   * In hold the pin never moves — S only seeds the release progress, so
   * the ready match stays honest. Never breaks boot/input. */
  function applyTwinStagedS(s) {
    try {
      const v = Number(s);
      if (!Number.isFinite(v)) return false;
      handoff.fwdStagedS = Math.max(0, v);
      try {
        handoff.fwdStagedAt = handoffNow();
      } catch { /* freshness stamp is best-effort */ }
      if (handoff.fwd && (handoff.phase === 'swoop' || handoff.phase === 'push')) {
        handoff.fwd.staged = true;
      }
      return true;
    } catch {
      return false;
    }
  }
  window.addEventListener('message', (e) => {
    try {
      if (!isTwinStagedMessage(e?.data)) return;
      applyTwinStagedS(e.data.s);
    } catch { /* staged drive never breaks input */ }
  });
  /* Capture-phase wheel over the twin container (runs before OrbitControls'
   * own canvas listener, so stopPropagation keeps a consumed gesture from
   * fighting the scrubbed pose). Consumes ONLY scrub gestures — every other
   * non-pinch wheel is sign-flipped and re-dispatched to the twin canvas so
   * OrbitControls dollies the OSM direction (drag-up = out, drag-down = in,
   * the map-side installWheelFlip convention; pinch stays native on both
   * sides): free orbit, intro flight, free orbit away from the clamp, and
   * the timed reverse except outward takeover. */
  function twinFlipToOrbit(e) {
    // Fail-open: no canvas, bad delta, or unclonable event => native runs.
    try {
      if (!e || e.__zoomFlipped) return;
      const dY = Number(e?.deltaY);
      if (!Number.isFinite(dY) || dY === 0) return;
      let canvas = null;
      try { canvas = twinDiv?.querySelector?.('canvas') ?? null; } catch { canvas = null; }
      if (!canvas) return;
      let clone = null;
      try {
        clone = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: -(Number(e.deltaX) || 0),
          deltaY: -dY,
          deltaZ: Number(e.deltaZ) || 0,
          deltaMode: e.deltaMode,
          clientX: e.clientX, clientY: e.clientY,
          screenX: e.screenX, screenY: e.screenY,
          ctrlKey: false, shiftKey: !!e.shiftKey,
          altKey: !!e.altKey, metaKey: !!e.metaKey,
        });
        clone.__zoomFlipped = true;
      } catch { return; }
      try { e.preventDefault(); } catch { /* consume is best-effort */ }
      try { e.stopPropagation(); } catch { /* consume is best-effort */ }
      canvas.dispatchEvent(clone);
    } catch { /* flip never breaks input */ }
  }
  function onTwinScrubWheel(e) {
    try {
      if (e?.__zoomFlipped) return;
      const pinch = !!(e?.ctrlKey || e?.metaKey);
      const dY = Number(e?.deltaY);
      if (!Number.isFinite(dY) || dY === 0) return;
      // Pinch is NOT dropped here: it stays native for zoom (never counts
      // toward scrub progress), but its outward delta feeds the done-phase
      // entry accumulator below — the dwell-counter's pinch exit, gestured.
      if (!handoff.start || handoff.closePosted) { if (!pinch) twinFlipToOrbit(e); return; }
      // Native pinch-zoom everywhere except the done-phase clamp entry:
      // flipping a pinch clone would convert it into a plain dolly.
      if (pinch && handoff.phase !== 'done') return;
      if (handoff.phase === 'done') {
        // Free orbit: outward intent AT the zoom clamp crosses into the
        // staged reverse. Inward wheels pass through to OrbitControls, which
        // dollies back in natively — entering on an inward gesture would
        // park controls-disabled at progress 0 for no reason. A decisive
        // outward wheel enters on the single shot; sub-threshold outward
        // wheels AND pinch-outs (pinch stays native — its delta only feeds
        // entry) accumulate toward the same entry via scrubEntryForDelta, so
        // pinch/keyboard arrivals cross in on gesture, never on a timer.
        if (dY >= 0) { handoff.entryAccum = 0; if (!pinch) twinFlipToOrbit(e); return; }
        const r = rangeNow();
        if (!Number.isFinite(r) || !isAtMaxZoom(r)) { handoff.entryAccum = 0; if (!pinch) twinFlipToOrbit(e); return; }
        const decisive = !pinch && Math.abs(dY) >= TWIN_SCRUB_ENTER_DELTA;
        if (!decisive) {
          const upd = scrubEntryForDelta(handoff.entryAccum ?? 0, dY, { enterPx: TWIN_SCRUB_PINCH_ENTER_PX });
          handoff.entryAccum = upd.accum;
          if (!upd.enter) {
            // Below the entry budget the gesture still belongs to orbit
            // (a no-op against the clamp) — never swallowed.
            if (!pinch) twinFlipToOrbit(e);
            return;
          }
          handoff.entryAccum = 0;
        } else {
          handoff.entryAccum = 0;
        }
        if (!enterScrubReverse()) { twinFlipToOrbit(e); return; }
        if (handoff.phase !== 'reverse' || !handoff.scrub?.active) { twinFlipToOrbit(e); return; }
        if (pinch) return; // entered on pinch: pose stays native, wheel owns it from here
      } else if (handoff.phase === 'reverse' && !handoff.scrub?.active) {
        // Unowned reverse (defensive — closes always hand a scrub now):
        // outward non-pinch wheels take over at the live progress.
        if (pinch) return;
        if (dY >= 0 || !handoff.walk) return;
        handoff.scrub = {
          active: true,
          progress: scrubProgressForWalk(handoff.walk.legs, handoff.walk.i, handoff.walk.legT0, handoffNow()),
          accum: 0,
          justEntered: false,
        };
      } else if (!(handoff.phase === 'reverse' && handoff.scrub?.active)) {
        twinFlipToOrbit(e); return;
      }
      const sc = handoff.scrub;
      if (!sc?.active) { twinFlipToOrbit(e); return; }
      if (pinch) return; // pinch stays native even while owned (progress law ignores it; never swallow it)
      try {
        e.preventDefault();
      } catch { /* consume is best-effort */ }
      try {
        e.stopPropagation();
      } catch { /* consume is best-effort */ }
      sc.accum = (Number(sc.accum) || 0) + Math.abs(dY);
      // Pinch never counts toward journey progress (sector.js convention —
      // pinch stays with OrbitControls); it still consumes while owned.
      sc.progress = scrubProgressForWheel(sc.progress, dY, { pinch });
      const wasEnter = !!sc.justEntered;
      sc.justEntered = false;
      if (sc.progress >= 1) {
        paintScrubPose();
        finishScrubReverse();
        return;
      }
      // Symmetric exit: scrubbed all the way back in (past the entering
      // gesture) hands free orbit back at the live scrubbed pose.
      if (sc.progress <= 0 && !wasEnter) {
        paintScrubPose();
        handoff.scrub = null;
        handoff.walk = null;
        endHandoffFlight();
        return;
      }
      paintScrubPose();
    } catch { /* wheel never breaks input */ }
  }
  try {
    twinDiv?.addEventListener?.('wheel', onTwinScrubWheel, { passive: false, capture: true });
  } catch { /* scrub entry is best-effort */ }

  /* Delegated fullscreen state (twin-side). Embedded (?embed=1): the HUD
   * FULLSCREEN button posts { type:'safepipe-twin-fullscreen', on } to the
   * parent and its label follows the parent's echoed state — the twin never
   * fullscreens its own document (that would hide the parent's CLOSE).
   * Standalone: native self-fullscreen stands, this stays inert. Probe:
   * window.__ring2.fs { delegated, on }, window.__ring2fsOut[] (posted). */
  let fsDelegated = false;
  let fsOn = false;
  function paintDelegatedFsLabel(btn, on) {
    try {
      btn.textContent = on ? 'EXIT FULL' : 'FULLSCREEN';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    } catch { /* label sync never breaks boot */ }
  }
  function wireDelegatedFullscreen(embedded) {
    fsDelegated = !!embedded;
    let btn = null;
    try {
      btn = hud?.els?.fsBtn ?? document.querySelector('.ops-hud__fs') ?? null;
    } catch { /* probe ref is best-effort */ }
    try {
      window.__ring2.fs = { delegated: fsDelegated, on: fsOn };
    } catch { /* probe write is best-effort */ }
    if (!btn) return false;
    try {
      window.__ring2.fsBtn = btn;
    } catch { /* probe ref is best-effort */ }
    if (!embedded) return false; // standalone: native self-fullscreen stands
    // Ancestor capture runs before hud-overlays.js' bubble-phase native
    // handler on the button itself (a same-node capture listener would lose
    // the registration-order race at target). stopPropagation at this level
    // keeps requestFullscreen from ever firing while embedded.
    window.addEventListener('click', (e) => {
      try {
        const t = e?.target?.closest?.('.ops-hud__fs');
        if (!t) return;
        e.preventDefault();
        e.stopPropagation();
        let cur = false;
        try {
          cur = t.getAttribute('aria-pressed') === 'true';
        } catch { /* default to requesting on */ }
        const next = !cur;
        try {
          window.parent?.postMessage(buildTwinFullscreenMessage(next), '*');
        } catch { /* parent notify is best-effort */ }
        try {
          (window.__ring2fsOut ?? (window.__ring2fsOut = [])).push(
            buildTwinFullscreenMessage(next),
          );
        } catch { /* probe log is best-effort */ }
      } catch { /* delegation never breaks input */ }
    }, true);
    // The parent's echo is the label's single source of truth while
    // embedded (map-side Lane-1 owns the target + state).
    window.addEventListener('message', (e) => {
      try {
        if (!isTwinFullscreenMessage(e?.data)) return;
        fsOn = !!e.data.on;
        const b = hud?.els?.fsBtn ?? document.querySelector('.ops-hud__fs') ?? btn;
        if (b) paintDelegatedFsLabel(b, fsOn);
        try {
          window.__ring2.fs = { delegated: true, on: fsOn };
        } catch { /* probe write is best-effort */ }
      } catch { /* label sync never breaks the frame */ }
    });
    return true;
  }

  window.__ring2 = {
    map,
    twin,
    mix: mixCtl,
    hud,
    build: BUILD_ID,
    zoomFlip: 'up-out',
    getPose: () => twin.getPose(),
    setMix: (v) => mixCtl.setMix(v),
    setViewPreset: (name) => setViewPreset(name),
    setLevel: handleLevel,
    onLevel: handleLevel,
    getStatus,
    handoff,
    requestTwinClose,
    handoffPhase: () => handoff.phase,
    ready: () => handoff.readyPosted,
    readyDetail: () => ({
      posted: handoff.readyPosted,
      hits: handoff.readyHits,
      phase: handoff.phase,
      out: (window.__ring2readyOut ?? []).length,
    }),
    revMode: () => handoff.revMode,
    revWalk: () => (handoff.walk ? handoff.walk.legs.map((l) => l.name) : null),
    scrub: () => {
      let range = null;
      try {
        range = twin?.camera?.position?.distanceTo?.(twin?.controls?.target) ?? null;
      } catch { range = null; }
      return {
        phase: handoff.phase,
        active: !!handoff.scrub?.active,
        progress: handoff.scrub?.progress ?? null,
        accum: handoff.scrub?.accum ?? null,
        entryAccum: handoff.entryAccum ?? null,
        legs: handoff.walk ? handoff.walk.legs.map((l) => l.name) : null,
        range,
        atMax: Number.isFinite(range) ? isAtMaxZoom(range) : null,
        closeOut: (window.__ring2closeOut ?? []).length,
      };
    },
    scrubWheel: (dY) => {
      try {
        onTwinScrubWheel({ deltaY: dY, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });
        return true;
      } catch {
        return false;
      }
    },
    // Task-36 intro-scrub probe: forward progress + staged driver state.
    fwd: () => ({
      phase: handoff.phase,
      progress: handoff.fwd?.progress ?? null,
      staged: !!handoff.fwd?.staged,
      stagedS: handoff.fwdStagedS ?? null,
      capExpired: !!handoff.capExpired,
      legs: handoff.fwd ? handoff.fwd.legs.map((l) => l.name) : null,
    }),
    setStagedS: (s) => applyTwinStagedS(s),
    // GATE-3 native-zoom entry probe (handoff12-B): handed frame vs pinned
    // hold vs live camera — continuity proof for off-nominal entries.
    entry: () => {
      let live = null;
      try {
        live = capturePose();
      } catch { live = null; }
      let holdErrM = null;
      try {
        holdErrM = handoff.start ? twinHoldPoseError(live, handoff.start)?.posM ?? null : null;
      } catch { holdErrM = null; }
      return {
        frame: handoff.frame ? { ...handoff.frame } : null,
        anchor: handoff.anchor ? { ...handoff.anchor } : null,
        start: handoff.start ? { ...handoff.start } : null,
        entryPose: handoff.entryPose
          ? { eye: { ...handoff.entryPose.eye }, target: { ...handoff.entryPose.target } }
          : null,
        entryFrames: handoff.entryFrames,
        refits: handoff.refits,
        live,
        holdErrM,
        phase: handoff.phase,
        ready: handoff.readyPosted,
        out: (window.__ring2readyOut ?? []).length,
      };
    },
    // Live flight sample: pose + mix + range for continuity/stage probing.
    flight: () => {
      let p = null;
      try {
        p = capturePose();
      } catch { p = null; }
      let range = null;
      try {
        range = twin?.camera?.position?.distanceTo?.(twin?.controls?.target) ?? null;
      } catch { range = null; }
      let mix = null;
      try {
        mix = mixCtl?.getMix?.() ?? null;
      } catch { mix = null; }
      return { phase: handoff.phase, eye: p?.eye ?? null, target: p?.target ?? null, mix, range };
    },
    twinReadyMsg: TWIN_READY_MSG,
    tone: () => {
      let m = null;
      try {
        m = mixCtl?.getMix?.() ?? null;
      } catch { m = null; }
      let sun = null, amb = null;
      try {
        twin.scene?.traverse?.((o) => {
          if (o?.isDirectionalLight) sun = o.intensity;
          if (o?.isAmbientLight) amb = o.intensity;
        });
      } catch { /* lights read is best-effort */ }
      return { mix: m, grade: toneGradeForMix(m ?? 0), sun, amb };
    },
    ring: () => {
      let scale = null, opacity = null;
      try {
        const r = twin.scene?.getObjectByName?.('ring2-ring');
        scale = r?.scale?.x ?? null;
        opacity = r?.material?.opacity ?? null;
      } catch { /* ring read is best-effort */ }
      return { phase: handoff.phase, scale, opacity };
    },
    precache: () => ({
      kicked: !!handoff.precache?.kicked,
      frames: twinFrames,
      phase: handoff.phase,
      poseOk: handoff.precache?.poseOk ?? null,
      errM: handoff.precache?.lastErr?.posM ?? null,
      rangeErrM: handoff.precache?.lastErr?.rangeM ?? null,
      vel: handoff.precache?.vel ?? null,
      scene: handoff.precache?.scene ?? null,
      pose: handoff.precache?.pose ?? null,
      warm: handoff.precache?.warm ?? null,
      ready: handoff.readyPosted,
      out: (window.__ring2readyOut ?? []).length,
    }),
    fs: { delegated: fsDelegated, on: fsOn },
    diag: () => ({
      build: BUILD_ID,
      canvases: canvasDims(),
      mapReady: !!map,
      frames: twinFrames,
      twinErr,
      status: statusDiv?.textContent ?? null,
      mapErrors: globalThis.__ring2mapErrors ?? [],
      dem: getStatus(),
    }),
  };

  /* Phase 03 Tasks 18+19 (?sector=<h3> preselect + embed close round-trip)
   * + LANE 3 twinlink handoff: ?sector=<h3>&cx=<lng>&cy=<lat>&z=<zoom>,
   * where the frame is the RING bounds (wider than the terminal).
   * Overlay open with frame params starts the camera at the ring frame
   * top-down (pitch 0, bearing matching the map, slider at full
   * satellite), holds a beat, slow-eases to iso at the attached angle
   * (same ring center/range, slider stays 0), then slow-pushes into the
   * terminal while the slider drives satellite->twin. Sector-only (no
   * frame) flies a wide top-down survey -> iso -> terminal fallback.
   * Standalone loads boot normally — the preselect never breaks boot.
   * Probe: window.__ring2.sector. */
  try {
    const sectorQ = parseSectorQuery(location.search);
    const hit = resolveSector(sectorQ.sector);
    let sectorSel = null;
    // Anchor: the map's handed-off frame center, else the sector pin.
    let anchor = null;
    if (sectorQ.frame) anchor = frameTarget(sectorQ.frame);
    if (!anchor && hit) anchor = { x: hit.sector.dx, z: hit.sector.dz };
    if (hit) {
      sectorSel = {
        h3: hit.h3, sectorId: hit.sector.id,
        assetId: hit.worstAsset, worst: hit.worst, embedded: sectorQ.embed,
        frame: sectorQ.frame,
      };
    } else if (sectorQ.sector) {
      sectorSel = {
        h3: sectorQ.sector, sectorId: null, assetId: null,
        worst: null, embedded: sectorQ.embed, frame: sectorQ.frame,
      };
    } else if (sectorQ.embed) {
      sectorSel = { h3: null, sectorId: null, assetId: null, worst: null, embedded: true, frame: sectorQ.frame };
    }
    try {
      window.__ring2.sector = sectorSel;
    } catch { /* probe write is best-effort */ }
    // Handoff flight: frame handoff, or sector-only fallback (wide top-down
    // survey -> ring iso -> terminal). Standalone (no frame, no sector): no
    // flight, the boot camera + persisted mix stand.
    try {
      if (anchor) {
        const vp = viewportPxNow();
        let startRange = null;
        if (sectorQ.frame) {
          startRange = frameRange(sectorQ.frame.z, { viewportPx: vp, lat: sectorQ.frame.cy });
        }
        if (!Number.isFinite(startRange) || startRange <= 0) startRange = 12000;
        // Shared orbit rails (sync.js single source, via the sector.js pure
        // clamp) — the handed zoom is accepted as-is inside the rails, never
        // replaced by a canned pose; only the rail breach clamps.
        startRange = clampHandoffRange(startRange) ?? 12000;
        const bearing = sectorQ.frame?.bearing ?? 0;
        const azim = -(((Number(bearing) || 0) * Math.PI) / 180);
        // Ring-frame iso: the swoop target — same ring center/range as the
        // pinned start, pitched to iso at the attached angle. Slider stays
        // at full satellite through the swoop.
        const aty = groundYNear(anchor.x, anchor.z);
        const ringIsoEye = poseAt(anchor.x, aty, anchor.z, startRange, HANDOFF_ISO_POLAR_DEG, azim);
        // Iso terminal: the sector's worst asset when known, else the
        // anchor. The push-in (ring iso -> terminal iso) is the tiny leg —
        // the ring frame is wider than the terminal — and the slider rides
        // it 0->100.
        const etx = hit ? hit.sector.dx : anchor.x;
        const etz = hit ? hit.sector.dz : anchor.z;
        const ety = groundYNear(etx, etz);
        const isoEye = poseAt(etx, ety, etz, HANDOFF_ISO_RANGE_M, HANDOFF_ISO_POLAR_DEG, azim);
        const pinned = pinTopDown(anchor.x, anchor.z, startRange, bearing);
        handoff.frame = sectorQ.frame;
        handoff.anchor = { x: anchor.x, z: anchor.z };
        handoff.azim = azim;
        beginHandoffFlight(pinned, {
          eye: ringIsoEye,
          target: { x: anchor.x, y: aty, z: anchor.z },
        }, {
          eye: isoEye,
          target: { x: etx, y: ety, z: etz },
          mix: HANDOFF_END_MIX,
        });
      }
    } catch { /* flight never breaks boot; probe still reports the sector */ }
    if (sectorQ.embed) {
      // Esc: play the exact mirror reverse (pull back to the ring frame +
      // slider->0 + pitch->0) then notify the parent with {recede:true}.
      // Popover-first: the HUD popover manager owns Esc while a popover is
      // open (bubble-phase handler) and this capture listener runs first —
      // so when a popover is open, yield (no preventDefault/stopPropagation)
      // and let it close the popover. The next Esc then drives the reverse
      // close.
      window.addEventListener('keydown', (e) => {
        if (!e || e.key !== 'Escape') return;
        if (e.defaultPrevented) return;
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        try {
          if (document.querySelector('.ops-hud [aria-expanded="true"]')) return;
        } catch { /* popover check is best-effort */ }
        try {
          e.preventDefault();
        } catch { /* key handling is best-effort */ }
        try {
          e.stopPropagation();
        } catch { /* key handling is best-effort */ }
        try {
          requestTwinClose();
        } catch {
          try {
            postTwinClose();
          } catch { /* parent notify is best-effort */ }
        }
      }, true);
      // Back/parent-teardown path: no frame budget for the reverse flight on
      // unload — the close (with recede) still fires synchronously, unless
      // the reverse already posted it (Handoff-6-retrace: no duplicate echo —
      // a stale echo landing in a fresh open's window could tear it down).
      window.addEventListener('pagehide', () => {
        try {
          if (handoff.closePosted) return;
          postTwinClose();
        } catch { /* parent notify is best-effort */ }
      });
      /* Delegated fullscreen (embedded only): the twin FULLSCREEN button
       * must NOT fullscreen its own document — that would hide the parent's
       * CLOSE chrome. Instead the click posts
       * { type:'safepipe-twin-fullscreen', on } to the parent (map-side
       * Lane-1 owns the target + state) and the label syncs from the
       * parent's echoed state. Standalone keeps native self-fullscreen, so
       * this whole block is embed-gated. hud-overlays.js is untouched: the
       * capture-phase interceptor runs before its bubble-phase native
       * handler and stopImmediatePropagation keeps requestFullscreen from
       * ever firing while embedded. Its fullscreenchange sync only fires on
       * own-document changes (never, while embedded), so it can't fight the
       * parent-driven label. */
      try {
        wireDelegatedFullscreen(true);
      } catch { /* native button stands when delegation can't wire */ }
    } else {
      try {
        wireDelegatedFullscreen(false);
      } catch { /* standalone label is native-owned */ }
    }
  } catch { /* preselect never breaks boot */ }
  /* Parent close-message path (Lane B, embed or standalone): the parent may
   * request the mirrored reverse via postMessage (legacy bare string or the
   * extended { type, recede } object) instead of tearing the iframe down.
   * Runs the same REVERSE-FROM-ANYWHERE as Esc — capture + walk back + post.
   * Own posts go to window.parent, never back here, so no self-loop. */
  try {
    window.addEventListener('message', (e) => {
      try {
        if (!isTwinCloseMessage(e?.data)) return;
      } catch {
        return;
      }
      // Self-echo guard: own close posts target window.parent, which IS this
      // window when running top-level (standalone/probe) — without this the
      // post would re-trigger this listener forever (post -> request ->
      // post...). Parent-sent requests arrive with e.source === the parent
      // window, never own window, so only the echo is dropped. Embedded
      // (real iframe) posts never echo back and are unaffected.
      try {
        if (e && e.source === window) return;
      } catch { /* source check is best-effort */ }
      try {
        requestTwinClose();
      } catch {
        try {
          postTwinClose();
        } catch { /* parent notify is best-effort */ }
      }
    });
  } catch { /* message close never breaks boot */ }

  // Rendering-first: the loop starts NOW, not after the map. A hung tile
  // host used to gate every painted frame behind mountMapBase (map:- +
  // black twin until the 30s timeout). The map resolves in the background
  // and sync engages when it lands (guarded per-frame).
  const MAP_TIMEOUT_MS = 30000;
  // Map-side context recovery (P1/P2): on loss the instance is condemned
  // (kicks already suppressed in mapbase); on restore do a FULL clean
  // re-mount — never a resize, never leave a ratio-0 canvas in place.
  function onMapCtxLost() {
    mapZeroTicks = 0;
    paintStatus();
  }
  function onMapCtxRestored() {
    try {
      // Stale-restore guard: a dead (remounted-away) canvas can fire restore
      // AFTER its replacement adopted. Only the current instance's restore
      // condemns — otherwise this would remount a healthy new map.
      let curLost = false;
      try {
        curLost = typeof mapTeardown?.isCtxLost === 'function' ? !!mapTeardown.isCtxLost() : !!map;
      } catch { /* assume current */ }
      if (!curLost) {
        paintStatus();
        return;
      }
      // The restored canvas keeps whatever ratio-0 state the loss left:
      // condemn it and rebuild into the live container.
      mapZeroTicks = 10;
      if (!remounting && typeof requestRemount === 'function') {
        const [vw, vh] = containerWH();
        if (isSizedWH(vw, vh)) {
          if (remounts < 2) requestRemount('ctx-restored');
          else if (!freshContainerTried && typeof requestFreshContainer === 'function') {
            requestFreshContainer('ctx-restored');
          }
        }
      }
    } catch { /* recovery is best-effort; the 5 s lost-timeout covers */ }
    paintStatus();
  }
  function mapRace() {
    return Promise.race([
      mountMapBase(mapDiv, {
        zoom: 11,
        pitch: 0,
        bearing: 0,
        // Twin owns the camera at every mix: native map handlers stay off
        // so a map gesture can never fight the per-frame twin->map sync.
        // All orbit/zoom input goes to the twin canvas (pointer-interactive
        // at all mixes, mix 0 included).
        interactive: false,
        ctxmon: mon,
        onCtxLost: onMapCtxLost,
        onCtxRestored: onMapCtxRestored,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`map mount timed out after ${MAP_TIMEOUT_MS / 1000}s (tiles/worker blocked?)`)), MAP_TIMEOUT_MS)),
    ]);
  }
  function adoptMap(m, loadedClean, isRemount = false, teardown = null) {
    map = m;
    window.__ring2.map = m;
    mapTeardown = teardown;
    adoptSeq++;
    try {
      noteMapAdopted(mon);
    } catch { /* generation is best-effort */ }
    // A successful adopt clears the sticky failure: MAPFAILED lingering
    // past recovery (P4) made healthy screenshots read as dead.
    mapFatal = null;
    // A remount leaves the previous instance's death rattle (e.g. a headless
    // GPU 'context LOST' from the torn-down canvas) in the error ring — prune
    // entries that belong to the old instance so the bar doesn't cry MAPERR
    // over a healthy map.
    try {
      const errs = window.__ring2mapErrors ?? [];
      if (errs.length) {
        window.__ring2mapErrors = errs.filter((e) => !/context lost/i.test(String(e)));
      }
    } catch { /* bar keeps history */ }
    // Release the pre-map mix floor: reapply() floored the EFFECTIVE mix
    // at 50 while getMap() was null (dead-end guard). The map is here now —
    // re-apply so the stored mix (e.g. persisted 0) actually drives
    // emphasis. Without this, overlays render stuck at half-fade.
    try {
      mixCtl.reapply();
    } catch {
      /* mix bar drives on without us */
    }
    try {
      assertTerrainOn(map);
    } catch (err) {
      // Best-effort terrain: a slow style resolves 'hasty' before terrain
      // engages — satellite + twin run regardless, noted not fatal.
      // loadedClean false just means the 8 s soft resolve fired first.
      window.__ring2mapErrors = [...(window.__ring2mapErrors ?? []), `terrain pending${loadedClean ? '' : ' (hasty mount)'}: ${err?.message ?? err}`].slice(-5);
    }
    // Post-remount verify (one shot per adopt): if the fresh instance is
    // STILL a zero canvas in a sized container 1.5 s later, force the
    // escalation tick so the ladder advances without waiting another 5 s.
    // Bounded by the existing budget (2 remounts + 1 fresh div), and the
    // adoptSeq token keeps a stale tick off a newer instance.
    if (isRemount) {
      const tok = adoptSeq;
      setTimeout(() => {
        try {
          if (tok !== adoptSeq || remounting) return;
          const [vw, vh] = containerWH();
          if (isMapStuckZero() && isSizedWH(vw, vh)) mapZeroTicks = 10;
        } catch {
          /* verify is best-effort */
        }
      }, 1500);
    }
    paintStatus();
  }
  function failMap(err) {
    vexWarned = true;
    mapFatal = `${err?.message ?? err}`.slice(0, 140);
    // Dead-end guard: map hard-failed with twin faded out = permanently
    // empty viewport. Pull mix to the live side (twin) so something
    // always paints; the failure stays sticky in status.
    try {
      if ((mixCtl?.getMix?.() ?? 50) < 50) mixCtl.setMix(50);
    } catch {
      /* mix bar drives on without us */
    }
    paintStatus();
  }
  // Wedged-instance recovery: the old map was constructed into a 0x0
  // container and resize() can't unstick it. Tear down and construct fresh
  // into the live-sized container; adoptMap re-engages mix + terrain.
  // Reuse-or-clean (D2 churn fix): exactly one loseContext on the condemned
  // canvas — skipped when it is already lost — then per-mount dispose()
  // (heal timer + RO + window listeners) and remove() BEFORE the new
  // construction starts, so two maps never hold live contexts at once.
  // The old double-getContext('webgl2' ?? 'webgl') pattern is gone: a
  // single killGL() owns teardown.
  function teardownMap(reason) {
    const td = mapTeardown;
    mapTeardown = null;
    try {
      td?.dispose?.();
    } catch { /* already disposed */ }
    try {
      const oldCanvas = map?.getCanvas?.();
      // Skip loseContext churn when the context is already lost — killing a
      // dead context still costs a (possibly new) GL context on some GPUs.
      let alreadyLost = false;
      try {
        alreadyLost = typeof td?.isCtxLost === 'function' ? !!td.isCtxLost() : false;
      } catch { /* assume live */ }
      killGL(oldCanvas, alreadyLost);
      map?.remove?.();
    } catch { /* already dead */ }
    try {
      releaseMap(map);
    } catch { /* singleton already clear */ }
    map = null;
    window.__ring2.map = null;
  }
  function remountMap(reason = '') {
    if (remounting) return; // audit: manual double-call (diag hook) interleaved two mounts
    const cw = mapDiv?.clientWidth | 0, ch = mapDiv?.clientHeight | 0;
    if (cw === 0 || ch === 0) { mapZeroTicks = 0; return; } // hidden again — wait for visibility
    remounting = true;
    remounts++;
    teardownMap(reason);
    mapRace().then(
      ({ map: m, loadedClean, dispose, isCtxLost }) => { adoptMap(m, loadedClean, true, { dispose, isCtxLost }); remounting = false; mapZeroTicks = 0; },
      (err) => { failMap(err); remounting = false; mapZeroTicks = 0; },
    );
  }
  try { window.__ring2remountMap = () => remountMap(); } catch { /* diag hook */ }
  requestRemount = (reason) => remountMap(reason);
  // Last resort (1 shot): the DIV itself may carry a stale layout object in
  // Safari after living through display:none — no remount into it will ever
  // size. Swap in a brand-new div (same id/class/style) and mount there.
  // force=true re-arms for the slow lane (one fresh div per 60 s while
  // stuck — the old one-shot-forever was the P4 terminal state).
  function freshContainer(reason = '', force = false) {
    if (remounting) return;
    if (freshContainerTried && !force) return;
    freshContainerTried = true;
    remounting = true;
    teardownMap(reason || 'freshdiv');
    try {
      const fresh = document.createElement('div');
      fresh.id = mapDiv.id || '';
      fresh.className = mapDiv.className || '';
      fresh.setAttribute('style', mapDiv.getAttribute('style') || '');
      fresh.setAttribute('data-ring2', 'map');
      mapDiv.replaceWith(fresh);
      mapDiv = fresh;
    } catch (err) {
      failMap(err);
      remounting = false;
      mapZeroTicks = 0;
      return;
    }
    mapRace().then(
      ({ map: m, loadedClean, dispose, isCtxLost }) => { adoptMap(m, loadedClean, true, { dispose, isCtxLost }); remounting = false; mapZeroTicks = 0; },
      (err) => { failMap(err); remounting = false; mapZeroTicks = 0; },
    );
  }
  try { window.__ring2freshContainer = () => freshContainer(); } catch { /* diag hook */ }
  requestFreshContainer = (reason, force) => freshContainer(reason, force);
  // First-mount gate (Safari-black birth defect): don't construct the map
  // into a 0x0 box. Defer until the container is visible with size; the
  // status line says waiting-viewport meanwhile and the twin loop below
  // still starts only after the mount kicks off (unchanged order when the
  // page loads visible — the wait resolves immediately).
  {
    const [gw, gh] = containerWH();
    if (!isSizedWH(gw, gh)) {
      waitingViewport = true;
      statusDiv.textContent += ' · map:waiting-viewport';
      paintStatus();
      await waitForSized(() => mapDiv, { timeoutMs: 0 });
      waitingViewport = false;
      paintStatus();
    }
  }
  mapRace().then(
    ({ map: m, loadedClean, dispose, isCtxLost }) => adoptMap(m, loadedClean, false, { dispose, isCtxLost }),
    (err) => failMap(err),
  );
  // External kick (gallery tab-show, same pattern as v1 resizeOps3d): the
  // gallery calls __ring2kick when the Ring-2 panel appears — twin re-size
  // + map kick + immediate status repaint. Covers the display:none→block
  // path where WebKit drops internal ResizeObserver notifications.
  try {
    window.__ring2kick = () => {
      try {
        twin?.onResize?.();
      } catch { /* twin drives on without us */ }
      try {
        window.__ring2resizeMap?.();
      } catch { /* pre-mount */ }
      try {
        paintStatus();
      } catch { /* status never breaks the kick */ }
    };
    window.__ring2twinResize = () => {
      try {
        twin?.onResize?.();
      } catch { /* pre-mount */ }
    };
  } catch { /* diag hooks only */ }

  // Frame heartbeat: a silently-throwing update() renders as an
  // unexplained black twin. Count frames, keep the first error, and paint
  // both into the status line — a screenshot then proves loop alive/dead.
  twinFrames = 0;
  try {
    paintT0 = Date.now();
  } catch { paintT0 = 0; }
  /* Sync-first frame order (zoom catch-up fix): the damped controls settle
   * FIRST, the fresh post-damping twin pose drives the map via jumpTo, and
   * only then does EITHER side paint. jumpTo applies synchronously with no
   * easing and the map runs fadeDuration 0, so the map side adds no
   * smoothing of its own — one twin delta reaches the map in the same
   * frame, before both GL paints, and photo + twin scale as one. The old
   * order (twin.update() painted, THEN jumpTo) left the map exactly one
   * frame behind every twin move: the satellite visibly chased the twin
   * through every zoom. */
  const loop = () => {
    try {
      frameOnce();
    } catch (err) {
      /* a torn-down frame never kills the loop — but the first failure is
       * kept and surfaced so a dead twin names its cause. */
      if (!twinErr) {
        twinErr = err?.message ?? String(err);
        // eslint-disable-next-line no-console
        console.error('[ring2] twin frame failed:', twinErr);
      }
    }
    requestAnimationFrame(loop);
  };
  const frameOnce = () => {
    stepHandoff();
    // GATE-3 twin-tone (defect 4): grade the twin lights across the mix band
    // so the photo->twin base swap moves tone smoothly (sector.js
    // toneGradeForMix — sat-matched at 0, canonical full-twin at 100).
    try {
      const m = mixCtl?.getMix?.() ?? HANDOFF_START_MIX;
      const g = toneGradeForMix(m);
      if (g !== lastToneApplied) {
        twin.setToneGrade?.(g);
        lastToneApplied = g;
      }
    } catch { /* grade never breaks the frame */ }
    // GATE-3 ring-from-corners (defect 5): the flight owns the ring look
    // (corners->site ring in, site ring->corners out); free orbit and the
    // settled twin stay on the normal mix law (null clears the override).
    try {
      const rp = ringFlightP();
      const key = rp === null ? 'n' : rp.toFixed(3);
      if (key !== lastRingApplied) {
        twin.setRingReveal?.(rp);
        lastRingApplied = key;
      }
    } catch { /* ring never breaks the frame */ }
    twin.updateControls();
    twinFrames++;
    // First-painted signal (twin->parent, once): PREWARM frames are on the
    // canvas AND the scene is live (map tile-idle + terrain draped;
    // wall-cap backstop) — no pose/cam match, so off-site arrivals report
    // too. Never breaks the frame; ready-match below still owns the
    // matched reveal.
    try {
      let mapIdle = false;
      try {
        mapIdle = map && typeof map.loaded === 'function' ? !!map.loaded() : true;
      } catch { mapIdle = false; }
      let sceneLive = false;
      try {
        sceneLive = typeof terrainState === 'function' ? terrainState() === 'vex' : true;
      } catch { sceneLive = false; }
      let elapsed = 0;
      try {
        elapsed = paintT0 > 0 ? Date.now() - paintT0 : 0;
      } catch { elapsed = 0; }
      if (!paintedPosted && firstPaintDue({ frames: twinFrames, mapIdle, sceneLive, elapsedMs: elapsed })) {
        paintedPosted = true;
        try {
          window.parent?.postMessage(buildTwinPaintedMessage(), '*');
        } catch { /* parent notify is best-effort */ }
        try {
          (window.__ring2paintOut ?? (window.__ring2paintOut = [])).push(buildTwinPaintedMessage());
        } catch { /* probe log is best-effort */ }
      }
    } catch { /* painted post never breaks the frame */ }
    const pose = twin.getPose();
    const viewportPx = Math.max(twinDiv.clientHeight || window.innerHeight, 1);
    // Aspect parity (Phase 00): twin + map containers fill the same box,
    // but if layout ever splits them the equal-fov cameras still shear.
    // Warn once per session; the node suite pins the pure helper.
    if (!aspectWarned) {
      try {
        const m = aspectMismatch(
          twinDiv.clientWidth || 1, viewportPx,
          mapDiv.clientWidth || 1, Math.max(mapDiv.clientHeight || 0, 1),
        );
        if (m > 0.01) {
          aspectWarned = true;
          // eslint-disable-next-line no-console
          console.warn(`[ring2] twin/map aspect mismatch ${m} — mix fade will shear`);
        }
      } catch { /* telemetry never breaks the frame */ }
    }
    // Twin owns the camera at every mix — sync always runs, so orbit
    // input on the twin canvas moves the map with it (satellite mode
    // included). The map is non-interactive and can never fight this.
    if (map) {
      try {
        applyTwinToMap(map, pose, { viewportPx, fovDeg: FOV_DEG });
      } catch (err) {
        if (!vexWarned) {
          vexWarned = true;
          // eslint-disable-next-line no-console
          console.warn('[ring2] sync skipped:', err?.message ?? err);
        }
      }
    }
    const pitch = pitchForPose(pose.eye, pose.target, pose.target.y ?? 0);
    const rangeM = Math.hypot(
      pose.eye.x - pose.target.x,
      pose.eye.y - (pose.target.y ?? 0),
      pose.eye.z - pose.target.z,
    );
    mixCtl.updateForCamera(pitch, rangeM);
    // Tilt takeover (owner verdict 2026-10-12): the mix control merges
    // steep-tilt + close-range into the twin-takeover u above, so the
    // SATELLITE yields while the terrain-coupled lines stay fully lit.
    // setTiltFade stays driven per frame for API compat (no-op: lines are
    // mix-only at every pitch now).
    try {
      twin.setTiltFade?.(pitch);
    } catch { /* cosmetic — never breaks the frame */ }
    // Paint LAST: the map already holds this frame's pose (jumpTo above),
    // so both GL paints land in the same frame — no catch-up lag.
    twin.renderTwin();
  };
  requestAnimationFrame(loop);
  // Manual pump (diag hook, same pattern as __ring2kick/__ring2remountMap):
  // headless harnesses often stall rAF while timers run — one frameOnce()
  // per call drives the identical flight/sync/paint path deterministically.
  try {
    window.__ring2step = () => frameOnce();
  } catch { /* diag hook only */ }

  setInterval(paintStatus, 500);
  paintStatus();
}

boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[ring2] boot failed:', err);
  // Overwrite unconditionally: the status line is never empty by the time a
  // twin/mix constructor throws, and the old if-empty guard turned that
  // into eternal "map: loading…" with no error (audit finding).
  if (statusDiv) statusDiv.textContent = `RING-2 boot failed: ${err?.message ?? err}`;
});
