---
name: changelog-kit
description: Use when adding plan-linked changelog, calendar, drawer, timeline tracks, scheduling.
version: 0.4.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [changelog, traceability, git, vite, delegation]
    related_skills: [plan-traceability, subagent-fanout]
---

# Changelog Kit — plan-linked changelog, calendar, drawer

Style-agnostic transferable system. Builds plan-to-commit traceability plus three views (calendar heat graph, build list, two-pane detail panel) on any stack. No colors, spacing, or class names prescribed — only data contracts and module seams.

## When to Use

- New or existing project needs "what shipped, in order" with per-phase commit proof.
- Need calendar activity graph plus tag chips plus day filter plus build cards plus phase rail plus task detail.
- Porting the personal_website changelog elsewhere without its visual language.
- Don't use for: a single RELEASES.md file; GitHub Releases UI is enough.

## What It Builds (4 parts)

1. **Plan format** — markdown files are the source of truth; every phase renders.
2. **Tracker** — joins git-log trailers to phases; writes a static manifest JSON.
3. **Link layer** — pure hits/badges/unlinked functions over the manifest.
4. **Views** — calendar graph, filter chips, build cards, rail plus detail panel, triage block.

Runtime: tracker + preflight + backfill run on Node stdlib plus the `git` CLI only (no runtime deps). Theme lives one layer out: portable core is plan contract + tracker + pure parse/link + view roles; host shell/CSS/tokens are Lane D chrome.

## Data Contracts (do not rename shapes)

### Plan file

- Path: `<plansDir>/YYYY-MM-DD_HHMMSS-<slug>.md` (legacy `YYYY-MM-DD_<slug>.md` also parses).
- Preamble carries Goal, Architecture, Tech Stack, Tags lines.
- Phases: `## Phase N — <title> {#phase-N}` with optional `*Tags: X*` line under heading.
- Tasks: `### Task N: <name>` marked done or cancelled with reason blockquote.
- Close line under each phase: `*Shipped in <sha> · Tasks a–b · phase-N.*` (anchor verbatim).
- Hide marker (optional): `<!-- changelog: hide -->` after Tags — stays linked, not carded.
- Due date (scheduling, optional): `*Due: YYYY-MM-DD*` alone on its own line directly under a `## Phase|Task|Step` head (or `### Task` head — whichever level holds the work; nearest wins). Honored ONLY for incomplete sections; done/cancelled sections ignore it. Invalid dates → null, never throw. Due lines are scheduling metadata, stripped at render like `{#anchors}` (never synthesized into checkboxes by `norm()`). Manifest shape is UNCHANGED — Due is live-parsed from the worktree plan; the history hash covers the Due line so schedule edits rev-bump naturally.

### Commit trailer

- Subject line carries exactly one `[plan:<file>#<anchor>]`; anchor is a verbatim substring of exactly one phase body; braced form for N<10 (bare `#phase-1` collides with `#phase-10`).
- Pre-trailer history lives in the retro file; never rewrite history. Two shapes parse: array-form `[{sha, plan, anchor, note}]` (current) and legacy map-form `{links: {sha: {plan, anchor, note}}}`. Tracker reads both, writes array-form.
- Tracker parses subject only, never body.

### Manifest JSON

- Shape: generated, continuation, plans[], commits[{sha, full, date, time, subject, plan, anchor}], wip[].
- Commits sorted newest-first by date plus time; wip from git status over tracked paths (excluding the manifest itself).
- Tracker merges fresh log OVER previous manifest (dedupe by sha) — shallow CI clones must never truncate history.
- Commits touching only generated files are plumbing-excluded — define GENERATED as `design-system/changelog-manifest.json` plus `src/arch/atlas.json`/`arch-atlas.json`; filter via `git show --name-only` and drop commits where every file is in GENERATED.
- Git log must capture author time, not just date — `--date=short` silently yields date-only commits and every timeline row falls back to a dateless line. Use `--date=format:%Y-%m-%d|%H:%M` so `%ad` expands to `date|time`, destructure `[full, sha, date, time, ...rest]`, and rejoin the subject with `rest.join('|')` (never a fixed index) since subjects may contain `|` (e.g. `Cube|Preview`) or the trailer is truncated and the commit stays unlinked.
- Timestamp stability: if `plans`/`commits`/`wip` are identical to the previous manifest, preserve `prev.generated` or every rerun churns the timestamp and the repo never reaches diff-clean.
- Always write a placeholder manifest when git is unavailable so static imports never crash.

