// safepipe changelog — timeline tracks view · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#task-2]
// Exports: paintTimeline, timelineGrid, sortTimelineRows, boutPopText
// View layer only: streak/sporadic/ghost tracks + two summary levels over the
// frozen lane-A model (../changelog-timeline.js). Bout items reuse badges() +
// paintRevs() — no reimplemented grouping.
import { activeDatesOf, boutsOf, ghostOf, planSummary, boutSummary, planTip, MERGE_GAP } from '../changelog-timeline.js';
import { hits, commits, badges } from '../changelog-links.js';
import { state, isDone, parseGates, buildState, dueOf, fmtDate, isoDay } from '../changelog-parse.js';
import { clip, oneLine } from '../changelog-titles.js';
import { paintRevs } from './paint-revs.js';
import { esc } from './esc.js';
import history from '../../ds/plan-history.json';

const DAY = 864e5;
const isoOf = (d) => isoDay(d);
const todayISO = () => isoOf(new Date());
const pISO = (s) => new Date(s + 'T00:00:00');
const addDays = (s, n) => isoOf(new Date(pISO(s).getTime() + n * DAY));
const cmpDay = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Caller-attached model shape (cf. changelog-timeline.js header): per-section
// hits-identical commits + plan-level commits/revs. The model must not import
// changelog-links (manifest JSON is unloadable in node), so the view attaches.
const enrich = (plan) => {
  const sprints = (plan.sprints || []).map((s) => ({ ...s }));
  const flat = [];
  sprints.forEach((s, i) => {
    s.commits = null;
    try { s.commits = hits(plan.file, s.body, i === 0); } catch { s.commits = []; }
    flat.push(...s.commits);
  });
  let attached = [];
  try { attached = commits.filter((c) => c.plan === plan.file && !flat.includes(c)); } catch { attached = []; }
  return { ...plan, sprints, commits: flat.concat(attached), revs: history[plan.file] || [] };
};

// Owning incomplete section for a ghost bar: first incomplete sprint with a Due
// (via lane-A dueOf), else first incomplete, else 0.
const ghostSection = (plan) => {
  const ss = plan.sprints || [];
  const openIdx = ss.map((s, i) => (!isDone(state(s.body)) ? i : -1)).filter((i) => i >= 0);
  if (!openIdx.length) return 0;
  const due = openIdx.find((i) => { try { return !!dueOf(ss[i]); } catch { return false; } });
  return due !== undefined ? due : openIdx[0];
};

// Commit-density level mirroring the calendar sqrt scale (graph.js).
const lvOf = (n, max) => !n ? 0 : Math.min(4, Math.ceil(4 * Math.sqrt(n / Math.max(max, 1))));

// Global column bounds: min(active, planDate) → max(today, latestDue).
export function timelineGrid(rows, today) {
  const t = today || todayISO();
  let start = t, end = t, any = false;
  for (const r of rows) {
    const pts = [...(r.dates || [])];
    if (r.plan.date) pts.push(r.plan.date);
    if (r.ghost) { pts.push(r.ghost.from, r.ghost.to); }
    for (const p of pts) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p || '')) continue;
      if (!any || cmpDay(p, start) < 0) start = p;
      if (!any || cmpDay(p, end) > 0) end = p;
      any = true;
    }
  }
  if (any && cmpDay(end, t) < 0) end = t;
  const days = Math.max(Math.round((pISO(end) - pISO(start)) / DAY) + 1, 1);
  return { start, end, days };
}

// "What's next": overdue ghosts top, then nearest Due, then the rest in list order.
export function sortTimelineRows(rows, sort) {
  if (sort !== 'next') return rows;
  const key = (r) => (!r.ghost ? [2, '9999'] : r.ghost.overdue ? [0, r.ghost.to] : [1, r.ghost.to]);
  return [...rows].map((r, i) => [r, i]).sort(([a, ai], [b, bi]) => {
    const ka = key(a), kb = key(b);
    return ka[0] - kb[0] || cmpDay(ka[1], kb[1]) || ai - bi;
  }).map(([r]) => r);
}

