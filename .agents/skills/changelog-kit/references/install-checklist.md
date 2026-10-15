# Install checklist — backward-compatible install + forward setup

Two directions, one preflight. Backward: an existing repo with plans and
trailer-less history gets linked without rewriting anything. Forward: a new
repo gets the kit wired so every future commit is linked by construction.

## Backward (existing repo)

1. Copy `templates/tracker.mjs` → host tracker path, `templates/preflight.mjs`
   → host scripts dir. Fill the five `AUTOFIX` values (plans dir, manifest,
   history, retro, TRACKED, continuation); never hand-edit around the markers.
2. Run preflight `--fix`: it creates the retro placeholder, widens TRACKED
   from observed commit paths (never shrinks), wires the build hook, and
   HIGH-confidence auto-retroes explicit `Phase N Task M` subjects onto the
   single plan live at the commit date. Ambiguous commits stay unlinked with
   the exact sha + files named — map them by hand (subject keywords vs phase
   title/tags/tasks; a commit days older than a plan belongs to the plan live
   at its date, never a future plan).
3. Run the tracker twice; assert the second run is timestamp-stable
   (identical plans/commits/wip preserves `generated`).
4. Run `plan-backfill.mjs` once for committed plan versions; assert rerun
   adds 0. History is thin when plans were tracked late — say so in the plan
   close, never claim full provenance before the tracking commit.
5. Run preflight `--check`: must print all-green. Remaining unlinked commits
   are genuinely trailer-less — cite `[plan:<file>#<anchor>]` next time.

## Forward (new repo)

1. Same copy + AUTOFIX configure, plus build AND predev hooks from day one.
2. First commit carries a trailer; every commit after carries exactly one
   `[plan:<file>#<anchor>]` in the SUBJECT (body trailers do not count; two
   trailers means the second is ignored).
3. Manifest-only refresh commits carry NO trailer (they are plumbing-excluded
   only when plan-less — a trailered manifest-only sync is kept as a linked
   entry and every post-commit regen adds one more: perpetual 1-behind dirt).
4. Preflight `--check` rides CI: no writes, fails on trailer gaps, path gaps,
   shapeless plans, or unwired hooks.

## Done when

- `node preflight.mjs --check` all-green; tracker rerun diff-clean; backfill
  rerun adds 0; triage shows 0 untracked (wip alone hidden); new plan file
  appears with zero renderer edits.
