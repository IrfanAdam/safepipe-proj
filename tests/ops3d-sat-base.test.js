import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(resolve(ROOT, 'src/ops3d/mapbox-base.js'), 'utf8');
const SCENE_SRC = readFileSync(resolve(ROOT, 'src/ops3d/scene.js'), 'utf8');

/* Minimal fake DOM for initMapboxBase (tokenless path only — no mapboxgl,
 * no network, no timers beyond guarded rAF/cancelAnimationFrame). */
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this._listeners = {};
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k];
  }
  appendChild(n) {
    n.parent = this;
    this.children.push(n);
    return n;
  }
  insertBefore(n, ref) {
    n.parent = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n);
    else this.children.splice(i, 0, n);
    return n;
  }
  remove() {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }
  addEventListener(t, fn) {
    (this._listeners[t] ??= []).push(fn);
  }
  querySelector(sel) {
    if (sel === 'canvas') return this._canvas ?? null;
    return null;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
}
const fakeDoc = {
  createElement: (t) => new FakeEl(t),
  createTextNode: (t) => ({ text: String(t), parent: null }),
  head: new FakeEl('head'),
};
const memStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
  };
};

let mb;
before(async () => {
  globalThis.document = fakeDoc;
  mb = await import('../src/ops3d/mapbox-base.js');
});
after(() => {
  delete globalThis.document;
});

describe('ops3d satellite base — mix range', () => {
  it('clampMix clamps [0,1], non-finite → 1 (today opaque)', () => {
    assert.equal(mb.clampMix(-0.5), 0);
    assert.equal(mb.clampMix(0), 0);
    assert.equal(mb.clampMix(0.37), 0.37);
    assert.equal(mb.clampMix(1), 1);
    assert.equal(mb.clampMix(2), 1);
    assert.equal(mb.clampMix(NaN), 1);
    assert.equal(mb.clampMix(undefined), 1);
    assert.equal(mb.clampMix('0.25'), 0.25);
  });

  it('scene.js setBaseMix/clampMix range (global fan-out, empty registry)', async () => {
    const scene = await import('../src/ops3d/scene.js');
    assert.equal(scene.clampMix(-1), 0);
    assert.equal(scene.clampMix(1.5), 1);
    assert.equal(scene.clampMix(NaN), 1);
    assert.equal(scene.setBaseMix(0.5), 0.5);
    assert.equal(scene.setBaseMix(9), 1);
    assert.equal(scene.setBaseMix(-3), 0);
  });

  it('scene.js createScene keeps its signature guard (canvas required)', async () => {
    const scene = await import('../src/ops3d/scene.js');
    assert.throws(() => scene.createScene(null), /canvas required/);
  });

  it('scene.js crossfade seam is additive: alpha, null-able bg, setBaseMix', () => {
    assert.ok(SCENE_SRC.includes('alpha: true'), 'renderer alpha:true');
    assert.ok(SCENE_SRC.includes('setBaseMix'), 'setBaseMix exported');
    assert.ok(SCENE_SRC.includes(': null'), 'background null-able');
    assert.ok(SCENE_SRC.includes('setClearColor(CLEAR_COLOR, 1)'), 'default opaque kept');
  });
});

describe('ops3d satellite base — token policy', () => {
  it('?mapboxToken= wins and persists to storage', () => {
    const st = memStore();
    const t = mb.resolveToken({ search: '?mapboxToken=pk.test123&view=TOP', storage: st });
    assert.equal(t, 'pk.test123');
    assert.equal(st.getItem('ops3d.mapboxToken'), 'pk.test123');
  });
  it('falls back to storage, then null (custom-only)', () => {
    const st = memStore();
    st.setItem('ops3d.mapboxToken', 'pk.stored');
    assert.equal(mb.resolveToken({ search: '', storage: st }), 'pk.stored');
    assert.equal(mb.resolveToken({ search: '', storage: memStore() }), null);
    assert.equal(mb.resolveToken({ search: '?mapboxToken=+++', storage: memStore() }), null);
  });
  it('never throws on malformed input / dead storage', () => {
    const dead = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    assert.equal(mb.resolveToken({ search: '%zz', storage: dead }), null);
    assert.equal(mb.resolveToken({}), null);
  });
  it('no secrets committed: source has no key literals, token via query/storage only', () => {
    assert.ok(!/pk\.eyJ[A-Za-z0-9_-]/.test(SRC), 'no pk.* key literal');
    assert.ok(!/sk\.[A-Za-z0-9]{8,}/.test(SRC), 'no sk.* key literal');
    assert.ok(SRC.includes('mapboxToken'), '?mapboxToken= supported');
    assert.ok(SRC.includes('localStorage') || SRC.includes('LS_TOKEN_KEY'), 'localStorage path');
  });
  it('silent failure policy: no console.error/warn in the module', () => {
    assert.ok(!SRC.includes('console.error'), 'no console.error');
    assert.ok(!SRC.includes('console.warn'), 'no console.warn');
  });
});

