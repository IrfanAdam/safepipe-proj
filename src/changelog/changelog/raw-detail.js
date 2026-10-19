// safepipe changelog — block-aware detail renderer (pure, no DOM).
// Paints a raw section chunk with its block structure intact: `**Label:**`
// fields in canonical order, `- ` nested lists, `1.` ordered lists, fences
// as <pre>. norm()/hashes/anchors are untouched — this is display only, so
// plan history gains no churn.
// [plan:2026-10-19_150735-changelog-readability.md#phase-1]
import { chunks, anchorOf } from '../changelog-parse.js';
import { esc as escAttr } from './esc.js';

const esc = (t) => String(t || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

// Inline spans, safest first: code spans are immune to bold/em pairing,
// then bold, then em, then links. (Old renderer ran bold/em over backtick
// content, which produced the `***` artifact on `*normHead(head)*`.)
export const fmtInline = (t) => String(t || '').split(/(`[^`\n]*`)/g).map((p, i) => {
  if (i % 2 === 1) return `<code>${p.slice(1, -1)}</code>`;
  return p
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}).join('');

// Canonical field order: summary → Files → Changes → Steps → Verify → rest.
// Contract/Rules/Scope fold into Changes; Drill (ordered procedure) into
// Steps. Unknown labels keep author order after the known set.
const FIELD_RANK = [
  [/^files?$/i, 1],
  [/^(changes?|contract|rules?|scope|approach)\b/i, 2],
  [/^(steps?|drill|procedure)\b/i, 3],
  [/^verif/i, 4],
];
const fieldRank = (label) => {
  for (const [re, r] of FIELD_RANK) if (re.test(String(label || '').trim())) return r;
  return 5;
};
const isObjective = (label) => /^objective$/i.test(String(label || '').trim());

// Raw chunk for a split() section head. Heads match exactly; as a fallback
// (live overlay edited the mark since bundle) match mark/anchor-stripped.
const stripHeadMarks = (h) => String(h || '')
  .replace(/\{#[^}]*\}/g, '').replace(/[✓✗]/g, '').replace(/\s+/g, ' ').trim();
const firstLineOf = (r) => {
  const nl = r.indexOf('\n');
  return ((nl < 0 ? r : r.slice(0, nl))).replace(/^#{2,4}\s+/, '');
};
const matchHead = (bodies, head) => {
  const want = String(head);
  let hit = bodies.find((r) => firstLineOf(r) === want);
  if (!hit) {
    const bare = stripHeadMarks(want);
    hit = bodies.find((r) => stripHeadMarks(firstLineOf(r)) === bare);
  }
  return hit || '';
};
export const sectionRaw = (md, head) => {
  const text = String(md || '');
  if (!text || head === undefined || head === null) return '';
  // Mirror split(): ## sections win when present, else ### sections — but a
  // plan can hold ## prose heads AND ### task sections (prose ## never
  // matches), so fall through to ### when no ## head matches.
  const h2 = matchHead(chunks(text).slice(1).map((s) => '## ' + s), head);
  if (h2) return h2;
  return matchHead(text.split(/^### /m).slice(1).map((p) => '### ' + p), head);
};

// Drop the REF GATE thread from display (Evals owns it). Same semantics as
// the drawer had: slice from the first gate line through the section anchor;
// without an anchor, drop gate lines plus their trailing Evidence lines.
export const stripGateThread = (raw) => {
  let out = String(raw || '');
  const idx = out.indexOf('- REF GATE');
  if (idx === -1) return out;
  const m = out.slice(idx).match(/\{#(?:phase|task|step)[^}]*\}/i);
  if (m) {
    const apos = out.indexOf(m[0], idx);
    return (out.slice(0, idx).trimEnd() + '\n' + out.slice(apos)).trim() + '\n';
  }
  return out
    .replace(/^[ \t]*-[ \t]*REF GATE[^\n]*(\n|$)/gim, '')
    .replace(/^[ \t]*-[ \t]*Evidence\b[^\n]*(\n|$)/gim, '');
};

// Inline `{#…}` tokens are machine metadata — except inside code spans,
// where they are prose documenting the token itself (e.g. Task 2's
// "`{#task-N}` token synthesis"). Strip code-aware so docs stay truthful.
export const stripInlineAnchors = (src) => String(src || '')
  .split(/(`[^`\n]*`)/g)
  .map((p, i) => (i % 2 === 1 ? p : p.replace(/\{#[^}]*\}/g, '')))
  .join('');

const DROP_LINE = (ln) => {
  const t = ln.trim();
  return !t
    || /^\s*\|/.test(ln) // overview tables already live as checkboxes
    || /^<!--[\s\S]*-->$/.test(t)
    || /^\{#[^}]*\}$/.test(t)
    || /^\*Due:[^*]*\*$/.test(t)
    || /^\*{1,2}Tags:\s*[^*]*\*{1,2}$/.test(t);
};
const LABEL_LINE = (ln) => ln.match(/^\*\*([^*]{1,80}?):\*\*\s?(.*)$/);
const TASK_HEAD = (ln) => ln.match(/^###\s+(.+)$/);
const isTaskHead = (title) => /^(Task|Step|Phase)\b/i.test(String(title || '').trim());

const cleanHead = (t) => String(t || '').replace(/\{#[^}]*\}/g, '').replace(/<!--[\s\S]*?-->/g, '');
const SHA_RE = '[0-9a-f]{7,40}';
// Task titles come in three corpus shapes (all mean the same thing):
//   `Task N: name ✓ done `sha``   (colon — most plans)
//   `Task N ✓ done — shipped <sha> · name`   (twin — sha mid-title)
//   `Task N ✓ done <sha>`   (smooth — bare trailing sha)
// The shipped sha is provenance: it moves to the DONE paren so the h3
// stays a clean `Task N · name`.
const taskTitleOf = (title) => {
  const s = cleanHead(title).replace(/✓\s*done\s*—?/i, '').replace(/✗\s*cancelled\s*—?/i, '')
    .replace(/[✓✗]/g, '').trim().replace(/\.+$/, '.');
  let m = s.match(/^Task\s+([\d-]+)\s+shipped\s+([0-9a-f]{7,40})\s*·\s*(.+)$/i);
  if (m) return { num: m[1], name: m[3].trim(), shipped: m[2] };
  m = s.match(/^Task\s+([\d-]+):\s*(.+)$/);
  if (m) {
    let name = m[2].trim();
    let shipped = '';
    const sm = name.match(new RegExp(`\`?(${SHA_RE})\`?\\s*$`));
    if (sm) { shipped = sm[1]; name = name.slice(0, sm.index).trim().replace(/\.+$/, '.'); }
    return { num: m[1], name, shipped };
  }
  m = s.match(/^Task\s+([\d-]+)\s+([0-9a-f]{7,40})\s*$/);
  if (m) return { num: m[1], name: '', shipped: m[2] };
  return { num: '', name: s, shipped: '' };
};
// A task's own status — the phase treatment, minus gates (tasks own
// no gate verdict; DONE/cancelled come from the head mark only). A span:
// block outside a summary, inline inside one (see drawer CSS).
const taskStatus = (task, shipped) => {
  if (task.cancelled) return '<span class="ds-status ds-is-cancelled">✗ cancelled</span>';
  if (task.done) return `<span class="ds-status ds-is-done">✓ DONE${shipped ? ` (${shipped})` : ''}</span>`;
  return '';
};

