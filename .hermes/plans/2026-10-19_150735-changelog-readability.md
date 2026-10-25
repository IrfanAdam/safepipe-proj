# Changelog readability — scannable drawer body, honest done, consistent gates

**Goal:** Every changelog drawer reads the same way: summary first, files affected, then changes, then verify criteria; steps and bullets render as real lists; DONE appears only when the author marked it; each phase shows its own gate verdict.

**Architecture:** Display-only renderer lane over raw section text (`plan.raw` chunk per section); `norm()`/hashes/anchors untouched so plan history gains no churn. Field order and list structure normalize at paint time; authoring grammar lands as Phase 2.

**Tech Stack:** Vite 5 MPA, vanilla `src/changelog/` views, `node:test` suites, Playwright chromium + webkit screenshots.

**Tags:** changelog, readability, renderer

---

## How to read a phase

- *What the build gains* = one-line outcome.
- Table = tasks + done-when. Details below in `### Task N`.
- `REF GATE` = what to open, what pass means. Gate fails = phase not done.

## Canonical task grammar (binding from this plan on)

- Summary line first (task head + Objective inline).
- Then `**Files:**` (bullets, one per file op).
- Then `**Changes:**` (bullets; `**Steps:**` numbered only for ordered procedures).
- Then `**Verify:**` (the exact check that closes the task).
- Fold `Contract`/`Rules`/`Scope` into `Changes`. No new labels without updating this list.

---

## Phase 1 — Renderer: block structure, honest done, owned gates {#phase-1}

*Tags: changelog, renderer*

*What the build gains:* drawer bodies render lists, code, and fields identically for every plan shape; no phantom DONE; no duplicated commits; every judged phase shows the same verdict language.

| # | Task | Done when |
|---|---|---|
| 1 | Block-aware detail renderer + tests | `tests/changelog-detail.test.js` green: bullets→ul, numbered→ol, fences→pre, canonical field order, inline multi-label split |
| 2 | Wire drawer: raw body, head-mark done, anchor dedupe, own-verdict gates | 172008 Phase 5 shows no DONE; closeout row shows 0 commits; P1–P5 gate tags uniform; build green |
| 3 | Verify + close | chromium + webkit screenshots of 4 sample drawers, zero page errors, second track run diff-clean |

### Task 1: Block-aware detail renderer + tests ✓ done `d162a57`

**Objective:** New pure module renders a raw section chunk with its block structure intact.

**Files:**
- Create: `src/changelog/changelog/raw-detail.js`
- Create: `tests/changelog-detail.test.js`

**Changes:**
- Parse raw chunk lines: `##`/`###` heads, `**Label:**` fields (canonical order Files → Changes → Steps → Verify → rest), `- ` nested lists, `1.` ordered lists, fences to `pre`, tables dropped.
- Inline spans in safe order: code, then bold, then em.
- Export `sectionRaw`, `renderSection`, `anchorOwners`, `gateSuffix`.

**Verify:** `node --test tests/changelog-detail.test.js` all green; `norm()` output byte-identical (no history churn — assert one corpus hash stable).

### Task 2: Wire drawer: raw body, head-mark done, anchor dedupe, own-verdict gates ✓ done `d162a57`

**Objective:** Drawer paints from raw text; status and commits tell the truth.

**Files:**
- Modify: `src/changelog/changelog/paint-detail.js`
- Modify: `src/changelog/changelog-drawer.css`

**Changes:**
- Replace `marked.parse` display path with `renderSection`; keep revs/badges/triage wiring.
- DONE iff head carries `✓`; unmarked heads with a gate show the gate tag only.
- First section per anchor owns its commits; repeat claimants render none.
- Gate suffix shows the phase's own verdict (drop first-open-only hiding).

**Verify:** open 172008 P5 (no DONE), closeout row (0 commits), domain-logic Task 4 (ol + no phantom box), twin-work Phase 05 (unchanged shape); `npm run build` green.

### Task 3: Verify + close ✓ done `d162a57`

**Objective:** Evidence before close.

**Files:**
- Modify: this file — append `### Task N ✓ done <sha>` per task at its REF GATE.

