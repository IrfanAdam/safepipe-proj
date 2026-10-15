// safepipe changelog — timeline tracks view · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#task-2]
// Exports: paintTimeline, timelineGrid, sortTimelineRows, boutPopText, boutPopLines
// View layer only: streak/sporadic/ghost tracks + overall summary over the
// frozen lane-A model (../changelog-timeline.js). Bout popovers reuse
// boutSummary — no reimplemented grouping.
import { activeDatesOf, boutsOf, ghostOf, boutSummary, planTip, MERGE_GAP } from '../changelog-timeline.js';
import { hits, commits } from '../changelog-links.js';
import { state, isDone, buildState, dueOf, fmtDate, isoDay } from '../changelog-parse.js';
import { clip, oneLine } from '../changelog-titles.js';
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

// Bout popover lines: title / tasks / 'C commits · R revs' / range + Due.
// boutPopText stays the one-line form for the summary sumline.
export function boutPopLines(sum) {
  if (!sum) return '';
  const lines = [sum.title];
  if (sum.status) lines.push(`${sum.status} tasks`);
  lines.push(`${sum.commits} commit${sum.commits === 1 ? '' : 's'} · ${sum.revs} rev${sum.revs === 1 ? '' : 's'}`);
  if (sum.range) lines.push(sum.range);
  if (sum.due) lines.push(`Due ${sum.due}${sum.overdue ? ' (overdue)' : ''}`);
  return lines.filter(Boolean).join('\n');
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
  // Min-width of 2 day-columns so one-day/sporadic bars read as bars.
  const span = Math.max(Math.round((pISO(e) - pISO(s)) / DAY) + 1, 2);
  return `left:calc(var(--cl-tl-day) * ${off});width:calc(var(--cl-tl-day) * ${span})`;
};

