// tests/map-mask-ellipse.test.js — the enclosure mask is the PROJECTED ground
// ring, not a cos-squash of the ground radius: rx/ry/cy come from MapLibre's
// own camera model (cameraToCenterDistance at the live height, fov
// MAP_TRUE_FOV_DEG) at the handoff pose, and the forming law converges onto
// that exact ellipse. Pins the projection against the live-map numbers the
// audit measured, the seam, the driver writes, and the CSS feather living
// outside the disc (never straddling the twin's rim).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  projectedRingEllipse,
  projectedSeamEllipse,
  enclosureEllipsePxForZoom,
  seamHoldEllipseForS,
  SEAM_HOLD_RX_PX,
  vignetteRadiusPxForZoom,
  Z_CENTER,
  Z_HANDOFF,
  MAP_VIGNETTE_RING_M,
} from '../src/map/scrolltrigger.js';
import { SITE } from '../src/map/feed.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const main = () => srcOf('../src/map/main.js');
const html = () => srcOf('../ops3d-map.html');
const CORNER = 800;
const H = 700;

// Live map.project of the 10km ring, measured at z11.5 / pitch45 / 1122x700
// (site at the canvas centre): half-width 513.2, 258.6 up / 508.8 down.
const LIVE = { rx: 513.15, ry: 383.73, cy: 125.08 };

test('projected ring matches MapLibre at the handoff pose (≤1px)', () => {
  const p = projectedRingEllipse({ zoom: Z_HANDOFF, pitchDeg: 45, heightPx: H, latDeg: SITE.lat });
  assert.ok(p, 'the handoff pose projects');
  assert.ok(Math.abs(p.rx - LIVE.rx) < 1.0, `rx ${p.rx} vs live ${LIVE.rx}`);
  assert.ok(Math.abs(p.ry - LIVE.ry) < 1.0, `ry ${p.ry} vs live ${LIVE.ry}`);
  assert.ok(Math.abs(p.cy - LIVE.cy) < 1.0, `cy ${p.cy} vs live ${LIVE.cy}`);
  // The near half projects farther than the far half: the ellipse centre is
  // BELOW the site, which is the whole reason a site-centred circle misses.
  assert.ok(p.cy > 0, 'the pitched ellipse centre sits below the site');
  assert.ok(p.ry > p.rx * 0.7 && p.ry < p.rx, 'ry is foreshortened but not cos45-short');
});

test('projected ring: nadir is a centred circle; height scales it; horizon parks', () => {
  const flat = projectedRingEllipse({ zoom: Z_HANDOFF, pitchDeg: 0, heightPx: H, latDeg: SITE.lat });
  assert.ok(flat, 'nadir projects');
  assert.ok(Math.abs(flat.rx - flat.ry) < 1e-9, 'pitch 0 is a circle');
  assert.ok(Math.abs(flat.cy) < 1e-9, 'pitch 0 is centred');
  assert.equal(+flat.rx.toFixed(2), +(vignette()).toFixed(2), 'rx is the ground radius at nadir');

  const tall = projectedRingEllipse({ zoom: Z_HANDOFF, pitchDeg: 45, heightPx: 500, latDeg: SITE.lat });
  const base = projectedRingEllipse({ zoom: Z_HANDOFF, pitchDeg: 45, heightPx: H, latDeg: SITE.lat });
  assert.ok(tall && base && tall.rx !== base.rx, 'a different viewport height changes the projection');
  assert.ok(tall.rx > base.rx, 'a shorter viewport magnifies the same ground ring');

  // Past ~z13.4 the 10km ring's near edge crosses the camera's horizon at
  // this height (rPx*sin45 >= d): the projection is unbounded there and must
  // park (null), never return an invented radius.
  assert.equal(projectedRingEllipse({ zoom: 13.6, pitchDeg: 45, heightPx: H, latDeg: SITE.lat }), null);
});

function vignette() {
  return vignetteRadiusPxForZoom(Z_HANDOFF, SITE.lat);
}

