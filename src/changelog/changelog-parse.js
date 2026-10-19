// safepipe changelog — parse helpers · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
// Exports: chunks, goal, norm, split, state, isDone, buildState, parseMeta, anchorOf, anchorHit,
//   parseDue, dueOf (+ phash, parseGates, gateNOf, anchorHitCI)
// Re-exports MONTHS, fmtDate, fmtTime, pDay, isoDay via changelog-format.js
// Safepipe adapter: plans use `## Task N` / `## Step N` (or bare `### Task N`)
// instead of `## Phase N`; commit anchors are bare `task-N`.

export const chunks = (md) => {
  const out = [''];
  let at = 0;
  let fence = false;
  for (const ln of md.split('\n')) {
    if (!fence && /^## /.test(ln)) out[++at] = ln.slice(3);
    else out[at] += (out[at] ? '\n' : '') + ln;
    if (/^\s*```/.test(ln)) fence = !fence;
  }
  return out;
};

export const goal = (md) => (md.match(/\*\*Goal:\*\*\s*([\s\S]+?)(?:\n\s*\n|$)/) || [])[1]?.trim() || '';

export const norm = (body) => {
  if (/^- \[[ xX]\]/m.test(body)) return body;
  const parts = body.split(/^### /m);
  const head = parts.shift();
  const items = [];
  const extra = [];
  parts.forEach((p) => {
    const lines = p.split('\n');
    const title = lines.shift().trim();
    // Non-task ### subsections (Risks, Notes, Verify…) are prose, not units —
    // pass through verbatim so they never synthesize phantom open checkboxes.
    if (!/^(Task|Step|Phase)\b/i.test(title)) { extra.push(['### ' + title, ...lines].join('\n')); return; }
    const m = title.match(/^Task\s+([\d-]+):\s*(.+)$/);
    const num = m ? m[1] : '';
    let name = m ? m[2] : title;
    const cancelled = /✗/i.test(title);
    const done = /✓/i.test(title);
    name = name.replace(/✓\s*done\s*—?/i,
      '').replace(/✗\s*cancelled\s*—?/i,
      '').replace(/[✓✗]/g,
      '').trim().replace(/\.+$/,
      '.');
    const detail = lines.join(' ').replace(/\s+/g, ' ').trim();
    let flag = '';
    if (cancelled) flag = '<span class="ds-cancelled">✗ cancelled</span> — ';
    else if (done) flag = '✓ done — ';
    items.push(`- [${done || cancelled ? 'x' : ' '}] **${num} ${name}** ${flag}${detail}`);
  });
  let out = head + items.join('\n');
  if (extra.length) out += '\n' + extra.join('\n');
  if (!items.length) {
    // Task-based safepipe plans mark done in the `##` heading itself.
    const hl = head.split('\n')[0] || '';
    const cancelled = /✗/i.test(hl);
    const done = /✓/i.test(hl);
    if (cancelled || done) {
      const name = hl.replace(/^##\s*/, '').replace(/[✓✗]/g, '').trim().replace(/\.+$/, '');
      out += `\n- [x] **${name}** ${cancelled ? '<span class="ds-cancelled">✗ cancelled</span>' : '✓ done'}`;
    }
  }
  return out;
};

// Explicit anchor token declared in a head: `## Follow-up polish {#follow-up}`.
// A group with no `Phase|Task|Step` number MUST declare one to become a
// section — the opt-in is what keeps prose heads (`## File map`, `## Pitfalls`,
// `## REF GATE`, `## License table`) out of the section list.
export const declaredAnchor = (head) =>
  (String(head || '').match(/\{#([A-Za-z][\w-]*)\}/) || [])[1] || null;

// Section number → canonical anchor token (`Task 10: …` → `task-10`).
// A declared `{#anchor}` wins over the derived number: it is the author
// stating the token outright.
export const anchorOf = (head) => {
  const d = declaredAnchor(head);
  if (d) return d;
  const m = String(head || '').match(/^(Phase|Task|Step)\s+(\d+)/i);
  return m ? `${m[1].toLowerCase()}-${Number(m[2])}` : null;
};

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Digit-boundary match: `task-1` hits `{#task-1}` but never `{#task-10}`.
export const anchorHit = (text, anchor) =>
  new RegExp(`(?<![\\w-])${escRe(String(anchor))}(?![\\d])`).test(String(text || ''));

// Case-insensitive twin for whole-plan presence checks (unlinked triage):
// a `#follow-up` trailer refers to the plan's `## Follow-up` heading,
// which never matches the case-sensitive section rule. Digit boundaries
// are kept, so `task-1` still never matches `task-10`.
export const anchorHitCI = (text, anchor) =>
  new RegExp(`(?<![\\w-])${escRe(String(anchor))}(?![\\d])`, 'i').test(String(text || ''));

// Section number for gate ownership (`Task 3` → 3, `Phase 03` → 3,
// `Step 0` → 0). Falls back when the head carries no number — callers
// pass their positional index. Same head-number rule as anchorOf: a
// section is judged by its OWN gate, never by its position (positional
// index misattributes verdicts on Task-headed plans).
//
// A declared-anchor group with no number owns NO numbered gate → null, never
// the positional fallback: `## Follow-up {#follow-up}` sitting at index 4 must
// not display Task 4's `GATE PASSED`. (An unanchored numberless head keeps the
// positional fallback, which only numbered-free legacy heads reach.)
export const gateNOf = (head, fb) => {
  const m = String(head || '').match(/^(Phase|Task|Step)\s+(\d+)/i);
  if (m) return Number(m[2]);
  if (declaredAnchor(head)) return null;
  return fb;
};

// A section is a `Phase|Task|Step N` unit, OR any head that declares an
// explicit `{#anchor}`. The declared-anchor branch is what lets a real work
// group (e.g. `## Follow-up polish {#follow-up}`) own its commits instead of
// leaving them unfiled — the alternative, a catch-all "Further commits" bucket,
// hides unfiled work and is banned. Numberless prose heads stay excluded.
const SECTION = (head) => /^(Phase|Task|Step)\b/.test(head) || !!declaredAnchor(head);

const toSection = (marker, p) => {
  const nl = p.indexOf('\n');
  const head = (nl < 0 ? p : p.slice(0, nl)).trim();
  let body = norm(marker + p);
  const a = anchorOf(head);
  if (a && !anchorHit(body, a)) body += `\n{#${a}}`;
  return { head, body };
};

export const split = (md) => {
  const secs = chunks(md).slice(1)
    .map((s) => toSection('## ', s))
    .filter((s) => SECTION(s.head));
  if (secs.length) return secs;
  // Fallback: `### Task`-based plans with no matching `##` sections.
  // No `##`-in-preamble guard: the SECTION filter below already drops non-task
  // heads, and plans reaching fallback have no `##` task sections — so `###`
  // Task heads are genuine units even when prose `##` heads exist elsewhere
  // (e.g. production-ready groups tasks under context/approach `##` heads).
  const parts = md.split(/^### /m);
  if (parts.length < 2) return [];
  return parts.slice(1)
    .map((p) => toSection('### ', p))
    .filter((s) => SECTION(s.head));
};

export const state = (body) => {
  // Count authored/norm-synthesized checkbox LINES only. An unanchored match
  // also counts inline prose that documents the syntax (e.g. "fallback
  // `- [ ]` tasks …"), which invented an extra open unit — a phase with all
  // tasks done showed 3/4 and contradicted its own ✓ DONE status line.
  const d = (body.match(/^[ \t]*-[ \t]*\[x\]/gim) || []).length;
  const t = (body.match(/^[ \t]*-[ \t]*\[ \]/gm) || []).length;
  return d + t ? `${d}/${d + t}` : '';
};

export const isDone = (frac) => {
  const m = String(frac || '').match(/(\d+)\/(\d+)/);
  return !!m && Number(m[2]) > 0 && Number(m[1]) === Number(m[2]);
};

// Content hash for plan-history snapshots (shared node+browser; fnv1a, sync).
// Whitespace-collapsed so reformat-only edits still match.
export const phash = (s) => {
  let h = 0x811c9dc5;
  const t = String(s).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export const buildState = (ss) => {
  let d = 0, t = 0;
  ss.forEach((s) => {
    const m = state(s.body).match(/(\d+)\/(\d+)/);
    if (m) { d += Number(m[1]); t += Number(m[2]); }
  });
  return t ? `${d}/${t}` : '';
};

export const parseMeta = (file) => {
  let m = file.match(/^(\d{4}-\d{2}-\d{2})[_-](\d{5,6})[_-](.+)\.md$/);
  if (m) return { date: m[1], id: m[2], slug: m[3] };
  m = file.match(/^(\d{4}-\d{2}-\d{2})[_-](.+)\.md$/);
  if (m) return { date: m[1], id: '', slug: m[2] };
  return { date: '', id: '', slug: file.replace(/\.md$/, '') };
};

// Gate seals (Task 12, additive): `- REF GATE N (...)` lines → structured
// [{n, state, reviewer, date, note, evidence, judge}]. Section parsing above
// is untouched — this scans raw lines only.
// state: passed (✓ PASSED) | waiver (PASSED by owner waiver) | failed | open.
export const parseGates = (md) => {
  const gates = [];
  const lines = String(md || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*REF GATE\s+(\d+)\s*(?:\(([^)]*)\))?\s*[:—–-]?\s*(.*)$/i);
    if (!m) continue;
    const n = Number(m[1]);
    const paren = (m[2] || '').trim();
    const rest = (m[3] || '').trim();
    const line = lines[i];
    let st = 'open';
    if (/PASSED by owner waiver/i.test(line)) st = 'waiver';
    else if (/✓\s*PASSED/i.test(line)) st = 'passed';
    // FAIL is case-sensitive uppercase only: lowercase evidence prose inside
    // a gate line ("7 pre-existing … fails") is not a verdict — an explicit
    // FAIL / FAILED is. (Readability audit: own-verdict display exposed this.)
    else if (/\bFAIL(ED)?\b/.test(line.replace(/`[^`]*`/g, ''))) st = 'failed';
    const dm = `${paren} ${rest}`.match(/(\d{4}-\d{2}-\d{2})/);
    const reviewer = /owner/i.test(line) ? 'owner' : '';
    let evidence = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (/REF GATE/i.test(lines[j])) break;
      if (/^#{1,4}\s/.test(lines[j])) break;
      const em = lines[j].match(/^\s*-\s*(Evidence\b[\s\S]*)$/i);
      if (em) { evidence = em[1].replace(/\s+/g, ' ').trim(); break; }
    }
    const jm = rest.match(/how (?:it was judged|to judge):\s*([\s\S]*)$/i);
    // Keep the paren marker ((ship), (scheduling), …) on the object: card
    // seals and gate suffixes read it, hashes never see it (additive).
    gates.push({ n, state: st, paren, reviewer, date: dm ? dm[1] : '', note: rest, evidence, judge: jm ? jm[1].trim() : '' });
  }
  return gates.sort((a, b) => a.n - b.n);
};

export { MONTHS, fmtDate, fmtTime, pDay, isoDay } from './changelog-format.js';

// Due dates (timeline scheduling · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#task-1]).
// Convention: `*Due: YYYY-MM-DD*` alone on its own line, directly under a
// `## Phase|Task|Step` head or a `### Task` head — whichever section level
// holds the work inside that plan (nearest level wins: split() returns `##`
// sections when present, else `###` sections, so each dueOf() call already
// sees the winning level). norm() is untouched — a Due line never
// synthesizes checkboxes.
const DUE_LINE = /^\s*\*Due:\s*(\d{4})-(\d{2})-(\d{2})\*\s*$/;
const DUE_DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// First Due-shaped line wins (idempotent under duplicate lines). Invalid —
// malformed, month>12, day>31, year>2099, or no such calendar day — → null,
// never throws.
export const parseDue = (body) => {
  try {
    for (const ln of String(body || '').split('\n')) {
      const m = ln.match(DUE_LINE);
      if (!m) continue;
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      if (y < 1 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      if (d > (mo === 2 && leap ? 29 : DUE_DIM[mo - 1])) return null;
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
  } catch { return null; }
  return null;
};

// dueOf(section): Due honored ONLY for incomplete sections — a head carrying
// ✓/✗ or a body whose checkboxes are all done yields null (done/cancelled
// work never grows a ghost). section = split() output {head, body}.
export const dueOf = (section) => {
  if (!section) return null;
  if (/[✓✗]/.test(String(section.head || ''))) return null;
  if (isDone(state(section.body || ''))) return null;
  return parseDue(section.body);
};
