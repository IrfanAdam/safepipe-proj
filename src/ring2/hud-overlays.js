/* Safepipe Ops3D Ring-2 — src/ring2/hud-overlays.js (Phase 00, Task 1, Lane B).
 * Static HUD overlay chrome: legend popover + ▣ toggle, ? help button +
 * shortcuts popover, VIEW box chrome (disabled, no selection), and the
 * ··· / ◉ / FULLSCREEN buttons as inert chrome. Single-popover manager:
 * at most one popover open; Esc closes.
 *
 * Same ops-hud__* class names as src/ops3d/hud.js so the token-only
 * hud.css (+ design-system/ops-tokens.css) styles this lane with zero new
 * CSS. No feed/selection/level/overlay/mute/cam/fullscreen wiring — every
 * control here is static or inert until its wiring lane lands.
 * Styling discipline: classes + var(--ops-*) tokens only. The one geometry
 * v1 carries inline (legend toggle offset 42px) is expressed here as a
 * token calc — no raw hex/px anywhere in this file.
 * Host page must load ops-tokens.css + hud.css (CSS lane owns that).
 * [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-00]
 */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* Static legend rows — verbatim labels from v1 hud.js. Markers denote
 * TYPE; positions stay schematic until Phase-2 Overpass (see hints). */
const LEGEND_ROWS = [
  ['hatch-compressor', 'COMPRESSOR', 'HATCHED RECT · 45° DENSE'],
  ['hatch-valve', 'VALVE', 'HATCHED CIRCLE · 135° FINE'],
  ['hatch-terminal', 'TERMINAL', 'HATCHED RECT · 30° SPARSE'],
  ['hatch-wellhead', 'WELLHEAD · SENSOR', 'HATCHED CIRCLE · 60°'],
  ['dash', 'BURIED LINE', 'DASHED · STAYS BURIED BY DESIGN'],
];

const LEGEND_HINTS = [
  'MARKERS DENOTE TYPE · POSITIONS SCHEMATIC (PHASE-2 OVERPASS)',
  'DRAG ORBIT / WHEEL ZOOM / CLICK DRILL / 1-3 VIEWS / ESC UP / H HUD',
];

/* Static shortcuts + controls — verbatim rows from v1 hud.js.
 * [key, desc]; empty desc = section head. */
const HELP_ROWS = [
  ['SHORTCUTS', ''],
  ['DRAG', 'ORBIT'],
  ['WHEEL', 'ZOOM'],
  ['CLICK', 'DRILL IN'],
  ['1 / 2 / 3', 'NETWORK / SEGMENT / ASSET VIEW'],
  ['O', 'CYCLE OVERLAY'],
  ['F', 'CAMERA FOCUS'],
  ['M', 'SOUND ON·OFF'],
  ['ESC', 'UP A LEVEL'],
  ['H', 'HIDE HUD'],
  ['CONTROLS', ''],
  ['··· MENU', 'OVERLAY / SOUND'],
  ['◉ CAMERA', 'APERTURE / FOCAL / FOCUS DIST'],
];

/* VIEW presets — v1 level names; buttons stay disabled until the
 * selection/level lane wires onLevel (no selection exists here). */
const VIEW_LEVELS = [
  ['network', 'TOP'],
  ['segment', 'ISO'],
  ['asset', 'NEAR'],
];

/* Legend toggle sits beside ? bottom-left (v1: inline 42px). Token-only
 * equivalent — no raw px. */
const LEGEND_BTN_OFFSET = 'calc(var(--ops-inset) + var(--ops-cut-lg) + var(--ops-cut-sm))';

/* buildOverlays(root) → { els, closePopovers, dispose }.
 * root: the .ops-hud container (or any element) to append into.
 * els: named nodes for the wiring lanes (feed/selection/level/overlay/
 * mute/cam/fs) to adopt later — this lane attaches no data callbacks. */
