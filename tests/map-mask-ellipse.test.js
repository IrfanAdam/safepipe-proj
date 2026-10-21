// tests/map-mask-ellipse.test.js — the CSS enclosure mask is a fixed circle
// but the pitched ground circle projects to an ellipse (vertical x cos p).
// maskSquashForZoom pins the squash (1 flat, cos45 at the iso pole);
// enclosureEllipsePxForZoom reuses the forming-law circle radius as rx and
// squashes ry; the driver writes --vr AND --vr-y at both write sites and
// the vignette rides the ellipse form.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  maskSquashForZoom,
  enclosureEllipsePxForZoom,
  enclosureRadiusPxForZoom,
  DEG2RAD,
  Z_ISO_START,
  Z_TOP,
  Z_HANDOFF,
  MAP_VIGNETTE_RING_M,
} from '../src/map/scrolltrigger.js';
import { SITE } from '../src/map/feed.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const main = () => srcOf('../src/map/main.js');
const html = () => srcOf('../ops3d-map.html');
const CORNER = 900; // hotspot farthest-corner distance on the test viewport
const SQUASH_AT_POLE = 0.7071067812; // cos(45deg)
const SQUASH_AT_MID = 0.9238795325; // cos(22.5deg)

test('squash pins: 1 at/below ISO_START, cos45 at/above TOP, cos22.5 mid-band', () => {
  assert.equal(DEG2RAD, Math.PI / 180, 'the projection factor is a named constant');
  assert.equal(maskSquashForZoom(Z_ISO_START), 1, 'the flat grade projects unsquashed');
  assert.equal(maskSquashForZoom(Z_ISO_START - 2), 1, 'below the grade stays unsquashed');
  assert.ok(
    Math.abs(maskSquashForZoom(Z_TOP) - SQUASH_AT_POLE) < 1e-9,
    `the iso pole squashes to cos45 (got ${maskSquashForZoom(Z_TOP)})`,
  );
  assert.ok(
    Math.abs(maskSquashForZoom(Z_HANDOFF) - SQUASH_AT_POLE) < 1e-9,
    'the squash holds through the handoff with the pole',
  );
  assert.ok(
    Math.abs(maskSquashForZoom(Z_HANDOFF + 2) - SQUASH_AT_POLE) < 1e-9,
    'above handoff the pole (and the squash) holds',
  );
  const mid = (Z_ISO_START + Z_TOP) / 2;
  assert.ok(
    Math.abs(maskSquashForZoom(mid) - SQUASH_AT_MID) < 1e-9,
    `band midpoint squashes to cos22.5 (got ${maskSquashForZoom(mid)})`,
  );
});

test('squash is monotonic non-increasing across the journey', () => {
  let prev = 2;
  for (let z = 4; z <= 16; z += 0.25) {
    const s = maskSquashForZoom(z);
    assert.ok(s <= prev + 1e-12, `z=${z} must not un-squash (${prev} -> ${s})`);
    prev = s;
  }
});

test('ellipse reuses the circle law: rx unchanged, ry == rx below the band', () => {
  const atLow = enclosureEllipsePxForZoom(7.01, SITE.lat, MAP_VIGNETTE_RING_M, CORNER);
  assert.ok(atLow, 'the ellipse exists just inside the band');
  assert.equal(
    atLow.rx, enclosureRadiusPxForZoom(7.01, SITE.lat, MAP_VIGNETTE_RING_M, CORNER),
    'rx IS the forming-law circle radius',
  );
  assert.equal(atLow.squash, 1, 'below the tilt band the squash is 1');
  assert.equal(atLow.ry, atLow.rx, 'ry == rx below the tilt band');
  const atTop = enclosureEllipsePxForZoom(Z_TOP, SITE.lat, MAP_VIGNETTE_RING_M, CORNER);
  assert.equal(
    atTop.rx, enclosureRadiusPxForZoom(Z_TOP, SITE.lat, MAP_VIGNETTE_RING_M, CORNER),
    'rx stays the circle law at the checkpoint too',
  );
  assert.ok(
    Math.abs(atTop.ry - atTop.rx * SQUASH_AT_POLE) < 1e-6,
    `ry is rx squashed by cos45 (got ${atTop.ry} vs rx ${atTop.rx})`,
  );
  assert.equal(enclosureEllipsePxForZoom(6.9, SITE.lat, MAP_VIGNETTE_RING_M, CORNER), null, 'parks below the band');
  assert.equal(enclosureEllipsePxForZoom(8, SITE.lat, MAP_VIGNETTE_RING_M, null), null, 'parks without a viewport corner');
});

test('driver writes --vr-y everywhere it writes --vr (both sites)', () => {
  const src = main();
  const vrWrites = (src.match(/setProperty\('--vr'/g) || []).length;
  const vryWrites = (src.match(/setProperty\('--vr-y'/g) || []).length;
  assert.ok(vrWrites >= 2, `both write sites set --vr (found ${vrWrites})`);
  assert.equal(vryWrites, vrWrites, `--vr-y is written everywhere --vr is (${vryWrites} vs ${vrWrites})`);
  assert.ok(src.includes("removeProperty('--vr-y')"), 'the park path clears --vr-y with --vr');
  assert.ok(src.includes('enclosureEllipsePxForZoom('), 'both sites ride the ellipse law');
});

test('vignette rides the ellipse form; no circle var(--vr) remains', () => {
  const doc = html();
  const vig = /#map-vignette\s*\{[^}]*\}/.exec(doc);
  assert.ok(vig, 'the vignette rule exists');
  assert.ok(
    /radial-gradient\(ellipse var\(--vr\) var\(--vr-y, var\(--vr\)\)/.test(vig[0]),
    'the surround is an ellipse on --vr / --vr-y',
  );
  assert.ok(!/circle var\(--vr\)/.test(vig[0]), 'no circle var(--vr) remains in #map-vignette');
  assert.ok(doc.includes('@property --vr-y'), '--vr-y is a registered property');
  assert.ok(
    doc.includes('--rc-axis-y: calc(var(--vr-y, var(--vr)) * 0.7071067811865476)'),
    'the vertical bracket axis derives from --vr-y (1/sqrt(2))',
  );
  const tops = (doc.match(/var\(--rc-axis-y\)/g) || []).length;
  assert.equal(tops, 4, 'all four bracket tops ride --rc-axis-y');
  assert.ok(!/top: calc\(var\(--vy[^)]*var\(--rc-axis\)/.test(doc), 'no bracket top rides the horizontal axis');
});
