// safepipe changelog — rail + detail · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
const marked = {
  parse(s, opts){
    const { phaseDone = false, gateSuffix = '' } = opts || {};
    let phaseHeadSeen = false;
    let src = String(s||'')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/^\s*\{#[^}]*\}\s*$/gm, '')
      .replace(/\{#[^}]*\}/g, ' ')
      // Due lines are scheduling metadata, not prose — strip at render like
      // {#anchors} (Task 3: the Due control owns display of the date).
      .replace(/^\s*\*Due:\s*[^*\n]*\*\s*$/gm, '')
      // Section `*Tags: …*` / `**Tags: …**` lines are metadata, not prose —
      // the drawer head owns tag display, so strip at render like Due/anchors.
      .replace(/^\s*\*{1,2}Tags:\s*[^*\n]*\*{1,2}\s*$/gm, '');
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
    // Owner refinement: the FIRST h2 (the phase title) also carries the
    // phase gate verdict on that same line (gateSuffix, '' when locked or
    // gateless); a fully-done phase whose heading lacks the mark still gets
    // its DONE line so the verdict has a line to sit on. Task headings
    // (h3/h1, later h2s) are never touched by either.
    const headOf = (tag, text) => {
      const isPhaseHead = tag === 'h2' && !phaseHeadSeen;
      if (isPhaseHead) phaseHeadSeen = true;
      const m = text.match(/\s*([✓✗])\s*(done|cancelled)(\s*\([^)]*\))?\s*$/i);
      if (!m) {
        if (isPhaseHead && phaseDone)
          return `<h2>` + text + `</h2>` +
            `<p class="ds-status ds-is-done">✓ DONE${gateSuffix}</p>`;
        return `<${tag}>` + text + `</${tag}>`;
      }
      const st = m[1] === '✗' ? 'cancelled' : 'done';
      let label = `${m[1]} ${m[2]}${m[3] || ''}`;
      if (isPhaseHead && st === 'done') label = `${m[1]} DONE${m[3] || ''}`;
      if (isPhaseHead) label += gateSuffix;
      return `<${tag}>` + text.slice(0, m.index) + `</${tag}>` +
        `<p class="ds-status ds-is-${st}">${label}</p>`;
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
import { isDone, state, parseGates, dueOf, fmtDate, gateNOf } from '../changelog-parse.js';
import { esc } from './esc.js';
import { paintRevs } from './paint-revs.js';
import { readDuePending, dueDeployVerdict } from '../../logic/due-overrides.js';
import { dueSyncStatus, clearDueSync, dueSyncRetryHTML } from '../due-progress.js';
// Gate verdict (Task 12, owner refinement): the phase's own REF GATE verdict
// as plain text appended to the below-title status line — same checkmark
// treatment as DONE, reusing .ds-status styling (no span, no new colors).
// Locked or gateless phases contribute no gate part.
// Rev count (Task 13, owner): when the gate has appended `· rev …` iterations
// while OPEN, surface that count inline — e.g. `· GATE OPEN · 4 revs`.
const gateSuffixOf = (gates, phaseN) => {
  if (!gates || !gates.length) return '';
  const gs = [...gates].sort((a, b) => a.n - b.n);
  let idx = gs.findIndex((g) => g.n === phaseN);
  if (idx < 0 && Number.isInteger(phaseN)) idx = Math.min(Math.max(phaseN, 0), gs.length - 1);
  if (idx < 0) return '';
  const g = gs[idx];
  const isRev = (x) => /·\s*rev\b/i.test(x.note);
  const revs = gs.filter((x) => x.n === g.n && isRev(x)).length;
  const revSuffix = revs ? ` · ${revs} rev${revs > 1 ? 's' : ''}` : '';
  const baseCandidates = gs.filter((x) => x.n === g.n && !isRev(x));
  const eff = baseCandidates.length ? baseCandidates[baseCandidates.length - 1] : g;
  const bases = gs.filter((x) => !isRev(x));
  const effPos = bases.indexOf(eff);
  const firstOpenPos = bases.findIndex((x) => x.state === 'open' || x.state === 'failed');
  const disp = (eff.state === 'passed' || eff.state === 'waiver') ? eff.state
    : (effPos === firstOpenPos && effPos !== -1 ? eff.state : 'locked');
  if (disp === 'passed' || disp === 'waiver') return ' ✓ GATE PASSED' + revSuffix;
  if (disp === 'failed') return ' · GATE FAILED' + revSuffix;
  if (disp === 'open') return ' · GATE OPEN' + revSuffix;
  return '';
};
// Mobile 2-level drawer nav (mirrors pages-changelog.js isMobile — local copy,
// no import cycle; the 720px breakpoint is shared).
const isMobileDetail = () => {
  try { return typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches; }
  catch { return false; }
};
export function paintDetail(root, ctx){
  const { list, pi, plan, sprints, si, active, day, sel, open, mlevel: mlevelIn, counts, plans, texts, edited, revs, dueCommit } = ctx;
  const scrim = root.querySelector('[data-scrim]'), drawer = root.querySelector('[data-drawer]');
  const mobile = isMobileDetail();
  // L1 = rail list only (detail parked), L2 = detail. Desktop ignores levels.
  const mlevel = mlevelIn === 2 ? 2 : 1;
  const atL1 = !!(mobile && open && mlevel === 1);
  // Placeholder whenever nothing is selected (mobile plan pick clears
  // sel[1] to -1) or whenever mobile sits at L1 — never the first phase.
  const showPlaceholder = open && (si < 0 || atL1);
  const sprint = sprints[si], sprintDesc = (s) => descOf(s.body);
  // L1 rail head owns the '‹ All plans' back button (closes the drawer via
  // [data-mback]); L2/desktop keep the plain title. tabindex gives the
  // mobile focus move a target (script-focus only, never in tab order).
  const railHead = '<div class="ds-rail-plan"' + (atL1 ? ' tabindex="-1" data-mlevel-head="rail"' : '') + '>' +
    (atL1 ? '<button data-mback data-mlevel="1" aria-label="Back to all plans">‹ All plans</button>' : '') +
    esc([plan.id, plan.title || provenance(plan)].filter(Boolean).join(' · ')) + '</div>';
  root.querySelector('[data-col="sprint"]').innerHTML = railHead + sprints.map((s, i) => {
    const hsS = hits(plan.file, s.body, plan.sprints.indexOf(s) === 0),
      has = hsS.length ? ' · ' + hsS.length + ' commit' + (hsS.length > 1 ? 's' : '') : '',
      frac = state(s.body),
      ed = edited && edited(s) ? ' · edited' : '';
    return [
      `<button class="ds-pick`,
      i === sel[1] && !atL1 ? ' on' : '',
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
    esc(plan.goal || (sprint ? sprintDesc(sprint) : '')),
    `</div>`,
  ].join('');
  // Mobile L1 (or a cleared selection): the detail pane stays parked
  // off-screen with a quiet placeholder — never the first phase.
  if (showPlaceholder) {
    root.querySelector('[data-col="tasks"]').innerHTML = [
      '<div class="ds-drawer-head"><b></b>',
      '<button data-close aria-label="Close detail">✕</button></div>',
      '<p class="ds-empty-detail">Select a phase or task</p>',
    ].join('');
    const u0 = unlinked(texts);
    root.querySelector('[data-col="triage"]').innerHTML = /All tracked/.test(u0) ? '' : `<hr class="ds-hr">${u0}`;
    syncDrawerChrome();
    return;
  }
  const hs = hits(plan.file, sprint.body, plan.sprints.indexOf(sprint) === 0);
  // Gate ownership is by section number (`Task 3` → gate 3), never by
  // position — positional index misattributes verdicts on Task-headed
  // plans (gateNOf · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#follow-up]).
  const phaseN = gateNOf(sprint.head, si);
  const gates = parseGates(plan.raw || '');
  // Evals now owns the REF GATE feedback — strip the raw gate thread from the
  // phase body so Verify doesn't duplicate the same verbatim thread. Collapse
  // from first "- REF GATE" through to the phase's {#phase-N} anchor.
  let bodySansGates = String(sprint.body || '');
  const gateAnchorIdx = bodySansGates.indexOf('- REF GATE');
  if (gateAnchorIdx !== -1) {
    const anchorMatch = bodySansGates.slice(gateAnchorIdx).match(/\{#phase[^}]*\}/);
    if (anchorMatch) {
      const anchorPos = bodySansGates.indexOf(anchorMatch[0], gateAnchorIdx);
      bodySansGates = bodySansGates.slice(0, gateAnchorIdx).trimEnd() + '\n' + bodySansGates.slice(anchorPos);
    } else {
      // fallback: strip each gate line individually (inline, not newline-anchored)
      bodySansGates = bodySansGates.replace(/\s*-\s*REF GATE[^\n]*/g, '');
    }
  }
  // Due control (Task 3, scheduling): incomplete sections only. Complete /
  // cancelled sections render no Due line at all — never a Due n/a.
  const secShipped = /[✓✗]/.test(String(sprint.head || '')) || isDone(state(sprint.body));
  const secDue = secShipped ? null : dueOf({ head: sprint.head, body: sprint.body });
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // Schedule trigger: accent text (or 'Schedule when?') opening the themed
  // month popup. No native date input, no hint line, never a Due n/a.
  // Commit state for this section's pick (set by applyDue/commitDue):
  // saving → saved (auto-dismissed) | needs-login | failed | retry. Null
  // shows nothing. The status is inline and never blocks — the painted date
  // IS the UI; this only answers "did it save and sync?". Mismatched
  // file/head never renders another section's status. `retry` is the
  // sync-path alias of `failed`: same inline Retry with the terse cause,
  // full body to console.error only (commitDue), never a popup, login
  // cleared on 401 only. Failure causes stay terse: timeout / offline /
  // http <status> / unchanged / head-not-found / sync http <status>.
  // Freeze remainder: while a sync claim for this section is fresh
  // (save landed, sync worker still carrying it to git), the saved row
  // keeps a pending state — "Saved ✓ · syncing…" — until the sync state
  // settles it. Editing stays allowed throughout (the Schedule button
  // never disables); a re-pick supersedes with a new claim.
  // [plan:2026-10-18_172008-supabase-scheduling-migration.md#phase-5]
  const dc = dueCommit && plan && sprint
    && dueCommit.file === plan.file && dueCommit.head === sprint.head ? dueCommit.state : '';
  const dr = dueCommit && plan && sprint
    && dueCommit.file === plan.file && dueCommit.head === sprint.head ? (dueCommit.reason || '') : '';
  // Sync-watch handoff (Supabase migration): the toast's watch parks itself
  // on sync error/timeout and records the verdict in due-progress's
  // registry. When this section's save already landed (or its commit state
  // cleared) but the registry holds an error for the painted date, the
  // existing inline Retry takes over with the terse cause — same button and
  // handler as a failed write, never a popup, login cleared on 401 only
  // (that rule lives in changelog-events, untouched here). A newer
  // authoritative state (saving/failed/needs-login) supersedes the watch.
  let syncCause = null;
  try {
    if (!secShipped && plan && sprint && plan.file && sprint.head) {
      const sec = { file: plan.file, head: sprint.head };
      if (dc === 'failed' || dc === 'needs-login') {
        try { clearDueSync(sec); } catch {}
      } else if (dc === 'saving') {
        // Supersede guard: a new pick drops the previous watch's verdict —
        // but NOT while its own watch is already syncing this exact date
        // (the success-path repaint between commit and confirmSaved must not
        // kill the just-started watch). Due-equality tells them apart.
        try {
          const s = dueSyncStatus(sec);
          if (!s || (s.due ?? null) !== (secDue ?? null)) clearDueSync(sec);
        } catch {}
      } else if (dc === 'saved' || !dc) {
        const s = dueSyncStatus(sec);
        if (s && s.state === 'error' && (s.due ?? null) === (secDue ?? null)) syncCause = s.cause || 'error';
      }
    }
  } catch { syncCause = null; }
  let pendRow = false;
  try {
    const pend = readDuePending();
    pendRow = !!pend && dueDeployVerdict(pend, Date.now()) === 'pending'
      && plan && sprint && pend.file === plan.file && pend.head === sprint.head
      && (() => { try { return pend.due === (dueOf(sec) || null); } catch { return false; } })();
  } catch { pendRow = false; }
  // Idle status slot: always rendered so the due row keeps a stable height
  // whether the commit state appears, clears, or swaps text. CSS holds it
  // at min-height via visibility — never display:none, never absent.
  const dueStatusIdle = `<span class="ds-due-status is-idle" data-due-status="idle" aria-hidden="true"></span>`;
  const dueStatusHTML = syncCause ? dueSyncRetryHTML(syncCause)
    : !dc || secShipped ? dueStatusIdle : dc === 'saving'
    ? `<span class="ds-due-status" data-due-status="saving">Saving…</span>`
    : dc === 'saved'
      ? `<span class="ds-due-status is-ok${pendRow ? ' is-pend' : ''}" data-due-status="saved">Saved ✓${pendRow ? ' · syncing…' : ''}</span>`
      : dc === 'needs-login'
        ? `<button class="ds-due-status is-warn" data-due-retry="login">only on this device — sign in again</button>`
        : (dc === 'failed' || dc === 'retry')
          ? dueSyncRetryHTML(dr || 'error')
          : dueStatusIdle;
  const dueHTML = secShipped
    ? ''
    : [
      `<div class="ds-due" data-due-row data-due-file="${esc(plan.file)}" data-due-head="${esc(sprint.head)}">`,
      `<button class="ds-due-sched" data-due-open data-requires-auth data-due="${secDue || ''}" aria-haspopup="dialog"`,
      ` aria-label="Set deadline for ${esc(short(sprint.head))}">`,
      secDue ? esc(`Deadline · ${fmtDate(secDue)}`) : 'Add deadline',
      `</button>`,
      // Logged-out readers see the date as plain text (see CSS gate below).
      secDue ? `<span class="ds-due-static">Deadline · ${esc(fmtDate(secDue))}</span>` : '',
      secDue && secDue < todayISO ? `<span class="ds-due-overdue">overdue</span>` : '',
      dueStatusHTML,
      `<div class="ds-due-pop" data-due-pop hidden role="dialog" aria-label="Pick a due date"></div>`,
      `</div>`,
    ].join('');
  // Drawer head owns the section tags: single ellipsized line, at most 2
  // visible plus `· +N` overflow, full list in title + data-tip. The `*Tags:*`
  // body line is stripped at render above, so it never repeats below status.
  const secTags = Array.isArray(sprint.tags) ? sprint.tags : [];
  const visTags = secTags.slice(0, 2);
  const moreTags = secTags.length - visTags.length;
  const tagsTxt = visTags.join(' · ') + (moreTags > 0 ? ` · +${moreTags}` : '');
  const tagsFull = secTags.join(' · ');
  const tagsHead = secTags.length
    ? `<b data-tip="${esc(tagsFull)}">${esc(tagsTxt)}</b>`
    : `<b></b>`;
  root.querySelector('[data-col="tasks"]').innerHTML = [
    '<div class="ds-drawer-head"' + ((mobile && open && mlevel === 2) ? ' tabindex="-1" data-mlevel-head="task"' : '') + '>',
    (mobile && open && mlevel === 2) ? '<button data-mback data-mlevel="2" aria-label="Back to phases">‹ Phases</button>' : '',
    tagsHead,
    `<button data-close aria-label="Close detail">✕</button></div>`,
    // Due row sits directly under the section title on EVERY paint: it is
    // always the first flow element INSIDE .ds-md — after the parsed head
    // when one matches, else before the parsed body. Never outside .ds-md
    // on one paint and inside on the next (layout jump). Both branches
    // render identical content; only the head split differs.
    (() => {
      const markOpts = {
        phaseDone: isDone(state(sprint.body)),
        gateSuffix: gateSuffixOf(gates, phaseN),
      };
      const revsHTML = paintRevs(revs, { head: sprint.head, heads: plan.sprints.map((s) => s.head), gates, phaseN })
        + (hs.length ? badges(hs) : '');
      const hm = String(bodySansGates || '').match(/^(#{1,4}\s+[^\n]+)\n([\s\S]*)$/);
      if (!hm) return [`<div class="ds-md">`, dueHTML + marked.parse(bodySansGates, markOpts) + revsHTML, `</div>`].join('');
      return [`<div class="ds-md">`, marked.parse(hm[1], markOpts) + dueHTML + marked.parse(hm[2], markOpts) + revsHTML, `</div>`].join('');
    })(),
  ].join('');
  const u = unlinked(texts);
  root.querySelector('[data-col="triage"]').innerHTML = /All tracked/.test(u) ? '' : `<hr class="ds-hr">${u}`;
  syncDrawerChrome();
  // Drawer chrome: open classes (unchanged) + mobile level dataset/classes,
  // parked-pane a11y, and focus-follows-level (mobile only). Hoisted, so the
  // L1 placeholder path above shares it.
  function syncDrawerChrome() {
    drawer.classList.toggle('is-open', open); drawer.setAttribute('aria-hidden', String(!open)); drawer.toggleAttribute('inert', !open);
    scrim.classList.toggle('is-open', open); scrim.setAttribute('aria-hidden', String(!open));
    if (mobile && open) {
      drawer.dataset.mlevel = String(mlevel);
      drawer.classList.toggle('is-l1', mlevel === 1);
      drawer.classList.toggle('is-l2', mlevel === 2);
    } else {
      delete drawer.dataset.mlevel;
      drawer.classList.remove('is-l1'); drawer.classList.remove('is-l2');
    }
    // The parked pane is inert + hidden from AT; the visible pane is not.
    // Desktop (or a closed drawer) leaves both panes untouched.
    try {
      const railPane = root.querySelector('[data-col="sprint"]');
      const taskPane = root.querySelector('[data-col="tasks"]');
      if (mobile && open && mlevel === 1) {
        if (railPane) { railPane.toggleAttribute('inert', false); railPane.setAttribute('aria-hidden', 'false'); }
        if (taskPane) { taskPane.toggleAttribute('inert', true); taskPane.setAttribute('aria-hidden', 'true'); }
      } else if (mobile && open && mlevel === 2) {
        if (railPane) { railPane.toggleAttribute('inert', true); railPane.setAttribute('aria-hidden', 'true'); }
        if (taskPane) { taskPane.toggleAttribute('inert', false); taskPane.setAttribute('aria-hidden', 'false'); }
      } else {
        if (railPane) { railPane.toggleAttribute('inert', false); railPane.removeAttribute('aria-hidden'); }
        if (taskPane) { taskPane.toggleAttribute('inert', false); taskPane.removeAttribute('aria-hidden'); }
      }
    } catch {}
    // Focus moves to the visible pane's head on level change — mobile only,
    // and only on change (repeat paints at the same level never steal it).
    try {
      const prev = drawer._mlevel ?? null;
      const curLevel = (mobile && open) ? mlevel : null;
      drawer._mlevel = curLevel;
      if (curLevel !== null && prev !== curLevel) {
        const head = curLevel === 1
          ? root.querySelector('[data-col="sprint"] [data-mlevel-head]')
          : root.querySelector('[data-col="tasks"] [data-mlevel-head]');
        if (head && typeof head.focus === 'function') head.focus({ preventScroll: true });
      }
    } catch {}
  }
}