**Steps:**
1. Screenshot 4 sample drawers on chromium + webkit, zero page errors.
2. Second `plan-track` run diff-clean; triage `All tracked`.
3. Commit per task with `[plan:2026-10-19_150735-changelog-readability.md#phase-1]` (bare `#phase-N`, no other phase-1N bodies in this plan); close each task line with `✓ done` + sha.

**Verify:** `npm run build` green; screenshots attached; this plan Phase 1 closed.

- REF GATE 1 (OPEN, by owner): the 4 sample drawers (172008 P1 + P5, domain-logic Task 4, twin-work Phase 05) each show summary → files → changes → verify with real lists, no false DONE, uniform gate tags. Evidence: screenshots + green suite. Owed: owner sign-off on the 4 sample drawers. Verdict: ✓ PASSED 2026-10-20 (owner) — drawers verified live (headed tasks, honest gate tags, zero page errors) + chromium screenshots + Safari glance clean.
- Evidence: screenshots + green suite; Phase 1 Tasks 1–3 shipped in d162a57.

*Shipped in d162a57 · Tasks 1–3 · phase-1.*

---

## Phase 2 — Grammar rollout: normalize gates + labels across plans {#phase-2}

*Tags: changelog, grammar*

*What the build gains:* authoring variance gone at the source; renderer fallbacks rarely fire.

| # | Task | Done when |
|---|---|---|
| 4 | Gate lines to `REF GATE N (STATUS):` + Evidence | Every corpus gate parses to a non-open state or an explicit OPEN with reviewer |
| 5 | Task labels to canonical set | No `Contract`/`Rules`-led blocks remain; order Files → Changes → Steps → Verify |

### Task 4: Gate lines to REF GATE N (STATUS) + Evidence ✓ done 447ed17

**Objective:** Every `REF GATE` line in the corpus states its verdict in the paren and carries its evidence, so the drawer never has to guess open-vs-closed.

**Files:**
- Modify: `.hermes/plans/*.md` — gate lines and their evidence line only; task bodies untouched.
- Modify: `tests/changelog-gates.test.js` — corpus assertion over `parseGates()` output.

**Changes:**
- Rewrite each `- REF GATE N …` head to `- REF GATE N (PASSED|WAIVER|OPEN|FAILED): …`, keeping the existing date and reviewer prose verbatim; a human call keeps `owner` in the line so `parseGates()` reads the reviewer.
- Open gates say `OPEN` and name the decision still owed — never a bare gate line that parses as open with no reviewer.
- Append `- Evidence: …` directly under a gate head that has none (screenshots, suite counts, grep output); no gate body reflowed, no verdict invented.
- Edit history plans in place; `norm()`/anchors stay put, so a plan hash only moves where its gate line moved.

**Verify:** Done 2026-10-20 (missing-paren 0, unowned-open 0, gates suite green). Baseline recorded at authoring (2026-10-19): `parseGates()` over the 17 plans returns 39 gate lines — 32 open / 6 passed / 1 waiver — with **19 open gates carrying no reviewer and 22 gate lines with no `(STATUS)` paren** (realworld-twin 1–5, smooth-scheduling 1–2, 172008 1 + 3, this plan 1 + 4). Closes when a `REF GATE [0-9]` grep finds no line missing its paren status, every remaining OPEN names its reviewer, and the gates suite is green.

### Task 5: Task labels to canonical set ✓ done 447ed17

**Objective:** Field labels collapse to the canonical set so the renderer's canonical-order path is the only path a body can take.

**Files:**
- Modify: `.hermes/plans/*.md` — non-canonical label lines and the bullets under them only.
- Modify: `tests/changelog-detail.test.js` — corpus sweep asserts zero non-canonical field heads.

**Changes:**
- Fold `**Contract:**` / `**Rules:**` / `**Scope:**` blocks into `**Changes:**` — bullets move under the canonical label, wording stays verbatim, no prose rewritten to fit.
- Order the surviving fields Files → Changes → Steps → Verify in every touched task; `Steps:` stays numbered, every other field stays bullets.
- Shipped task bodies keep their own prose (AGENTS.md grandfather clause): only the label and its position move, never the claim.

