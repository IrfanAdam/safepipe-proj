import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);

/* Minimal fake DOM: just enough for buildHud (createElement, classList,
// dataset, attributes, tree, listeners). No layout, no selectors beyond
// a test-side tree walk. */
class FakeClassList {
  constructor() {
    this._s = new Set();
  }
  add(...c) {
    for (const x of c) this._s.add(x);
  }
  remove(...c) {
    for (const x of c) this._s.delete(x);
  }
  toggle(c, force) {
    if (force === undefined) {
      if (this._s.has(c)) {
        this._s.delete(c);
        return false;
      }
      this._s.add(c);
      return true;
    }
    if (force) this._s.add(c);
    else this._s.delete(c);
    return force;
  }
  contains(c) {
    return this._s.has(c);
  }
}

class FakeEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this._className = '';
    this.textContent = '';
    this._listeners = {};
  }
  set className(v) {
    this._className = v;
    this.classList = new FakeClassList();
    for (const c of String(v).split(/\s+/).filter(Boolean)) this.classList.add(c);
  }
  get className() {
    return this._className;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k] ?? null;
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  addEventListener(t, fn) {
    (this._listeners[t] ??= []).push(fn);
  }
  removeEventListener() {}
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
  }
}

function find(root, pred) {
  if (pred(root)) return root;
  for (const c of root.children) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
}
const byTestId = (id) => (n) => n.attributes?.['data-testid'] === id;
const byClass = (cls) => (n) => n.classList?.contains(cls);

let hud;
before(async () => {
  const g = globalThis;
  const docListeners = {};
  g.document = {
    createElement: (tag) => new FakeEl(tag),
    addEventListener: (t, fn) => ((docListeners[t] ??= []).push(fn)),
    removeEventListener: () => {},
    fullscreenElement: null,
    activeElement: null,
  };
  g.window = { addEventListener: () => {}, removeEventListener: () => {} };
  hud = await import('../src/ops3d/hud.js');
});

