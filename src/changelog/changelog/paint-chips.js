// safepipe changelog — chips + graph · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
import { fmtDate, dueOf } from '../changelog-parse.js';
import { planStatus } from './raw-detail.js';
import { graph, TIMELINE_TILE_ICON } from './graph.js';
const INLINE_TAGS = 3;
export function paintChips(root, ctx){
  const { list, pi, plan, sprints, si, active, day, sel, open, counts, plans, texts, statusFilter } = ctx;
  const visibleTags = counts.slice(0, INLINE_TAGS);
  const dayChip = day ? [
    `<button class="ds-chip on" data-day-clear aria-label="Clear day filter">`,
    fmtDate(day),
    ` ✕</button>`,
  ].join('') : '';
  const tagPills = visibleTags.map(([t, n]) => [
    `<button class="ds-chip`,
    active.has(t) ? ' on' : '',
    `" data-tag="`,
    t,
    `" aria-pressed="`,
    active.has(t),
    `">`,
    t,
    ` (`,
    n,
    `)</button>`,
  ].join('')).join('');
  const onCount = active.size + (statusFilter ? 1 : 0);
  const filterCount = onCount ? `<span class="ds-chip-filter__n">${onCount}</span>` : `${counts.length}`;
  const filterLabel = `Open filters, ${counts.length} tags${onCount ? `, ${onCount} active` : ''}`;
  const filterBtn = counts.length ? [
    `<button class="ds-chip ds-chip-filter" data-tag-filter aria-haspopup="true" aria-expanded="false" aria-label="${filterLabel}">`,
    `<svg class="ds-chip-filter__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h12L9.5 8.2V12l-3 1.5V8.2L2 3z"/></svg> ${filterCount}`,
    `</button>`,
    `<div class="ds-tag-dropdown" data-tag-dropdown hidden role="menu" aria-label="All filters">`,
    counts.map(([t, n]) => [
      `<label class="ds-tag-option">`,
      `<input type="checkbox" data-tag-opt="${t}" ${active.has(t) ? 'checked' : ''}>`,
      `${t} (${n})`,
      `</label>`,
    ].join('')).join(''),
    `</div>`,
  ].join('') : ''; // [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]
  // Status radio sits right after the filter button: Done / Incomplete /
  // Cancelled share the planStatus rule, so the radio and the cards agree.
  // Reuses the tag-dropdown class so the mobile bottom-sheet applies as-is.
  const statuses = [['done', 'Done'], ['incomplete', 'Incomplete'], ['cancelled', 'Cancelled']];
  const statusCounts = {};
  try { (plans || []).forEach((p) => { const s = planStatus(p); statusCounts[s] = (statusCounts[s] || 0) + 1; }); } catch {}
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : '';
  const statusBtn = [
    `<button class="ds-chip ds-chip-status${statusFilter ? ' on' : ''}" data-status-filter aria-haspopup="true" aria-expanded="false" aria-label="Filter by status${statusFilter ? `, ${statusFilter} selected` : ''}">`,
    statusFilter ? `Status · ${cap(statusFilter)}` : `Status`,
    `</button>`,
    `<div class="ds-tag-dropdown" data-status-dropdown hidden role="menu" aria-label="Status filter">`,
    statuses.map(([v, label]) => [
      `<label class="ds-tag-option">`,
      `<input type="radio" name="ds-status" data-status-opt="${v}" ${statusFilter === v ? 'checked' : ''}>`,
      `${label} (${statusCounts[v] || 0})`,
      `</label>`,
    ].join('')).join(''),
    `</div>`,
  ].join('');
  const hasFilters = active.size > 0 || statusFilter || day;
  // Text-like clear: inline in the flow before the timeline button.
  const clearBtn = hasFilters ? [
    `<button class="ds-chip-clear" data-tag-clear aria-label="Clear all filters">`,
    `Clear all</button>`,
  ].join('') : '';
  const tlBtn = [
    `<button class="ds-chip ds-chip-timeline" data-view="timeline" aria-pressed="false" aria-label="Open timeline view">`,
    `<span class="ds-chip-timeline__icon" aria-hidden="true">${TIMELINE_TILE_ICON}</span> All ${plans.length} track${plans.length === 1 ? '' : 's'}`,
    `</button>`,
  ].join('');
  root.querySelector('[data-col="chips"]').innerHTML = filterBtn + statusBtn + tagPills + dayChip + clearBtn + tlBtn;
  const gEl = root.querySelector('[data-col="graph"]');
  // Scheduling (timeline Task 3): the graph paints once for perf, but live
  // Due edits must reflect as ghost dots with no reload — repaint only when
  // the due signature changes, else keep the cached grid and retoggle days.
  let duesKey = '';
  try {
    const ds = [];
    (plans || []).forEach((p) => (p.sprints || []).forEach((s) => {
      const d = dueOf({ head: s.head, body: s.body }); if (d) ds.push(d);
    }));
    duesKey = ds.sort().join(',');
  } catch {}
  if (!gEl.dataset.ready || gEl.dataset.dues !== duesKey) {
    gEl.innerHTML = graph({ plans, day }); gEl.dataset.ready = '1'; gEl.dataset.dues = duesKey;
  }
  else { gEl.querySelectorAll('[data-day]').forEach((el) => { const k = el.dataset.day,
        on = k === day; el.classList.toggle('on',
          on); if (el.getAttribute('aria-pressed') !== String(on)) el.setAttribute('aria-pressed',
          String(on)); }); }
}