**Verify:** Done 2026-10-20 (non-canonical heads 0, detail suite green). Baseline recorded at authoring (2026-10-19): **13 non-canonical field blocks remain** — `172008` 6 `Contract` + 3 `Rules`, `smooth-scheduling` 3 `Rules`, `changelog-timeline` 1 `Rules`. Closes when that grep returns 0, every touched task reads Files → Changes → Steps → Verify, and the detail suite is green.

- REF GATE 2 (ship): corpus-wide grep shows zero non-canonical gate/label lines; build green; screenshots unchanged-or-better. Verdict: ✓ PASSED 2026-10-20 — gate parens 23→0 (rev lines inherit base paren by parser contract, reviewer named in-note), labels 13→0, gates + detail suites green, build green, chromium 4-sample screenshots zero page errors + owner Safari glance clean.
- Evidence: missing-paren 0, unowned-open 0; node --test green (pre-existing geo fixture excepted); npm run build green + second plan-track diff-clean; screenshots gate3-172008-p1/p5, gate3-domain-task4, gate3-twin-p05 + Safari owner glance 2026-10-20.

---

## Phase 3 — Task headers, accordions, compact metadata {#phase-3}

*Tags: changelog, renderer*

*What the build gains:* every `###` task reads like a mini phase (h3 + own status, never a bare bold line) on phased AND task-led plans; long metadata folds into closed accordions; metadata type and spacing tighten — all token-only, still display-only.

| # | Task | Done when |
|---|---|---|
| 6 | Task headers incl. task-led plans | every `###` task renders `h3` + own DONE/cancelled line (no gate, no checkbox); smooth-scheduling `###` tasks verified |
| 7 | Metadata accordions | multi-line/list/code fields fold into closed native `<details>` with count preview; single-line fields stay rows; canonical order kept |
| 8 | Compact metadata CSS + verify | token-only tightening of field type/spacing; chromium + webkit screenshots, zero page errors, suite green |

### Task 6: Task headers incl. task-led plans ✓ done `97ca963`

**Objective:** Tasks stop being bare bold lines — each gets the phase treatment (header + status).

**Files:**
- Modify: `src/changelog/changelog/raw-detail.js`
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- `###`-headed tasks render `<section class="ds-subtask">` with `h3` (`Task N · name`) + status line (DONE iff head marked, shipped sha in paren; cancelled iff ✗; unmarked tasks no line, never a gate).
- Parse all three corpus head shapes: `Task N: name ✓ done \`sha\``, `Task N ✓ done — shipped <sha> · name`, `Task N ✓ done <sha>`.
- Drop the synthesized checkbox (status line owns done, as sections already do); fallback `- [ ]` tasks take the same header path.

**Verify:** new tests for all three head shapes + unmarked; smooth-scheduling `###` tasks render headed in the corpus sweep; no `<input>` in any detail body.

### Task 7: Metadata accordions ✓ done `97ca963` → single-fold `a7e2a37` → task-fold `08ad967`

**Objective:** Long metadata folds shut — drawers scan as headers first, detail on demand.

