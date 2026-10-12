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

const { takeoverU } = await import('../src/ring2/takeover.js');
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

test('pure law: fresh u is 1 steep+close, 0 top-down far at mix 0', () => {
  assert.equal(Math.max(takeoverU(0), tiltU(65, 1500)), 1, 'steep+close must take over at mix 0');
  assert.equal(Math.max(takeoverU(0), tiltU(0, 32000)), 0, 'zenith far must stay satellite at mix 0');
});

test('twin side follows a simulated dive: lastT-equivalent tracks fresh u per frame', () => {
  const { ctl, emphasis, takeover } = mountAtSat();
  assert.equal(emphasis.at(-1), 0, 'mount FAR: emphasis starts at 0');
  assert.equal(takeover.at(-1), 0, 'mount FAR: takeover starts at 0');
  // CLOSE grazing pass — fresh u rides to 1 on BOTH sides.
  ctl.updateForCamera(65, 1500);
  assert.equal(emphasis.at(-1), 1, 'CLOSE grazing: emphasis (lastT) must ride to max(t, fresh-u)=1');
  assert.equal(takeover.at(-1), 1, 'CLOSE grazing: takeover must ride to fresh-u=1');
  // Back out to FAR — fresh u returns to 0 on BOTH sides (the live bug left 1 behind).
  ctl.updateForCamera(0, 32000);
  assert.equal(emphasis.at(-1), 0, 'FAR return: emphasis (lastT) must fall back to max(0, 0)=0');
  assert.equal(takeover.at(-1), 0, 'FAR return: takeover must fall back to fresh-u=0');
});

test('twin side mid-ramp follows fresh u (no sticking at endpoints)', () => {
  const { ctl, emphasis, takeover } = mountAtSat();
  ctl.updateForCamera(62.5, 6500);
  const fresh = Math.max(takeoverU(0), tiltU(62.5, 6500));
  assert.ok(fresh > 0 && fresh < 1, `mid state must be genuinely mid (got ${fresh})`);
  assert.ok(Math.abs(emphasis.at(-1) - fresh) < 1e-12, `emphasis must equal fresh u (got ${emphasis.at(-1)}, want ${fresh})`);
  assert.ok(Math.abs(takeover.at(-1) - fresh) < 1e-12, `takeover must equal fresh u (got ${takeover.at(-1)}, want ${fresh})`);
});
