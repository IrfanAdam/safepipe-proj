#### Search / Filter
**Purpose**
The query + narrowing pair that sits above every list: one free-text input, one row of toggleable filter pills. 97 instances across 13 masters (`Search` 36 + `Filter` 33 + `Filters` 16 + `Client filter` 9 + `Filter content` 2 + `Top filter` 1).

**Anatomy**
- **Search field** — `color.surface.card` shell, radius `radius.lg`, border `color.border.default`, inline padding `spacing.xl`, block padding `spacing.md`, gap `spacing.lg`, inset highlight (measured inner shadow, white @25%, offset -4).
- **Leading search icon** — `text.md`, `color.text.secondary`.
- **Placeholder** — `text.sm` + `color.text.muted` (measured 14 in italic Nunito — treat as hint, not content).
- **Filter pill** — `color.surface.card`, radius `radius.md`, padding `spacing.lg`/`spacing.md`, optional 8px `color.brand.sky` dot before the label; label `text.sm` + `color.text.primary`.
- **Filter row** — horizontal stack of pills, gap `spacing.sm` (measured 8), optionally followed by an overflow/clear action.

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Search, default | `Search` | 35 | 388×44, r=16, fill #ffffff, stroke 1 #e1e1e1, pad 20/10, gap 12, icon 24, placeholder 14 Nunito SemiBold Italic #e1e1e1, inner shadow 0 -4 white@25% | the standard list query |
| Search, quiet | `Search` (2nd master) | 1 | 388×44, same chrome, placeholder 14 Barlow Medium #9e9e9e | non-italic placeholder duplicate |
| Filter, idle | `Selected=No` | 27 | 75×37 wrapper → child 75×37 r=12 fill #ffffff | unselected pill |
| Filter, selected | `Selected=Yes` | 4 | 76×37 → child r=12 #ffffff | selected pill (dot + label) |
| Filter, with dot | `Hovered=No` | 2 | 75×37, r=12, stroke 2 #ffffff, pad 16/10, inner shadow, dot 8×8 #43a9ef, label 14 Barlow Medium #505050 | active filter with indicator |
| Filter row — Operations | `For=Operations` | 7 | 539×38, horizontal gap 8 | domain-specific pill set |
| Filter row — Assets / Workforce / Compliance | `For=Assets` / `For=Workforce` / `For=Compliance` | 5 / 3 / 1 | 740×38 / 702×38 / 439×38 | same row, different pills |
| Client / top filter | `Client filter` / `Top filter` | 9 / 1 | contextual wrappers | screen-level compositions |

**States**
| State | Behavior |
|---|---|
| Default | White shell, `color.border.default`, placeholder `color.text.muted`. |
| Hover | Border `color.border.strong`. |
| Active / Focus | Border + ring `color.brand.sky`; placeholder swaps to typed `color.text.primary` value. |
| Filter selected | Pill keeps `color.surface.card`, dot `color.brand.sky`, label `color.text.primary`, border `color.border.strong`. |
| Disabled | Shell `color.surface.page`, placeholder/icon `color.text.muted`; pill label `color.text.muted`. |
| Loading | Shell keeps its width; results count swaps to `progress.md` — never reflow the filter row. |
| Error | Query failure message below the row in `text.xs` + `color.semantic.danger`. |

**Token Usage**
| Property | Token |
|---|---|
| Search fill | color.surface.card |
| Search border | color.border.default |
| Search border (hover) | color.border.strong |
| Search radius | radius.lg |
| Search padding (inline / block) | spacing.xl / spacing.md |
| Search gap | spacing.lg |
| Search icon | color.text.secondary |
| Placeholder | color.text.muted |
| Typed value | color.text.primary |
| Pill fill | color.surface.card |
| Pill radius | radius.md |
| Pill padding (inline / block) | spacing.lg / spacing.md |
| Pill border (selected) | color.border.strong |
| Pill label | font.ui |
| Pill label size | text.sm |
| Pill label weight | fontweight.medium |
| Pill label color | color.text.primary |
| Active dot | color.brand.sky |
| Filter row gap | spacing.sm |
| Focus ring | color.brand.sky |
| Error message | color.semantic.danger |
| Disabled placeholder | color.text.muted |

**Dos and Don'ts**
- Search and filters are one pattern: query narrows the text, pills narrow the facets — don't split them into different rows.
- The active filter must show a dot + border, not color alone; a selected pill is still a button (`role="button"`, `aria-pressed`).
- Never place the placeholder as the only label of the search field — it needs an accessible name (`aria-label` or visually-hidden label).
- Keep the row single-line and wrap to a second row only after the pills from `Filters` (`For=Assets`, 740px) would clip.

**Accessibility**
- Search is `<input type="search">` inside a labelled group (`role="search"`); the leading icon is `aria-hidden`.
- Filter pills are toggle buttons with `aria-pressed`; selected state must be programmatically readable.
- Placeholder contrast at `text.sm` must clear 4.5:1 — the measured #e1e1e1-on-white fails badly, so ship `color.text.muted` only if it passes, otherwise `color.text.secondary`.
- Filter row is a labelled group (`role="group" aria-label="Filters"`); results updates announce via `aria-live="polite"`.

## Gaps
- The search field's inset highlight (INNER_SHADOW, white @25%, offset -4 0) has no `elevation.*` equivalent — `elevation.0..3` are all drop shadows, so the measured inset must be dropped or added as a new key.
- Placeholder colors measured at #e1e1e1 and #9e9e9e are two different grays for the same role; the contract has only `color.text.muted` (plus `secondary`) for it.
- No `text.*` key covers the italic placeholder style (font-style, not a token category) — the contract has no `fontstyle.*` namespace.