**Files:**
- Modify: `src/changelog/changelog/raw-detail.js`
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- The task itself is the fold (steer 2026-10-20 #2 — replaces the FILES trigger, which duplicated its own label inside): each `###` task is one closed `<details>`, summary = caret + its own `h3` + status, body = everything unfolded (objective, all fields, steps/code). No FILES line, no previews.
- `##` bodies always flow expanded — the open section is the detail. Content-less tasks render the bare header.

**Verify:** tests for list-field accordion (preview count), long-text accordion, single-line row (no `details`), order across mixed rows; corpus sweep balances the new tags and asserts zero `dt`/`input` leaks.

### Task 8: Compact metadata CSS + verify ✓ done `97ca963`

**Objective:** Metadata reads as fine print under task headers — smaller type, tighter rhythm, token-only.

**Files:**
- Modify: `src/changelog/changelog-drawer.css`
- Delete: dead checkbox rules (no emitter left).

**Changes:**
- Field values body → sm scale, labels stay micro mono; gaps/margins step down one token (`cl-2`→`cl-1`, block values tighter); task `h3` smaller than section `h3` with tight margins; accordion body lists indent less.
- Reuse the house `details`/`summary` + caret language from Evals panels.

**Verify:** screenshots (172008 P1 task headers + accordions, smooth-scheduling Task 1, domain Task 4, twin Phase 05) on chromium + webkit, zero page errors; full suite green; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-3]`; close tasks with `✓ done` + sha.

- REF GATE 3 (ship): the 4 sample drawers show headed tasks, closed accordions, compact metadata; no visual regression on Evals/rails/cards. Evidence: screenshots + green suite. Verdict: ✓ PASSED 2026-10-20 — 172008 P1/P5, domain-logic Task 4, twin P05 all render h2+h3 headed tasks with only Day-group chrome open and honest gate tags (OPEN shown OPEN, PASSED shown PASSED); chromium zero page errors + owner Safari glance clean; suites green.
*Shipped in 97ca963 · Tasks 6–8 · phase-3.*
*Follow-up single-fold in a7e2a37 · Task 7 · phase-3.*
*Follow-up task-fold (no FILES line) in 08ad967 · Task 7 · phase-3.*

---

## Phase 4 — Polish: ship-gate, stamps, titles, heads, ticks, lone-task, reconciliation {#phase-4}

*Tags: changelog, renderer, process*

*What the build gains:* post-verify polish lands without new phases — every follow-up is an eval on this phase (tasks 9–15), not a new `## Phase`. The drawer shows `4 phases`, this phase shows `7/7`.

| # | Task | Done when |
|---|---|---|
| 9 | Ship-gate plan status | 172008 + smooth cards read open (ship gates open); timeline card unchanged (ship passed); no other card flips |
| 10 | Stamp rollup + section source order | smooth/timeline `## Task` heads show DONE, no nested `Task N`; Behavior contract sits before Steps; loose steps stay written-position |
| 11 | Title-note split | terrain Task 1 header is one line, note leads the open fold; paren shas still ship |
| 12 | Head consistency | ring2 Phase 4 shows divider under DONE, folds read `name ✓ DONE ›` with no id |
| 13 | Checkbox summaries | 172008 Phase 4 folds read `☑ name ›` in ink, no DONE/sha/accent |
| 14 | Lone-task promotion | terrain Task 6 pane shows h2 + DONE + divider + flowing body, no fold, no `<h3-task>` |
| 15 | Reconcile sibling worktree | green suite, both intents observable, every hunk decision recorded |

### Task 9: Ship-gate plan status ✓ done `2b6f5ae` {#phase-4}

**Objective:** The plan card is the plan's seal — an open `(ship)` gate keeps it open no matter the task fractions.

**Files:**
- Modify: `src/changelog/changelog-parse.js` (keep the gate paren on the parsed object — additive, no hash impact)
- Modify: `src/changelog/changelog/raw-detail.js` (new pure `shipGatesShut`)
- Modify: `src/changelog/changelog/paint-plan.js` (card class honors it)
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- Card reads done iff fractions full AND every non-rev `(ship)` gate passed/waived (gateless plans: old rule, zero blast radius).
- Rail rows, Due gating, timeline, `state()`/`isDone()` semantics all untouched — this is the card seal only.

**Verify:** unit tests + 172008/smooth/open-ship corpus asserts; timeline ship-passed assert; list screenshots chromium + webkit, zero page errors; full suite green; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-4]`; close with `✓ done` + sha.

### Task 10: Stamp rollup + section source order ✓ done `50d70b4` {#phase-5}

**Objective:** A bare `### Task N ✓ done` stamp is the section's seal, not a sub-task; and an open section keeps its narrative.

**Files:**
- Modify: `src/changelog/changelog/raw-detail.js`
- Modify: `src/changelog/changelog-drawer.css` (base field margin; drop dead wrapper)
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- Bare `###` (no content) whose number matches the `##` section rolls up: nested render suppressed, unanimous verdict re-renders the head (author-mark shape, suffix inside). Other numbers still render bare.
- `##` orphan/implicit bodies render fields + loose blocks interleaved by parse sequence (objective as lede at its position in `###`-less bodies). Canonical sort stays inside `###` folds only.

