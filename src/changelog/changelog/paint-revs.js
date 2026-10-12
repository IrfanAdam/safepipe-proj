// safepipe changelog — per-plan revision list · [plan:2026-10-07_130000-safepipe-changelog.md#task-8]
import { fmtDate } from '../changelog-parse.js';
import { esc } from './esc.js';
// revs: history[file] oldest-first [{date, sections:[{head, hash, state}]}].
// Flat dated feedback, newest-first (Task 9 redirect): each entry leads with
// its date + what changed — changed sections as old→new state transitions
// vs the previous rev's same-head state, added heads with a new mark;
// unchanged sections collapse to a quiet count line. No nested scroll box —
// the list flows inside the drawer's own scroll. No rN-led rows.
// Changed rule mirrors rail · edited (section hash differs from previous
// rev's same-head hash; unseen head = new).
export function paintRevs(revs){
  if (!revs || !revs.length) return '';
  const rows = [];
  for (let i = revs.length - 1; i >= 0; i--) {
    const r = revs[i], prev = i ? revs[i - 1] : null;
    const ph = {}, ps = {};
    if (prev) for (const s of prev.sections || []) { ph[s.head] = s.hash; ps[s.head] = s.state; }
    let changedN = 0, sameN = 0;
    const lines = (r.sections || []).map((s) => {
      if (!prev) {
        return `<li class="ds-rev-sec"><span class="ds-revs-head">${esc(s.head)}</span> <span class="ds-revs-state">${esc(s.state || '–')}</span></li>`;
      }
      const added = ph[s.head] === undefined;
      const changed = !added && ph[s.head] !== s.hash;
      if (!added && !changed) { sameN++; return ''; }
      changedN++;
      const oldSt = added ? '' : (ps[s.head] || '–'), newSt = s.state || '–';
      const trans = added || oldSt === newSt
        ? esc(newSt)
        : `${esc(oldSt)} → ${esc(newSt)}`;
      const mark = added ? ' · new' : ' · changed';
      return [
        `<li class="ds-rev-sec" data-changed="1">`,
        `<span class="ds-revs-head">${added ? `<span class="ds-revs-new">new · </span>` : ''}${esc(s.head)}</span> `,
        `<span class="ds-revs-state">${trans}<span class="ds-revs-mark">${mark}</span></span></li>`,
      ].join('');
    }).join('');
    const sum = prev ? (changedN ? `${changedN} changed` : `no changes`) : `${(r.sections || []).length} sections`;
    rows.push([
      `<div class="ds-rev" data-rev="${i + 1}" data-rev-date="${esc(r.date || '')}">`,
      `<div class="ds-rev-row"><span class="ds-rev-date">${esc(fmtDate(r.date || ''))}</span>`,
      `<span class="ds-rev-sum">${sum}</span></div>`,
      `<ul class="ds-rev-secs">${lines}`,
      prev && sameN ? `<li class="ds-rev-same">${sameN} unchanged</li>` : '',
      `</ul></div>`,
    ].join(''));
  }
  return [
    `<hr class="ds-hr"><div class="ds-revs" data-revs="${revs.length}">`,
    `<div class="ds-revs-title">Revisions · ${revs.length}</div>`,
    rows.join(''),
    `</div>`,
  ].join('');
}
