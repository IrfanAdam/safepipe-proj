// tests/ring2-staged-rebuild.test.js — arrival-rebased staged progress.
//
// A warm twin can release BEFORE the first staged post lands (ready posts
// on the hold pin while the map still parks S at the gate), freezing legs
// from stale pins. When the arrival post lands, main.js rebuilds the legs
// from the live pose and re-anchors the band at the arrival S — so the
// arrival S must map to progress 0 (no pose jump) with commit still at the
// band end. These tests pin that pure rebase law:
//   1. no base (no rebuild this flight) behaves exactly like
//      fwdProgressForStagedS — same pacing, same parks;
//   2. with a base, arrival maps to 0, commit maps to 1, monotone between,
//      pre-base S clamps at 0, post-commit clamps at 1;
//   3. a base at/past the band end answers 1 (never a divide-by-zero or
//      a guess).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fwdProgressForStagedS,
  fwdProgressRebasedForS,
  TWIN_FWD_STAGED_MAX_PX,
} from '../src/ring2/sector.js';

const S_MAX = TWIN_FWD_STAGED_MAX_PX; // 700: commit edge

test('no base behaves exactly like the absolute S law', () => {
  for (const base of [null, undefined, 0, -5, NaN]) {
    for (const s of [0, 120, 240, 360, 480, 600, 700, 900]) {
      assert.equal(
        fwdProgressRebasedForS(s, base),
        fwdProgressForStagedS(s),
        `s=${s} base=${String(base)} must equal the absolute law`,
      );
    }
  }
});

test('arrival base maps to 0, commit maps to 1, monotone between', () => {
  const base = 120;
  assert.equal(fwdProgressRebasedForS(base, base), 0, 'arrival S sits at progress 0 (legs start at the live pose)');
  assert.equal(fwdProgressRebasedForS(S_MAX, base), 1, 'commit still lands at progress 1');
  let prev = -1;
  for (let s = base; s <= S_MAX; s += 20) {
    const p = fwdProgressRebasedForS(s, base);
    assert.ok(p >= prev, `monotone at s=${s} (p=${p} after ${prev})`);
    prev = p;
  }
  assert.equal(fwdProgressRebasedForS(0, base), 0, 'pre-base S clamps at 0 (scroll-back holds the rebuild pose)');
  assert.equal(fwdProgressRebasedForS(60, base), 0, 'mid pre-base S clamps at 0');
  assert.equal(fwdProgressRebasedForS(900, base), 1, 'post-commit S clamps at 1');
});

test('base at or past the band end answers 1 without dividing by zero', () => {
  // A rebuild landing exactly at commit means the flight is over: every S
  // reads progress 1 (commit), never NaN from the (1 - fBase) divisor.
  for (const s of [0, 120, S_MAX, 900]) {
    assert.equal(fwdProgressRebasedForS(s, S_MAX), 1, `s=${s} with base at commit reads done`);
  }
});

test('rebase preserves the absolute law shape (same knees, rescaled)', () => {
  // The rebased law is an affine rescale of the absolute law over
  // [f(base), 1]: relative positions inside the band are unchanged.
  const base = 120;
  const fBase = fwdProgressForStagedS(base);
  for (const s of [240, 360, 480, 600]) {
    const expected = (fwdProgressForStagedS(s) - fBase) / (1 - fBase);
    assert.ok(
      Math.abs(fwdProgressRebasedForS(s, base) - expected) < 1e-12,
      `s=${s} rescales the absolute knee exactly`,
    );
  }
});
