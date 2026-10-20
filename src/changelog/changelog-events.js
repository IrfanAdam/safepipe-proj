// safepipe changelog — drawer + filter + timeline interactions · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
// Exports: bindChangelogEvents — click/key/hover wiring over shared state st
// Timeline (task 2): view toggle, track/bout/ghost open, bout popover, Esc chain.
// — Events —
import { saveDueOverride, saveDueConfirm, saveDuePending, confirmPublish, headingOf, findHeadIndex, dueStuckHealed, normHead } from '../logic/due-overrides.js';
import { dueOf, split } from './changelog-parse.js';
import { getSchedToken, clearSchedToken, clearSchedUser } from '../logic/schedule-auth.js';
import { openScheduleGate } from './schedule-gate.js';
import { showDueProgress, setDueProgressStep, hideDueProgress, isSyncWatchActive } from './due-progress.js';
import { fetchSchedules } from './supabase-schedule.js';
// Eventual git sync (reconciliation trigger): the pick-time fire-and-forget
// POST /api/sync-due dies with a closed tab, so on boot and every foreground
// refetch each Supabase schedule row whose sync_state is missing or errored
// is silently re-fired. Logged-out readers never fire (no token), rows
// already ok/unchanged never refire, sections the toast's sync watch is
// already polling are skipped, and the toast is never touched (no progress
// UI for background heals — silent by construction).
export function staleSyncTargets(scheduleRows, syncRows) {
  const byKey = new Map();
  try {
    for (const r of syncRows || []) {
      if (!r || typeof r !== 'object') continue;
      const f = typeof r.plan_file === 'string' ? r.plan_file : '';
      const k = typeof r.section_key === 'string' ? r.section_key : '';
      if (!f || !k) continue;
      byKey.set(`${f}\0${k}`, r);
    }
  } catch { return []; }
  const out = [];
  try {
    for (const s of scheduleRows || []) {
      if (!s || typeof s !== 'object') continue;
      const f = typeof s.plan_file === 'string' ? s.plan_file : '';
      const k = typeof s.section_key === 'string' ? s.section_key : '';
      if (!f || !k) continue;
      const row = byKey.get(`${f}\0${k}`);
      if (!row) { out.push(s); continue; }
      if (row.status === 'error') out.push(s);
    }
  } catch {}
  return out;
}
// Silent-heal backoff, server parity (api/sync-due.js retryAfterMs: 5s·3^(n-1),
// capped 15m): a just-failed sync is re-fired at most on that budget, so a
// persistently failing section (e.g. a rejected PAT write → github-write-403)
// quiets instead of burning one GitHub write per foreground event. Rows
// without timing data stay eligible (previous behavior). Never throws, never
// touches progress UI.
export function healDueAfterMs(attempts) {
  return Math.min(15 * 60 * 1000, 5000 * (3 ** Math.max(0, Number(attempts || 1) - 1)));
}
export function healEligible(syncRow, nowMs) {
  try {
    if (!syncRow || typeof syncRow !== 'object') return true;
    const at = Date.parse(syncRow.updated_at);
    const n = Number(syncRow.attempts);
    if (!Number.isFinite(at) || !Number.isFinite(n) || n <= 0) return true;
    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    return now >= at + healDueAfterMs(n);
  } catch { return true; }
}
// Sections a heal fire is already covering (fire-and-forget: no settle to
// await, so the entry clears when the POST settles and the next heal pass
// re-checks sync_state for the verdict).
const healInFlight = new Set();
let reconcileWired = false;
// Silent reconciliation pass. Never throws, never touches progress UI.
// opts (all optional, for node probes): token, schedules (Map or array),
// syncByFile ({ [file]: syncRows }), fetchImpl, isWatched(row) → boolean.
export async function reconcileDueSync(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  try {
    let token = null;
    if (Object.prototype.hasOwnProperty.call(o, 'token')) {
      token = typeof o.token === 'string' && o.token ? o.token : null;
    } else {
      try { token = getSchedToken(); } catch { token = null; }
    }
    if (!token) return { checked: 0, healed: 0, skipped: 'logged-out' };
    const fetchImpl = typeof o.fetchImpl === 'function'
      ? o.fetchImpl
      : (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) return { checked: 0, healed: 0, skipped: 'no-fetch' };
    let sched = Object.prototype.hasOwnProperty.call(o, 'schedules') ? o.schedules : null;
    if (sched == null) {
      try { sched = await fetchSchedules(); } catch { sched = null; }
    }
    if (!sched) return { checked: 0, healed: 0, skipped: 'no-schedules' };
    const rows = [];
    try {
      if (sched instanceof Map) for (const r of sched.values()) rows.push(r);
      else if (Array.isArray(sched)) for (const r of sched) rows.push(r);
    } catch {}
    const byFile = new Map();
    for (const r of rows) {
      if (!r || typeof r.plan_file !== 'string' || !r.plan_file) continue;
      if (typeof r.section_key !== 'string' || !r.section_key) continue;
      if (!byFile.has(r.plan_file)) byFile.set(r.plan_file, []);
      byFile.get(r.plan_file).push(r);
    }
    if (!byFile.size) return { checked: 0, healed: 0, skipped: 'empty' };
    const customWatched = typeof o.isWatched === 'function' ? o.isWatched : null;
    const isBusy = (t) => {
      if (customWatched) {
        try { if (customWatched(t)) return true; } catch {}
      }
      try { if (isSyncWatchActive(t.plan_file, t.section_key)) return true; } catch {}
      return false;
    };
    let checked = 0, healed = 0, skippedWatch = 0, skippedBackoff = 0;
    for (const [file, list] of byFile) {
      let syncRows;
      if (o.syncByFile && typeof o.syncByFile === 'object'
        && Object.prototype.hasOwnProperty.call(o.syncByFile, file)) {
        syncRows = o.syncByFile[file];
      } else {
        try {
          const r = await fetchImpl(`/api/schedule?sync=${encodeURIComponent(file)}`, { cache: 'no-store' });
          if (!r || !r.ok) continue;
          const j = await r.json().catch(() => null);
          syncRows = Array.isArray(j) ? j : [];
        } catch { continue; }
      }
      const syncByKey = new Map();
      try {
        for (const r of syncRows || []) {
          if (!r || typeof r !== 'object') continue;
          if (typeof r.plan_file !== 'string' || typeof r.section_key !== 'string') continue;
          syncByKey.set(`${r.plan_file}\0${r.section_key}`, r);
        }
      } catch {}
      const targets = staleSyncTargets(list, syncRows);
      checked += list.length;
      for (const t of targets) {
        const hk = `${t.plan_file}\0${t.section_key}`;
        let busy = false;
        try { busy = healInFlight.has(hk) || isBusy(t); } catch { busy = false; }
        if (busy) { skippedWatch++; continue; }
        try {
          const sr = syncByKey.get(hk);
          if (sr && !healEligible(sr)) { skippedBackoff++; continue; }
        } catch {}
        healInFlight.add(hk);
        try {
          const p = fetchImpl('/api/sync-due', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan_file: t.plan_file, section_key: t.section_key, token }),
          });
          healed++;
          if (p && typeof p.then === 'function') {
            try {
              const done = () => { try { healInFlight.delete(hk); } catch {} };
              const q = p.then(done, done);
              if (q && typeof q.catch === 'function') q.catch(() => {});
            } catch { try { healInFlight.delete(hk); } catch {} }
          } else {
            try { healInFlight.delete(hk); } catch {}
          }
        } catch { try { healInFlight.delete(hk); } catch {} }
      }
    }
    return { checked, healed, skippedWatch, skippedBackoff };
  } catch {
    return { checked: 0, healed: 0, skipped: 'failed' };
  }
}
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
// DOM-anchored read-back for publish verification (exported for node probes):
// the Due currently painted in the open row for (file, head) — null when the
// row paints dateless, { found:false } when the row is absent (drawer closed,
// rebuilt away). This is the SAME source the visitor sees; the plans model is
// the fallback, never the primary — a landed write that painted correctly
// must verify, never downgrade on a torn model read. Never throws.
export function readDomPaintedDue(root, file, head) {
  try {
    const rows = root && root.querySelectorAll ? root.querySelectorAll('[data-due-row]') : [];
    for (const row of rows) {
      let f = null, h = null;
      try {
        f = row.getAttribute ? row.getAttribute('data-due-file') : null;
        h = row.getAttribute ? row.getAttribute('data-due-head') : null;
      } catch { continue; }
      if (f !== file || h !== head) continue;
      let dv = null, hasOpen = false;
      try {
        const open = row.querySelector ? row.querySelector('[data-due-open]') : null;
        if (open && open.getAttribute) { hasOpen = true; dv = open.getAttribute('data-due'); }
      } catch { hasOpen = false; }
      if (!hasOpen) continue;
      return { found: true, due: (dv == null || dv === '') ? null : dv };
    }
  } catch {}
  return { found: false, due: null };
}
// File-side Due for the lag-guard claim (exported for node probes): what the
// FILE text carries for head — never override paint. A later sync fetch
// carrying THIS value is lagged pre-commit bytes (hold); anything else is
// judged on its own. Returns undefined when unresolvable (caller keeps its
// own fallback); null means the file genuinely carries no Due.
export function fileSideDue(rawText, head) {
  try {
    const secs = split(String(rawText || ''));
    const sec = secs.find((s) => s && s.head === head);
    if (!sec) return undefined;
    return dueOf(sec);
  } catch { return undefined; }
}
export function bindChangelogEvents(root, st, helpers) {
  const { cur, doPaint } = helpers;
  // Stuck-mismatch heal: a landed write whose read-back raced a torn plans
  // state (rename/rebuild skew between paint and confirm) shows retry even
  // after convergence heals the painted date — nothing re-runs the verdict.
  // On every foreground heal (boot/focus/visible/online — the same hooks as
  // the sync reconciliation, never a timer loop), a failed/mismatch record
  // whose painted date now equals its pick flips to saved (auto-dismissed).
  // Only failed/mismatch records carrying their pick heal — offline,
  // timeout, http and login failures plus genuinely divergent paints keep
  // their retry. No network, no login impact, never throws.
  const healDueMismatch = async () => {
    try {
      const rec = st.dueCommit;
      if (!rec || rec.state !== 'failed' || rec.reason !== 'mismatch' || !('due' in rec)) return;
      let painted = null, seen = false;
      try {
        const d = readDomPaintedDue(root, rec.file, rec.head);
        if (d && d.found) { painted = d.due; seen = true; }
      } catch { seen = false; }
      if (!seen) {
        try {
          const liveMod = await import('./pages-changelog.js');
          if (!liveMod || typeof liveMod.readPaintedDue !== 'function') return;
          painted = liveMod.readPaintedDue(rec.file, rec.head);
          seen = true;
        } catch { return; }
      }
      if (!seen) return;
      if (!dueStuckHealed(rec, painted)) return;
      // A newer pick replaces the record — never overwrite a live flight.
      if (st.dueCommit !== rec) return;
      const flipped = { file: rec.file, head: rec.head, state: 'saved', due: rec.due ?? null };
      st.dueCommit = flipped;
      try { doPaint(root); } catch {}
      try {
        setTimeout(() => {
          try { if (st.dueCommit === flipped) { st.dueCommit = null; doPaint(root); } } catch {}
        }, 2500);
      } catch {}
    } catch {}
  };
  // Eventual-sync reconciliation: one silent heal pass on boot, plus heals
  // on every foreground refetch (focus / visibility / online — the same
  // hooks the live refresh uses, never a timer loop). Logged-out readers
  // never fire; the toast is never touched.
  try {
    const boot = reconcileDueSync();
    if (boot && typeof boot.catch === 'function') boot.catch(() => {});
    try {
      const hb = healDueMismatch();
      if (hb && typeof hb.catch === 'function') hb.catch(() => {});
    } catch {}
  } catch {}
  try {
    if (!reconcileWired && typeof window !== 'undefined'
      && typeof window.addEventListener === 'function') {
      reconcileWired = true;
      const heal = () => {
        try {
          const p = reconcileDueSync();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch {}
        try {
          const q = healDueMismatch();
          if (q && typeof q.catch === 'function') q.catch(() => {});
        } catch {}
      };
      try { window.addEventListener('focus', heal); } catch {}
      try {
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', () => {
            try { if (!document.hidden) heal(); } catch {}
          });
        }
      } catch {}
      try { window.addEventListener('online', heal); } catch {}
    }
  } catch {}
  // Mobile 2-level drawer nav (mirrors pages-changelog.js isMobile — defined
  // locally to avoid a circular import; the 720px breakpoint is shared).
  const isMobile = () => {
    try { return typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches; }
    catch { return false; }
  };
  // L2 → L1 (mobile only). Returns true when it consumed the gesture.
  const stepBackLevel = () => {
    if (st.open && isMobile() && st.mlevel === 2) { st.mlevel = 1; doPaint(root); return true; }
    return false;
  };
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
      // Timeline opens land on the detail (L2) with the bout selected.
      st.mlevel = 2;
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
  // Supersede controller for the latest flight: a re-pick aborts the
  // previous flight's hung POST so the new pick starts at once. Declared
  // here (module strict mode — no implicit globals).
  let dueFlightCtl = null;
  const applyDue = (iso) => {
    const c = cur();
    const plan = c.plan, sprint = c.sprints[c.si];
    if (!plan || !sprint) return;
    if (/[✓✗]/.test(String(sprint.head || ''))) return;
    if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    const next = duePreviewEdit(sprint.body, sprint.head, iso || null);
    // Pre-commit value for the lag-guard claim: what the FILE carries (never
    // override paint) — a later sync fetch carrying THIS value is lagged
    // pre-commit bytes (hold); any third value is another device's newer
    // truth (take, never hold). Painted-pre would mislabel lagged bytes as a
    // third value on stacked picks and clobber the new pick on arrival.
    let preDue;
    try { preDue = fileSideDue(plan.raw, sprint.head); } catch { preDue = undefined; }
    if (preDue === undefined) {
      try { preDue = dueOf(sprint) || null; } catch { preDue = null; }
    }
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
    commitDue(plan, sprint, iso || null, preDue);
  };
  // Bounded POST: a hung request becomes a failed attempt after 20s, never a
  // stuck state. One retry for network/timeout faults only — 4xx answers are
  // final (re-sending a rejected token fixes nothing).
  const postDue = async (url, payload, extSignal) => {
    const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = c ? setTimeout(() => { try { c.abort(); } catch {} }, 20000) : null;
    // Supersede link: a re-pick aborts the previous flight's controller, so
    // a hung POST on slow radio settles at once and the new pick's chained
    // flight starts now instead of waiting out the 20s budget (mobile stall).
    // The aborted flight's response stays gen-ignored; order is unchanged.
    const link = (c && extSignal && typeof extSignal.addEventListener === 'function')
      ? () => { try { c.abort(); } catch {} } : null;
    try {
      if (link) {
        if (extSignal.aborted) { try { c.abort(); } catch {} }
        else { try { extSignal.addEventListener('abort', link, { once: true }); } catch {} }
      }
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        ...(c ? { signal: c.signal } : {}),
      });
    } finally {
      if (t) clearTimeout(t);
      if (link) { try { extSignal.removeEventListener('abort', link); } catch {} }
    }
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
  // Explicit dismissal: picking a date (or clearing) closes the calendar —
  // the drawer stays open. Background paints never close it (keepDuePop);
  // only a pick decision does.
  const hideDuePop = () => {
    try { const p = root.querySelector('[data-due-pop]'); if (p) p.hidden = true; } catch {}
  };
  const commitDue = (plan, sprint, iso, preDue) => {
    // Commit state for the due row (paint-detail reads ctx.dueCommit):
    // saving (set by applyDue) → saved (auto-dismissed) | needs-login |
    // failed. Nothing here ever opens the login gate — it opens only on an
    // explicit tap.
    // [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-2]
    const gen = ++dueGen;
    // Supersede: settle any previous flight's hung POST now (its response is
    // gen-ignored) so this pick's chained flight starts immediately instead
    // of queueing behind a slow request on flaky radio.
    try { if (dueFlightCtl) dueFlightCtl.abort(); } catch {}
    try { dueFlightCtl = typeof AbortController !== 'undefined' ? new AbortController() : null; }
    catch { dueFlightCtl = null; }
    const flightSignal = dueFlightCtl ? dueFlightCtl.signal : null;
    const progDetail = { file: plan.file, head: sprint.head, due: iso || null };
    // Head actually sent to /api/schedule — resolved against the live plans just
    // before the POST (below), so it is always canonical current text.
    // progDetail keeps the pick-time head so the progress card key still
    // matches every step/hide call in this flight.
    let commitHead = sprint.head;
    const failDue = (state, reason) => {
      if (gen !== dueGen) return;
      try { hideDueProgress(progDetail, 0); } catch {}
      // The pick travels with the record so a later foreground heal can
      // verify convergence (failed/mismatch + paint now equals pick → saved)
      // without re-firing the pipeline. Consumers read state/reason only.
      st.dueCommit = { file: plan.file, head: commitHead, state, reason: reason || null, due: iso || null };
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
    // Read-back gate: 'published ✓' appears only after the pick reads back
    // equal from the painted UI (or empty on clear). Anything else — stale
    // paint, missing section, unreadable paint — shows retry instead. The
    // verdict is computed against the SAME source the visitor sees: the
    // freshly painted DOM row first, the in-memory plans as fallback (drawer
    // closed or the row rebuilt away) — never downgrade a landed write on a
    // torn model read. Genuinely divergent paint still fails 'mismatch'.
    const confirmSaved = (reader) => {
      if (gen !== dueGen) return;
      // Stamp our own commit time: the deploy self-update must not reload
      // this page for its own deploy while it is still building. Stamped
      // for every landed commit — even when the paint still needs a retry.
      try { localStorage.setItem('safepipe-last-due-commit', String(Date.now())); } catch {}
      const want = iso || null;
      let painted;
      let domHit = false;
      try {
        const d = readDomPaintedDue(root, plan.file, commitHead);
        if (d && d.found) { painted = d.due; domHit = true; }
      } catch { domHit = false; }
      if (!domHit) {
        try {
          painted = reader && typeof reader.readPaintedDue === 'function'
            ? reader.readPaintedDue(plan.file, commitHead)
            : undefined;
        } catch { painted = undefined; }
      }
      if (confirmPublish(painted, want) === 'saved') { markSaved(); return; }
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
        const r = await postDue('/__ds/due', { file: plan.file, head: sprint.head, due: iso || null }, flightSignal);
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
          // Dev-local write: no deploy cycle exists — the file write IS the
          // end of the lifecycle, so the toast completes immediately.
          try { setDueProgressStep(progDetail, 'live'); } catch {}
          try { hideDueProgress(progDetail, 1800); } catch {}
          // 'published ✓' only after the painted date reads back equal.
          confirmSaved(live0Mod);
          return;
        }
      } catch {
        if (gen === dueGen) failDue('failed', 'offline');
        return;
      }
      // Static host (production): no file writer — commit through /api/schedule
      // (Supabase). The local override stays until the server truth lands,
      // so the UI never flickers.
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
      // One pick = one idempotency key: the single retry re-sends the SAME
      // key so the server dedupes instead of bumping the version. A re-pick
      // mints a fresh key — a new intent, never a dedupe of the old one.
      // [plan:2026-10-18_172008-supabase-scheduling-migration.md#task-9]
      let idem = null;
      try {
        idem = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
          ? globalThis.crypto.randomUUID()
          : ('pick-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
      } catch { idem = 'pick-' + Date.now(); }
      const payload = { token, file: plan.file, head: commitHead, due: iso || null, idempotencyKey: idem };
      let r2 = null;
      try {
        r2 = await postDue('/api/schedule', payload, flightSignal);
      } catch (e1) {
        try { r2 = await postDue('/api/schedule', payload, flightSignal); }
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
        // /api/schedule answers { due, version, updated_at, section_key } —
        // live truth, no file text. The confirmed override below paints
        // immediately; the sha-poll + Supabase overlay converge the file
        // after the sync worker lands it (file convergence self-drops both).
        // [plan:2026-10-18_172008-supabase-scheduling-migration.md#task-9]
        // Canonical section_key first: the server resolves stale heads, and
        // both the toast's watch and the sync fire below must use the SAME
        // key, or the watch never matches its row (bare 'error' on a landed
        // sync). Extracted once from the write response, with a local
        // fallback: the server computes normHead(commitHead), so an
        // unparsed response still yields the exact row key — the fire below
        // and the watch above can never miss their row on a lost body.
        let sk = null;
        try { sk = await r2.clone().json().then((j) => (j && j.section_key) || null).catch(() => null); } catch {}
        const fireKey = (typeof sk === 'string' && sk) ? sk : normHead(commitHead);
        try { setDueProgressStep(progDetail, 'committed', fireKey ? { sectionKey: fireKey } : null); } catch {}
        // Save the confirmed override BEFORE the rebuild: the rebuild's
        // applier confirms it against the server text (self-drops on match)
        // or paints it when the server text lacks the value — either way the
        // painted date equals the pick at the "published" moment, never stale.
        try { saveDueOverride(plan.file, commitHead, iso || null, true); } catch {}
        // Claim this value against lagged sync fetches: for the next 120s a
        // fetched file that predates our commit is held, never painted, so
        // the date can't revert to its previous value on CDN lag.
        try { saveDueConfirm({ file: plan.file, head: commitHead, due: iso || null, pre: preDue || null }); } catch {}
        // No file text on this route: re-apply the stored overrides so the
        // confirmed pick paints immediately (the in-memory plans predate the
        // write; the rebuild confirms it and later self-drops on convergence).
        if (gen !== dueGen) return;
        try {
          if (liveMod && typeof liveMod.reapplyDueOverrides === 'function') {
            try { liveMod.reapplyDueOverrides(root); } catch {}
          }
        } catch {}
        if (gen !== dueGen) return;
        st.duePending = null;
        // The toast parks at 'Updating everywhere…' while the redeploy
        // carries the commit — the freeze (pending row state) remains,
        // editing stays allowed, and the toast only dismisses at 'live'
        // (deploy flip) or on failure (inline retry takes over). One state
        // at a time, never vanishes mid-cycle.
        try {
          try { setDueProgressStep(progDetail, 'deploying'); } catch {}
          try { saveDuePending({ file: plan.file, head: commitHead, due: iso || null }); } catch {}
        } catch {}
        // 'published ✓' only after the painted date reads back equal.
        confirmSaved(liveMod);
        // Writer-driven GitHub sync (pivot — no DB trigger needed): best
        // effort, never disturbs the saved UI. Failures land in sync_state
        // and surface via GET /api/schedule?sync=. Reuses the canonical key
        // above — same key the toast's watch is polling.
        try {
          if (fireKey && typeof fetch === 'function') {
            fetch('/api/sync-due', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan_file: plan.file, section_key: fireKey, token }),
            }).catch(() => {});
          }
        } catch {}
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
    // Incomplete-only toggle in filter dropdown (shares the plan-card seal)
    if (e.target.closest('[data-incomplete-opt]')) {
      st.incompleteOnly = !st.incompleteOnly;
      st.sel = [0, 0]; doPaint(root); return;
    }
    // Clear all filters
    if (e.target.closest('[data-tag-clear]')) {
      st.active = new Set(); st.incompleteOnly = false; st.day = ''; st.sel = [0, 0]; doPaint(root); return;
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
    if (e.target.closest('[data-due-clear]')) { applyDue(null); hideDuePop(); return; }
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
    if (dpick) { applyDue(dpick.dataset.duePick); hideDuePop(); return; }
    // Commit-status retry: re-runs the full write pipeline (local writer,
    // else /api/schedule commit) for the date currently shown on the control.
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
    // Mobile level back buttons (paint-detail renders [data-mback]): L2
    // '‹ Phases' steps back to the rail (L1); L1 '‹ All plans' closes the
    // drawer. Desktop never renders these, so it never reaches here.
    if (e.target.closest('[data-mback]')) {
      if (stepBackLevel()) return;
      st.open = false;
      if (st.view !== 'timeline' && st.returnView !== 'timeline') st.stage = 'list';
      st.returnView = null; hidePop(); doPaint(root); return;
    }
    if (e.target.closest('[data-close]')
      || e.target.closest('[data-scrim]')) {
      if (e.target.closest('[data-scrim]') && !st.open && st.view === 'timeline') { closeTimeline(); return; }
      // Mobile levels: ✕ / scrim at L2 steps back to the rail (L1); at L1
      // (or desktop) it closes the drawer as before.
      if (stepBackLevel()) return;
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
    if (col.dataset.col === 'plan') {
      // Mobile plan pick lands on L1 with NOTHING pre-selected (sel[1] = -1
      // → placeholder detail parked off-screen); desktop keeps sel[1].
      if (isMobile()) { st.sel = [i, -1]; st.mlevel = 1; }
      else st.sel = [i, st.sel[1]];
      st.open = true; st.stage = 'tasks';
      // Pin the explicitly opened plan by file so its drawer survives
      // leaving the day filter; the filter keeps applying to lists only.
      try { const c = cur(); if (c.list[i]) st.openFile = c.list[i].file; } catch {} } else { st.sel = [st.sel[0],
        i]; st.stage = 'tasks';
      // Mobile rail pick pushes L2 (detail full-screen); desktop unchanged.
      if (isMobile() && st.open) st.mlevel = 2; }
    doPaint(root);
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const dp = root.querySelector('[data-due-pop]');
    if (dp && !dp.hidden) { dp.hidden = true; return; }
    const p = tlPop();
    if (p && !p.hidden) { hidePop(); return; }
    if (st.open) {
      // Mobile Esc chain: L2 → L1 → close. Desktop closes at once, as before.
      if (stepBackLevel()) return;
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
