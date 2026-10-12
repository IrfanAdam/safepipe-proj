// safepipe changelog — per-plan revision list · [plan:2026-10-07_130000-safepipe-changelog.md#task-11]
import { fmtDate, fmtTime, isDone } from '../changelog-parse.js';
import { esc } from './esc.js';
// Current plan sources (same raw glob as the pages composer): feedback
// bullets are quoted verbatim from the live plan text — never invented.
// A quoted line appears only for a section whose hash really changed
// (added/edited vs the previous rev); everything else keeps Task-10 lines.
const raws = import.meta.glob('../../../.hermes/plans/*.md', { query: '?raw', import: 'default', eager: true });
// revs: history[file] oldest-first [{date, time?, sections:[{head, hash, state}]}].
// Flat newest-first semantic feedback: each entry leads with its date (+ local
// HH:MM when stamped; date-only for old revs) and one plain-language line per
// changed section — task-count transitions, done markings, renames, edits,
// additions, removals — derived only from real hash/state diffs vs the previous
// rev's same-head entries. Feedback-type sections (feedback/review/pass
// language) instead quote their recorded bullets verbatim (Task 11).
// No status marks, no unchanged counts. Body lines are
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
  .replace(/\s*\b(done|cancelled)\b(\s*\([^)]*\))?(?=\s*—|\s*$)/gi, '')
  .replace(/\s+/g, ' ')
  .trim();
const wasDone = (head, st) => /✓/.test(String(head || '')) || isDone(st);
// Task 11: feedback-type heads (review critique, not counters). A changed
// feedback section renders its recorded bullets — quoted verbatim, values
// kept — instead of a Task-10 transition line.
const FB_HEAD = /feedback|review|\bpass\b|retro|critique|rework/i;
const isFb = (h) => FB_HEAD.test(clean(h));
const toks = (s) => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 1);
const overlap = (a, b) => {
  const bs = new Set(toks(b));
  let n = 0;
  for (const t of new Set(toks(a))) if (bs.has(t)) n++;
  return n;
};
// Feedback blocks per plan file: a ##/###/#### head with feedback language
// owns the `- ` bullets under it (up to the next heading). Built once.
const fbBlocksOf = (md) => {
  const blocks = [];
  let curBlk = null;
  for (const ln of String(md || '').split('\n')) {
    const hm = ln.match(/^#{2,4}\s+(.+)$/);
    if (hm) {
      if (curBlk) blocks.push(curBlk);
      curBlk = FB_HEAD.test(clean(hm[1])) ? { head: hm[1], bullets: [] } : null;
      continue;
    }
    if (curBlk) {
      const bm = ln.match(/^\s*-\s+(.*)$/);
      if (bm) {
        let b = bm[1]
          .replace(/^\[[ xX]\]\s*/, '')
          .replace(/\*\*/g, '').replace(/`/g, '')
          .replace(/<!--[\s\S]*?-->/g, ' ').replace(/\{#[^}]*\}/g, ' ')
          .replace(/\s+/g, ' ').trim();
        if (b && !/^\|/.test(b) && b.length > 1) {
          if (b.length > 320) b = b.slice(0, 317).replace(/\s+\S*$/, '') + '…';
          curBlk.bullets.push(b);
        }
      }
    }
  }
  if (curBlk) blocks.push(curBlk);
  return blocks;
};
const planFiles = Object.entries(raws).map(([p, md]) => {
  const heads = new Set();
  for (const ln of String(md).split('\n')) {
    const m = ln.match(/^#{2,4}\s+(.+)$/);
    if (m) heads.add(clean(m[1]));
  }
  return { file: p.split('/').pop(), heads, fb: fbBlocksOf(md) };
});
// Which plan do these revs belong to? Most cleaned-head hits wins.
const fileFor = (revs) => {
  const want = new Set();
  for (const r of revs || []) for (const s of r.sections || []) want.add(clean(s.head));
  let best = null, bestN = 0;
  for (const f of planFiles) {
    let n = 0;
    for (const h of f.heads) if (want.has(h)) n++;
    if (n > bestN) { bestN = n; best = f; }
  }
  return bestN ? best : null;
};
// Best feedback block for a history head: exact cleaned-head match, else
// token overlap ≥ 2 (covers ## → ### restructures, e.g. "Phase 1 iteration
// — feedback pass" vs "Feedback pass — Phase 1 iteration").
const blockFor = (f, head) => {
  if (!f) return null;
  const c = clean(head);
  let best = null, bestN = 0;
  for (const b of f.fb) {
    const bc = clean(b.head);
    const n = bc === c ? 100 : overlap(bc, c);
    if (n > bestN) { bestN = n; best = b; }
  }
  return bestN >= 2 && best && best.bullets.length ? best : null;
};
const MAXFB = 10;
const fbLines = (f, head) => {
  const b = blockFor(f, head);
  if (!b) return null;
  const items = b.bullets.slice(0, MAXFB)
    .map((t) => `<li class="ds-rev-sec" data-fb="1">${esc(t)}</li>`);
  if (b.bullets.length > MAXFB)
    items.push(`<li class="ds-rev-sec" data-fb="1">… ${b.bullets.length - MAXFB} more in the plan</li>`);
  return `<li class="ds-rev-sec" data-fb="1">${esc(clean(head))}</li>` + items.join('');
};
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
  const src = fileFor(revs);
  const fb = (head) => (isFb(head) ? fbLines(src, head) : null);
  const rows = [];
  for (let i = revs.length - 1; i >= 0; i--) {
    const r = revs[i], prev = i ? revs[i - 1] : null;
    const when = esc(r.time ? `${fmtDate(r.date || '')} · ${fmtTime(r.time)}` : fmtDate(r.date || ''));
    let lines = '';
    if (!prev) {
      lines = (r.sections || []).map((s) =>
        fb(s.head) ||
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
        const rfb = fb(added[0].head);
        if (rfb) parts.push(rfb);
      } else {
        for (const s of removed) parts.push(`<li class="ds-rev-sec">Removed ${esc(clean(s.head))}</li>`);
        for (const s of added) parts.push(fb(s.head) || `<li class="ds-rev-sec">Added ${esc(clean(s.head))}${s.state ? ` — ${esc(s.state)} tasks` : ''}</li>`);
      }
      const renamed = removed.length === 1 && added.length === 1;
      const skip = renamed ? added[0].head : null;
      for (const s of cur) {
        if (s.head === skip || ph[s.head] === undefined || ph[s.head] === s.hash) continue;
        parts.push(fb(s.head) || `<li class="ds-rev-sec">${lineFor(s.head, ps[s.head], s.state, phead[s.head])}</li>`);
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
