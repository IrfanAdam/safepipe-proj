// safepipe changelog — timeline model (pure, zero DOM) · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#task-1]
// Exports: MERGE_GAP, activeDatesOf, boutsOf, ghostOf, planSummary, boutSummary, planTip, evalsOf.
// Frozen contract — do not rename. Today is always injected (ghostOf(plan,
// todayISO); summaries take an optional todayISO) so node probes stay
// deterministic. No DOM, no JSON imports, no network.
//
// Plan shape (duck-typed; the caller attaches what the view already has):
//   { file, date, title?, goal?, h1?, slug?, raw?,
//     sprints: [{ head, body, commits? }],   // split() sections; per-section
//       // commits are hits-identical (anchorHit + first-section rule, cf.
//       // changelog-links.js hits) attached by the caller — this module must
//       // not import changelog-links (manifest JSON is unloadable in node).
//     commits: [{ date, ... }],              // hits ∪ plan-attached commits
//     revs: [{ date, ... }] }                // history[file] entries
// `sprints` may read `sections`; `revs` may read `history`; per-section
// commits may read `hits`. A precomputed section Due may ride `s.due`.
import { buildState, state, isDone, parseGates, dueOf, goal as goalOf, liveSprints, isCancelledHead } from './changelog-parse.js';
import { descOf, clip, oneLine, planSentence } from './changelog-titles.js';

// Max internal gap (days) inside one streak. Frozen — do not rename.
export const MERGE_GAP = 3;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const isoToday = () => new Date().toISOString().slice(0, 10);
const dayNum = (iso) => Date.parse(`${iso}T00:00:00Z`);

const sectionsOf = (plan) => (plan && (plan.sprints || plan.sections)) || [];
const revsOf = (plan) => (plan && (plan.revs || plan.history)) || [];
const sectionCommits = (s) => (s && (s.commits || s.hits)) || [];

// Sorted unique `plan.date ∪ commit.date ∪ rev.date`.
export const activeDatesOf = (plan = {}) => {
  const out = new Set();
  if (plan && ISO.test(plan.date || '')) out.add(plan.date);
  for (const c of (plan && plan.commits) || []) if (c && ISO.test(c.date || '')) out.add(c.date);
  for (const r of revsOf(plan)) if (r && ISO.test(r.date || '')) out.add(r.date);
  for (const s of sectionsOf(plan)) {
    for (const c of sectionCommits(s)) if (c && ISO.test(c.date || '')) out.add(c.date);
  }
  return [...out].sort();
};

// Gap-merge dates into bouts. A run whose internal gaps are all ≤ gap is a
// `streak` (continuous bar start→end); a singleton with no neighbor within
// gap is `sporadic` (own 1-day block). Bout = { kind, start, end, dates[] }.
export const boutsOf = (dates, gap = MERGE_GAP) => {
  const sorted = [...new Set(((dates || []).filter((d) => ISO.test(d || ''))))].sort();
  const bouts = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    bouts.push({ kind: cur.length > 1 ? 'streak' : 'sporadic', start: cur[0], end: cur[cur.length - 1], dates: cur });
    cur = [];
  };
  for (const d of sorted) {
    if (cur.length && (dayNum(d) - dayNum(cur[cur.length - 1])) / DAY > gap) flush();
    cur.push(d);
  }
  flush();
  return bouts;
};

const sectionDue = (s) => {
  if (s && typeof s.due === 'string' && s.due) return ISO.test(s.due) ? s.due : null;
  return dueOf(s || {});
};

const earliestDueOf = (plan) => {
  let best = null;
  for (const s of sectionsOf(plan)) {
    const d = sectionDue(s);
    if (d && (!best || d < best)) best = d;
  }
  return best;
};

// Earliest Due among incomplete sections, else null (no Due or work
// complete — done plans never ghost). Else { from: max(lastActive, today),
// to: due, overdue: due < today }.
export const ghostOf = (plan = {}, todayISO) => {
  const today = ISO.test(todayISO || '') ? todayISO : isoToday();
  const due = earliestDueOf(plan);
  if (!due) return null;
  const active = activeDatesOf(plan);
  const lastActive = active.length ? active[active.length - 1] : null;
  return { from: lastActive && lastActive > today ? lastActive : today, to: due, overdue: due < today };
};

