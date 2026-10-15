// safepipe changelog — pages composer · glob + state · [plan:2026-10-07_130000-safepipe-changelog.md#task-3]
// Exports: render, mount — eager glob + hits contract preserved (events live in changelog-events.js)
import { hits } from './changelog-links.js';
import { commits } from './changelog-links.js';
import { TAGS, tagsFor, planTags, parseExplicit } from './changelog-tags.js';
import { h1Of, planSentence } from './changelog-titles.js';
import { TIMELINE_TILE_ICON } from './changelog/graph.js';
import names from '../ds/changelog-names.json';
import history from '../ds/plan-history.json';
import { goal, split, parseMeta, anchorOf, phash } from './changelog-parse.js';
import { paint } from './changelog-paint.js';
import { bindChangelogEvents } from './changelog-events.js';

// Plan-iteration revisions: versions append (tracker hook + backfill), oldest first.
const revOf = (file) => {
  const vs = history[file] || [];
  return vs.length > 1 ? { n: vs.length, last: vs[vs.length - 1].date } : null;
};
const sectionEdited = (file, s) => {
  const vs = history[file] || [];
  if (vs.length < 2) return false;
  const cur = phash(s.head + '\n' + s.body);
  const olds = vs.slice(0, -1).flatMap((v) => v.sections.filter((x) => x.head === s.head.slice(0, 80)).map((x) => x.hash));
  if (!olds.length) return true; // head never seen before = added or renamed
  return olds.some((h) => h !== cur);
};

