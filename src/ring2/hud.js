/* Safepipe Ops3D Ring-2 — src/ring2/hud.js (Phase 00, Task 1, P2 Lane A).
 *
 * Live-but-cheap HUD core: static v1 panel furniture + overlay chrome with
 * the clock tick, H hide, and 1/2/3 level keymap wired. Fullscreen, O/F/M,
 * and the Esc/popover manager stay owned by their lanes (overlays Lane B
 * owns popover exclusivity + Esc; O/F/M remain UI-only until twin wiring
 * lands; the fs lane owns the fullscreen button) — this lane adds no
 * second popover closer and no O/F/M handlers.
 * Styles come from the v1 token-only chain — design-system/ops-tokens.css
 * + src/ops3d/hud.css, imported here so the harness needs no HTML change
 * and no second copy of the stylesheet exists.
 *
 * buildRingHud(container, cbs={onLevel:()=>{}}) -> { els, closePopovers, dispose }.
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-00]
 */
import '../../design-system/ops-tokens.css';
import '../ops3d/hud.css';
import { buildFurniture, formatClockUTC } from './hud-furniture.js';
import { buildOverlays } from './hud-overlays.js';

/* v1 parity (src/ops3d/hud.js): numeric level shortcut names. */
const LEVEL_NUM = { 1: 'network', 2: 'segment', 3: 'asset' };

const isFormTarget = (e) =>
  !!(e && e.target && e.target.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));

export function buildRingHud(container, cbs = {}) {
  if (!container) throw new Error('buildRingHud: container requires a DOM element');
  const onLevel = cbs.onLevel ?? (() => {});
  const root = document.createElement('div');
  root.className = 'ops-hud';
  root.setAttribute('data-testid', 'ops-hud');
  container.appendChild(root);
  const furniture = buildFurniture(root);
  // Forward-compat: Lane C wires level buttons via (container, { onLevel }).
  // Lane B's buildOverlays(root) ignores the extra arg until then.
  const overlays = buildOverlays(root, { container, onLevel });

  // Live clock (v1 parity): 1s tick refreshing the furniture clock node.
  const clockTick = () => {
    try {
      if (furniture.els.clock) furniture.els.clock.textContent = formatClockUTC(new Date());
    } catch { /* clock repaint is best-effort */ }
  };
  const clockTimer = setInterval(clockTick, 1000);
  if (typeof clockTimer === 'object' && clockTimer && typeof clockTimer.unref === 'function') {
    clockTimer.unref();
  }

  // H hide (v1 parity: root.classList ops-hud--hidden), input-guarded.
  let hidden = false;
  const setHidden = (v) => {
    hidden = v;
    root.classList.toggle('ops-hud--hidden', v);
  };
  const onHideKey = (e) => {
    if (e.key !== 'h' && e.key !== 'H') return;
    if (isFormTarget(e)) return;
    setHidden(!hidden);
  };
  window.addEventListener('keydown', onHideKey);

  // Numeric 1-3 level shortcut (v1 parity), input-guarded; twin owns camera.
  const onLevelKey = (e) => {
    if (isFormTarget(e)) return;
    const name = LEVEL_NUM[e.key];
    if (name) onLevel(name);
  };
  window.addEventListener('keydown', onLevelKey);

  return {
    els: { ...furniture.els, ...overlays.els },
    closePopovers: overlays.closePopovers,
    dispose() {
      clearInterval(clockTimer);
      window.removeEventListener('keydown', onHideKey);
      window.removeEventListener('keydown', onLevelKey);
      try {
        overlays.dispose();
      } catch { /* overlay teardown is best-effort */ }
      root.remove();
    },
  };
}
