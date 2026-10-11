// tests/ring2-panparity.test.js — pan-ownership + pan-sweep parity guard.
//
// OWNER REPORT (A): a pan gesture breaks twin/map alignment. Root cause:
// the map MUST never own input — the twin orbit owns the camera at every
// mix and the map follows via the per-frame twin->map sync. Any live
// native MapLibre handler (dragPan especially) applies its own camera
// delta that the next sync frame then snaps back, which reads as a broken/
// fighting pan. Verified: main.js mounts with interactive:false; mapbase.js
// additionally disables every handler post-mount and probes that none owns
// input (fail-closed). Pan itself keeps working THROUGH the twin
// (OrbitControls defaults: ONE-finger ROTATE, TWO-finger DOLLY_PAN).
//
// This pins (1) the non-interactive mount + hardening in source, (2) the
// probe unit behavior, (3) the OrbitControls pan-preserving config, and
// (4) numeric twin-vs-map NDC parity while sweeping the orbit target
// +-5 km at pitch 60 (a pan must move BOTH sides together).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mapPoseForTwin,
  groundResForZoom,
  MAP_TRUE_FOV_DEG,
  MAP_INPUT_HANDLERS,
  assertMapNonInteractive,
} from '../src/ring2/sync.js';
import { SANGACHAL } from '../src/ring2/site.js';

const srcOf = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const rad = (d) => (d * Math.PI) / 180;

test('mount: main.js constructs the map non-interactive', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(/mountMapBase\(mapDiv, \{/.test(main), 'main.js must mount via mountMapBase');
  assert.ok(/interactive:\s*false/.test(main), 'mount call site must pass interactive:false');
});

test('hardening: mapbase disables every gesture handler + probes post-mount', () => {
  const mb = srcOf('../src/ring2/mapbase.js');
  assert.ok(
    /import \{[^}]*MAP_INPUT_HANDLERS[^}]*assertMapNonInteractive[^}]*\} from '\.\/sync\.js'/.test(mb),
    'mapbase must source the handler list + probe from sync.js (node-probe-clean)',
  );
  assert.ok(/export \{ MAP_INPUT_HANDLERS, assertMapNonInteractive \}/.test(mb), 'mapbase must re-export both');
  for (const h of ['dragPan', 'dragRotate', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'keyboard', 'touchZoomRotate']) {
    assert.ok(MAP_INPUT_HANDLERS.includes(h), `MAP_INPUT_HANDLERS must list ${h}`);
  }
  assert.ok(/for \(const name of MAP_INPUT_HANDLERS\)/.test(mb), 'mapbase must loop the full handler list');
  assert.ok(/\.disable\?\.\(\)/.test(mb), 'mapbase must disable each handler post-mount');
  assert.ok(/assertMapNonInteractive\(map\)/.test(mb), 'mount must probe non-interactivity fail-closed');
});

test('probe: assertMapNonInteractive passes only when no handler owns input', () => {
  const disabled = () => ({ isEnabled: () => false });
  const allOff = {};
  for (const h of MAP_INPUT_HANDLERS) allOff[h] = disabled();
  assert.equal(assertMapNonInteractive(allOff), true);
  assert.throws(() => assertMapNonInteractive(null), /no live map/);
  // A single live handler (the pan-break class) fails with its name.
  const oneLive = {};
  for (const h of MAP_INPUT_HANDLERS) oneLive[h] = disabled();
  oneLive.dragPan = { isEnabled: () => true };
  assert.throws(() => assertMapNonInteractive(oneLive), /dragPan/);
  // Missing handlers pass (nothing there owns input).
  assert.equal(assertMapNonInteractive({}), true);
});

test('twin keeps pan: OrbitControls never disables pan or drops DOLLY_PAN', () => {
  const raw = srcOf('../src/ring2/overlays.js');
  const code = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/enablePan\s*=\s*false/.test(code), 'twin must keep OrbitControls pan enabled');
  assert.ok(!/\.touches\s*=/.test(code), 'twin must keep default touches (ONE ROTATE / TWO DOLLY_PAN)');
});

