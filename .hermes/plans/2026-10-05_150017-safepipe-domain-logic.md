# Plan C — Safepipe domain logic (pure, tested, fig-grounded)

> **For Hermes:** implement with a fresh subagent. Parallel-safe: owns `src/logic/` + `tests/` only.
> Runs alongside Plan A (DS) and Plan B (screens). Zero DOM, zero CSS, zero Figma rendering.

**Goal:** All prototype behavior as pure, unit-tested logic modules whose rules are extracted from the
legacy file's real content (forms, questionnaires, statuses, OQ rules) — verified live so behavior never drifts.

**Architecture:** `src/logic/*` pure functions + JSON fixtures; `tests/*.test.js` run with `node --test`.
Plan B consumes these signatures (frozen below) — logic never touches DOM per `ARCHITECTURE.md`.

**Tech Stack:** Vanilla JS modules, `node --test`, `openfig-core` (content mining only).

---

## Step 0 — Live-fig content mining setup (copy-paste)

```bash
FIG="/Users/irfan/Documents/2023 before/Figs/Clarity/Safepipe - UI.fig"
mkdir -p /Users/irfan/.hermes/cache/scratch/sp-logic && cd /Users/irfan/.hermes/cache/scratch/sp-logic
npm init -y >/dev/null 2>&1 && npm install openfig-core
```

Mine with TEXT-node queries, e.g.: all `Question` instance labels (83 questionnaire prompts — the real
form logic), `WO status` variants (`Complated=Yes/No` — note legacy typo, normalize to `completed`),
`Switch Enabled=No/Yes`, `Added=No→Added=Yes` QC flows, `Qualification expires in 1m` OQ wording,
`Due in N days` computations, `50 % complete` progress rule.

> Rule: every rule below cites the live node evidence (page/frame/text). If the text isn't in the live
> file, the rule doesn't ship.

## Task 1 — Fixtures (frozen contract with Plan B) ✓ done

*Shipped in ba00e7f · src/logic/fixtures.json (12 staff, 8 WOs, 3 pipelines) + fixtures.js loader · tests/fixtures.test.js 10 pass.*

**Objective:** `src/logic/fixtures.json` + loader with the exact shape Plan B codes against.
**Files:** Create `src/logic/fixtures.json`, `src/logic/fixtures.js`.

1. Shape: `{ client, staff[], workOrders[], pipelines[] }` (fields per Plan B Task 1). Seed 12 staff,
   8 work orders, 3 pipelines; values sampled live (Motiva enterprises, Raymond Rangel, Nueces Bay,
   `Pipeline Patrol Main Pipe`, `In progress`, `Due in 23 days`).
2. Assert live: each seeded string exists verbatim in the `.fig` (script, expect 100% hit).
3. Verify: `node --test tests/fixtures.test.js` — shape + verbatim-hit tests. Expected: all pass.

## Task 2 — Work-order state machine ✓ done

*Shipped in ba00e7f · src/logic/workorders.js (294 lines: STATES, normalizeStatus, canTransition, woProgress, dueInDays, isOverdue, transitionWO, listWorkOrders) · tests/workorders.test.js 48 pass.*

**Objective:** Status transitions + derived fields (`dueInDays`, `progress%`, overdue).
**Files:** Create `src/logic/workorders.js`; create `tests/workorders.test.js`.

1. States mined live from `WO status` symbols + status texts (`In progress`, `Active`, `Completed`,
   `50 % complete`): `create → assigned → in_progress → completed`, guards (can't complete with
   unchecked equipment), `progress = checkedItems/totalItems`.
2. TDD: failing test → minimal impl → pass. Cover guards, due-date math, overdue flag.
3. Verify: `node --test tests/` all green.

## Task 3 — OQ qualifications + workforce rules ✓ done

*Shipped in ba00e7f · src/logic/qualifications.js + workforce.js (filterStaff, openWorkload, expiringOQs, oqStatus) · tests/qualifications.test.js 17 pass + workforce.test.js 15 pass.*

**Objective:** Expiry computation (`Qualification expires in 1m`), workload rollups
(`In progress 3 WOs, 32 tasks`), search/filter predicates used by the directory.
**Files:** Create `src/logic/qualifications.js`, `src/logic/workforce.js`; tests for both.

1. Mine live: `12 Valid OQs` semantics, `WO status`/`Evaluation` forms, member-row strings.
2. Predicates: `filterStaff(staff, {query, availableOnly})`, `openWorkload(staffId, workOrders)`,
   `expiringOQs(staff, withinDays)`.
3. Verify: `node --test tests/` all green.

## Task 4 — Questionnaire / QC / inspection logic ✓ done

*Shipped in ba00e7f · src/logic/inspections.js (FORMS 6 forms × 39 qs, answerQuestionnaire, toggleQC, validateForm) · tests/inspections.test.js 21 pass.*

**Objective:** Executable versions of the legacy forms: patrol questionnaire, QC checklists
(`Added=No→Added=Yes`), MOC inputs, evaluation scoring, mileage entries.
**Files:** Create `src/logic/inspections.js`; create `tests/inspections.test.js`.

1. Mine live: all 83 `Question` labels + `Questionairre forms` structure + `3+1`/`Eval` scoring patterns
   from the Forms/QC pages; encode as data-driven `FORMS` table (question → type → required → options),
   not hardcoded per-screen code.
2. Functions: `answerQuestionnaire(formId, answers)` → `{complete, score, missing[]}`; `toggleQC` transition.
3. Verify: `node --test tests/` all green; every `FORMS` label asserted verbatim-live.

## Task 5 — API freeze + publish ✓ done

*Closed 2026-10-07 · src/logic/README.md frozen API table (8 signatures verified present) · node --test 111 pass/0 fail · npm run build green. Code shipped inside ba00e7f (shared Plan A/B/C commit, retro-mapped to Plan A — badges stay there; this close is docs-only, no history rewrite).*

**Objective:** Final signatures Plan B integrates against; full suite green.
**Files:** Modify `src/logic/README.md` (or create) with the frozen API table.

Frozen API: `listWorkOrders(f)`, `transitionWO(wo, to)`, `woProgress(wo)`, `filterStaff(s, q)`,
`openWorkload(id, wos)`, `expiringOQs(s, d)`, `answerQuestionnaire(id, a)`, `loadFixtures()`.
No signature changes after this without bumping the plan file.

Verify: `node --test tests/` (expect: 0 failures) + verbatim-live audit script passes.
Commit: `git add src/logic tests`.

**Merge notes:** Plan B calls these and only these. Behavior disputes → live `.fig` text is the arbiter.