### Plan history JSON (iteration tracking)

- Shape: `{ <planFile>: [{ sha|null, date, hash, sections: [{ head, hash, state }] }] }`, oldest first; content hash is a shared sync fn (fnv1a, whitespace-collapsed) implemented once in the parse layer and imported by tracker, backfill, and views alike.
- Tracker appends a snapshot per plan whenever its hash is unseen — rides the existing build/predev hook, so iteration capture needs no author convention beyond building. Move-to-end (not drop+re-add) when the current hash already exists, preserving the entry's original sha/date provenance.
- Invariant: the last entry per plan is always the current worktree — views compare live sections against it.
- History file is generated: excluded from wip exactly like the manifest.
- Backfill script (`plan-backfill.mjs`) walks `git log --follow --reverse` per plan, rehashes each committed version, merges dedupe-by-hash — idempotent, rerunnable; recovers only committed snapshots, so history is thin when plans were tracked late and complete going forward.
- Views: cards show `rev <n> · <last-date>` when n>1; rail rows show an `edited` marker when the section hash differs across versions or the head is new.
- Per-phase scope: revision/eval panels take `scope.head`, resolve it to a canonical anchor (`revAnchor`), and filter diff parts to that anchor only — a phase detail never shows sibling-phase churn.
- Moved-phase migration: when phases move between plan files (see `references/plan-split.md`), history entries move with the phase (same section hashes, new file key, `movedFrom: {file, head}` provenance on the migrated snapshot). Pointers in the old file are dropped; the new file is the record. Never duplicate the phase in both files' histories.
- Evals threading: gate `· rev <date>` notes and `feedback|review|pass|retro|critique|rework`-headed blocks are first-class rows alongside hash diffs (`gateText` strips the `· rev` prefix and quote wrapping; `fbBlocksOf` collects headed bullet blocks capped at 10, overflow noted as `… N more in the plan`). Attribution is by cleaned-head match with token-overlap fallback (`fileFor`/`blockFor`, exact match wins at 100, overlap needs ≥2 shared tokens plus non-empty bullets).

### Link layer (pure, no DOM)

- `hits(file, text, isFirstPhase)`: commits where plan matches file AND (anchor ? digit-boundary `anchorHit(text, anchor)` : isFirstPhase). Bare anchors never use `includes` — `task-1` must not match `{#task-10}`.
- `badges(list)`: timeline grouped by date into Day groups newest-first — `<details class="ds-timeline-group" open><summary class="ds-timeline-date"><span class="ds-caret">‹›</span><span class="ds-day-num">Day N</span> · D Mon, YYYY</summary><div class="ds-timeline-items"><div class="ds-timeline-item"><a>sha</a> <span>subject</span><small>date time</small></div>…</div></details>` inside `<details class="ds-commits-panel ds-panel" open><summary>Commits · N</summary><div class="ds-timeline">…`. Day numbers derive from the FILTERED date list client-side (newest date = Day N, oldest = Day 1), never stored.
- `paintRevs(revs, scope)`: same Day-grouped `details` timeline for iteration history — `<details class="ds-evals ds-revs ds-panel" open><summary>Evals · N</summary><div class="ds-timeline">…`. Gate-eval rows (`ds-timeline-item--eval`, no timestamp) thread above their date's iteration rows (`ds-timeline-item--iter` with `date time` stamp); dates with no evals render plain iteration rows. Empty revs + empty gates render nothing.
- `unlinked(planTexts)`: commits with no plan, unknown plan, or anchor in no phase body; when no untracked commits, triage hides (wip alone does not count as Unlinked) — `xs` from `commits.filter(no plan)` only, never `concat(wip)`.
- Timeline model (pure, no DOM, do-not-rename): `activeDatesOf(plan)` → sorted unique plan/commit/rev dates; `boutsOf(dates, gap=MERGE_GAP)` → `{kind, start, end, dates[]}[]` where a run with all internal gaps ≤3d is `streak` (continuous bar) and a singleton with no neighbor ≤3d is `sporadic` (own 1-day block); `ghostOf(plan, todayISO)` → null or `{from: max(lastActive, today), to: due, overdue}` for the earliest Due among incomplete sections; `planSummary` / `boutSummary` → `{title, status, commits, revs, evals, range, due, overdue}` reusing the existing counters (no new counting logic); `MERGE_GAP = 3`. The model must not import the manifest (unloadable in node probes) — the view attaches per-section commits via hits.

