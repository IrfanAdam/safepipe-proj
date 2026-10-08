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

  // — Top-left sector block —
  const sector = el('div', 'ops-hud__sector');
  sector.appendChild(el('div', 'ops-hud__title', 'PIPELINE NETWORK'));
  sector.appendChild(el('div', 'ops-hud__sub', 'SECTOR 7G — ATHABASCA · FORT MCMURRAY · R 20 KM'));
  const levelLabel = el('div', 'ops-hud__level', 'NETWORK');
  sector.appendChild(levelLabel);
  const healthLine = el('div', 'ops-hud__health', 'HEALTH —/—/—');
  sector.appendChild(healthLine);
  const overlayLabel = el('div', 'ops-hud__overlay', 'OVERLAY · OFF');
  sector.appendChild(overlayLabel);
  root.appendChild(sector);

  // — Top-right critical banner (hidden unless banner set) —
  const banner = el('div', 'ops-hud__banner ops-hud__banner--hidden');
  banner.setAttribute('role', 'alert');
  const bannerKind = el('span', 'ops-hud__banner-kind', '');
  const bannerAsset = el('span', 'ops-hud__banner-asset', '');
  banner.appendChild(bannerKind);
  banner.appendChild(bannerAsset);
  root.appendChild(banner);

  // — Bottom-left legend / hints —
  const legend = el('div', 'ops-hud__legend');
  const legendItems = [
    ['dot', 'health'],
    ['box', 'facility'],
    ['dash', 'sensitive'],
  ];
  for (const [sample, label] of legendItems) {
    const row = el('div', 'ops-hud__legend-row');
    const sw = el('span', `ops-hud__swatch ops-hud__swatch--${sample}`);
    row.appendChild(sw);
    row.appendChild(el('span', 'ops-hud__legend-label', label));
    legend.appendChild(row);
  }
  legend.appendChild(el(
    'div',
    'ops-hud__hints',
    'DRAG ORBIT / WHEEL ZOOM / CLICK DRILL / 1-3 VIEWS / O OVERLAY / F CAMERA / ESC UP / H HUD',
  ));
  const ovBtn = el('button', 'ops-hud__overlay-btn', 'OVERLAY · OFF');
  ovBtn.type = 'button';
  ovBtn.setAttribute('aria-label', 'Cycle data overlay: off, weather, tectonic, forecast');
  ovBtn.addEventListener('click', () => onOverlay());
  legend.appendChild(ovBtn);
  const muteBtn = el('button', 'ops-hud__mute-btn', 'SOUND · ON');
  muteBtn.type = 'button';
  muteBtn.setAttribute('aria-label', 'Toggle sound (M)');
  muteBtn.addEventListener('click', () => onMute());
  legend.appendChild(muteBtn);
  // — One camera focus icon: opens the camera panel (aperture, focal/zoom,
  // focus distance, AF, DoF switch). Nothing slider-like lives in the open.
  const camBtn = el('button', 'ops-hud__cam-btn', '⌖ FOCUS');
  camBtn.type = 'button';
  camBtn.setAttribute('aria-label', 'Camera focus settings: aperture, zoom, focus (F)');
  camBtn.setAttribute('aria-expanded', 'false');
  camBtn.addEventListener('click', () => onCamToggle());
  legend.appendChild(camBtn);
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
  legend.appendChild(camPanel);
  root.appendChild(legend);

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
  panel.appendChild(levelRow);
  root.appendChild(panel);

  // — Bottom-right fullscreen toggle (container-agnostic: user mounts anywhere) —
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
  root.appendChild(fsBtn);

  container.appendChild(root);

  let hidden = false;
  const setHidden = (v) => {
    hidden = v;
    root.classList.toggle('ops-hud--hidden', v);
  };
  const onKey = (e) => {
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
    healthLine.textContent = `HEALTH ${rollup.nominal ?? 0}/${rollup.watch ?? 0}/${rollup.critical ?? 0}`;

    const level = LEVELS.includes(state.level) ? state.level : 'network';
    levelLabel.textContent = `VIEW · ${levelNames[level] ?? level.toUpperCase()}`;
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
    } else {
      banner.classList.add('ops-hud__banner--hidden');
      bannerKind.textContent = '';
      bannerAsset.textContent = '';
    }

    renderSelection(state.selection ?? null);
    refreshDatalist();
    overlayLabel.textContent = `OVERLAY · ${state.overlay ? state.overlay.toUpperCase() : 'OFF'}`;
    ovBtn.textContent = `OVERLAY · ${state.overlay ? state.overlay.toUpperCase() : 'OFF'}`;
    ovBtn.classList.toggle('ops-hud__overlay-btn--active', !!state.overlay);
    const muted = !!state.muted;
    muteBtn.textContent = muted ? 'SOUND · OFF' : 'SOUND · ON';
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    // Camera panel state: icon reflects AF/DOF at a glance; panel + sliders
    // only refresh from state when the user isn't dragging them (active
    // element check stops the readout fighting the pointer).
    const cam = state.cam ?? { af: true, fstop: 5.6, focalMm: 32, focusDist: 10, dof: null, panel: false };
    camBtn.textContent = cam.af ? '⌖ FOCUS · AF' : '⌖ FOCUS · MF';
    camBtn.classList.toggle('ops-hud__cam-btn--active', !!cam.panel);
    camBtn.setAttribute('aria-expanded', cam.panel ? 'true' : 'false');
    camPanel.classList.toggle('ops-hud__cam-panel--hidden', !cam.panel);
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
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onLevelKey);
      document.removeEventListener('fullscreenchange', syncFs);
      root.remove();
    },
  };
}
