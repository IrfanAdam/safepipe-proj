# Changelog timeline + scheduling Implementation Plan

**Goal:** Add a large Timeline entry point next to the changelog days grid that opens a Gantt-style tracks view (vertical + horizontal scroll) with one track per plan, continuous streak bars vs sporadic-day blocks, hover plan-description tips, bout popovers (commits/evals/tasks summary), click-to-open plan with close-back-to-timeline, two summary levels (overall plan vs bout-only), plus a date setter on incomplete phases/tasks whose deadlines render as ghost items for bird's-eye upcoming-work planning — then port all of it back into the `changelog-kit` skill (v0.4.0).

**Architecture:** Static manifest (`src/ds/plan-manifest.json` + `plan-history.json` via `scripts/plan-track.mjs`, unchanged shape) + pure timeline model (`src/changelog/changelog-timeline.js`, zero DOM) + one new view module (`src/changelog/changelog/timeline-paint.js`) + state-machine extension in `pages-changelog.js` / `changelog-events.js`. Due dates parse live from worktree plan markdown (like Tags) — no tracker/manifest shape change. Plans use `## Task|Phase|Step` / `### Task` headings; anchors are `task-N` / `phase-N` with digit-boundary matching.

**Tech Stack:** Vite 5 MPA, vanilla JS modules, `design-system/tokens.css` as the only visual source (page-local `--cl-*` vars bridged via `calc()` off `--sp-*`, no raw hex/px — prod/dev order-proof rule).

**Tags:** Tooling, Design System

---

## Task 1: Due contract + timeline model (pure, tested)

*Tags: Tooling*

**Objective:** Due-date convention plus a fully tested pure timeline model with zero renderer edits.

**Files:**
- Modify: `src/changelog/changelog-parse.js` — add `parseDue(body)`, `dueOf(section)`; Due line stripped at render like `{#anchor}`; `norm()` untouched (Due must never synthesize checkboxes).
- Create: `src/changelog/changelog-timeline.js` — pure, no DOM, today injected: `activeDatesOf`, `boutsOf`, `ghostOf`, `planSummary`, `boutSummary`, `MERGE_GAP`.
- Create: `tests/changelog-timeline.test.js` — node probes over real corpus + synthetic fixtures.

