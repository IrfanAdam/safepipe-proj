// Detail-renderer regression tests · [plan:2026-10-19_150735-changelog-readability.md#phase-1]
// Display-only: block structure survives (bullets→ul, numbered→ol,
// fences→pre), fields order canonically, DONE comes from the head mark only,
// duplicate anchors dedupe, gates show their own verdict.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { split } from '../src/changelog/changelog-parse.js';
import { parseGates } from '../src/changelog/changelog-parse.js';
import {
  sectionRaw, stripGateThread, renderSection, anchorOwners, gateSuffix, fmtInline, shipGatesShut,
} from '../src/changelog/changelog/raw-detail.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plansDir = join(root, '.hermes', 'plans');

const count = (html, tag) => (html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;

describe('block structure', () => {
  it('file bullets render as a nested list, not run-on text', () => {
    const raw = [
      '## Phase 1 — X {#phase-1}', '',
      '### Task 1: A ✓ done `abc1234`', '',
      '**Objective:** Do A.', '',
      '**Files:**', '- Create: `a.js`', '- Modify: `b.js`', '',
      '**Verify:** green.',
    ].join('\n');
    const { body } = renderSection(raw, {});
    assert.ok(body.includes('<ul><li>Create: <code>a.js</code></li><li>Modify: <code>b.js</code></li></ul>'), body);
    assert.equal((body.match(/<ul>/g) || []).length, 1, `duplicated list: ${body}`);
    assert.ok(body.includes('<details class="ds-task-fold">'), body);
    assert.ok(!body.includes('ds-acc-prev') && !body.includes('is-acc'), `no FILES chrome: ${body}`);
  });
  it('numbered steps render as an ordered list', () => {
    const raw = [
      '## Phase 1 — X {#phase-1}', '',
      '### Task 1: A', '',
      '**Steps:**', '1. First', '2. Second', '3. Third',
    ].join('\n');
    const { body } = renderSection(raw, {});
    assert.ok(body.includes('<ol><li>First</li><li>Second</li><li>Third</li></ol>'), body);
  });
  it('fences render as pre with newlines intact', () => {
    const raw = [
      '## Phase 1 — X {#phase-1}', '',
      '### Task 1: A', '',
      '**Contract:**', '```sql', 'create table t (', '  id int', ');', '```',
    ].join('\n');
    const { body } = renderSection(raw, {});
    assert.ok(body.includes('<pre><code class="language-sql">create table t (\n  id int\n);</code></pre>'), body);
  });
  it('inline multi-label paragraphs split into fields', () => {
    const raw = [
      '## Task 4 — Q', '',
      '**Objective:** Executable forms.', '**Files:** Create `a.js`; create `b.js`.', '',
      '1. Mine live', '2. Verify: all green',
    ].join('\n');
    const { body } = renderSection(raw, {});
    assert.ok(body.includes('<p>Executable forms.</p>'), 'objective leads: ' + body);
    assert.ok(body.includes('<span class="ds-f-t">Files</span>'), body);
    assert.ok(body.includes('<ol>'), body);
  });
  it('fields order canonically regardless of author order', () => {
    const raw = [
      '## Phase 1 — X {#phase-1}', '',
      '### Task 1: A', '',
      '**Verify:** green.', '',
      '**Files:**', '- Create: `a.js`',
    ].join('\n');
    const { body } = renderSection(raw, {});
    assert.ok(body.indexOf('ds-f-t">Files<') < body.indexOf('ds-f-t">Verify<'), body);
  });
});
  it('the task itself is the fold: header + status in, everything unfolded', () => {
    const raw = [
      '## Phase 1 — X {#phase-1}', '',
      '### Task 1: A', '',
      '**Files:** Create `a.js`.', '',
      '1. First step', '2. Second step',
    ].join('\n');
    const { body } = renderSection(raw, {});
    assert.equal((body.match(/<details/g) || []).length, 1, body);
    assert.ok(body.includes('<summary class="ds-acc-head"><span class="ds-box is-open"></span><h3>A</h3>'), body);
    assert.ok(!body.includes('ds-acc-prev'), `no trigger previews: ${body}`);
    assert.ok(body.includes('<ol><li>First step</li><li>Second step</li></ol>'), body);
    assert.ok(body.indexOf('<div class="ds-acc-body">') < body.indexOf('<ol>'), 'steps belong inside the fold: ' + body);
  });
  it('wrapped steps stay one list (domain Task 4 shape)', () => {
    const raw = [
      '## Task 4 — Q ✓ done', '',
      '**Files:** Create `a.js`.', '',
      '1. Mine all labels', '   wrapped continuation here', '   more wrap', '2. Next', '3. Verify: green',
    ].join('\n');
    const { body } = renderSection(raw, {});
    assert.equal((body.match(/<ol>/g) || []).length, 1, 'split ol: ' + body);
    assert.ok(body.includes('<li>Mine all labels wrapped continuation here more wrap</li>'), body);
    assert.ok(body.includes('<li>Verify: green</li>'), body);
  });
  it('indented lines continue the open list item', () => {
    const raw = [
      '## Phase 1 — X {#phase-1}', '',
      '### Task 1: A', '',
      '**Steps:**', '1. Mine all labels', '   wrapped continuation here', '2. Next',
    ].join('\n');
    const { body } = renderSection(raw, {});
    assert.ok(body.includes('<li>Mine all labels wrapped continuation here</li>'), body);
  });
  it('task-less sections flow expanded: Objective, then Files, then steps', () => {
    const raw = [
      '## Task 4 — Q ✓ done', '',
      '*Shipped in abc.*', '',
      '**Objective:** Do things well.', '**Files:** Create `a.js`.', '',
      '1. First', '2. Second',
    ].join('\n');
    const { head, body } = renderSection(raw, {});
    assert.ok(head.includes('✓ DONE'), head);
    assert.ok(!body.includes('<details'), 'section bodies flow, never fold: ' + body);
    const oi = body.indexOf('Do things well.');
    const fi = body.indexOf('ds-f-t">Files<');
    const oli = body.indexOf('<ol>');
    assert.ok(oi !== -1 && fi !== -1 && oli !== -1, body);
    assert.ok(oi < fi && fi < oli, 'order: objective, files, steps: ' + body);
  });

describe('task headers', () => {
  const taskBody = (head) => renderSection(['## Phase 1 — X {#phase-1}', '', head, '', '**Verify:** green.'].join('\n'), {}).body;
  it('colon heads render box + name + inline caret, no accent', () => {
    const body = taskBody('### Task 1: A ✓ done `abc1234`');
    assert.ok(body.includes('<summary class="ds-acc-head"><span class="ds-box">✓</span><h3>A</h3><span class="ds-caret">›</span>'), body);
    assert.ok(!body.includes('ds-status') && !body.includes('DONE'), body);
    assert.equal(count(body, 'input'), 0, body);
    assert.ok(!body.includes('<strong>'), body);
  });
  it('twin heads check the box without showing the shipped sha', () => {
    const body = taskBody('### Task 4 ✓ done — shipped c557479 · Semantic zoom');
    assert.ok(body.includes('<span class="ds-box">✓</span><h3>Semantic zoom</h3>'), body);
    assert.ok(!body.includes('(c557479)') && !body.includes('DONE'), body);
  });
  it('smooth heads check the box without showing the bare sha', () => {
    const body = taskBody('### Task 1 ✓ done d27f94c');
    assert.ok(body.includes('<span class="ds-box">✓</span><h3>Task 1</h3>'), body);
    assert.ok(!body.includes('(d27f94c)') && !body.includes('DONE'), body);
  });
  it('unmarked tasks show empty box + name + caret', () => {
    const body = taskBody('### Task 4: Skill sync + ship');
    assert.ok(body.includes('<summary class="ds-acc-head"><span class="ds-box is-open"></span><h3>Skill sync + ship</h3><span class="ds-caret">›</span>'), body);
    assert.ok(!body.includes('ds-status'), body);
  });
  it('cancelled tasks box muted, no DONE word', () => {
    const body = taskBody('### Task 9: Old thing ✗ cancelled');
    assert.ok(body.includes('<span class="ds-box ds-is-cancelled">✗</span><h3>Old thing</h3>'), body);
    assert.ok(!body.includes('DONE'), body);
  });
  it('tasks share one ds-tasks container, in order', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '', '### Task 2: B'].join('\n'), {});
    assert.ok(body.includes('<div class="ds-tasks">'), body);
    assert.equal(count(body, 'section'), 2, body);
    assert.ok(!body.includes('<details'), 'content-less tasks render bare headers');
    assert.ok(body.indexOf('<h3>A</h3>') < body.indexOf('<h3>B</h3>'), body);
  });
});

