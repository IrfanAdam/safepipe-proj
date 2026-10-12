// tests/ring2-twin-freshu.test.js — twin-side u must ride the per-frame camera clock.
// updateForCamera's else branch (canvas identity unchanged: the steady-state
// per-frame path from main.js) used to refresh ONLY the satellite side
// (applyGroundRule -> setGroundFade) while the twin side (applyEmphasis +
// setTakeover) stayed frozen at whatever the last full reapply computed.
// Live symptom: FAR state (range 32000, zenith pitch 0, fresh-u 0) still
// showed twin ground op 1 + schematic emphasis left over from a previous
// CLOSE grazing pass. These tests fail on that code (RED) and pass once the
// else branch refreshes applyEmphasis(max(effMix/100, effUNow())) +
// setTakeover(effUNow()) alongside the ground rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);

/* Minimal DOM stubs — just enough for mountMixBar (createElement, slider/val
 * selectors, end buttons, MutationObserver, localStorage). No layout. */
globalThis.localStorage ??= {
  _s: {},
  getItem(k) { return this._s[k] ?? null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};
globalThis.MutationObserver ??= class {
  constructor(_cb) {}
  observe() {}
  disconnect() {}
};
const mkBar = () => {
  const slider = { value: '50', addEventListener() {} };
  const val = { textContent: '' };
  const btn = () => ({ addEventListener() {} });
  return {
    className: '',
    dataset: {},
    slider,
    querySelector(sel) {
      if (sel.includes('slider')) return slider;
      if (sel.includes('val')) return val;
      return btn();
    },
    setAttribute() {},
    appendChild() {},
    remove() {},
  };
};
globalThis.document ??= {
  createElement: () => mkBar(),
  querySelector: () => null,
};

const { takeoverU, gatePureSatEndpoint } = await import('../src/ring2/takeover.js');
const { tiltU } = await import('../src/ring2/sync.js');
const { mountMixBar } = await import('../src/ring2/mix.js');

/* Mount the mix control at slider 0 with a live (truthy) map so the
 * pre-map dead-end floor stays out of the way (effMix === mix === 0) and a
 * stable twin canvas so updateForCamera always takes the else branch. */
function mountAtSat(spies = {}) {
  const emphasis = [];
  const takeover = [];
  const canvas = { style: {} };
  const container = { appendChild() {} };
  const ctl = mountMixBar(container, {
    getTwinCanvas: () => canvas,
    getTwinContainer: () => container,
    getMap: () => ({ fake: true }),
    applyEmphasis: (t) => { emphasis.push(t); spies.onEmphasis?.(t); },
    setTakeover: (u) => { takeover.push(u); spies.onTakeover?.(u); },
    getPitchDeg: () => 0,
    getRangeM: () => 32000,
    initial: 0,
  });
  return { ctl, emphasis, takeover };
}

test('pure law: raw fresh u still 1 steep+close, but the SAT endpoint gates it to 0', () => {
  assert.equal(Math.max(takeoverU(0), tiltU(65, 1500)), 1, 'raw merge still takes steep+close');
  assert.equal(Math.max(takeoverU(0), tiltU(0, 32000)), 0, 'zenith far stays satellite');
  assert.equal(gatePureSatEndpoint(0, 1), 0, 'mix 0 pins the merged u to 0 (pure satellite)');
  assert.equal(gatePureSatEndpoint(50, 0.5), 0.5, 'mix 50 passes the merged u through untouched');
});

test('twin side follows a simulated dive — except at mix 0, where the SAT endpoint holds', () => {
  const { ctl, emphasis, takeover } = mountAtSat();
  assert.equal(emphasis.at(-1), 0, 'mount FAR: emphasis starts at 0');
  assert.equal(takeover.at(-1), 0, 'mount FAR: takeover starts at 0');
  // CLOSE grazing pass at mix 0 — the pure-satellite endpoint holds: tilt
  // can no longer relight emphasis or twin ground over the bare photo.
  ctl.updateForCamera(65, 1500);
  assert.equal(emphasis.at(-1), 0, 'CLOSE grazing at mix 0: emphasis stays 0');
  assert.equal(takeover.at(-1), 0, 'CLOSE grazing at mix 0: takeover stays 0');
  // Back out to FAR — still 0.
  ctl.updateForCamera(0, 32000);
  assert.equal(emphasis.at(-1), 0, 'FAR return: emphasis stays 0');
  assert.equal(takeover.at(-1), 0, 'FAR return: takeover stays 0');
  // Same dive at mix 50 — the band still rides fresh u.
  ctl.setMix(50);
  ctl.updateForCamera(65, 1500);
  const fresh = Math.max(takeoverU(50), tiltU(65, 1500));
  assert.ok(Math.abs(emphasis.at(-1) - Math.max(0.5, fresh)) < 1e-12, `mix-50 dive: emphasis rides max(0.5, u) (got ${emphasis.at(-1)})`);
  assert.ok(Math.abs(takeover.at(-1) - fresh) < 1e-12, `mix-50 dive: takeover rides u (got ${takeover.at(-1)})`);
});

test('twin side mid-ramp follows fresh u (no sticking at endpoints)', () => {
  const { ctl, emphasis, takeover } = mountAtSat();
  ctl.setMix(50);
  ctl.updateForCamera(62.5, 6500);
  const fresh = Math.max(takeoverU(50), tiltU(62.5, 6500));
  assert.ok(fresh > 0 && fresh < 1, `mid state must be genuinely mid (got ${fresh})`);
  assert.ok(Math.abs(emphasis.at(-1) - Math.max(0.5, fresh)) < 1e-12, `emphasis must equal max(0.5, u) (got ${emphasis.at(-1)}, want ${Math.max(0.5, fresh)})`);
  assert.ok(Math.abs(takeover.at(-1) - fresh) < 1e-12, `takeover must equal fresh u (got ${takeover.at(-1)}, want ${fresh})`);
});
