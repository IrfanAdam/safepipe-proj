// tests/map-intent-precache.test.js — lane intent-precache: the twin boots
// + arrival tiles warm at lock intent (the mask arm: near-or-in-view &&
// blend>0, first true just past Z_CENTER — pre-iso, center-predictable),
// NOT at the gate.
// Guards: the intent block names no opener (no flyToSectorThenTwin /
// prewarmThenReveal / openTwin), flips no twin state, and re-arms when
// intent drops; the in-band takeover boot stays a backstop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

function intentBlock() {
  const main = srcOf('../src/map/main.js');
  const open = main.indexOf('// INTENT-PRECACHE: earliest reliable lock-intent');
  assert.ok(open !== -1, 'the intent-precache block exists');
  // The block ends where the deep-warm comment resumes.
  const close = main.indexOf('// Deep warm for the dissolve:', open);
  assert.ok(close > open, 'the intent block closes before the deep-warm block');
  return main.slice(open, close);
}

test('intent boots the twin + warms arrival tiles at the mask arm', () => {
  const block = intentBlock();
  assert.ok(block.includes('prox && (prox.near || prox.inView) && blend > 0'), 'the lock-intent signal is the mask arm (near-or-in-view && blend>0)');
  assert.ok(block.includes('earlyBootTwin()'), 'lock intent boots the twin iframe early');
  for (const z of ['9', '10', '11']) {
    assert.ok(block.includes(`prefetchSatTiles(SITE_LNGLAT, ${z})`), `lock intent warms the arrival-level site tiles (z${z})`);
  }
  assert.ok(block.includes('window.__mapProbe.intentPrewarm'), 'the intent state publishes on the probe');
});

test('intent cannot hand off: no opener, no twin-state flips in the block', () => {
  const block = intentBlock().replace(/\/\/[^\n]*/g, ''); // comments may name openers; code must not call them
  for (const opener of ['flyToSectorThenTwin', 'prewarmThenReveal', 'openTwin(']) {
    assert.ok(!block.includes(opener), `the intent block never calls ${opener}`);
  }
  for (const flip of ['twinOpen = true', 'setMaxZoom', 'pushState', 'pendingReveal = {']) {
    assert.ok(!block.includes(flip), `the intent block never flips twin state (${flip})`);
  }
  assert.ok(block.includes('!twinOpen && !transitId && !pendingReveal && !stagedActive'), 'the intent boot respects every in-flight twin state');
});

test('intent re-arms when intent drops; the takeover boot stays a backstop', () => {
  const block = intentBlock();
  assert.ok(block.includes('intentWarmed = false'), 'lost intent re-arms the per-dive warm for the next dive');
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('// Round-10 dive-start prewarm: first armed (near or in-view) engagement'), 'the in-band dive-start boot stays as the backstop');
});

test('the early-boot abort keys off intent-loss, not the old z-band', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('!(prox && (prox.near || prox.inView) && blend > 0)) {'),
    'the armed-boot abort fires on intent-loss (the same near-or-in-view && blend>0 predicate)',
  );
  assert.ok(
    !main.includes('!pendingReveal && z < Z_ISO_START - 1'),
    'the old band floor no longer kills a boot that holds lock intent',
  );
});
