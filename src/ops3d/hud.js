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

  const knownIds = new Set();

  const root = el('div', 'ops-hud');
  root.setAttribute('data-testid', 'ops-hud');

  // — Top-left sector block —
  const sector = el('div', 'ops-hud__sector');
  sector.appendChild(el('div', 'ops-hud__title', 'PIPELINE NETWORK'));
  sector.appendChild(el('div', 'ops-hud__sub', 'SECTOR 7G'));
  const levelLabel = el('div', 'ops-hud__level', 'NETWORK');
  sector.appendChild(levelLabel);
  const healthLine = el('div', 'ops-hud__health', 'HEALTH —/—/—');
  sector.appendChild(healthLine);
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
    'DRAG ORBIT / WHEEL ZOOM / CLICK DRILL / 1-3 LEVELS / ESC UP / H HUD',
  ));
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
  levelRow.setAttribute('aria-label', 'Zoom level');
  const levelBtns = LEVELS.map((name, i) => {
    const b = el('button', 'ops-hud__level-btn', String(i + 1));
    b.type = 'button';
    b.title = name.toUpperCase();
    b.dataset.level = name;
    b.setAttribute('aria-label', `Level ${i + 1}: ${name}`);
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
    levelLabel.textContent = level.toUpperCase();
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
