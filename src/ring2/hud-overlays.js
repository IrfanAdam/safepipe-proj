/* Safepipe Ops3D Ring-2 — src/ring2/hud-overlays.js (Phase 00, Task 1, Lane B).
 * HUD overlay controls: legend popover + ▣ toggle, ? help button +
 * shortcuts popover, VIEW box (buttons live → onLevel), and the
 * ··· menu (OVERLAY cycle + SOUND, UI-only) / ◉ cam panel (UI-only) /
 * FULLSCREEN (real) cluster. Single-popover manager: at most one of
 * legend / help / menu / cam open; Esc closes.
 *
 * REAL vs UI-only (no twin backend exists in Ring-2 yet):
 * - REAL: fullscreen (requestFullscreen/exitFullscreen + label swap),
 *   VIEW buttons (click → onLevel(name) + active class), popover
 *   open/close + Esc + O/F/M keymap.
 * - UI-only: OVERLAY cycle (OFF→WEATHER→TECTONIC→FORECAST label state
 *   only — no twin scene to drive until twin wiring lands), SOUND
 *   ON/OFF (no audio bus yet), cam sliders/toggles (readouts only —
 *   no camera to push params to).
 *
 * Same ops-hud__* class names + aria labels as src/ops3d/hud.js so the
 * token-only hud.css (+ design-system/ops-tokens.css) styles this lane
 * with zero new CSS. Styling discipline: classes + var(--ops-*) tokens
 * only. The one geometry v1 carries inline (legend toggle offset 42px)
 * is expressed here as a token calc — no raw hex/px anywhere in this
 * file. Host page must load ops-tokens.css + hud.css (CSS lane owns that).
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

/* VIEW presets — v1 level names; click → onLevel(name) + active class.
 * The box stays hidden until the selection lane shows it (v1 parity). */
const VIEW_LEVELS = [
  ['network', 'TOP'],
  ['segment', 'ISO'],
  ['asset', 'NEAR'],
];

/* UI-only overlay cycle — label state only until twin wiring lands. */
const OVERLAY_MODES = [null, 'weather', 'tectonic', 'forecast'];

/* Aperture full-stop convention (v1 parity): 1.4 wide open → 16 deep. */
const FSTOPS = [1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16];
const fstopFmt = (v) => `ƒ/${FSTOPS[Math.round(v)] ?? v}`;

/* Legend toggle sits beside ? bottom-left (v1: inline 42px). Token-only
 * equivalent — no raw px. */
const LEGEND_BTN_OFFSET = 'calc(var(--ops-inset) + var(--ops-cut-lg) + var(--ops-cut-sm))';

/* buildOverlays(root, { container, onLevel }) → { els, closePopovers, dispose }.
 * root: the .ops-hud container (or any element) to append into.
 * container: fullscreen target (defaults to root's parent); may be null
 *   (fullscreen guarded). onLevel: VIEW button callback (default noop).
 * els: named nodes for later wiring lanes to adopt. */
