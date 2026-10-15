// safepipe changelog — drawer + filter + timeline interactions · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
// Exports: bindChangelogEvents — click/key/hover wiring over shared state st
// Timeline (task 2): view toggle, track/bout/ghost open, bout popover, Esc chain.
// — Events —
export function bindChangelogEvents(root, st, helpers) {
  const { cur, doPaint } = helpers;
  const tlPop = () => root.querySelector('[data-tl-pop]');
  const hidePop = () => { const p = tlPop(); if (p) p.hidden = true; };
  const showPop = (el, x, y) => {
    const p = tlPop();
    if (!p || !el || !el.dataset.pop) { hidePop(); return; }
    p.textContent = el.dataset.pop; p.hidden = false;
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
  const closeTimeline = () => {
    st.view = 'list'; st.tlSel = null; st.returnView = null; hidePop(); doPaint(root);
  };
  const openTlPlan = (file, boutIdx, ghost) => {
    const c = cur();
    const li = c.list.findIndex((p) => p.file === file);
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
  const onClick = (e) => {
    if (e.target.closest('[data-day-clear]')) { st.day = ''; st.sel = [0, 0]; doPaint(root); return; }
    const dd = e.target.closest('[data-day]');
    if (dd) { st.day = st.day === dd.dataset.day ? '' : dd.dataset.day;
      st.sel = [0, 0]; doPaint(root); return; }
    const chip = e
      .target
      .closest('.ds-chip');
    if (chip) { const t = chip.dataset.tag;
      if (!t) { st.active = new Set();
        st.day = '';
      } else { st.active.has(t) ? st.active.delete(t) : st.active.add(t);
      } st.sel = [0,
        0]; doPaint(root); return; }
    const tv = e.target.closest('[data-view="timeline"]');
    if (tv) {
      st.view = st.view === 'timeline' ? 'list' : 'timeline';
      if (st.view === 'list') { st.tlSel = null; st.returnView = null; }
      hidePop(); doPaint(root); return;
    }
    if (e.target.closest('[data-tl-close]')) { closeTimeline(); return; }
    if (e.target.closest('[data-tl-overall]')) { st.tlSel = null; doPaint(root); return; }
    const tsort = e.target.closest('[data-tl-sort]');
    if (tsort) { st.tlSort = st.tlSort === 'next' ? '' : 'next'; doPaint(root); return; }
    const bb = e.target.closest('[data-tl-bout]');
    if (bb) {
      const [f, i] = (bb.dataset.tlBout || '').split(':');
      openTlPlan(f, Number(i), false); return;
    }
    const gh = e.target.closest('[data-tl-ghost]');
    if (gh) { openTlPlan(gh.dataset.tlGhost, null, true); return; }
    const tl = e.target.closest('[data-tl-open]');
    if (tl) { openTlPlan(tl.dataset.tlOpen, null, false); return; }
    if (e.target.closest('[data-close]')
      || e.target.closest('[data-scrim]')) {
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
    const p = tlPop();
    if (p && !p.hidden) { p.hidden = true; return; }
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
      const tip = root.querySelector('.ds-cursor-tip');
      if (tip) tip.hidden = true;
      showPop(bout, e.clientX, e.clientY); return;
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
