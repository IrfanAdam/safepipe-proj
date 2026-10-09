// safepipe changelog — link layer: manifest → section badges + unlinked list · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
// Exports: commits, wip, hits, badges, unlinked. Pure, no DOM.
import manifest from '../ds/plan-manifest.json';
import { fmtDate, fmtTime, anchorHit } from './changelog-parse.js';
const fmtTimelineDate = (iso) => { if(!iso) return ''; const d=fmtDate(iso); return d ? d.replace(' ', ' ').replace(/^([0-9]{2}) ([A-Za-z]{3}) ([0-9]{4})$/, (_,dd,mmm,yyyy)=> `${Number(dd)} ${mmm}, ${yyyy}`) : iso; };
const GH = 'https://github.com/IrfanAdam/safepipe-proj/commit/';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const commits = manifest.commits || [];
export const wip = manifest.wip || [];
const badgeItem = (c) => `<div class="ds-timeline-item"><a href="${GH}${c.full}">${c.sha}</a> <span>${esc(c.subject)}</span><small>${esc(c.time ? `${c.date} ${fmtTime(c.time)}` : c.date)}</small></div>`;
// Anchor-less commits attach to their plan's first section; anchored ones to
// the first section whose text boundary-matches the anchor.
export const hits = (file, text, first) => commits
  .filter((c) => c.plan === file && (c.anchor ? anchorHit(text, c.anchor) : first));
export const badges = (list) => {
  if (!list.length) return '';
  let html = '<div class="ds-timeline">';
  let last = null;
  for (const c of list) {
    if (c.date !== last) { html += `<div class="ds-timeline-date">${esc(fmtTimelineDate(c.date))}</div>`; last = c.date; }
    html += badgeItem(c);
  }
  return html + '</div>';
};
export const unlinked = (texts) => {
  const xs = commits.filter((c) => !c.plan || !texts[c.plan] || (c.anchor && !anchorHit(texts[c.plan], c.anchor)));
  if (!xs.length) return '<h2>Unlinked changes</h2><p>All tracked — every commit cites its plan.</p>';
  return ['<h2>Unlinked changes</h2><p>These cite no plan — link next time via ',
    '<code>[plan:&lt;file&gt;#&lt;anchor&gt;]</code>.</p>'].join('')
    + (xs.length ? ((()=>{ let h='<div class="ds-timeline">'; let l=null; for(const c of xs){ if(c.date!==l){ h+=`<div class="ds-timeline-date">${esc(fmtTimelineDate(c.date))}</div>`; l=c.date; } h+=badgeItem(c); } return h+'</div>'; })()) : '')
    + (wip.length ? `<p>Uncommitted:</p><ul>${wip.map((w) => `<li><code>${esc(w)}</code></li>`).join('')}</ul>` : '');
};
