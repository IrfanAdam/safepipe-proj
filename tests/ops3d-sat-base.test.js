import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(resolve(ROOT, 'src/ops3d/sat-base.js'), 'utf8');
const ADAPTER_SRC = readFileSync(resolve(ROOT, 'src/ops3d/mapbox-base.js'), 'utf8');
const MAIN_SRC = readFileSync(resolve(ROOT, 'src/ops3d/main.js'), 'utf8');
const HTML_SRC = readFileSync(resolve(ROOT, 'ops3d.html'), 'utf8');
const SCENE_SRC = readFileSync(resolve(ROOT, 'src/ops3d/scene.js'), 'utf8');
const PKG = readFileSync(resolve(ROOT, 'package.json'), 'utf8');

/* Minimal fake DOM for initSatBase (offline path only — no maplibre,
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
    if (String(sel).startsWith('canvas')) return this._canvas ?? null;
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
const tick = () => new Promise((r) => setImmediate(r));

let sat;
before(async () => {
  globalThis.document = fakeDoc;
  sat = await import('../src/ops3d/sat-base.js');
});
after(() => {
  delete globalThis.document;
});

describe('ops3d satellite base — mix range', () => {
  it('clampMix clamps [0,1], non-finite → 1 (today opaque)', () => {
    assert.equal(sat.clampMix(-0.5), 0);
    assert.equal(sat.clampMix(0), 0);
    assert.equal(sat.clampMix(0.37), 0.37);
    assert.equal(sat.clampMix(1), 1);
    assert.equal(sat.clampMix(2), 1);
    assert.equal(sat.clampMix(NaN), 1);
    assert.equal(sat.clampMix(undefined), 1);
    assert.equal(sat.clampMix('0.25'), 0.25);
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

describe('ops3d satellite base — tokenless by design, no mapbox', () => {
  it('no mapbox imports/endpoints anywhere in the base path', () => {
    for (const [name, src] of [
      ['sat-base.js', SRC],
      ['mapbox-base.js (adapter)', ADAPTER_SRC],
      ['main.js', MAIN_SRC],
      ['ops3d.html', HTML_SRC],
    ]) {
      assert.ok(!src.includes('mapbox-gl'), `${name}: no mapbox-gl`);
      assert.ok(!src.includes('api.mapbox.com'), `${name}: no api.mapbox.com`);
      assert.ok(!src.includes('mapbox://'), `${name}: no mapbox:// style URL`);
      assert.ok(!src.includes('mapboxgl'), `${name}: no mapboxgl global`);
      assert.ok(!src.includes('mapboxToken'), `${name}: no ?mapboxToken=`);
      assert.ok(!src.includes('accessToken'), `${name}: no accessToken`);
    }
    assert.ok(!PKG.includes('mapbox'), 'package.json: no mapbox dependency');
  });

  it('no token surface: token helpers gone, no key literals', () => {
    assert.equal(sat.resolveToken, undefined, 'resolveToken removed');
    assert.equal(sat.LS_TOKEN_KEY, undefined, 'LS_TOKEN_KEY removed');
    assert.ok(!/pk\.eyJ[A-Za-z0-9_-]/.test(SRC), 'no pk.* key literal');
    assert.ok(!/sk\.[A-Za-z0-9]{8,}/.test(SRC), 'no sk.* key literal');
    assert.ok(!/["']pk\.[^"']*["']/.test(SRC), 'no pk.* string at all');
  });

  it('silent failure policy: no console.error/warn in the module', () => {
    assert.ok(!SRC.includes('console.error'), 'no console.error');
    assert.ok(!SRC.includes('console.warn'), 'no console.warn');
  });

  it('open-source tile sources: maplibre CDN + Esri + Terrarium, attributed', () => {
    assert.ok(SRC.includes('maplibre-gl'), 'maplibre-gl CDN');
    assert.ok(SRC.includes('server.arcgisonline.com/ArcGIS/rest/services/World_Imagery'), 'Esri World Imagery XYZ');
    assert.ok(SRC.includes('elevation-tiles-prod/terrarium'), 'AWS Terrarium terrain');
    assert.ok(SRC.includes("encoding: 'terrarium'") || SRC.includes('encoding:"terrarium"'), 'terrarium decoding');
    assert.ok(SRC.includes('hillshade'), 'hillshade layer');
    assert.ok(SRC.includes('setTerrain'), '3D terrain');
    assert.ok(SRC.includes('Esri'), 'Esri attribution');
    assert.ok(SRC.includes('TILE_ATTRIBUTION'), 'attribution exported');
    assert.ok(SRC.includes('57.03') && SRC.includes('-111.68'), 'site 57.03N 111.68W kept');
  });

  it('adapter keeps old imports working (same fns, zero edits)', async () => {
    const adapter = await import('../src/ops3d/mapbox-base.js');
    assert.equal(adapter.initMapboxBase, sat.initSatBase, 'initMapboxBase alias');
    assert.equal(adapter.initSatBase, sat.initSatBase, 'initSatBase re-export');
    assert.equal(adapter.twinViewToMapbox, sat.twinViewToMap, 'legacy math alias');
    assert.deepEqual(adapter.SITE, { lat: 57.03, lon: -111.68 }, 'SITE preserved');
  });
});

describe('ops3d satellite base — camera sync math (pure)', () => {
  it('top-down twin → flat map (pitch ≈ 0)', () => {
    const v = sat.twinViewToMap({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(Math.abs(v.pitch) < 1, `pitch ${v.pitch}`);
    assert.ok(v.bearing >= 0 && v.bearing < 360, `bearing ${v.bearing}`);
  });
  it('low-elevation twin → high map pitch; bearing tracks azimuth', () => {
    const v = sat.twinViewToMap({ x: 9, y: 1, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(v.pitch > 45 && v.pitch <= 70, `pitch ${v.pitch}`);
    assert.ok(Math.abs(v.bearing - 90) < 1, `bearing ${v.bearing}`);
  });
  it('zoom tracks orbit distance, clamped [10,16]', () => {
    const near = sat.twinViewToMap({ x: 0, y: 9, z: 0 }, { x: 0, y: 0, z: 0 });
    const far = sat.twinViewToMap({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(near.zoom > far.zoom, `near ${near.zoom} > far ${far.zoom}`);
    for (const v of [near, far]) assert.ok(v.zoom >= 10 && v.zoom <= 16, `zoom ${v.zoom}`);
    const huge = sat.twinViewToMap({ x: 0, y: 900, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.equal(huge.zoom, 10);
  });
  it('legacy twinViewToMapbox alias is the same function', () => {
    assert.equal(sat.twinViewToMapbox, sat.twinViewToMap);
  });
});

describe('ops3d satellite base — offline fallback (fake DOM)', () => {
  it('mounts behind-layer + xfade bar, custom-only, offline tag', async () => {
    const container = new FakeEl('div');
    const st = memStore();
    const api = sat.initSatBase(container, { search: '', storage: st, getTwin: () => null });
    assert.equal(api.available, false);
    assert.equal(api.degraded, false);
    const base = container.children.find((c) => c.className === 'sat-base');
    assert.ok(base, 'sat-base behind layer mounted first');
    assert.equal(container.children[0], base);
    await tick();
    const tag = base.children.find((c) => c.className === 'sat-base__tag');
    assert.ok(tag && tag.textContent.includes('CUSTOM TWIN'), 'offline tag');
    const bar = container.children.find((c) => c.className === 'sat-xfade');
    assert.ok(bar, 'single crossfade control, no popover');
    const btns = bar.children.filter((c) => c.tagName === 'BUTTON');
    assert.equal(btns.length, 3, 'SAT + TWIN + SCOPE buttons');
    const scopeChip = btns.find((b) => b.attributes['data-testid'] === 'sat-scope');
    assert.ok(scopeChip, 'SCOPE monitor chip present');
    assert.equal(scopeChip.attributes['aria-pressed'], 'false', 'scope default OFF');
    assert.ok(bar.children.some((c) => c.tagName === 'INPUT'), 'slider present');
    api.dispose();
    assert.ok(!container.children.includes(base), 'dispose removes base');
    assert.ok(!container.children.includes(bar), 'dispose removes bar');
  });

  it('setMix clamps and fades the canvas element (post-chain safe)', () => {
    const container = new FakeEl('div');
    const canvas = new FakeEl('canvas');
    container._canvas = canvas;
    const api = sat.initSatBase(container, { search: '', storage: memStore(), getTwin: () => null });
    assert.equal(api.setMix(0.4), 0.4);
    assert.equal(canvas.style.opacity, '0.4');
    assert.equal(api.setMix(9), 1);
    assert.equal(canvas.style.opacity, '', 'opaque restores default (identical to today)');
    assert.equal(api.setMix(-2), 0);
    assert.equal(canvas.style.position, 'relative', 'canvas pinned above base');
    assert.equal(canvas.style.zIndex, '1');
    api.dispose();
  });

  it('?sat= / ?mix= seed the crossfade, persisted to storage', () => {
    const c1 = new FakeEl('div');
    const api1 = sat.initSatBase(c1, { search: '?sat=0', storage: memStore(), getTwin: () => null });
    assert.equal(api1.mix, 0);
    api1.dispose();
    const st = memStore();
    const c2 = new FakeEl('div');
    const api2 = sat.initSatBase(c2, { search: '', storage: st, getTwin: () => null });
    api2.setMix(0.5);
    assert.equal(st.getItem('ops3d.satMix'), '0.5');
    const c3 = new FakeEl('div');
    const api3 = sat.initSatBase(c3, { search: '', storage: st, getTwin: () => null });
    assert.equal(api3.mix, 0.5, 'mix restored from storage');
    api2.dispose();
    api3.dispose();
  });

  it('syncFromTwin is a safe no-op without a map (never breaks the loop)', () => {
    const container = new FakeEl('div');
    const api = sat.initSatBase(container, { search: '', storage: memStore(), getTwin: () => null });
    assert.doesNotReject(async () => api.syncFromTwin());
    api.syncFromTwin();
    assert.equal(typeof api.fadeTo(1), 'number');
    api.dispose();
  });
});

describe('ops3d satellite monitor — clip math (pure)', () => {
  it('SCOPE_R_KM matches the mapped circle (20 km)', () => {
    assert.equal(sat.SCOPE_R_KM, 20);
  });

  it('projectPinhole centers the look target', () => {
    const s = sat.projectPinhole(
      { x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 }, 40, 1440, 900, { x: 0, y: 0, z: 0 },
    );
    assert.ok(Math.abs(s.x - 720) < 1, `x ${s.x}`);
    assert.ok(Math.abs(s.y - 450) < 1, `y ${s.y}`);
  });

  it('projectPinhole returns null behind the camera', () => {
    const s = sat.projectPinhole(
      { x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 }, 40, 1440, 900, { x: 0, y: 200, z: 0 },
    );
    assert.equal(s, null);
  });

  it('rimCirclePx: top-down TOP view yields a centered disc', () => {
    const d = sat.rimCirclePx({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 }, 40, 1440, 900);
    assert.ok(d, 'disc computed');
    assert.ok(Math.abs(d.cx - 720) < 2, `cx ${d.cx}`);
    assert.ok(Math.abs(d.cy - 450) < 2, `cy ${d.cy}`);
    assert.ok(d.r > 300 && d.r < 700, `r ${d.r}`);
  });

  it('rimCirclePx: null on degenerate input', () => {
    assert.equal(sat.rimCirclePx({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 }, 40, 0, 900), null);
    assert.equal(sat.rimCirclePx({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 40, 1440, 900), null);
    assert.equal(sat.rimCirclePx({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 }, 40, 1440, 900, 0), null);
  });

  it('scopeClipCss/scopeMaskCss confine imagery to the disc', () => {
    assert.equal(sat.scopeClipCss(720, 450, 398.5), 'circle(398.5px at 720px 450px)');
    const m = sat.scopeMaskCss(720, 450, 398.5);
    assert.ok(m.includes('rgba(0,0,0,0)'), 'transparent inside');
    assert.ok(m.includes('#000'), 'opaque outside');
    assert.ok(m.includes('398.5px'), 'same radius');
  });

  it('level gating: overlay shows at network/TOP only', () => {
    assert.equal(sat.isNetworkLevel('network'), true);
    for (const l of ['segment', 'asset', '', null, undefined]) {
      assert.equal(sat.isNetworkLevel(l), false, `level ${l}`);
    }
    assert.equal(sat.shouldShowScope({ scopeOn: true, level: 'network' }), true);
    assert.equal(sat.shouldShowScope({ scopeOn: true, level: 'segment' }), false);
    assert.equal(sat.shouldShowScope({ scopeOn: true, level: 'asset' }), false);
    assert.equal(sat.shouldShowScope({ scopeOn: false, level: 'network' }), false);
  });
});

describe('ops3d satellite monitor — toggle wiring + fallback (fake DOM)', () => {
  const twinFar = () => ({
    debug: {
      camera: { position: { x: 0, y: 62, z: 0 }, fov: 40 },
      target: () => ({ x: 0, y: 0, z: 0 }),
    },
  });
  const sized = () => {
    const c = new FakeEl('div');
    c.clientWidth = 1440;
    c.clientHeight = 900;
    c._canvas = new FakeEl('canvas');
    return c;
  };

  it('?scope=1 seeds ON and persists; hidden without a sized container, never throws', () => {
    const st = memStore();
    const c1 = new FakeEl('div');
    const api1 = sat.initSatBase(c1, { search: '?scope=1', storage: st, getTwin: () => null });
    assert.equal(api1.scope, true);
    assert.equal(api1.scopeShown, false, 'no container size → hidden, never throws');
    api1.setScope(false);
    assert.equal(api1.scope, false);
    assert.equal(st.getItem('ops3d.satScope'), '0');
    const c2 = new FakeEl('div');
    const api2 = sat.initSatBase(c2, { search: '', storage: st, getTwin: () => null });
    assert.equal(api2.scope, false, 'choice restored from storage (default OFF)');
    api1.dispose();
    api2.dispose();
  });

  it('armed at TOP paints the disc; drill-in hides it and restores the mix', () => {
    let level = 'network';
    const container = sized();
    const api = sat.initSatBase(container, {
      search: '',
      storage: memStore(),
      getTwin: twinFar,
      getLevel: () => level,
    });
    api.setMix(0.4);
    assert.equal(api.setScope(true), true);
    assert.equal(api.scopeShown, true, 'shown at TOP');
    const base = container.children.find((c) => c.className === 'sat-base');
    assert.ok(base.style.clipPath.startsWith('circle('), `clip ${base.style.clipPath}`);
    assert.ok(container._canvas.style.maskImage.includes('radial-gradient'), 'canvas punched');
    // Drill-in: overlay auto-hides, user mix restored untouched.
    level = 'segment';
    api.syncFromTwin(true);
    assert.equal(api.scopeShown, false, 'hidden on drill-in');
    assert.equal(base.style.clipPath, '', 'clip cleared');
    assert.equal(container._canvas.style.maskImage, '', 'mask cleared');
    assert.equal(container._canvas.style.opacity, '0.4', 'user mix restored');
    const chip = container.children
      .find((c) => c.className === 'sat-xfade')
      .children.find((c) => c.attributes?.['data-testid'] === 'sat-scope');
    assert.equal(chip.attributes['data-gated'], 'true', 'chip dims while gated');
    api.dispose();
  });

  it('level resolution falls back through HUD-less, throwing, and distance paths', () => {
    // Throwing override + far camera → network heuristic → shown.
    const c1 = sized();
    const a1 = sat.initSatBase(c1, {
      search: '',
      storage: memStore(),
      getTwin: twinFar,
      getLevel: () => {
        throw new Error('hud gone');
      },
    });
    a1.setScope(true);
    assert.equal(a1.scopeShown, true, 'distance heuristic keeps TOP');
    a1.dispose();
    // Close camera (drill-in distance) with no override → hidden.
    const c2 = sized();
    const near = () => ({
      debug: {
        camera: { position: { x: 0, y: 3, z: 0 }, fov: 40 },
        target: () => ({ x: 0, y: 0, z: 0 }),
      },
    });
    const a2 = sat.initSatBase(c2, { search: '', storage: memStore(), getTwin: near });
    a2.setScope(true);
    assert.equal(a2.scopeShown, false, 'close camera reads as drilled-in');
    a2.dispose();
  });
});
