# Learning — Plan Anatomy & Changelog Consistency

Recorded 2026-10-19 after repeated phase-per-request drift on `2026-10-19_150735`.

## Ontology (binding)

- A plan is **EITHER** `## Task N` flat list **OR** `## Phase N` + `### Task N` inside. Never “items”. Canonical word is **tasks** in plans, commits, code, and changelog (rail `Task 02`, card `N tasks`, status `d/t`, `### Task N ✓ done`).
- **Iterations are Evals, not new Phases.** Polish / bug-fix / style tweak on a shipped task = revision/eval (`plan-history` snapshot + gate `· rev` note or feedback block), not a new `## Phase`. New Phase only for new scope/deliverable. The `150735`-style `Phase 8 = small tweak` is the anti-pattern; keep it as an eval on the owning phase.
- **Naming:** always `Task N` / `tasks`; never `items`. Timeline bouts may use `items` for date buckets, but plan units are `tasks`.

## Changelog engine invariant (optimized 2026-10-19)

- Every `## Phase` that owns tasks renders a **consistent status line**: tasks fraction (or `✓ DONE` when `d/t` all done) **plus** gate verdict (`GATE PASSED`/`FAILED`/`OPEN`) when a gate exists. No phase renders with a bare title and no status.
- Card: `phases · d/t` (derived via `buildState`) + ship-gate guard (`shipGatesShut`); rail: `d/t · commits · edited`; detail: `h2` + `<p class="ds-status">` (synthesized from tasks when head has no `✓`/`gate`). Gateless phases show `d/t` or `✓ DONE`; table-only phases (no `###`) correctly show only `GATE OPEN`.

## Skills / Workflow updated

- `plan-traceability` + `changelog-kit` SKILL.md: added Ontology + Iterations bullets and Engine invariant.
- `AGENTS.md § Plan Anatomy (binding)`: 4 bullets above.
- `src/changelog/changelog-titles.js`: `unitLabel` fallback `Item → Task`.
- `src/changelog/changelog/raw-detail.js`: Phase `h2` status synthesis (isPhaseHead guard, fixes `mismatched numbers stay bare`).
- `src/changelog/changelog/paint-detail.js`: derivedFrac fallback so rail never bare.
- `src/changelog/changelog/paint-plan.js`: dispFrac for card consistency.
- `src/changelog/changelog-drawer.css`: checkbox filled `var(--color-ink)` + white `✓` (matches `input:checked`).

## Verification

- `npm run build` green, `node --test tests/changelog-detail.test.js` 57/57.
- Corpus sweep: every `split()` section resolves raw and renders clean.