describe('task folds', () => {
  it('long text unfolds inside the task fold, no preview chrome', () => {
    const long = 'word '.repeat(40).trim();
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '', `**Verify:** ${long}`].join('\n'), {});
    assert.equal((body.match(/<details/g) || []).length, 1, body);
    assert.ok(!body.includes('ds-acc-prev'), `no preview chrome: ${body}`);
    assert.ok(body.includes(long), body);
  });
  it('code blocks unfold inside the task fold', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '', '**Contract:**', '```sql', 'select 1;', '```'].join('\n'), {});
    assert.ok(body.includes('<pre><code class="language-sql">select 1;</code></pre>'), body);
    assert.ok(!body.includes('ds-acc-prev'), body);
  });
  it('one fold per task: fields share it unfolded in canonical order', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '',
      '**Verify:** green.', '**Changes:** tweaked the thing.', '**Files:**', '- Create: `a.js`', '- Modify: `b.js`'].join('\n'), {});
    assert.equal((body.match(/<details/g) || []).length, 1, body);
    assert.ok(body.includes('<h3>A</h3>'), body);
    const fi = body.indexOf('ds-f-t">Files<');
    const ci = body.indexOf('ds-f-t">Changes<');
    const vi = body.indexOf('ds-f-t">Verify<');
    assert.ok(fi !== -1 && ci !== -1 && vi !== -1, body);
    assert.ok(fi < ci && ci < vi, 'Files, Changes, Verify: ' + body);
  });
  it('accordions start closed', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '', '**Files:**', '- Create: `a.js`'].join('\n'), {});
    assert.ok(!/<details[^>]*open/.test(body), body);
  });
  it('without Files there is no trigger line — steps unfold inside', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '',
      '**Steps:**', '1. First', '2. Second', '**Verify:** green.'].join('\n'), {});
    assert.equal((body.match(/<details/g) || []).length, 1, body);
    assert.ok(body.includes('<h3>A</h3>'), body);
    assert.ok(!body.includes('ds-acc-prev'), body);
    assert.ok(body.includes('<ol><li>First</li><li>Second</li></ol>'), body);
  });
  it('a task with content folds under its own header, fields or not', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '',
      'Just a lead line.', '', '1. First', '2. Second'].join('\n'), {});
    assert.equal((body.match(/<details/g) || []).length, 1, body);
    assert.ok(body.includes('<h3>A</h3>'), body);
    assert.ok(body.includes('<p>Just a lead line.</p>'), body);
    assert.ok(body.includes('<ol>'), body);
  });
  it('prose sections with no fields stay expanded', () => {
    const { body } = renderSection(['## Current context', '', 'Plain para one.', '', '- a bullet', '- another'].join('\n'), {});
    assert.ok(!body.includes('<details'), body);
    assert.ok(body.includes('<p>Plain para one.</p>'), body);
    assert.ok(body.includes('<ul><li>a bullet</li><li>another</li></ul>'), body);
  });
});

