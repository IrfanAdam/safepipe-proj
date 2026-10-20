// Rail unit-label regression tests · [plan:2026-10-18_172008-supabase-scheduling-migration.md#phase-5-rev]
// A numberless head carrying a {#phase-…} anchor (exceptional trailing
// phase, e.g. a closeout/eval section) labels Phase by position — never
// Task, which would mix both units at first level.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unitLabel } from '../src/changelog/changelog-titles.js';

describe('unitLabel', () => {
  it('labels Phase/Task/Step heads verbatim', () => {
    assert.equal(unitLabel('Phase 4 — Sync worker', 3), 'Phase 04');
    assert.equal(unitLabel('Task 10: Upsert + event log', 9), 'Task 10');
    assert.equal(unitLabel('Step 0 — Baseline', 0), 'Step 00');
  });
  it('labels a phase-anchored closeout head as Phase by position', () => {
    assert.equal(unitLabel('Closeout note {#phase-5-rev}', 5), 'Phase 06');
  });
  it('keeps the Task fallback for non-phase anchors', () => {
    assert.equal(unitLabel('Follow-up polish {#follow-up}', 4), 'Task 05');
    assert.equal(unitLabel('File map', 6), 'Task 07');
  });
});
