// safepipe changelog — rail + detail · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
const marked = {
  parse(s){
    let src = String(s||'')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/^\s*\{#[^}]*\}\s*$/gm, '')
      .replace(/\{#[^}]*\}/g, ' ');
    const esc = (t)=> t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    // block-first: split on blank lines so <ul> never spans paragraphs and
    // no stray </p> lands after headings (Task-1 record: Modify/Create <li>s
    // swallowed the Verify paragraph into one <ul>).
    const liOf = (ln) => {
      const t0 = ln
        .replace(/^- \[x\] /i, '<input type="checkbox" checked disabled> ')
        .replace(/^- \[ \] /, '<input type="checkbox" disabled> ')
        .replace(/^- /, '');
      // Plain bullets (no checkbox) are sub-points, not tasks — leave untouched.
      if (!/^<input/.test(t0)) return '<li>' + t0 + '</li>';
      // Task item: the inline `✓ done —` / `✗ cancelled —` is redundant (the
      // checkbox already carries it) — strip it and re-emit as its own line.
      let t = t0, status = '';
      t = t.replace(/\*\*(.+?)\*\* ✓ done( — )?/, (m, ti) => { status = 'done'; return '**' + ti + '** '; });
      if (!status) t = t.replace(/\*\*(.+?)\*\* &lt;span class="ds-cancelled"&gt;✗ cancelled&lt;\/span&gt;( — )?/, (m, ti) => { status = 'cancelled'; return '**' + ti + '** '; });
      const hm = t.match(/^(<input[^>]*> \*\*.+?\*\*)\s*([\s\S]*)$/);
      let head = t, rest = '';
      if (hm) { head = hm[1]; rest = hm[2]; }
      let html = head;
      // Done needs no line (the checked box already says it); cancelled does
      // (its box is checked too, so without the line it reads as done).
      if (status === 'cancelled') html += `<span class="ds-status ds-is-cancelled">✗ cancelled</span>`;
      // Box `**Label:**` segments (Files, Verify, Accuracy…) as compact rows;
      // the Objective flows inline right after the bold title instead.
      if (rest && /\*\*([^*]{1,160}?):\*\*/.test(rest)) {
        const parts = rest.split(/\*\*([^*]{1,160}?):\*\*/);
        const lead = (parts[0] || '').trim();
        let i = 1;
        if ((parts[1] || '').trim().toLowerCase() === 'objective' && (parts[2] || '').trim()) {
          html += ' — ' + (parts[2] || '').trim();
          i = 3;
        }
        let fields = '';
        for (; i + 1 < parts.length; i += 2) {
          const label = (parts[i] || '').trim(), val = (parts[i + 1] || '').trim();
          if (!label && !val) continue;
          fields += `<div class="ds-field"><dt>${label}</dt><dd>${val}</dd></div>`;
        }
        if (fields) {
          if (lead) html += ' ' + lead;
          html += `<dl class="ds-fields">${fields}</dl>`;
        } else if (lead && i !== 1) html += ' ' + lead;
        else if (i === 1) html += ' ' + rest;
      } else if (rest) html += ' ' + rest;
      return '<li>' + html + '</li>';
    };
    // Headings carrying a trailing `✓ done (date)` / `✗ cancelled` mark get
    // the mark stripped and re-emitted as its own status line (no checkbox
    // exists on a heading, so the line preserves the information).
    const headOf = (tag, text) => {
      const m = text.match(/\s*([✓✗])\s*(done|cancelled)(\s*\([^)]*\))?\s*$/i);
      if (!m) return `<${tag}>` + text + `</${tag}>`;
      const st = m[1] === '✗' ? 'cancelled' : 'done';
      return `<${tag}>` + text.slice(0, m.index) + `</${tag}>` +
        `<p class="ds-status ds-is-${st}">${m[1]} ${m[2]}${m[3] || ''}</p>`;
    };
    const out = [];
    let fence = null;
    for (const block of esc(src).split(/\n\n+/)) {
      if (!block.trim() || /^\s*\|/.test(block)) continue;
      // fenced block: single block that starts with ``` — render as <pre> and skip para/list splitting
      if (/^\s*```/.test(block)) {
        const lines = block.split('\n');
        const open = lines[0] || '';
        const lang = open.replace(/^\s*```\s*/, '').trim();
        let closeIdx = lines.length - 1;
        while (closeIdx > 0 && !/^\s*```\s*$/.test(lines[closeIdx])) closeIdx--;
        const code = lines.slice(1, closeIdx).join('\n');
        if (code.trim()) {
          const cls = lang ? ` class="language-${lang}"` : '';
          out.push(`<pre><code${cls}>${code}</code></pre>`);
        }
        continue;
      }
      let para = [];
      let list = [];
      const flushP = () => {
        const txt = para.join('\n').trim();
        if (txt) out.push('<p>' + para.join('\n') + '</p>');
        para = [];
      };
      const flushL = () => { if (list.length) { out.push('<ul>' + list.join('') + '</ul>'); list = []; } };
      for (const ln of block.split('\n')) {
        let m;
        if ((m = ln.match(/^### (.+)$/))) { flushP(); flushL(); out.push(headOf('h3', m[1])); }
        else if ((m = ln.match(/^## (.+)$/))) { flushP(); flushL(); out.push(headOf('h2', m[1])); }
        else if ((m = ln.match(/^# (.+)$/))) { flushP(); flushL(); out.push(headOf('h1', m[1])); }
        else if (/^- /.test(ln)) { flushP(); list.push(liOf(ln)); }
        else if (ln.trim() === '') { flushP(); flushL(); }
        else { flushL(); para.push(ln); }
      }
      flushP(); flushL();
    }
    let html = out.join('');
    html = html.replace(/\*Shipped in [^*]*\*/g, (m)=> '<em>'+m.slice(1,-1)+'</em>');
    html = html.replace(/\*\*Tags:[^*]*\*\*/g, '');
    if (!html) return '';
    // inline bold
    html = html.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g,'<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1');
    return html;
  }
};
import { hits, badges, unlinked } from '../changelog-links.js';
import { shortPhase as short, unitLabel, provenance, descOf, tipOf } from '../changelog-titles.js';
import { isDone, state } from '../changelog-parse.js';
import { esc } from './esc.js';
export function paintDetail(root, ctx){
  const { list, pi, plan, sprints, si, active, day, sel, open, counts, plans, texts, edited } = ctx;
  const scrim = root.querySelector('[data-scrim]'), drawer = root.querySelector('[data-drawer]');
  const sprint = sprints[si], sprintDesc = (s) => descOf(s.body);
  const railHead = `<div class="ds-rail-plan">` + esc([plan.id, plan.title || provenance(plan)].filter(Boolean).join(' · ')) + `</div>`;
  root.querySelector('[data-col="sprint"]').innerHTML = railHead + sprints.map((s, i) => {
    const hsS = hits(plan.file, s.body, plan.sprints.indexOf(s) === 0),
      has = hsS.length ? ' · ' + hsS.length + ' commit' + (hsS.length > 1 ? 's' : '') : '',
      frac = state(s.body),
      ed = edited && edited(s) ? ' · edited' : '';
    return [
      `<button class="ds-pick`,
      i === sel[1] ? ' on' : '',
      isDone(frac) ? '' : ' is-open',
      `" data-tip="`,
      esc(tipOf(s.head, s.body, 100)),
      `"><span class="ds-row"><span class="ds-num">`,
      unitLabel(s.head, i),
      `</span><b>`,
      esc(short(s.head)),
      `</b></span><small>`,
      [frac + has + ed].filter(Boolean).join(' · '),
      `</small></button>`,
    ].join('');
  }).join('') + [
    `<p class="ds-commits" data-prov>`,
    esc(provenance(plan)),
    `</p><div class="ds-rail-foot" data-foot>`,
    esc(plan.goal || sprintDesc(sprint)),
    `</div>`,
  ].join('');
  const hs = hits(plan.file, sprint.body, plan.sprints.indexOf(sprint) === 0);
  root.querySelector('[data-col="tasks"]').innerHTML = [
    `<div class="ds-drawer-head"><b>`,
    esc(unitLabel(sprint.head, si)),
    ` · `,
    esc(short(sprint.head)),
    `</b><button data-close aria-label="Close detail">✕</button></div><div class="ds-md">`,
    marked.parse(sprint.body) + (hs.length ? `<hr class="ds-hr">` + badges(hs) : ''),
    `</div>`,
  ].join('');
  const u = unlinked(texts);
  root.querySelector('[data-col="triage"]').innerHTML = /All tracked/.test(u) ? '' : `<hr class="ds-hr">${u}`;
  if (open) { drawer.hidden = false; scrim.hidden = false; } else { drawer.hidden = true; scrim.hidden = true; }
}
