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

- REF GATE 1: the 4 sample drawers (172008 P1 + P5, domain-logic Task 4, twin-work Phase 05) each show summary → files → changes → verify with real lists, no false DONE, uniform gate tags. Evidence: screenshots + green suite.

*Shipped in d162a57 · Tasks 1–3 · phase-1.*

---

## Phase 2 — Grammar rollout: normalize gates + labels across plans {#phase-2}

*Tags: changelog, grammar*

*What the build gains:* authoring variance gone at the source; renderer fallbacks rarely fire.

| # | Task | Done when |
|---|---|---|
| 4 | Gate lines to `REF GATE N (STATUS):` + Evidence | Every corpus gate parses to a non-open state or an explicit OPEN with reviewer |
| 5 | Task labels to canonical set | No `Contract`/`Rules`-led blocks remain; order Files → Changes → Steps → Verify |

- REF GATE 2 (ship): corpus-wide grep shows zero non-canonical gate/label lines; build green; screenshots unchanged-or-better.

---

## Phase 3 — Task headers, accordions, compact metadata {#phase-3}

*Tags: changelog, renderer*

*What the build gains:* every `###` task reads like a mini phase (h3 + own status, never a bare bold line) on phased AND task-led plans; long metadata folds into closed accordions; metadata type and spacing tighten — all token-only, still display-only.

| # | Task | Done when |
|---|---|---|
| 6 | Task headers incl. task-led plans | every `###` task renders `h3` + own DONE/cancelled line (no gate, no checkbox); smooth-scheduling `###` items verified |
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

**Verify:** new tests for all three head shapes + unmarked; smooth-scheduling `###` items render headed in the corpus sweep; no `<input>` in any detail body.

### Task 7: Metadata accordions ✓ done `97ca963` → single-fold `a7e2a37` → task-fold `08ad967`

**Objective:** Long metadata folds shut — drawers scan as headers first, detail on demand.

**Files:**
- Modify: `src/changelog/changelog/raw-detail.js`
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- The task itself is the fold (steer 2026-10-20 #2 — replaces the FILES trigger, which duplicated its own label inside): each `###` item is one closed `<details>`, summary = caret + its own `h3` + status, body = everything unfolded (objective, all fields, steps/code). No FILES line, no previews.
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

- REF GATE 3 (ship): the 4 sample drawers show headed tasks, closed accordions, compact metadata; no visual regression on Evals/rails/cards. Evidence: screenshots + green suite.
*Shipped in 97ca963 · Tasks 6–8 · phase-3.*
*Follow-up single-fold in a7e2a37 · Task 7 · phase-3.*
*Follow-up task-fold (no FILES line) in 08ad967 · Task 7 · phase-3.*

---

## Phase 4 — Plan-level done honors the ship gate {#phase-4}

*Tags: changelog, renderer*

*What the build gains:* a plan card stops claiming done while its ship gate is still open — tasks-done and shipped are different facts, and the card tells them apart.

| # | Task | Done when |
|---|---|---|
| 9 | Ship-gate plan status | 172008 + smooth cards read open (ship gates open); timeline card unchanged (ship passed); no other card flips |

### Task 9: Ship-gate plan status ✓ done `2b6f5ae`

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

- REF GATE 4 (ship): 172008 card open, smooth card open, every other card unchanged. Evidence: list screenshots + green suite.

*Shipped in 2b6f5ae · Task 9 · phase-4.*

---

## Phase 5 — Task-only sections: stamp rollup + source order {#phase-5}

*Tags: changelog, renderer*

*What the build gains:* `## Task` plans stop nesting nameless tasks and scrambling field order — the section reads as one unit, in the author's words, in the author's order.

| # | Task | Done when |
|---|---|---|
| 10 | Stamp rollup + section source order | smooth/timeline `## Task` heads show DONE, no nested `Task N`; Behavior contract sits before Steps; loose steps stay written-position |

### Task 10: Stamp rollup + section source order ✓ done `50d70b4`

**Objective:** A bare `### Task N ✓ done` stamp is the section's seal, not a sub-task; and an open section keeps its narrative.

**Files:**
- Modify: `src/changelog/changelog/raw-detail.js`
- Modify: `src/changelog/changelog-drawer.css` (base field margin; drop dead wrapper)
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- Bare `###` (no content) whose number matches the `##` section rolls up: nested render suppressed, unanimous verdict re-renders the head (author-mark shape, suffix inside). Other numbers still render bare.
- `##` orphan/implicit bodies render fields + loose blocks interleaved by parse sequence (objective as lede at its position in `###`-less bodies). Canonical sort stays inside `###` folds only.

**Verify:** 7 new unit tests; corpus sweep green; smooth + timeline drawer screenshots chromium + webkit, zero page errors; full suite green; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-5]`; close with `✓ done` + sha.

- REF GATE 5 (ship): smooth Task 1 head DONE with Files/Rules/Verify in order and no nested task; timeline Task 2 contract-before-steps. Evidence: screenshots + green suite.

*Shipped in 50d70b4 · Task 10 · phase-5.*

---

## Phase 6 — Task title notes {#phase-6}

*Tags: changelog, renderer*

*What the build gains:* fold headers stay one line — trailing prose parens move into the body instead of inflating the title.

| # | Task | Done when |
|---|---|---|
| 11 | Title-note split | terrain Task 1 header is one line, note leads the open fold; paren shas still ship |

### Task 11: Title-note split ✓ done `0f674fe`

**Objective:** A trailing `(...)` on a task title is the ship sha or a prose note — never header material.

**Files:**
- Modify: `src/changelog/changelog/raw-detail.js`
- Modify: `tests/changelog-detail.test.js`

**Changes:**
- `taskTitleOf` colon branch: pure-sha paren → `shipped` (as before); any other trailing paren → `note`, stripped from the name.
- `renderTask`: note renders as the fold's first paragraph (before objective); note-only tasks flow unfolded (header + note, never dropped, never folded solo).
- Fully-bolded step heads (`**Step 1: X**`, no `:**`) open their own procedural field instead of gluing into the open field's inline — terrain/theatre convention.

**Verify:** 6 new unit tests (4 note + 2 step-head, incl. 1 terrain corpus); corpus sweep green; terrain Task 1 closed+open screenshots chromium + webkit, zero page errors; full suite green; commit with `[plan:2026-10-19_150735-changelog-readability.md#phase-6]`; close with `✓ done` + sha.

- REF GATE 6 (ship): terrain Task 1 header one line, note first inside, Tasks 2–7 shas in statuses. Evidence: screenshots + green suite.

*Shipped in 0f674fe · Task 11 · phase-6.*

---

## Phase 7 — Head consistency {#phase-7}

*Tags: changelog, renderer*

*What the build gains:* every phase head scans the same (title / status / divider / body); task folds read name-first with the caret as suffix and no id.

| # | Task | Done when |
|---|---|---|
| 12 | Head consistency | ring2 Phase 4 shows divider under DONE, folds read `name ✓ DONE ›` with no id |

### Task 12: Head consistency ✓ done `ac91418`

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

- REF GATE 7 (ship): ring2 Phase 4 divider + suffix carets, no ids. Evidence: screenshots + green suite.

*Shipped in ac91418 · Task 12 · phase-7.*