### Parse helpers (pure, no DOM)

- `chunks(md)`: fence-aware split on `## ` headings (toggle inside fenced code blocks).
- `split(md)`: keep Phase entries (Task/Step-headed repos need the plan-shapes adapter — see `references/plan-shapes.md`); `norm(body)`: synthesize checkbox items from Task marks; pass native checkboxes through.
- `state(body)` gives `d/t`; `isDone(f)` means `d===t && t>0`; `buildState(phases)` aggregates.
- `parseMeta(file)` gives date/id/slug from filename; plus fmtDate/fmtTime/pDay/isoDay helpers.
- Tags: closed configurable set; explicit Tags lines beat keyword inference; fallback to first tag.
- Titles: card title from Goal first clause (cap ~76ch), else H1, else slug; rail/drawer show raw phase identity.

### View state machine

- `{ active:Set<tag>, day:''|date, sel:[planIdx, phaseIdx], open:bool, stage:'list'|'tasks' }`.
- Visible plans: tag-OR filter AND day filter (plan date OR any linked commit date).
- Visible phases: tag filter within plan, fallback to all.
- Sequence numbers derive from the FILTERED list client-side, never stored.

### View roles (structure, not style)

- Calendar: date-to-count map from commits; week columns Mon–Sun; dated cells are filter buttons with count-plus-date tip; selected day toggles.
- Chips: All(N) plus per-tag counts plus active day-clear chip; multi-select OR.
- Cards: one row per build (sequence plus title plus tags plus date/time/phase-count/progress line); click opens panel on task stage.
- Panel: two panes side-by-side (phase rail plus task detail) plus pinned description footer; detail renders markdown plus `badges(hits(...))` commits timeline plus `paintRevs(history[file], scope)` evals timeline (both Day-grouped `details` timelines); rail click switches phase in place (rev scope follows the open phase); close via button/scrim/Escape.
- Triage: global unlinked block rendered once, hidden when all tracked.
- Tooltip: single cursor-following node fed by data-tip attributes; never per-button spans. Style DS-adherent: `font-family: var(--font-mono)` `font-size: var(--text-micro)` `line-height: var(--font-leading-relaxed)` (not `1.5`), `color: var(--color-bg)` `background: var(--color-ink)` (via bridging `var(--text-primary)`/`var(--bg-primary)`), `padding: var(--space-8) var(--space-10)` `border-radius: var(--radius-xs)` `box-shadow: var(--shadow-sm)` `transition: opacity var(--motion-duration-sm) var(--motion-easing-standard)` `max-width: min(40ch,60vw)` or `var(--size-tooltip)` — verify `grep -rn -E '#[0-9a-fA-F]{3,8}|rgba?\(|[0-9]+px' src/pitch/pitch-changelog*` shows 0 outside `var(`.
- Timeline view: large `Timeline · N tracks` button beside the graph (count follows tag/day filters, toggles without clearing them); `aside` panel with header + range + close, overall/bout summary toggle, nearest-Due-first sort, both-axes scroll with sticky labels/axis; one row per visible plan 1:1 with cards (empty lanes kept, never dropped); streak bouts render continuous bars, sporadic single-day blocks, ghosts dashed bars with overdue treatment; hover uses the single cursor-tip node, bout focus shows one popover (title/tasks/commits/revs/range) with one-at-a-time + Esc dismissal, never `title=` attrs; track click opens the plan drawer, ghost click opens the owning section, close (`✕`/scrim/Escape) returns drawer→timeline→list; header shows overall summary, bout select swaps to bout summary with a return chip; deep links (`view`/`plan`/`bout` params) cold-load through the same path as day/sha links. State gains `{view, tlSel, returnView}` only — existing list/drawer markup untouched.
- Scheduling: incomplete rows gain an inline Due date control (input + clear); complete/cancelled rows render no control. Set = insert/replace the single Due line under the owning head idempotently; empty input removes it; past dates allowed and flag overdue. After write the ghost preview recomputes live (no build); calendar future Dues gain a ghost-dot marker reusing the future style. Graph paint-once guards must key on the live Due signature or preview-set dots never appear until reload.
- Gate verdict below the phase title (no rail, no stepper): in the phase panel head, the first `h2` (phase title) is followed by a `p.ds-status` line — `✓ DONE` (or `✓ done (date)` / `✗ cancelled`) with the gate suffix on the same line: `GATE PASSED` (passed + waiver), `GATE FAILED`, `GATE OPEN` (done but unreviewed), nothing when locked/gateless. A fully-done phase whose heading lacks the mark still gets its DONE line so the verdict has a line to sit on. Same mono micro treatment as DONE, token-only; probe hook `data-gate-state`. Reviewer + evidence live in the plan file, not on screen. Supersedes the retired stepper/popover and inline-after-DONE variants — do not reintroduce them.

