// safepipe changelog — drawer + filter + timeline interactions · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
// Exports: bindChangelogEvents — click/key/hover wiring over shared state st
// Timeline (task 2): view toggle, track/bout/ghost open, bout popover, Esc chain.
// — Events —
import { saveDueOverride, saveDueConfirm, saveDuePending, dueFailureReason, duePublishStep, confirmPublish, headingOf, findHeadIndex } from '../logic/due-overrides.js';
import { getSchedToken, clearSchedToken, clearSchedUser } from '../logic/schedule-auth.js';
import { openScheduleGate } from './schedule-gate.js';
import { showDueProgress, setDueProgressStep, hideDueProgress } from './due-progress.js';
// Due scheduling (task 3): pure file-text edit — insert/replace/clear the
// single `*Due: YYYY-MM-DD*` line under the owning head, idempotently (first
// Due-shaped line wins, extras removed, never duplicated). Head matching is
// shared with the server (findHeadIndex); head not found → text unchanged.
// Exported for node probes; the browser handler applies the
// same edit to the live section body so the ghost preview recomputes live.
const DUE_SHAPE = /^\s*\*Due:\s*[^*\n]*\*\s*$/;
export function dueEditText(raw, head, due) {
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const hi = findHeadIndex(lines, head);
  if (hi < 0) return text;
  const lvl = (headingOf(lines[hi]) || {}).lvl || 2;
  let end = lines.length;
  for (let i = hi + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,3})\s/);
    if (m && m[1].length <= lvl) { end = i; break; }
  }
  const shaped = [];
  for (let i = hi + 1; i < end; i++) if (DUE_SHAPE.test(lines[i])) shaped.push(i);
  const out = lines.slice();
  if (!due) {
    for (let k = shaped.length - 1; k >= 0; k--) out.splice(shaped[k], 1);
    return out.join('\n');
  }
  const line = `*Due: ${due}*`;
  if (shaped.length) {
    out[shaped[0]] = line;
    for (let k = shaped.length - 1; k >= 1; k--) out.splice(shaped[k], 1);
    return out.join('\n');
  }
  // Scheduling convention: the Due line sits after the head/Tags line, so a
  // following *Tags:* line keeps its place directly under the head.
  let at = hi + 1;
  if (/^\s*\*Tags:/i.test(lines[hi + 1] || '')) at = hi + 2;
  out.splice(at, 0, line);
  return out.join('\n');
}
// Live-body preview edit (exported for node probes): file-shaped bodies go
// through dueEditText; norm()-synthesized bodies from ###-fallback plans
// carry no raw heading line, so dueEditText no-ops on them — preview then
// edits the live body directly (Due first line for set, strip all Due lines
// for clear). parseDue scans the whole body, so ghost preview works; the
// FILE commit always goes through dueEditText on the raw plan text. An
// enabled control therefore always edits — never a silent no-op.
export function duePreviewEdit(body, head, due) {
  const src = String(body || '');
  const next = dueEditText(src, head, due);
  if (next !== src) return next;
  if (!due) {
    if (!/^\s*\*Due:\s*[^*\n]*\*\s*$/m.test(src)) return src;
    return src.replace(/^\s*\*Due:\s*[^*\n]*\*\s*$/gm, '').replace(/^\n+/, '');
  }
  return `*Due: ${due}*\n${src}`;
}
export function bindChangelogEvents(root, st, helpers) {
  const { cur, doPaint } = helpers;
  const tlPop = () => root.querySelector('[data-tl-pop]');
  let popFor = null;
  // Last input device, tracked from pointer/touch events. A tap fires the
  // compatibility hover events (mouseover/mousemove at the touch point) right
  // before its click, so a hover-only tip would latch on and stay: touch never
  // fires mouseleave, and no click branch hides the tip — every tap on a
  // [data-tip] row/bar/day-cell therefore leaves the tooltip parked over the
  // thing just tapped (no tap path dismisses it). Touch input is never treated
  // as hover; the next real mouse/pen event clears the flag, so desktop hover
  // behaves exactly as before.
  let touchInput = false;
  const hidePop = () => { popFor = null; const p = tlPop(); if (p) p.hidden = true; };
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const showPop = (el, x, y) => {
    const p = tlPop();
    if (!p || !el || !el.dataset.pop) { hidePop(); return; }
    // Structured popover: title + scope line with done-counts accented
    // ('2/4 phases · 4/4 tasks') + 2-line-clamped description (from the
    // bout's data-tip) + schedule-deadline link right under it (or a muted
    // done date when no Due applies — never a Due n/a) + smaller muted
    // stats/date subtext.
    const lines = String(el.dataset.pop).split('\n').filter(Boolean);
    const title = lines[0] || '';
    const sub = lines.slice(1).join('\n');
    const desc = (el.dataset.tip || '').trim();
    const ph = String(el.dataset.ph || '').split('/');
    const tk = String(el.dataset.tk || '').split('/');
    const phOk = ph.length === 2 && ph[0] !== '' && ph[1] !== '';
    const tkOk = tk.length === 2 && tk[0] !== '' && tk[1] !== '';
    const scope = (phOk || tkOk)
      ? `<span class="ds-tl-pop__tasks">${phOk ? `<b>${escHtml(ph[0])}</b>/${escHtml(ph[1])} phase${ph[1] === '1' ? '' : 's'}` : ''}${phOk && tkOk ? ' · ' : ''}${tkOk ? `<b>${escHtml(tk[0])}</b>/${escHtml(tk[1])} tasks` : ''}</span>` : '';
    const due = (el.dataset.due || '').trim();
    const dueRow = due
      ? `<button class="ds-tl-pop__due" data-tl-due="${escHtml(due)}">Deadline · ${escHtml((el.dataset.duetxt || '').trim() || due)}</button>`
      : ((el.dataset.donetxt || '').trim()
        ? `<span class="ds-tl-pop__done">Done ${escHtml((el.dataset.donetxt || '').trim())}</span>` : '');
    p.innerHTML =
      `<b class="ds-tl-pop__title">${escHtml(title)}</b>` +
      (desc && desc !== title ? `<span class="ds-tl-pop__desc">${escHtml(desc)}</span>` : '') +
      scope +
      dueRow +
      (sub ? `<span class="ds-tl-pop__sub">${escHtml(sub)}</span>` : '');
    p.hidden = false;
    popFor = el;
    const pad = 14;
    const r = p.getBoundingClientRect();
    let px = (x ?? 0) + pad, py = (y ?? 0) + pad;
    if (px + r.width > innerWidth - 8) px = (x ?? 0) - r.width - pad;
    if (py + r.height > innerHeight - 8) py = (y ?? 0) - r.height - pad;
    p.style.left = px + 'px'; p.style.top = py + 'px';
  };
  const showPopFor = (el) => {
    const r = el.getBoundingClientRect();
    showPop(el, r.left + r.width / 2, r.bottom);
  };
  // Row scroll: 'l' brings the cluster's end in from the left, 'r' its start
  // in from the right; 'auto' uses nearest-edge — clipped-left nudges the
  // start in, clipped-right pulls the end in (or the start, when the cluster
  // is wider than the window). No-op only when fully visible.
  // Instant, matching the lane-jump rule — repeated clicks never race.
  const scrollRowIntoView = (row, dir) => {
    const sc = root.querySelector('.ds-tl-scroll');
    if (!sc) return;
    const tracks = [...row.querySelectorAll('[data-tl-bout],[data-tl-ghost]')];
    if (!tracks.length) return;
    const vr = sc.getBoundingClientRect(), pad = 14;
    const f = tracks[0].getBoundingClientRect(), l = tracks[tracks.length - 1].getBoundingClientRect();
    const fDoc = f.left - vr.left + sc.scrollLeft, lDoc = l.right - vr.left + sc.scrollLeft;
    const viewL = sc.scrollLeft, viewR = viewL + sc.clientWidth;
    let x = null;
    if (dir === 'l') x = lDoc - sc.clientWidth + pad;
    else if (dir === 'r') x = fDoc - pad;
    else if (fDoc < viewL + pad) x = fDoc - pad;
    else if (lDoc > viewR - pad) {
      x = (lDoc - fDoc <= sc.clientWidth) ? lDoc - sc.clientWidth + pad : fDoc - pad;
    }
    if (x !== null && Math.abs(x - sc.scrollLeft) > 1) sc.scrollTo({ left: Math.max(0, x), behavior: 'auto' });
    // Programmatic scrolls don't reliably raise scroll events in every
    // engine/harness, so re-sync the edge carets explicitly (user-driven
    // scrolls are covered by the scroller's own onscroll in paint).
    import('./changelog/timeline-paint.js')
      .then((m) => { try { m.syncTlEdges(root.querySelector('[data-timeline]')); } catch {} })
      .catch(() => {});
  };
  const closeTimeline = () => {
    st.view = 'list'; st.tlSel = null; st.returnView = null; hidePop(); doPaint(root);
  };
  const openTlPlan = (file, boutIdx, ghost) => {
    let c = cur();
    let li = c.list.findIndex((p) => p.file === file);
    // The timeline ignores the landing day filter, so its row may be absent
    // from the day-filtered list: drop the day (explicit navigation) and retry.
    if (li < 0 && st.day) { st.day = ''; c = cur(); li = c.list.findIndex((p) => p.file === file); }
    if (li < 0) return;
    const plan = c.list[li];
    const apply = (si) => {
      st.sel = [li, Math.min(Math.max(si, 0), Math.max(plan.sprints.length - 1, 0))];
      st.open = true; st.openFile = file; st.stage = 'tasks'; st.returnView = 'timeline';
      if (boutIdx !== null && boutIdx !== undefined) {
        st.tlSel = { planFile: file, boutIdx };
        st.tlLast = st.tlSel;
      }
      hidePop(); doPaint(root);
    };
    if (ghost) {
      import('./changelog/timeline-paint.js').then((m) => {
        try { apply(m.ghostSection(plan)); } catch { apply(0); }
      }).catch(() => apply(0));
      return;
    }
    apply(0);
  };
  // Due set/clear against the open section: same edit the file commit
  // carries, applied to the live section body so ghostOf recomputes on the
  // next doPaint with no build. The dev/preview server exposes a local-only
  // write endpoint ('/__ds/due', vite.config.js ds-due-writer) so the edit
  // lands in the plan file immediately; on a static build nothing answers and
  // st.duePending records the exact file line for the author's commit
  // ([plan:<file>#<anchor>] trailer + tracker regen). Done/cancelled
  // sections render no control, so reaching here with one is a no-op guard.
  // Generation counter for due commits: rapid re-picks each bump dueGen, so
  // only the latest pick's async continuations may touch the freeze overlay
  // or commit state — stale confirmations are ignored.
  let dueGen = 0;
  // Per-file commit chains (see commitDue): serialized network order per
  // plan file so rapid re-picks can't land out of order.
  const dueFlights = {};
  const applyDue = (iso) => {
    const c = cur();
    const plan = c.plan, sprint = c.sprints[c.si];
    if (!plan || !sprint) return;
    if (/[✓✗]/.test(String(sprint.head || ''))) return;
    if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    const next = duePreviewEdit(sprint.body, sprint.head, iso || null);
    if (next !== sprint.body) {
      sprint.body = next;
      st.duePending = { file: plan.file, due: iso || null, line: iso ? `*Due: ${iso}*` : null };
      // Same-device persistence: production has no file writer (static 404),
      // so the pick is stored and re-applied at boot until the file carries it.
      try { saveDueOverride(plan.file, sprint.head, iso || null); } catch {}
    }
    // Optimistic save: the date above is already the UI — the git commit runs
    // in the background with a live inline status (publishing… → published ✓
    // or retry). Runs even when the preview is unchanged, so a retry after a
    // failed commit re-fires the pipeline instead of no-op'ing on identical
    // text.
    // [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-2]
    st.dueCommit = { file: plan.file, head: sprint.head, state: 'saving' };
    keepDuePop();
    commitDue(plan, sprint, iso || null);
  };
  // Bounded POST: a hung request becomes a failed attempt after 20s, never a
  // stuck state. One retry for network/timeout faults only — 4xx answers are
  // final (re-sending a rejected token fixes nothing).
  const postDue = async (url, payload) => {
    const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = c ? setTimeout(() => { try { c.abort(); } catch {} }, 20000) : null;
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        ...(c ? { signal: c.signal } : {}),
      });
    } finally { if (t) clearTimeout(t); }
  };
  // The detail repaint rebuilds the datepicker shell — restore an open picker
  // after paint so background commits never slam it shut. Dismissal stays
  // explicit (toggle, Esc, outside tap). Background restores never steal
  // focus; direct opens keep it.
  const keepDuePop = () => {
    let open = false;
    try { const p = root.querySelector('[data-due-pop]'); open = !!(p && !p.hidden); } catch {}
    try { doPaint(root); } catch {}
    if (open) {
      try { renderDueCal(false); } catch {}
      try { const p2 = root.querySelector('[data-due-pop]'); if (p2) p2.hidden = false; } catch {}
    }
  };
  const commitDue = (plan, sprint, iso) => {
    // Commit state for the due row (paint-detail reads ctx.dueCommit):
    // saving (set by applyDue) → saved (auto-dismissed) | needs-login |
    // failed. Nothing here ever opens the login gate — it opens only on an
    // explicit tap.
    // [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-2]
    const gen = ++dueGen;
    const progDetail = { file: plan.file, head: sprint.head, due: iso || null };
    // Head actually sent to /api/due — resolved against the live plans just
    // before the POST (below), so it is always canonical current text.
    // progDetail keeps the pick-time head so the progress card key still
    // matches every step/hide call in this flight.
    let commitHead = sprint.head;
    const failDue = (state, reason) => {
      if (gen !== dueGen) return;
      try { hideDueProgress(progDetail, 0); } catch {}
      st.dueCommit = { file: plan.file, head: commitHead, state, reason: reason || null };
      keepDuePop();
    };
    // Success is confirmed, not assumed: flash 'published ✓', then dismiss.
    // Gen + file/head guarded so a rapid re-pick never clears newer state.
    const markSaved = () => {
      if (gen !== dueGen) return;
      st.dueCommit = { file: plan.file, head: commitHead, state: 'saved' };
      keepDuePop();
      try {
        setTimeout(() => {
          try {
            if (gen === dueGen && st.dueCommit && st.dueCommit.state === 'saved'
              && st.dueCommit.file === plan.file && st.dueCommit.head === commitHead) {
              st.dueCommit = null;
              keepDuePop();
            }
          } catch {}
        }, 2500);
      } catch {}
    };
    // Read-back gate: 'published ✓' appears only after reading the painted
    // date back from the current plans and confirming it equals the pick
    // (or empty on clear). Anything else — stale paint, missing section,
    // unreadable plans — shows retry instead. Never assumed from the POST.
    const confirmSaved = (reader) => {
      if (gen !== dueGen) return;
      // Stamp our own commit time: the deploy self-update must not reload
      // this page for its own deploy while it is still building. Stamped
      // for every landed commit — even when the paint still needs a retry.
      try { localStorage.setItem('safepipe-last-due-commit', String(Date.now())); } catch {}
      let painted;
      try {
        painted = reader && typeof reader.readPaintedDue === 'function'
          ? reader.readPaintedDue(plan.file, commitHead)
          : undefined;
      } catch { painted = undefined; }
      if (confirmPublish(painted, iso || null) === 'saved') { markSaved(); return; }
      try { console.error('[due-commit] paint mismatch after publish', plan.file, commitHead); } catch {}
      failDue('failed', 'mismatch');
    };
    // Safety net: bounded fetches resolve every path, but 'publishing…'
    // must never stick if one somehow doesn't — fail visibly at 60s.
    try {
      setTimeout(() => {
        try {
          if (gen === dueGen && st.dueCommit && st.dueCommit.state === 'saving'
            && st.dueCommit.file === plan.file && st.dueCommit.head === commitHead) failDue('failed', 'timeout');
        } catch {}
      }, 60000);
    } catch {}
    // Narrate the background commit in the progress card (non-blocking).
    try { showDueProgress(progDetail); } catch {}
    if (typeof fetch !== 'function') return;
    // Per-file serialization: a rapid re-pick chains behind the in-flight
    // commit for the same file, so concurrent POSTs can't land out of order
    // (slow first pick overwriting a fast second pick = apparent revert).
    // UI guards stay gen-based — the superseded flight's response is still
    // ignored; only the network order is enforced. Other files run parallel.
    const flight = async () => {
      try {
        const r = await postDue('/__ds/due', { file: plan.file, head: sprint.head, due: iso || null });
        if (gen !== dueGen) return;
        if (r && r.ok) {
          st.duePending = null;
          // File now carries the value — record it as a confirmed override
          // and re-apply so the painted date matches the pick immediately
          // (the in-memory plans predate this write; the next rebuild
          // confirms the override against file text and self-drops it).
          try { saveDueOverride(plan.file, commitHead, iso || null, true); } catch {}
          let live0Mod = null;
          try {
            live0Mod = await import('./pages-changelog.js');
          } catch { live0Mod = null; }
          if (gen !== dueGen) return;
          try {
            if (live0Mod && typeof live0Mod.reapplyDueOverrides === 'function') {
              try { live0Mod.reapplyDueOverrides(root); } catch {}
            }
          } catch {}
          if (gen !== dueGen) return;
          // Override-painted (no server text applied): the card stops at
          // Published on git — 'live' is earned only by an applied read.
          try { setDueProgressStep(progDetail, 'committed'); } catch {}
          try { hideDueProgress(progDetail, 1800); } catch {}
          // 'published ✓' only after the painted date reads back equal.
          confirmSaved(live0Mod);
          return;
        }
      } catch {
        if (gen === dueGen) failDue('failed', 'offline');
        return;
      }
      // Static host (production): no file writer — commit through /api/due
      // (GitHub-backed). The local override stays until the server truth
      // lands, so the UI never flickers.
      // Send-time canonical head: the pick's closure head may predate a sync
      // rebuild (live refresh / applyServerFileText) or a rename — resolve
      // against the current plans so the server never 200s `unchanged`
      // (head-not-found) for a stale head. progDetail keeps the pick-time
      // head so the progress card key still matches. The module is imported
      // once and reused below (a block-scoped re-import would leave the
      // success path's helper reference undefined and silently skip paint).
      let liveMod = null;
      try {
        liveMod = await import('./pages-changelog.js');
      } catch { liveMod = null; }
      if (gen !== dueGen) return;
      try {
        if (liveMod && typeof liveMod.canonicalDueHead === 'function') {
          const h = liveMod.canonicalDueHead(plan.file, sprint.head);
          if (typeof h === 'string' && h) commitHead = h;
        }
      } catch {}
      if (gen !== dueGen) return;
      if (commitHead !== sprint.head && st.dueCommit && st.dueCommit.state === 'saving'
        && st.dueCommit.file === plan.file && st.dueCommit.head === sprint.head) {
        st.dueCommit = { file: plan.file, head: commitHead, state: 'saving' };
        keepDuePop();
      }
      let token = null;
      try { token = getSchedToken(); } catch {}
      if (!token) { failDue('needs-login'); return; }
      const payload = { token, file: plan.file, head: commitHead, due: iso || null };
      let r2 = null;
      try {
        r2 = await postDue('/api/due', payload);
      } catch (e1) {
        try { r2 = await postDue('/api/due', payload); }
        catch (e2) {
          if (gen === dueGen) {
            const timedOut = (e1 && e1.name === 'AbortError') || (e2 && e2.name === 'AbortError');
            failDue('failed', timedOut ? 'timeout' : 'offline');
          }
          return;
        }
      }
      if (gen !== dueGen) return;
      if (r2 && r2.ok) {
        let body = null;
        try { body = await r2.json(); } catch {}
        if (body && (body.unchanged || body.committed === false)) {
          // The server reports WHY it left the text alone (body.reason, e.g.
          // head-not-found with headPreview/fileLines for diagnostics). Only
          // the allowlisted code reaches the UI — everything else stays
          // generic, and raw server text is never displayed.
          const reason = dueFailureReason(body);
          try { console.error('[due-commit] publish left file unchanged', reason, plan.file); } catch {}
          failDue('failed', reason);
          return;
        }
        if (gen !== dueGen) return;
        try { setDueProgressStep(progDetail, 'committed'); } catch {}
        // Save the confirmed override BEFORE the rebuild: the rebuild's
        // applier confirms it against the server text (self-drops on match)
        // or paints it when the server text lacks the value — either way the
        // painted date equals the pick at the "published" moment, never stale.
        try { saveDueOverride(plan.file, commitHead, iso || null, true); } catch {}
        // Claim this value against lagged sync fetches: for the next 120s a
        // fetched file that predates our commit is held, never painted, so
        // the date can't revert to its previous value on CDN lag.
        try { saveDueConfirm({ file: plan.file, head: commitHead, due: iso || null }); } catch {}
        // Server truth wins: apply the committed file text directly — no
        // CDN wait, no confirm poll. Falls back to the painted preview when
        // the helper is unavailable.
        let applied = false;
        if (body && typeof body.content === 'string' && body.content) {
          try {
            if (gen !== dueGen) return;
            if (liveMod && typeof liveMod.applyServerFileText === 'function') {
              try { applied = liveMod.applyServerFileText(root, plan.file, body.content); } catch { applied = false; }
            }
          } catch {}
        }
        if (gen !== dueGen) return;
        if (!applied) {
          try {
            if (liveMod && typeof liveMod.reapplyDueOverrides === 'function') {
              try { liveMod.reapplyDueOverrides(root); } catch {}
            }
          } catch {}
        }
        if (gen !== dueGen) return;
        st.duePending = null;
        // The live step is earned only by an applied server-text read;
        // override-painted commits stop at Published on git.
        // The card parks at 'deploying' while the redeploy carries the commit
        // everywhere — the freeze (pending row state) remains, editing stays
        // allowed, and the toast only dismisses at 'live' (deploy flip) or
        // on failure (inline retry takes over). Never vanishes mid-cycle.
        try {
          const step = duePublishStep(applied);
          try { setDueProgressStep(progDetail, step); } catch {}
          if (step === 'deploying') {
            try { saveDuePending({ file: plan.file, head: commitHead, due: iso || null }); } catch {}
          } else {
            try { hideDueProgress(progDetail, 1800); } catch {}
          }
        } catch {}
        // 'published ✓' only after the painted date reads back equal.
        confirmSaved(liveMod);
        return;
      }
      if (r2 && !r2.ok && r2.status !== 401 && r2.status !== 403) {
        // Non-auth HTTP failure: log the server reason for diagnostics and
        // surface the status code inline so a retry report names the cause.
        let detail = '';
        try { detail = await r2.text(); } catch {}
        try { console.error('[due-commit] publish failed', r2.status, String(detail).slice(0, 300)); } catch {}
        failDue('failed', `http ${r2.status}`);
        return;
      }
      if (r2 && (r2.status === 401 || r2.status === 403)) {
        // Token rejected or pre-scope grant (needs public_repo): clear the
        // whole session so the badge never outlives the proof. The inline
        // sign-in affordance re-opens the gate on tap.
        try { clearSchedToken(); } catch {}
        try { clearSchedUser(); } catch {}
        failDue('needs-login');
        return;
      }
      failDue('failed', 'error');
    };
    try {
      const prev = dueFlights[plan.file] || null;
      dueFlights[plan.file] = (prev ? prev.catch(() => {}) : Promise.resolve()).then(flight, flight);
      // Never leave an unhandled rejection on the chain tail.
      try { dueFlights[plan.file].catch(() => {}); } catch {}
    } catch { try { flight(); } catch {} }
  };
  // Themed due datepicker: material-like month grid in Safepipe tokens
  // (surface card, accent select, mono cells). Sunday-first week.
  // Rendered into [data-due-pop] on open; nav re-renders in place.
  const DUE_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const dueToday = () => { const n = new Date(); return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`; };
  let dueView = ''; // YYYY-MM shown in the popup
  const renderDueCal = (focusIt = true) => {
    const pop = root.querySelector('[data-due-pop]');
    const btn = root.querySelector('[data-due-open]');
    if (!pop || !btn) return;
    const sel = (btn.dataset.due || '').trim();
    dueView = /^\d{4}-\d{2}$/.test(dueView) ? dueView : (sel || dueToday()).slice(0, 7);
    const [y, mo] = dueView.split('-').map(Number);
    const lead = new Date(y, mo - 1, 1).getDay();
    const days = new Date(y, mo, 0).getDate();
    const today = dueToday();
    let cells = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
      .map((d) => `<span class="ds-due-cal__dow" aria-hidden="true">${d}</span>`).join('');
    for (let i = 0; i < lead; i++) cells += '<span aria-hidden="true"></span>';
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${pad2(mo)}-${pad2(d)}`;
      const past = iso < today;
      cells += `<button class="ds-due-day${iso === sel ? ' is-sel' : ''}${iso === today ? ' is-today' : ''}${past ? ' is-past' : ''}"` +
        ` data-due-pick="${iso}"${iso === sel ? ' aria-pressed="true"' : ''}${past ? ' disabled aria-disabled="true"' : ''} aria-label="${iso}">${d}</button>`;
    }
    pop.innerHTML =
      `<div class="ds-due-cal__head"><button data-due-nav="-1" aria-label="Previous month">‹</button>` +
      `<b>${DUE_MON[mo - 1]} ${y}</b>` +
      `<button data-due-nav="1" aria-label="Next month">›</button></div>` +
      `<div class="ds-due-cal__grid">${cells}</div>` +
      `<div class="ds-due-cal__foot"><button data-due-clear>Clear</button></div>`;
    const focus = pop.querySelector('.is-sel') || pop.querySelector('.is-today');
    if (focus && focusIt !== false) focus.focus();
  };
  const onClick = (e) => {
    // Open datepicker popup: clicks outside it just dismiss it and continue
    // to normal handling below.
    const dp = root.querySelector('[data-due-pop]:not([hidden])');
    if (dp && !(e.target.closest && e.target.closest('[data-due-pop],[data-due-open]'))) dp.hidden = true;
    if (e.target.closest('[data-day-clear]')) { st.day = ''; st.sel = [0, 0]; doPaint(root); return; }
    // Filter dropdown toggle
    const tf = e.target.closest('[data-tag-filter]');
    if (tf) {
      const dd = root.querySelector('[data-tag-dropdown]');
      if (dd) { dd.hidden = !dd.hidden; tf.setAttribute('aria-expanded', String(!dd.hidden)); }
      return;
    }
    // Outside-dismiss: a click outside an open tag dropdown and outside its
    // button closes it (same idiom as the datepicker dismiss above).
    // [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]
    const openDd = root.querySelector('[data-tag-dropdown]:not([hidden])');
    if (openDd && !(e.target.closest && e.target.closest('[data-tag-dropdown],[data-tag-filter]'))) {
      openDd.hidden = true;
      const fb = root.querySelector('[data-tag-filter]');
      if (fb) fb.setAttribute('aria-expanded', 'false');
    }
    // Checkbox in filter dropdown
    const topt = e.target.closest('[data-tag-opt]');
    if (topt) {
      const t = topt.dataset.tagOpt;
      if (t) { st.active.has(t) ? st.active.delete(t) : st.active.add(t); }
      st.sel = [0, 0]; doPaint(root); return;
    }
    // Clear all filters
    if (e.target.closest('[data-tag-clear]')) {
      st.active = new Set(); st.day = ''; st.sel = [0, 0]; doPaint(root); return;
    }
    // Tags more expansion
    const moreBtn = e.target.closest('[data-tags-more]');
    if (moreBtn) {
      e.preventDefault(); e.stopPropagation();
      const idx = Number(moreBtn.dataset.tagsMore);
      const row = root.querySelectorAll('.ds-pick')[idx];
      if (row) {
        const tagsEl = row.querySelector('.ds-tags');
        if (tagsEl && !tagsEl.classList.contains('ds-tags-expanded')) {
          const c = cur();
          const p = c.list[idx];
          if (p) {
            tagsEl.innerHTML = esc(p.tags.join(' · '));
            tagsEl.classList.add('ds-tags-expanded');
          }
        }
      }
      return;
    }
    // Due scheduling: the themed popup owns picking (past days are disabled
    // — schedules only run today-forward); Clear removes the Due line.
    // Existing overdue Dues still display their flag, they just can't be
    // (re-)picked.
    if (e.target.closest('[data-due-clear]')) { applyDue(null); return; }
    const dopen = e.target.closest('[data-due-open]');
    if (dopen) {
      const pop = root.querySelector('[data-due-pop]');
      if (pop) {
        if (pop.hidden) { dueView = ''; renderDueCal(); pop.hidden = false; }
        else pop.hidden = true;
      }
      return;
    }
    const dnav = e.target.closest('[data-due-nav]');
    if (dnav) {
      const [y, mo] = (dueView || dueToday().slice(0, 7)).split('-').map(Number);
      const n = new Date(y, mo - 1 + Number(dnav.dataset.dueNav), 1);
      dueView = `${n.getFullYear()}-${pad2(n.getMonth() + 1)}`;
      renderDueCal();
      return;
    }
    const dpick = e.target.closest('[data-due-pick]');
    if (dpick) { applyDue(dpick.dataset.duePick); return; }
    // Commit-status retry: re-runs the full write pipeline (local writer,
    // else /api/due commit) for the date currently shown on the control.
    // needs-login re-opens the gate when there is still no token.
    const dretry = e.target.closest('[data-due-retry]');
    if (dretry) {
      const open = root.querySelector('[data-due-open]');
      const iso = open ? String(open.dataset.due || '').trim() : '';
      if (!open) return;
      if (dretry.dataset.dueRetry === 'login') { try { openScheduleGate(); } catch {} return; }
      applyDue(iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null);
      return;
    }
    const dd = e.target.closest('[data-day]');
    if (dd) { st.day = st.day === dd.dataset.day ? '' : dd.dataset.day;
      st.sel = [0, 0]; doPaint(root); return; }
    // Timeline tile carries .ds-chip for styling but is a view toggle, not a
    // tag filter — it must win over the chip branch below (closest matches
    // the button itself, so order is the only thing that saves it).
    const tv = e.target.closest('[data-view="timeline"]');
    if (tv) {
      st.view = st.view === 'timeline' ? 'list' : 'timeline';
      if (st.view === 'list') { st.tlSel = null; st.returnView = null; }
      hidePop(); doPaint(root); return;
    }
    const chip = e
      .target
      .closest('.ds-chip');
    if (chip) { const t = chip.dataset.tag;
      if (!t) { st.active = new Set();
        st.day = '';
      } else { st.active.has(t) ? st.active.delete(t) : st.active.add(t);
      } st.sel = [0,
        0]; doPaint(root); return; }
    if (e.target.closest('[data-tl-close]')) { closeTimeline(); return; }
    // Schedule-deadline link: leave the timeline and reveal the Due cell on
    // the calendar. Never sets the day filter (a future Due would empty the
    // list) — just scrolls the marked cell into view.
    const ddl = e.target.closest('[data-tl-due]');
    if (ddl && ddl.dataset.tlDue) {
      const iso = ddl.dataset.tlDue;
      hidePop(); closeTimeline();
      requestAnimationFrame(() => {
        const cell = root.querySelector(`[data-due-day="${iso}"]`);
        if (cell && cell.scrollIntoView) cell.scrollIntoView({ block: 'nearest', inline: 'center' });
      });
      return;
    }
    const bb = e.target.closest('[data-tl-bout]');
    if (bb) {
      const [f, i] = (bb.dataset.tlBout || '').split(':');
      openTlPlan(f, Number(i), false); return;
    }
    const gh = e.target.closest('[data-tl-ghost]');
    if (gh) { openTlPlan(gh.dataset.tlGhost, null, true); return; }
    const tl = e.target.closest('[data-tl-open]');
    if (tl) { openTlPlan(tl.dataset.tlOpen, null, false); return; }
    // Lane background click: the lane's first track jumps to the left edge —
    // instant (not smooth) so repeated clicks never race mid-animation.
    // Bar/ghost/lane-name clicks return above (they open the plan instead).
    const edge = e.target.closest('[data-tl-edge]');
    if (edge && st.view === 'timeline') {
      const row = edge.closest('[data-tl-row]');
      if (row) scrollRowIntoView(row, edge.dataset.tlEdge);
      return;
    }
    const lane = e.target.closest('.ds-tl-lane');
    if (lane && st.view === 'timeline') {
      const row = lane.closest('[data-tl-row]');
      if (row) scrollRowIntoView(row, 'auto');
      else {
        const sc = root.querySelector('.ds-tl-scroll');
        const first = lane.querySelector('[data-tl-bout],[data-tl-ghost]');
        if (sc && first) {
          const x = first.getBoundingClientRect().left - lane.getBoundingClientRect().left + sc.scrollLeft;
          sc.scrollTo({ left: Math.max(0, x - 14), behavior: 'auto' });
        }
      }
      return;
    }
    if (e.target.closest('[data-close]')
      || e.target.closest('[data-scrim]')) {
      if (e.target.closest('[data-scrim]') && !st.open && st.view === 'timeline') { closeTimeline(); return; }
      st.open = false;
      if (st.view !== 'timeline' && st.returnView !== 'timeline') st.stage = 'list';
      st.returnView = null; hidePop(); doPaint(root); return;
    }
    if (e.target.closest('[data-back]')) { st.stage = 'list'; doPaint(root); return; }
    const step = e.target.closest('[data-step]');
    if (step && !step.disabled) { const c = cur(); st.sel = [c.pi,
        Math.min(Math.max(c.si + Number(step.dataset.step), 0),
          c.sprints.length - 1)]; st.open = true; doPaint(root); return; }
    const b = e.target.closest('.ds-pick'); if (!b) return;
    const col = b.closest('[data-col]'), i = [...col.querySelectorAll('.ds-pick')].indexOf(b);
    if (col.dataset.col === 'plan') { st.sel = [i,
        st.sel[1]]; st.open = true; st.stage = 'tasks';
      // Pin the explicitly opened plan by file so its drawer survives
      // leaving the day filter; the filter keeps applying to lists only.
      try { const c = cur(); if (c.list[i]) st.openFile = c.list[i].file; } catch {} } else { st.sel = [st.sel[0],
        i]; st.stage = 'tasks'; }
    doPaint(root);
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const dp = root.querySelector('[data-due-pop]');
    if (dp && !dp.hidden) { dp.hidden = true; return; }
    const p = tlPop();
    if (p && !p.hidden) { hidePop(); return; }
    if (st.open) {
      st.open = false;
      if (st.view !== 'timeline' && st.returnView !== 'timeline') st.stage = 'list';
      st.returnView = null; doPaint(root); return;
    }
    if (st.view === 'timeline') { closeTimeline(); }
  };
  const move = (e) => {
    if (touchInput) return; // a tap's synthetic hover must not latch a tip/pop
    const bout = e.target.closest ? e.target.closest('[data-tl-bout]') : null;
    if (bout && st.view === 'timeline') {
      if (bout === popFor) return; // same bar: stay put so the deadline link is clickable
      const tip = root.querySelector('.ds-cursor-tip');
      if (tip) tip.hidden = true;
      showPop(bout, e.clientX, e.clientY); return;
    }
    // Moving onto the popover itself (reaching the deadline link) keeps it open.
    if (e.target.closest('[data-tl-pop]')) return;
    // Today line (dotted now) has its own time tooltip — it sits inside the
    // row/lane, so it must win over the row-bout popover or the time tip
    // never surfaces (row would claim the hover).
    const todayEl = e.target.closest ? e.target.closest('.ds-tl-today') : null;
    if (todayEl && todayEl.dataset.tip && st.view === 'timeline') {
      hidePop();
      const tip = root.querySelector('.ds-cursor-tip');
      if (!tip) return;
      const inner = tip.querySelector('.ds-cursor-tip__text') || tip;
      inner.textContent = todayEl.dataset.tip; tip.hidden = false;
      const pad = 14; let x = e.clientX + pad, y = e.clientY + pad;
      const r = tip.getBoundingClientRect();
      if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
      if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
      return;
    }
    // Row hover shows the row's own popover (first bout carries the data),
    // so empty lane space reads the same as the bar — stable while moving
    // across the row via the popFor guard.
    const row = e.target.closest ? e.target.closest('[data-tl-row]') : null;
    if (row && st.view === 'timeline') {
      const rep = row.querySelector('[data-tl-bout]');
      if (rep && rep.dataset.pop) {
        if (rep === popFor) return;
        const tip = root.querySelector('.ds-cursor-tip');
        if (tip) tip.hidden = true;
        showPop(rep, e.clientX, e.clientY); return;
      }
    }
    const el = e.target.closest('[data-tip]'), tip = root.querySelector('.ds-cursor-tip');
    hidePop();
    if (!tip) return;
    if (!el || !el.dataset.tip) { tip.hidden = true; return; }
    const inner = tip.querySelector('.ds-cursor-tip__text') || tip;
    inner.textContent = el.dataset.tip; tip.hidden = false;
    const pad = 14; let x = e.clientX + pad, y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  const onFocus = (e) => {
    const bout = e.target.closest ? e.target.closest('[data-tl-bout]') : null;
    if (bout && st.view === 'timeline') showPopFor(bout);
  };
  const onBlur = (e) => {
    const bout = e.target.closest ? e.target.closest('[data-tl-bout]') : null;
    if (bout) hidePop();
  };
  const hideTip = () => { const t = root.querySelector('.ds-cursor-tip'); if (t) t.hidden = true; };
  // Input-device tracking (see touchInput above): touch marks the device and
  // clears anything already showing; the next mouse/pen move or press clears
  // it again. touchstart/pointerdown both precede a tap's synthetic mousemove,
  // so `move` sees the flag for the whole gesture. Passive: nothing here
  // cancels the gesture, so scrolling stays native.
  const onPointer = (e) => {
    const t = e.pointerType;
    if (t === 'touch') { touchInput = true; hideTip(); hidePop(); }
    else if (t === 'mouse' || t === 'pen') touchInput = false;
  };
  const onTouchStart = () => { touchInput = true; hideTip(); hidePop(); };
  root.addEventListener('click', onClick); document.addEventListener('keydown', onKey);
  root.addEventListener('mousemove', move);
  root.addEventListener('pointerdown', onPointer);
  root.addEventListener('pointermove', onPointer);
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('focusin', onFocus);
  root.addEventListener('focusout', onBlur);
  document.addEventListener('mouseleave', hideTip);
  return () => {
    root.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey);
    root.removeEventListener('mousemove', move);
    root.removeEventListener('pointerdown', onPointer);
    root.removeEventListener('pointermove', onPointer);
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('focusin', onFocus);
    root.removeEventListener('focusout', onBlur);
    document.removeEventListener('mouseleave', hideTip); };
}
