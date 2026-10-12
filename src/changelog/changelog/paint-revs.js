// safepipe changelog — per-plan revision list · [plan:2026-10-07_130000-safepipe-changelog.md#task-8]
import { fmtDate } from '../changelog-parse.js';
import { esc } from './esc.js';
// revs: history[file] oldest-first [{date, sections:[{head, hash, state}]}].
// Row rN + date, expands (native <details>) to section heads + states.
// Changed mark when a section hash differs from the previous rev's same-head
// hash; new-head rows get a new mark (same rule family as rail · edited).
export function paintRevs(revs){
  if (!revs || !revs.length) return '';
  const rows = revs.map((r, i) => {
    const prev = i ? revs[i - 1] : null;
    const ph = {};
    if (prev) for (const s of prev.sections || []) ph[s.head] = s.hash;
    const secs = (r.sections || []).map((s) => {
      const added = !!prev && ph[s.head] === undefined;
      const changed = !!prev && !added && ph[s.head] !== s.hash;
      const mark = added ? ' · new' : changed ? ' · changed' : '';
      return [
        `<tr`,
        added || changed ? ` data-changed="1"` : '',
        `><td class="ds-revs-head">`,
        added ? `<span class="ds-revs-new">new · </span>` : '',
        esc(s.head),
        `</td><td class="ds-revs-state">`,
        esc(s.state || '–'),
        mark ? `<span class="ds-revs-mark">${mark}</span>` : '',
        `</td></tr>`,
      ].join('');
    }).join('');
    return [
      `<details class="ds-rev${i === revs.length - 1 ? ' cur' : ''}"`,
      i === revs.length - 1 ? ' open' : '',
      ` data-rev="${i + 1}" data-rev-date="${esc(r.date || '')}">`,
      `<summary><span class="ds-rev-n">r${i + 1}</span>`,
      `<span class="ds-rev-date">${esc(fmtDate(r.date || ''))}</span>`,
      `<span class="ds-rev-sum">${(r.sections || []).length} sections</span></summary>`,
      `<table>${secs}</table></details>`,
    ].join('');
  }).join('');
  return [
    `<hr class="ds-hr"><div class="ds-revs" data-revs="${revs.length}">`,
    `<div class="ds-revs-title">Revisions · ${revs.length}</div>`,
    rows,
    `</div>`,
  ].join('');
}