export function paintTimeline(root, ctx) {
  const { list, st } = ctx;
  const panel = root.querySelector('[data-timeline]');
  const pop = root.querySelector('[data-tl-pop]');
  if (!panel) return;
  if (st.view !== 'timeline') { panel.hidden = true; if (pop) pop.hidden = true; return; }
  // Owner call: a plan opened from the timeline shows the one familiar plan
  // panel, never two panels at once — the timeline hides underneath and its
  // close (✕/scrim/Esc, same drawer path) lands back on the timeline.
  if (st.open && st.returnView === 'timeline') { panel.hidden = true; if (pop) pop.hidden = true; return; }
  panel.hidden = false;
  const today = todayISO();
  const dc = {};
  commits.forEach((c) => { if (c.date) dc[c.date] = (dc[c.date] || 0) + 1; });
  const max = Math.max(1, ...Object.values(dc));
  let rows = (list || []).map((plan) => {
    const ep = enrich(plan);
    let dates = [], bouts = [], ghost = null, tip = '';
    try {
      dates = activeDatesOf(ep) || [];
      bouts = boutsOf(dates, MERGE_GAP) || [];
      ghost = ghostOf(ep, today);
      tip = planTip(ep, 100) || clip(oneLine(ep.title), 100);
    } catch { dates = []; bouts = []; ghost = null; tip = ''; }
    return { plan: ep, dates, bouts, ghost,
      frac: buildState(ep.sprints || []), tip };
  });
  const grid = timelineGrid(rows, today);
  rows = sortTimelineRows(rows, st.tlSort);
  // Selection: explicit bout or default overall = first track (bout state only
  // drives bar highlight + deep link — the summary always shows overall).
  let selRow = rows[0] || null, selBout = null;
  if (st.tlSel) {
    const hit = rows.find((r) => r.plan.file === st.tlSel.planFile);
    const b = hit && hit.bouts[st.tlSel.boutIdx];
    if (hit && b) { selRow = hit; selBout = b; }
    else st.tlSel = null;
  }
  const selIdx = selRow && selBout ? selRow.bouts.indexOf(selBout) : -1;
  // Axis: daily ticks — bare day numbers, month-start tick shows '1 Oct'.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayNum = (iso) => String(Number(iso.slice(8, 10)));
  const monName = (iso) => MON[Number(iso.slice(5, 7)) - 1] || '';
  let ticks = '';
  for (let d = grid.start; cmpDay(d, grid.end) <= 0; d = addDays(d, 1)) {
    const off = Math.round((pISO(d) - pISO(grid.start)) / DAY);
    const isMonth = d.slice(8) === '01';
    const label = isMonth ? `${dayNum(d)} ${monName(d)}` : dayNum(d);
    ticks += `<span class="ds-tl-tick${isMonth ? ' is-month' : ''}" style="left:calc(var(--cl-tl-day) * ${off})">${esc(label)}</span>`;
  }
  // Per-month background bands: literal ds-tl-band / ds-tl-band alt classes,
  // alternating behind the bars.
  let bands = '';
  {
    let cur = grid.start, mi = 0;
    while (cmpDay(cur, grid.end) <= 0) {
      const [y, mo] = cur.split('-').map(Number);
      const mEnd = isoOf(new Date(y, mo, 0));
      const segEnd = cmpDay(mEnd, grid.end) < 0 ? mEnd : grid.end;
      const off = Math.round((pISO(cur) - pISO(grid.start)) / DAY);
      const span = Math.max(Math.round((pISO(segEnd) - pISO(cur)) / DAY) + 1, 1);
      bands += `<div class="ds-tl-band${mi % 2 ? ' alt' : ''}" style="left:calc(var(--cl-tl-day) * ${off});width:calc(var(--cl-tl-day) * ${span})" aria-hidden="true"></div>`;
      cur = addDays(segEnd, 1);
      mi += 1;
    }
  }
  const laneW = `width:calc(var(--cl-tl-day) * ${grid.days})`;
  const todayOff = Math.round((pISO(today) - pISO(grid.start)) / DAY);
  const todayLine = (todayOff >= 0 && todayOff < grid.days)
    ? `<span class="ds-tl-today" style="left:calc(var(--cl-tl-day) * ${todayOff})"></span>` : '';
  const body = rows.length ? rows.map((r) => {
    // Owner call: the plan name rides its longest bar, not a sidebar label.
    let li = -1, best = -1;
    r.bouts.forEach((b, i) => {
      const span = Math.round((pISO(b.end) - pISO(b.start)) / DAY);
      if (span > best) { best = span; li = i; }
    });
    const bars = r.bouts.map((b, i) => {
      let bs = null;
      try { bs = boutSummary(r.plan, b, today); } catch { bs = null; }
      const n = b.dates.reduce((a, d) => a + (dc[d] || 0), 0);
      const lv = lvOf(n, max);
      const cls = b.kind === 'streak' ? 'ds-tl-streak' : 'ds-tl-bout';
      const cur = (selRow === r && selIdx === i) ? ' aria-current="true"' : '';
      const nm = i === li ? `<span class="ds-tl-barname">${esc(r.plan.title)}</span>` : '';
      return `<button class="${cls} lv${lv}" style="${barGeom(grid.start, b.start, b.end)}"` +
        ` data-tl-bout="${esc(r.plan.file)}:${i}" data-tip="${esc(r.tip)}"` +
        ` data-pop="${esc(boutPopLines(bs))}"${cur}` +
        ` aria-label="${esc(`${r.plan.title}, ${b.kind} ${b.start} to ${b.end}`)}">${nm}</button>`;
    }).join('');
    let g = '';
    if (r.ghost) {
      const gTip = `Due ${r.ghost.to}${r.ghost.overdue ? ' · overdue' : ''} · ` + r.tip;
      const gNm = li < 0 ? `<span class="ds-tl-barname">${esc(r.plan.title)}</span>` : '';
      g = `<button class="ds-tl-ghost${r.ghost.overdue ? ' is-overdue' : ''}" style="${barGeom(grid.start, r.ghost.from, r.ghost.to)}"` +
        ` data-tl-ghost="${esc(r.plan.file)}" data-tip="${esc(gTip)}"` +
        ` aria-label="${esc('Upcoming work due ' + r.ghost.to + ' in ' + r.plan.title)}">${gNm}</button>`;
    }
    const laneOpen = (!bars && !g)
      ? `<button class="ds-tl-lane-name" data-tl-open="${esc(r.plan.file)}" data-tip="${esc(r.tip)}" aria-label="Open ${esc(r.plan.title)}">${esc(r.plan.title)}</button>` : '';
    return `<div class="ds-tl-row" data-tl-row="${esc(r.plan.file)}">` +
      `<div class="ds-tl-lane" style="${laneW}">${bands}${bars}${g}${todayLine}${laneOpen}</div></div>`;
  }).join('') : `<p class="ds-tl-empty">Nothing matches the current filters yet.</p>`;
  const rangeTxt = rows.length ? `${fmtDate(grid.start)} → ${fmtDate(grid.end)}` : '';
  panel.innerHTML = [
    `<div class="ds-tl-head"><b>Timeline</b><small>${esc(rangeTxt)}</small>`,
    `<button data-tl-close aria-label="Close timeline">✕</button></div>`,
    `<div class="ds-tl-scroll"><div class="ds-tl-axis">` +
    `<div class="ds-tl-ticks" style="${laneW}">${ticks}</div></div>${body}</div>`,
  ].join('');
  if (pop) pop.hidden = true;
}

// Re-exported for events: ghost owning-section lookup shares this rule.
export { ghostSection };
