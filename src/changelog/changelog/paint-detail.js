// safepipe changelog — rail + detail · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
import { hits, badges, unlinked } from '../changelog-links.js';
import { shortPhase as short, unitLabel, provenance, descOf, tipOf } from '../changelog-titles.js';
import { isDone, state, parseGates, dueOf, fmtDate, gateNOf, isCancelledHead } from '../changelog-parse.js';
import { sectionRaw, renderSection, anchorOwners, gateSuffix } from './raw-detail.js';
import { esc } from './esc.js';
import { paintRevs } from './paint-revs.js';
import { dueSyncRetryHTML } from '../due-progress.js';
// Gate verdict + rev-count suffix live in raw-detail.js (own-verdict per
// phase). Locked or gateless phases contribute no gate part.
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
  // First section per anchor owns its commits — a repeated anchor (prose head
  // claiming another phase's token) renders none, never a duplicate list.
  const dupAnchor = anchorOwners(sprints).dup;
  root.querySelector('[data-col="sprint"]').innerHTML = railHead + sprints.map((s, i) => {
    const hsS = dupAnchor.has(i) ? [] : hits(plan.file, s.body, plan.sprints.indexOf(s) === 0),
      has = hsS.length ? ' · ' + hsS.length + ' commit' + (hsS.length > 1 ? 's' : '') : '',
      frac = state(s.body),
      // Fallback when state is empty but tasks exist (e.g. raw ### tasks
      // present but norm checkboxes absent due to gating/parsing edge):
      // derive fraction from raw section's task heads so rail never goes
      // bare. Never invents for table-only Phase 2 (0 tasks).
      derivedFrac = (() => {
        if (frac) return frac;
        try {
          const raw = sectionRaw(plan.raw || '', s.head);
          if (!raw) return '';
          const lines = raw.split('\n').filter((l) => /^###\s+(Task|Step|Phase)\b/i.test(l.trim()));
          if (!lines.length) return '';
          const done = lines.filter((l) => /[✓✗]/.test(l)).length;
          return `${done}/${lines.length}`;
        } catch { return ''; }
      })(),
      dispFrac = derivedFrac || frac,
      ed = edited && edited(s) ? ' · edited' : '',
      cancelled = isCancelledHead(s.head);
    return [
      `<button class="ds-pick`,
      i === sel[1] && !atL1 ? ' on' : '',
      // Cancelled phases are resolved, never open — they read cancelled
      // even with open checkboxes inside.
      cancelled ? ' is-cancelled' : (isDone(dispFrac) ? '' : ' is-open'),
      `" data-tip="`,
      esc(tipOf(s.head, s.body, 100)),
      `"><span class="ds-row"><span class="ds-num">`,
      unitLabel(s.head, i),
      `</span><b>`,
      esc(short(s.head)),
      `</b></span><small>`,
      [(cancelled ? '<span class="ds-cancel-tag">✗ cancelled</span>' : dispFrac) + has + ed].filter(Boolean).join(' · '),
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
  const hs = dupAnchor.has(si) ? [] : hits(plan.file, sprint.body, plan.sprints.indexOf(sprint) === 0);
  // Gate ownership is by section number (`Task 3` → gate 3), never by
  // position — positional index misattributes verdicts on Task-headed
  // plans (gateNOf · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#follow-up]).
  const phaseN = gateNOf(sprint.head, si);
  const gates = parseGates(plan.raw || '');
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
  // Git sync never surfaces in the UI (Supabase is the source of truth; the
  // background worker carries the file to git silently). The row shows only
  // the save itself: saving → saved. No syncing state, no retry, no error.
  // Idle status slot: always rendered so the due row keeps a stable height
  // whether the commit state appears, clears, or swaps text. CSS holds it
  // at min-height via visibility — never display:none, never absent.
  const dueStatusIdle = `<span class="ds-due-status is-idle" data-due-status="idle" aria-hidden="true"></span>`;
  const dueStatusHTML = !dc || secShipped ? dueStatusIdle : dc === 'saving'
    ? `<span class="ds-due-status" data-due-status="saving">Saving…</span>`
    : dc === 'saved'
      ? `<span class="ds-due-status is-ok" data-due-status="saved">Saved ✓</span>`
      : dc === 'needs-login'
        ? `<button class="ds-due-status is-warn" data-due-retry="login" title="only on this device — sign in again">only on this device — sign in again</button>`
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
    // always the first flow element after the title INSIDE .ds-md. The head
    // comes from the raw chunk, so ghost-preview paints (Due ahead of the
    // head, see duePreviewEdit) split at the SAME title line as file-shaped
    // bodies — no position jump. When no heading exists at all the row stays
    // first (the only stable slot).
    // Body paints from the RAW section chunk (same md the sprints came
    // from), not the flattened norm() body — block structure (nested lists,
    // ordered steps, fences) survives. renderSection also owns the status
    // line: DONE iff the head carries ✓, else the gate tag alone (or
    // nothing when gateless). Fallback to the flattened body when raw text
    // is unavailable — same shape, degraded.
    (() => {
      // A duplicate anchor (a prose `## Phase 5 closeout note` claiming
      // `phase-5`) owns neither the phase's evals nor its verdict — it used to
      // repeat the gate badge and the eval rows under a second rail row while
      // anchorOwners suppressed only the commits.
      const dupSec = dupAnchor.has(si);
      const revsHTML = (dupSec ? '' : paintRevs(revs, { head: sprint.head, heads: plan.sprints.map((s) => s.head), gates, phaseN }))
        + (hs.length ? badges(hs) : '');
      const raw = sectionRaw(plan.raw || '', sprint.head) || String(sprint.body || '');
      const rendered = renderSection(raw, { gateSuffix: dupSec ? '' : gateSuffix(gates, phaseN) });
      // The status sits under the title, then a rule: every phase head
      // block scans the same (title / status / divider / body).
      const headRule = rendered.head && rendered.body ? '<hr class="ds-hr ds-head-rule">' : '';
      const mdHTML = rendered.head
        ? [rendered.head, headRule, dueHTML, rendered.body].join('')
        : [dueHTML, rendered.body].join('');
      return [`<div class="ds-md">`, mdHTML + revsHTML, `</div>`].join('');
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
