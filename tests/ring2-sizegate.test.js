// tests/ring2-sizegate.test.js — Phase 4, Issue 1 gate.
// Pins the non-zero-container predicate + the sized-wait used to keep
// MapLibre from being born 0x0 in a hidden gallery iframe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSizedWH, waitForSized } from '../src/ring2/sizeGate.js';

test('isSizedWH: zero in either axis is not sized', () => {
  assert.equal(isSizedWH(0, 0), false);
  assert.equal(isSizedWH(1280, 0), false);
  assert.equal(isSizedWH(0, 800), false);
  assert.equal(isSizedWH(1280, 800), true);
  assert.equal(isSizedWH(1, 1), true);
});

test('waitForSized: resolves true immediately when already sized', async () => {
  const el = { clientWidth: 1280, clientHeight: 800 };
  assert.equal(await waitForSized(() => el, { timeoutMs: 500 }), true);
});

test('waitForSized: resolves true when the box gains size', async () => {
  const el = { clientWidth: 0, clientHeight: 0 };
  setTimeout(() => {
    el.clientWidth = 1280;
    el.clientHeight = 800;
  }, 150);
  assert.equal(await waitForSized(() => el, { timeoutMs: 3000, pollMs: 50 }), true);
});

test('waitForSized: resolves false on timeout, never hangs boot', async () => {
  const el = { clientWidth: 0, clientHeight: 0 };
  const t0 = Date.now();
  assert.equal(await waitForSized(() => el, { timeoutMs: 300, pollMs: 50 }), false);
  assert.ok(Date.now() - t0 < 2000, 'wait must stay bounded');
});

test('waitForSized: null element resolves false without throwing', async () => {
  assert.equal(await waitForSized(() => null, { timeoutMs: 200, pollMs: 50 }), false);
});
