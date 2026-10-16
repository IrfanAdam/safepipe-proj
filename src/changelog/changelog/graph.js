// safepipe changelog — activity graph · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
import { commits } from '../changelog-links.js';
import { MONTHS, fmtDate, pDay, isoDay, dueOf } from '../changelog-parse.js';
// Timeline entry glyph: Gantt mark (axis + 3 bars) on the 24 box —
// stroke 2, round caps, currentColor. Inlined into the grid tile below and
// re-applied by pages-changelog doPaint (which rewrites the tile label).
export const TIMELINE_TILE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 4v16M10 7h9M10 12h6M10 17h9"/></svg>`;
export function graph({ plans, day }) {
  const dc = {};
  commits.forEach((c) => { if (c.date) dc[c.date] = (dc[c.date] || 0) + 1; });
  // Scheduling (task 3): future Due dates across incomplete sections gain a
  // ghost-dot marker — is-future reused plus an is-due marker class, no new
  // colors (styling lands in the page stylesheet, out of this lane).
  const dueCounts = new Map();
  (plans || []).forEach((p) => {
    (p.sprints || []).forEach((s) => {
      try { const d = dueOf({ head: s.head, body: s.body }); if (d) dueCounts.set(d, (dueCounts.get(d) || 0) + 1); } catch {}
    });
  });
  const dues = new Set(dueCounts.keys());
  const keys = Object.keys(dc).sort();
  const bounds = keys.concat(plans.map((p) => p.date).filter(Boolean), [...dues]).sort();
  if (!bounds.length) return '';
  const max = Math.max(...Object.values(dc), 1);
  const pad = 6 * 7 * 864e5;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = pDay(bounds[0]), last = pDay(bounds[bounds.length - 1]);
  const start = new Date(first.getTime() - pad); start.setDate(start.getDate() - start.getDay());
  const base = last > today ? last : today;
  const end = new Date(base.getTime() + pad); end.setDate(end.getDate() + (6 - end.getDay()));
  const weeks = [], ws = new Date(start);
  while (ws <= end) {
    const col = [];
    for (let i = 0; i < 7; i++) { const d = new Date(ws); d.setDate(d.getDate() + i); col.push(d); }
    weeks.push(col); ws.setDate(ws.getDate() + 7);
  }
  const DOWS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  const spans = []; let lead = 0;
  weeks.forEach((col) => {
    const f = col.find((d) => d.getDate() === 1);
    if (f) { spans.push({ mo: f.getMonth(), n: lead + 1 }); lead = 0; }
    else if (spans.length) spans[spans.length - 1].n++; else lead++;
  });
  const labels = spans.map((s) => [
    `<span class="ds-month" style="width: calc(`,
    s.n,
    ` * (var(--cl-16) + var(--cl-4)) - var(--cl-4))">`,
    MONTHS[s.mo],
    `</span>`,
  ].join('')).join('');
  const cols = weeks.map((col) => {
    const cells = col.map((d) => {
      const k = isoDay(d),
        todayCls = k === isoDay(today) ? ' is-today' : '';
      if (d > today) {
        if (dues.has(k)) return `<span class="ds-day is-future is-due" data-due-day="${k}" data-tip="${dueCounts.get(k)} Due · ${fmtDate(k)}"></span>`;
        return `<span class="ds-day is-future" data-tip="${fmtDate(k)}"></span>`;
      }
      const n = dc[k] || 0;
      if (!n) return `<span class="ds-day${todayCls}" data-tip="${fmtDate(k)} · no changes"></span>`;
      const lv = Math.min(4, Math.ceil(4 * Math.sqrt(n / max)));
      return [
        `<button class="ds-day lv`,
        lv,
        day === k ? ' on' : '',
        todayCls,
        `"`,
        ` data-day="`,
        k,
        `" data-tip="`,
        n,
        ` change`,
        n > 1 ? 's' : '',
        ` · `,
        fmtDate(k),
        `" aria-pressed="`,
        day === k,
        `" aria-label="`,
        n,
        ` changes on `,
        fmtDate(k),
        ` — filter list"></button>`,
      ].join('');
    }).join('');
    return `<div class="ds-week">${cells}</div>`;
  }).join('');
  const dows = `<div class="ds-dows" aria-hidden="true">${DOWS.map((d) => `<span>${d}</span>`).join('')}</div>`;
  // Owner call (2026-10-16): the timeline entry is a large 7×7-cell tile
  // inside the days grid itself (not out of it) — planted after the last
  // week and pulled to the right edge of the graph. It rests on the page
  // background, lights to the surface on hover, and never wears accent
  // (selected stays light too). Its label + pressed state sync every paint
  // from doPaint via [data-view=timeline], so the text wraps and centers
  // on its own.
  const tile = `<button class="ds-timeline-gridtile" data-view="timeline" aria-pressed="false" aria-label="Open timeline view">${TIMELINE_TILE_ICON}<span class="ds-timeline-gridtile__text">Timeline</span></button>`;
  return [
    `<div class="ds-graph-labels">`,
    labels,
    `</div><div class="ds-graph-row" role="group" aria-label="Changes by day">`,
    dows,
    cols,
    tile,
    `</div>`,
  ].join('');
}