describe('honest done', () => {
  it('marked heads show DONE, unmarked heads show none', () => {
    const done = renderSection('## Phase 1 — X ✓ done {#phase-1}\n\nbody', {});
    assert.ok(done.head.includes('✓ DONE'), done.head);
    const open = renderSection('## Phase 5 — Y {#phase-5}\n\nbody', {});
    assert.ok(!open.head.includes('DONE'), open.head);
  });
  it('unmarked heads with an open gate show the gate tag only', () => {
    const { head } = renderSection('## Phase 5 — Y {#phase-5}\n\nbody', { gateSuffix: ' · GATE OPEN' });
    assert.ok(head.includes('GATE OPEN'), head);
    assert.ok(!head.includes('DONE'), head);
  });
  it('no phantom checkbox repeats a Task-headed section', () => {
    const { head, body } = renderSection('## Task 4 — Q ✓ done\n\n**Objective:** X.', {});
    assert.ok(head.includes('✓ DONE'), head);
    assert.equal(count(body, 'input'), 0, body);
  });
});

describe('inline spans', () => {
  it('code spans render and never feed bold/em pairing', () => {
    assert.equal(fmtInline('`section_key = *normHead(head)*` from `x`'),
      '<code>section_key = *normHead(head)*</code> from <code>x</code>');
  });
  it('bold then em, links collapse to text', () => {
    assert.equal(fmtInline('**A** and *b* plus [c](http://x)'),
      '<strong>A</strong> and <em>b</em> plus c');
  });
});