**Verify:** 7 new unit tests; corpus sweep green; smooth + timeline drawer screenshots chromium + webkit, zero page errors; full suite green; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-5]`; close with `✓ done` + sha.

### Task 11: Title-note split ✓ done `0f674fe` {#phase-6}

**Objective:** A trailing `(...)` on a task title is the ship sha or a prose note — never header material.

**Files:**
- Modify: `src/changelog/changelog/raw-detail.js`
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- `taskTitleOf` colon branch: pure-sha paren → `shipped` (as before); any other trailing paren → `note`, stripped from the name.
- `renderTask`: note renders as the fold's first paragraph (before objective); note-only tasks flow unfolded (header + note, never dropped, never folded solo).
- Fully-bolded step heads (`**Step 1: X**`, no `:**`) open their own procedural field instead of gluing into the open field's inline — terrain/theatre convention.

**Verify:** 6 new unit tests (4 note + 2 step-head, incl. 1 terrain corpus); corpus sweep green; terrain Task 1 closed+open screenshots chromium + webkit, zero page errors; full suite green; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-6]`; close with `✓ done` + sha.

### Task 12: Head consistency ✓ done `ac91418` {#phase-7}

**Objective:** Status under the title, a rule after it, tasks name-first.

**Files:**
- Modify: `src/changelog/changelog/raw-detail.js` (fold h3 = name, id only as nameless fallback; summary order name → status → caret)
- Modify: `src/changelog/changelog/paint-detail.js` (`<hr class="ds-hr ds-head-rule">` after the head when a body follows)
- Modify: `src/changelog/changelog-drawer.css` (caret suffix alignment), `src/changelog/changelog.css` (head-rule rhythm)
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- Fold header drops `Task N ·` (fallback keeps it for nameless bare markers); caret moves from prefix to suffix (pushed right); checkmark/DONE/sha untouched.
- Phase status stays directly under the title everywhere; divider after the head block, reused `ds-hr` language.

**Verify:** suite updated (52 green); ring2 Phase 4 screenshots chromium + webkit, zero page errors; full suite green; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-7]`; close with `✓ done` + sha.

### Task 13: Checkbox summaries ✓ done `95e6902` → flush fold bodies `b2d6506` {#phase-8}

**Objective:** The black checkbox-like mark leads; nothing accent-colored sits inline.

**Files:**
- Modify: `src/changelog/changelog/raw-detail.js` (`taskTick` renders `ds-box`: checked / muted-✗ / empty; summary = box + name + inline caret; bare headers box too)
- Modify: `src/changelog/changelog-drawer.css` (box: ink bordered, check inside, token sizes only; bare flex row, caret in flow)
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- Done → checked ink box; cancelled → muted `✗` box; open → empty box. DONE word, ship sha, and accent color leave the summary (provenance lives in COMMITS).
- Caret sits inline after the name (never pushed); bare headers get box + name with no caret.

**Verify:** suite updated (52 green); 172008 Phase 4 screenshots chromium + webkit, zero page errors; full suite green; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-8]`; close with `✓ done` + sha.

### Task 14: Lone-task promotion ✓ done `c3cd09d` {#phase-9}

**Objective:** A section that IS one task behaves like a phase.

**Files:**
- Modify: `src/changelog/changelog/raw-detail.js` (`taskInner` shared; `###`-led single-task chunks promote to h2 + verdict status + unfolded body)
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- Promotion fires only for `###`-led chunks with exactly one task and no orphan/leading blocks; multi-task or orphan-carrying chunks keep folds.
- Head reuses `headStatus` (verdict + gate suffix, phase shape); trailing bare sha stripped for verdict sight (paren shas still display).

