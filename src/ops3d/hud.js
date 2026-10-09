/* Safepipe Ops 3D — src/ops3d/hud.js · DOM-only HUD overlay.
 * buildHud(container, {onSearch(assetId)->bool, onCreateWO(assetId), onLevel(name)})
 *   → {update(state), dispose}
 * State = {rollup:{nominal,watch,critical}, selection: feedItem|null,
 *          level:'network'|'segment'|'asset', banner:{kind,assetId}|null}.
 * DOM-only: no three.js import. Parent twin.js owns all data and calls update().
 */
import './hud.css';

const LEVELS = ['network', 'segment', 'asset'];
const LEVEL_NUM = { 1: 'network', 2: 'segment', 3: 'asset' };

/* Orientation/scale furniture — pure, unit-tested.
 * World is km (terrain SIZE 44 km, mapped circle R≈20): the bar is a
 * per-level representative scale, not a surveyed measure — wheel zoom
 * moves true scale inside a level, so the label carries ≈. */
export const SITE_COORDS = { lat: 57.03, lon: -111.68 };
export const SITE_COORDS_LABEL = '57.03°N 111.68°W';
// Live site label: "57.03°N 111.68°W" style from any {lat,lon}. Pure +
// unit-tested — the HUD follows ?site=<lat>,<lon> twins instead of
// hard-labelling Fort McMurray everywhere.
export function siteCoordsLabel(site = SITE_COORDS) {
  const la = Number(site?.lat);
  const lo = Number(site?.lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return SITE_COORDS_LABEL;
  const laS = `${Math.abs(la).toFixed(2)}°${la >= 0 ? 'N' : 'S'}`;
  const loS = `${Math.abs(lo).toFixed(2)}°${lo >= 0 ? 'E' : 'W'}`;
  return `${laS} ${loS}`;
}
export function isDefaultSite(site = SITE_COORDS) {
  return (
    Math.abs(Number(site?.lat) - SITE_COORDS.lat) < 1e-9 &&
    Math.abs(Number(site?.lon) - SITE_COORDS.lon) < 1e-9
  );
}
export const SCALE_FOR_LEVEL = {
  network: { km: 20, label: '20 KM' },
  segment: { km: 5, label: '5 KM' },
  asset: { km: 1, label: '1 KM' },
};
export function scaleForLevel(level) {
  return SCALE_FOR_LEVEL[level] ?? SCALE_FOR_LEVEL.network;
}
export function formatClockUTC(d = new Date()) {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} · ${iso.slice(11, 19)} UTC`;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function esc(s) {
  return String(s ?? '');
}

export function buildHud(container, cbs = {}) {
  if (!container) throw new Error('buildHud: container requires a DOM element');
  const onSearch = cbs.onSearch ?? (() => false);
  const onCreateWO = cbs.onCreateWO ?? (() => {});
  const onLevel = cbs.onLevel ?? (() => {});
  const onOverlay = cbs.onOverlay ?? (() => {});
  const onMute = cbs.onMute ?? (() => {});
  const onCamToggle = cbs.onCamToggle ?? (() => {});
  const onCamParam = cbs.onCamParam ?? (() => {});

  const knownIds = new Set();

  const root = el('div', 'ops-hud');
  root.setAttribute('data-testid', 'ops-hud');

  // — Top-left sector block: identity + health only. View state lives on
  // the detail-panel level buttons, overlay state in the ··· menu — nothing
  // duplicated here.
  const sector = el('div', 'ops-hud__sector');
  sector.appendChild(el('div', 'ops-hud__title', 'PIPELINE NETWORK'));
  const sectorSub = el('div', 'ops-hud__sub', 'SECTOR 7G — ATHABASCA · FORT MCMURRAY · R 20 KM');
  sector.appendChild(sectorSub);
  const healthLine = el('div', 'ops-hud__health', 'HEALTH —/—/—');
  sector.appendChild(healthLine);
  // Site anchor + live clock: dim rows in the sector block, no new box.
  // Both follow state.site (the ?site= twin) via update() below.
  const coordsLine = el('div', 'ops-hud__coords', `${SITE_COORDS_LABEL} · SITE CENTER`);
  sector.appendChild(coordsLine);
  const clock = el('div', 'ops-hud__clock', formatClockUTC(new Date()));
  clock.setAttribute('data-testid', 'ops-hud-clock');
  sector.appendChild(clock);
  // X-ray mode badge: visible while twin.js dips terrain over a focus asset.
  const xrayBadge = el('div', 'ops-hud__xray ops-hud__xray--hidden', 'X-RAY · ON');
  xrayBadge.setAttribute('data-testid', 'ops-hud-xray');
  sector.appendChild(xrayBadge);
  // — Top-left column: sector block with the critical-asset banner below it.
  // Banner is worst fault + asset only — health lives in the sector block.
  const topleft = el('div', 'ops-hud__topleft');
  topleft.appendChild(sector);
  const banner = el('button', 'ops-hud__banner ops-hud__banner--hidden');
  banner.type = 'button';
  banner.setAttribute('aria-label', 'Go to alert asset');
  banner.addEventListener('click', () => {
    if (banner.dataset.assetId) onSearch(banner.dataset.assetId);
  });
  const bannerKind = el('span', 'ops-hud__banner-kind', '');
  const bannerAsset = el('span', 'ops-hud__banner-asset', '');
  banner.appendChild(bannerKind);
  banner.appendChild(bannerAsset);
  topleft.appendChild(banner);
  root.appendChild(topleft);

  // — Bottom-left legend: hatch-type key. Markers denote TYPE (positions
  // are schematic until Phase-2 Overpass); buried runs stay dashed lines.
  // Hidden behind ▣ icon (like ?), not always-on.
  const legend = el('div', 'ops-hud__legend ops-hud__legend--hidden');
  const legendItems = [
    ['hatch-compressor', 'COMPRESSOR', 'HATCHED RECT · 45° DENSE'],
    ['hatch-valve', 'VALVE', 'HATCHED CIRCLE · 135° FINE'],
    ['hatch-terminal', 'TERMINAL', 'HATCHED RECT · 30° SPARSE'],
    ['hatch-wellhead', 'WELLHEAD · SENSOR', 'HATCHED CIRCLE · 60°'],
    ['dash', 'BURIED LINE', 'DASHED · STAYS BURIED BY DESIGN'],
  ];
  for (const [sample, label, sub] of legendItems) {
    const row = el('div', 'ops-hud__legend-row');
    const sw = el('span', `ops-hud__swatch ops-hud__swatch--${sample}`);
    row.appendChild(sw);
    row.appendChild(el('span', 'ops-hud__legend-label', label));
    legend.appendChild(row);
    legend.appendChild(el('div', 'ops-hud__legend-sub', sub));
  }
  legend.appendChild(el(
    'div',
    'ops-hud__hints',
    'MARKERS DENOTE TYPE · POSITIONS SCHEMATIC (PHASE-2 OVERPASS)',
  ));
  legend.appendChild(el(
    'div',
    'ops-hud__hints',
    'DRAG ORBIT / WHEEL ZOOM / CLICK DRILL / 1-3 VIEWS / ESC UP / H HUD',
  ));
  // Legend toggle button — sits next to ? at bottom-left, same style
  const legendBtnWrap = el('div', 'ops-hud__help');
  legendBtnWrap.style.left = '42px';
  const legendBtn = el('button', 'ops-hud__help-btn', '▣');
  legendBtn.type = 'button';
  legendBtn.setAttribute('aria-label', 'Legend: infrastructure hatch types');
  legendBtn.setAttribute('aria-expanded', 'false');
  let legendOpen = false;
  const setLegendRaw = (v) => {
    legendOpen = v;
    legend.classList.toggle('ops-hud__legend--hidden', !v);
    legendBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
  };
  legendBtn.addEventListener('click', () => toggleSolo('legend'));
  legendBtnWrap.appendChild(legendBtn);
  root.appendChild(legend);
  root.appendChild(legendBtnWrap);
  const ovBtn = el('button', 'ops-hud__overlay-btn', 'OVERLAY · OFF');
  ovBtn.type = 'button';
  ovBtn.setAttribute('aria-label', 'Cycle data overlay: off, weather, tectonic, forecast');
  ovBtn.addEventListener('click', () => onOverlay());
  const muteBtn = el('button', 'ops-hud__mute-btn', 'SOUND · ON');
  muteBtn.type = 'button';
  muteBtn.setAttribute('aria-label', 'Toggle sound (M)');
  muteBtn.addEventListener('click', () => onMute());
  // — Camera toggle: icon-only ◉ lens mark. Lives in the bottom-right
  // cluster between ··· and fullscreen; sliders pop above it.
  const camBtn = el('button', 'ops-hud__cam-btn', '◉');
  camBtn.type = 'button';
  camBtn.setAttribute('aria-label', 'Camera controls: aperture, zoom, focus (F)');
  camBtn.setAttribute('aria-expanded', 'false');
  camBtn.addEventListener('click', () => onCamToggle());
  // legend already mounted via legendWrap — do not append bare legend
  // Camera panel: hidden popover above the legend. Aperture f-stops follow
  // the photo convention (1.4 wide open → 16 deep); focal length is real
  // zoom (18 wide → 120 tele); focus distance goes manual the moment its
  // slider moves (AF button re-engages tracking).
  const camPanel = el('div', 'ops-hud__cam-panel ops-hud__cam-panel--hidden');
  camPanel.setAttribute('role', 'dialog');
  camPanel.setAttribute('aria-label', 'Camera focus settings');
  const camTitle = el('div', 'ops-hud__cam-title', 'CAMERA · FOCUS');
  camPanel.appendChild(camTitle);
  const mkCamRow = (label, min, max, step, val, fmt, fn) => {
    const row = el('div', 'ops-hud__slider-row');
    const lab = el('span', 'ops-hud__slider-label', label);
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
      fn(Number(input.value));
    });
    row.appendChild(lab);
    row.appendChild(input);
    row.appendChild(out);
    camPanel.appendChild(row);
    return { input, out, fmt };
  };
  // Aperture in standard full-stop steps; focal 18–120mm; distance 0.2–120m.
  const FSTOPS = [1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16];
  const fstopFmt = (v) => `ƒ/${FSTOPS[Math.round(v)] ?? v}`;
  const apRow = mkCamRow('APERTURE', 0, FSTOPS.length - 1, 1, 5, fstopFmt, (v) =>
    onCamParam({ fstop: FSTOPS[Math.round(v)] }),
  );
  const focalRow = mkCamRow('FOCAL', 18, 120, 1, 32, (v) => `${v}mm`, (v) => onCamParam({ focalMm: v }));
  const distRow = mkCamRow('FOCUS', 0.2, 120, 0.1, 10, (v) => `${v.toFixed(1)}m`, (v) =>
    onCamParam({ focusDist: v }),
  );
  const camToggles = el('div', 'ops-hud__cam-toggles');
  const afBtn = el('button', 'ops-hud__cam-toggle', 'AF · ON');
  afBtn.type = 'button';
  afBtn.setAttribute('aria-label', 'Autofocus: track hovered or clicked point');
  afBtn.addEventListener('click', () => onCamParam({ af: !(afBtn.dataset.on === '1') }));
  const dofBtn = el('button', 'ops-hud__cam-toggle', 'DOF · AUTO');
  dofBtn.type = 'button';
  dofBtn.setAttribute('aria-label', 'Depth of field: auto, on, off');
  dofBtn.addEventListener('click', () => {
    const cur = dofBtn.dataset.mode ?? 'auto';
    const next = cur === 'auto' ? 'on' : cur === 'on' ? 'off' : 'auto';
    onCamParam(next === 'auto' ? { dofAuto: true } : { dof: next === 'on' });
  });
  camToggles.appendChild(afBtn);
  camToggles.appendChild(dofBtn);
  camPanel.appendChild(camToggles);

  // — Bottom-left help: ? button opens the shortcuts + controls overlay.
  const help = el('div', 'ops-hud__help');
  const helpPanel = el('div', 'ops-hud__help-panel ops-hud__help-panel--hidden');
  helpPanel.setAttribute('role', 'dialog');
  helpPanel.setAttribute('aria-label', 'Shortcuts and controls');
  const helpRows = [
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
  for (const [key, desc] of helpRows) {
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
  let helpOpen = false;
  const setHelpRaw = (v) => {
    helpOpen = v;
    helpPanel.classList.toggle('ops-hud__help-panel--hidden', !v);
    helpBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
  };
  helpBtn.addEventListener('click', () => toggleSolo('help'));
  help.appendChild(helpPanel);
  help.appendChild(helpBtn);
  root.appendChild(help);

  // — Orientation furniture: compass top-center, scale bar bottom-center.
  // Both clear of the four corner clusters. Static north-up: the default
  // camera yaw is ≈north-up, and update() accepts an optional
  // state.heading (deg clockwise) to rotate the needle once twin.js passes
  // live camera azimuth. Pure CSS needle — vector-crisp, no raster.
  const compass = el('div', 'ops-hud__compass');
  compass.setAttribute('data-testid', 'ops-hud-compass');
  compass.setAttribute('aria-label', 'North arrow — up is grid north');
  compass.appendChild(el('div', 'ops-hud__compass-n', 'N'));
  const needle = el('div', 'ops-hud__needle');
  needle.setAttribute('data-testid', 'ops-hud-needle');
  needle.appendChild(el('div', 'ops-hud__needle-up'));
  needle.appendChild(el('div', 'ops-hud__needle-dn'));
  compass.appendChild(needle);
  root.appendChild(compass);

  const scalebar = el('div', 'ops-hud__scalebar');
  scalebar.setAttribute('data-testid', 'ops-hud-scale');
  const scaleLabel = el('div', 'ops-hud__scalebar-label', `≈ ${scaleForLevel('network').label}`);
  scaleLabel.setAttribute('data-testid', 'ops-hud-scale-label');
  const scaleBar = el('div', 'ops-hud__scalebar-bar');
  scaleBar.setAttribute('aria-hidden', 'true');
  scaleBar.appendChild(el('div', 'ops-hud__scalebar-seg ops-hud__scalebar-seg--fill'));
  scaleBar.appendChild(el('div', 'ops-hud__scalebar-seg'));
  scalebar.appendChild(scaleLabel);
  scalebar.appendChild(scaleBar);
  root.appendChild(scalebar);

  // Live clock: refresh on every update + 1 s tick; cleared on dispose.
  const clockTick = () => {
    clock.textContent = formatClockUTC(new Date());
  };
  const clockTimer = setInterval(clockTick, 1000);
  if (typeof clockTimer === 'object' && clockTimer.unref) clockTimer.unref();

  // — Right detail panel (hidden unless selection) —
  const panel = el('div', 'ops-hud__panel ops-hud__panel--hidden');

  const search = el('input', 'ops-hud__search');
  search.type = 'search';
  search.placeholder = 'SEARCH ASSET ID';
  search.setAttribute('aria-label', 'Search asset id');
  search.setAttribute('list', 'ops-hud-assets');
  const datalist = document.createElement('datalist');
  datalist.id = 'ops-hud-assets';
  panel.appendChild(search);
  panel.appendChild(datalist);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      onSearch(search.value.trim());
    }
  });
  search.addEventListener('change', () => {
    if (search.value.trim()) onSearch(search.value.trim());
  });

  const body = el('div', 'ops-hud__body');
  panel.appendChild(body);

  const woBtn = el('button', 'ops-hud__wo', 'CREATE WO');
  woBtn.type = 'button';
  woBtn.disabled = true;
  woBtn.addEventListener('click', () => {
    const id = woBtn.dataset.assetId;
    if (id) onCreateWO(id);
  });
  panel.appendChild(woBtn);
  // — VIEW presets: their own box under the asset panel, visible only
  // while an asset is selected (keys 1-3 work any time).
  const viewBox = el('div', 'ops-hud__viewbox ops-hud__viewbox--hidden');
  viewBox.appendChild(el('div', 'ops-hud__viewbox-head', 'VIEW'));
  const levelRow = el('div', 'ops-hud__levels');
  levelRow.setAttribute('role', 'group');
  levelRow.setAttribute('aria-label', 'Camera view');
  const levelNames = { network: 'TOP', segment: 'ISO', asset: 'NEAR' };
  const levelBtns = LEVELS.map((name) => {
    const b = el('button', 'ops-hud__level-btn', levelNames[name]);
    b.type = 'button';
    b.title = `${levelNames[name]} — ${name} view`;
    b.dataset.level = name;
    b.setAttribute('aria-label', `${levelNames[name]} view (${name})`);
    b.addEventListener('click', () => onLevel(name));
    levelRow.appendChild(b);
    return b;
  });
  viewBox.appendChild(levelRow);
  // — Right column: asset panel with the VIEW box below it.
  const rightcol = el('div', 'ops-hud__rightcol');
  rightcol.appendChild(panel);
  rightcol.appendChild(viewBox);
  root.appendChild(rightcol);

  // — Bottom-right system cluster: ··· menu (overlay / sound)
  // next to fullscreen. Menu popover opens above the buttons.
  const sys = el('div', 'ops-hud__sys');
  const menu = el('div', 'ops-hud__menu ops-hud__menu--hidden');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Display settings');
  menu.appendChild(ovBtn);
  menu.appendChild(muteBtn);
  const moreBtn = el('button', 'ops-hud__more', '···');
  moreBtn.type = 'button';
  moreBtn.setAttribute('aria-label', 'Display settings: overlay, sound');
  moreBtn.setAttribute('aria-expanded', 'false');
  let menuOpen = false;
  const setMenuRaw = (v) => {
    menuOpen = v;
    menu.classList.toggle('ops-hud__menu--hidden', !v);
    moreBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
  };
  moreBtn.addEventListener('click', () => toggleSolo('menu'));
  const fsBtn = el('button', 'ops-hud__fs', 'FULLSCREEN');
  fsBtn.type = 'button';
  fsBtn.setAttribute('aria-label', 'Toggle fullscreen');
  const syncFs = () => {
    const on = document.fullscreenElement === container;
    fsBtn.textContent = on ? 'EXIT FULL' : 'FULLSCREEN';
    fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  fsBtn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === container) await document.exitFullscreen();
      else if (container.requestFullscreen) await container.requestFullscreen();
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
  root.appendChild(sys);

  // — Single-popover manager: at most ONE open among legend / ? help /
  // ··· overlay menu / camera panel. Opening one closes the rest; Esc
  // closes whichever is open. The asset panel is selection-driven (not a
  // toggle popover) so it stays exempt. The camera panel is twin-owned
  // state — closing it means asking twin via onCamToggle().
  // HOOK (mapbox-base): the future SAT/TWIN crossfade toggle plugs in here
  // as a fifth member — call toggleSolo('sat') from its button and add a
  // `which !== 'sat' && satOpen` arm + raw setter following the pattern
  // below; closePopovers() must also close it. This manager stays the sole
  // owner of popover exclusivity — no second closer elsewhere.
  let camPanelOpen = false;
  function toggleSolo(which) {
    const isOpen =
      which === 'legend' ? legendOpen
      : which === 'help' ? helpOpen
      : menuOpen;
    if (!isOpen) {
      // Opening: close everything else first.
      if (which !== 'legend' && legendOpen) setLegendRaw(false);
      if (which !== 'help' && helpOpen) setHelpRaw(false);
      if (which !== 'menu' && menuOpen) setMenuRaw(false);
      if (camPanelOpen) onCamToggle();
    }
    if (which === 'legend') setLegendRaw(!legendOpen);
    else if (which === 'help') setHelpRaw(!helpOpen);
    else setMenuRaw(!menuOpen);
  }
  function closePopovers() {
    const any = legendOpen || helpOpen || menuOpen || camPanelOpen;
    if (legendOpen) setLegendRaw(false);
    if (helpOpen) setHelpRaw(false);
    if (menuOpen) setMenuRaw(false);
    if (camPanelOpen) onCamToggle();
    return any;
  }

  container.appendChild(root);

  let hidden = false;
  const setHidden = (v) => {
    hidden = v;
    root.classList.toggle('ops-hud--hidden', v);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      // Esc closes a popover first and swallows the level-up so one key
      // press never both closes a menu and flies the camera.
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (closePopovers() && e.stopImmediatePropagation) e.stopImmediatePropagation();
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      setHidden(!hidden);
    }
  };
  window.addEventListener('keydown', onKey);

  function renderSelection(item) {
    body.textContent = '';
    if (!item) {
      panel.classList.add('ops-hud__panel--hidden');
      woBtn.disabled = true;
      woBtn.dataset.assetId = '';
      return;
    }
    panel.classList.remove('ops-hud__panel--hidden');
    if (item.assetId) knownIds.add(item.assetId);

    const head = el('div', 'ops-hud__asset-id', esc(item.assetId));
    body.appendChild(head);
    const meta = el('div', 'ops-hud__meta', esc(item.kind ?? ''));
    body.appendChild(meta);

    const chip = el('span', `ops-hud__chip ops-hud__chip--${esc(item.health ?? 'nominal')}`, esc(item.health ?? 'nominal'));
    body.appendChild(chip);

    if (item.sensitivity && item.sensitivity !== 'normal') {
      body.appendChild(el('span', 'ops-hud__badge', `HCA · ${esc(item.sensitivity).toUpperCase()}`));
    }

    if (Array.isArray(item.faults) && item.faults.length) {
      const fl = el('ul', 'ops-hud__faults');
      for (const f of item.faults) {
        fl.appendChild(el(
          'li',
          'ops-hud__fault',
          `${esc(f.type ?? 'fault')} · ch. ${esc(f.chainage ?? '?')} · ${esc(f.severity ?? '')}`,
        ));
      }
      body.appendChild(fl);
    } else {
      body.appendChild(el('div', 'ops-hud__nofaults', 'NO FAULTS'));
    }

    if (Array.isArray(item.compliance) && item.compliance.length) {
      const cl = el('ul', 'ops-hud__compliance');
      for (const c of item.compliance) {
        cl.appendChild(el('li', 'ops-hud__comp', `${esc(c.flag ?? '')} · ${esc(c.ref ?? '')}`));
      }
      body.appendChild(cl);
    }

    woBtn.disabled = false;
    woBtn.dataset.assetId = esc(item.assetId);
  }

  function refreshDatalist() {
    datalist.textContent = '';
    for (const id of [...knownIds].sort()) {
      const opt = document.createElement('option');
      opt.value = id;
      datalist.appendChild(opt);
    }
  }

  function update(state = {}) {
    const rollup = state.rollup ?? { nominal: 0, watch: 0, critical: 0 };
    healthLine.textContent =
      `HEALTH ${rollup.nominal ?? 0} OK · ${rollup.watch ?? 0} WATCH · ${rollup.critical ?? 0} CRITICAL`;

    const level = LEVELS.includes(state.level) ? state.level : 'network';
    // Scale bar: dynamic if twin provides scaleKm (km per 120px of screen,
    // derived live from the camera frustum each frame), else per-level
    // fallback. Label carries ≈ and bar width tracks the true proportion:
    // 120px ≡ scaleKm, so width = 120 · pick/scaleKm, clamped to read.
    let sc;
    if (typeof state.scaleKm === 'number' && Number.isFinite(state.scaleKm) && state.scaleKm > 0) {
      const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
      let pick = nice[0];
      for (const n of nice) { if (n <= state.scaleKm * 1.1) pick = n; }
      sc = { km: pick, label: `${pick} KM` };
      const barPx = Math.max(40, Math.min(160, Math.round((120 * pick) / state.scaleKm)));
      scaleBar.style.width = `${barPx}px`;
    } else {
      sc = scaleForLevel(level);
      scaleBar.style.width = '';
    }
    scaleLabel.textContent = `≈ ${sc.label}`;
    scalebar.setAttribute('aria-label', `Approximate scale at ${level} view: ${sc.label} — 1:1 km, dynamic with zoom`);
    clock.textContent = formatClockUTC(new Date());
    // Live site: a ?site=<lat>,<lon> twin re-labels coords + sector rows.
    if (state.site !== undefined) {
      coordsLine.textContent = `${siteCoordsLabel(state.site)} · SITE CENTER`;
      sectorSub.textContent = isDefaultSite(state.site)
        ? 'SECTOR 7G — ATHABASCA · FORT MCMURRAY · R 20 KM'
        : `CUSTOM SITE · R 20 KM`;
    }
    if (typeof state.heading === 'number' && Number.isFinite(state.heading)) {
      needle.style.transform = `rotate(${state.heading}deg)`;
      compass.setAttribute(
        'aria-label',
        `North arrow — camera heading ${Math.round(((state.heading % 360) + 360) % 360)}° clockwise from grid north`,
      );
    }
    xrayBadge.classList.toggle('ops-hud__xray--hidden', !state.xray);
    viewBox.classList.toggle('ops-hud__viewbox--hidden', !(state.selection ?? null));
    for (const b of levelBtns) {
      b.classList.toggle('ops-hud__level-btn--active', b.dataset.level === level);
      b.setAttribute('aria-pressed', b.dataset.level === level ? 'true' : 'false');
    }

    const bn = state.banner ?? null;
    if (bn && bn.assetId) {
      knownIds.add(bn.assetId);
      banner.classList.remove('ops-hud__banner--hidden');
      bannerKind.textContent = esc(bn.kind ?? 'critical').toUpperCase();
      bannerAsset.textContent = esc(bn.assetId);
      banner.dataset.assetId = bn.assetId;
      banner.setAttribute('aria-label', `Go to ${bn.assetId}`);
    } else {
      banner.classList.add('ops-hud__banner--hidden');
      bannerKind.textContent = '';
      bannerAsset.textContent = '';
      delete banner.dataset.assetId;
    }

    renderSelection(state.selection ?? null);
    refreshDatalist();
    ovBtn.textContent = `OVERLAY · ${state.overlay ? state.overlay.toUpperCase() : 'OFF'}`;
    ovBtn.classList.toggle('ops-hud__overlay-btn--active', !!state.overlay);
    const muted = !!state.muted;
    muteBtn.textContent = muted ? 'SOUND · OFF' : 'SOUND · ON';
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    // Camera panel state: icon reflects AF/DOF at a glance; panel + sliders
    // only refresh from state when the user isn't dragging them (active
    // element check stops the readout fighting the pointer).
    const cam = state.cam ?? { af: true, fstop: 5.6, focalMm: 32, focusDist: 10, dof: null, panel: false };
    camBtn.textContent = '◉';
    camBtn.setAttribute('aria-label', `Camera controls, autofocus ${cam.af ? 'on' : 'off'} (F)`);
    camBtn.classList.toggle('ops-hud__cam-btn--active', !!cam.panel);
    camBtn.setAttribute('aria-expanded', cam.panel ? 'true' : 'false');
    camPanel.classList.toggle('ops-hud__cam-panel--hidden', !cam.panel);
    // Camera panel joins the single-popover set: twin opening it closes the
    // local popovers so two plates never stack.
    if (!!cam.panel && !camPanelOpen) {
      if (legendOpen) setLegendRaw(false);
      if (helpOpen) setHelpRaw(false);
      if (menuOpen) setMenuRaw(false);
    }
    camPanelOpen = !!cam.panel;
    afBtn.textContent = cam.af ? 'AF · ON' : 'AF · OFF';
    afBtn.dataset.on = cam.af ? '1' : '0';
    afBtn.classList.toggle('ops-hud__cam-toggle--active', !!cam.af);
    const dofMode = cam.dof == null ? 'auto' : cam.dof ? 'on' : 'off';
    dofBtn.textContent = `DOF · ${dofMode.toUpperCase()}`;
    dofBtn.dataset.mode = dofMode;
    dofBtn.classList.toggle('ops-hud__cam-toggle--active', dofMode === 'on');
    const apIdx = FSTOPS.reduce((b, s, i) => (Math.abs(s - cam.fstop) < Math.abs(FSTOPS[b] - cam.fstop) ? i : b), 0);
    if (document.activeElement !== apRow.input) {
      apRow.input.value = String(apIdx);
      apRow.out.textContent = fstopFmt(apIdx);
    }
    if (document.activeElement !== focalRow.input) {
      focalRow.input.value = String(Math.round(cam.focalMm));
      focalRow.out.textContent = `${Math.round(cam.focalMm)}mm`;
    }
    if (document.activeElement !== distRow.input) {
      distRow.input.value = String(cam.focusDist);
      distRow.out.textContent = `${Number(cam.focusDist).toFixed(1)}m`;
    }
  }

  // Numeric 1-3 level shortcut when HUD has focus context; twin.js owns camera.
  const onLevelKey = (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const name = LEVEL_NUM[e.key];
    if (name) onLevel(name);
  };
  window.addEventListener('keydown', onLevelKey);

  return {
    update,
    closePopovers,
    dispose() {
      clearInterval(clockTimer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onLevelKey);
      document.removeEventListener('fullscreenchange', syncFs);
      root.remove();
    },
  };
}