describe('gates + anchors', () => {
  it('stripGateThread drops the gate span through the anchor', () => {
    const raw = '## Phase 1 — X {#phase-1}\n\ntext\n\n- REF GATE 1: open it. Evidence: `abc`.\n\n{#phase-1}\n';
    const out = stripGateThread(raw);
    assert.ok(!out.includes('REF GATE'), out);
    assert.ok(out.includes('text'), out);
  });
  it('gateSuffix shows the phase’s own verdict with rev counts', () => {
    const gs = [
      { n: 1, state: 'open', note: 'first' },
      { n: 5, state: 'open', note: 'ship' },
      { n: 5, state: 'open', note: '· rev 2026-10-14 x. Verdict: OPEN' },
    ];
    assert.equal(gateSuffix(gs, 5), ' · GATE OPEN · 1 rev');
    assert.equal(gateSuffix(gs, 1), ' · GATE OPEN');
    assert.equal(gateSuffix([{ n: 2, state: 'passed', note: '✓ PASSED' }], 2), ' ✓ GATE PASSED');
    assert.equal(gateSuffix(gs, 9), '');
  });
  it('lowercase evidence prose is not a verdict', () => {
    const g = parseGates('- REF GATE 5 (ship): drill pass. Evidence: full suite 659 pass + 7 pre-existing fails.\n');
    assert.equal(g[0].state, 'open');
  });
  it('duplicate anchors dedupe to the first section', () => {
    const sprints = [
      { head: 'Phase 5 — Cutover {#phase-5}', body: 'x {#phase-5}' },
      { head: 'Phase 5 closeout note', body: 'y' },
    ];
    const { dup } = anchorOwners(sprints);
    assert.ok(!dup.has(0));
    assert.ok(dup.has(1), [...dup].join(','));
  });
});

describe('task-only sections', () => {
  const smoothish = ['## Task 1: Sticky login — log in once {#task-1}', '',
    '**Files:**', '- Modify: `a.js`.', '',
    '**Rules:**', '- No auto-open.', '',
    '**Verify:** refresh keeps session.', '',
    '### Task 1 ✓ done d27f94c'].join('\n');
  it('bare matching stamp rolls up: head DONE, no nested task', () => {
    const { head, body } = renderSection(smoothish, {});
    assert.ok(head.includes('✓ DONE'), head);
    assert.ok(!body.includes('ds-task-fold'), `no task-in-task: ${body}`);
    assert.ok(!body.includes('<h3>'), body);
  });
  it('stamp verdict cancelled rolls up too', () => {
    const raw = smoothish.replace('### Task 1 ✓ done d27f94c', '### Task 1 ✗ cancelled');
    const { head, body } = renderSection(raw, {});
    assert.ok(head.includes('✗ cancelled'), head);
    assert.ok(!body.includes('<h3>'), body);
  });
  it('same-name stamp rolls up, mismatched numbers stay bare', () => {
    const same = smoothish.replace('### Task 1 ✓ done d27f94c', '### Task 1: Sticky login ✓ done d27f94c');
    assert.ok(!renderSection(same, {}).body.includes('<h3>'), same);
    const other = smoothish.replace('### Task 1 ✓ done d27f94c', '### Task 9 ✓ done abc1234');
    const r = renderSection(other, {});
    assert.ok(r.body.includes('<h3>Task 9</h3>'), r.body);
    assert.ok(!r.head.includes('✓ DONE'), r.head);
  });
  it('orphan fields keep source order: Rules before Verify', () => {
    const { body } = renderSection(smoothish, {});
    const ri = body.indexOf('ds-f-t">Rules<');
    const vi = body.indexOf('ds-f-t">Verify<');
    assert.ok(ri !== -1 && vi !== -1 && ri < vi, body);
  });
  it('unknown labels keep authored position (contract before steps)', () => {
    const raw = ['## Task 2 — V', '',
      '**Files:**', '- Modify: `a.js`.', '',
      '**Behavior contract:**', '- Button behaves.', '',
      '**Steps:**', '1. First', '2. Second', '',
      '**Verify:** green.'].join('\n');
    const { body } = renderSection(raw, {});
    const fi = body.indexOf('ds-f-t">Files<');
    const ci = body.indexOf('ds-f-t">Behavior contract<');
    const si = body.indexOf('ds-f-t">Steps<');
    const vi = body.indexOf('ds-f-t">Verify<');
    assert.ok(fi !== -1 && ci !== -1 && si !== -1 && vi !== -1, body);
    assert.ok(fi < ci && ci < si && si < vi, `source order: ${body}`);
  });
  it('loose steps stay where written, not trailed after every field', () => {
    const raw = ['## Task 9 — Q', '',
      '**Files:**', '- Modify: `a.js`.', '',
      '1. First loose step', '2. Second loose step', '',
      '**Verify:** green.'].join('\n');
    const { body } = renderSection(raw, {});
    const fi = body.indexOf('ds-f-t">Files<');
    const oli = body.indexOf('<ol><li>First loose step</li>');
    const vi = body.indexOf('ds-f-t">Verify<');
    assert.ok(fi !== -1 && oli !== -1 && vi !== -1, body);
    assert.ok(fi < oli && oli < vi, `interleaved: ${body}`);
  });
  it('rollup skips gate lines: DONE joins the gate verdict', () => {
    const raw = ['## Task 1: A {#task-1}', '', '**Files:**', '- Modify: `a.js`.', '',
      '### Task 1 ✓ done abc1234'].join('\n');
    const suffix = ' · <span class="ds-gate">GATE OPEN</span>';
    const { head } = renderSection(raw, { gateSuffix: suffix });
    assert.ok(head.includes('✓ DONE'), head);
    assert.ok(head.includes('GATE OPEN'), head);
  });
  it('source order wins over canonical rank at section level', () => {
    const raw = ['## Task 9 — Q', '', '**Verify:** green.', '', '**Files:**', '- Create: `a.js`.'].join('\n');
    const { body } = renderSection(raw, {});
    assert.ok(body.indexOf('ds-f-t">Verify<') < body.indexOf('ds-f-t">Files<'), body);
  });
});

