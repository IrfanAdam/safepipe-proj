// safepipe changelog — per-plan revision list · [plan:2026-10-07_130000-safepipe-changelog.md#task-10]
import { fmtDate, fmtTime, isDone } from '../changelog-parse.js';
import { esc } from './esc.js';
// revs: history[file] oldest-first [{date, time?, sections:[{head, hash, state}]}].
// Flat newest-first semantic feedback: each entry leads with its date (+ local
// HH:MM when stamped; date-only for old revs) and one plain-language line per
// changed section — task-count transitions, done markings, renames, edits,
// additions, removals — derived only from real hash/state diffs vs the previous
// rev's same-head entries. No status marks, no unchanged counts. Body lines are
// flush-left, sharing the date line's indent.
// Changed rule mirrors rail · edited (section hash differs from previous
// rev's same-head hash; unseen head = added; vanished head = removed).
const frac = (s) => {
  const m = String(s || '').match(/(\d+)\/(\d+)/);
  return m ? [+m[1], +m[2]] : null;
};
// Display head: drop anchor tails + done/cancelled glyphs (they become words).
const clean = (h) => String(h || '')
  .replace(/\s*\{#[^}]*\}\s*$/, '')
  .replace(/[✓✗]/g, '')
  .replace(/\s*\b(done|cancelled)\b(?=\s*—|\s*$)/gi, '')
  .replace(/\s+/g, ' ')
  .trim();
const wasDone = (head, st) => /✓/.test(String(head || '')) || isDone(st);
const lineFor = (head, oldSt, newSt, oldHead) => {
  const name = esc(clean(head));
  const of = frac(oldSt), nf = frac(newSt);
  const doneNow = wasDone(head, newSt) && !wasDone(oldHead ?? head, oldSt);
  if (of && nf && (of[0] !== nf[0] || of[1] !== nf[1]))
    return `${name} — tasks ${esc(oldSt)} → ${esc(newSt)}${doneNow ? ', marked done' : ''}`;
  if (doneNow) return `${name} — marked done`;
  if (!oldSt && newSt) return `${name} — now tracking ${esc(newSt)} tasks`;
  if (oldSt && !newSt) return `${name} — tasks cleared (was ${esc(oldSt)})`;
  if (oldSt !== newSt) return `${name} — ${esc(oldSt || '–')} → ${esc(newSt || '–')}`;
  return `Edited ${name}`;
};
export function paintRevs(revs){
  if (!revs || !revs.length) return '';
  const rows = [];
  for (let i = revs.length - 1; i >= 0; i--) {
    const r = revs[i], prev = i ? revs[i - 1] : null;
    const when = esc(r.time ? `${fmtDate(r.date || '')} · ${fmtTime(r.time)}` : fmtDate(r.date || ''));
    let lines = '';
    if (!prev) {
      lines = (r.sections || []).map((s) =>
        `<li class="ds-rev-sec">${esc(clean(s.head))}${s.state ? ` — tasks ${esc(s.state)}` : ''}</li>`,
      ).join('');
    } else {
      const ph = {}, ps = {}, phead = {};
      for (const s of prev.sections || []) { ph[s.head] = s.hash; ps[s.head] = s.state; phead[s.head] = s.head; }
      const cur = r.sections || [];
      const removed = (prev.sections || []).filter((s) => !cur.some((c) => c.head === s.head));
      const added = cur.filter((s) => ph[s.head] === undefined);
      const parts = [];
      // 1:1 swap reads as a rename (one head out, one head in, same step).
      if (removed.length === 1 && added.length === 1) {
        parts.push(`<li class="ds-rev-sec">Renamed ${esc(clean(removed[0].head))} → ${esc(clean(added[0].head))}</li>`);
      } else {
        for (const s of removed) parts.push(`<li class="ds-rev-sec">Removed ${esc(clean(s.head))}</li>`);
        for (const s of added) parts.push(`<li class="ds-rev-sec">Added ${esc(clean(s.head))}${s.state ? ` — ${esc(s.state)} tasks` : ''}</li>`);
      }
      const renamed = removed.length === 1 && added.length === 1;
      const skip = renamed ? added[0].head : null;
      for (const s of cur) {
        if (s.head === skip || ph[s.head] === undefined || ph[s.head] === s.hash) continue;
        parts.push(`<li class="ds-rev-sec">${lineFor(s.head, ps[s.head], s.state, phead[s.head])}</li>`);
      }
      lines = parts.join('') || `<li class="ds-rev-sec">Edited plan text outside tracked sections</li>`;
    }
    rows.push(
      `<div class="ds-rev" data-rev="${i + 1}" data-rev-date="${esc(r.date || '')}">` +
      `<div class="ds-rev-date">${when}</div>` +
      `<ul class="ds-rev-secs">${lines}</ul></div>`,
    );
  }
  return [
    `<hr class="ds-hr"><div class="ds-revs" data-revs="${revs.length}">`,
    `<div class="ds-revs-title">Revisions · ${revs.length}</div>`,
    rows.join(''),
    `</div>`,
  ].join('');
}
