// Phase 2 pins — validation + shared-key parity, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScheduleBody, upsertSchedule } from '../api/schedule.js';
import { normHead } from '../src/logic/due-overrides.js';

test('valid body passes through', () => {
  const v = validateScheduleBody({ file: 'a.md', head: 'Task 1', due: '2026-10-20' });
  assert.equal(v.ok, true);
  assert.equal(v.due, '2026-10-20');
});

test('traversal file rejected', () => {
  assert.equal(validateScheduleBody({ file: '../x.md', head: 'Task 1' }).ok, false);
});

test('non-md file rejected', () => {
  assert.equal(validateScheduleBody({ file: 'a.txt', head: 'Task 1' }).ok, false);
});

test('bad due rejected, null due allowed', () => {
  assert.equal(validateScheduleBody({ file: 'a.md', head: 'T', due: '2026-13-40' }).ok, false);
  assert.equal(validateScheduleBody({ file: 'a.md', head: 'T', due: '2026-02-30' }).ok, false);
  assert.equal(validateScheduleBody({ file: 'a.md', head: 'T', due: null }).ok, true);
  assert.equal(validateScheduleBody({ file: 'a.md', head: 'T' }).ok, true);
});

test('empty head rejected', () => {
  assert.equal(validateScheduleBody({ file: 'a.md', head: '  ' }).ok, false);
});

test('section_key parity with shared core', () => {
  assert.equal(normHead(' Task  1 '), 'Task 1');
  assert.equal(normHead('Phase 06 — Lock {#phase-6}'), 'Phase 06 — Lock {#phase-6}');
});

test('upsert is idempotent on same idempotencyKey (stubbed fetch)', async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, o) => {
    calls.push(String(u));
    if (String(u).includes('/schedules?plan_file=eq')) {
      return { ok: true, json: async () => [{ plan_file: 'a.md', section_key: 'T', due: '2026-10-20', version: 2, idempotency_key: 'k1' }] };
    }
    return { ok: true, json: async () => ([]) };
  };
  try {
    const r = await upsertSchedule({ url: 'https://x.supabase.co', key: 'k', file: 'a.md', section_key: 'T', due: '2026-10-20', actor: 'owner', idempotencyKey: 'k1' });
    assert.equal(r.deduped, true);
    assert.equal(r.row.version, 2);
    assert.ok(calls.length === 1, 'no write on dedupe');
  } finally {
    globalThis.fetch = real;
  }
});