describe('title notes', () => {
  const noteTask = (head) => renderSection(['## Phase 1 — X {#phase-1}', '', head, '', '**Objective:** Do it well.', '', '**Files:**', '- Create: `a.js`.'].join('\n'), {}).body;
  it('prose paren leaves the header, leads the body', () => {
    const body = noteTask('### Task 1: Pre-flight — prove the gap ✓ done (docs/audit.md + 8 captures — see audit)');
    assert.ok(body.includes('<h3>Pre-flight — prove the gap</h3>'), body);
    assert.ok(!body.includes('docs/audit.md + 8 captures</h3>'), body);
    assert.ok(body.includes('<p>docs/audit.md + 8 captures — see audit</p>'), body);
    assert.ok(body.indexOf('<p>docs/audit.md') < body.indexOf('Do it well.'), `note first: ${body}`);
  });
  it('paren sha parses silently, never shown inline', () => {
    const body = noteTask('### Task 2: Terrain field v2 ✓ done (167a614)');
    assert.ok(body.includes('<span class="ds-box">✓</span><h3>Terrain field v2</h3>'), body);
    assert.ok(!body.includes('(167a614)'), body);
  });
  it('mixed paren becomes a note, box stays plain', () => {
    const body = noteTask('### Task 4: Elevation language ✓ done (167a614, scene-side; legend left for Task 8)');
    assert.ok(body.includes('<h3>Elevation language</h3>'), body);
    assert.ok(body.includes('<p>167a614, scene-side; legend left for Task 8</p>'), body);
    assert.ok(body.includes('<span class="ds-box">✓</span>'), body);
  });
  it('note-only task flows unfolded, never dropped or folded solo', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 8: Verification, docs, close-out ✓ done (wrap-up commit, see log)'].join('\n'), {});
    assert.ok(!body.includes('<details'), body);
    assert.ok(body.includes('<p>wrap-up commit, see log</p>'), body);
  });
  it('bold step heads open their own field, never glue into Files', () => {
    const raw = ['## Phase 1 — X {#phase-1}', '', '### Task 1: Pre-flight ✓ done', '',
      '**Files:**', '- Create: `a.js`.', '',
      '**Step 1: Capture before**', '', 'Run it.', '',
      '**Step 2: Module API** — wire these to views.'].join('\n');
    const { body } = renderSection(raw, {});
    assert.ok(body.includes('ds-f-t">Step 1<'), body);
    assert.ok(body.includes('ds-f-t">Step 2<'), body);
    assert.ok(body.includes('Capture before'), body);
    assert.ok(body.includes('wire these to views.'), body);
    const filesInline = body.slice(body.indexOf('ds-f-t">Files<'), body.indexOf('ds-f-t">Step 1<'));
    assert.ok(!filesInline.includes('Step 1:'), `no run-on: ${filesInline}`);
  });
  it('terrain-topo Task 1 steps stand apart (corpus)', () => {
    const raw = readFileSync(join(plansDir, '2026-10-06_153000-ops3d-terrain-topo.md'), 'utf8');
    const chunk = raw.slice(raw.indexOf('### Task 1: Pre-flight'), raw.indexOf('### Task 2:'));
    const { body } = renderSection(chunk, {});
    for (const n of [1, 2, 3, 4]) assert.ok(body.includes(`ds-f-t">Step ${n}<`), `Step ${n}: ${body.slice(0, 400)}`);
  });
});

