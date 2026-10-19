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
  sectionRaw, stripGateThread, renderSection, anchorOwners, gateSuffix, fmtInline,
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
    assert.equal((body.match(/<ul>/g) || []).length, 2, `duplicated list: ${body}`);
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
    assert.ok(body.includes('<dt>Files</dt>'), body);
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
    assert.ok(body.indexOf('<dt>Files</dt>') < body.indexOf('<dt>Verify</dt>'), body);
  });
});
  it('numbered lists stay loose under non-procedural fields', () => {
    const raw = [
      '## Phase 1 — X {#phase-1}', '',
      '### Task 1: A', '',
      '**Files:** Create `a.js`.', '',
      '1. First step', '2. Second step',
    ].join('\n');
    const { body } = renderSection(raw, {});
    assert.ok(body.includes('<dt>Files</dt>'), body);
    assert.ok(body.includes('<ol><li>First step</li><li>Second step</li></ol>'), body);
    assert.ok(!/<dd>[^<]*<ol>/.test(body), 'ol leaked into a field: ' + body);
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
  it('task-less sections lead with Objective, then Files, then steps', () => {
    const raw = [
      '## Task 4 — Q ✓ done', '',
      '*Shipped in abc.*', '',
      '**Objective:** Do things well.', '**Files:** Create `a.js`.', '',
      '1. First', '2. Second',
    ].join('\n');
    const { head, body } = renderSection(raw, {});
    assert.ok(head.includes('✓ DONE'), head);
    const oi = body.indexOf('Do things well.');
    const fi = body.indexOf('<dt>Files</dt>');
    const oli = body.indexOf('<ol>');
    assert.ok(oi !== -1 && fi !== -1 && oli !== -1, body);
    assert.ok(oi < fi && fi < oli, 'order: objective, files, steps: ' + body);
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
        for (const t of ['ul', 'ol', 'dl', 'p', 'pre', 'code', 'li']) {
          assert.equal(count(html, t), count(html, '/' + t), `${f} · <${t}> imbalance`);
        }
      }
    }
    assert.ok(n > 40, `expected 40+ sections, saw ${n}`);
  });
});
