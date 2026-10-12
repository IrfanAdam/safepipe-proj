/* Ring-2 HUD furniture — Lane A static DOM (Phase 00 Task 1 P1).
 * buildFurniture(root) -> { els }.
 * Chrome shell: sector block + compass + scalebar DOM lives here (same DOM
 * order and class names as v1 src/ops3d/hud.js; placeholder text verbatim
 * from v1). Values go live in main.js tickChrome, which drives needle
 * rotation + scale label/bar every frame — this file only owns the DOM.
 * No feed wiring, no clock tick, no callbacks, no three.js import.
 * Styling is token-only via ops-hud__* classes (host page loads
 * design-system/ops-tokens.css + HUD CSS); this file sets no inline
 * styles and embeds no raw colour/length values.
 */

/* Ring-2 site pin (Sangachal Terminal — src/ring2/site.js is the single
 * source of truth; v1's Fort McMurray ground truth does NOT transfer). */
export const SITE_COORDS = { lat: 40.201262, lon: 49.48127 };
export const SITE_COORDS_LABEL = '40.20°N 49.48°E';

export function siteCoordsLabel(site = SITE_COORDS) {
  const la = Number(site?.lat);
  const lo = Number(site?.lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return SITE_COORDS_LABEL;
  const laS = `${Math.abs(la).toFixed(2)}°${la >= 0 ? 'N' : 'S'}`;
  const loS = `${Math.abs(lo).toFixed(2)}°${lo >= 0 ? 'E' : 'W'}`;
  return `${laS} ${loS}`;
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

export function buildFurniture(root) {
  if (!root) throw new Error('buildFurniture: root requires a DOM element');

  // 1 — Top-left column + sector block (v1 order: title, sub, health,
  // coords, clock). X-RAY badge + banner are data-driven — excluded (P3).
  const topleft = el('div', 'ops-hud__topleft');
  const sector = el('div', 'ops-hud__sector');
  const title = el('div', 'ops-hud__title', 'PIPELINE NETWORK');
  const sub = el('div', 'ops-hud__sub', 'SANGACHAL TERMINAL · CASPIAN COAST · R 10 KM');
  const health = el('div', 'ops-hud__health', 'HEALTH —/—/—');
  const coords = el('div', 'ops-hud__coords', `${SITE_COORDS_LABEL} · SITE CENTER`);
  const clock = el('div', 'ops-hud__clock', formatClockUTC(new Date()));
  clock.setAttribute('data-testid', 'ops-hud-clock');
  sector.append(title, sub, health, coords, clock);
  topleft.appendChild(sector);
  root.appendChild(topleft);

  // 2 — Compass, top-center (v1 order: N label then needle halves).
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

  // 3 — Scale bar, bottom-center (per-level fallback label; main.js
  // tickChrome overwrites the label + fill live from the map zoom).
  const scalebar = el('div', 'ops-hud__scalebar');
  scalebar.setAttribute('data-testid', 'ops-hud-scale');
  const scaleLabel = el('div', 'ops-hud__scalebar-label', `≈ ${scaleForLevel('network').label}`);
  scaleLabel.setAttribute('data-testid', 'ops-hud-scale-label');
  const scaleBar = el('div', 'ops-hud__scalebar-bar');
  scaleBar.setAttribute('aria-hidden', 'true');
  scaleBar.appendChild(el('div', 'ops-hud__scalebar-seg ops-hud__scalebar-seg--fill'));
  scaleBar.appendChild(el('div', 'ops-hud__scalebar-seg'));
  scalebar.append(scaleLabel, scaleBar);
  root.appendChild(scalebar);

  return {
    els: {
      topleft,
      sector,
      title,
      sub,
      health,
      coords,
      clock,
      compass,
      needle,
      scalebar,
      scaleLabel,
      scaleBar,
    },
  };
}