/* ---- numeric pan sweep: same pinhole helpers as ring2-cameraparity. ---- */
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
function ndcFor(eye, target, ground, fovDeg, aspect) {
  const f = norm(sub(target, eye));
  let up = { x: 0, y: 1, z: 0 };
  if (Math.abs(dot(f, up)) > 0.999) up = { x: 0, y: 0, z: -1 };
  const s = norm(cross(f, up));
  const u = cross(s, f);
  const d = sub(ground, eye);
  const zc = dot(d, f);
  if (!(zc > 0)) return null;
  const t = Math.tan(rad(fovDeg) / 2);
  return [dot(d, s) / (zc * t * aspect), dot(d, u) / (zc * t)];
}

test('pan sweep: orbit target +-5km at pitch 60 keeps twin-vs-map NDC parity', () => {
  const H = 800;
  const ASP = 16 / 9;
  const R = 12000;
  const PITCH = 60;
  // Ground probes around each swept target (local disc + relief).
  const localPts = [];
  for (const gx of [-4000, -2000, 0, 2000, 4000]) {
    for (const gz of [-4000, -2000, 0, 2000, 4000]) {
      localPts.push({ dx: gx, y: 0, dz: gz });
      localPts.push({ dx: gx, y: 300, dz: gz });
    }
  }
  for (const tx of [-5000, -2500, 0, 2500, 5000]) {
    for (const tz of [-5000, -2500, 0, 2500, 5000]) {
      const target = { x: tx, y: 0, z: tz };
      const eye = {
        x: tx,
        y: R * Math.cos(rad(PITCH)),
        z: tz + R * Math.sin(rad(PITCH)),
      };
      const mp = mapPoseForTwin({ eye, target }, { viewportPx: H, fovDeg: MAP_TRUE_FOV_DEG });
      // Map eye reconstruction along the view ray from the (panned) target.
      const distPx = (0.5 * H) / Math.tan(rad(MAP_TRUE_FOV_DEG) / 2);
      const distM = distPx * groundResForZoom(mp.zoom, SANGACHAL.lat);
      assert.ok(
        Math.abs(distM - R) / R < 1e-9,
        `target (${tx},${tz}): map eye distance must reconstruct twin range`,
      );
      const f = norm(sub(target, eye));
      const mapEye = {
        x: target.x - f.x * distM,
        y: target.y - f.y * distM,
        z: target.z - f.z * distM,
      };
      let worst = 0;
      for (const p of localPts) {
        const g = { x: tx + p.dx, y: p.y, z: tz + p.dz };
        const a = ndcFor(eye, target, g, MAP_TRUE_FOV_DEG, ASP);
        const b = ndcFor(mapEye, target, g, MAP_TRUE_FOV_DEG, ASP);
        if (!a || !b) continue;
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      assert.ok(worst < 1e-9, `target (${tx},${tz}): panned NDC residual must be ~0 (got ${worst})`);
    }
  }
});

test('pan moves both sides: map center follows the swept target', () => {
  const H = 800;
  const R = 12000;
  const PITCH = 60;
  const c0 = mapPoseForTwin(
    {
      eye: { x: 0, y: R * Math.cos(rad(PITCH)), z: R * Math.sin(rad(PITCH)) },
      target: { x: 0, y: 0, z: 0 },
    },
    { viewportPx: H, fovDeg: MAP_TRUE_FOV_DEG },
  ).center;
  const c1 = mapPoseForTwin(
    {
      eye: { x: 5000, y: R * Math.cos(rad(PITCH)), z: 5000 + R * Math.sin(rad(PITCH)) },
      target: { x: 5000, y: 0, z: 5000 },
    },
    { viewportPx: H, fovDeg: MAP_TRUE_FOV_DEG },
  ).center;
  assert.ok(
    Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) > 0.01,
    `+5km pan must move the map center (got ${c0} -> ${c1})`,
  );
});