## Procedure

0. Preflight first: run `templates/preflight.mjs` (default `--fix`) before any lane. It checks → auto-patches → re-verifies: plan trailer coverage, tracked-path coverage (every `git log` sha accounted for or deliberately out of scope), plan-shape survey (every plan yields sections via split or the plan-shapes adapter), manifest/retro/history wiring, build-hook wiring. Loud fail only when it cannot fix: `exit 1 PREFLIGHT FAIL:<reason>` with evidence. `--check` is CI-strict (no writes, fail on any drift).
1. Configure: plansDir, trackedPaths, manifestPath, retroFile, continuationId, tagSet, repoUrl. All five machine-editable values live in `// AUTOFIX:`-marked blocks in the tracker template — preflight patches the blocks, never hand-edits around them.
2. Tracker lane: adapt `templates/tracker.mjs` (TRACKED/GENERATED/RETRO/OUT/CONTINUATION defaults mirror the live `plan-track.mjs`: wide TRACKED, `src/ds/plan-manifest.json` + `src/ds/plan-history.json` GENERATED, array-form retro); add build plus predev hooks; run twice, assert second run is timestamp-stable. Wire plan-history snapshots into the same hook (shared `phash` import); run `plan-backfill.mjs` once for committed history, assert rerun adds 0.
3. Parse lane: copy pure helpers; unit-test fenced split, norm, state, tags, titles.
4. Views lane: implement calendar/cards/panel/chips/events against the contracts using host idioms (glob, fetch, or SSG).
5. Chrome lane: names/titles map, triage block, shell layout in host visual language.
6. Verify: full tag coverage, 0 wip after track, build green, every card times every rail phase, Escape/scrim close, day-plus-tag filters.

## Parallel Implementation Model (parent plus 4 lanes)

