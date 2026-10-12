// tests/ring2-slide-settle.test.js — SAT→TWIN slide smoothing pins.
// The headless frame-diff sweep (0→100 in 10s, 250ms frames) showed: warm
// slides are spike-free, cold slides pop a single 250ms window (~18% of
// pixels) while map tiles stream, and a DEM coarse→live redrape mid-slide
// would dispose + recreate every overlay mesh mid-gesture. The fixes:
// (1) mapbase dedupes redundant paint/layout writes — per-frame repeats at
// rest skip the style round-trip while changed values flush immediately, so
// endpoints stay bit-identical; (2) overlays defers the DEM auto-redrape
// while the view is settling (bounded, direct rebuild() stays synchronous).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shouldDeferRedrape,
  REDRAPE_DEBOUNCE_MS,
  REDRAPE_SETTLE_MS,
  REDRAPE_MAX_DEFERS,
} from '../src/ring2/overlays.js';

register('./css-stub-loader.mjs', import.meta.url);
const { fadeEqual, GROUND_FADE_EPS } = await import('../src/ring2/mapbase.js');

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('redrape keeps the original 300ms debounce timing', () => {
  assert.equal(REDRAPE_DEBOUNCE_MS, 300);
});

test('shouldDeferRedrape: defers inside the settle window, releases after', () => {
  assert.equal(shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 900, defers: 0 }), true);
  assert.equal(shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 100, defers: 0 }), false);
  // Boundary is exclusive: exactly SETTLE_MS old means settled.
  assert.equal(
    shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 1000 - REDRAPE_SETTLE_MS, defers: 0 }),
    false,
  );
});

test('shouldDeferRedrape: bounded — a marathon drag cannot pin a stale drape', () => {
  assert.equal(shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 999, defers: REDRAPE_MAX_DEFERS }), false);
  assert.equal(shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 999, defers: REDRAPE_MAX_DEFERS + 5 }), false);
  assert.equal(shouldDeferRedrape({ nowMs: 1000, lastSlideAt: 999, defers: REDRAPE_MAX_DEFERS - 1 }), true);
});

test('shouldDeferRedrape: non-finite clocks never defer', () => {
  assert.equal(shouldDeferRedrape({ nowMs: NaN, lastSlideAt: 100, defers: 0 }), false);
  assert.equal(shouldDeferRedrape({ nowMs: 1000, lastSlideAt: undefined, defers: 0 }), false);
  assert.equal(shouldDeferRedrape(), false);
});

test('fadeEqual: epsilon dedupe keeps invisible steps out of the style round-trip', () => {
  assert.equal(fadeEqual(0.5, 0.5), true);
  assert.equal(fadeEqual(1, 1 - GROUND_FADE_EPS / 2), true);
  assert.equal(fadeEqual(1, 0.999), false);
  assert.equal(fadeEqual(0, 1), false);
  assert.equal(fadeEqual(NaN, 1), false);
  assert.equal(fadeEqual(1, undefined), false);
});

test('GROUND_FADE_EPS is far below a perceivable opacity step', () => {
  assert.ok(GROUND_FADE_EPS <= 1e-3, `eps ${GROUND_FADE_EPS}`);
});

test('setGroundFade/setGroundOwns consult the applied records (regression pin)', () => {
  const src = srcOf('../src/ring2/mapbase.js');
  assert.ok(src.includes('_fadeMap !== m || !fadeEqual(_fadeApplied, s)'), 'fade dedupe guard');
  assert.ok(src.includes('_ownsApplied !== _groundOwns || _ownsMap !== m'), 'owns dedupe guard');
});

test('DEM auto-redrape waits out view settling (regression pin)', () => {
  const src = srcOf('../src/ring2/overlays.js');
  assert.ok(src.includes('shouldDeferRedrape({ nowMs: Date.now(), lastSlideAt'), 'settle check');
  assert.ok(src.includes('REDRAPE_MAX_DEFERS'), 'bounded deferral');
});
