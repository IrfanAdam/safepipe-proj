# AGENTS.md — safepipe_proj (harness-agnostic)

Any coding agent (Hermes, Claude Code, Codex, etc.) can work in this repo.
Read this file first; it replaces hallway knowledge.

## Stack & commands

- Vite 5 + Three.js + MapLibre. `npm install`, `npm run dev` (:5175),
  `npm run build`, `npm run preview` (:4175).
- `npm run build` also runs `scripts/plan-track.mjs` (plan ↔ commit
  manifest → `src/ds/plan-manifest.json`). Keep the build green.

## Architecture (from ARCHITECTURE.md — binding)

- `*.html` mounts: links + `#app` only. `src/patterns/`: screens, no
  device knowledge. `src/logic/`: pure, zero DOM. `src/components/` +
  `design-system/`: single source for UI.
- Every colour/size via `var(--token)`; no raw hex outside
  `design-system/tokens.css`. Logic never touches DOM.

## Plans (source of truth)

- Active + historical plans: `.hermes/plans/` (tracked in git).
- Commits that execute a plan carry `[plan:<file>#<anchor>]` in the subject.
- A phase is done only at its REF GATE with the stated evidence
  (screenshots, zero page errors); then mark each real `### Task N` heading
  `✓ done` + sha in place — never append a duplicate `### Task N ✓ done`
  heading, which `split()` reads as a new section and parks the phase at a
  fraction.
- Never invent files, coverage, coordinates, or findings — name the exact
  missing file + its official download page instead.

### Plan Anatomy (binding)

- **Plan is tasks OR phases with tasks** — a plan is EITHER a flat list of `## Task N` OR `## Phase N` with `### Task N` inside — never `items`. The word **tasks** is canonical in code, UI, docs, and changelog (rail `Task 02`, card `3 tasks`, status `3/3`, commits `### Task N ✓ done`). A request is not a phase.
- **Iterations are evals, not phases** — re-running, fixing, or re-evaluating existing tasks is an `eval` on the existing phase/task, not a new phase (the `150735`-style phase-per-request is forbidden). Polish/bug-fix/style tweak = revision/eval (`plan-history` snapshot + gate `· rev` note or feedback block). New Phase only for new scope/deliverable. *Shipped phases stand as history — this rule governs new work from 2026-10-19 on.*
- **Naming is `tasks` not `items`** — always use `Task N` / `tasks` in plans, commits, and changelog; never `items`.
- **Changelog engine: consistent phase status + gate** — every `## Phase` that owns tasks renders a consistent status line — tasks fraction (or `✓ DONE` when all done) plus gate verdict (`GATE PASSED`/`FAILED`/`OPEN`) when a gate exists, matching the plan's REF GATE evidence. Never invent or diverge phase completion.

## Verification

- `npm run build` must pass. UI changes need screenshots (chromium +
  webkit where the plan demands it) attached as phase evidence.
- No third-party imagery is committed to the repo — shipped 3D models are
  procedural reconstructions informed by references, never imagery copies.

## Skills (vendored — no install needed)

- `.agents/skills/<name>/SKILL.md` + references + scripts are snapshots of
  the Hermes skills this project depends on. Any agent: read the SKILL.md
  directly and follow it. See `docs/agent-skills.md` for which skill covers
  what. Snapshots taken 2026-10-12, re-synced 2026-10-19 with the Plan Anatomy
  rules; if your harness holds a higher `version:` for the same skill in its
  frontmatter, prefer that copy and note it in your commit — never assume a
  copy is newer because it sits in the global skills dir (the global
  `changelog-kit` is 0.3.1 and predates the vendored 0.4.0, so following it
  would revert the ontology rules).

## Binding references

- `docs/reference/sangachal-spec.md` — owner's Sangachal outline (was two
  identical pasted snapshots; deduped to one file).
- `docs/` — ontology, digital-twin contract, audits. `docs/source-manifest.json`
  records provenance for every external dataset.
