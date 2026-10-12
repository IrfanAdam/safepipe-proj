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
  (screenshots, zero page errors); then append `### Task N ✓ done` + sha.
- Never invent files, coverage, coordinates, or findings — name the exact
  missing file + its official download page instead.

## Verification

- `npm run build` must pass. UI changes need screenshots (chromium +
  webkit where the plan demands it) attached as phase evidence.
- No third-party imagery is committed to the repo — shipped 3D models are
  procedural reconstructions informed by references, never imagery copies.

## Skills (vendored — no install needed)

- `.agents/skills/<name>/SKILL.md` + references + scripts are snapshots of
  the Hermes skills this project depends on. Any agent: read the SKILL.md
  directly and follow it. See `docs/agent-skills.md` for which skill covers
  what. Snapshots taken 2026-10-12; if your harness has a newer upstream
  version of the same skill, prefer upstream and note it in your commit.

## Binding references

- `docs/reference/sangachal-spec.md` — owner's Sangachal outline (was two
  identical pasted snapshots; deduped to one file).
- `docs/` — ontology, digital-twin contract, audits. `docs/source-manifest.json`
  records provenance for every external dataset.
