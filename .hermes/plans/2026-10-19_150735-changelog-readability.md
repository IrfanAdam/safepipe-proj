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