// Own-verdict gate suffix for a section number. Every judged phase shows its
// own verdict (no first-open-only hiding — identical states showed different
// badges). Rev iterations count into the suffix; display follows the last
// non-rev base for that gate.
export const gateSuffix = (gates, phaseN) => {
  if (!gates || !gates.length) return '';
  const mine = [...gates].sort((a, b) => a.n - b.n).filter((g) => g.n === phaseN);
  if (!mine.length) return '';
  const isRev = (x) => /·\s*rev\b/i.test(x.note);
  const revs = mine.filter(isRev).length;
  const revSuffix = revs ? ` · ${revs} rev${revs > 1 ? 's' : ''}` : '';
  const bases = mine.filter((x) => !isRev(x));
  const eff = bases.length ? bases[bases.length - 1] : mine[mine.length - 1];
  if (eff.state === 'passed' || eff.state === 'waiver') return ' ✓ GATE PASSED' + revSuffix;
  if (eff.state === 'failed') return ' · GATE FAILED' + revSuffix;
  if (eff.state === 'open') return ' · GATE OPEN' + revSuffix;
  return '';
};

// Plan-card seal: tasks-done and shipped are different facts. The card
// reads done only when the fractions are full AND every non-rev (ship)
// gate is passed or waived. Gateless plans keep the old rule (no blast
// radius); an open ship gate with remaining work (172008 gate 5:
// "REMAINING USER-RUN AT CUTOVER") keeps the card open.
export const shipGatesShut = (gates) => {
  const ships = (gates || []).filter((g) => /\bship\b/i.test(g.paren || ''));
  const bases = ships.filter((x) => !/·\s*rev\b/i.test(x.note || ''));
  if (!bases.length) return true;
  return bases.every((x) => x.state === 'passed' || x.state === 'waiver');
};

