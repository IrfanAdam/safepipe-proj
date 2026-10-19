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
    assert.ok(body.includes('<details'), `Files list should fold: ${body}`);
    assert.ok(body.includes('2 items'), body);
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
  it('a task with fields folds into one FILES accordion, loose steps inside', () => {
    const raw = [
      '## Phase 1 — X {#phase-1}', '',
      '### Task 1: A', '',
      '**Files:** Create `a.js`.', '',
      '1. First step', '2. Second step',
    ].join('\n');
    const { body } = renderSection(raw, {});
    assert.equal((body.match(/<details/g) || []).length, 1, body);
    assert.ok(body.includes('ds-f-t">Files<'), body);
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
  it('task-less sections fold with Objective first, then Files, then steps', () => {
    const raw = [
      '## Task 4 — Q ✓ done', '',
      '*Shipped in abc.*', '',
      '**Objective:** Do things well.', '**Files:** Create `a.js`.', '',
      '1. First', '2. Second',
    ].join('\n');
    const { head, body } = renderSection(raw, {});
    assert.ok(head.includes('✓ DONE'), head);
    const fold = body.slice(body.indexOf('<div class="ds-acc-body">'));
    const oi = fold.indexOf('Do things well.');
    const fi = fold.indexOf('ds-f-t">Files<');
    const oli = fold.indexOf('<ol>');
    assert.ok(oi !== -1 && fi !== -1 && oli !== -1, body);
    assert.ok(oi < fi && fi < oli, 'order: objective, files, steps: ' + body);
  });

describe('task headers', () => {
  const taskBody = (head) => renderSection(['## Phase 1 — X {#phase-1}', '', head, '', '**Verify:** green.'].join('\n'), {}).body;
  it('colon heads render h3 + DONE, no checkbox', () => {
    const body = taskBody('### Task 1: A ✓ done `abc1234`');
    assert.ok(body.includes('<section class="ds-subtask"><h3>Task 1 · A</h3>'), body);
    assert.ok(body.includes('✓ DONE (abc1234)'), body);
    assert.equal(count(body, 'input'), 0, body);
    assert.ok(!body.includes('<strong>'), body);
  });
  it('twin heads fold the shipped sha into DONE', () => {
    const body = taskBody('### Task 4 ✓ done — shipped c557479 · Semantic zoom');
    assert.ok(body.includes('<h3>Task 4 · Semantic zoom</h3>'), body);
    assert.ok(body.includes('✓ DONE (c557479)'), body);
  });
  it('smooth heads show the bare-sha provenance', () => {
    const body = taskBody('### Task 1 ✓ done d27f94c');
    assert.ok(body.includes('<h3>Task 1</h3>'), body);
    assert.ok(body.includes('✓ DONE (d27f94c)'), body);
  });
  it('unmarked tasks show h3 with no status line', () => {
    const body = taskBody('### Task 4: Skill sync + ship');
    assert.ok(body.includes('<h3>Task 4 · Skill sync + ship</h3>'), body);
    assert.ok(!body.includes('ds-status'), body);
  });
  it('cancelled tasks show the cancelled line', () => {
    const body = taskBody('### Task 9: Old thing ✗ cancelled');
    assert.ok(body.includes('✗ cancelled'), body);
    assert.ok(!body.includes('DONE'), body);
  });
  it('tasks share one ds-tasks container, in order', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '', '### Task 2: B'].join('\n'), {});
    assert.ok(body.includes('<div class="ds-tasks">'), body);
    assert.equal(count(body, 'section'), 2, body);
    assert.ok(body.indexOf('Task 1 · A') < body.indexOf('Task 2 · B'), body);
  });
});

describe('accordions', () => {
  it('long inline text folds with a truncated preview', () => {
    const long = 'word '.repeat(40).trim();
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '', `**Verify:** ${long}`].join('\n'), {});
    assert.ok(body.includes('<details class="ds-field is-acc">'), body);
    assert.ok(body.includes('…'), body);
    assert.equal(body.split(long).length - 1, 1, 'full text once (folded body), never in preview');
  });
  it('code blocks fold with a code preview', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '', '**Contract:**', '```sql', 'select 1;', '```'].join('\n'), {});
    assert.ok(body.includes('ds-acc-prev">code<'), body);
    assert.ok(body.includes('<pre><code class="language-sql">select 1;</code></pre>'), body);
  });
  it('one fold per task: mixed fields share it in canonical order', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '',
      '**Verify:** green.', '**Changes:** tweaked the thing.', '**Files:**', '- Create: `a.js`', '- Modify: `b.js`'].join('\n'), {});
    assert.equal((body.match(/<details/g) || []).length, 1, body);
    assert.ok(body.includes('ds-f-t">Files<'), 'FILES triggers: ' + body);
    assert.ok(body.includes('+2'), 'two more fields inside: ' + body);
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
  it('without Files the first field triggers', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '',
      '**Steps:**', '1. First', '2. Second', '**Verify:** green.'].join('\n'), {});
    assert.equal((body.match(/<details/g) || []).length, 1, body);
    assert.ok(body.includes('ds-f-t">Steps<'), body);
    assert.ok(body.includes('2 items · +1'), body);
  });
  it('a task with no fields renders expanded, never folded', () => {
    const { body } = renderSection(['## Phase 1 — X {#phase-1}', '', '### Task 1: A', '',
      'Just a lead line.', '', '1. First', '2. Second'].join('\n'), {});
    assert.ok(!body.includes('<details'), body);
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
        for (const t of ['ul', 'ol', 'dl', 'p', 'pre', 'code', 'li', 'details', 'summary', 'section', 'div', 'span', 'h2', 'h3']) {
          assert.equal(count(html, t), count(html, '/' + t), `${f} · <${t}> imbalance`);
        }
      }
    }
    assert.ok(n > 40, `expected 40+ sections, saw ${n}`);
  });
});
