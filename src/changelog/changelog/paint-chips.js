// safepipe changelog — chips + graph · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
import { fmtDate, dueOf } from '../changelog-parse.js';
import { graph, TIMELINE_TILE_ICON } from './graph.js';
const INLINE_TAGS = 5;
export function paintChips(root, ctx){
  const { list, pi, plan, sprints, si, active, day, sel, open, counts, plans, texts } = ctx;
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
  const filterCount = active.size ? `${active.size} on` : `${counts.length}`;
  const filterLabel = `Open filters, ${counts.length} tags${active.size ? `, ${active.size} active` : ''}`;
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
  const hasFilters = active.size > 0 || day;
  // Text-like clear: last in the stack, pushed to the right end via CSS.
  const clearBtn = hasFilters ? [
    `<button class="ds-chip-clear" data-tag-clear aria-label="Clear all filters">`,
    `Clear all</button>`,
  ].join('') : '';
  const tlBtn = [
    `<button class="ds-chip ds-chip-timeline" data-view="timeline" aria-pressed="false" aria-label="Open timeline view">`,
    `<span class="ds-chip-timeline__icon" aria-hidden="true">${TIMELINE_TILE_ICON}</span> All ${plans.length} track${plans.length === 1 ? '' : 's'}`,
    `</button>`,
  ].join('');
  root.querySelector('[data-col="chips"]').innerHTML = filterBtn + tagPills + dayChip + tlBtn + clearBtn;
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
