# Parallel lanes — 4-way fan-out for changelog-kit installs

One `delegate_task` call, 4 children, file-disjoint scopes. Parent owns shared
shell/manifest/index, all gates, all commits, plan close-out. Children never
run git, trackers, or repo-wide codegen.

## Parent pre-wire (before dispatch)

- Stub modules children replace (exact paths), mount points in shell, guarded
hooks (`if (window.X)`) so each lane self-activates on landing.
- Put versions, entry mechanism, function signatures to preserve, and verify
URL inline in every child context. Children know nothing of parent chat.
- State line budgets and naming rules inline in each context.

## Lane A — tracker

Scope: tracker script (from `templates/tracker.mjs`), manifest path, retro
file, build/predev hooks, continuation record. Own files only.
Context must include: TRACKED paths, manifest path, retro path,
continuation id, GENERATED exclusions, shallow-merge requirement.
Done when: two consecutive runs, second diff-clean; linked count printed.

## Lane B — parse (pure, tested)

Scope: chunks/split/norm/state/isDone/buildState, date helpers, tag
taxonomy, title/provenance helpers. No DOM.
Context must include: plan filename regex, phase heading shape, task mark
shapes (done/cancelled), closed tag set, title cap (~76ch).
Done when: fixtures pass (fenced `##` inside code block, done/cancelled
tasks, native checkboxes, multi-tag phases, legacy filenames).

## Lane C — views (DOM)

Scope: calendar graph, build cards, rail + detail panel, chips, events
(click/key/hover), cursor tooltip, triage block. Reads parse + link layers;
never edits them.
Context must include: state shape, visiblePlans/visiblePhases rules,
click-index rule (index within pick list scoped to column), TDZ rule
(compute badge lists BEFORE template), drawer open/close paths.
Done when: every card x every rail phase opens correct detail; Escape /
scrim / button close; day + tag filters renumber sequence.

## Lane D — chrome + gates

Scope: shell markup/mount points, names map `{file: {title, purpose}}` plus
gate script (0 missing), responsive behavior, docs page, build-hook wiring
check. Never touches lanes A–C files.
Done when: gate green, build green, new plan appears with no renderer edit.

## Parent integrate (after batch returns)

- Child summaries are self-reports: verify every file (tests, lint, build,
renders) before wiring.
- Wire shared files, run gates + visual capture, commit per phase with the
covering plan trailer, close plan phases (done/cancelled + shipped lines).
- Stop runaway children and integrate what landed; steer once on budget
overruns ('split by extraction into <named file>') rather than rewriting.
