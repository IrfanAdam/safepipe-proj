// GATE-3 REVISION regression guard for the three twin-map optimizations.
// Pure + node-checkable: pins the LAW each fix rests on so a later refactor
// cannot silently reintroduce the stair-steps, the unclamped handoff, or the
// enclosure re-open.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  enclosureRadiusPxForZoom,
  vignetteRadiusPxForZoom,
  enclosureTForZoom,
  pitchTargetForZoom,
  metersPerPixel,
  MAP_VIGNETTE_RING_M,
  ISO_PITCH_DEG,
  Z_TOP,
  Z_HANDOFF,
  Z_TWIN_COMMIT,
  Z_MAX,
} from '../src/map/scrolltrigger.js';
import { SITE } from '../src/map/feed.js';

const MAIN = readFileSync(new URL('../src/map/main.js', import.meta.url), 'utf8');
const RING2 = readFileSync(new URL('../src/ring2/main.js', import.meta.url), 'utf8');

test('FIX 1: the pitch law is applied per frame, not per tick', () => {
  // The native zoom animation re-applies the gesture-start pitch every frame,
  // so a per-tick write only lands on settle. The fix is a camera-update hook
  // that runs BEFORE the camera moves — it wins by construction.
  assert.ok(
    MAIN.includes('transformCameraUpdate'),
    'the map installs a transformCameraUpdate hook',
  );
  assert.ok(
    MAIN.includes('pitchTargetForZoom(z)'),
    'the hook derives the target from the one shared pitch law',
  );
  // The law itself is untouched: pure, monotone, 0 at Z_TOP, ISO_PITCH_DEG
  // at the handoff, held above it.
  assert.equal(pitchTargetForZoom(Z_TOP), 0, 'no tilt at the top-down checkpoint');
  assert.equal(pitchTargetForZoom(Z_HANDOFF), ISO_PITCH_DEG, 'the pole is reached at the handoff');
  assert.equal(pitchTargetForZoom(Z_TWIN_COMMIT), ISO_PITCH_DEG, 'the pole is held past the handoff');
  assert.equal(pitchTargetForZoom(Z_MAX), ISO_PITCH_DEG, 'and all the way to the zoom cap');
  assert.equal(pitchTargetForZoom(Z_TOP - 1), 0, 'below the band there is no tilt');
  let prev = -1;
  for (let z = Z_TOP; z <= Z_HANDOFF; z += 0.1) {
    const p = pitchTargetForZoom(z);
    assert.ok(p >= prev - 1e-9, `pitch is monotone in zoom (z=${z.toFixed(1)})`);
    prev = p;
  }
  // No second pitch law: the per-tick write and the per-frame pump both
  // derive from the same function.
  const lawCalls = (MAIN.match(/pitchTargetForZoom\(/g) || []).length;
  assert.ok(lawCalls >= 3, 'the one law is the source of every tilt target');
});

test('FIX 2: the deep handoff clamps regardless of `near`', () => {
  // `near` decides whether the WASH shows; it must NOT decide whether the
  // handoff clamps. The clamp is a zoom ceiling.
  assert.ok(
    !/if \(deep && nearNow && !reducedMotion\)/.test(MAIN),
    'the staged clamp is not gated on near',
  );
  assert.ok(
    /if \(deep && !reducedMotion\)/.test(MAIN),
    'a deep arrival always clamps',
  );
  assert.ok(MAIN.includes('mapRef.setMaxZoom(Z_HANDOFF)'), 'the clamp is the handoff zoom');
  // The commit gate requires BOTH near and non-blank.
  assert.ok(MAIN.includes('twinFrameHasContent'), 'the commit gate checks the twin for content');
  assert.ok(
    /const hasContent = twinFrameHasContent\(\);/.test(MAIN),
    'the twin content check is sampled once',
  );
  assert.ok(
    /if \(!nearNow \|\| !hasContent\)/.test(MAIN),
    'the commit requires near AND non-blank',
  );
  // The twin reports the content signals the gate reads.
  assert.ok(RING2.includes('content: () => {'), 'the twin exposes its content state');
  assert.ok(RING2.includes('mapIdle'), 'content reports the basemap tile-idle state');
  assert.ok(RING2.includes('sceneLive'), 'content reports the terrain-live state');
});

test('FIX 3: the enclosure holds at Z_TOP instead of re-opening', () => {
  const C = 900; // hotspot farthest-corner distance on the test viewport
  const atTop = enclosureRadiusPxForZoom(Z_TOP, SITE.lat, MAP_VIGNETTE_RING_M, C);
  assert.ok(Number.isFinite(atTop), 'the enclosure exists at Z_TOP');
  assert.equal(
    atTop, vignetteRadiusPxForZoom(Z_TOP, SITE.lat),
    'at Z_TOP the enclosure IS the projected ring',
  );
  // The re-open: the live-zoom projection grew by ~121px by the handoff.
  const live = vignetteRadiusPxForZoom(Z_HANDOFF, SITE.lat);
  assert.ok(
    live - atTop > 100,
    `the old live-zoom projection really did re-open (${(live - atTop).toFixed(1)}px)`,
  );
  // The fix: past Z_TOP the enclosure HOLDS — one value, no drift.
  for (const z of [10.5, 11, 11.5, 12, 12.1, 13, 13.4, Z_MAX]) {
    assert.equal(
      enclosureRadiusPxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M, C), atTop,
      `z=${z} holds the Z_TOP enclosure`,
    );
  }
  // The forming law is untouched: it still starts at the screen corners and
  // closes in across the shared span.
  assert.equal(enclosureRadiusPxForZoom(6.9, SITE.lat, MAP_VIGNETTE_RING_M, C), null, 'parks below the band');
  assert.ok(
    Math.abs(enclosureRadiusPxForZoom(7.01, SITE.lat, MAP_VIGNETTE_RING_M, C) - C) < 5,
    'still starts AT the corners',
  );
  let prev = Infinity;
  for (let z = 7.5; z <= Z_TOP; z += 0.5) {
    const r = enclosureRadiusPxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M, C);
    assert.ok(r < prev, `z=${z} still closes in from the edges`);
    prev = r;
  }
  // Symmetric on retrace: the law is a pure function of z.
  assert.equal(
    enclosureRadiusPxForZoom(9, SITE.lat, MAP_VIGNETTE_RING_M, C),
    enclosureRadiusPxForZoom(9, SITE.lat, MAP_VIGNETTE_RING_M, C),
    'the law is pure in z',
  );
  // The projection law itself is untouched (a live-zoom radius is still
  // available for anything that needs it).
  assert.equal(
    vignetteRadiusPxForZoom(12, SITE.lat), MAP_VIGNETTE_RING_M / metersPerPixel(12, SITE.lat),
    'the live-zoom projection law is unchanged',
  );
});

test('the enclosure is black-only — no amber rim or wash', () => {
  // REF GATE 3 rev 2026-10-20 zoom-in dissolve: "enclosure must be black-only,
  // no amber". The amber on the ring is the CORNER BRACKETS, which are
  // amber by design — never the surround.
  const html = readFileSync(new URL('../ops3d-map.html', import.meta.url), 'utf8');
  const vig = /#map-vignette\s*\{[^}]*\}/.exec(html);
  assert.ok(vig, 'the vignette rule exists');
  assert.ok(
    /radial-gradient\(circle var\(--vr\)/.test(vig[0]),
    'the surround is a radial gradient on --vr',
  );
  // The gradient's stops carry black (rgba(0,0,0,..) / var(--ops-bg)) only.
  const stops = /#map-vignette\s*\{[^}]*\}/.exec(html)[0];
  assert.ok(!/amber/i.test(stops), 'the surround carries no amber');
  // The brackets ARE amber (that is the ring-corner mark, not a rim).
  assert.ok(/--ops-amber/.test(html), 'the corner brackets stay amber');
});
