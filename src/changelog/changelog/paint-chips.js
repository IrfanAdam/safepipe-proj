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
  const statuses = [['done', 'Done'], ['incomplete', 'Incomplete'], ['cancelled', 'Cancelled']];
  const statusCounts = {};
  try { (plans || []).forEach((p) => { const s = planStatus(p); statusCounts[s] = (statusCounts[s] || 0) + 1; }); } catch {}
  const filterTab = ctx.filterTab === 'status' ? 'status' : 'tags';
  const filterBtn = counts.length || statuses.length ? [
    `<button class="ds-chip ds-chip-filter" data-filter-toggle data-tag-filter aria-haspopup="dialog" aria-expanded="false" aria-label="${filterLabel}">`,
    `<svg class="ds-chip-filter__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h12L9.5 8.2V12l-3 1.5V8.2L2 3z"/></svg> ${filterCount}`,
    `</button>`,
    `<div class="ds-tag-dropdown ds-filter-drawer" data-filter-drawer data-tag-dropdown hidden role="dialog" aria-label="Filters">`,
    `<div class="ds-filter-tabs" role="tablist" aria-label="Filter categories">`,
    `<button role="tab" class="ds-filter-tab${filterTab === 'tags' ? ' is-active' : ''}" data-filter-tab="tags" aria-selected="${filterTab === 'tags'}" ${filterTab === 'tags' ? 'aria-current="true"' : ''}>Tags${active.size ? ` · ${active.size}` : ''}</button>`,
    `<button role="tab" class="ds-filter-tab${filterTab === 'status' ? ' is-active' : ''}" data-filter-tab="status" aria-selected="${filterTab === 'status'}" ${filterTab === 'status' ? 'aria-current="true"' : ''}>Status${statusFilter ? ` · 1` : ''}</button>`,
    `</div>`,
    `<div class="ds-filter-panels">`,
    `<div data-filter-panel="tags" ${filterTab !== 'tags' ? 'hidden' : ''}>`,
    counts.map(([t, n]) => [
      `<label class="ds-tag-option">`,
      `<input type="checkbox" data-tag-opt="${t}" ${active.has(t) ? 'checked' : ''}>`,
      `${t} (${n})`,
      `</label>`,
    ].join('')).join(''),
    `</div>`,
    `<div data-filter-panel="status" ${filterTab !== 'status' ? 'hidden' : ''}>`,
    statuses.map(([v, label]) => [
      `<label class="ds-tag-option">`,
      `<input type="radio" name="ds-status" data-status-opt="${v}" ${statusFilter === v ? 'checked' : ''}>`,
      `${label} (${statusCounts[v] || 0})`,
      `</label>`,
    ].join('')).join(''),
    `</div>`,
    `</div>`,
    `</div>`,
  ].join('') : '';
  const hasFilters = active.size > 0 || statusFilter || day;
  const clearBtn = hasFilters ? [
    `<button class="ds-chip-clear" data-tag-clear aria-label="Clear filters">`,
    `Clear</button>`,
  ].join('') : '';
  const tlBtn = [
    `<button class="ds-chip ds-chip-timeline" data-view="timeline" aria-pressed="false" aria-label="Open timeline view">`,
    `<span class="ds-chip-timeline__icon" aria-hidden="true">${TIMELINE_TILE_ICON}</span> All ${plans.length} track${plans.length === 1 ? '' : 's'}`,
    `</button>`,
  ].join('');
  root.querySelector('[data-col="chips"]').innerHTML = filterBtn + tagPills + dayChip + clearBtn + tlBtn;
  const gEl = root.querySelector('[data-col="graph"]');
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
