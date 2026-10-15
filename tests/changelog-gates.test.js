// Gate-ownership regression tests · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#follow-up]
// A section is judged by its OWN gate (head number → gate number), never by
// its position in the section list. Positional index misattributed verdicts
// on Task-headed plans (Task 2 showed gate 1's PASSED, Task 3 showed gate 2's
// OPEN). Plan-linked commits whose anchor hits no section must stay visible
// as orphans (drawer "Further commits" group).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { split, anchorHit, gateNOf } from '../src/changelog/changelog-parse.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plansDir = join(root, '.hermes', 'plans');
const manifest = JSON.parse(readFileSync(join(root, 'src/ds/plan-manifest.json'), 'utf8'));

describe('gateNOf', () => {
  it('maps numbered heads to their own gate', () => {
    assert.equal(gateNOf('Task 3: Scheduling — date setter', 2), 3);
    assert.equal(gateNOf('Phase 03 — Hotspot launcher map', 9), 3);
    assert.equal(gateNOf('Phase 00 — Control panels', 9), 0);
    assert.equal(gateNOf('Step 0 — Live-fig setup', 9), 0);
    assert.equal(gateNOf('Task 10: Full verification', 9), 10);
  });
  it('falls back for numberless heads', () => {
    assert.equal(gateNOf('Follow-up polish', 7), 7);
    assert.equal(gateNOf('', 4), 4);
    assert.equal(gateNOf(null, 1), 1);
  });
});

describe('corpus gate ownership', () => {
  const files = readdirSync(plansDir).filter((f) => f.endsWith('.md')).sort();
  it('Phase-headed sections keep the legacy Phase-number mapping', () => {
    for (const f of files) {
      const md = readFileSync(join(plansDir, f), 'utf8');
      split(md).forEach((s, si) => {
        const legacy = (String(s.head || '').match(/Phase\s+(\d+)/i) || [])[1];
        if (legacy !== undefined) assert.equal(gateNOf(s.head, si), Number(legacy), `${f} · ${s.head}`);
      });
    }
  });
  it('timeline plan tasks own their own gates (not their positions)', () => {
    const md = readFileSync(join(plansDir, '2026-10-15_120000-safepipe-changelog-timeline.md'), 'utf8');
    const secs = split(md);
    assert.equal(secs.length, 4);
    secs.forEach((s, si) => {
      const m = s.head.match(/^Task\s+(\d+)/);
      assert.ok(m, `numbered head: ${s.head}`);
      assert.equal(gateNOf(s.head, si), Number(m[1]));
    });
    // The old positional rule put Task 2 at gate 1 and Task 3 at gate 2.
    assert.notEqual(gateNOf(secs[1].head, 1), 1);
    assert.notEqual(gateNOf(secs[2].head, 2), 2);
  });
  it('follow-up commits stay visible as section orphans', () => {
    const file = '2026-10-15_120000-safepipe-changelog-timeline.md';
    const md = readFileSync(join(plansDir, file), 'utf8');
    const secs = split(md);
    const seen = new Set();
    secs.forEach((s, i) => {
      for (const c of manifest.commits.filter((c) => c.plan === file && (c.anchor ? anchorHit(s.body, c.anchor) : i === 0))) seen.add(c.sha);
    });
    const orphans = manifest.commits.filter((c) => c.plan === file && !seen.has(c.sha));
    assert.ok(orphans.length > 0, 'expected orphan follow-up commits');
    assert.ok(orphans.every((c) => c.anchor === 'follow-up'));
  });
});
