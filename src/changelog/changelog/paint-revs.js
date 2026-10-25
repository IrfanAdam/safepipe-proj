// safepipe changelog — evals (unified verify + revision) · [plan:2026-10-07_130000-safepipe-changelog.md#task-11]
import { fmtDate, fmtTime, isDone, gateNOf } from '../changelog-parse.js';
import { esc } from './esc.js';
const raws = import.meta.glob('../../../.hermes/plans/*.md', { query: '?raw', import: 'default', eager: true });
const revAnchor = (head) => {
  const t = String(head || '');
  const m = t.match(/\{#([A-Za-z]+-\d+)\}/);
  if (m) return m[1].toLowerCase();
  const n = t.match(/^(Phase|Task|Step)\s+(\d+)/i);
  return n ? `${n[1].toLowerCase()}-${n[2]}` : null;
};
const frac = (s) => {
  const m = String(s || '').match(/(\d+)\/(\d+)/);
  return m ? [+m[1], +m[2]] : null;
};
const clean = (h) => String(h || '')
  .replace(/\s*\{#[^}]*\}\s*$/, '')
  .replace(/[✓✗]/g, '')
  .replace(/\s*\b(done|cancelled)\b(\s*\([^)]*\))?(?=\s*—|\s*$)/gi, '')
  .replace(/\s+/g, ' ')
  .trim();
const wasDone = (head, st) => /✓/.test(String(head || '')) || isDone(st);
const FB_HEAD = /feedback|review|\bpass\b|retro|critique|rework/i;
const isFb = (h) => FB_HEAD.test(clean(h));
const toks = (s) => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 1);
const overlap = (a, b) => {
  const bs = new Set(toks(b));
  let n = 0;
  for (const t of new Set(toks(a))) if (bs.has(t)) n++;
  return n;
};
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
        let b = bm[1].replace(/^\[[ xX]\]\s*/, '').replace(/\*\*/g, '').replace(/`/g, '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/\{#[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
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
  const items = b.bullets.slice(0, MAXFB).map((t) => esc(t));
  if (b.bullets.length > MAXFB) items.push(`… ${b.bullets.length - MAXFB} more in the plan`);
  return { title: esc(clean(head)), items };
};
const lineFor = (head, oldSt, newSt, oldHead) => {
  const name = esc(clean(head));
  const of = frac(oldSt), nf = frac(newSt);
  const doneNow = wasDone(head, newSt) && !wasDone(oldHead ?? head, oldSt);
  if (of && nf && (of[0] !== nf[0] || of[1] !== nf[1])) return `${name} — tasks ${esc(oldSt)} → ${esc(newSt)}${doneNow ? ', marked done' : ''}`;
  if (doneNow) return `${name} — marked done`;
  if (!oldSt && newSt) return `${name} — now tracking ${esc(newSt)} tasks`;
  if (oldSt && !newSt) return `${name} — tasks cleared (was ${esc(oldSt)})`;
  if (oldSt !== newSt) return `${name} — ${esc(oldSt || '–')} → ${esc(newSt || '–')}`;
  return `Edited ${name}`;
};
const partsOf = (r, prev, fb) => {
  const parts = [];
  if (!prev) {
    for (const s of r.sections || []) parts.push({ anchors: [revAnchor(s.head)], heads: [s.head], html: fb(s.head) || `${esc(clean(s.head))}${s.state ? ` — tasks ${esc(s.state)}` : ''}` });
    return parts;
  }
  const ph = {}, ps = {}, phead = {};
  for (const s of prev.sections || []) { ph[s.head] = s.hash; ps[s.head] = s.state; phead[s.head] = s.head; }
  const cur = r.sections || [];
  const removed = (prev.sections || []).filter((s) => !cur.some((c) => c.head === s.head));
  const added = cur.filter((s) => ph[s.head] === undefined);
  if (removed.length === 1 && added.length === 1) {
    parts.push({ anchors: [revAnchor(removed[0].head), revAnchor(added[0].head)], heads: [removed[0].head, added[0].head], html: `Renamed ${esc(clean(removed[0].head))} → ${esc(clean(added[0].head))}` });
    const rfb = fb(added[0].head);
    if (rfb) {
      if (typeof rfb === 'object') parts.push({ anchors: [revAnchor(added[0].head)], heads: [added[0].head], html: rfb.items.map((x) => x), isFbBlock: true, fbTitle: rfb.title });
      else parts.push({ anchors: [revAnchor(added[0].head)], heads: [added[0].head], html: rfb });
    }
  } else {
    for (const s of removed) parts.push({ anchors: [revAnchor(s.head)], heads: [s.head], html: `Removed ${esc(clean(s.head))}` });
    for (const s of added) {
      const f = fb(s.head);
      if (f && typeof f === 'object') parts.push({ anchors: [revAnchor(s.head)], heads: [s.head], html: f.items, isFbBlock: true, fbTitle: f.title });
      else parts.push({ anchors: [revAnchor(s.head)], heads: [s.head], html: f || `Added ${esc(clean(s.head))}${s.state ? ` — ${esc(s.state)} tasks` : ''}` });
    }
  }
  const renamed = removed.length === 1 && added.length === 1;
  const skip = renamed ? added[0].head : null;
  for (const s of cur) {
    if (s.head === skip || ph[s.head] === undefined || ph[s.head] === s.hash) continue;
    const f = fb(s.head);
    if (f && typeof f === 'object') parts.push({ anchors: [revAnchor(s.head)], heads: [s.head], html: f.items, isFbBlock: true, fbTitle: f.title });
    else parts.push({ anchors: [revAnchor(s.head)], heads: [s.head], html: f || lineFor(s.head, ps[s.head], s.state, phead[s.head]) });
  }
  return parts;
};
const OUTSIDE = `Edited plan text outside tracked sections`;
const fmtTimelineDate = (iso) => {
  if (!iso) return '';
  const d = fmtDate(iso);
  return d ? d.replace(/^(\d{2}) ([A-Za-z]{3}) (\d{4})$/, (_, dd, mmm, yyyy) => `${Number(dd)} ${mmm}, ${yyyy}`) : iso;
};
const gateText = (note) => {
  let t = String(note || '').trim();
  t = t.replace(/^[·—–-]\s*rev\s*\d{4}-\d{2}-\d{2}\s*/i, '');
  t = t.replace(/^["“]+|["”]+$/g, '').trim();
  t = t.replace(/\s+/g, ' ').trim();
  return t;
};
export function paintRevs(revs, scope){
  if (!revs || !revs.length) {
    const gates = scope && scope.gates ? scope.gates : null;
    if (!gates || !gates.length) return '';
  }
  const src = fileFor(revs || []);
  const fb = (head) => (isFb(head) ? fbLines(src, head) : null);
  const open = scope && scope.head ? revAnchor(scope.head) : null;
  // Gate ownership follows the section number (Task 3 → gate 3), same
  // rule as the drawer status line — never the positional index.
  let phaseN = null;
  if (scope && scope.head) {
    phaseN = gateNOf(scope.head, Number.isInteger(scope.phaseN) ? scope.phaseN : null);
  } else if (scope && Number.isInteger(scope.phaseN)) phaseN = scope.phaseN;
  // ── Collect gate eval entries for this phase (newest-first) ──
  const gateEvals = [];
  if (scope && scope.gates && Array.isArray(scope.gates)) {
    // file order is oldest→newest; we want newest-first for pairing with revs
    const ordered = [...scope.gates];
    for (let i = ordered.length - 1; i >= 0; i--) {
      const g = ordered[i];
      if (phaseN !== null && g.n !== phaseN) continue;
      if (!/·\s*rev\b/i.test(g.note)) continue;
      const text = gateText(g.note);
      if (!text) continue;
      gateEvals.push({ date: g.date || '', time: '', text, isGate: true, order: gateEvals.length });
    }
  }
  // ── Collect history-rev rows newest-first ──
  const revRows = [];
  for (let i = (revs || []).length - 1; i >= 0; i--) {
    const r = revs[i], prev = i ? revs[i - 1] : null;
    let all = partsOf(r, prev, fb);
    if (open) {
      all = all.filter((p) => p.anchors.filter(Boolean).some((a) => a === open));
      if (!all.length) continue;
    } else if (!all.length) {
      all = [{ anchors: [null], heads: [], html: OUTSIDE }];
    }
    const texts = [];
    for (const p of all) {
      if (p.isFbBlock) {
        texts.push(p.fbTitle);
        for (const it of p.html) texts.push(it);
      } else if (Array.isArray(p.html)) {
        for (const it of p.html) texts.push(it);
      } else {
        const t = String(p.html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&quot;/g, '"');
        texts.push(t);
      }
    }
    for (const t of texts) {
      const cleanT = String(t).trim();
      if (!cleanT) continue;
      revRows.push({ date: r.date || '', time: r.time || '', text: cleanT, isGate: false });
    }
  }
  // Early exit if nothing
  if (!gateEvals.length && !revRows.length) return '';
  // ── Group rows by date ──
  // Build date → revRows for that date (already newest-first within date)
  const revByDate = new Map();
  for (const r of revRows) {
    const d = r.date || '';
    if (!revByDate.has(d)) revByDate.set(d, []);
    revByDate.get(d).push(r);
  }
  // Group gate evals by date (newest-first preserved)
  const gateByDate = new Map();
  for (const g of gateEvals) {
    const d = g.date || '';
    if (!gateByDate.has(d)) gateByDate.set(d, []);
    gateByDate.get(d).push(g);
  }
  // All unique dates newest-first
  const allDates = [...new Set([...gateEvals.map(g=>g.date), ...revRows.map(r=>r.date)])].sort((a,b)=> b.localeCompare(a));
  // For dates with no evals, still create a group with just revs (baseline)
  // For dates with evals, thread: eval parent → its iteration revs (paired by order)
  const n = gateEvals.length;
  const timeline = [];
  for (let di = 0; di < allDates.length; di++) {
    const date = allDates[di];
    const dLabelDate = fmtTimelineDate(date) || date || 'Undated';
    const dayNum = allDates.length - di;
    const gates = gateByDate.get(date) || [];
    const revsForDate = revByDate.get(date) || [];
    const dayCount = gates.length;
    const dayLabel = `<span class="ds-caret">‹›</span><span class="ds-day-num">Day ${dayNum}</span> · ${esc(dLabelDate)} · ${dayCount}`;
    let groupInner = '';
    if (gates.length) {
      for (let gi = 0; gi < gates.length; gi++) {
        const g = gates[gi];
        groupInner += `<div class="ds-timeline-item ds-timeline-item--eval"><span>${esc(g.text)}</span></div>`;
        if (gi < revsForDate.length) {
          const rv = revsForDate[gi];
          const timeLabel = rv.time ? `${esc(rv.date)} ${esc(fmtTime(rv.time))}` : esc(rv.date || '');
          groupInner += `<div class="ds-timeline-item ds-timeline-item--iter"><span>${esc(rv.text)}</span><small>${timeLabel}</small></div>`;
        }
      }
      for (let ri = gates.length; ri < revsForDate.length; ri++) {
        const rv = revsForDate[ri];
        const timeLabel = rv.time ? `${esc(rv.date)} ${esc(fmtTime(rv.time))}` : esc(rv.date || '');
        groupInner += `<div class="ds-timeline-item ds-timeline-item--iter"><span>${esc(rv.text)}</span><small>${timeLabel}</small></div>`;
      }
    } else {
      for (const rv of revsForDate) {
        const timeLabel = rv.time ? `${esc(rv.date)} ${esc(fmtTime(rv.time))}` : esc(rv.date || '');
        groupInner += `<div class="ds-timeline-item"><span>${esc(rv.text)}</span><small>${timeLabel}</small></div>`;
      }
    }
    timeline.push(`<details class="ds-timeline-group" open><summary class="ds-timeline-date">${dayLabel}</summary><div class="ds-timeline-items">${groupInner}</div></details>`);
  }
  return [
    `<hr class="ds-hr"><details class="ds-evals ds-revs ds-panel" data-evals="${n}" data-revs="${n}" open>`,
    `<summary class="ds-revs-title ds-panel-title"><span class="ds-caret">‹›</span>Evals · <span class="ds-panel-num">${n}</span></summary>`,
    `<div class="ds-timeline">`,
    timeline.join(''),
    `</div></details>`,
  ].join('');
}
export const paintEvals = paintRevs;
