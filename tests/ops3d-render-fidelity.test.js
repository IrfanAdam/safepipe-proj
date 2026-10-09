import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* Ops 3D render-fidelity pass (quality only — dark cinematic theme untouched).
 * Locks, lice and all:
 *   post.js    bloom threshold stays in the attention gate; MSAA samples on
 *              the offscreen scene RT; bloom strength restrained.
 *   scene.js   pixel-ratio cap helper; fog tuned for depth without washing;
 *              setBaseMix crossfade API byte-intact.
 *   camera.js  push-in math (load + TOP-enter), TOP detection, interrupt.
 */

import {
  clampMix,
  setBaseMix,
  resolvePixelRatio,
  PIXEL_RATIO_CAP,
  FOG_NEAR,
  FOG_FAR,
} from '../src/ops3d/scene.js';
import {
  pushInTarget,
  isTopView,
  PUSH_IN_FACTOR,
  PUSH_IN_MS,
  TOP_PITCH_DEG,
  TOP_DIST,
} from '../src/ops3d/camera.js';
import { autoFstop } from '../src/ops3d/post.js';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const lum = (hex) => {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

describe('fidelity: bloom threshold stays in the attention gate', () => {
  const postSrc = src('../src/ops3d/post.js');
  const m = postSrc.match(/threshold:\s*([0-9.]+)/);
  assert.ok(m, 'post.js must declare fx.threshold');
  const T = Number(m[1]);

  it('threshold unchanged at 0.44 (mirrors ops3d-attention.test.js)', () => {
    assert.equal(T, 0.44);
  });
  it('lamp-red + white clear it; critical-red body rides under (by design)', () => {
    assert.ok(T < lum(0xff4545), `T=${T} vs lamp red ${lum(0xff4545).toFixed(3)}`);
    assert.ok(T < lum(0xffffff), 'white pins must bloom');
    assert.ok(T > lum(0xe31919), 'critical-red body must NOT self-bloom');
    assert.ok(T > 0.2, 'dark-map noise stays suppressed');
  });
  it('bloom add strength stays restrained (≤0.12)', () => {
    const b = postSrc.match(/bloom:\s*([0-9.]+)/);
    assert.ok(b, 'post.js must declare fx.bloom');
    assert.ok(Number(b[1]) <= 0.12, `bloom ${b[1]} must stay restrained`);
  });
});

describe('fidelity: MSAA survives the post chain', () => {
  it('offscreen scene RT carries multisample samples (WebGL2-guarded)', () => {
    const postSrc = src('../src/ops3d/post.js');
    assert.ok(/rtScene\.samples\s*=\s*4/.test(postSrc), 'rtScene.samples = 4 required');
    assert.ok(postSrc.includes('isWebGL2'), 'samples must be WebGL2-guarded');
  });
});

describe('fidelity: pixel-ratio cap', () => {
  it('cap is 2×', () => {
    assert.equal(PIXEL_RATIO_CAP, 2);
  });
  it('resolvePixelRatio clamps, floors, and sanitizes', () => {
    assert.equal(resolvePixelRatio(3), 2, 'retina+ clamps to 2');
    assert.equal(resolvePixelRatio(1.5), 1.5, 'sub-cap passes through');
    assert.equal(resolvePixelRatio(1), 1);
    assert.equal(resolvePixelRatio(0), 1, 'zero falls back to 1');
    assert.equal(resolvePixelRatio(-2), 1, 'negative falls back to 1');
    assert.equal(resolvePixelRatio(NaN), 1, 'NaN falls back to 1');
    assert.equal(resolvePixelRatio(undefined), 1, 'missing falls back to 1');
    assert.equal(resolvePixelRatio(8, 1.5), 1.5, 'explicit cap honored');
    assert.equal(resolvePixelRatio(8, 0), 2, 'degenerate cap falls back to default');
  });
});

describe('fidelity: fog depth without wash', () => {
  it('fog near untouched, far tightened modestly (never on the subject)', () => {
    assert.equal(FOG_NEAR, 58, 'fog near is the washed-subject guard — untouched');
    assert.ok(FOG_FAR < 260 && FOG_FAR >= 200, `far ${FOG_FAR} tightens aerial perspective without washing`);
  });
});

describe('fidelity: setBaseMix crossfade API intact', () => {
  it('clampMix contract holds', () => {
    assert.equal(clampMix(0.5), 0.5);
    assert.equal(clampMix(-1), 0);
    assert.equal(clampMix(2), 1);
    assert.equal(clampMix(NaN), 1, 'non-finite means today-opaque');
    assert.equal(clampMix(undefined), 1);
  });
  it('module still exports the global setBaseMix fan-out', () => {
    assert.equal(typeof setBaseMix, 'function');
    const sceneSrc = src('../src/ops3d/scene.js');
    for (const needle of [
      'export function setBaseMix(m)',
      'entry.scene.background = v >= 0.999 ? entry.bg : null',
      'renderer.setClearColor(CLEAR_COLOR, 1)',
      'alpha: true',
      'scene.background = bg',
    ]) assert.ok(sceneSrc.includes(needle), `scene.js must still contain \`${needle}\``);
  });
  it('autoFstop DoF staging untouched', () => {
    assert.equal(autoFstop('network'), 6.5);
    assert.equal(autoFstop('segment'), 2.2);
    assert.equal(autoFstop('asset'), 1.4);
  });
});

describe('fidelity: cinematic push-in', () => {
  it('pushInTarget dollies toward the target by 1 − factor', () => {
    const end = pushInTarget([0, 0, 10], [0, 0, 0]);
    assert.ok(Math.abs(end.length() - 10 * PUSH_IN_FACTOR) < 1e-9, `got ${end.length()}`);
    const custom = pushInTarget([0, 0, 10], [0, 0, 0], 0.5);
    assert.ok(Math.abs(custom.length() - 5) < 1e-9);
    assert.ok(PUSH_IN_FACTOR > 0.85 && PUSH_IN_FACTOR < 1, 'felt, never nauseating');
    assert.ok(PUSH_IN_MS >= 3000 && PUSH_IN_MS <= 8000, `slow: ${PUSH_IN_MS}ms`);
  });
  it('isTopView fires on TOP flights only', () => {
    const top = (dist) => {
      const p = (78 * Math.PI) / 180;
      return [[dist * Math.cos(p) * Math.sin(0.07), dist * Math.sin(p), dist * Math.cos(p)], [0, 0, 0]];
    };
    assert.ok(isTopView(...top(62)), 'network TOP (78°/62) pushes');
    assert.ok(isTopView(...top(30)), 'framed TOP (78°/30) pushes');
    const seg = (() => {
      const p = (25 * Math.PI) / 180;
      return [[9 * Math.cos(p), 9 * Math.sin(p), 9 * Math.cos(p)], [0, 0, 0]];
    })();
    assert.ok(!isTopView(...seg), 'segment (25°/9) lands still');
    assert.ok(!isTopView([0, 0, 3], [0, 0, 0]), 'asset close-up never pushes');
    assert.ok(TOP_PITCH_DEG === 60 && TOP_DIST === 20, 'detection bounds sane');
  });
  it('user input cancels push + intro (interrupt wiring present)', () => {
    const camSrc = src('../src/ops3d/camera.js');
    const startBlock = camSrc.slice(camSrc.indexOf("addEventListener('start'"));
    for (const needle of ['push = null', 'pendingPush = false', 'introPending = false'])
      assert.ok(startBlock.includes(needle), `start listener must clear \`${needle}\``);
    assert.ok(camSrc.includes('pushActive'), 'rig exposes pushActive for verification');
    assert.ok(camSrc.includes('pushIn: startPush'), 'rig exposes pushIn');
  });
});
