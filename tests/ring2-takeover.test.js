// tests/ring2-takeover.test.js — Phase 4, Issue 2 thresholds.
// Mid-range stays the old composite; only the top steps take over, and the
// satellite hides exactly where the twin ground reaches opaque (no hole).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAKEOVER_START,
  TAKEOVER_FULL,
  takeoverU,
  groundHidden,
} from '../src/ring2/takeover.js';

test('thresholds: ramp 98->100, full at 100', () => {
  assert.equal(TAKEOVER_START, 98);
  assert.equal(TAKEOVER_FULL, 100);
});

test('takeoverU: zero through the mid-range (old composite untouched)', () => {
  for (const m of [0, 25, 50, 75, 90, 97, 98]) {
    assert.equal(takeoverU(m), 0, `mix ${m}`);
  }
});

test('takeoverU: ramps 98->100, opaque at 100', () => {
  assert.equal(takeoverU(99), 0.5);
  assert.equal(takeoverU(100), 1);
});

test('groundHidden: only at full takeover (never a black hole)', () => {
  for (const m of [0, 50, 98, 99]) {
    assert.equal(groundHidden(m), false, `mix ${m}`);
  }
  assert.equal(groundHidden(100), true);
});

test('takeover pair: satellite hides exactly where twin ground is opaque', () => {
  for (let m = 0; m <= 100; m++) {
    if (groundHidden(m)) assert.equal(takeoverU(m), 1, `mix ${m}: hidden ground needs opaque twin`);
  }
});

test('clamping: garbage in, bounded out', () => {
  assert.equal(takeoverU(-5), 0);
  assert.equal(takeoverU(250), 1);
  assert.equal(groundHidden(250), true);
  assert.equal(takeoverU('nope'), 0);
});
