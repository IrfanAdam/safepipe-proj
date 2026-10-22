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
  const DOWS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const spans = []; let lead = 0; let leadIn = 0;
  weeks.forEach((col) => {
    const f = col.find((d) => d.getDate() === 1);
    if (f) { if (!spans.length) leadIn = lead; spans.push({ mo: f.getMonth(), n: 1 }); lead = 0; }
    else if (spans.length) spans[spans.length - 1].n++; else lead++;
  });
  // Month labels: the weeks before the first month-start render as a text-less
  // spacer span of their own width, so the first label starts exactly at its
  // month's week — before, the lead-in was folded into the first span's width
  // and that label drew up to ~6 weeks left of the month it names.
  const mono = (mo, n) => [
    `<span class="ds-month" style="width: calc(`,
    n,
    ` * (var(--cl-16) + var(--cl-4)) - var(--cl-4))">`,
    mo == null ? '' : MONTHS[mo],
    `</span>`,
  ].join('');
  const labels = spans.length
    ? (leadIn ? mono(null, leadIn) : '') + spans.map((s) => mono(s.mo, s.n)).join('')
    : '';
  const cols = weeks.map((col) => {
    const cells = col.map((d) => {
      const k = isoDay(d),
        todayIso = isoDay(today),
        todayCls = k === todayIso ? ' is-today' : '';
      // Versatile: commits gradation (lv) + due outline coexist — due never hides commits.
      // Due that lands on today: tint (if commits exist) + accent outline + pulse.
      if (k === todayIso && dues.has(k)) {
        const nDue = dc[k] || 0;
        if (!nDue) {
          return `<button class="ds-day is-today is-due${day === k ? ' on' : ''}" data-day="${k}" data-due-day="${k}" data-tip="${dueCounts.get(k)} Due · ${fmtDate(k)}" aria-pressed="${day === k}" aria-label="${dueCounts.get(k)} due on ${fmtDate(k)}"></button>`;
        }
        const lvDue = Math.min(4, Math.ceil(4 * Math.sqrt(nDue / max)));
        return `<button class="ds-day lv${lvDue} is-today is-due${day === k ? ' on' : ''}" data-day="${k}" data-due-day="${k}" data-tip="${nDue} changes + ${dueCounts.get(k)} Due · ${fmtDate(k)}" aria-pressed="${day === k}" aria-label="${nDue} changes + ${dueCounts.get(k)} due on ${fmtDate(k)}"></button>`;
      }
      if (d > today) {
        if (dues.has(k)) return `<button class="ds-day is-future is-due${day === k ? ' on' : ''}" data-day="${k}" data-due-day="${k}" data-tip="${dueCounts.get(k)} Due · ${fmtDate(k)}" aria-pressed="${day === k}" aria-label="${dueCounts.get(k)} due on ${fmtDate(k)}"></button>`;
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
        `"></button>`,
      ].join('');
    }).join('');
    return `<div class="ds-week">${cells}</div>`;
  }).join('');
  const dows = `<div class="ds-dows" aria-hidden="true">${DOWS.map((d) => `<span>${d}</span>`).join('')}</div>`;
  return [
    `<div class="ds-graph-labels">`,
    labels,
    `</div><div class="ds-graph-row" role="group" aria-label="Changes by day">`,
    dows,
    cols,
    `</div>`,
  ].join('');
}
