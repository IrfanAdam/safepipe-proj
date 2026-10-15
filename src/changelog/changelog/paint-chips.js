// safepipe changelog — chips + graph · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
import { fmtDate, dueOf } from '../changelog-parse.js';
import { graph } from './graph.js';
export function paintChips(root, ctx){
  const { list, pi, plan, sprints, si, active, day, sel, open, counts, plans, texts } = ctx;
  const showAll = [
    `<button class="ds-chip`,
    (active.size || day) ? '' : ' on',
    `" data-tag="">All (`,
    plans.length,
    `)</button>`,
  ].join('');
  const dayChip = day ? [
    `<button class="ds-chip on" data-day-clear aria-label="Clear day filter">`,
    fmtDate(day),
    ` ✕</button>`,
  ].join('') : '';
  root.querySelector('[data-col="chips"]').innerHTML = dayChip + showAll + counts.map(([t, n]) => [
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
