// safepipe changelog — drawer + filter + timeline interactions · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
// Exports: bindChangelogEvents — click/key/hover wiring over shared state st
// Timeline (task 2): view toggle, track/bout/ghost open, bout popover, Esc chain.
// — Events —
// Due scheduling (task 3): pure file-text edit — insert/replace/clear the
// single `*Due: YYYY-MM-DD*` line under the owning head, idempotently (first
// Due-shaped line wins, extras removed, never duplicated). Head not found →
// text unchanged. Exported for node probes; the browser handler applies the
// same edit to the live section body so the ghost preview recomputes live.
const DUE_SHAPE = /^\s*\*Due:\s*[^*\n]*\*\s*$/;
const escRe = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function dueEditText(raw, head, due) {
  const lines = String(raw || '').split('\n');
  const want = String(head || '').trim();
  const hi = lines.findIndex((ln) => new RegExp(`^#{2,3}\\s+${escRe(want)}\\s*$`).test(ln));
  if (hi < 0) return String(raw || '');
  const lvl = (lines[hi].match(/^#+/) || ['##'])[0].length;
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
  // Row scroll: 'l' brings the cluster's right edge in from the left, 'r'
  // the first track in from the right; 'auto' only moves when a track sits
  // outside the visible window (a no-op when the bar is already in view).
  // Instant, matching the lane-jump rule — repeated clicks never race.
  const scrollRowIntoView = (row, dir) => {
    const sc = root.querySelector('.ds-tl-scroll');
    if (!sc) return;
    const tracks = [...row.querySelectorAll('[data-tl-bout],[data-tl-ghost]')];
    if (!tracks.length) return;
    const vr = sc.getBoundingClientRect();
    const f = tracks[0].getBoundingClientRect(), l = tracks[tracks.length - 1].getBoundingClientRect();
    let x = null;
    if (dir === 'l' || (dir === 'auto' && l.right < vr.left)) {
      x = l.right - vr.left + sc.scrollLeft - sc.clientWidth + 14;
    } else if (dir === 'r' || (dir === 'auto' && f.left > vr.right)) {
      x = f.left - vr.left + sc.scrollLeft - 14;
    }
    if (x !== null) sc.scrollTo({ left: Math.max(0, x), behavior: 'auto' });
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
      st.open = true; st.stage = 'tasks'; st.returnView = 'timeline';
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
  const applyDue = (iso) => {
    const c = cur();
    const plan = c.plan, sprint = c.sprints[c.si];
    if (!plan || !sprint) return;
    if (/[✓✗]/.test(String(sprint.head || ''))) return;
    if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    const next = duePreviewEdit(sprint.body, sprint.head, iso || null);
    if (next === sprint.body) {
      st.duePending = null; return;
    }
    sprint.body = next;
    st.duePending = { file: plan.file, due: iso || null, line: iso ? `*Due: ${iso}*` : null };
    doPaint(root);
    if (typeof fetch === 'function') {
      fetch('/__ds/due', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: plan.file, head: sprint.head, due: iso || null }),
      }).then((r) => { if (r.ok) st.duePending = null; }).catch(() => {});
    }
  };
  // Themed due datepicker: material-like month grid in Safepipe tokens
  // (surface card, accent select, mono cells). Monday-first like the days
  // grid. Rendered into [data-due-pop] on open; nav re-renders in place.
  const DUE_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const dueToday = () => { const n = new Date(); return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`; };
  let dueView = ''; // YYYY-MM shown in the popup
  const renderDueCal = () => {
    const pop = root.querySelector('[data-due-pop]');
    const btn = root.querySelector('[data-due-open]');
    if (!pop || !btn) return;
    const sel = (btn.dataset.due || '').trim();
    dueView = /^\d{4}-\d{2}$/.test(dueView) ? dueView : (sel || dueToday()).slice(0, 7);
    const [y, mo] = dueView.split('-').map(Number);
    const lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
    const days = new Date(y, mo, 0).getDate();
    const today = dueToday();
    let cells = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
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
    if (focus) focus.focus();
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
        st.sel[1]]; st.open = true; st.stage = 'tasks'; } else { st.sel = [st.sel[0],
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
    const bout = e.target.closest ? e.target.closest('[data-tl-bout]') : null;
    if (bout && st.view === 'timeline') {
      if (bout === popFor) return; // same bar: stay put so the deadline link is clickable
      const tip = root.querySelector('.ds-cursor-tip');
      if (tip) tip.hidden = true;
      showPop(bout, e.clientX, e.clientY); return;
    }
    // Moving onto the popover itself (reaching the deadline link) keeps it open.
    if (e.target.closest('[data-tl-pop]')) return;
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
  root.addEventListener('click', onClick); document.addEventListener('keydown', onKey);
  root.addEventListener('mousemove', move);
  root.addEventListener('focusin', onFocus);
  root.addEventListener('focusout', onBlur);
  document.addEventListener('mouseleave', hideTip);
  return () => {
    root.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey);
    root.removeEventListener('mousemove', move);
    root.removeEventListener('focusin', onFocus);
    root.removeEventListener('focusout', onBlur);
    document.removeEventListener('mouseleave', hideTip); };
}
