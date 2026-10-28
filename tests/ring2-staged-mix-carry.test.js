// tests/ring2-staged-mix-carry.test.js — the staged forward dissolve must
// not freeze mid-fade.
//
// DEFECT (owner, 2026-10-28): the forward staged journey stuck partway —
// zooming further never slid the terrain to the twin — and a fade overlay
// sat over the twin map. Root cause: the forward-flight tick rescales the
// scrub pose every frame (stagedLegScale -> poseAtRangePure) and drives the
// slider from the RESCALED pose (driveMix(fsp.mix)), but the rescale
// returned {eye,target} only, dropping mix. driveMix(undefined) ->
// Math.round -> NaN -> the clampMix non-finite fallback (50), so EVERY
// staged tick pinned the slider at 50: the dissolve froze mid-fade.
//
// THE LAW these tests pin (sector.js poseAtRangePure): a fixed-range
// rescale carries every non-pose field (mix, legIndex, t, ...) across, so
// the per-tick driveMix always sees the scrub law's mix.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);

import {
  poseAtRangePure,
  poseForScrubProgress,
  buildForwardLegs,
  stagedReleaseAnchors,
  HANDOFF_START_MIX,
  HANDOFF_END_MIX,
} from '../src/ring2/sector.js';

const { clampMix } = await import('../src/ring2/mix.js');

const R_LOCK = 24769; // frameRange(Z_HANDOFF) at an 800px viewport

function poseAt(tx, ty, tz, range, polarDeg) {
  const p = (polarDeg * Math.PI) / 180;
  return { eye: { x: tx, y: ty + range * Math.cos(p), z: tz + range * Math.sin(p) }, target: { x: tx, y: ty, z: tz } };
}

test('rescaled pose keeps mix (the staged tick drives the slider from it)', () => {
  const p = { ...poseAt(0, 0, 0, 30000, 30), mix: 37.5 };
  const q = poseAtRangePure(p, R_LOCK);
  assert.equal(q.mix, 37.5, 'mix survives the rescale');
  const got = Math.hypot(q.eye.x - q.target.x, q.eye.y - q.target.y, q.eye.z - q.target.z);
  assert.ok(Math.abs(got - R_LOCK) < 1e-6, `still rescaled to the lock (got ${got})`);
});

test('rescale carries all non-pose fields and never invents a mix', () => {
  const p = { ...poseAt(0, 0, 0, 30000, 30), mix: 12, legIndex: 1, t: 0.5 };
  const q = poseAtRangePure(p, R_LOCK);
  assert.equal(q.mix, 12);
  assert.equal(q.legIndex, 1);
  assert.equal(q.t, 0.5);
  // A pose with no mix still has no mix (no invented dissolve step).
  const bare = poseAtRangePure(poseAt(0, 0, 0, 30000, 30), R_LOCK);
  assert.equal(bare.mix, undefined);
  assert.deepEqual(bare.target, poseAt(0, 0, 0, 30000, 30).target);
});

test('staged S sweep: driveMix never receives undefined/NaN (no pin at 50)', () => {
  const locked = stagedReleaseAnchors({
    startPose: poseAt(0, 0, 0, R_LOCK, 45),
    mid: poseAt(0, 0, 0, R_LOCK, 45),
    to: poseAt(0, 0, 0, R_LOCK, 45),
    range: R_LOCK,
  });
  const legs = buildForwardLegs({ startPose: locked.start, mid: locked.mid, to: locked.to });
  assert.ok(legs && legs.length, 'legs build');
  const seen = [];
  for (let i = 0; i <= 20; i++) {
    const fs = poseForScrubProgress(legs, i / 20);
    assert.ok(fs && Number.isFinite(fs.mix), `scrub pose carries mix at p=${i / 20}`);
    // Exactly what the staged forward tick does per frame.
    const fsp = poseAtRangePure(fs, R_LOCK);
    const v = fsp.mix;
    assert.ok(v !== undefined && !Number.isNaN(v), `rescaled mix defined at p=${i / 20} (was: driveMix->pin 50)`);
    assert.equal(v, fs.mix, `rescaled mix equals scrub mix at p=${i / 20}`);
    seen.push(clampMix(Math.round(v)));
  }
  // The dissolve actually travels: it opens at START and commits at END.
  assert.equal(seen[0], HANDOFF_START_MIX);
  assert.equal(seen[seen.length - 1], HANDOFF_END_MIX);
  assert.ok(Math.min(...seen) === HANDOFF_START_MIX && Math.max(...seen) === HANDOFF_END_MIX,
    'dissolve spans the full band instead of a flat 50');
});