- One delegate call, 4 children, file-disjoint scopes; shared shell/manifest/index stay parent-only; children never run git or trackers. Parent runs preflight (`--fix`) before dispatch and `--check` after integration.
- Lane A tracker: script plus manifest plus retro file plus build hooks plus shallow-merge plus plumbing exclusions.
- Lane B parse: chunks/split/norm/state plus format plus tags plus titles plus tests.
- Lane C views: calendar plus cards plus rail/detail plus chips plus events plus tooltip plus triage.
- Lane D chrome: shell markup, names JSON plus gate script, responsive behavior, docs page.
- Parent pre-wires seams first (stub modules, mount points, guarded hooks) so lanes self-activate; then integrates, gates, commits per phase, closes plan. See `references/parallel-lanes.md`.

## Pitfalls

- Trailer in body not subject means unlinked; two trailers in one subject means second ignored; a `|` in the subject splits a naive `split('|')` and truncates the trailer — always rejoin with `slice(3).join('|')`.
- Bare `#phase-1` matches `#phase-10` bodies — always cite braced form `{#phase-N}`.
- Hard-coded plan imports break the N+1th plan — glob the plan dir.
- Overwriting (not merging) manifest on shallow CI truncates history.
- Commits touching only GENERATED files look like DS commits but must be plumbing-excluded, or `Untracked · 62` never clears and `All tracked` never appears.
- Manifest-only refresh commits must carry NO trailer — the GENERATED exclusion only drops plan-less commits, so a trailered manifest-only sync is kept as a linked entry and every post-commit regen adds one more entry: perpetual 1-behind dirt with `git status` never empty. Commit the refresh untrailered (e.g. `chore(ds): sync plan manifest (plumbing — manifest-only, auto-excluded)`) and the next run excludes it as plumbing and reports clean.
- A dirty manifest's wip is a generation-time snapshot, not live state — commits landed since generation make it stale (it lists files already committed). Always re-run the tracker and cross-check wip against live `git status` before mapping or committing; never map stale wip entries to plans.
- Second tracker run must be timestamp-stable — preserve `prev.generated` when `plans`/`commits`/`wip` are identical or the repo never reaches diff-clean.
- Click index from parent children shifts on extra nodes — index within pick list scoped to its column.
- Badge list declared after the template that uses it is a runtime crash on first open.
- Manifest committed inside the feature commit bakes stale wip — feature commit first, regenerate, then refresh commit. With a `post-commit: node scripts/ds-track.mjs` hook the manifest is auto-regenerated after every commit (leaving a dirty `M` diff); never `git commit --amend` to fold it — the hook's `prev.commits` merge retains the old sha as a ghost. Recover with `git restore --staged <manifest>; git restore <manifest>; node scripts/ds-track.mjs` then re-stage and recommit, and treat `graphData*.js` `META.generatedAt` timestamp-only bumps the same as `manifest.generated` churn (discard if only `generatedAt` changed).
- `src/js/mechanics/graphData*.js` churn is timestamp-only unless `NODES`/`EDGES`/`GROUPS` changed — verify with `git diff -U0 src/js/mechanics/graphData*.js | grep -E 'NODES|EDGES|GROUPS'`; if only `generatedAt` shows, `git restore` the four files and skip the chore.
- Timeline grouping: `badges(list)` and `paintRevs(revs, scope)` must group by date into Day-grouped `details`/`summary` groups newest-first (see Link layer) — emitting a flat `<p><br>` list or bare date `<div>`s loses the Day labels and the eval threading never forms; iterate sorted newest-first, emit one `<details class="ds-timeline-group" open>` per date with `Day N` in the summary.
- Triage wip leak: `unlinked()` must filter `commits.filter(no plan)` only and hide the block when untracked length is 0 (`if (!xs.length) return all-tracked`); never `concat(wip)` — wip alone must not count as Unlinked or `All tracked` never appears despite 0 untracked commits.
- Dev/prod CSS order split: Vite bundles page `<link>` stylesheets into hashed chunks whose order can differ from dev source order — never override `:root` custom properties across stylesheets (page file redefining tokens' `--space-N` silently loses in prod when tokens chunk loads last). Give page-local vars a unique prefix (`--cl-N`) so rendering is order-proof; when the host token scale lacks odd steps, derive them with `calc()` off the base spacing token instead of raw px so the zero-raw-values gate stays green.
- Phantom checkboxes: `norm()` must only synthesize `- [ ]` items from task-headed `###` subsections; non-task subsections (Risks, Notes) pass through verbatim or a shipped plan renders N-1/N with a bogus open item.
- Tracker blindness: a narrow tracked-path list makes commits invisible (worse than triage — they never enter the manifest). After wiring the tracker, diff `git log` shas against manifest shas; every leftover must be deliberate hygiene outside scope, else widen the paths and retro-map pre-trailer history.
- Porcelain prefixes vary in width: never fixed-slice `git status --short` lines (`slice(3)` eats a path char on short forms) — strip status columns (`slice(2).trimStart()`) so a path char can never be eaten.
- History hash drift: the snapshot hash fn must be ONE shared implementation across tracker/backfill/views — two copies (e.g. sha1 in node, ad-hoc in browser) silently diverge and every section reads MISMATCH against its own snapshot.
- History recency illusion: backfill recovers only committed plan versions — plans added to git late show 1 revision even after heavy iteration. Say so in the plan close; never claim full provenance before the tracking commit.
- Raw markdown in data-tip attributes: description text carries newlines, `**bold**`, backticks, links, and `{#anchors}` that leak into the attribute and render as multi-line or truncated-plus-sliver tooltips. Collapse all tip text to single-line plain text (strip markup, `\s+` → space) before clipping, strip a leading `Objective:` label so the tip shows content only, and hide the node when the tip is empty, or the clamp boundary cuts mid-token and the label wastes a line.
- Tooltip line-clamp sliver: `display:-webkit-box` + `-webkit-line-clamp:3`/`line-clamp:3` on the tooltip box itself plus a tight `max-height: calc(3lh + padding - 6px)` hides the ~20% 4th-line peek from fractional `line-height` (1.6×12px=19.2px) but shaves 6px off the bottom padding so edges look uneven. Clip the **inner text container** instead: outer `.ds-cursor-tip` keeps even padding (`var(--cl-8) var(--cl-10)`, `line-height:1.5` for integer 18px lines, `overflow:hidden`, `contain:paint`) and inner `.ds-cursor-tip__text` carries the clamp (`display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; line-clamp:3; overflow:hidden`). Outer height becomes `3lh + vertical padding` (70px) with `scrollHeight > clientHeight` proving the 4th line is hidden inside, not by shaving the box. Wire it as `<span class="ds-cursor-tip" hidden><span class="ds-cursor-tip__text"></span></span>` and set text on the inner node; keep `[hidden]{display:none !important}`.
- Fixing the wrong surface: changelog has three distinct render paths (cards/list, rail, detail drawer) with separate CSS/JS — a `{#anchor}` or tooltip overflow that persists after a drawer-only patch means the bug lives in the changelog list path (`changelog-cards.css` / `changelog-titles.js` / `paint-plan.js`), not `paint-detail.js` / `changelog-drawer.css`. Verify the target by inspecting the live panel that actually shows the artifact (browser harness `querySelector` + `capture_screenshot`) before patching, and share a harness screenshot of the exact record (`plan · task` id) as proof when the user says "still seeing it" — text assertions alone do not prove a visual clamp.
- Drawer density tuning: when detail text reads oversized and the panel feels narrow, shrink body by exactly 1px via `calc(token - 1px)` plus tighten prose leading one step, widen the drawer (viewport share plus max token together) and narrow the rail share so the gain lands in the detail pane — raw px breaks the zero-raw-values gate, so every size stays a `calc()` off a token.
- Anchor metadata never renders: `split()` appends `{#anchor}` to the body for `hits()` matching and plans carry `<!-- {#...} -->` comments — strip all three (HTML comments, full-line `{#...}`, inline `{#...}`) at the top of the detail markdown parse before escaping, and strip the same tokens in `descOf` before picking the rail-foot description, or every task detail grows a phantom trailing anchor line and the rail foot leaks `<!-- {#phase-N} -->`.
- Summary tables are not detail content: phase bodies contain a `| # | Task | Done when |` overview table whose rows are already rendered as checkbox items — drop any blank-line block whose first non-space char is `|` before paragraph/list wrapping, and make `flushP` guard on `trim()` so an anchor-only block never emits `<p> </p>`.
- Detail lists stay block-local: split escaped markdown on blank lines and wrap only consecutive `- ` runs in `<ul>` — one dot-all `<li>.*</li>` regex spans paragraph boundaries and swallows intervening prose into a single list, which browsers error-recover as misaligned wrapped lines. Probe it by extracting the renderer from the view module and feeding every real `split()` body, asserting no `<p>`/`<h>` opens inside `<ul>`, no `|` table leaks, and all tags balance. Extend the same probe with the legibility invariants — no inline `✓ done —` or cancelled span survives, no raw `**Label:**` segment marker survives, `dl`/`dt`/`dd` counts balance — and reconcile per-section, since prose mentions of `✓ done` (backticked instructions, wrap-up notes) legitimately stay inline and break any global flag-equality assert. Extract the parser by slicing the module source to a known textual boundary (the following `import` line), never by brace-counting to the block end — regex literals inside the module contain braces that corrupt depth tracking.
- Rail keeps plan context: prepend a tiny mono micro uppercase header with plan id plus title (fallback provenance) above the rail picks, single-line ellipsized with a hairline below, styled `color: var(--sp-text-primary)` `font-weight: 600` (not muted/secondary) — a rail of bare Task/Phase rows without its plan name reads as orphaned tasks.
- Detail task legibility: the inline `✓ done —` / `✗ cancelled —` flag duplicates the checkbox — strip it in the detail renderer and re-emit status ONLY where it distinguishes (cancelled items, whose box is checked too, and headings carrying a trailing mark, which have no checkbox) — never a DONE line next to a checked box, which reads as redundant; flow the lead `**Label:**` field (Objective) inline after the bold title and render remaining labels (Files, Verify, Accuracy…) as compact inline-prefix rows, not stacked cards; keep the label-to-content gap to a single space (label tracking plus a margin plus literal inter-tag whitespace stacks into a visibly wide gap); put a divider between the markdown body and the commit timeline. Do this in the detail renderer only — `norm()` output feeds section hashes, state counts, and anchor matching, so restructuring there churns plan history and breaks matching.
- New panel class vs shipped content classes: a new view must never reuse a class already in the DOM for another purpose — a `.timeline`-style panel rule (`position:fixed`, `display:flex`) silently restyles every shipped content node carrying that class (evals timelines ripped out of flow into a viewport overlay that swallows clicks; zero console errors, so tests stay green while the page is dead). Scope panel geometry to the mount element (`aside.timeline`, `[data-timeline]`) and keep content classes on a distinct prefix; verify post-landing with per-class rects plus `elementFromPoint` on every interactive control, not just screenshots.
- Due pitfalls: Due on a done/cancelled section is ignored (never a ghost on shipped work); duplicate Due lines collapse to the first on write; ghost-without-Due is impossible by construction (`ghostOf` null without Due); REF GATE lines containing the substring `FAIL` parse as gate-failed — phrase criteria without it.
- Timeline deep links (`view`/`plan`/`bout`) must route through the same cold-load path as day/sha links, and new stylesheets stay `--cl-*`-prefixed `calc()`-off-token (never override host `:root` vars) or dev/prod chunk order flips the layout.

## Audit (when triage shows many unlinked)

- Run `git log -- <DS paths>` vs `manifest.commits` with `plan==null`; categorize plumbing (only GENERATED) vs meaningful. For meaningful, use semantic (subject keywords vs phase title/tags/tasks) + asymmetric timeline (a commit days older than a plan belongs to the plan live at its date, never to a future plan; same-day commits hours before a plan file may be its direct groundwork) to propose retro entries in the tracker's retroFile as `{plan, anchor: "{#phase-N}", note}`; explicit `Phase N Task M` subjects are HIGH confidence. Audit `git stash list` too — stashed files are invisible to tracker wip; map them, then either pop and commit with a trailer in the owning session or leave deliberately stashed and note why. Write `.hermes/audit-YYYY-MM-DD.md` with the table, apply retro, add GENERATED plumbing filter, re-run tracker twice and assert 0 unlinked.

## Verification

- [ ] New plan file appears with zero renderer edits.
- [ ] Tracker: linked count plus 0 wip; rerun is diff-clean (timestamp preserved) and handles `|` in subjects.
- [ ] Plumbing commits touching only GENERATED files are excluded; triage shows 0 untracked commits (wip only).
- [ ] Phase with commits shows Day-grouped commits timeline; phase detail shows evals timeline (gate `· rev` notes + feedback blocks threaded above iteration rows) scoped to the open phase; without shows none; triage hides when untracked 0 (wip alone hidden).
- [ ] Calendar day filters cards; chips OR-filter; sequence renumbers on filter; day blobs use CRM radius token `var(--radius-xs)` (4px, not square, not circle) and violet tints.
- [ ] Every card times every rail phase opens correct detail; close paths work; changelog is `changelog.html` with `✕` close like pitch (no extra header nav links) and uses CRM tokens/foundations, not the source project's palette.
- [ ] Prod/dev parity: `vite build` then `grep -c "var(--cl-" dist/assets/changelog-*.css` >0 and `grep -c "var(--space-[0-9]" dist/assets/changelog-*.css` ==0 on the changelog chunk; `curl -s https://…/assets/changelog-*.css` byte-identical to `dist/assets/changelog-*.css` (`cmp` or `md5`) and changelog HTML asset hash matches `dist/changelog.html` — catches the `:root --space-N` order-flip that makes local spacing correct but prod 4x off.
- [ ] Browser capture unavailable: simulate the pure pipeline in node (read plansDir + manifest, run split/tags/hits/unlinked) and assert card count, per-section hit counts, and the exact unlinked set before claiming the log is linked.
- [ ] New page is linked from the host nav/sidebar in the same build — a shipped-but-unlinked page is found only by URL.
- [ ] Plan history covers every plan file; tracker rerun is diff-clean; backfill rerun adds 0; every live section hash-matches its plan's last history entry (same hash fn both sides); edited plans show rev counts, untouched plans show none; moved phases show revs under the new file (old file holds no pointer).
- [ ] Preflight `--check` passes (trailer coverage, path coverage, shape survey, hook wiring) with no `PREFLIGHT FAIL`.
- [ ] Timeline: one track row per visible plan (1:1 with cards); streak vs sporadic kinds correct against manual bout filter; ghost bar appears only after a Due is set (dashed, overdue treatment when past); bout popover counts match the bout-filtered items; list→timeline→plan→close returns to timeline; `?view=timeline` cold-load works; chromium + webkit captures attached, zero page errors.
- [ ] Scheduling: Due control renders on incomplete rows only; set writes exactly one Due line (replace, never duplicate); clear removes it; committed Due survives regen with history rev-bump; ghost/dot/overdue-cluster reflect live with no reload.

## References

- `references/plan-shapes.md` — Task/Step adapter + anchor rules.
- `references/parallel-lanes.md` — 4-lane fan-out.
- `references/install-checklist.md` — backward-compatible install on existing repos + forward setup on new ones.
- `references/plan-split.md` — splitting phases between plans with history migration.
