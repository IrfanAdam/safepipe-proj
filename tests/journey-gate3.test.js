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
  Z_ISO_START,
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
  // The law: pure, monotone, 0 at the terrain grade (Z_ISO_START), the full
  // 45deg by the iso checkpoint (Z_TOP), held through the handoff. Starting a
  // full level earlier is the owner's "begin a lot sooner" fix.
  assert.equal(pitchTargetForZoom(Z_ISO_START), 0, 'no tilt at the terrain grade');
  assert.ok(pitchTargetForZoom(Z_ISO_START + 0.75) > 0, 'tilt begins before the checkpoint');
  assert.equal(pitchTargetForZoom(Z_TOP), ISO_PITCH_DEG, 'the pole is reached at the checkpoint');
  assert.equal(pitchTargetForZoom(Z_HANDOFF), ISO_PITCH_DEG, 'the pole is held through the handoff');
  assert.equal(pitchTargetForZoom(Z_TWIN_COMMIT), ISO_PITCH_DEG, 'the pole is held past the handoff');
  assert.equal(pitchTargetForZoom(Z_MAX), ISO_PITCH_DEG, 'and all the way to the zoom cap');
  assert.equal(pitchTargetForZoom(Z_ISO_START - 1), 0, 'below the band there is no tilt');
  let prev = -1;
  for (let z = Z_ISO_START; z <= Z_HANDOFF; z += 0.1) {
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
  // The commit gate requires NEAR + SCALE-NEAR + REAL CONTENT (V7 seam law:
  // an off-frame or drifted commit lands the mixed-rectangle cut, and a
  // painted-but-black overlay is the off-centre failure). Hold-at-0 + retry
  // while any leg fails; the S stages stay visible through driveStagedHold.
  assert.ok(MAIN.includes('twinFrameHasContent'), 'the commit gate checks the twin for content');
  assert.ok(
    /const hasContent = twinFrameHasContent\(\);/.test(MAIN),
    'the twin content check is sampled once',
  );
  assert.ok(
    /if \(!hasContent\)/.test(MAIN),
    'the commit requires non-blank twin content',
  );
  assert.ok(
    /if \(!proxNear \|\| !scaleNear\)/.test(MAIN),
    'the commit holds while off-frame or drifted (V7 seam law)',
  );
  assert.ok(
    MAIN.includes('STAGED_COMMIT_Z_TOL'),
    'scale-near is a named tolerance, not a literal',
  );
  // The twin reports the content signals the gate reads.
  assert.ok(RING2.includes('content: () => {'), 'the twin exposes its content state');
  assert.ok(RING2.includes('mapIdle'), 'content reports the basemap tile-idle state');
  assert.ok(RING2.includes('sceneLive'), 'content reports the terrain-live state');
});

test('FIX 3: the enclosure holds at the handoff instead of over-zooming', () => {
  const C = 900; // hotspot farthest-corner distance on the test viewport
  const atHandoff = enclosureRadiusPxForZoom(Z_HANDOFF, SITE.lat, MAP_VIGNETTE_RING_M, C);
  assert.ok(Number.isFinite(atHandoff), 'the enclosure exists at the handoff');
  assert.equal(
    atHandoff, vignetteRadiusPxForZoom(Z_HANDOFF, SITE.lat),
    'at the handoff the enclosure IS the projected ring the twin clips to',
  );
  // The old hold evaluated the projection at Z_TOP: 121px, half the twin's
  // 242px clip — the owner's "enclosure zooming in too much".
  const oldHold = vignetteRadiusPxForZoom(Z_TOP, SITE.lat);
  assert.ok(
    atHandoff - oldHold > 100,
    `the old Z_TOP hold over-zoomed by ${(atHandoff - oldHold).toFixed(1)}px`,
  );
  // The circle keeps closing through the band, then HOLDS on the twin clip.
  const atTop = enclosureRadiusPxForZoom(Z_TOP, SITE.lat, MAP_VIGNETTE_RING_M, C);
  assert.ok(atTop > atHandoff, 'the circle still has room to close at Z_TOP');
  for (const z of [Z_HANDOFF, 12, 12.1, 13, 13.4, Z_MAX]) {
    assert.equal(
      enclosureRadiusPxForZoom(z, SITE.lat, MAP_VIGNETTE_RING_M, C), atHandoff,
      `z=${z} holds the handoff enclosure`,
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
  for (let z = 7.5; z <= Z_HANDOFF; z += 0.5) {
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
    /radial-gradient\(ellipse var\(--vr\) var\(--vr-y, var\(--vr\)\)/.test(vig[0]),
    'the surround is an elliptical radial gradient on --vr / --vr-y',
  );
  // The gradient's stops carry black (rgba(0,0,0,..) / var(--ops-bg)) only.
  const stops = /#map-vignette\s*\{[^}]*\}/.exec(html)[0];
  assert.ok(!/amber/i.test(stops), 'the surround carries no amber');
  // The brackets ARE amber (that is the ring-corner mark, not a rim).
  assert.ok(/--ops-amber/.test(html), 'the corner brackets stay amber');
});

test('the staged dissolve is scrubbed, not chased by a CSS transition', () => {
  // The layer-swap cut: the overlay's opacity is written inline from the S
  // law on every scroll tick, and the CSS carried `transition: opacity
  // 0.45s ease` on #twin-overlay. A transition eases between COMMITTED
  // values, so every per-tick write restarted it and the rendered opacity
  // LAGGED the law (measured: target 1.0, rendered 0.89) — then the commit
  // snapped it up. That is the one-frame hard cut in the owner's recording.
  // The fix: while the scrub owns the opacity the transition is suspended
  // (`.scrubbing`), so the law's value IS the rendered value and the commit
  // hands back to the transition with nothing to snap.
  const html = readFileSync(new URL('../ops3d-map.html', import.meta.url), 'utf8');
  assert.ok(
    /#twin-overlay\.scrubbing\s*\{\s*transition:\s*none;?\s*\}/.test(html),
    'the scrubbed leg suspends the transition',
  );
  // The scrub adds the class; the commit and the timed crossfade remove it.
  assert.ok(
    /root\.classList\.add\('scrubbing'\)/.test(MAIN),
    'the staged driver suspends the transition while it scrubs',
  );
  assert.ok(
    /classList\.remove\('scrubbing'\)/.test(MAIN),
    'the commit and the timed reveal restore the transition',
  );
  // The commit must release the inline opacity only AFTER the transition is
  // live, and only when the law has reached 1 (so the hand-off is 1 -> 1).
  assert.ok(
    /const committed = Number\.isFinite\(at\) \? at : 1;/.test(MAIN),
    'the commit carries the law value across',
  );
  assert.ok(
    /root\.style\.opacity = committed >= 1 \? '' : String\(committed\);/.test(MAIN),
    'the inline value is released only at 1 — never a snap',
  );
  // The reverse leg is TIMED, not scrubbed: it keeps its own transition.
  assert.ok(
    /#twin-overlay\.closing\s*\{[^}]*transition-duration/.test(html),
    'the timed reverse keeps its transition',
  );
});