describe('ops3d satellite base — camera sync math (pure)', () => {
  it('top-down twin → flat map (pitch ≈ 0)', () => {
    const v = mb.twinViewToMapbox({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(Math.abs(v.pitch) < 1, `pitch ${v.pitch}`);
    assert.ok(v.bearing >= 0 && v.bearing < 360, `bearing ${v.bearing}`);
  });
  it('low-elevation twin → high map pitch; bearing tracks azimuth', () => {
    const v = mb.twinViewToMapbox({ x: 9, y: 1, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(v.pitch > 45 && v.pitch <= 70, `pitch ${v.pitch}`);
    assert.ok(Math.abs(v.bearing - 90) < 1, `bearing ${v.bearing}`);
  });
  it('zoom tracks orbit distance, clamped [10,16]', () => {
    const near = mb.twinViewToMapbox({ x: 0, y: 9, z: 0 }, { x: 0, y: 0, z: 0 });
    const far = mb.twinViewToMapbox({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(near.zoom > far.zoom, `near ${near.zoom} > far ${far.zoom}`);
    for (const v of [near, far]) assert.ok(v.zoom >= 10 && v.zoom <= 16, `zoom ${v.zoom}`);
    const huge = mb.twinViewToMapbox({ x: 0, y: 900, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.equal(huge.zoom, 10);
  });
});

describe('ops3d satellite base — tokenless fallback (fake DOM)', () => {
  it('mounts behind-layer + offline tag + xfade bar, custom-only', () => {
    const container = new FakeEl('div');
    const st = memStore();
    const api = mb.initMapboxBase(container, { search: '', storage: st, getTwin: () => null });
    assert.equal(api.available, false);
    const base = container.children.find((c) => c.className === 'sat-base');
    assert.ok(base, 'sat-base behind layer mounted first');
    assert.equal(container.children[0], base);
    const tag = base.children.find((c) => c.className === 'sat-base__tag');
    assert.ok(tag && tag.textContent.includes('CUSTOM TWIN'), 'offline tag');
    const bar = container.children.find((c) => c.className === 'sat-xfade');
    assert.ok(bar, 'single crossfade control, no popover');
    const btns = bar.children.filter((c) => c.tagName === 'BUTTON');
    assert.equal(btns.length, 2, 'SAT + TWIN buttons');
    assert.ok(bar.children.some((c) => c.tagName === 'INPUT'), 'slider present');
    api.dispose();
    assert.ok(!container.children.includes(base), 'dispose removes base');
    assert.ok(!container.children.includes(bar), 'dispose removes bar');
  });

  it('setMix clamps and fades the canvas element (post-chain safe)', () => {
    const container = new FakeEl('div');
    const canvas = new FakeEl('canvas');
    container._canvas = canvas;
    const api = mb.initMapboxBase(container, { search: '', storage: memStore(), getTwin: () => null });
    assert.equal(api.setMix(0.4), 0.4);
    assert.equal(canvas.style.opacity, '0.4');
    assert.equal(api.setMix(9), 1);
    assert.equal(canvas.style.opacity, '', 'opaque restores default (identical to today)');
    assert.equal(api.setMix(-2), 0);
    assert.equal(canvas.style.position, 'relative', 'canvas pinned above base');
    assert.equal(canvas.style.zIndex, '1');
    api.dispose();
  });

  it('syncFromTwin is a safe no-op without a map (never breaks the loop)', () => {
    const container = new FakeEl('div');
    const api = mb.initMapboxBase(container, { search: '', storage: memStore(), getTwin: () => null });
    assert.doesNotReject(async () => api.syncFromTwin());
    api.syncFromTwin();
    assert.equal(typeof api.fadeTo(1), 'number');
    api.dispose();
  });
});
