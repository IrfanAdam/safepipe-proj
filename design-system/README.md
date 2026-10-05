# Design system (Plan A — live `.fig`, 2026-10-05)

Measured from `Safepipe - UI.fig` (14,481 nodes). Live file is authority;
`docs/fig-legacy/design-context.json` is the snapshot starting point.

- `tokens.json` — 66 flat dot-notation keys (`{value, type}`); every color
  occurs ≥5× in live fills/strokes. Light legacy-faithful theme.
- `tokens.css` — v0 dark block untouched; `@import` Barlow + MuseoModerno;
  `--sp-*` block generated from `tokens.json` (dots → dashes, `color.` prefix
  stripped: `color.brand.navy` → `--sp-navy`). App CSS must use
  `var(--sp-*)` only; no raw hex outside this file.
- `components/*.md` — 12 specs (tab, tag, button, field, status, header,
  sidebar, card, modal, search-filter, progress, list-row). Token tables
  reference `tokens.json` keys only (254 refs, 0 unknown).
- `src/components/` — vanilla factory per component (`Tab`, `Tag`, `Button`,
  `Field`, `Status`, `Header`, `Sidebar`, `Card`, `Modal`, `SearchFilter`,
  `Progress`, `ListRow`); each `<slug>.js` starts with `import './<slug>.css'`.
- `gallery.html` — mounts `gallery-a.js` (lane A) + `gallery-b.js` (lane B).

## Consumer contract (frozen)

| Consumer | Uses | Never edits |
| --- | --- | --- |
| Plan B screens | `var(--sp-*)`, `src/components/*` factories | `design-system/` |
| Aliases (Plan B) | `--sp-bg/bg2/surface/line/ink/muted/accent/warn/bad/ok` | — |
| Fixture hooks | `data-lane`, `data-section`, `role=tablist/tab` in gallery | — |

Missing token/variant → file a gap; only Plan A edits `design-system/`.
