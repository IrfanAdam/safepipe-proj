# Parity loop — capture → diff → refine harness

Recursive per-category loop for Phase 02 Task 15. Each invocation is one
`build → capture → diff vs board → refine` pass; re-running appends the next
run, and every entry carries a delta vs the previous run so each pass visibly
reinforces the next.

## Scripts (all executable, `#!/usr/bin/env node`)

- `run.mjs [boardDir] [--runs K] [--base URL]` — orchestrator. Takes the board
  path as an argument; falls back to `docs/parity-board/` then
  `public/parity-board/`; with no board every view reports
  `gap:no-board-frame` (gaps, never failures, exit 0).
- `capture.mjs --out <scratchDir> --base http://localhost:5198` — captures
  TOP/ISO/NEAR via headless Chromium (`setViewPreset`: network/segment/asset)
  plus `probes.json` (pose, canvas dims, frame counters, console errors).
  Reuses the running :5198 server; captures go to scratch only.
- `diff.mjs --captures <dir> --board <dir|-> --out <diff.json>
  [--prev-probes <path>]` — pixel diff (dependency-free PNG decode + 256px
  thumbnail MAD) plus structural notes (pose, renderer liveness, errors).

## State

- `loop-log.jsonl` — append-only log. Shape per line:
  `{run, ts, board, base, runDir, views:{TOP|ISO|NEAR:{status, board, pixel
  {mad, changedPct, verdict}|null, structural[]}}, objects:[{id, category,
  tier, evidence}…], deltaVsPrev:{VIEW:{madDelta, trend}}}`.
  Tier stamps ride on **every** measured object, **every** run.
- `corrections.md` — regenerated checklist with concrete params for the next
  build pass (`VIEW_PRESETS.<level>` nudges, `setMix` suspects, tier upgrades).
- Captures/diffs per run: `$TMPDIR/parity-loop/run-N/` (scratch, pruned after
  24h idle — the log is the durable record).

## Constraints

No git/npm, no `src/ring2` changes, never :5173/:5175. Board missing =
reported gaps, never failures.