export function buildOverlays(root) {
  if (!root) throw new Error('buildOverlays: root requires a DOM element');

  // — Bottom-left legend popover (static, hidden until ▣) —
  const legend = el('div', 'ops-hud__legend ops-hud__legend--hidden');
  legend.setAttribute('role', 'dialog');
  legend.setAttribute('aria-label', 'Legend: infrastructure hatch types');
  for (const [sample, label, sub] of LEGEND_ROWS) {
    const row = el('div', 'ops-hud__legend-row');
    row.appendChild(el('span', `ops-hud__swatch ops-hud__swatch--${sample}`));
    row.appendChild(el('span', 'ops-hud__legend-label', label));
    legend.appendChild(row);
    legend.appendChild(el('div', 'ops-hud__legend-sub', sub));
  }
  for (const hint of LEGEND_HINTS) {
    legend.appendChild(el('div', 'ops-hud__hints', hint));
  }

  // — ▣ legend toggle (bottom-left, beside ?) —
  const legendWrap = el('div', 'ops-hud__help');
  legendWrap.style.left = LEGEND_BTN_OFFSET;
  const legendBtn = el('button', 'ops-hud__help-btn', '▣');
  legendBtn.type = 'button';
  legendBtn.setAttribute('aria-label', 'Legend: infrastructure hatch types');
  legendBtn.setAttribute('aria-expanded', 'false');
  legendWrap.appendChild(legendBtn);

  // — Bottom-left ? help + shortcuts popover (static) —
  const help = el('div', 'ops-hud__help');
  const helpPanel = el('div', 'ops-hud__help-panel ops-hud__help-panel--hidden');
  helpPanel.setAttribute('role', 'dialog');
  helpPanel.setAttribute('aria-label', 'Shortcuts and controls');
  for (const [key, desc] of HELP_ROWS) {
    if (!desc) {
      helpPanel.appendChild(el('div', 'ops-hud__help-head', key));
    } else {
      const row = el('div', 'ops-hud__help-row');
      row.appendChild(el('span', 'ops-hud__help-key', key));
      row.appendChild(el('span', 'ops-hud__help-desc', desc));
      helpPanel.appendChild(row);
    }
  }
  const helpBtn = el('button', 'ops-hud__help-btn', '?');
  helpBtn.type = 'button';
  helpBtn.setAttribute('aria-label', 'Shortcuts and controls');
  helpBtn.setAttribute('aria-expanded', 'false');
  help.appendChild(helpPanel);
  help.appendChild(helpBtn);

  // — VIEW box chrome: v1-nested in the right column, hidden without a
  // selection (v1 toggles --hidden on selection; nothing selects here yet).
  // The rightcol shell is positional — without it the box falls into static
  // flow over the sector block. The asset panel + search join it in P3.
  const viewBox = el('div', 'ops-hud__viewbox ops-hud__viewbox--hidden');
  viewBox.appendChild(el('div', 'ops-hud__viewbox-head', 'VIEW'));
  const levelRow = el('div', 'ops-hud__levels');
  levelRow.setAttribute('role', 'group');
  levelRow.setAttribute('aria-label', 'Camera view');
  const levelBtns = VIEW_LEVELS.map(([name, label]) => {
    const b = el('button', 'ops-hud__level-btn', label);
    b.type = 'button';
    b.disabled = true;
    b.dataset.level = name;
    b.setAttribute('aria-label', `${label} view (${name})`);
    b.setAttribute('aria-disabled', 'true');
    b.title = `${label} — ${name} view (wiring lands with the level lane)`;
    levelRow.appendChild(b);
    return b;
  });
  viewBox.appendChild(levelRow);

  // — Bottom-right system cluster: ··· / ◉ / FULLSCREEN as inert chrome.
  // No menu or camera popovers here — the overlay/sound/cam/fullscreen
  // wiring lanes own those; these buttons carry no listeners.
  const sys = el('div', 'ops-hud__sys');
  const moreBtn = el('button', 'ops-hud__more', '···');
  moreBtn.type = 'button';
  moreBtn.disabled = true;
  moreBtn.setAttribute('aria-label', 'Display settings: overlay, sound');
  moreBtn.setAttribute('aria-disabled', 'true');
  moreBtn.title = '··· menu (wiring lands with the overlay lane)';
  const camBtn = el('button', 'ops-hud__cam-btn', '◉');
  camBtn.type = 'button';
  camBtn.disabled = true;
  camBtn.setAttribute('aria-label', 'Camera controls: aperture, zoom, focus (F)');
  camBtn.setAttribute('aria-disabled', 'true');
  camBtn.title = '◉ camera (wiring lands with the cam lane)';
  const fsBtn = el('button', 'ops-hud__fs', 'FULLSCREEN');
  fsBtn.type = 'button';
  fsBtn.disabled = true;
  fsBtn.setAttribute('aria-label', 'Toggle fullscreen');
  fsBtn.setAttribute('aria-disabled', 'true');
  fsBtn.title = 'Fullscreen (wiring lands with the fs lane)';
  sys.appendChild(moreBtn);
  sys.appendChild(camBtn);
  sys.appendChild(fsBtn);

  root.appendChild(legend);
  root.appendChild(legendWrap);
  root.appendChild(help);
  const rightcol = el('div', 'ops-hud__rightcol');
  rightcol.appendChild(viewBox);
  root.appendChild(rightcol);
  root.appendChild(sys);

  // — Single-popover manager: at most ONE of legend / ? help open.
  // Opening one closes the other; Esc closes whichever is open. Wiring
  // lanes adding menu/cam popovers must join this manager (call
  // toggleSolo/requestClose from their buttons, add their open flag to
  // the exclusivity arms) — it stays the sole owner of popover
  // exclusivity, no second closer elsewhere.
  let legendOpen = false;
  let helpOpen = false;
  const setLegendRaw = (v) => {
    legendOpen = v;
    legend.classList.toggle('ops-hud__legend--hidden', !v);
    legendBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
  };
  const setHelpRaw = (v) => {
    helpOpen = v;
    helpPanel.classList.toggle('ops-hud__help-panel--hidden', !v);
    helpBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
  };
  function toggleSolo(which) {
    const isOpen = which === 'legend' ? legendOpen : helpOpen;
    if (!isOpen) {
      if (which !== 'legend' && legendOpen) setLegendRaw(false);
      if (which !== 'help' && helpOpen) setHelpRaw(false);
    }
    if (which === 'legend') setLegendRaw(!legendOpen);
    else setHelpRaw(!helpOpen);
  }
  function closePopovers() {
    const any = legendOpen || helpOpen;
    if (legendOpen) setLegendRaw(false);
    if (helpOpen) setHelpRaw(false);
    return any;
  }
  legendBtn.addEventListener('click', () => toggleSolo('legend'));
  helpBtn.addEventListener('click', () => toggleSolo('help'));

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    // Close a popover first and swallow the key so one press never both
    // closes a popover and drives a level-up owned by another lane.
    if (closePopovers() && e.stopImmediatePropagation) e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', onKey);

  const els = {
    legend,
    legendWrap,
    legendBtn,
    help,
    helpPanel,
    helpBtn,
    rightcol,
    viewBox,
    levelRow,
    levelBtns,
    sys,
    moreBtn,
    camBtn,
    fsBtn,
  };
  return {
    els,
    closePopovers,
    dispose() {
      window.removeEventListener('keydown', onKey);
      legend.remove();
      legendWrap.remove();
      help.remove();
      rightcol.remove();
      sys.remove();
    },
  };
}
