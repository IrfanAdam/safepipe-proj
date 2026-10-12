# Plan shapes — adapting the kit to non-Phase plan structures

The contracts assume `## Phase N {#phase-N}` plans. Before porting the parse
lane, survey the actual shapes or whole plans render as zero sections and
vanish from the log with no error:

```sh
grep -h '^## ' <plansDir>/*.md | sort | uniq -c | sort -rn
grep -c '^### Task' <plansDir>/*.md
```

## Shape classes and adapter rules

- `## Task N` / `## Step N` heads: widen the section filter from `/^Phase\b/`
  to `/^(Phase|Task|Step)\b/`. Everything downstream (tags, titles, paint)
  already operates on opaque `{head, body}` pairs.
- `### Task N` with no matching `##` sections: fall back to splitting the
  markdown on `^### ` boundaries, keeping only task-headed parts. Do NOT
  guard on prose `##` heads elsewhere in the file — a preamble guard hides
  genuine tasks grouped under context/approach heads (the head filter already
  drops non-task `###`). The fallback only runs when zero `##` task sections
  matched, so double-counting content as both section and parent is impossible.
- Non-task `###` subsections (Risks, Notes, Verify) inside a section are
  prose, not units: pass them through verbatim and never synthesize checkbox
  items from them, or a fully-done plan reads N-1/N and the heading-mark
  synthesis is suppressed by the phantom open item.
- Bare anchors (`task-10` instead of `{#phase-10}`): the raw markdown never
  spells the anchor literally, so verbatim `includes` matching fails and every
  linked commit lands in triage. Fix by synthesizing a canonical token into
  each section body (`Task 10: …` → append `\n{#task-10}`) and into the
  augmented texts map the triage check reads — then `hits`/`unlinked` work
  unchanged.
- Anchor collisions: bare `task-1` is a substring of `{#task-10}`. Match with
  a digit-boundary regex (`(?<![\w-])task-1(?![\d])`), never `includes`.
- Done state without checkboxes: when a section body carries no `- [ ]`
  items, synthesize one from the heading's own `✓ done` / `✗ cancelled`
  mark so `state()`/`buildState()` still report progress. Sections with no
  mark anywhere honestly report empty (open), not done.
- Labels: generalize rail/drawer labels (`Task 01`, `Step 00`, fallback
  `Item NN`) and the card unit word (`N tasks` vs `N phases`, decided per
  plan by whether any section head starts with `Phase`).
- Tip text: `descOf` skips `- ` lines, so a `norm()`-synthesized `- [ ]
  **Title** …` checkbox body describes as empty and the tooltip renders as
  a tiny blank box. Build every `data-tip` as `oneLine(desc || short(head))`
  — single-line markdown-stripped text with a head-title fallback so it is
  never empty — and have the hover handler hide the node when the tip is
  empty. Strip backticks in the short-title path or rail titles leak raw
  `code` fences into the UI.

## Verifying the adapter

Port the contract's unit tests plus shape-specific cases: fenced `##` inside
code blocks, `### Task` fallback, `task-1` vs `task-10` boundary both ways,
heading-mark done/cancelled synthesis, native checkbox passthrough. Then run
the node pipeline simulation from Verification against the real plansDir and
confirm every plan that owns commits yields sections and the unlinked set
contains only genuinely trailer-less commits.
