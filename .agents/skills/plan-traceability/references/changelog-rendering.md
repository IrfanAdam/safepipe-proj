# Changelog Rendering — DOM/Surface Rules

Depth for any DS surface that turns plan markdown into interactive HTML (Miller columns, chips, drawer). The always-on SOP lives in SKILL.md; this file holds DOM-structure and CSS lessons that survive renderer rewrites.

## Retained-node paint contract

Any wrapper a renderer depends on must be created ONCE in `render()` and re-filled via `root.querySelector('<col>').innerHTML`, never recreated by an ancestor write. Writing `drawer.innerHTML =` inside `paint()` deletes the drawer's child column nodes — the next paint silently fills a dead node (no error, empty list). If two panes show simultaneously (rail + tasks), keep one `data-col` wrapper per pane and write each via its own query.

## Browser-verified interaction loop

Before committing a renderer change that carries module state (`stage`, `sel`, `open`), drive the full navigation path and judge behavior only after a fresh page load:

1. `location.reload()` first — Vite HMR keeps the previous module instance, so stale state masquerades as a broken handler.
2. `el.click()` works for buttons inside the page root; document-level key handlers need `document.dispatchEvent(new KeyboardEvent('keydown', {key: '<key>'}))` — dispatching on `window` doesn't reach a document listener.
3. Cycle: card → panes → detail → Prev/Next → close via ✕, scrim click, and Escape separately. Each must work in any order, including close→reopen, because module state carries across.

## TDZ ordering in paint()

Compute every value interpolated into a template literal BEFORE that template — a `const hs` declared after the template that uses it is a strict-mode TDZ ReferenceError that only throws on first interaction (render mounts fine; first click dies). Vite HMR can mask the crash as a silent no-op, so a change can look okay in the dev server and still be broken.

## Line-capped CSS discipline

`src/ds/ds.css` is hard-capped at 100 lines by `scripts/lint-tokens.mjs`. New view-specific blocks (drawer two-pane, rail) typically land 1–4 lines over. Compact by merging selectors onto shared one-liner lines (`.a{} .b{}` on one line, keyframes onto the rule's line) — verify with `wc -l` after each compaction and re-grep the diff that no live selector was dropped while packing (`.ds-drawer-head button` was once silently removed this way).

## Click-index rule for pick lists

Derive a pick's index from `[...col.querySelectorAll('.ds-pick')].indexOf(b)` where `col = b.closest('[data-col]')` — never `[...b.parentElement.children].indexOf(b)`. Any non-button child before the cards (a header div, a note) shifts every index: clicks silently select the wrong or nonexistent phase, which reads as 'some phase cards are not clickable'. Verify by looping over EVERY column parent × pick, not just the first column.

## Cursor-follow tooltip pattern

One tooltip element for the whole surface (`<span class="ds-cursor-tip" hidden>` in `render()`, `position:fixed`, `pointer-events:none`); interactive cards carry `data-tip="<text>"`; a single `mousemove` listener on the root does `e.target.closest('[data-tip]')` and hides on miss. Position at `clientX/Y + pad`, flipping to the cursor's other side when the tooltip rect would overflow the viewport. Never build one absolutely-positioned tooltip per button — per-button nodes duplicate coordinate logic and participate in sibling indexing (click-index rule above).

Tooltip text must be semantic, not terse: build cards use `clip(p.goal, 120)` (Goal first, fallback `p.purpose/title`) and phase rail uses `clip(sprintDesc, 120)` — both ~3 lines at 40ch tip width (`max-width:min(40ch,60vw)`, `font:var(--text-micro)/1.5`). The prior `p.purpose || clip(p.goal,100)` / `clip(90)` was rejected as drastically reduced (~1.5 lines, not helpful); the intermediate `clip(180/160)` was rejected for leaking a 4th-line sliver at the clamp edge (180 chars = 4.5 lines at 40ch). Cap visually with `display:block; max-height:calc(1.5em*3 + var(--space-8)*2); overflow:hidden; box-sizing:border-box; overflow-wrap:break-word; text-wrap:pretty` and keep `line-height:1.5` (not `var(--leading-prose)` fractional) so the clamp hides cleanly — `-webkit-box` with `-webkit-line-clamp:3` leaked a fractional 16.5px sliver under `border-box` padding. Never rely on character count alone to enforce 3 lines; always pair the clip with the CSS max-height clamp, and never use a global `sed "s/Shipped in .*/.../"` to stamp a phase — it rewrites all 9 phases' `*Shipped in*` lines to the same SHA; patch the single target line by its exact old string or by precise file-offset.

## Card layout convention (reviewed)

Iteration card = one flex row: `num + title + tags` with tags pushed right (`margin-left:auto`, `flex:0 0 auto`), title `overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:0 1 auto`. Meta (`date · time · N phases · d/d`) is the `<small>` line — the phases stat sits on the date line, never a third line.

Phase rail card is slimmer: `num + title` row plus a `<small>` with only `d/t` and the commit count — NO tags line and NO per-card footers (early revisions added both; the user rejected them). The phase's hover description belongs in ONE footer at the bottom of the rail, not on each card: make `.ds-rail` a flex column and give the footer `margin-top:auto` so it pins to the pane bottom with a hairline top border; its content re-renders to the currently selected phase's description on every rail click. Footer must render the SAME text the hover popover shows on the changelog page for that sprint — plain paragraph, no heading inside, no sharp/muted status chrome.

Picking the description text: the sprint's italic one-line summary under `## Phase` — NOT the first bold-lead paragraph (that is `*Tags:*` / `*Shipped in …*` metadata). Filter candidate paragraphs to exclude `*Tags:*`, `*Shipped in*`, headings, lists and tables before taking the first match; extract the popover text and the footer text from ONE shared helper so they can never drift apart.

Sprint numbering must match the plan doc verbatim: `Phase 01`-style labels (from the `Phase N` heading), never abbreviations like `P01` — the user rejected the shortened form. Accent semantics: the number slot defaults to `var(--color-accent)` when the phase is complete (`isDone` from d/t) and drops to `var(--color-ink-muted)` when incomplete — the completion signal must survive rail consolidation (re-check the accent rule after any re-layout, since merging card-layout rules has already dropped it once).

Drawer width cap: the two-pane drawer must not exceed 50% of the viewport — `width: min(50vw, var(--size-ds-drawer))`, not 72vw. Wider than half feels like it swallows the page.

## Status-flag plumbing (checkbox rendering, cancelled state)

When plan markdown passes through a normalizer that synthesizes HTML checkboxes from `### Task` heading text:

- The status flag lives in the title (e.g. `✓ done`, `✗ cancelled`) so the d/t count scan and the visual derive from the same source; the visual needs a class hook re-added at norm() time, because raw heading text does not survive into the DOM.
- Emit the flag as `<span class="ds-cancelled">…</span>` — no CSS selector matches text nodes, so a real span class is the only hook. Keep the synthesized checkbox `[x]` so counts read complete; default checkbox styling shows done, and `li:has(.ds-cancelled)` overrides to the dulled state (hollow box, muted ✗ glyph at reduced opacity, dimmed `li`).
- Verify visually in the browser (build + token lint pass does not prove the checkbox paint), and remember the counter treats cancelled as complete — a phase can read 5/5 with only 4 sharp ✓ and 1 dulled ✗.