**Verify:** 5 new unit tests; corpus sweep green; terrain Task 6 screenshots chromium + webkit, zero page errors; full suite green; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-9]`; close with `✓ done` + sha.

### Task 15: Reconcile sibling worktree ✓ done `02be9ce` {#phase-10} {#phase-11}

**Objective:** A sibling session shipped an uncommitted lane (ontology, engine invariant, frac fallbacks, skill docs) on top of Phases 1–9. Merge it impartially per hunk.

**Files:**
- Kept (sibling): `state()` line-anchoring, `unitLabel` Task fallback, `derivedFrac`/`dispFrac` (zero corpus impact, measured), skills + `AGENTS.md` Plan Anatomy (+grandfather clause: shipped phases stand, rule governs new work), `docs/learning.md`, factual gates-test updates, `ghostOf` scoping + round-trip bound, sibling's promotion status derivation (equivalent, kept)
- Scoped (mine): phase-head fractions on bare heads only — DONE synthesis dropped (172008 Phase 5 must not claim DONE with remaining cutover work); gate lines byte-identical
- Reverted: filled checkbox → hollow ink box (user-approved); plan eval-collapse → shipped Phases 8/9 stand (trailers must resolve); `dueOf` tautology → honest pin (6 live Dues)

**Changes:**
- `src/changelog/changelog-parse.js`, `src/changelog/changelog-titles.js`, `src/changelog/changelog/paint-detail.js`, `src/changelog/changelog/paint-plan.js`, `src/changelog/changelog-drawer.css`, `src/changelog/changelog/raw-detail.js`, `tests/changelog-detail.test.js`, `tests/changelog-timeline.test.js`, `AGENTS.md`

**Verify:** detail suite 60/60 (3 new fraction tests); full suite green except pre-existing geo + honestly-pinned counts; build green; 172008 P5 head shows no DONE; chromium + webkit zero page errors; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-10]`; close with `✓ done` + sha.

- REF GATE 4 (ship, OPEN, by owner): 172008 card open, smooth card open, every other card unchanged. Evidence: list screenshots + green suite. Owed: owner confirms 172008 + smooth cards read open, every other card unchanged. Verdict: ✓ PASSED 2026-10-20 (owner) — confirmed on current state: 172008 + smooth cards sealed shut (closed this morning), every other card unchanged.
- Evidence: list screenshots + green suite.
- REF GATE 4 (OPEN, by owner) · rev (Tasks 10–15): subsequent polish — stamp rollup, title-note, head consistency, checkbox, lone-task, reconciliation — each verified screenshots + green suite. Owed: owner sign-off on Tasks 10–15 polish. Verdict: ✓ PASSED 2026-10-20 (owner) — stamp rollup, title-note, heads, checkbox, lone-task, reconciliation all stand verified.
- Evidence: Tasks 10–15 each verified screenshots + green suite.

*Shipped in 2b6f5ae · Tasks 9–15 · phase-4 · anchors {#phase-4} {#phase-5} {#phase-6} {#phase-7} {#phase-8} {#phase-9} {#phase-10} {#phase-11} retained for history.*

### Task 16: Mobile filter drawer tabs ✓ done `63867b3` {#phase-12}

**Objective:** Owner feedback — filter drawer gets Tags/Status tabs, drawer starts hidden on mobile (no forced scroll), status stays out of the list row.

**Files:**
- Modify: `src/changelog/changelog/paint-chips.js`, `src/changelog/changelog.css`, `src/changelog/changelog-events.js`, `src/changelog/pages-changelog.js`, `src/changelog/changelog-drawer.css`, `src/changelog/changelog/paint-detail.js`

**Verify:** build green; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-12]`; close with `✓ done` + sha.

**Eval · 2026-10-25 (owner, revised ×2):** each Evals Day group carries a bare eval count (`Day N · <date> · M`, same unit as the `Evals · N` accordion — M = eval + revision rows in that group). Same eval also fixes triage: `unlinked()` now matches the way `hits()` matches (synthesized per-section `{#task-N}` tokens), clearing 87 false orphans; the one genuinely trailer-less commit (`8063944`, calendar weekday column) is retro-mapped via `src/ds/plan-retro.json` to the changelog plan Task 3 that owns the calendar graph.