// Bout popover snippet: "{title} · {d/t} tasks · {C} commits · {R} revs · {range}" + Due.
export function boutPopText(sum) {
  if (!sum) return '';
  const core = [sum.title, sum.status ? `${sum.status} tasks` : '',
    `${sum.commits} commit${sum.commits === 1 ? '' : 's'}`,
    `${sum.revs} rev${sum.revs === 1 ? '' : 's'}`,
    sum.range].filter(Boolean).join(' · ');
  return core + (sum.due ? ` · Due ${sum.due}${sum.overdue ? ' (overdue)' : ''}` : '');
}

const barGeom = (startISO, s, e) => {
  const off = Math.max(Math.round((pISO(s) - pISO(startISO)) / DAY), 0);
  const span = Math.max(Math.round((pISO(e) - pISO(s)) / DAY) + 1, 1);
  return `left:calc(var(--cl-tl-day) * ${off});width:calc(var(--cl-tl-day) * ${span})`;
};

function summaryHTML(plan, bout, sum) {
  const commitsOf = (plan.commits || []).filter((c) => !bout || bout.dates.includes(c.date));
  const heads = (plan.sprints || []).map((s) => s.head);
  const gates = parseGates(plan.raw || '');
  let revsHTML = '';
  if (bout) {
    const brev = (plan.revs || []).filter((r) => bout.dates.includes(r.date));
    const involved = (plan.sprints || []).filter((s) =>
      (s.commits || []).some((c) => bout.dates.includes(c.date)));
    revsHTML = involved.map((s) =>
      paintRevs(brev, { head: s.head, heads, gates })).join('');
  }
  const back = bout
    ? `<button class="ds-tl-back" data-tl-overall aria-label="Back to overall summary">← overall</button>` : '';
  // Owner call: the overall summary stays a one-line sumline — commit/eval
  // item lists render only on bout select, never as a second scrolling pane.
  const items = bout ? `<div class="ds-tl-items">${badges(commitsOf)}${revsHTML}</div>` : '';
  return [
    `<div class="ds-tl-summary" data-tl-summary>`,
    `<b>${esc(sum.title || plan.title)}</b>`,
    `<p class="ds-tl-sumline">${esc(boutPopText(sum))}</p>`,
    back,
    items,
    `</div>`,
  ].join('');
}