describe('ship-gate seal', () => {
  it('gateless plans keep the old rule', () => {
    assert.equal(shipGatesShut([]), true);
    assert.equal(shipGatesShut([{ n: 1, state: 'open', paren: '', note: 'x' }]), true);
  });
  it('passed and waived ship gates read shut', () => {
    assert.equal(shipGatesShut([{ n: 4, state: 'passed', paren: 'ship', note: '✓ PASSED' }]), true);
    assert.equal(shipGatesShut([{ n: 4, state: 'waiver', paren: 'ship', note: 'PASSED by owner waiver' }]), true);
  });
  it('open and failed ship gates hold the card open', () => {
    assert.equal(shipGatesShut([{ n: 5, state: 'open', paren: 'ship', note: 'drill' }]), false);
    assert.equal(shipGatesShut([{ n: 5, state: 'failed', paren: 'ship', note: 'FAIL' }]), false);
  });
  it('rev lines never decide the seal', () => {
    assert.equal(shipGatesShut([{ n: 5, state: 'open', paren: 'ship', note: '· rev 2026-10-14 x' }]), true);
  });
  it('parseGates keeps the paren marker', () => {
    const g = parseGates('- REF GATE 5 (ship): drill pass.\n');
    assert.equal(g[0].paren, 'ship');
  });
  it('172008 and smooth ship gates stand open, timeline stands shut', () => {
    const read = (f) => readFileSync(join(plansDir, f), 'utf8');
    const g172008 = parseGates(read('2026-10-18_172008-supabase-scheduling-migration.md'));
    assert.equal(shipGatesShut(g172008), false);
    const gSmooth = parseGates(read('2026-10-17_180000-safepipe-smooth-scheduling.md'));
    assert.equal(shipGatesShut(gSmooth), false);
    const gTimeline = parseGates(read('2026-10-15_120000-safepipe-changelog-timeline.md'));
    assert.equal(shipGatesShut(gTimeline), true);
  });
});

describe('corpus sweep', () => {
  const files = readdirSync(plansDir).filter((f) => f.endsWith('.md')).sort();
  it('every split() section resolves raw text and renders clean', () => {
    let n = 0;
    for (const f of files) {
      const md = readFileSync(join(plansDir, f), 'utf8');
      for (const s of split(md)) {
        n++;
        const raw = sectionRaw(md, s.head);
        assert.ok(raw, `${f} · ${s.head.slice(0, 60)}`);
        const { head, body } = renderSection(raw, {});
        const html = head + body;
        assert.ok(html.length > 0, `${f} · ${s.head.slice(0, 60)}`);
        const prose = html.replace(/<code>[\s\S]*?<\/code>/g, '');
        assert.ok(!prose.includes('{#'), `${f} · anchor leak`);
        assert.ok(!/-\s*REF GATE/.test(prose), `${f} · gate leak`);
        assert.ok(!prose.includes('*Due:'), `${f} · due leak`);
        assert.ok(!html.includes('<dt>') && !html.includes('<dd>'), `${f} · dl leak`);
        assert.ok(!html.includes('<input'), `${f} · checkbox leak`);
        assert.ok(!html.includes('ds-acc-prev') && !html.includes('is-acc'), `${f} · FILES chrome leak`);
        for (const t of ['ul', 'ol', 'dl', 'p', 'pre', 'code', 'li', 'details', 'summary', 'section', 'div', 'span', 'h2', 'h3']) {
          assert.equal(count(html, t), count(html, '/' + t), `${f} · <${t}> imbalance`);
        }
      }
    }
    assert.ok(n > 40, `expected 40+ sections, saw ${n}`);
  });
});