**Due contract (binding):**
- Syntax: `*Due: YYYY-MM-DD*` on its own line directly under a `## Phase|Task|Step` head OR a `### Task` head — whichever section level holds the work inside that plan (nearest level wins when both present).
- Honored ONLY when the section is incomplete (`isDone(state())==false` and head lacks `✓`/`✗`); done/cancelled sections ignore Due (never a ghost on shipped work).
- Invalid dates (malformed, month>12, day>31, year>2099) → null, never throw.
- History hash includes the Due line (rev bumps naturally on schedule edits — by design, document don't fight).

**Timeline model contract (do not rename):**
- `activeDatesOf(plan)`: sorted unique `plan.date ∪ commit.date (hits ∪ plan-attached) ∪ rev.date` from `history[file].date`.
- `boutsOf(dates, MERGE_GAP=3)`: gap-merge; run with all internal gaps ≤3d = `streak` (continuous bar start→end); singleton with no neighbor ≤3d = `sporadic` (own 1-day block). Bout = `{kind, start, end, dates[]}`.
- `ghostOf(plan, todayISO)`: earliest Due among incomplete sections; `{from: max(lastActive, today), to: due, overdue: due<today}`; done plans never ghost.
- `planSummary(plan)`: `{title, status d/t, commits N, revs N, evals N (gate fb blocks + rev notes), range, due, overdue}` reusing `buildState/state/hits/tipOf/descOf/parseGates` — no new counting logic.
- `boutSummary(plan, bout)`: same shape filtered to `bout.dates` only (commits/revs with date ∈ bout; tasks = sections with `hits ∩ bout ≠ ∅` + state line).
- Tips: `data-tip = clip(oneLine(descOf(firstIncompleteBody) || goal), 100)`; strip `**`, backticks, links, `{#anchors}`, collapse `\s+`; empty → tip node hidden.

**Steps:**
1. Implement `parseDue/dueOf` + tests: valid / invalid / done-ignored / cancelled-ignored / `###`-level Due / duplicate-line idempotency (0 Dues in current 13-plan corpus — no false positives).
2. Implement `changelog-timeline.js` + `tests/changelog-timeline.test.js`: streak vs sporadic on real corpus, ghost empty pre-Due, overdue fixture, `boutSummary` singleton == single-day items, tip strings contain no `\n`/`**`/`{#`.
3. Run `npm run build` — green, manifest/history timestamp-stable on second run.

**Verify:** node test suite green; probe prints per-plan bout lists for all 13 plans; `npm run build` green.

- REF GATE 1: pure pipeline green in node over the real corpus (no renderer edits), build green, preflight check clean ✓ PASSED.

### Task 1 ✓ done a755d5e

## Task 2: Timeline view — button, side panel, tracks, summaries, nav

*Tags: Design System, Tooling*

**Objective:** The visible timeline: large button, scrollable side panel, streak/sporadic/ghost tracks, hover tips, bout popovers, two summaries, timeline↔plan navigation.

**Files:**
- Modify: `src/changelog/pages-changelog.js` — `render()` wraps graph + `<button data-view="timeline">Timeline · N tracks</button>` in `ds-graph-row-wrap`; `st` gains `{view:'list'|'timeline', tlSel:{planFile,boutIdx}|null, returnView}`; `paint()` routes to `paintTimeline` when `view==='timeline'`.
- Modify: `src/changelog/changelog-events.js` — timeline open/close, track/bout/ghost clicks, popover focus/blur, Esc chain (plan-via-timeline closes back to timeline; timeline closes to list).
- Create: `src/changelog/changelog/timeline-paint.js` — `paintTimeline(root, ctx)` structure only.
- Create: `src/changelog/changelog-timeline.css` — `--cl-*` only; sticky label column + sticky date axis; `.ds-tl-streak/.ds-tl-bout/.ds-tl-ghost(.is-overdue)`; commit-density `lv1..4` reuses calendar sqrt scale.
- Modify: `changelog.html` — one `<link>` for the new stylesheet.
- Modify: `src/changelog/changelog/paint-detail.js` — bout-scoped `badges()`/`paintRevs()` reuse for the bout summary (no reimplemented grouping).

**Behavior contract:**
- Button: `ds-timeline-open` class (display font, card surface), count = `visiblePlans().length` under current tag/day filter, `aria-pressed` + `aria-label` mirror day buttons; toggles view without clearing filters.
- Panel: `aside ds-timeline` sibling of `ds-drawer`; header (title + range + `✕`), toolbar (overall/bout toggle + "What's next" nearest-Due-first sort), scroll region `overflow:auto` both axes; rows = visible plans 1:1 with cards (plan with no commits shows label + empty lane, never dropped); columns = `min(active, planDate)` → `max(today, latestDue)`.
- Tracks: label = plan name from the same source as cards (`nm.title || planSentence`); streak bout → continuous `.ds-tl-streak` bar; sporadic → own `.ds-tl-bout` 1-day block; ghost → `.ds-tl-ghost` dashed bar `last-active/today → due`, overdue adds `.is-overdue` via existing `--sp` warning bridge.
- Hover on label/bar → `data-tip` plan description via the single cursor-tip node. Focus/hover on bout → popover snippet `"{title} · {d/t} tasks · {C} commits · {R} revs · {range}"` + Due fragment; one popover at a time; Esc/blur dismisses; never `title=` attrs.
- Click track/bar/bout/label → opens the plan drawer; click ghost → opens the owning incomplete section; close (`✕`/scrim/Escape) returns to timeline when timeline launched it.
- Summaries: header shows **overall** (`planSummary`, default first track); selecting a bout swaps to **bout** (`boutSummary` — only that bout's items) with a "← overall" return chip.
- Deep links: `?view=timeline&plan=<file>&bout=<idx>` cold-loads through the same path as `?day=`/`?sha=`; day/tag filters keep applying underneath.
- CSS gate: `grep -rn -E '#[0-9a-fA-F]{3,8}|rgba?\(|[0-9]+px' src/changelog/*timeline*` shows 0 outside `var(`.

**Steps:**
1. Shell + button + panel CSS (1280/768/390px: button never pushes graph off-screen; panel scrolls both axes; labels/axis stick; no page-level horizontal overflow).
2. Tracks + ghosts + popover + summaries wiring.
3. State machine + deep links + Esc chain.

**Verify:** every plan with commits shows ≥1 bar; ghost absent until a Due is set (Task 3 proves presence); streak summary counts equal manual bout filter; sporadic summary lists exactly its day; list→timeline→plan→close lands on timeline; `?view=timeline` cold-load works.

- REF GATE 2 (visual): chromium + webkit screenshots of (a) button next to graph, (b) open timeline with bars, (c) hover tooltip, (d) bout popover + bout summary, (e) plan opened from track; zero page errors; `npm run build` green ✓ PASSED.

### Task 2 ✓ done ea83227

## Task 3: Scheduling — date setter, ghost reflection, upcoming view

*Tags: Tooling*

**Objective:** Authors set deadlines on incomplete work only; deadlines render as timeline ghosts + calendar future dots and power a nearest-Due "What's next" order.

**Files:**
- Modify: `src/changelog/changelog/paint-detail.js` — incomplete phase/task rows gain a `Due` control (`<input type="date">` + clear); complete/cancelled rows render no control (tip "shipped — Due n/a").
- Modify: `src/changelog/changelog-events.js` — Due change handler (insert/replace/clear the single `*Due: YYYY-MM-DD*` line under the owning head; commit with trailer; tracker regen).
- Modify: `src/changelog/changelog/graph.js` — future Due dates gain a ghost-dot marker class (distinct from commit `lv*`; reuse `is-future` + Due marker, no new colors).
- Modify: `src/changelog/changelog/timeline-paint.js` — "What's next" nearest-Due-first toggle + overdue-top cluster with count chip (render only; model from Task 1).

**Rules:**
- Write path is the worktree plan file `.hermes/plans/<file>.md`: set = insert after head/Tags line or replace existing Due line idempotently (never duplicate); clear = remove the line. Empty input clears. Past dates allowed, immediately flag overdue (no blocking).
- After write: `doPaint` recomputes `ghostOf` live for preview; author commits with `[plan:<file>#<anchor>]` trailer then tracker regen. `plan-track.mjs` needs NO change.
- Ghost preview requires no build; committed state verified via build hook.

**Steps:**
1. Drawer Due controls (incomplete-only) + file write/clear path.
2. Ghost reflection + "What's next" sort + overdue cluster + calendar future dots.
3. Commit a trial Due on one open task, screenshot ghost, then clear (or keep if owner wants it live — owner's call at gate).

**Verify:** set Due on open task → file diff shows exactly one Due line; done task offers no control; set Due +7d → ghost bar + calendar future dot appear; overdue Due → top cluster + overdue treatment; `npm run build` + second `plan-track` run diff-clean; preflight `--check` passes.

- REF GATE 3: end-to-end set→ghost→clear captured in screenshots; Due commits carry trailers; tracker 0 wip after regen ✓ PASSED.

### Task 3 ✓ done 1e89d6c

Note (post-ship fix): `###`-fallback plans (no `##` heads — norm() consumes the raw heading into checkbox items) made the live Due setter a silent no-op on 10/10 open sections of production-ready.md. Preview now edits the live body directly (`duePreviewEdit`); file commits still go through `dueEditText` on raw text (88/88). An enabled control always edits — node sweep 32/32 incomplete sections round-trip; live set→ghost→clear→0 proven on production-ready Task 1 in chromium + webkit.

## Task 4: Skill sync + ship

*Tags: Tooling*

**Objective:** Timeline + scheduling become part of the transferable skill; repo ships with docs accurate and build green.

**Files:**
- Modify: `.agents/skills/changelog-kit/SKILL.md` — bump `version: 0.4.0`: Due placement/incomplete-only/precedence rule; manifest explicitly unchanged (Due live-parsed; history hash covers it); link-layer additions (`changelog-timeline.js` fns + `MERGE_GAP` + signatures, do-not-rename); view roles (Timeline button + `ds-timeline` panel + track/bout/ghost classes + popover + two-summary rule + return-nav state machine); pitfalls (Due on done ignored; duplicate Due lines; ghost-without-Due impossible; `?view=timeline`; `--cl-*` token rule); verification (bars 1:1 with cards, streak vs sporadic, ghost on Due, popover counts, return-nav, screenshots). If harness ships newer upstream skill, prefer upstream and note version in commit.
- Modify: `docs/agent-skills.md` — one line: changelog-kit now covers timeline + scheduling.
- Modify (this file): append `### Task N ✓ done` + sha per task at its REF GATE; never invent shas.

**Steps:**
1. Skill edit + `grep -c "Due\|ghostOf\|boutsOf" .agents/skills/changelog-kit/SKILL.md` > 0 assertion.
2. Confirm `changelog.html` still mounts via `#cl-root` (no new mount) and host nav already links changelog (shipped-but-unlinked = fail per skill).
3. Full gate: `npm run build` green; second `plan-track` run timestamp-stable; preflight `--fix` then `--check` pass; triage `All tracked`; chromium + webkit screenshots attached as phase evidence.
4. Commit per task with `[plan:2026-10-15_120000-safepipe-changelog-timeline.md#task-N]` (braced anchors); close each task line with `✓ done` + sha.

**Verify:** SKILL.md diff shows version bump + new sections; full skill Verification checklist (old + new timeline items) ticked; `npm run build` green; 0 wip.

- REF GATE 4 (ship): build green, 0 wip, screenshots attached, skill v0.4.0 committed, this plan closed ✓ PASSED.

### Task 4 ✓ done c5e9946

---

## File map (no other files touched)

| Lane | Files |
|---|---|
| Pure | `src/changelog/changelog-timeline.js` (new), `src/changelog/changelog-parse.js` (+`parseDue`), `tests/changelog-timeline.test.js` (new) |
| Views | `src/changelog/changelog/timeline-paint.js` (new), `src/changelog/pages-changelog.js`, `src/changelog/changelog-events.js`, `src/changelog/changelog/paint-detail.js`, `src/changelog/changelog/graph.js` |
| Style | `src/changelog/changelog-timeline.css` (new), `changelog.html` (+1 link) |
| Skill/docs | `.agents/skills/changelog-kit/SKILL.md`, `docs/agent-skills.md` |
| Generated (never hand-edit) | `src/ds/plan-manifest.json`, `src/ds/plan-history.json` via build hook |

## Pitfalls carried forward (binding)

- Braced anchors always (`{#task-N}` form in trailers for N<10); digit-boundary `anchorHit`, never `includes`.
- `|` in subjects: rejoin with `slice(3).join('|')` (tracker already does — don't regress).
- Manifest merge-overwrite on shallow CI truncates history — keep merge logic untouched.
- Manifest-only refresh commits carry NO trailer (else perpetual 1-behind dirt).
- Feature commit first, regen, then refresh commit; never `--amend` the post-commit dirty manifest.
- `norm()` only synthesizes checkboxes from Task/Step/Phase-headed `###` subsections (Due lines + Risks/Notes pass through).
- Single cursor-tip node fed by `data-tip`; strip markdown before clipping; hide when empty.
- New stylesheet: `--cl-*` prefix only, `calc()` off `--sp-*`; never override `:root --sp-*` (prod order-flip).
- Detail renderer strips `<!-- -->`, `{#…}`, summary `|…` table blocks at parse top (Due lines join that strip list at render).

## Follow-up polish (owner steer, 2026-10-15) ✓ done {#follow-up}

1. Timeline panel opens like the plan panel: same right-drawer width (`--size-ds-drawer`) + same `ds-drawer-in` glide (`--dur-glide`, `--ease-signature`).
2. Bar click opens the one familiar plan panel — the timeline hides underneath (`st.open && returnView === 'timeline'`); its ✕/scrim/Esc lands back on the timeline with the bout still selected. Cold `?view=timeline&plan=&bout=` behaves the same.
3. Compact rows: sidebar label column + corner spacer gone; no per-row dates (axis only).
4. Plan name rides its longest bar (ghost bar / lane fallback); `40ch` spill cap.
5. Timeline entry is a large WHITE 7×7-cell tile inside the days grid after the last week (surface bg, hairline, `radius-md`); count + pressed state still sync from `doPaint` (text wraps centered). Note: `--cl-24` does not exist in the token scale (22→26) — sizes use `--cl-16/--cl-26`.
6. Bout popover: one stat per line incl. date range (`boutPopLines`; `boutPopText` stays the sumline form; `.ds-tl-pop` gains `pre-line`).
7. No in-timeline bout panel at all — the plan panel suffices: `summaryHTML` renders only the one-line overall sumline (bout state drives bar highlight + deep link only); dead `badges`/`paintRevs`/`parseGates` imports + `.ds-tl-items`/`.ds-tl-back` CSS removed. Bar→drawer→✕ lands straight back on the timeline.
8. Subagent batch (deleg_2b30f44e, 2 lanes): black scrim under the timeline + scrim-click closes it (pages-changelog/events); summary + What's-next/overdue row deleted — head straight to rows; day column ×1.6, streak 20px/bout 16px, 1-day bars min 2 cols; square bar corners (`radius-none`); label chip from bar edge, 20ch spill; daily `5 6 …` ticks + per-month bands; white popover with `C commits · R revs` one line; parent fix: chip wash covered the full bar (killed the darker left nub).
9. Timeline readability batch (2026-10-15): axis top-offset fixed — `.ds-tl-ticks` had zero height (absolute-only children), so day labels overflowed onto row 1; ticks now own `20px` height + padded axis. Day column `20→32px`, rows `36→48px`, bout `16→20px`, streak `20→26px`, all bars vertically centered; row hover wash; today line now 2px accent; grid pads to full prev/next months (`Sep→Nov` around Oct) with today auto-scrolled into view (rAF-deferred for WebKit); popover is structured — bold title, 2-line-clamped description from `data-tip`, muted smaller stats/date subtext.
10. Drawer offset + tile batch: `aside.ds-timeline` sat `8px` off the top — a generic `.ds-timeline` rule in changelog-drawer.css (in-drawer commit list) leaked `margin: 8px 0 0` through; fixed with `margin:0` on the aside (plan drawer `.ds-drawer` unaffected). Tile relabeled `All N tracks` (icon carries the timeline meaning). Bar labels fixed to uniform `20ch`; bars/rounded + color scale now match the calendar blobs (`radius-xs`, accent 30/50/75/100 lv); today column gets an accent wash + dotted muted-accent line.
11. Month-seam + lane batch: the "gap" was the Sep/Oct band-shading seam (ticks measure exactly 32px uniform) — bands now render only for months holding tracks (single `on` wash, full lane width; Oct only = 992px). Month-start tick shortened to `Oct` (killed the `1 Oct2` collision). Lane-background click smooth-scrolls the lane's first track to the left edge (bar clicks still open the plan).
12. Popover batch: stats subtext smaller (`10px` via `calc(micro − 2px)`); tasks line gains owning-phase count (`4 phases · 4/4 tasks` from new `boutSummary.phases`); fully-done bouts (`boutSummary.complete` via `isDone`) render the tasks line in accent (`data-popdone` → `.is-done`).
13. No-gap batch (supersedes the scoped-bands attempt in 11 — any month-boundary shade IS the gap): zero band elements emitted (bands CSS removed); track lanes get a uniform full-width `has-track` wash (13/13 rows, one computed bg) with a stronger hover; months differ only by the `Oct` tick. Lane click is now instant (`behavior:auto`) — verified exact (bar at 1152 → scroll 1138, no drawer opens); smooth-scroll racing was the erratic feel.
14. Full-width rows: block `.ds-tl-row`s sized to the viewport, so the wash + dividers stopped at the viewport edge (the pale highlight never covered the whole track column). Rows now carry the same explicit lane width as lanes (2912px measured); dividers/wash run uninterrupted behind the bars, no seam.
15. Deadline batch: popover Due text line removed — schedule deadline now sits right under the tasks line as an underlined link (`Schedule deadline · 26 Oct 2026`, accent on hover); no Due → muted `Done <date>` from new `boutSummary.done` (last active date), never a Due n/a. Drawer shipped-sections `Due n/a` line removed (dead `ds-is-na` CSS went with it). Deadline click closes the timeline and scrolls the marked Due cell into view on the calendar (never sets the day filter). Popover stays put per-bar + link is pointer-clickable (was `pointer-events:none`). Calendar themed: surface empties, uppercase month labels, accent today ring + hover/focus rings (selection stays ink).
16. Scope fractions: popover scope line is now `2/4 phases · 4/4 tasks` from new `boutSummary.phasesDone` (per-section `isDone`), rendered structurally (data-ph/data-tk) with accent on the done-count numerators only — whole-line `is-done` accent removed (`data-popdone` stays on bars for the solid-complete bar style).
17. Due under title: plan-drawer Due row moved from above the markdown body to directly under the section H1 (head line split off pre-parse; bodies without a head keep old order; shipped sections render no Due line at all).
18. Schedule picker: native date input + clear + hint scaffolding replaced by accent text trigger (`Schedule · 26 Oct 2026` / `Schedule when?`) opening a Safepipe-themed month popup (surface card, mono cells, accent select, accent today ring, Mo–Su like the days grid, month nav, Clear footer, Esc/outside-dismiss, same `applyDue` live edit + repaint).

19. Timeline surface batch: drawer panel now resets margin+padding so the in-drawer commit-list `.ds-timeline` rule (changelog-drawer.css) can no longer leak `padding-left:12px` onto the aside — head/axis/rows sit flush with the drawer's left edge; head-date scrub input removed (markup, CSS, `change` wiring); done bars drop the full accent for a muted accent (`color-mix` accent 60% × `neutral-5` ≈ #a494f3) and neutral bars darken one quiet step (`neutral-3` → 50% `neutral-5` mix ≈ #eaeaea); dead `lv*` bar rules deleted.
20. Title inset + softer done bars: the timeline head title now carries the `cl-16` left inset (matching the ✕'s `cl-16` from the right; the grid below stays flush); fully-done bars muted further, 60% → 45% accent × `neutral-5` (≈ `#b3a7ef`). All 13 bars verified down to two fills — done `#b3a7ef` / neutral `#eaeaea`.
21. Past lockout: picker days before today render muted + `disabled` (click is a no-op) — schedules only run today-forward. Existing overdue Dues keep their flag, they just can't be (re-)picked.

22. Coverage + quieter accent: every bar now paints its done share from the left — `--tl-done` inline per bar (phasesDone/phases among the bout's phases; e.g. 4/5 → 80%, 1/2 → 50%, fully done → 100%) as a hard-stop gradient from the muted accent (45% → 35% accent × `neutral-5` ≈ `#bdb4eb`) to the neutral (`#eaeaea`); `[data-popdone]` fill rules retired (the gradient covers 100%).
23. Lane density + softer done wash: `--cl-tl-row` 48→36px (bout padding 14→8px/side, streak 11→5px/side) and `--tl-bar-done` accent 35% → 30% (blob-lv1 parity) — verified rowH 36 live.

24. Mobile responsive pass (owner steer, 2026-10-17): phone widths ≤720px. Build rows stack id+title / date / state / tags at ≤640 (the query set columns but not rows — tags sat on the title's row, state on the date's); calendar cells 14→16px (max that keeps 16 weeks + DoW column inside 342px); drawer/timeline ✕ get 32px hit boxes and rail pick titles a 2-line clamp (were hard-cut mid-word); due-picker day cells 26→36px with ≥32px nav/Clear/sched hit boxes; header tightens ≤420px (✕ fell ~10px outside the card at 320); scroll chaining contained in the rail/task/timeline panes; first `.ds-month` label now starts on its month's own week (text-less lead-in spacer — the only desktop-visible delta is that one label shifting one week); touch taps no longer latch the hover tooltip / timeline popover (`touchInput` guard; desktop hover byte-identical). Verified: 320/390 rects + zero-overlap scans, desktop 1280 parity (cells 14px, tags col3/row1 38ch), build green.

- REF GATE (polish): chromium + webkit — white 7×7 tile in grid; 13 rows named on bars, no sidebar; popover 5 lines; bar→drawer-only→✕→timeline; zero page errors; build green.

### Follow-up ✓ done ead03a5

### Mobile pass ✓ done 21b8959
