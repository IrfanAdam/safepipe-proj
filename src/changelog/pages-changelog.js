// safepipe changelog — pages composer · glob + state · [plan:2026-10-07_130000-safepipe-changelog.md#task-3]
// Exports: render, mount — eager glob + hits contract preserved (events live in changelog-events.js)
import { hits } from './changelog-links.js';
import { commits } from './changelog-links.js';
import { TAGS, tagsFor, planTags, parseExplicit } from './changelog-tags.js';
import { h1Of, planSentence } from './changelog-titles.js';

import names from '../ds/changelog-names.json';
import history from '../ds/plan-history.json';
import { goal, split, parseMeta, anchorOf, phash, dueOf } from './changelog-parse.js';
import { paint } from './changelog-paint.js';
import { duePreviewEdit } from './changelog-events.js';
import { loadDueOverrides, dropDueOverride } from '../logic/due-overrides.js';
import { TIMELINE_TILE_ICON } from './changelog/graph.js';
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
// Re-apply same-device due overrides (production has no file writer): stored
// picks fill sections the FILE leaves dateless; a file-carried Due always
// wins, so hand edits and dev writes are never clobbered — stale entries drop.
try {
  for (const o of loadDueOverrides()) {
    const plan = plans.find((p) => p.file === o.file);
    const sec = plan ? plan.sprints.find((s) => s.head === o.head) : null;
    if (!sec) { dropDueOverride(o.file, o.head); continue; }
    const current = dueOf(sec);
    if (o.due) {
      if (current === o.due) { dropDueOverride(o.file, o.head); continue; }
      // Server-confirmed pick (committed to git): the repo is newer than this
      // bundle during the deploy window, so it outranks the file. Expires in
      // a day — by then the redeploy carries the value (or a hand-edit won,
      // and the file takes over again).
      if (o.committed && Date.now() - (o.at || 0) < 86400000) {
        sec.body = duePreviewEdit(sec.body, sec.head, o.due);
        continue;
      }
      if (current) { dropDueOverride(o.file, o.head); continue; }
      sec.body = duePreviewEdit(sec.body, sec.head, o.due);
    } else {
      if (!current) { dropDueOverride(o.file, o.head); continue; }
      sec.body = duePreviewEdit(sec.body, sec.head, null);
    }
  }
} catch {}
// Augment texts with anchor tokens so boundary-aware matching sees section
// numbers even when the raw markdown never spells the anchor literally.
const texts = { ...rawTexts };
plans.forEach((p) => { p.sprints.forEach((s) => { const a = anchorOf(s.head); if (a) texts[p.file] += `\n{#${a}}`; }); });
const counts = TAGS.map((t) => [t, plans.filter((p) => p.tags.includes(t)).length]).filter(([, n]) => n);
const st = { active: new Set(), day: '', sel: [0, 0], open: false, stage: 'list',
  view: 'list', tlSel: null, tlLast: null, tlSort: '', returnView: null, tlDate: '' };
let tlToken = 0;
const visiblePlans = () => plans
  .filter((p) => (!st.active.size || p.tags.some((t) => st.active.has(t)))
    && (!st.day || p.date === st.day || commits.some((c) => c.plan === p.file && c.date === st.day)));
// Timeline ignores the landing day-blob filter: tracks always span the full
// range. Track chips (st.active) still apply.
const visiblePlansNoDay = () => plans
  .filter((p) => !st.active.size || p.tags.some((t) => st.active.has(t)));
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
    btn.innerHTML = `<span class="ds-chip-timeline__icon" aria-hidden="true">${TIMELINE_TILE_ICON}</span> All ${n} track${n === 1 ? '' : 's'}`;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', `${n} plans in timeline — ${on ? 'close' : 'open'} timeline view`);
  }
  syncTimelineURL();
  const my = ++tlToken;
  const panel = root.querySelector('[data-timeline]');
  if (st.view !== 'timeline') { if (panel) panel.hidden = true; return; }
  import('./changelog/timeline-paint.js').then((m) => {
    if (my !== tlToken || st.view !== 'timeline') return;
    m.paintTimeline(root, { list: st.view === 'timeline' ? visiblePlansNoDay() : list, st });
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
  // Survive file-watch reloads (setting a deadline rewrites the plan file,
  // and the dev server reloads on the .md change): restore the UI snapshot
  // taken at unload so the drawer reopens where the author left it.
  try {
    const raw = sessionStorage.getItem('safepipe-ui-snapshot');
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.sel)) st.sel = s.sel;
      if (typeof s.open === 'boolean') st.open = s.open;
      if (typeof s.stage === 'string') st.stage = s.stage;
      if (s.view === 'timeline' || s.view === 'list') st.view = s.view;
      sessionStorage.removeItem('safepipe-ui-snapshot');
    }
  } catch {}
  try {
    window.addEventListener('beforeunload', () => {
      try {
        sessionStorage.setItem('safepipe-ui-snapshot',
          JSON.stringify({ sel: st.sel, open: st.open, stage: st.stage, view: st.view }));
      } catch {}
    });
  } catch {}
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
