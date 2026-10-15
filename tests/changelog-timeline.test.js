// Timeline pure-pipeline tests · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#task-1]
// Node over the real corpus (fs-read .hermes/plans + manifest/history JSON —
// no vite glob) plus synthetic fixtures. Commit matching is hits-identical
// (anchorHit + first-section rule, cf. changelog-links.js hits).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { split, state, isDone, buildState, parseGates, anchorHit, parseDue, dueOf } from '../src/changelog/changelog-parse.js';
import { MERGE_GAP, activeDatesOf, boutsOf, ghostOf, planSummary, boutSummary, planTip, evalsOf } from '../src/changelog/changelog-timeline.js';
import { tipOf, descOf } from '../src/changelog/changelog-titles.js';
import { dueEditText, duePreviewEdit } from '../src/changelog/changelog-events.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plansDir = join(root, '.hermes', 'plans');
const manifest = JSON.parse(readFileSync(join(root, 'src/ds/plan-manifest.json'), 'utf8'));
const history = JSON.parse(readFileSync(join(root, 'src/ds/plan-history.json'), 'utf8'));
const files = readdirSync(plansDir).filter((f) => f.endsWith('.md')).sort();
const metaDate = (f) => ((f.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '');

const loadPlan = (file) => {
  const raw = readFileSync(join(plansDir, file), 'utf8');
  const sprints = split(raw);
  sprints.forEach((s, i) => {
    s.commits = manifest.commits.filter((c) => c.plan === file && (c.anchor ? anchorHit(s.body, c.anchor) : i === 0));
  });
  return { file, date: metaDate(file), raw, sprints, commits: manifest.commits.filter((c) => c.plan === file), revs: history[file] || [] };
};
const corpus = files.map(loadPlan);
const TODAY = '2026-10-15';

// Synthetic fixture: one open section with a Due, one done section whose Due
// must be ignored, dated commits + revs.
const synth = () => {
  const open = {
    head: 'Task 1 — Open work',
    body: '## Task 1 — Open work\n*Due: 2026-10-25*\n- [ ] **a** detail\n- [x] **b** finished\n{#task-1}',
    commits: [{ sha: 'aaa', date: '2026-10-20' }, { sha: 'bbb', date: '2026-10-21' }],
  };
  const done = {
    head: 'Task 2 — Shipped ✓ done',
    body: '## Task 2 — Shipped ✓ done\n*Due: 2026-10-22*\n- [x] **c** finished\n{#task-2}',
    commits: [{ sha: 'ccc', date: '2026-10-18' }],
  };
  return {
    file: '2026-10-20_000000-synth.md', date: '2026-10-20', title: 'Synth plan', goal: 'Prove the model.',
    raw: '# Synth\n\n**Goal:** Prove the model.\n\n## Task 1 — Open work\n*Due: 2026-10-25*\n- [ ] **a** detail\n\n- REF GATE 1 (verify): ✓ PASSED — “ok” · rev 2026-10-21 “reworded the task”\n',
    sprints: [open, done],
    commits: [...open.commits, ...done.commits],
    revs: [{ sha: 'rrr', date: '2026-10-19' }],
  };
};

describe('MERGE_GAP frozen', () => {
  it('equals 3', () => assert.equal(MERGE_GAP, 3));
});

describe('parseDue', () => {
  it('accepts a valid Due line', () => assert.equal(parseDue('prose\n*Due: 2026-10-20*\nmore'), '2026-10-20'));
  it('rejects malformed / out-of-range dates, never throws', () => {
    for (const bad of ['*Due: soon*', '*Due: 2026-13-01*', '*Due: 2026-10-32*', '*Due: 2100-01-01*',
      '*Due: 2026-02-30*', '*Due: 2026-10-2*', '**Due: 2026-10-20**', 'Due: 2026-10-20', '*Due: YYYY-MM-DD*',
      '*due: 2026-10-20*']) assert.equal(parseDue(`x\n${bad}\ny`), null, bad);
    assert.doesNotThrow(() => parseDue(null));
    assert.equal(parseDue(null), null);
  });
  it('is idempotent under duplicate lines (first wins)', () => {
    assert.equal(parseDue('*Due: 2026-10-20*\n*Due: 2026-11-01*'), '2026-10-20');
  });
  it('ignores inline mentions (own line only)', () => {
    assert.equal(parseDue('see *Due: 2026-10-20* for details'), null);
  });
});

describe('dueOf', () => {
  it('honors Due on incomplete sections (## and ### levels)', () => {
    assert.equal(dueOf({ head: 'Task 1 — A', body: '## Task 1 — A\n*Due: 2026-10-20*\n- [ ] **a** x' }), '2026-10-20');
    assert.equal(dueOf({ head: 'Task 1: A', body: '### Task 1: A\n*Due: 2026-10-20*\n- [ ] **a** x' }), '2026-10-20');
  });
  it('ignores Due on done / cancelled sections', () => {
    assert.equal(dueOf({ head: 'Task 1 — A ✓ done', body: '## Task 1 — A\n*Due: 2026-10-20*\n- [x] **a** x' }), null);
    assert.equal(dueOf({ head: 'Task 1 — A ✗ cancelled', body: '## Task 1 — A\n*Due: 2026-10-20*\n- [ ] **a** x' }), null);
    assert.equal(dueOf({ head: 'Task 1 — A', body: '## Task 1 — A\n*Due: 2026-10-20*\n- [x] **a** x' }), null);
    assert.equal(dueOf(null), null);
  });
  it('finds zero Dues in the real corpus (no false positives)', () => {
    let n = 0;
    for (const p of corpus) for (const s of p.sprints) if (dueOf(s) !== null) n++;
    assert.equal(n, 0);
  });
});

describe('boutsOf', () => {
  it('merges runs with internal gaps ≤ 3d into streaks', () => {
    const b = boutsOf(['2026-10-03', '2026-10-01', '2026-10-02', '2026-10-10']);
    assert.deepEqual(b, [
      { kind: 'streak', start: '2026-10-01', end: '2026-10-03', dates: ['2026-10-01', '2026-10-02', '2026-10-03'] },
      { kind: 'sporadic', start: '2026-10-10', end: '2026-10-10', dates: ['2026-10-10'] },
    ]);
  });
  it('treats a gap of exactly 3d as one bout, 4d as a split', () => {
    assert.equal(boutsOf(['2026-10-01', '2026-10-04']).length, 1);
    assert.equal(boutsOf(['2026-10-01', '2026-10-05']).length, 2);
  });
  it('returns [] for empty input and dedupes', () => {
    assert.deepEqual(boutsOf([]), []);
    assert.deepEqual(boutsOf(['2026-10-01', '2026-10-01']), [
      { kind: 'sporadic', start: '2026-10-01', end: '2026-10-01', dates: ['2026-10-01'] },
    ]);
  });
});

describe('real corpus bouts', () => {
  it('every plan yields sorted unique dates and well-formed bouts', () => {
    let streaks = 0, sporadics = 0;
    for (const p of corpus) {
      const dates = activeDatesOf(p);
      assert.ok(dates.includes(p.date), `${p.file} misses its plan date`);
      assert.deepEqual(dates, [...new Set(dates)].sort(), `${p.file} not sorted-unique`);
      for (const b of boutsOf(dates)) {
        assert.ok(['streak', 'sporadic'].includes(b.kind));
        assert.equal(b.start, b.dates[0]);
        assert.equal(b.end, b.dates[b.dates.length - 1]);
        if (b.kind === 'sporadic') assert.equal(b.dates.length, 1); else streaks++;
        if (b.kind === 'sporadic') sporadics++;
      }
      console.log(`  ${p.file.slice(0, 16)} dates=${dates.length} bouts=${boutsOf(dates).map((b) => `${b.kind}:${b.start}→${b.end}`).join(' | ')}`);
    }
    assert.ok(streaks >= 1, 'need ≥1 streak in corpus');
    assert.ok(sporadics >= 1, 'need ≥1 sporadic in corpus');
  });
});

describe('ghostOf', () => {
  it('is null pre-Due across the whole corpus', () => {
    for (const p of corpus) assert.equal(ghostOf(p, TODAY), null, p.file);
  });
  it('never ghosts done plans even with a Due line', () => {
    const p = synth();
    p.sprints = [p.sprints[1]];
    p.commits = p.sprints[0].commits;
    assert.equal(ghostOf(p, TODAY), null);
  });
  it('flags overdue fixtures and honors from=max(lastActive,today)', () => {
    const p = synth();
    const g = ghostOf(p, TODAY);
    assert.deepEqual(g, { from: '2026-10-21', to: '2026-10-25', overdue: false });
    p.sprints[0].body = p.sprints[0].body.replace('2026-10-25', '2026-10-01');
    assert.deepEqual(ghostOf(p, TODAY), { from: '2026-10-21', to: '2026-10-01', overdue: true });
    const early = synth();
    early.commits = [];
    early.sprints.forEach((s) => { s.commits = []; });
    early.revs = [];
    early.date = '2026-09-01';
    assert.deepEqual(ghostOf(early, TODAY), { from: TODAY, to: '2026-10-25', overdue: false });
  });
});

describe('summaries', () => {
  it('planSummary matches manual counts on a real plan', () => {
    const p = corpus.find((x) => x.file.startsWith('2026-10-07_130000'));
    const s = planSummary(p, TODAY);
    assert.deepEqual(Object.keys(s).sort(), ['commits', 'due', 'evals', 'overdue', 'range', 'revs', 'status', 'title']);
    assert.equal(s.commits, manifest.commits.filter((c) => c.plan === p.file).length);
    assert.equal(s.revs, (history[p.file] || []).length);
    assert.equal(s.status, buildState(p.sprints));
    assert.ok(s.title && typeof s.title === 'string');
    assert.ok(s.range.startsWith(activeDatesOf(p)[0]));
    assert.equal(s.due, null);
    assert.equal(s.overdue, false);
    assert.equal(typeof s.evals, 'number');
  });
  it('evals counts gate rev notes + feedback blocks', () => {
    assert.equal(evalsOf(synth().raw), 1); // 1 × `· rev` gate note, 0 fb blocks
    const withFb = `${synth().raw}\n### Feedback\n- fix the wording\n`;
    assert.equal(evalsOf(withFb), 2);
    assert.equal(evalsOf(''), 0);
  });
  it('boutSummary on a singleton filters to that single day', () => {
    const p = synth();
    const bout = { kind: 'sporadic', start: '2026-10-21', end: '2026-10-21', dates: ['2026-10-21'] };
    const s = boutSummary(p, bout, TODAY);
    assert.equal(s.commits, 1);
    assert.equal(s.revs, 0);
    assert.equal(s.status, state(p.sprints[0].body));
    assert.equal(s.range, '2026-10-21');
    assert.equal(s.done, '2026-10-21');
    assert.equal(s.complete, isDone(s.status));
    assert.equal(s.title, planSummary(p, TODAY).title);
  });
});

describe('tips stay clean', () => {
  it('no newlines, **, backticks, links or {#anchors} anywhere in the corpus', () => {
    for (const p of corpus) {
      for (const s of p.sprints) {
        const t = tipOf(s.head, s.body, 100);
        assert.ok(!/[\n\r]/.test(t), `newline in tip of ${p.file}`);
        assert.ok(!t.includes('**') && !t.includes('{#') && !t.includes('`'), `markup in tip of ${p.file}: ${t}`);
      }
      const pt = planTip(p);
      assert.ok(!/[\n\r]/.test(pt ?? ''));
      assert.ok(!(pt || '').includes('{#'));
    }
  });
  it('planTip prefers the first incomplete section, falls back to goal', () => {
    const p = synth();
    assert.ok(planTip(p).length > 0);
    assert.equal(planTip({ sprints: [], goal: 'Shiny **goal** here {#x}' }), 'Shiny goal here');
    assert.equal(planTip({ sprints: [] }), '');
  });
});

describe('gate verdicts ignore backticked code spans', () => {
  const gates = (line) => parseGates(line + '\nBody here');
  it('backticked PREFLIGHT FAIL stays open, bare FAIL fails, tick PASSED passes', () => {
    assert.equal(gates('- REF GATE 1: green, no `PREFLIGHT FAIL`.')[0].state, 'open');
    assert.equal(gates('- REF GATE 1: green, FAIL found')[0].state, 'failed');
    assert.equal(gates('- REF GATE 1: green ✓ PASSED')[0].state, 'passed');
  });
});

describe('dueEditText respects the head/Tags line', () => {
  const raw = '## Task 1 — Head\n*Tags: Tooling*\n\nBody text\n';
  it('inserts after a following Tags line, else directly under the head', () => {
    const withTags = dueEditText(raw, 'Task 1 — Head', '2026-10-22').split('\n');
    assert.equal(withTags[2], '*Due: 2026-10-22*');
    assert.equal(withTags[1], '*Tags: Tooling*');
    const plain = dueEditText('## Task 1 — Head\n\nBody\n', 'Task 1 — Head', '2026-10-22').split('\n');
    assert.equal(plain[1], '*Due: 2026-10-22*');
  });
  it('replaces without duplicating and clears exactly', () => {
    const once = dueEditText(raw, 'Task 1 — Head', '2026-10-22');
    const twice = dueEditText(once, 'Task 1 — Head', '2026-10-23');
    assert.equal(twice.split('\n').filter((l) => /^\s*\*Due:/.test(l)).length, 1);
    assert.ok(twice.includes('*Due: 2026-10-23*'));
    assert.equal(dueEditText(twice, 'Task 1 — Head', null), raw);
  });
});

describe('duePreviewEdit fallback for norm-synthesized bodies', () => {
  // ###-fallback plans (e.g. production-ready): norm() consumes the raw
  // heading into checkbox items, so dueEditText no-ops on the live body.
  const fb = (file) => {
    const p = corpus.find((x) => x.file === file);
    assert.ok(p, 'corpus has ' + file);
    return p;
  };
  it('file path edits all sections; live fallback round-trips set/clear', () => {
    const p = fb('2026-10-07_120000-safepipe-production-ready.md');
    const open = p.sprints.filter((s) => { const st = state(s.body); return st && !isDone(st); });
    assert.ok(open.length >= 10, 'expected the 10 open tasks, got ' + open.length);
    for (const s of open) {
      assert.equal(dueEditText(s.body, s.head, '2026-10-22'), s.body, 'documents the live-body no-op for ' + s.head);
      const set = duePreviewEdit(s.body, s.head, '2026-10-22');
      assert.notEqual(set, s.body, 'preview set edits ' + s.head);
      assert.equal(parseDue(set), '2026-10-22');
      assert.notEqual(dueOf({ head: s.head, body: set }), null);
      assert.equal(ghostOf({ ...p, sprints: p.sprints.map((x) => x === s ? { ...x, body: set } : x) }, TODAY) === null, false);
      assert.equal(duePreviewEdit(set, s.head, null), s.body, 'clear restores ' + s.head);
    }
  });
  it('every incomplete corpus section round-trips (expect all editable)', () => {
    let open = 0, edited = 0;
    for (const p of corpus) {
      for (const s of p.sprints) {
        const st = state(s.body);
        if (!st || isDone(st)) continue;
        open++;
        const set = duePreviewEdit(s.body, s.head, '2026-10-22');
        if (set !== s.body && parseDue(set) === '2026-10-22'
          && duePreviewEdit(set, s.head, null) === s.body) edited++;
      }
    }
    assert.equal(edited, open, `${edited}/${open} incomplete sections round-trip`);
  });
  it('descOf never surfaces a Due line as the description', () => {
    assert.equal(descOf('*Due: 2026-10-22*\n- [ ] **1 X** detail'), '');
  });
});