test('one shape: the forming law converges onto the projected seam exactly', () => {
  const seam = projectedSeamEllipse(H, SITE.lat);
  assert.ok(seam, 'the seam projects at the live height');
  const atGate = enclosureEllipsePxForZoom(Z_HANDOFF, SITE.lat, MAP_VIGNETTE_RING_M, CORNER, H);
  assert.ok(atGate, 'the enclosure exists at the gate');
  assert.equal(atGate.rx, seam.rx, 't=1 rx is the projected seam rx');
  assert.equal(atGate.ry, seam.ry, 't=1 ry is the projected seam ry');
  assert.equal(atGate.cy, seam.cy, 't=1 cy is the projected seam centre');
  // Just inside the band the display is still a circle that covers the frame
  // (ry == rx, cy == 0) — the morph to the projection rides the same t.
  const justIn = enclosureEllipsePxForZoom(Z_CENTER + 0.01, SITE.lat, MAP_VIGNETTE_RING_M, CORNER, H);
  assert.ok(justIn, 'the ellipse exists just inside the band');
  assert.ok(Math.abs(justIn.ry / justIn.rx - 1) < 0.01, 't≈0 is a circle (ry≈rx)');
  assert.ok(Math.abs(justIn.cy) < 0.2, 't≈0 is centred on the site');
  assert.equal(enclosureEllipsePxForZoom(Z_CENTER, SITE.lat, MAP_VIGNETTE_RING_M, CORNER, H), null, 'parks at the band floor');
  assert.equal(enclosureEllipsePxForZoom(Z_HANDOFF, SITE.lat, MAP_VIGNETTE_RING_M, null, H), null, 'parks without a corner');
});

test('seam hold: projected at the live height, ground fallback without one', () => {
  const seam = seamHoldEllipseForS(0, H);
  const projected = projectedSeamEllipse(H, SITE.lat);
  assert.equal(seam.rx, projected.rx, 'hold rx is the projected seam');
  assert.equal(seam.ry, projected.ry, 'hold ry is the projected seam');
  assert.equal(seam.cy, projected.cy, 'hold cy is the projected seam');
  for (const s of [0, 125, 250, 500, 1000, NaN]) {
    assert.deepEqual(seamHoldEllipseForS(s, H), seam, `S=${s} holds the same ellipse`);
  }
  const fallback = seamHoldEllipseForS(0);
  assert.equal(fallback.rx, SEAM_HOLD_RX_PX, 'no height falls back to the ground radius');
  assert.equal(+fallback.cy.toFixed(1), 0, 'the fallback has no projected centre offset');
});

test('driver: every ellipse write passes the live height and the projected cy', () => {
  const src = main();
  const calls = src.match(/enclosureEllipsePxForZoom\(/g) || [];
  assert.ok(calls.length >= 2, `both ellipse sites exist (${calls.length})`);
  assert.ok(src.includes('enclosureEllipsePxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M, corner, h)'),
    'the live writer passes the measured height');
  assert.ok(src.includes('enclosureEllipsePxForZoom(zLive, SITE.lat, MAP_VIGNETTE_RING_M, corner, chh)'),
    'the entry refresh passes the measured height');
  assert.ok(src.includes('seamHoldEllipseForS(stagedS, frameSize().h)'),
    'the hold seam passes the live height');
  assert.ok(src.includes('prox.sy + cy'), 'the live mask centre carries the projected cy');
  assert.ok(src.includes('+sp.y + cy'), 'the hold mask centre carries the projected cy');
  assert.ok(!src.includes('maskSquashForZoom'), 'no cos-squash path remains');
});

test('vignette: clear core IS the disc; feather lives outside it', () => {
  const doc = html();
  const vig = /#map-vignette\s*\{[^}]*\}/.exec(doc);
  assert.ok(vig, 'the vignette rule exists');
  const rule = vig[0];
  assert.ok(/radial-gradient\(ellipse var\(--vr\) var\(--vr-y, var\(--vr\)\)/.test(rule), 'the surround is an ellipse');
  assert.ok(/transparent var\(--vr\)/.test(rule), 'the clear core ends exactly at the projected rim');
  assert.ok(!/0\.74|1\.12/.test(rule), 'the old straddling feather stops are gone');
  assert.ok(/--seam-feather:\s*calc\(var\(--vr\) \* 0\.19\)/.test(rule), 'the feather is a ratio of the rim, not a px literal');
  assert.ok(/calc\(var\(--vr\) \+ var\(--seam-feather\)\)/.test(rule), 'the feather lands outside the rim');
  assert.ok(!/var\(--ops-bg\) 100%/.test(rule), 'no stop before the outside feather (stops must not run backwards)');
});