export function paintTimeline(root, ctx) {
  const { list, st } = ctx;
  const panel = root.querySelector('[data-timeline]');
  const pop = root.querySelector('[data-tl-pop]');
  if (!panel) return;
  if (st.view !== 'timeline') { panel.hidden = true; if (pop) pop.hidden = true; return; }
  panel.hidden = false;
  const today = todayISO();
  const dc = {};
  commits.forEach((c) => { if (c.date) dc[c.date] = (dc[c.date] || 0) + 1; });
  const max = Math.max(1, ...Object.values(dc));
  let rows = (list || []).map((plan) => {
    const ep = enrich(plan);
    let dates = [], bouts = [], ghost = null, sum = null, tip = '';
    try {
      dates = activeDatesOf(ep) || [];
      bouts = boutsOf(dates, MERGE_GAP) || [];
      ghost = ghostOf(ep, today);
      sum = planSummary(ep, today);
      tip = planTip(ep, 100) || clip(oneLine(ep.title), 100);
    } catch { dates = []; bouts = []; ghost = null; sum = null; tip = ''; }
    return { plan: ep, dates, bouts, ghost, sum,
      frac: buildState(ep.sprints || []), tip };
  });
  const grid = timelineGrid(rows, today);
  rows = sortTimelineRows(rows, st.tlSort);
  // Selection: explicit bout or default overall = first track.
  let selRow = rows[0] || null, selBout = null, selSum = null;
  if (st.tlSel) {
    const hit = rows.find((r) => r.plan.file === st.tlSel.planFile);
    const b = hit && hit.bouts[st.tlSel.boutIdx];
    if (hit && b) {
      selRow = hit; selBout = b;
      try { selSum = boutSummary(hit.plan, b, today); } catch { selSum = null; }
    } else st.tlSel = null;
  }
  if (!selSum) selSum = (selRow && selRow.sum) || null;
  const selIdx = selRow && selBout ? selRow.bouts.indexOf(selBout) : -1;
  const overdueN = rows.filter((r) => r.ghost && r.ghost.overdue).length;
  // Axis: weekly ticks.
  let ticks = '';
  for (let d = grid.start; cmpDay(d, grid.end) <= 0; d = addDays(d, 7)) {
    const off = Math.round((pISO(d) - pISO(grid.start)) / DAY);
    ticks += `<span class="ds-tl-tick" style="left:calc(var(--cl-tl-day) * ${off})">${esc(fmtDate(d))}</span>`;
  }
  const laneW = `width:calc(var(--cl-tl-day) * ${grid.days})`;
  const todayOff = Math.round((pISO(today) - pISO(grid.start)) / DAY);
  const todayLine = (todayOff >= 0 && todayOff < grid.days)
    ? `<span class="ds-tl-today" style="left:calc(var(--cl-tl-day) * ${todayOff})"></span>` : '';
  const body = rows.length ? rows.map((r) => {
    const bars = r.bouts.map((b, i) => {
      let bs = null;
      try { bs = boutSummary(r.plan, b, today); } catch { bs = null; }
      const n = b.dates.reduce((a, d) => a + (dc[d] || 0), 0);
      const lv = lvOf(n, max);
      const cls = b.kind === 'streak' ? 'ds-tl-streak' : 'ds-tl-bout';
      const cur = (selRow === r && selIdx === i) ? ' aria-current="true"' : '';
      return `<button class="${cls} lv${lv}" style="${barGeom(grid.start, b.start, b.end)}"` +
        ` data-tl-bout="${esc(r.plan.file)}:${i}" data-tip="${esc(r.tip)}"` +
        ` data-pop="${esc(boutPopText(bs))}"${cur}` +
        ` aria-label="${esc(`${r.plan.title}, ${b.kind} ${b.start} to ${b.end}`)}"></button>`;
    }).join('');
    let g = '';
    if (r.ghost) {
      const gTip = `Due ${r.ghost.to}${r.ghost.overdue ? ' · overdue' : ''} · ` + r.tip;
      g = `<button class="ds-tl-ghost${r.ghost.overdue ? ' is-overdue' : ''}" style="${barGeom(grid.start, r.ghost.from, r.ghost.to)}"` +
        ` data-tl-ghost="${esc(r.plan.file)}" data-tip="${esc(gTip)}"` +
        ` aria-label="${esc('Upcoming work due ' + r.ghost.to + ' in ' + r.plan.title)}"></button>`;
    }
    return `<div class="ds-tl-row" data-tl-row="${esc(r.plan.file)}">` +
      `<button class="ds-tl-label" data-tl-open="${esc(r.plan.file)}" data-tip="${esc(r.tip)}"` +
      ` aria-label="Open ${esc(r.plan.title)}"><b>${esc(r.plan.title)}</b>` +
      `<small>${esc([r.plan.date, r.frac].filter(Boolean).join(' · '))}</small></button>` +
      `<div class="ds-tl-lane" style="${laneW}">${bars}${g}${todayLine}</div></div>`;
  }).join('') : `<p class="ds-tl-empty">Nothing matches the current filters yet.</p>`;
  const rangeTxt = rows.length ? `${fmtDate(grid.start)} → ${fmtDate(grid.end)}` : '';
  panel.innerHTML = [
    `<div class="ds-tl-head"><b>Timeline</b><small>${esc(rangeTxt)}</small>`,
    `<button data-tl-close aria-label="Close timeline">✕</button></div>`,
    selRow && selSum ? summaryHTML(selRow.plan, selBout, selSum) : '',
    `<div class="ds-tl-tools" role="group" aria-label="Timeline tools">`,
    `<button data-tl-sort aria-pressed="${st.tlSort === 'next'}" aria-label="Sort nearest due first">What's next</button>`,
    overdueN ? `<span class="ds-tl-overdue">${overdueN} overdue</span>` : '',
    `</div>`,
    `<div class="ds-tl-scroll"><div class="ds-tl-axis"><span class="ds-tl-corner"></span>` +
    `<div class="ds-tl-ticks" style="${laneW}">${ticks}</div></div>${body}</div>`,
  ].join('');
  if (pop) pop.hidden = true;
}

// Re-exported for events: ghost owning-section lookup shares this rule.
export { ghostSection };
