/* Safepipe Ops 3D — src/ops3d/main.js · dev-harness entry (not shipped UI).
 * Mounted by a bare harness page during development for screenshots.
 * Wires the open-source satellite base (MapLibre + Esri, tokenless) behind
 * the twin + per-frame camera sync.
 */
import { createTwin } from './twin.js';
import { initSatBase } from './sat-base.js';
import { resolveSite } from './dem.js';

const el = document.getElementById('ops3d-dev');
if (!el) throw new Error('ops3d dev harness: #ops3d-dev missing');
// Location param (?site=<lat>,<lon>): the same resolved site drives the
// twin (DEM tiles) and the satellite base (map center + follow).
const site = resolveSite(null, new URLSearchParams(window.location.search).get('site'));
window.__twin = createTwin(el, {
  site,
  // eslint-disable-next-line no-console
  onSelect: (id) => console.log('[ops3d] select', id),
});

// Satellite base + crossfade (tokenless open-source base, always attempted).
// getLevel gates the circular scope monitor on the TOP/network view: read
// from the HUD's active level button so no twin.js contract changes are
// needed (sat-base falls back to a camera-distance heuristic).
const sat = initSatBase(el, {
  site,
  getTwin: () => window.__twin,
  getLevel: () => document.querySelector('.ops-hud__level-btn--active')?.dataset?.level ?? null,
});
window.__satbase = sat;
// Twin → map follow: cheap rAF-side sync (throttled inside), re-pins the
// canvas layer + mix across DEM-swap remounts. Never breaks the twin loop.
const satLoop = () => {
  try {
    sat.syncFromTwin();
  } catch {
    /* a torn-down map never breaks the twin */
  }
  requestAnimationFrame(satLoop);
};
requestAnimationFrame(satLoop);
