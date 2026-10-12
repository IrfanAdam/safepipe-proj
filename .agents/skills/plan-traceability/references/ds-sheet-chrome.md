# DS docs sheet chrome — reference for primitives/library/special

One scannable chrome shared by Library and Special — use it for Primitives and any new Elements sheet. Deviation makes the demo disappear below the fold.

## Order (do not regress)

```
h2 title
p.sub (one sentence — what it is, tokens)
tabs({variant:'line'}) Preview | Code   // Preview HTML is <div class="ds-spec block"><div data-comp-preview>…</div></div>
// specs BELOW tabs, not above
p.sub <span class="tok">What</span> …
p.sub <span class="tok">When</span> …
div.fx-controls (knobs)
```

`h3 What` / `h3 When to use` above tabs pushes the live demo 2 paragraphs down and fails a newcomer's scan — the Library pattern is title → sub → demo immediate.

## Intro lede

Two sentences like Library, not one slash-heavy sentence:

- Bad: "Primitives are the smallest reusable parts — each sheet is one story: what it is, when to use it, then Preview / Code. Tokens live in Code, knobs below." + extra `<p class="sub"><a>← Overview</a></p>`
- Good: "Each sheet is one primitive — what it is, how it looks, and which tokens it uses. Preview is live; Code holds snippet + tokens. Knobs stay below so you can tune without leaving the view." (≤120ch per line, no Overview link — nav already has it)

Special and Library intros are 2 sentences, 25–30 words, knobs note last.

## Preview container

`component.js` and `playground.js` must both wrap preview in `ds-spec block` — hairline + `var(--space-16)` pad + `var(--color-surface)` — the bare `<div data-comp-preview>` floats without a card and fails contrast on small chips (Tag, Badge, Kicker).

## Spec labels

Use inline `tok` labels, not `h3` headings:

```js
`<p class="sub"><span class="tok">What</span> ${anatomy}</p>`
`<p class="sub"><span class="tok">When</span> ${behaviour}</p>`
```

With `margin-top: var(--space-12)` on the first spec line only. `h3` headings read as section breaks and add 22px before each.

## When this matters

Any `component()` or `playground()` sheet that will be browsed via vertical tabs. Apply before opening a PR — reviewers judge pixels, not file lists.
