/* Safepipe Ops3D Ring-2 — src/ring2/main.js (Phase 3, Task 8/9 wiring).
 * Harness entry for /ops3d-ring2.html. Wires mapbase (ground) + overlays
 * (transparent twin) + mix (one slider) + per-frame sync (twin -> map).
 *
 * Camera authority is the twin orbit; every frame the twin pose drives the
 * map via applyTwinToMap with the twin's own viewport/fov so zoom parity
 * holds. Mix consumes the same pose's pitch for the TOP-only satellite rule.
 * Exposes window.__ring2 { map, twin, mix, getPose, setMix } for the probe
 * lane, screenshots, and console driving.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-3]
 */
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { VEX } from './site.js';
import { ensureField, getStatus } from './field.js';
import { mountMapBase, assertTerrainOn } from './mapbase.js';
import { applyTwinToMap, assertTerrainVex, pitchForPose } from './sync.js';
import { createOverlayTwin } from './overlays.js';
import { mountMixBar, loadMix } from './mix.js';

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

const mapDiv = el.querySelector('[data-ring2="map"]');
const twinDiv = el.querySelector('[data-ring2="twin-wrap"]');
const barDiv = el.querySelector('[data-ring2="bar"]');
const statusDiv = el.querySelector('[data-ring2="status"]');

const FOV_DEG = 60;
// Bump on every user-visible Ring-2 change: proves from a screenshot alone
// which build Safari actually ran (stale-build confusion ends here).
const BUILD_ID = '5189a73';
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
// Bridge: remountMap lives in boot() closure (needs mapDiv/mixCtl);
// paintStatus is module scope, so boot hands it a callable here.
let requestRemount = null;

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

function paintStatus() {
  if (!statusDiv) return;
  // Self-heal: map canvas 0x0 while its container has size (hidden-at-mount
  // gallery iframe). Cheap, runs on the existing 500ms tick; twin path needs
  // no help. Without this, mix:0 (pure SAT) is a permanent black hole.
  // Escalation: if resize() fires for 10 straight ticks (5s) with a sized
  // container and the canvas is STILL zero (observed live on Safari despite
  // the fixed build string in the bar), the map instance itself is wedged —
  // tear it down and construct a fresh one into the now-sized container.
  // Capped at 2 remounts so a truly broken environment can't loop forever.
  try {
    const c = map?.getCanvas?.();
    if (c && ((c.width | 0) === 0 || (c.height | 0) === 0)) {
      const w = mapDiv?.clientWidth | 0, h = mapDiv?.clientHeight | 0;
      if (w > 0 && h > 0 && typeof map.resize === 'function') {
        try { map.resize(); } catch { /* counted below */ }
        const c2 = map.getCanvas?.();
        if (c2 && ((c2.width | 0) === 0 || (c2.height | 0) === 0)) {
          mapZeroTicks++;
          if (mapZeroTicks >= 10 && remounts < 2 && !remounting && typeof requestRemount === 'function') requestRemount();
        } else mapZeroTicks = 0;
      }
    } else mapZeroTicks = 0;
  } catch { /* heal is best-effort */ }
  const s = getStatus();
  const mix = mixCtl?.getMix() ?? loadMix(50);
  const info = twin?.getInfo?.();
  const mapErr = globalThis.__ring2mapErrors?.at(-1);
  statusDiv.textContent =
    `RING-2 [${BUILD_ID}] · dem:${s.stage}/${s.source} tiles:${s.tilesLoaded}/${s.tilesTotal}` +
    ` · ${canvasDims()}` +
    ` · mix:${mix}` +
    (info && info.min !== undefined
      ? ` · relief:${(info.max - info.min).toFixed(0)}m idx:${info.indexCount ?? 0} src:${info.source ?? '?'}`
      : '') +
    (vexWarned ? ' · VEX-WARN' : '') +
    (mapErr ? ` · MAPERR:${String(mapErr).slice(0, 120)}` : '') +
    (mapFatal ? ` · MAPFAILED:${mapFatal}` : '') +
    (twinFrames >= 0
      ? ` · frames:${twinFrames}${twinErr ? ` TWINERR:${String(twinErr).slice(0, 120)}` : ''}`
      : '');
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

  mixCtl = mountMixBar(barDiv, {
    getTwinCanvas: () => twinDiv.querySelector('[data-ring2="twin"]'),
    getTwinContainer: () => twinDiv,
    getMap: () => map,
    applyEmphasis: (t) => twin.setEmphasis(t),
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
  function mapRace() {
    return Promise.race([
      mountMapBase(mapDiv, { zoom: 11, pitch: 0, bearing: 0 }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`map mount timed out after ${MAP_TIMEOUT_MS / 1000}s (tiles/worker blocked?)`)), MAP_TIMEOUT_MS)),
    ]);
  }
  function adoptMap(m, loadedClean) {
    map = m;
    window.__ring2.map = m;
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
  function remountMap() {
    if (remounting) return; // audit: manual double-call (diag hook) interleaved two mounts
    const cw = mapDiv?.clientWidth | 0, ch = mapDiv?.clientHeight | 0;
    if (cw === 0 || ch === 0) { mapZeroTicks = 0; return; } // hidden again — wait for visibility
    remounting = true;
    remounts++;
    try {
      // Free the old GL context BEFORE constructing the new map: remove()
      // alone can leave the context alive until GC, briefly holding 3 live
      // contexts (twin + old + new) — enough to tip small-GPU browsers into
      // a context loss on the new map.
      const oldCanvas = map?.getCanvas?.();
      const gl = oldCanvas?.getContext?.('webgl2') ?? oldCanvas?.getContext?.('webgl');
      try { gl?.getExtension?.('WEBGL_lose_context')?.loseContext(); } catch { /* already lost */ }
      map?.remove?.();
    } catch { /* already dead */ }
    map = null;
    window.__ring2.map = null;
    mapRace().then(
      ({ map: m, loadedClean }) => { adoptMap(m, loadedClean); remounting = false; mapZeroTicks = 0; },
      (err) => { failMap(err); remounting = false; mapZeroTicks = 0; },
    );
  }
  try { window.__ring2remountMap = () => remountMap(); } catch { /* diag hook */ }
  requestRemount = () => remountMap();
  mapRace().then(
    ({ map: m, loadedClean }) => adoptMap(m, loadedClean),
    (err) => failMap(err),
  );

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
