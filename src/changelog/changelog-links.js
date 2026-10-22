// safepipe changelog — link layer: manifest → section badges + unlinked list · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
import manifest from '../ds/plan-manifest.json';
import { fmtDate, fmtTime, anchorHit, anchorHitCI } from './changelog-parse.js';
const fmtTimelineDate = (iso) => { if(!iso) return ''; const d=fmtDate(iso); return d ? d.replace(' ', ' ').replace(/^([0-9]{2}) ([A-Za-z]{3}) ([0-9]{4})$/, (_,dd,mmm,yyyy)=> `${Number(dd)} ${mmm}, ${yyyy}`) : iso; };
const GH = 'https://github.com/IrfanAdam/safepipe-proj/commit/';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/</g, '&lt;');
export const commits = manifest.commits || [];
export const wip = manifest.wip || [];
const badgeItem = (c) => `<div class="ds-timeline-item"><a href="${GH}${c.full}">${c.sha}</a><span>${esc(c.subject)}</span><small>${esc(c.time ? `${c.date} ${fmtTime(c.time)}` : c.date)}</small></div>`;
export const hits = (file, text, first) => commits
  .filter((c) => c.plan === file && (c.anchor ? anchorHit(text, c.anchor) : first));
export const badges = (list, title = 'Commits') => {
  if (!list.length) return '';
  const n = list.length;
  const sorted = [...list].sort((a,b)=> (b.date + (b.time||'')).localeCompare(a.date + (a.time||'')));
  const groups = new Map();
  for (const c of sorted) {
    const d = c.date || '';
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(c);
  }
  const dates = [...groups.keys()].sort((a,b)=> b.localeCompare(a));
  let inner = '';
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const labelDate = fmtTimelineDate(d) || d || 'Undated';
    const dayNum = dates.length - i;
    const dayLabel = `<span class="ds-caret">‹›</span><span class="ds-day-num">Day ${dayNum}</span> · ${esc(labelDate)}`;
    const items = groups.get(d).map((c)=> badgeItem(c)).join('');
    inner += `<details class="ds-timeline-group" open><summary class="ds-timeline-date">${dayLabel}</summary><div class="ds-timeline-items">${items}</div></details>`;
  }
  return `<hr class="ds-hr"><details class="ds-commits-panel ds-panel" data-commits="${n}" open><summary class="ds-revs-title ds-panel-title"><span class="ds-caret">‹›</span>${esc(title)} · <span class="ds-panel-num">${n}</span></summary><div class="ds-timeline">${inner}</div></details>`;
};
export const unlinked = (texts) => {
  const xs = commits.filter((c) => !c.plan || !texts[c.plan] || (c.anchor && !anchorHitCI(texts[c.plan], c.anchor)));
  if (!xs.length) return '<h2>Unlinked changes</h2><p>All tracked — every commit cites its plan.</p>';
  return ['<h2>Unlinked changes</h2><p>These cite no plan — link next time via ',
    '<code>[plan:&lt;file&gt;#&lt;anchor&gt;]</code>.</p>'].join('')
    + (xs.length ? ((()=>{ let h='<div class=\"ds-timeline\">'; let l=null; for(const c of xs){ if(c.date!==l){ h+=`<div class=\"ds-timeline-date\">${esc(fmtTimelineDate(c.date))}</div>`; l=c.date; } h+=badgeItem(c, '·'); } return h+'</div>'; })()) : '')
    + (wip.length ? `<p>Uncommitted:</p><ul>${wip.map((w) => `<li><code>${esc(w)}</code></li>`).join('')}</ul>` : '');
};