const FB_HEAD = /feedback|review|retro|critique|rework|\bpass\b/i;
const REV_NOTE = /·\s*rev\b/i;
const fbBlocksIn = (text) => {
  let n = 0, bullets = -1; // -1 = outside a feedback-headed section
  for (const ln of String(text || '').split('\n')) {
    const hm = ln.match(/^#{2,4}\s+(.+)$/);
    if (hm) {
      if (bullets > 0) n++;
      bullets = FB_HEAD.test(String(hm[1]).replace(/\s*\{#[^}]*\}\s*$/g, '')) ? 0 : -1;
      continue;
    }
    if (bullets >= 0 && /^\s*-\s+\S/.test(ln)) bullets++;
  }
  if (bullets > 0) n++;
  return n;
};

// Eval count = gate feedback blocks + rev notes: REF GATE `· rev` entries
// plus feedback/review-headed sections that carry bullets.
export const evalsOf = (raw) => {
  const text = String(raw || '');
  return parseGates(text).filter((g) => REV_NOTE.test(g.note || '')).length + fbBlocksIn(text);
};

const rangeOf = (dates) => {
  if (!dates.length) return '';
  return dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`;
};

const titleOf = (plan = {}) =>
  plan.title
  || planSentence({ h1: plan.h1 || '', goal: plan.goal || (plan.raw ? goalOf(plan.raw) : ''), slug: plan.slug || plan.file || '' });

// Overall summary: { title, status, commits, revs, evals, range, due, overdue }.
export const planSummary = (plan = {}, todayISO) => {
  const sections = sectionsOf(plan);
  const due = earliestDueOf(plan);
  const today = ISO.test(todayISO || '') ? todayISO : isoToday();
  return {
    title: titleOf(plan),
    status: buildState(liveSprints(sections)),
    commits: ((plan && plan.commits) || []).length,
    revs: revsOf(plan).length,
    evals: evalsOf(plan.raw || ''),
    range: rangeOf(activeDatesOf(plan)),
    due,
    overdue: !!due && due < today,
  };
};

// Bout-scoped summary: same shape, filtered to bout.dates only — commits /
// revs with date ∈ bout; tasks = sections with hits ∩ bout ≠ ∅ + state line;
// evals = rev notes dated in bout + feedback blocks inside those sections.
// phases = owning-section count; complete = all bout checkboxes done.
export const boutSummary = (plan = {}, bout = {}, todayISO) => {
  const inBout = new Set(bout.dates || []);
  const has = (c) => c && inBout.has(c.date);
  const sections = sectionsOf(plan).filter((s) => sectionCommits(s).some(has));
  const due = earliestDueOf(plan);
  const today = ISO.test(todayISO || '') ? todayISO : isoToday();
  let evals = parseGates(plan.raw || '').filter((g) => REV_NOTE.test(g.note || '') && g.date && inBout.has(g.date)).length;
  for (const s of sections) evals += fbBlocksIn(s.body || '');
  const status = buildState(sections);
  const dates = [...inBout].filter((d) => ISO.test(d)).sort();
  return {
    title: titleOf(plan),
    status,
    phases: sections.length,
    phasesDone: sections.filter((s) => isCancelledHead(s.head) || isDone(buildState([s]))).length,
    complete: isDone(status),
    done: dates.length ? dates[dates.length - 1] : null,
    commits: ((plan && plan.commits) || []).filter(has).length,
    revs: revsOf(plan).filter(has).length,
    evals,
    range: rangeOf(dates),
    due,
    overdue: !!due && due < today,
  };
};

// data-tip text: first incomplete section's description, else plan goal —
// markdown-stripped and clipped so no raw newlines, **, backticks, links or
// {#anchors} ever land inside the attribute. Empty → tip node stays hidden.
export const planTip = (plan = {}, max = 100) => {
  const sections = sectionsOf(plan);
  const first = sections.find((s) => !/[✓✗]/.test(String(s.head || '')) && !isDone(state(s.body || ''))) || sections[0];
  return clip(oneLine((first && descOf(first.body || '')) || plan.goal || ''), max);
};
