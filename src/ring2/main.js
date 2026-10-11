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
import { applyTwinToMap, assertTerrainVex, pitchForPose } from './sync.js';
import { createOverlayTwin } from './overlays.js';
import { mountMixBar, loadMix } from './mix.js';
import { isSizedWH, waitForSized } from './sizeGate.js';
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
  CTX_DECODE,
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

const FOV_DEG = 60;
// Bump on every user-visible Ring-2 change: proves from a screenshot alone
// which build Safari actually ran (stale-build confusion ends here).
const BUILD_ID = 'f69fa87';
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
// Frame heartbeat (module scope so paintStatus can read it): counts twin
// frames, keeps the first frame error. -1 = loop not started yet.
let twinFrames = -1;
let twinErr = null;
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
    statusDiv.title = CTX_DECODE;
  } catch { /* tooltip never breaks paint */ }
}

async function boot() {
  // Chrome first, map second: the status chip + mix bar are plain DOM and
  // must paint even if the map/tiles hang — a black box with no message is
  // the failure mode we're eliminating. Every stage is visible in a
  // screenshot, so a user report always carries the diagnosis.
  statusDiv.textContent = 'RING-2 · boot: dom ✓ · map: loading…';
  // Field loads in the background; overlays start on procedural and
  // re-drape live via the status bus (no await — first paint is fast).
  ensureField().catch(() => {}).finally(() => paintStatus());

  twin = createOverlayTwin(twinDiv, { fovDeg: FOV_DEG, startRange: 26000 });
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

  window.__ring2 = {
    map,
    twin,
    mix: mixCtl,
    build: BUILD_ID,
    getPose: () => twin.getPose(),
    setMix: (v) => mixCtl.setMix(v),
    getStatus,
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
  const loop = () => {
    try {
      twin.update();
      twinFrames++;
      const pose = twin.getPose();
      const viewportPx = Math.max(twinDiv.clientHeight || window.innerHeight, 1);
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
      mixCtl.updateForCamera(pitch);
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
  requestAnimationFrame(loop);

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
