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
const BUILD_ID = '59974fe';
let map = null;
let twin = null;
let mixCtl = null;
let vexWarned = false;
// Frame heartbeat (module scope so paintStatus can read it): counts twin
// frames, keeps the first frame error. -1 = loop not started yet.
let twinFrames = -1;
let twinErr = null;

function canvasDims() {
  let mapSize = 'map:-';
  try {
    const c = map?.getCanvas?.();
    if (c) mapSize = `map:${c.width}x${c.height}`;
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
  Promise.race([
    mountMapBase(mapDiv, { zoom: 11, pitch: 0, bearing: 0 }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`map mount timed out after ${MAP_TIMEOUT_MS / 1000}s (tiles/worker blocked?)`)), MAP_TIMEOUT_MS)),
  ]).then(
    ({ map: m }) => {
      map = m;
      window.__ring2.map = m;
      try {
        assertTerrainOn(map);
      } catch (err) {
        vexWarned = true;
        statusDiv.textContent = `RING-2 · terrain FAILED: ${err?.message ?? err}`;
        return;
      }
      paintStatus();
    },
    (err) => {
      vexWarned = true;
      statusDiv.textContent = `RING-2 · twin ✓ · map FAILED: ${err?.message ?? err}`;
    },
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
  if (statusDiv && !statusDiv.textContent) statusDiv.textContent = `RING-2 boot failed: ${err?.message ?? err}`;
});