const raws = import.meta.glob('../../.hermes/plans/*.md', { query: '?raw', import: 'default', eager: true });
const entries = Object.entries(raws).sort(([a], [b]) => b.localeCompare(a));
const rawTexts = Object.fromEntries(entries.map(([p, md]) => [p.split('/').pop(), md]));
const HIDDEN = /<!--\s*(?:changelog|builds):\s*hide\s*-->/;
const plans = entries.map(([p, md]) => {
  const file = p.split('/').pop();
  const { date, id, slug } = parseMeta(file);
  const h1 = h1Of(md), g = goal(md), nm = names[file] || {};
  const sprints = split(md), steer = parseExplicit(md.split(/^## /m)[0]);
  sprints.forEach((s) => { s.tags = tagsFor(s.head, s.body, steer); });
  return { file,
    date,
    id,
    slug,
    h1,
    title: nm.title || planSentence({ h1, goal: g, slug }),
    purpose: nm.purpose || '',
    goal: g,
    sprints,
    tags: planTags(md, sprints),
    raw: md };
}).filter((pl) => pl.sprints.length && !HIDDEN.test(pl.raw));
// Augment texts with anchor tokens so boundary-aware matching sees section
// numbers even when the raw markdown never spells the anchor literally.
const texts = { ...rawTexts };
plans.forEach((p) => { p.sprints.forEach((s) => { const a = anchorOf(s.head); if (a) texts[p.file] += `\n{#${a}}`; }); });
const counts = TAGS.map((t) => [t, plans.filter((p) => p.tags.includes(t)).length]).filter(([, n]) => n);
const st = { active: new Set(), day: '', sel: [0, 0], open: false, stage: 'list',
  view: 'list', tlSel: null, tlLast: null, tlSort: '', returnView: null };
let tlToken = 0;
const visiblePlans = () => plans
  .filter((p) => (!st.active.size || p.tags.some((t) => st.active.has(t)))
    && (!st.day || p.date === st.day || commits.some((c) => c.plan === p.file && c.date === st.day)));
const visibleSprints = (plan) => {
  const ss = st.active.size ? plan.sprints.filter((s) => s.tags.some((t) => st.active.has(t))) : plan.sprints;
  return ss.length ? ss : plan.sprints;
};
const cur = () => {
  const list = visiblePlans(), pi = Math.min(st.sel[0], Math.max(list.length - 1, 0));
  const plan = list[pi], sprints = plan ? visibleSprints(plan) : [];
  return { list, pi, plan, sprints, si: Math.min(st.sel[1], Math.max(sprints.length - 1, 0)) };
};
export function render() {
  return [
    `<p class="ds-crumb">Start · Changelog</p><div class="ds-hero wide"><h1>What shipped, in order.</h1></div>`,
    `<hr class="ds-hr"><div class="ds-graph" data-col="graph"></div>`,
    `<div class="ds-chips" data-col="chips"></div>`,
    `<div class="ds-plan-grid"><div class="ds-col" data-col="plan"></div></div><div class="ds-md" data-col="triage">`,
    `</div><div class="ds-scrim" data-scrim hidden></div><span class="ds-cursor-tip" hidden role="tooltip"><span class="ds-cursor-tip__text"></span></span>`,
    `<aside class="ds-timeline" data-timeline hidden aria-label="Plan timeline"></aside>`,
    `<div class="ds-tl-pop" data-tl-pop hidden role="status"></div>`,
    `<aside class="ds-drawer" data-drawer hidden aria-label="Build detail">`,
    `<div class="ds-rail" data-col="sprint"></div><div class="ds-task" data-col="tasks"></div></aside>`,
  ].join('');
}
function syncTimelineURL() {
  try {
    const q = new URLSearchParams(location.search);
    if (st.view === 'timeline') {
      q.set('view', 'timeline');
      if (st.tlSel) { q.set('plan', st.tlSel.planFile); q.set('bout', String(st.tlSel.boutIdx)); }
      else q.delete('plan'), q.delete('bout');
    } else q.delete('view'), q.delete('plan'), q.delete('bout');
    const s = q.toString();
    globalThis.history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  } catch {}
}
function doPaint(root) {
  const { list, pi, plan, sprints, si } = cur();
  st.sel = [pi, si];
  paint(root, { list, pi, plan, sprints, si, active: st.active, day: st.day,
    sel: st.sel, open: st.open, stage: st.stage, counts, plans, texts,
    rev: plan ? revOf(plan.file) : null, revOf, edited: plan ? (s) => sectionEdited(plan.file, s) : () => false,
    revs: plan ? (history[plan.file] || []) : [] });
  const scrim = root.querySelector('[data-scrim]');
  if (scrim) scrim.hidden = !(st.open || st.view === 'timeline');
  const btn = root.querySelector('[data-view="timeline"]');
  if (btn) {
    const n = list.length, on = st.view === 'timeline';
    btn.innerHTML = `${TIMELINE_TILE_ICON}<span class="ds-timeline-gridtile__text">All ${n} track${n === 1 ? '' : 's'}</span>`;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', `${n} plans in timeline — ${on ? 'close' : 'open'} timeline view`);
  }
  syncTimelineURL();
  const my = ++tlToken;
  const panel = root.querySelector('[data-timeline]');
  if (st.view !== 'timeline') { if (panel) panel.hidden = true; return; }
  import('./changelog/timeline-paint.js').then((m) => {
    if (my !== tlToken || st.view !== 'timeline') return;
    m.paintTimeline(root, { list, st });
  }).catch(() => {
    if (my !== tlToken || !panel) return;
    panel.hidden = false;
    panel.innerHTML = `<div class="ds-tl-head"><b>Timeline</b>` +
      `<button data-tl-close aria-label="Close timeline">✕</button></div>` +
      `<p class="ds-tl-fallback">Timeline tracks are unavailable — the timeline model module has not landed yet.</p>`;
  });
}
export function mount(root) {
  st.open = false; st.stage = 'list';
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('view') === 'timeline') {
      st.view = 'timeline';
      const f = q.get('plan'), b = q.get('bout');
      if (f && plans.some((p) => p.file === f)) {
        const li = visiblePlans().findIndex((p) => p.file === f);
        st.sel = [Math.max(li, 0), 0]; st.open = true; st.stage = 'tasks'; st.returnView = 'timeline';
        if (b !== null && b !== '' && Number.isInteger(Number(b))) {
          st.tlSel = { planFile: f, boutIdx: Number(b) };
          st.tlLast = st.tlSel;
        }
      }
    }
  } catch {}
  doPaint(root);
  return bindChangelogEvents(root, st, { cur, doPaint });
}
