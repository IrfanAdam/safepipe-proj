// safepipe changelog — block-aware detail renderer (pure, no DOM).
// Paints a raw section chunk with its block structure intact: `**Label:**`
// fields in canonical order, `- ` nested lists, `1.` ordered lists, fences
// as <pre>. norm()/hashes/anchors are untouched — this is display only, so
// plan history gains no churn.
// [plan:2026-10-19_150735-changelog-readability.md#phase-1]
import { chunks, anchorOf, buildState, state, isDone, parseGates, liveSprints, isCancelledHead } from '../changelog-parse.js';
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
    || /^---\s*$/.test(t) // thematic breaks are separators, never task body
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
    let note = '';
    const sm = name.match(new RegExp(`\`?(${SHA_RE})\`?\\s*$`));
    if (sm) { shipped = sm[1]; name = name.slice(0, sm.index).trim().replace(/\.+$/, '.'); }
    // A trailing paren is either the ship sha — or a prose note. The note
    // is NOT header material (it inflates fold headers to 4 lines); it
    // renders as the fold's first body paragraph instead.
    const pm = name.match(/\(([^()]*)\)\s*$/);
    if (pm) {
      const inner = pm[1].trim().replace(/^`|`$/g, '');
      if (new RegExp(`^${SHA_RE}$`, 'i').test(inner)) shipped = shipped || inner;
      else note = pm[1].trim();
      name = name.slice(0, pm.index).trim().replace(/\.+$/, '.');
    }
    return { num: m[1], name, shipped, note };
  }
  m = s.match(/^Task\s+([\d-]+)\s+([0-9a-f]{7,40})\s*$/);
  if (m) return { num: m[1], name: '', shipped: m[2] };
  return { num: '', name: s, shipped: '' };
};
// A task's checkbox is the native glyph alone — ☑ done, ☒ cancelled,
// ☐ open. No drawn box, no accent: the summary stays a single quiet line.
const taskTick = (task) => {
  if (task.done) return '☑';
  if (task.cancelled) return '☒';
  return '☐';
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

// Plan-card seal in one place: fractions full AND every non-rev (ship)
// gate passed or waived. Plan cards and the Incomplete filter share this —
// a plan never reads sealed in one place and open in the other.
export const planSealed = (p) => {
  try {
    const sprints = (p && p.sprints) || [];
    const live = liveSprints(sprints);
    let frac = '';
    try { frac = buildState(live); } catch { frac = ''; }
    if (!frac && p && p.raw && live.length) {
      let d = 0, t = 0;
      for (const s of live) {
        let f = '';
        try { f = state(s.body); } catch { f = ''; }
        if (f) {
          const m = f.match(/(\d+)\/(\d+)/);
          if (m) { d += Number(m[1]); t += Number(m[2]); continue; }
        }
        const raw = sectionRaw(p.raw, s.head);
        if (!raw) continue;
        const lines = raw.split('\n').filter((l) => /^###\s+(Task|Step|Phase)\b/i.test(l.trim()));
        if (!lines.length) continue;
        d += lines.filter((l) => /[✓✗]/.test(l)).length;
        t += lines.length;
      }
      if (t) frac = `${d}/${t}`;
    }
    // All-cancelled plans have no live fractions — vacuous full, the same
    // convention as a ✓ done taskless head synthesizing 1/1.
    if (!frac && !live.length && sprints.some((s) => isCancelledHead(s && s.head))) frac = '1/1';
    return isDone(frac) && shipGatesShut(parseGates(liveRaw(p)));
  } catch { return false; }
};

// Gates inside cancelled sections are moot — the seal reads gates from the
// preamble + live sections only. Cancelled gates stand in the drawer as
// record of what was owed when the phase was abandoned, never as blockers.
const liveRaw = (p) => {
  try {
    const raw = String((p && p.raw) || '');
    const bodies = liveSprints((p && p.sprints) || []).map((s) => s.body || '');
    // Preamble always rides along (gates may live above the first ## head,
    // and section-less raws ARE the preamble). Section gates may double up
    // against the preamble — harmless: the seal only asks every(), which is
    // idempotent under duplicates.
    return [raw.split(/^## /m)[0], ...bodies].join('\n');
  } catch { return (p && p.raw) || ''; }
};

// Plan-level cancelled: the trailing run of phases is cancelled through the
// last phase AND everything before it is sealed. A cancelled middle with a
// done last phase reads done; any open live work reads open — cancellation
// resolves only what it names, and only closes the plan when it owns the end.
export const planCancelled = (p) => {
  try {
    const sprints = (p && p.sprints) || [];
    if (!sprints.length) return false;
    const last = sprints[sprints.length - 1];
    return isCancelledHead(last && last.head) && planSealed(p);
  } catch { return false; }
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

// A verdict suffix is " ✓ GATE PASSED" / " · GATE OPEN" / " · GATE FAILED".
// Its ✓ marks the gate verdict, not a second DONE — so the join drops the
// leading glyph and always separates with " · ". One rule for every head, or
// a head-marked phase reads "✓ DONE ✓ GATE PASSED" while every other line
// spells the same verdict "· GATE PASSED" (owner: GATE PASSED is inconsistent).
// Escaping happens here, once, at the single injection point.
const joinStatus = (lead, suffix) => {
  const gate = String(suffix || '').replace(/^\s*[✓·]\s*/, '').trim();
  return gate ? `${lead} · ${esc(gate)}` : lead;
};
// A passed/waived gate is a done verdict — it must not wear the muted
// open-gate colour.
const gatePassed = (suffix) => /^\s*✓/.test(String(suffix || '')) || /waiv/i.test(String(suffix || ''));

const gateOnlyLine = (suffix) => {
  const t = String(suffix || '').replace(/^[✓·\s]+/, '').trim();
  return t ? `<p class="ds-status ${gatePassed(suffix) ? 'ds-is-done' : 'ds-is-gate'}">${esc(t)}</p>` : '';
};

const headStatus = (headText, suffix) => {
  const clean = String(headText || '').replace(/\{#[^}]*\}/g, '').trim();
  const m = clean.match(/\s*([✓✗])\s*(done|cancelled)(\s*\([^)]*\))?\s*$/i);
  if (!m) return gateOnlyLine(suffix);
  const paren = m[3] || '';
  if (m[1] === '✗') return `<p class="ds-status ds-is-cancelled">${joinStatus(`✗ cancelled${esc(paren)}`, suffix)}</p>`;
  return `<p class="ds-status ds-is-done">${joinStatus(`✓ DONE${esc(paren)}`, suffix)}</p>`;
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
const renderFieldsOpen = (fields) => (fields || []).map(renderFieldOpen).filter(Boolean).join('');
// ## bodies flow in authored order: fields and loose blocks interleaved by
// parse sequence. No canonical sort here — that normalization belongs to
// folds, where authors write freeform. The open section keeps the narrative.
const renderFlow = (t, ledeObj) => {
  const units = [];
  for (const f of (t.fields || [])) {
    // In a ###-less body the objective reads as the lede paragraph (no
    // label), at its authored position — the domain-task treatment.
    if (ledeObj && isObjective(f.label)) {
      const otext = [...f.inline, ...f.parts.filter((p) => p.t === 'para').map((p) => p.text)]
        .filter(Boolean).join(' ').trim();
      let html = otext ? `<p>${fmtInline(otext)}</p>` : '';
      html += renderParts(f.parts.filter((p) => p.t !== 'para'));
      if (html) units.push({ seq: f.seq ?? 0, html });
    } else {
      const html = renderFieldOpen(f);
      if (html) units.push({ seq: f.seq ?? 0, html });
    }
  }
  for (const p of (t.loose || [])) {
    const html = renderParts([p]);
    if (html) units.push({ seq: p.seq ?? 0, html });
  }
  units.sort((a, b) => a.seq - b.seq);
  return units.map((u) => u.html).join('');
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

// A task's content as flowing HTML (no fold wrapper): note, objective,
// lead, canonical fields, loose blocks. Shared by the fold and the
// lone-task promotion (a section that IS one task reads as a phase).
const taskInner = (task) => {
  const { note } = taskTitleOf(task.title);
  const obj = task.fields.find((f) => isObjective(f.label));
  const rest = task.fields.filter((f) => !isObjective(f.label));
  let inner = note ? `<p>${fmtInline(note)}</p>` : '';
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
  return inner;
};
const renderTask = (task) => {
  // The task itself is the fold: summary = its own header + status (no
  // FILES line, no previews), body = everything unfolded. Content-less
  // tasks render the header alone — nothing to fold.
  // No task id in the fold header (owner steer: the name is the header) —
  // except as fallback when a bare marker carries no name at all.
  const { num, name, shipped, note } = taskTitleOf(task.title);
  const h3 = name || (num ? `Task ${num}` : 'Task');
  // Summary order: ink tick, name, caret inline (in flow, never pushed).
  const trig = `${taskTick(task)}<h3>${fmtInline(h3)}</h3><span class="ds-caret">›</span>`;
  const obj = task.fields.find((f) => isObjective(f.label));
  const rest = task.fields.filter((f) => !isObjective(f.label));
  const hasContent = !!note || !!obj || task.lead.length > 0
    || rest.some((f) => fieldText(f) || (f.parts || []).length)
    || (task.loose || []).length > 0;
  // Content-less tasks render the header alone — but a title note is
  // content: it flows unfolded, never dropped, never folded solo. Bare
  // headers carry the tick too (no caret: nothing to fold).
  const bare = (extra) => `<section class="ds-subtask"><div class="ds-task-bare">${taskTick(task)}<h3>${fmtInline(h3)}</h3></div>${extra || ''}</section>`;
  if (!hasContent) return bare();
  const inner = taskInner(task);
  if (!rest.length && !obj && !task.lead.length && !(task.loose || []).length) {
    return bare(inner);
  }
  if (!inner) return bare();
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
  // Authored sequence across fields AND loose blocks: ## bodies render in
  // source order (an unknown label like "Behavior contract" must not sink
  // below Verify, a Tags line must not trail after every field). Folds keep
  // canonical order; the open section keeps the author's narrative.
  let seq = 0;
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
    else into.push({ t: 'para', text: text.trim(), seq: seq++ });
  };
  const startField = (label, val) => {
    if (!cur) { cur = { title: '', fields: [], lead: [], loose: [], field: null }; tasks.push(cur); }
    flushList();
    cur.field = { label, inline: val ? [val] : [], parts: [], idx: fieldIdx++, seq: seq++ };
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
      openList = { t: 'list', ordered, items: [], home: into, seq: seq++ };
      into.push(openList);
    }
    openList.items.push(text.trim());
  };
  let fence = null;
  let start = 0;
  let htextRaw = '';
  const makeHead = (htext) => {
    const hclean = cleanHead(htext).replace(/\s*([✓✗])\s*(done|cancelled)(\s*\([^)]*\))?\s*$/i, '').trim();
    return `<${htag}>${fmtInline(hclean)}</${htag}>` + headStatus(htext, suffix);
  };
  if (hi >= 0) {
    htextRaw = lines[hi].replace(/^#{1,4}\s+/, '');
    if (htag === 'h2' || htag === 'h3') {
      head = makeHead(htextRaw);
    } else {
      const title = htextRaw;
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
        if (code.trim()) curParts().push({ t: 'pre', lang: fence.lang, code, seq: seq++ });
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
    // Fully-bolded step heads ("**Step 1: Capture before**", at most two
    // plans) never match LABEL_LINE (no `:**`) and used to glue into the
    // open field's inline — a run-on FILES paragraph. They open their own
    // procedural field instead; trailing prose after the stars joins it.
    const bm = ln.match(/^\*\*\s*((?:Steps?|Drill|Procedure)(?:\s+[\d-]+)?)\s*:\s*(.+?)\s*\*\*\s?(.*)$/i);
    if (bm) { flushList(); startField(bm[1].trim(), `${bm[2].trim()}${bm[3].trim() ? ` ${bm[3].trim()}` : ''}`); continue; }
    // An indented line continues the open list item (lazy continuation) —
    // flushing first would orphan it into the field (the 1,1,2 split).
    if (!(openList && /^\s+\S/.test(ln))) flushList();
    pushInline(ln);
  }
  flushList();
  closeTask();
  const renderBlock = (b) => (b.t === 'raw' ? b.html : renderParts([b]));
  let body = blocks.map(renderBlock).join('');
  let real = tasks.filter((t) => t.title);
  if (htag === 'h2' && real.length) {
    // Bare ### stamps ("### Task 1 ✓ done <sha>") carry no content: when
    // their number matches the section, they ARE the section's stamp — not
    // a sub-task. Suppress the nested render and roll the unanimous verdict
    // up into the head; otherwise the section title goes missing and a task
    // nests inside a task. Other numbers still render bare.
    const secNum = (taskTitleOf(cleanHead(htextRaw)).num || '').toLowerCase();
    const stampNum = (title) => {
      // taskTitleOf covers colon/shipped/sha shapes; a bare "Task 1" stamp
      // (verdict, no sha) needs its own branch.
      const t = taskTitleOf(title);
      if (t.num) return t.num.toLowerCase();
      const bare = cleanHead(title).replace(/✓\s*done\s*—?/i, '').replace(/✗\s*cancelled\s*—?/i, '').replace(/[✓✗]/g, '').trim();
      const m = bare.match(/^(Task|Step|Phase)\s+([\d-]+)\s*$/i);
      return m ? m[2].toLowerCase() : '';
    };
    const isStamp = (t) => {
      if (t.lead.length || t.loose.length) return false;
      if (t.fields.some((f) => fieldText(f) || (f.parts || []).length)) return false;
      const n = stampNum(t.title);
      return !!n && !!secNum && n === secNum;
    };
    const stamps = real.filter(isStamp);
    if (stamps.length) {
      real = real.filter((t) => !isStamp(t));
      // A gate line (ds-is-gate) is not a verdict — only DONE/cancelled
      // blocks the rollup.
      if (!/✓ DONE|✗ cancelled/.test(head)) {
        if (stamps.every((t) => t.done)) head = makeHead(`${htextRaw} ✓ done`);
        else if (stamps.every((t) => t.cancelled)) head = makeHead(`${htextRaw} ✗ cancelled`);
      }
    }
  }
  // ── Phase status synthesis (ontology: phases contain tasks; never "items") ──
  // Every h2 *Phase* that owns tasks shows a consistent status line: tasks
  // fraction (or DONE when all done) plus gate verdict when a gate exists.
  // Owner ruling 17:32 — task counts are the display truth for phase heads;
  // author marks remain provenance. Guard to Phase heads only: Task-headed
  // h2 sections are not phases (task-only test: mismatched numbers stay bare).
  // Render rule: DONE only when all tasks done AND gate is passed/waived or absent;
  // for an open gate use fraction + gate (e.g. 3/3 · GATE OPEN), never gate-only.
  const isPhaseHead = /^Phase\b/i.test(cleanHead(htextRaw));
  if (isPhaseHead && htag === 'h2' && real.length && !/✓ DONE|✗ cancelled/.test(head)) {
    const total = real.length;
    const done = real.filter(t => t.done || t.cancelled).length;
    const frac = `${done}/${total}`;
    const allDone = done === total;
    const hasGate = !!String(suffix || '').trim();
    const gateIsPassed = gatePassed(suffix);
    let statusText, cls;
    if (allDone && (!hasGate || gateIsPassed)) {
      statusText = joinStatus('✓ DONE', suffix);
      cls = 'ds-is-done';
    } else {
      statusText = suffix ? joinStatus(frac, suffix) : frac;
      cls = 'ds-is-gate';
    }
    const line = `<p class="ds-status ${cls}">${statusText}</p>`;
    if (head.includes('</h2>')) head = head.replace(/<\/h2>.*/, `</h2>${line}`);
    else head = `<h2>${fmtInline(cleanHead(htextRaw))}</h2>${line}`;
  }
  // Lone-task promotion: a ###-led chunk that IS one task (no usable
  // section title) reads as a phase — the task name becomes the h2, its
  // verdict the status line, its content flows unfolded. No fold, no
  // invalid <h3-task> head. Multi-task or orphan-carrying chunks keep folds.
  const orphans = tasks.filter((t) => !t.title);
  const orphanContent = orphans.some((t) => t.lead.length || (t.loose || []).length
    || t.fields.some((f) => fieldText(f) || (f.parts || []).length));
  // A single-task ###-led chunk still owns a title when promotion is blocked
  // by another heading inside the chunk (e.g. a trailing `## Files likely to
  // change`): it reached here with head === '' and rendered its task under
  // nothing — title AND status missing. Name it after the task. (Multi-task
  // chunks keep folds and stay headless by contract — see "two tasks in one
  // chunk keep their folds".)
  if (!head && real.length === 1) {
    const ft = taskTitleOf(real[0].title);
    head = `<h2>${fmtInline(ft.name || (ft.num ? `Task ${ft.num}` : 'Task'))}</h2>`
      + headStatus(real[0].done ? '✓ done' : real[0].cancelled ? '✗ cancelled' : '', suffix);
  }
  if (htag === 'h3-task' && real.length === 1 && !orphanContent && !blocks.length) {
    const lone = real[0];
    const lt = taskTitleOf(lone.title);
    // Lone-task promotion: the section IS one task. Show the task name as h2
    // with an explicit status line. headStatus expects a trailing verdict, but
    // twin-shaped titles keep `✓ done` mid-title (Task 5 ✓ done — shipped … · name),
    // so it would miss. Derive status directly from the task's done/cancelled.
    let status = '';
    const gatePart = suffix ? ` · ${esc(suffix.trim().replace(/^[✓·\s]+/, '').trim())}` : '';
    const shipParen = lt.shipped ? ` (${lt.shipped})` : '';
    if (lone.done) status = `<p class="ds-status ds-is-done">✓ DONE${esc(shipParen)}${gatePart}</p>`;
    else if (lone.cancelled) status = `<p class="ds-status ds-is-cancelled">✗ cancelled${shipParen ? esc(shipParen) : ''}${gatePart}</p>`;
    else if (suffix) status = gateOnlyLine(suffix);
    else status = `<p class="ds-status ds-is-gate">0/1</p>`;
    head = `<h2>${fmtInline(lt.name || (lt.num ? `Task ${lt.num}` : 'Task'))}</h2>` + status;
    body += taskInner(lone);
  } else if (real.length) {
    // Label lines outside any ### (e.g. a phase-level note) keep author
    // order after the known set — they have no task to belong to.
    for (const t of tasks.filter((t) => !t.title)) {
      if (t.lead.length) body += `<p>${fmtInline(t.lead.join(' ').trim())}</p>`;
      body += renderFlow(t);
    }
    body += '<div class="ds-tasks">' + real.map(renderTask).join('') + '</div>';
  } else if (tasks.length) {
    // ###-less section: the body is one implicit task owned by the head —
    // it flows in authored order (lead, then fields + loose interleaved),
    // never folded: the open section IS the detail.
    for (const t of tasks) {
      if (t.lead.length) body += `<p>${fmtInline(t.lead.join(' ').trim())}</p>`;
      body += renderFlow(t, true);
    }
  }
  return { head, body };
};
