// tests/ring2-mix-input.test.js — twin input stays live at every mix.
// The twin orbit owns the camera from SAT (0) to TWIN (100); the map
// follows via sync and is non-interactive. twinPointerEvents() must never
// return 'none' — that starved OrbitControls and froze satellite mode.
// [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-4]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twinPointerEvents } from '../src/ring2/sync.js';

test('twin canvas is pointer-interactive at every mix (0..100)', () => {
  for (let m = 0; m <= 100; m++) {
    assert.equal(twinPointerEvents(m), 'auto', `mix ${m}`);
  }
});

test('twin canvas stays interactive for edge inputs too', () => {
  for (const v of [0, 1, 2, 50, 98, 99, 100, -5, 250, NaN, undefined]) {
    assert.equal(twinPointerEvents(v), 'auto', `input ${String(v)}`);
  }
});
