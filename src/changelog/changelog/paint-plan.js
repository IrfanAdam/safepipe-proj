// safepipe changelog — build cards · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
import { fmtDate, fmtTime, buildState, state, isDone, parseGates } from '../changelog-parse.js';
import { shipGatesShut } from './raw-detail.js';
import { sectionRaw } from './raw-detail.js';
import { hits, commits, unlinked } from '../changelog-links.js';
import { clip, oneLine } from '../changelog-titles.js';
import { esc } from './esc.js';
export function paintPlan(root, ctx){
  const { list, pi, plan, sprints, si, active, day, sel, open, counts, plans, texts, revOf } = ctx;
  const scrim = root.querySelector('[data-scrim]'), drawer = root.querySelector('[data-drawer]');
  if (!plan) {
    const nf = [
      active.size ? 'these tags' : '',
      day ? fmtDate(day) : '',
    ].filter(Boolean).join(' · ');
    root.querySelector('[data-col="plan"]').innerHTML = [
      `<p class="ds-note">Nothing matches `,
      nf || 'the changelog',
      ` yet.</p>`,
    ].join('');
    root
      .querySelector('[data-col="sprint"]')
      .innerHTML = '';
    root
      .querySelector('[data-col="triage"]')
      .innerHTML = unlinked(texts);
    drawer.classList.toggle('is-open', false); drawer.setAttribute('aria-hidden', 'true'); drawer.toggleAttribute('inert', true);
    scrim.classList.toggle('is-open', false); scrim.setAttribute('aria-hidden', 'true'); return false;
  }
  const sprint = sprints[si];
  root.querySelector('[data-col="plan"]').innerHTML = list.map((p, i) => {
    const seq = String(list.length - i).padStart(2, '0'), num = p.id || seq, frac = buildState(p.sprints);
    // Fallback when buildState is empty but tasks exist via raw ### heads
    // (e.g. state() empty due to norm edge): derive done/total from raw
    // so card never shows just "7 phases" with no fraction when tasks exist.
    const dispFrac = (() => {
      if (frac) return frac;
      try {
        if (!p.raw) return frac;
        let d = 0, t = 0;
        for (const s of p.sprints) {
          let f = state(s.body);
          if (f) {
            const m = f.match(/(\d+)\/(\d+)/);
            if (m) { d += Number(m[1]); t += Number(m[2]); continue; }
          }
          const raw = sectionRaw(p.raw, s.head);
          if (!raw) continue;
          const lines = raw.split('\n').filter((l) => /^###\s+(Task|Step|Phase)\b/i.test(l.trim()));
          if (!lines.length) continue;
          d += lines.filter((l) => /[✓✗]/.test(l)).length;
          t += lines.length;
        }
        return t ? `${d}/${t}` : frac;
      } catch { return frac; }
    })();
    const hcs = p.sprints.flatMap((s) => hits(p.file, s.body, p.sprints.indexOf(s) === 0));
    const valid = hcs.concat(commits.filter((c) => c.plan === p.file && !hcs.includes(c)));
    const tagged = valid.filter((c) => c.date === p.date || (c.time && c.date >= p.date));
    const last = tagged.length ? tagged.reduce((a,
        b) => (b.date + (b.time || '') > a.date + (a.time || '') ? b : a)) : null;
    const sd = fmtDate(p.date),
      st = fmtTime(p.id),
      endDate = last ? last.date : '',
      endTime = last && last.time ? fmtTime(last.time) : '';
    let endTxt = '';
    if (endDate && endDate !== p.date) {
      endTxt = ' – ' + fmtDate(endDate);
      if (endTime) endTxt += ' ' + endTime;
    } else if (endTime && endTime !== st) {
      endTxt = ' – ' + endTime;
    }
    const stBit = st ? ' ' + st : '';
    const endBit = endTxt ? ' ' + endTxt.trim() : '';
    const dateTxt = sd + stBit + endBit;
    const unit = p.sprints.some((s) => /^Phase\b/.test(s.head)) ? 'phases' : 'tasks';
    const rev = revOf ? revOf(p.file) : null;
    const stateTxt = [
      [p.sprints.length, ` ${unit}`].join(''),
      dispFrac,
      rev ? `rev ${rev.n} · ${fmtDate(rev.last)}` : '',
    ].filter(Boolean).join(' · ');
    const tagCount = Math.min(3, p.tags.length);
    const tagsVisible = p.tags.slice(0, tagCount).join(' · ');
    const tagsOverflow = p.tags.length - tagCount;
    const tagsFull = p.tags.join(' · ');
    return [
      `<button class="ds-pick`,
      i === sel[0] ? ' on' : '',
      // The card is the plan's seal: fractions full AND the ship gate shut.
      // Tasks done with an open ship gate (remaining cutover work) reads
      // open — rail rows keep their task fractions either way.
      isDone(dispFrac) && shipGatesShut(parseGates(p.raw || '')) ? '' : ' is-open',
      `" data-tip="`,
      esc(clip(oneLine(p.goal), 100) || oneLine(p.purpose) || oneLine(p.title)),
      `"><span class="ds-num">`,
      num,
      `</span><span class="ds-main"><b>`,
      esc(p.title),
      `</b><small><span class="ds-date">`,
      dateTxt,
      `</span><span class="ds-state">`,
      stateTxt,
      `</span></small></span><span class="ds-tags"${tagsOverflow > 0 ? ` data-tip="${esc(tagsFull)}"` : ''}>`,
      esc(tagsVisible),
      tagsOverflow > 0 ? ` <span class="ds-tags-more" role="button" tabindex="0" data-tags-more="${i}" aria-label="Show ${tagsOverflow} more tags">+${tagsOverflow}</span>` : '',
      `</span></button>`,
    ].join('');
  }).join('');
  return true;
}