export function buildOverlays(root, opts = {}) {
  if (!root) throw new Error('buildOverlays: root requires a DOM element');
  const onLevel = opts.onLevel ?? (() => {});
  // Fullscreen target: explicit container, else root's parent once mounted,
  // resolved lazily at click time so mount order never matters. May be null
  // (e.g. detached test DOM) — the click handler guards.
  const fsTarget = () => opts.container ?? root.parentElement ?? root ?? null;

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

  // — VIEW box: buttons live (click → onLevel + active class). The box
  // itself stays hidden until the selection lane shows it (v1 parity:
  // visible only while an asset is selected).
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
    b.dataset.level = name;
    b.title = `${label} — ${name} view`;
    b.setAttribute('aria-label', `${label} view (${name})`);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      for (const other of levelBtns) {
        const active = other === b;
        other.classList.toggle('ops-hud__level-btn--active', active);
        other.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
      onLevel(name);
    });
    levelRow.appendChild(b);
    return b;
  });
  viewBox.appendChild(levelRow);

  // — ··· menu popover: OVERLAY cycle + SOUND rows. Both UI-only: no twin
  // scene to drive and no audio bus yet — they carry label state only
  // until the twin wiring lane lands (v1 calls onOverlay/onMute here).
  const menu = el('div', 'ops-hud__menu ops-hud__menu--hidden');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Display settings');
  const ovBtn = el('button', 'ops-hud__overlay-btn', 'OVERLAY · OFF');
  ovBtn.type = 'button';
  ovBtn.setAttribute('aria-label', 'Cycle data overlay: off, weather, tectonic, forecast');
  let overlayIdx = 0;
  ovBtn.addEventListener('click', () => {
    overlayIdx = (overlayIdx + 1) % OVERLAY_MODES.length;
    const mode = OVERLAY_MODES[overlayIdx];
    ovBtn.textContent = `OVERLAY · ${mode ? mode.toUpperCase() : 'OFF'}`;
    ovBtn.classList.toggle('ops-hud__overlay-btn--active', !!mode);
  });
  const muteBtn = el('button', 'ops-hud__mute-btn', 'SOUND · ON');
  muteBtn.type = 'button';
  muteBtn.setAttribute('aria-label', 'Toggle sound (M)');
  muteBtn.setAttribute('aria-pressed', 'false');
  let muted = false;
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? 'SOUND · OFF' : 'SOUND · ON';
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  });
  menu.appendChild(ovBtn);
  menu.appendChild(muteBtn);

  // — Bottom-right system cluster: ··· menu toggle, ◉ cam toggle, FULLSCREEN.
  const sys = el('div', 'ops-hud__sys');
  const moreBtn = el('button', 'ops-hud__more', '···');
  moreBtn.type = 'button';
  moreBtn.setAttribute('aria-label', 'Display settings: overlay, sound');
  moreBtn.setAttribute('aria-expanded', 'false');
  const camBtn = el('button', 'ops-hud__cam-btn', '◉');
  camBtn.type = 'button';
  camBtn.setAttribute('aria-label', 'Camera controls: aperture, zoom, focus (F)');
  camBtn.setAttribute('aria-expanded', 'false');

  // — Camera panel: hidden popover above the cluster. Sliders/toggles are
  // UI-only readouts — no camera owns these params until twin wiring lands
  // (v1 calls onCamParam here). Solo-managed via toggleSolo('cam').
  const camPanel = el('div', 'ops-hud__cam-panel ops-hud__cam-panel--hidden');
  camPanel.setAttribute('role', 'dialog');
  camPanel.setAttribute('aria-label', 'Camera focus settings');
  camPanel.appendChild(el('div', 'ops-hud__cam-title', 'CAMERA · FOCUS'));
  const mkCamRow = (label, min, max, step, val, fmt) => {
    const row = el('div', 'ops-hud__slider-row');
    row.appendChild(el('span', 'ops-hud__slider-label', label));
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'ops-hud__slider';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(val);
    input.setAttribute('aria-label', label);
    const out = el('span', 'ops-hud__cam-val', fmt(val));
    input.addEventListener('input', () => {
      out.textContent = fmt(Number(input.value));
    });
    row.appendChild(input);
    row.appendChild(out);
    camPanel.appendChild(row);
    return { input, out, fmt };
  };
  mkCamRow('APERTURE', 0, FSTOPS.length - 1, 1, 5, fstopFmt);
  mkCamRow('FOCAL', 18, 120, 1, 32, (v) => `${v}mm`);
  mkCamRow('FOCUS', 0.2, 120, 0.1, 10, (v) => `${v.toFixed(1)}m`);
  const camToggles = el('div', 'ops-hud__cam-toggles');
  const afBtn = el('button', 'ops-hud__cam-toggle', 'AF · ON');
  afBtn.type = 'button';
  afBtn.dataset.on = '1';
  afBtn.setAttribute('aria-label', 'Autofocus: track hovered or clicked point');
  afBtn.classList.add('ops-hud__cam-toggle--active');
  afBtn.addEventListener('click', () => {
    const on = !(afBtn.dataset.on === '1');
    afBtn.dataset.on = on ? '1' : '0';
    afBtn.textContent = on ? 'AF · ON' : 'AF · OFF';
    afBtn.classList.toggle('ops-hud__cam-toggle--active', on);
  });
  const dofBtn = el('button', 'ops-hud__cam-toggle', 'DOF · AUTO');
  dofBtn.type = 'button';
  dofBtn.dataset.mode = 'auto';
  dofBtn.setAttribute('aria-label', 'Depth of field: auto, on, off');
  dofBtn.addEventListener('click', () => {
    const cur = dofBtn.dataset.mode ?? 'auto';
    const next = cur === 'auto' ? 'on' : cur === 'on' ? 'off' : 'auto';
    dofBtn.dataset.mode = next;
    dofBtn.textContent = `DOF · ${next.toUpperCase()}`;
    dofBtn.classList.toggle('ops-hud__cam-toggle--active', next === 'on');
  });
  camToggles.appendChild(afBtn);
  camToggles.appendChild(dofBtn);
  camPanel.appendChild(camToggles);

  // — FULLSCREEN: real. Targets the explicit container, else root's
  // parent; guarded when neither can go fullscreen (null container).
  const fsBtn = el('button', 'ops-hud__fs', 'FULLSCREEN');
  fsBtn.type = 'button';
  fsBtn.setAttribute('aria-label', 'Toggle fullscreen');
  fsBtn.setAttribute('aria-pressed', 'false');
  const syncFs = () => {
    const on = !!document.fullscreenElement && document.fullscreenElement === fsTarget();
    fsBtn.textContent = on ? 'EXIT FULL' : 'FULLSCREEN';
    fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  fsBtn.addEventListener('click', async () => {
    const t = fsTarget();
    try {
      if (document.fullscreenElement === t) await document.exitFullscreen();
      else if (t && t.requestFullscreen) await t.requestFullscreen();
    } catch {
      /* fullscreen unavailable — stay inline */
    }
  });
  document.addEventListener('fullscreenchange', syncFs);

  sys.appendChild(menu);
  sys.appendChild(moreBtn);
  sys.appendChild(camBtn);
  sys.appendChild(camPanel);
  sys.appendChild(fsBtn);

  root.appendChild(legend);
  root.appendChild(legendWrap);
  root.appendChild(help);
  const rightcol = el('div', 'ops-hud__rightcol');
  rightcol.appendChild(viewBox);
  root.appendChild(rightcol);
  root.appendChild(sys);

  // — Single-popover manager: at most ONE of legend / ? help / ··· menu /
  // cam panel open. Opening one closes the rest; Esc closes whichever is
  // open. This manager stays the sole owner of popover exclusivity — no
  // second closer elsewhere.
  let legendOpen = false;
  let helpOpen = false;
  let menuOpen = false;
  let camOpen = false;
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
  const setMenuRaw = (v) => {
    menuOpen = v;
    menu.classList.toggle('ops-hud__menu--hidden', !v);
    moreBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
  };
  const setCamRaw = (v) => {
    camOpen = v;
    camPanel.classList.toggle('ops-hud__cam-panel--hidden', !v);
    camBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
    camBtn.classList.toggle('ops-hud__cam-btn--active', v);
  };
  function toggleSolo(which) {
    const isOpen =
      which === 'legend' ? legendOpen
      : which === 'help' ? helpOpen
      : which === 'menu' ? menuOpen
      : camOpen;
    if (!isOpen) {
      if (which !== 'legend' && legendOpen) setLegendRaw(false);
      if (which !== 'help' && helpOpen) setHelpRaw(false);
      if (which !== 'menu' && menuOpen) setMenuRaw(false);
      if (which !== 'cam' && camOpen) setCamRaw(false);
    }
    if (which === 'legend') setLegendRaw(!legendOpen);
    else if (which === 'help') setHelpRaw(!helpOpen);
    else if (which === 'menu') setMenuRaw(!menuOpen);
    else setCamRaw(!camOpen);
  }
  function closePopovers() {
    const any = legendOpen || helpOpen || menuOpen || camOpen;
    if (legendOpen) setLegendRaw(false);
    if (helpOpen) setHelpRaw(false);
    if (menuOpen) setMenuRaw(false);
    if (camOpen) setCamRaw(false);
    return any;
  }
  legendBtn.addEventListener('click', () => toggleSolo('legend'));
  helpBtn.addEventListener('click', () => toggleSolo('help'));
  moreBtn.addEventListener('click', () => toggleSolo('menu'));
  camBtn.addEventListener('click', () => toggleSolo('cam'));

  const inField = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      if (inField(e)) return;
      // Close a popover first and swallow the key so one press never both
      // closes a popover and drives a level-up owned by another lane.
      if (closePopovers() && e.stopImmediatePropagation) e.stopImmediatePropagation();
      return;
    }
    if (inField(e)) return;
    if (e.key === 'o' || e.key === 'O') ovBtn.click();
    else if (e.key === 'f' || e.key === 'F') camBtn.click();
    else if (e.key === 'm' || e.key === 'M') muteBtn.click();
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
    menu,
    moreBtn,
    ovBtn,
    muteBtn,
    camBtn,
    camPanel,
    afBtn,
    dofBtn,
    fsBtn,
  };
  return {
    els,
    closePopovers,
    dispose() {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', syncFs);
      legend.remove();
      legendWrap.remove();
      help.remove();
      rightcol.remove();
      sys.remove();
    },
  };
}
