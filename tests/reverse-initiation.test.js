// tests/reverse-initiation.test.js — REF GATE 3 v3 re-eval defect 1:
// wheel-up reverse opened dead: the first ~9 notches past commit produced
// zero visible response (twin phase stuck at `done`, `atMax=false`) while
// free-orbit dolly ate the gestures up to the zoom clamp. Reverse-initiation
// is now notch-1 alive: the first outward wheel in `done` enters the staged
// reverse at ANY range and its delta advances progress on the same tick —
// symmetric with forward. Pinch stays native (clamp-only accumulated entry).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scrubProgressForWheel,
  TWIN_SCRUB_WHEEL_PX,
} from '../src/ring2/sector.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('notch-1 alive at the law level: the first outward notch advances from 0', () => {
  assert.equal(TWIN_SCRUB_WHEEL_PX, 600, 'journey budget is ~5 notches');
  const p1 = scrubProgressForWheel(0, -120);
  assert.ok(p1 > 0, 'the entering notch leaves progress 0');
  assert.equal(p1, 120 / TWIN_SCRUB_WHEEL_PX, 'one 120px notch = one notch of journey');
  assert.equal(scrubProgressForWheel(p1, 120), 0, 'one inward notch undoes it (symmetric exit)');
});

test('twin wheel lane: done-phase entry is not gated on the zoom clamp', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(
    !main.includes('if (!Number.isFinite(r) || !isAtMaxZoom(r)) { handoff.entryAccum = 0; if (!pinch) twinFlipToOrbit(e); return; }'),
    'no at-max gate diverts sub-clamp outward wheels to free-orbit dolly',
  );
  assert.ok(
    main.includes('if (!enterScrubReverse()) { twinFlipToOrbit(e); return; }'),
    'the first outward wheel enters the scrub reverse (orbit is the fallback, not the default)',
  );
  assert.ok(
    !main.includes('TWIN_SCRUB_ENTER_DELTA'),
    'no decisive-single-shot threshold holds back the first notch',
  );
});

test('twin wheel lane: inward still dollies, pinch still stays native', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(
    main.includes('if (dY >= 0) { handoff.entryAccum = 0; if (!pinch) twinFlipToOrbit(e); return; }'),
    'inward wheels still pass through to OrbitControls',
  );
  assert.ok(
    main.includes('if (!Number.isFinite(r) || !isAtMaxZoom(r)) { handoff.entryAccum = 0; return; }'),
    'pinch below the clamp stays native without entering',
  );
  assert.ok(
    main.includes('scrubEntryForDelta(handoff.entryAccum'),
    'pinch-out arrivals at the clamp still accumulate into the entry',
  );
});

test('twin wheel lane: the entering tick advances progress on the same tick', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(
    main.includes('sc.progress = scrubProgressForWheel(sc.progress, dY, { pinch });'),
    'the shared consume block still folds the entering delta into progress',
  );
  assert.ok(
    main.includes('paintScrubPose();\n    } catch { /* wheel never breaks input */ }'),
    'the entering tick paints the scrubbed pose immediately',
  );
});
