/* Safepipe Ops 3D — src/ops3d/main.js · dev-harness entry (not shipped UI).
 * Mounted by a bare harness page during development for screenshots.
 * Wires the open-source satellite base (MapLibre + Esri, tokenless) behind
 * the twin + per-frame camera sync.
 */
import { createTwin } from './twin.js';
import { initSatBase } from './sat-base.js';

const el = document.getElementById('ops3d-dev');
if (!el) throw new Error('ops3d dev harness: #ops3d-dev missing');
window.__twin = createTwin(el, {
  // eslint-disable-next-line no-console
  onSelect: (id) => console.log('[ops3d] select', id),
});

// Satellite base + crossfade (tokenless open-source base, always attempted).
const sat = initSatBase(el, { getTwin: () => window.__twin });
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
