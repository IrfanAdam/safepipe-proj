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

// Edge-caret sync: per row, reveal « when the tracks sit left of the visible
// window, » when right of it. Runs on paint, scroll, and post-layout rAF.
export function syncTlEdges(panel) {
  if (!panel) return;
  const sc = panel.querySelector('.ds-tl-scroll');
  if (!sc) return;
  const vr = sc.getBoundingClientRect(), slop = 24;
  // Sticky month: badge pinned at the axis left edge names the leftmost
  // visible month — shown only once that month's own tick scrolled out.
  const badge = panel.querySelector('[data-tl-curmonth]');
  if (badge) {
    const months = [...panel.querySelectorAll('.ds-tl-tick.is-month')];
    let cur = '', curLeft = Infinity;
    for (const m of months) {
      const l = m.getBoundingClientRect().left;
      if (l <= vr.left + slop) { cur = m.textContent; curLeft = l; }
    }
    if (!cur && months.length) { cur = months[0].textContent; curLeft = months[0].getBoundingClientRect().left; }
    if (badge.textContent !== cur) badge.textContent = cur;
    badge.hidden = !(cur && curLeft < vr.left);
  }
  panel.querySelectorAll('[data-tl-row]').forEach((row) => {
    const tracks = [...row.querySelectorAll('[data-tl-bout],[data-tl-ghost]')];
    const L = row.querySelector('[data-tl-edge="l"]'), R = row.querySelector('[data-tl-edge="r"]');
    if (!tracks.length) { if (L) L.hidden = true; if (R) R.hidden = true; return; }
    const f = tracks[0].getBoundingClientRect(), l = tracks[tracks.length - 1].getBoundingClientRect();
    if (L) L.hidden = !(l.right < vr.left + slop);
    if (R) R.hidden = !(f.left > vr.right - slop);
  });
}
// Global column bounds: min(active, planDate) → max(today, latestDue),
// padded to whole prev/next months so empty month context always shows.
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
  // Pad to the full previous month → full next month.
  const shiftMonth = (iso, delta) => {
    const [y, m] = iso.split('-').map(Number);
    return isoOf(new Date(y, m - 1 + delta, 1));
  };
  const firstOfMonth = (iso) => {
    const [y, m] = iso.split('-').map(Number);
    return isoOf(new Date(y, m - 1, 1));
  };
  const lastOfMonth = (iso) => {
    const [y, m] = iso.split('-').map(Number);
    return isoOf(new Date(y, m, 0));
  };
  start = firstOfMonth(shiftMonth(start, -1));
  end = lastOfMonth(shiftMonth(end, 1));
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

