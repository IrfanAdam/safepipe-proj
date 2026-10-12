/* Safepipe Ops3D Ring-2 — src/ring2/hud.js (Phase 00, Task 1, P1 mount).
 *
 * Static HUD chrome for the Ring-2 harness: v1 panel furniture + overlay
 * chrome, no data wiring (P2 live-cheap, P3 feed-wired land later).
 * Styles come from the v1 token-only chain — design-system/ops-tokens.css
 * + src/ops3d/hud.css, imported here so the harness needs no HTML change
 * and no second copy of the stylesheet exists.
 *
 * buildRingHud(container) -> { els, closePopovers, dispose }.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-00]
 */
import '../../design-system/ops-tokens.css';
import '../ops3d/hud.css';
import { buildFurniture } from './hud-furniture.js';
import { buildOverlays } from './hud-overlays.js';

export function buildRingHud(container) {
  if (!container) throw new Error('buildRingHud: container requires a DOM element');
  const root = document.createElement('div');
  root.className = 'ops-hud';
  root.setAttribute('data-testid', 'ops-hud');
  container.appendChild(root);
  const furniture = buildFurniture(root);
  const overlays = buildOverlays(root);
  return {
    els: { ...furniture.els, ...overlays.els },
    closePopovers: overlays.closePopovers,
    dispose() {
      try {
        overlays.dispose();
      } catch { /* overlay teardown is best-effort */ }
      root.remove();
    },
  };
}