describe('ops3d HUD orientation/scale furniture', () => {
  it('exports the pinned site coords (Fort McMurray)', () => {
    assert.deepEqual(hud.SITE_COORDS, { lat: 57.03, lon: -111.68 });
    assert.match(hud.SITE_COORDS_LABEL, /57\.03.*111\.68/);
  });

  it('scaleForLevel maps TOP/ISO/NEAR to 20/5/1 km, unknown falls back to TOP', () => {
    assert.equal(hud.scaleForLevel('network').label, '20 KM');
    assert.equal(hud.scaleForLevel('segment').label, '5 KM');
    assert.equal(hud.scaleForLevel('asset').label, '1 KM');
    assert.equal(hud.scaleForLevel('bogus').label, '20 KM');
    assert.equal(hud.scaleForLevel(undefined).km, 20);
  });

  it('formatClockUTC renders a stable UTC stamp', () => {
    const s = hud.formatClockUTC(new Date('2026-10-08T04:05:06.789Z'));
    assert.equal(s, '2026-10-08 · 04:05:06 UTC');
  });

  it('buildHud mounts compass, scale bar, coords + clock', () => {
    const container = new FakeEl('div');
    const h = hud.buildHud(container, {});
    const root = container.children[0];
    assert.ok(find(root, byTestId('ops-hud-compass')), 'compass mounted');
    assert.ok(find(root, byTestId('ops-hud-needle')), 'needle mounted');
    assert.ok(find(root, byTestId('ops-hud-scale')), 'scale bar mounted');
    assert.ok(find(root, byTestId('ops-hud-scale-label')), 'scale label mounted');
    assert.ok(find(root, byTestId('ops-hud-clock')), 'clock mounted');
    assert.ok(find(root, byClass('ops-hud__coords')), 'coords row mounted');
    const coords = find(root, byClass('ops-hud__coords'));
    assert.match(coords.textContent, /57\.03.*111\.68/);
    assert.match(find(root, byTestId('ops-hud-clock')).textContent, /^\d{4}-\d{2}-\d{2} · \d{2}:\d{2}:\d{2} UTC$/);
    h.dispose();
    assert.equal(container.children.length, 0, 'dispose removes the HUD root');
  });

  it('update() switches the scale label per level and rotates the needle on heading', () => {
    const container = new FakeEl('div');
    const h = hud.buildHud(container, {});
    const root = container.children[0];
    const label = find(root, byTestId('ops-hud-scale-label'));
    h.update({ level: 'network' });
    assert.equal(label.textContent, '≈ 20 KM');
    h.update({ level: 'segment' });
    assert.equal(label.textContent, '≈ 5 KM');
    h.update({ level: 'asset' });
    assert.equal(label.textContent, '≈ 1 KM');
    const needle = find(root, byTestId('ops-hud-needle'));
    h.update({ level: 'network', heading: 45 });
    assert.equal(needle.style.transform, 'rotate(45deg)');
    h.dispose();
  });

  it('dynamic scaleKm picks a nice bar + proportional width (120px ≡ scaleKm)', () => {
    const container = new FakeEl('div');
    const h = hud.buildHud(container, {});
    const root = container.children[0];
    const label = find(root, byTestId('ops-hud-scale-label'));
    const bar = find(root, byClass('ops-hud__scalebar-bar'));
    h.update({ level: 'network', scaleKm: 9.5 });
    assert.equal(label.textContent, '≈ 10 KM');
    assert.equal(bar.style.width, '126px'); // 120·10/9.5 ≈ 126
    h.update({ level: 'asset', scaleKm: 0.4 });
    assert.equal(label.textContent, '≈ 0.2 KM');
    assert.equal(bar.style.width, '60px'); // 120·0.2/0.4
    h.update({ level: 'network' }); // fallback restores
    assert.equal(label.textContent, '≈ 20 KM');
    assert.equal(bar.style.width, '');
    h.dispose();
  });

  it('single-popover manager: opening one closes the others, Esc closes', () => {
    const container = new FakeEl('div');
    const h = hud.buildHud(container, {});
    const root = container.children[0];
    const btn = (aria) => find(root, (n) => n.tagName === 'BUTTON' && n.attributes?.['aria-label'] === aria);
    const click = (b) => b._listeners.click.forEach((fn) => fn());
    const legendBtn = btn('Legend: infrastructure hatch types');
    const helpBtn = btn('Shortcuts and controls');
    const moreBtn = btn('Display settings: overlay, sound');
    const legend = find(root, byClass('ops-hud__legend'));
    const helpPanel = find(root, byClass('ops-hud__help-panel'));
    const menu = find(root, byClass('ops-hud__menu'));
    assert.ok(legend.classList.contains('ops-hud__legend--hidden'), 'legend starts closed');
    click(legendBtn);
    assert.ok(!legend.classList.contains('ops-hud__legend--hidden'), 'legend opens');
    click(helpBtn); // opening ? closes legend
    assert.ok(legend.classList.contains('ops-hud__legend--hidden'), 'legend closed by ?');
    assert.ok(!helpPanel.classList.contains('ops-hud__help-panel--hidden'), '? opens');
    click(moreBtn); // opening ··· closes ?
    assert.ok(helpPanel.classList.contains('ops-hud__help-panel--hidden'), '? closed by ···');
    assert.ok(!menu.classList.contains('ops-hud__menu--hidden'), '··· opens');
    assert.equal(h.closePopovers(), true, 'closePopovers reports an open popover');
    assert.ok(menu.classList.contains('ops-hud__menu--hidden'), '··· closed');
    assert.equal(h.closePopovers(), false, 'closePopovers reports none open');
    h.dispose();
  });

  it('camera panel joins the single-popover set + xray badge follows state', () => {
    const container = new FakeEl('div');
    let camToggles = 0;
    const h = hud.buildHud(container, { onCamToggle: () => { camToggles++; } });
    const root = container.children[0];
    const btn = (aria) => find(root, (n) => n.tagName === 'BUTTON' && n.attributes?.['aria-label'] === aria);
    const cam = (panel) => ({ af: true, fstop: 5.6, focalMm: 32, focusDist: 10, dof: null, panel });
    const legend = find(root, byClass('ops-hud__legend'));
    const camPanel = find(root, byClass('ops-hud__cam-panel'));
    const xray = find(root, byTestId('ops-hud-xray'));
    assert.ok(xray.classList.contains('ops-hud__xray--hidden'), 'xray starts hidden');
    btn('Legend: infrastructure hatch types')._listeners.click.forEach((fn) => fn());
    assert.ok(!legend.classList.contains('ops-hud__legend--hidden'), 'legend opens');
    h.update({ level: 'network', cam: cam(true) }); // twin opens camera → legend closes
    assert.ok(legend.classList.contains('ops-hud__legend--hidden'), 'camera panel evicts legend');
    assert.ok(!camPanel.classList.contains('ops-hud__cam-panel--hidden'), 'camera panel shows');
    h.update({ level: 'asset', cam: cam(true), xray: true });
    assert.ok(!xray.classList.contains('ops-hud__xray--hidden'), 'xray badge shows on focus');
    h.update({ level: 'network', cam: cam(false), xray: false });
    assert.ok(xray.classList.contains('ops-hud__xray--hidden'), 'xray badge hides on zoom-out');
    assert.equal(camToggles, 0, 'no cam toggle requested by update path');
    h.dispose();
  });
});
