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
const TERRAIN_SRC = readFileSync(resolve(ROOT, 'src/ops3d/terrain.js'), 'utf8');
const TWIN_SRC = readFileSync(resolve(ROOT, 'src/ops3d/twin.js'), 'utf8');
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
  it('low-elevation twin → high map pitch; mirrored bearing tracks azimuth', () => {
    const v = sat.twinViewToMap({ x: 9, y: 1, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(v.pitch > 45 && v.pitch <= 70, `pitch ${v.pitch}`);
    // Twin +x runs opposite map east: bearing is mirrored (270, not 90).
    assert.ok(Math.abs(v.bearing - 270) < 1, `bearing ${v.bearing}`);
  });
  it('zoom tracks orbit distance, clamped [8.5,16]', () => {
    const near = sat.twinViewToMap({ x: 0, y: 9, z: 0 }, { x: 0, y: 0, z: 0 });
    const far = sat.twinViewToMap({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(near.zoom > far.zoom, `near ${near.zoom} > far ${far.zoom}`);
    for (const v of [near, far]) assert.ok(v.zoom >= 8.5 && v.zoom <= 16, `zoom ${v.zoom}`);
    const huge = sat.twinViewToMap({ x: 0, y: 900, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.equal(huge.zoom, 8.5);
  });
  it('legacy twinViewToMapbox alias is the same function', () => {
    assert.equal(sat.twinViewToMapbox, sat.twinViewToMap);
  });
  it('center follows the orbit target (pan parity, +x east / +z south)', () => {
    const c0 = sat.twinViewToMap({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 }).center;
    assert.ok(Math.abs(c0.lat - 57.03) < 1e-9 && Math.abs(c0.lon + 111.68) < 1e-9, `origin ${c0.lat},${c0.lon}`);
    const t = sat.twinTargetToLatLon({ x: 22, z: 0 });
    assert.ok(t.lon > -111.68 && t.lat === 57.03, `east ${t.lon}`);
    assert.ok(Math.abs(t.lon + 111.68 - 22 / (111.32 * Math.cos((57.03 * Math.PI) / 180))) < 1e-9, 'equirectangular lon');
    const s = sat.twinTargetToLatLon({ x: 0, z: 11.132 });
    assert.ok(s.lat < 57.03 && Math.abs(s.lat - (57.03 - 0.1)) < 1e-9, `south ${s.lat}`);
    const panned = sat.twinViewToMap({ x: 5, y: 62, z: -8 }, { x: 5, y: 0, z: -8 }).center;
    assert.ok(panned.lon > -111.68 && panned.lat > 57.03, `pan tracks ${panned.lat},${panned.lon}`);
  });
  it('zoom holds ground scale (512-px convention: TOP 40 km span ≈ z9.7)', () => {
    const top = sat.twinViewToMap({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(top.zoom > 9.5 && top.zoom < 10.0, `TOP zoom ${top.zoom}`);
    const near = sat.twinViewToMap({ x: 0, y: 9, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(near.zoom > 12.3 && near.zoom < 12.8, `segment zoom ${near.zoom}`);
  });
  it('oblique views keep dist/fov zoom (no slant factor, pitch handles tilt)', () => {
    const tgt = { x: 0, y: 0, z: 0 };
    const top = sat.twinViewToMap({ x: 0, y: 30, z: 0.1 }, tgt);
    const iso = sat.twinViewToMap({ x: 0, y: 30 * Math.sin((25 * Math.PI) / 180), z: 30 * Math.cos((25 * Math.PI) / 180) }, tgt);
    assert.ok(Math.abs(iso.zoom - top.zoom) < 0.01, `iso ${iso.zoom} vs top ${top.zoom}`);
    assert.ok(iso.zoom >= 8.5, 'still clamped');
  });
  it('natural satellite colors: no dimming or tinted hillshade (thermal look)', () => {
    assert.ok(!SRC.includes('raster-brightness-max'), 'no brightness dimming');
    assert.ok(!SRC.includes('raster-saturation'), 'no saturation shift');
    assert.ok(!SRC.includes('raster-contrast'), 'no contrast shift');
    assert.ok(!SRC.includes('hillshade-shadow-color'), 'no tinted shadows');
    assert.ok(!SRC.includes('hillshade-highlight-color'), 'no tinted highlights');
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
    const tag = base.children.find((c) => c.className === 'sat-base__tag' && c.textContent.includes('CUSTOM TWIN'));
    assert.ok(tag, 'offline tag');
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

  it('scopeRadiusForSite scales the TOP disc by site window', () => {
    assert.equal(sat.scopeRadiusForSite({}), 20, 'no extent → Fort McMurray disc');
    assert.equal(sat.scopeRadiusForSite({ extentKm: 44 }), 20);
    assert.ok(Math.abs(sat.scopeRadiusForSite({ extentKm: 20 }) - (20 * 20) / 44) < 1e-9, 'Sangachal ≈ 9.09 km');
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

  it('mix gating: full-TWIN retires the lens (no photo bleed over pure twin)', () => {
    assert.equal(sat.shouldShowScope({ scopeOn: true, level: 'network', mix: 1 }), false);
    assert.equal(sat.shouldShowScope({ scopeOn: true, level: 'network', mix: 0.999 }), false);
    assert.equal(sat.shouldShowScope({ scopeOn: true, level: 'network', mix: 0.9 }), true);
    assert.equal(sat.shouldShowScope({ scopeOn: true, level: 'network', mix: 0 }), true);
    assert.equal(sat.shouldShowScope({ scopeOn: true, level: 'network' }), true, 'mix defaults to SAT-side (shown)');
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
    // Throwing override + far camera → network heuristic → shown (SAT-side
    // mix so the full-TWIN lens stand-down doesn't apply).
    const c1 = sized();
    const a1 = sat.initSatBase(c1, {
      search: '?sat=0',
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

describe('ops3d satellite base — site parametrization (?site= / opts.site)', () => {
  it('twinTargetToLatLon honors an explicit site (southern hemisphere)', () => {
    const site = { lat: -23.95, lon: -46.63 };
    const c = sat.twinTargetToLatLon({ x: 0, z: 0 }, site);
    assert.ok(Math.abs(c.lat + 23.95) < 1e-9 && Math.abs(c.lon + 46.63) < 1e-9, `origin ${c.lat},${c.lon}`);
    const e = sat.twinTargetToLatLon({ x: 11.132 * Math.cos((-23.95 * Math.PI) / 180), z: 0 }, site);
    assert.ok(Math.abs(e.lon - (-46.63 + 0.1)) < 1e-9, `east ${e.lon}`);
  });

  it('twinViewToMap centers on view.site, defaults to the pin', () => {
    const site = { lat: -23.95, lon: -46.63 };
    const v = sat.twinViewToMap({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 }, { site });
    assert.ok(Math.abs(v.center.lat + 23.95) < 1e-6 && Math.abs(v.center.lon + 46.63) < 1e-6, `site center ${v.center.lat},${v.center.lon}`);
    const d = sat.twinViewToMap({ x: 0, y: 62, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(Math.abs(d.center.lat - 57.03) < 1e-9 && Math.abs(d.center.lon + 111.68) < 1e-9, 'default pin unchanged');
  });
});

describe('ops3d maplibre-terrain redo — real ground, ground seam, showcase', () => {
  it('3D terrain exaggeration equals the twin VEX (overlays drape at VEX heights)', () => {
    const m = TERRAIN_SRC.match(/export const VEX = ([\d.]+)/);
    assert.ok(m, 'terrain.js exports VEX');
    assert.equal(sat.TERRAIN_EXAGGERATION, Number(m[1]), `exaggeration ${sat.TERRAIN_EXAGGERATION} vs VEX ${m[1]}`);
    assert.ok(SRC.includes('exaggeration: TERRAIN_EXAGGERATION'), 'moodMap uses the shared constant');
    assert.ok(SRC.includes('setSky'), 'atmosphere sky at oblique angles');
  });

  it('reference overlay: keyless Esri places/roads over the imagery, attributed', () => {
    assert.ok(SRC.includes('Reference/World_Boundaries_and_Places'), 'Esri reference tiles');
    assert.ok(SRC.includes("'sat-ref'") || SRC.includes('"sat-ref"'), 'sat-ref layer');
    assert.ok(SRC.includes('HERE, Garmin, OpenStreetMap'), 'reference attribution');
    assert.ok(!SRC.includes('mapbox-gl') && !SRC.includes('api.mapbox.com'), 'still tokenless, no mapbox');
  });

  it('cinematic crossfade: ~1000 ms ease, not a layer snap', () => {
    assert.ok(SRC.includes('(now - t0) / 1000'), 'fade duration 1000 ms');
  });

  it('showcase decision: first visit at TOP only; any choice retires it', () => {
    assert.equal(sat.shouldAutoShowcase({ hasParam: false, hasStored: false, level: 'network' }), true);
    assert.equal(sat.shouldAutoShowcase({ hasParam: true, hasStored: false, level: 'network' }), false);
    assert.equal(sat.shouldAutoShowcase({ hasParam: false, hasStored: true, level: 'network' }), false);
    assert.equal(sat.shouldAutoShowcase({ hasParam: false, hasStored: false, level: 'segment' }), false);
    assert.equal(sat.shouldAutoShowcase({}), true, 'defaults read as first-visit TOP');
    assert.equal(sat.shouldAutoShowcase(), true);
  });

  it('twin exposes the ground-ownership seam (twin renders overlays only on SAT)', () => {
    assert.ok(TWIN_SRC.includes('setTerrainMode'), 'twin.setTerrainMode exists');
    assert.ok(TWIN_SRC.includes("terrainMode: 'twin'"), 'default twin (today unchanged)');
    assert.ok(TWIN_SRC.includes('maplibre'), 'maplibre mode hides the synthetic mesh');
  });

  it('crossfade drives ground ownership; missing seam never throws (fake DOM)', () => {
    const calls = [];
    const twin = { setTerrainMode: (m) => { calls.push(m); return m; } };
    const container = new FakeEl('div');
    container._canvas = new FakeEl('canvas');
    const api = sat.initSatBase(container, { search: '?sat=1', storage: memStore(), getTwin: () => twin });
    assert.deepEqual(calls, ['twin'], 'seed at TWIN keeps the custom ground');
    api.setMix(0);
    assert.equal(calls[calls.length - 1], 'maplibre', 'SAT yields the ground to MapLibre');
    api.setMix(1);
    assert.equal(calls[calls.length - 1], 'twin', 'TWIN restores the custom ground');
    api.dispose();
    // No seam at all: silent no-op, twin untouched.
    const c2 = new FakeEl('div');
    c2._canvas = new FakeEl('canvas');
    const api2 = sat.initSatBase(c2, { search: '', storage: memStore(), getTwin: () => ({}) });
    assert.doesNotThrow(() => api2.setMix(0));
    api2.dispose();
  });

  it('late map load clears a stale watchdog offline tag', () => {
    assert.ok(
      SRC.includes('[data-testid="sat-base-tag"]') && SRC.includes('.remove()'),
      'load handler drops the offline tag so live maps never read OFFLINE',
    );
  });

  it('scope lens stands down at full TWIN (no photo bleed), returns mid-fade', () => {
    const calls = [];
    const twin = {
      setTerrainMode: (m) => { calls.push(m); return m; },
      debug: {
        camera: { position: { x: 0.8, y: 57, z: 12 }, fov: 50 },
        target: () => ({ x: 0, y: 0, z: 0 }),
      },
    };
    const container = new FakeEl('div');
    container.clientWidth = 1280;
    container.clientHeight = 800;
    container._canvas = new FakeEl('canvas');
    const api = sat.initSatBase(container, { search: '?sat=1', storage: memStore(), getTwin: () => twin });
    api.setScope(true);
    api.syncFromTwin();
    assert.equal(api.scopeShown, false, 'no lens over pure twin even when toggled on');
    api.setMix(0.7);
    api.syncFromTwin(true);
    assert.equal(api.scopeShown, true, 'lens returns mid-fade');
    assert.equal(calls[calls.length - 1], 'twin', 'mesh stays up while the lens is punched');
    api.setMix(0.2);
    assert.equal(calls[calls.length - 1], 'maplibre', 'SAT still yields to MapLibre');
    api.dispose();
  });

  it('DEM-remount heals the crossfade when the twin canvas element swaps', () => {
    const calls = [];
    const twin = { setTerrainMode: (m) => { calls.push(m); return m; } };
    const container = new FakeEl('div');
    container._canvas = new FakeEl('canvas');
    const api = sat.initSatBase(container, { search: '?sat=0', storage: memStore(), getTwin: () => twin });
    assert.equal(container._canvas.style.opacity, '0', 'seed hides the twin canvas');
    // DEM staged swap-in replaces the canvas: fresh element, no opacity.
    container._canvas = new FakeEl('canvas');
    api.syncFromTwin();
    assert.equal(container._canvas.style.opacity, '0', 'mix re-applied after remount');
    assert.equal(calls[calls.length - 1], 'maplibre', 'ground still yielded to MapLibre');
    api.dispose();
  });
});