// First section per anchor owns its commits; a repeated anchor (e.g. a prose
// `## Phase 5 closeout note` claiming `phase-5`) renders none instead of
// duplicating the whole commit list under two rail rows.
export const anchorOwners = (sprints) => {
  const owners = new Map();
  const dup = new Set();
  (sprints || []).forEach((s, i) => {
    const a = anchorOf(s.head);
    if (!a) return;
    if (owners.has(a)) dup.add(i);
    else owners.set(a, i);
  });
  return { owners, dup };
};

const gateOnlyLine = (suffix) => {
  const t = String(suffix || '').replace(/^[✓·\s]+/, '').trim();
  return t ? `<p class="ds-status ds-is-gate">${esc(t)}</p>` : '';
};

const headStatus = (headText, suffix) => {
  const clean = String(headText || '').replace(/\{#[^}]*\}/g, '').trim();
  const m = clean.match(/\s*([✓✗])\s*(done|cancelled)(\s*\([^)]*\))?\s*$/i);
  if (!m) return gateOnlyLine(suffix);
  const paren = m[3] || '';
  if (m[1] === '✗') return `<p class="ds-status ds-is-cancelled">✗ cancelled${esc(paren)}${suffix || ''}</p>`;
  return `<p class="ds-status ds-is-done">✓ DONE${esc(paren)}${suffix || ''}</p>`;
};

const renderParts = (parts) => parts.map((p) => {
  if (p.t === 'list') {
    const tag = p.ordered ? 'ol' : 'ul';
    return `<${tag}>` + p.items.map((it) => `<li>${fmtInline(it)}</li>`).join('') + `</${tag}>`;
  }
  if (p.t === 'pre') {
    const cls = p.lang ? ` class="language-${escAttr(p.lang)}"` : '';
    return `<pre><code${cls}>${p.code}</code></pre>`;
  }
  return `<p>${fmtInline(p.text)}</p>`;
}).join('');

// Field rows use spans (never dt/dd — details cannot live inside a dl).
// Rows only ever render unfolded: inside a task fold, or flowing in a
// ## body.
const fieldText = (f) => (f.inline || []).filter(Boolean).join(' ').trim();
// The TASK is the accordion — never a FILES line (a FILES summary opening
// onto a second FILES label is redundant chrome). Each ### item folds into
// one <details> whose summary is the task's own header + status; the body
// holds everything unfolded. ## bodies always flow expanded: the detail
// pane's job is detail, folding it would hide the one open section for no
// scanning gain. (Steer 2026-10-20: tasks fold, FILES line goes away.)
const renderFieldOpen = (f) => {
  const inline = fieldText(f);
  const blocks = renderParts(f.parts || []);
  if (!inline && !blocks) return '';
  return `<div class="ds-field"><span class="ds-f-t">${fmtInline(f.label)}</span>${inline ? `<span class="ds-f-v">${fmtInline(inline)}</span>` : ''}${blocks}</div>`;
};
const renderFieldsOpen = (fields) => {
  const html = (fields || []).map(renderFieldOpen).filter(Boolean).join('');
  return html ? `<div class="ds-fields">${html}</div>` : '';
};

// Split a flattened `- [x] **Title** ... **Label:** ...` line (fallback path
// when raw text is unavailable) into title + fields so it degrades to the
// same shape instead of one run-on line.
export const splitItemContent = (content) => {
  const segs = String(content || '').split(/\*\*([^*]{1,80}?):\*\*/);
  const lead = (segs[0] || '').trim();
  const fields = [];
  for (let i = 1; i + 1 < segs.length; i += 2) {
    const label = (segs[i] || '').trim();
    const val = (segs[i + 1] || '').trim();
    if (!label && !val) continue;
    fields.push({ label, inline: val ? [val] : [], parts: [] });
  }
  return { lead, fields };
};

const renderTask = (task) => {
  // The task itself is the fold: summary = its own header + status (no
  // FILES line, no previews), body = everything unfolded. Content-less
  // tasks render the header alone — nothing to fold.
  const { num, name, shipped } = taskTitleOf(task.title);
  const h3 = num ? `Task ${num}${name ? ` · ${name}` : ''}` : (name || 'Task');
  const trig = `<span class="ds-caret">›</span><h3>${fmtInline(h3)}</h3>${taskStatus(task, shipped)}`;
  const obj = task.fields.find((f) => isObjective(f.label));
  const rest = task.fields.filter((f) => !isObjective(f.label));
  let inner = '';
  if (obj) {
    const otext = [...obj.inline, ...obj.parts.filter((p) => p.t === 'para').map((p) => p.text)]
      .filter(Boolean).join(' ').trim();
    if (otext) inner += `<p>${fmtInline(otext)}</p>`;
    inner += renderParts(obj.parts.filter((p) => p.t !== 'para'));
  }
  if (task.lead.length) inner += `<p>${fmtInline(task.lead.join(' ').trim())}</p>`;
  rest.sort((a, b) => (fieldRank(a.label) - fieldRank(b.label)) || (a.idx - b.idx));
  inner += renderFieldsOpen(rest);
  inner += renderParts(task.loose);
  if (!inner) return `<section class="ds-subtask"><h3>${fmtInline(h3)}</h3>${taskStatus(task, shipped)}</section>`;
  return `<section class="ds-subtask"><details class="ds-task-fold"><summary class="ds-acc-head">${trig}</summary><div class="ds-acc-body">${inner}</div></details></section>`;
};

// Render a raw section chunk → {head, body}. head is the h2/h3 + status line;
// body is everything below it. Never synthesizes a checkbox from a section
// head (the status line already carries done) — that phantom box duplicated
// the h2 on Task-headed plans.
export const renderSection = (raw, opts) => {
  const { gateSuffix: suffix = '' } = opts || {};
  const src = stripInlineAnchors(esc(stripGateThread(raw)));
  const lines = src.split('\n');
  let hi = -1;
  let htag = '';
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (DROP_LINE(ln)) continue;
    if (/^#{1,4}\s+/.test(ln)) { hi = i; htag = ln.startsWith('## ') ? 'h2' : (ln.startsWith('### ') ? 'h3-task' : 'h3'); break; }
    break;
  }
  let head = '';
  let tasks = [];
  let cur = null;
  let blocks = [];
  let openList = null;
  let fieldIdx = 0;
  const flushList = () => {
    // The open list object already lives in its parent array (appended at
    // creation) — closing only nulls the cursor. Re-pushing here duplicates
    // the whole list under its own field.
    openList = null;
  };
  const curParts = () => {
    if (cur && cur.field) return cur.field.parts;
    if (cur) return cur.loose;
    return blocks;
  };
  const pushInline = (text) => {
    if (!text.trim()) return;
    const into = curParts();
    const last = into[into.length - 1];
    // Indented line after a list item is its continuation (markdown lazy
    // continuation), not a new field/lead — e.g. wrapped step text. The
    // open list wins regardless of which array is current; otherwise the
    // last list in the current array does.
    const host = openList && openList.items.length ? openList
      : (last && last.t === 'list' && last.items.length ? last : null);
    if (/^\s+\S/.test(text) && host) {
      host.items[host.items.length - 1] += ' ' + text.trim();
      return;
    }
    if (cur && cur.field && last && last.t === 'para') last.text += ' ' + text.trim();
    else if (!cur && last && last.t === 'para') last.text += ' ' + text.trim();
    else if (cur && cur.field) cur.field.inline.push(text.trim());
    else if (cur) cur.lead.push(text.trim());
    else into.push({ t: 'para', text: text.trim() });
  };
  const startField = (label, val) => {
    if (!cur) { cur = { title: '', fields: [], lead: [], loose: [], field: null }; tasks.push(cur); }
    flushList();
    cur.field = { label, inline: val ? [val] : [], parts: [], idx: fieldIdx++ };
    cur.fields.push(cur.field);
  };
  const closeTask = () => {
    if (!cur) return;
    flushList();
    cur.field = null;
    cur = null;
  };
  const listItem = (ordered, text) => {
    // Numbered steps are peers, not field values — unless the open field is
    // procedural (Steps/Drill/Verify). Bullets always belong to the open
    // field (Files/Changes lists). Without an open field, both go loose.
    let into = curParts();
    if (ordered && cur && cur.field && ![3, 4].includes(fieldRank(cur.field.label))) {
      // Peer of the field, not its value — but never split an open list that
      // already lives loose (the redirect flush would orphan item 1).
      if (!openList || openList.home !== cur.loose) flushList();
      into = cur.loose;
    }
    if (!openList || openList.ordered !== ordered || openList.home !== into) {
      flushList();
      openList = { t: 'list', ordered, items: [], home: into };
      into.push(openList);
    }
    openList.items.push(text.trim());
  };
  let fence = null;
  let start = 0;
  if (hi >= 0) {
    const htext = lines[hi].replace(/^#{1,4}\s+/, '');
    if (htag === 'h2' || htag === 'h3') {
      const hclean = cleanHead(htext).replace(/\s*([✓✗])\s*(done|cancelled)(\s*\([^)]*\))?\s*$/i, '').trim();
      head = `<${htag}>${fmtInline(hclean)}</${htag}>` + headStatus(htext, suffix);
    } else {
      const title = htext;
      cur = {
        title,
        done: /✓/i.test(title),
        cancelled: /✗/i.test(title),
        fields: [],
        lead: [],
        loose: [],
        field: null,
      };
      tasks.push(cur);
    }
    start = hi + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const ln = lines[i];
    if (fence) {
      if (/^\s*```\s*$/.test(ln)) {
        const code = fence.lines.join('\n');
        if (code.trim()) curParts().push({ t: 'pre', lang: fence.lang, code });
        flushList();
        fence = null;
      } else fence.lines.push(ln);
      continue;
    }
    const fm = ln.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fm) { flushList(); fence = { lang: fm[1] || '', lines: [] }; continue; }
    if (DROP_LINE(ln)) { flushList(); continue; }
    let m;
    if ((m = ln.match(/^###\s+(.+)$/))) {
      closeTask();
      const title = m[1];
      if (isTaskHead(title)) {
        cur = {
          title,
          done: /✓/i.test(title),
          cancelled: /✗/i.test(title),
          fields: [],
          lead: [],
          loose: [],
          field: null,
        };
        tasks.push(cur);
      } else {
        blocks.push({ t: 'raw', html: `<h3>${fmtInline(cleanHead(title))}</h3>` });
      }
      continue;
    }
    if (/^#{1,4}\s+/.test(ln)) { closeTask(); flushList(); blocks.push({ t: 'raw', html: `<h3>${fmtInline(cleanHead(ln.replace(/^#{1,4}\s+/, '')))}</h3>` }); continue; }
    if ((m = ln.match(/^- \[(x|X| )\]\s?(.*)$/))) {
      // Authored checkbox line (fallback path): field-split its content so
      // it degrades to title + fields, not one run-on line.
      closeTask();
      const { lead, fields } = splitItemContent(m[2]);
      const tt = lead.replace(/✓\s*done\s*—?/i, '').replace(/✗\s*cancelled\s*—?/i, '').trim();
      cur = {
        title: tt, done: m[1].toLowerCase() === 'x', cancelled: /✗/.test(m[2]),
        fields: fields.map((f) => ({ ...f, parts: [], idx: fieldIdx++ })),
        lead: [], loose: [], field: null,
      };
      tasks.push(cur);
      closeTask();
      continue;
    }
    if ((m = ln.match(/^- (.*)$/))) { listItem(false, m[1]); continue; }
    if ((m = ln.match(/^\d+[.)]\s+(.*)$/))) { listItem(true, m[1]); continue; }
    const lm = LABEL_LINE(ln);
    if (lm) { flushList(); startField(lm[1].trim(), (lm[2] || '').trim()); continue; }
    // An indented line continues the open list item (lazy continuation) —
    // flushing first would orphan it into the field (the 1,1,2 split).
    if (!(openList && /^\s+\S/.test(ln))) flushList();
    pushInline(ln);
  }
  flushList();
  closeTask();
  const renderBlock = (b) => (b.t === 'raw' ? b.html : renderParts([b]));
  let body = blocks.map(renderBlock).join('');
  const real = tasks.filter((t) => t.title);
  if (real.length) {
    // Label lines outside any ### (e.g. a phase-level note) keep author
    // order after the known set — they have no task to belong to.
    for (const t of tasks.filter((t) => !t.title)) {
      const sorted = [...t.fields].sort((a, b) => (fieldRank(a.label) - fieldRank(b.label)) || (a.idx - b.idx));
      body += renderFieldsOpen(sorted);
      body += renderParts(t.loose);
    }
    body += '<div class="ds-tasks">' + real.map(renderTask).join('') + '</div>';
  } else if (tasks.length) {
    // ###-less section: the body is one implicit task owned by the head —
    // it flows expanded (objective first, then fields, then steps), never
    // folded: the open section IS the detail.
    const all = tasks.flatMap((t) => t.fields);
    const obj = all.find((f) => isObjective(f.label));
    if (obj) {
      const otext = [...obj.inline, ...obj.parts.filter((p) => p.t === 'para').map((p) => p.text)]
        .filter(Boolean).join(' ').trim();
      if (otext) body += `<p>${fmtInline(otext)}</p>`;
      body += renderParts(obj.parts.filter((p) => p.t !== 'para'));
    }
    const rest = all.filter((f) => f !== obj)
      .sort((a, b) => (fieldRank(a.label) - fieldRank(b.label)) || (a.idx - b.idx));
    body += renderFieldsOpen(rest);
    body += renderParts(tasks.flatMap((t) => t.loose));
  }
  return { head, body };
};