// Bout popover lines: title / 'C commits · R revs' / range. The scope line
// ('2/4 phases · 4/4 tasks') is NOT text — it renders structurally right
// under the title with done-counts accented (data-ph/data-tk). Due is NOT a
// text line either — underlined deadline link, or muted done date, never n/a.
// boutPopText stays the one-line form for the summary sumline.
export function boutPopLines(sum) {
  if (!sum) return '';
  const lines = [sum.title];
  lines.push(`${sum.commits} commit${sum.commits === 1 ? '' : 's'} · ${sum.revs} rev${sum.revs === 1 ? '' : 's'}`);
  if (sum.range) lines.push(sum.range);
  return lines.join('\n');
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
  const syncTl = (open) => {
    if (!panel) return;
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    panel.toggleAttribute('inert', !open);
  };
  if (!panel) return;
  if (st.view !== 'timeline') { syncTl(false); if (pop) pop.hidden = true; return; }
  // Owner call: a plan opened from the timeline shows the one familiar plan
  // panel, never two panels at once — the timeline hides underneath and its
  // close (✕/scrim/Esc, same drawer path) lands back on the timeline.
  if (st.open && st.returnView === 'timeline') { syncTl(false); if (pop) pop.hidden = true; return; }
  syncTl(true);
  const todayRaw = (st.tlDate && /^\d{4}-\d{2}-\d{2}$/.test(st.tlDate)) ? st.tlDate : todayISO();
  const today = todayRaw;
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
    const label = isMonth ? monName(d) : dayNum(d);
    ticks += `<span class="ds-tl-tick${isMonth ? ' is-month' : ''}" style="left:calc(var(--cl-tl-day) * ${off})">${esc(label)}</span>`;
  }
  // Lane highlight lives on the ROW (has-track wash, full lane width) — never
  // on month bands: any month-boundary shade change reads as a gap, so no
  // band elements are emitted at all. Months differ only by the `Oct` tick.
  const laneW = `width:calc(var(--cl-tl-day) * ${grid.days})`;
  const realNow = new Date();
  const realTodayMid = pISO(todayISO());
  const timeFrac = Math.max(0, Math.min(0.9999, (realNow - realTodayMid) / DAY));
  const effectiveNowMs = (st.tlDate && /^\d{4}-\d{2}-\d{2}$/.test(st.tlDate))
    ? pISO(st.tlDate).getTime() + timeFrac * DAY
    : Date.now();
  const todayFracOff = (effectiveNowMs - pISO(grid.start).getTime()) / DAY;
  const todayOff = Math.floor(todayFracOff);
  const nowDate = new Date(effectiveNowMs);
  const nowTip = `Now \u00b7 ${fmtDate(today)} \u00b7 ${String(nowDate.getHours()).padStart(2,'0')}:${String(nowDate.getMinutes()).padStart(2,'0')}`;
  const todayLine = (todayOff >= 0 && todayOff < grid.days)
    ? `<span class="ds-tl-todaycol" style="left:calc(var(--cl-tl-day) * ${todayOff})"></span><span class="ds-tl-today" data-tip="${esc(nowTip)}" aria-label="${esc(nowTip)}" style="left:calc(var(--cl-tl-day) * ${todayFracOff.toFixed(4)})"></span>` : '';
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
      // Done coverage: the muted-accent share of the bar = phases done among
      // the phases this bout touches (data-ph carries the same ratio) — a
      // 3/5 bout covers 60% of its width from the left.
      const cov = bs && bs.phases > 0 ? Math.round((bs.phasesDone / bs.phases) * 100) : 0;
      return `<button class="${cls} lv${lv}" style="${barGeom(grid.start, b.start, b.end)};--tl-done:${cov}%"` +
        ` data-tl-bout="${esc(r.plan.file)}:${i}" data-tip="${esc(r.tip)}"` +
        ` data-pop="${esc(boutPopLines(bs))}"${bs && bs.complete ? ' data-popdone="1"' : ''}${cur}` +
        ` data-due="${bs && bs.due ? bs.due : ''}" data-duetxt="${bs && bs.due ? esc(fmtDate(bs.due)) : ''}"` +
        ` data-donetxt="${bs && bs.done ? esc(fmtDate(bs.done)) : ''}"` +
        ` data-ph="${bs ? `${bs.phasesDone}/${bs.phases}` : ''}" data-tk="${bs && bs.status ? bs.status : ''}"` +
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
    // Off-screen carets: sticky edge buttons, revealed by syncTlEdges when the
    // row's tracks sit outside the visible scroll window. Click scrolls them in.
    return `<div class="ds-tl-row${r.dates.length ? ' has-track' : ''}" data-tl-row="${esc(r.plan.file)}" style="${laneW}">` +
      `<div class="ds-tl-lane" style="${laneW}">` +
      `<button class="ds-tl-edge is-l" data-tl-edge="l" aria-label="Scroll track into view" hidden>«</button>` +
      `${bars}${g}${todayLine}${laneOpen}` +
      `<button class="ds-tl-edge is-r" data-tl-edge="r" aria-label="Scroll track into view" hidden>»</button>` +
      `</div></div>`;
  }).join('') : `<p class="ds-tl-empty">Nothing matches the current filters yet.</p>`;
  const rangeTxt = rows.length ? `${fmtDate(grid.start)} → ${fmtDate(grid.end)}` : '';
  panel.innerHTML = [
    `<div class="ds-tl-head"><b>Timeline</b><small>${esc(rangeTxt)}</small>`,
    `<button data-tl-close aria-label="Close timeline">✕</button></div>`,
    `<div class="ds-tl-scroll"><div class="ds-tl-axis">` +
    `<span class="ds-tl-curmonth" data-tl-curmonth hidden></span>` +
    `<div class="ds-tl-ticks" style="${laneW}">${ticks}</div></div>${body}</div>`,
  ].join('');
  // Keep today in view on open: with prev/next-month padding the lane is
  // wider than the drawer, so nudge the scroll only when today is off-screen
  // (never yanks an already-visible position on repaint). Deferred to rAF so
  // layout (lane width) is settled in every engine before measuring.
  try {
    const sc = panel.querySelector('.ds-tl-scroll');
    if (sc) {
      sc.onscroll = () => { try { syncTlEdges(panel); } catch {} };
      syncTlEdges(panel);
    }
    requestAnimationFrame(() => {
      try {
        const sc = panel.querySelector('.ds-tl-scroll');
        const lane = panel.querySelector('.ds-tl-lane');
        if (!sc || !lane || todayFracOff < 0 || todayFracOff >= grid.days) return;
        const dayPx = lane.getBoundingClientRect().width / grid.days;
        if (!dayPx) return;
        const x = todayFracOff * dayPx;
        if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth) {
          sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.3);
        }
        syncTlEdges(panel);
      } catch { /* scroll hint only */ }
    });
  } catch { /* scroll hint only */ }
  if (pop) pop.hidden = true;
}

// Re-exported for events: ghost owning-section lookup shares this rule.
export { ghostSection };
