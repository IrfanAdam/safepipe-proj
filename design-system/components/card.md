#### Card
**Purpose**
Elevated surface that groups one record — an inspection, work order or report — with its status, tags and metadata, so list pages scan as a stack of equal-weight objects. 33 instances across 6 masters (`Background Card` 16 + `Cards` 12 + `Card` 2 + `Inspection` 3).

**Anatomy**
- **Surface** — `color.surface.card`, radius `radius.lg`, border `color.border.default`, padding `spacing.md` / `spacing.lg`, shadow `elevation.2` (measured two drop shadows: 0 3 5 and 0 8 24, rgba(176,190,197,.32)).
- **Title** — `font.ui` in `text.lg` at `fontweight.semibold`, `color.text.primary` (measured 18 Barlow SemiBold).
- **Subtitle / meta** — `text.sm` + `color.text.secondary`, may carry a `color.semantic.danger` qualifier.
- **Tag row** — `tag.md` chips, gap `spacing.xs`.
- **Progress strip** — optional `progress.md` bar spanning the content width.
- **Footer row** — divider + avatar stack + `color.text.secondary` attribution line; trailing action icon at `text.md`.
- **Stack container** — `Cards` frame: vertical, gap `spacing.md` (measured 12), no surface of its own.

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Background surface | `Background Card` | 16 | 368×248, fill #ffffff (fill hidden in source), shadows 0 3 5 + 0 8 24 rgba(176,190,197,.32) | bare elevated shell other content sits on |
| Inspection / WO card | `Selected=No` (master of `Inspection`) | 3 | 505×185, r=16, fill #ffffff, stroke 2 #f0f0f0, pad 12/18/12/12, gap 6, title 18 SemiBold, sub 14 #828282, tag + progress + divider + profiles + `Status` row | full record card |
| Card stack | `Cards` (505×1665) | 8 | vertical gap 12, children 504.5×185/266/187/197/211, r=16 #ffffff | list of cards, no own surface |
| Split-stat row | `Cards` (708×181) | 3 | horizontal `Row` 676×181 of 4 × `Split tab` 160×181 r=18 fill #e1e1e1, container pad 16 | equal-width stat tiles |
| Report stack | `Cards` (505×479) | 1 | vertical gap 12, 3 × `Reports` 504.5×146/163 #ffffff | report cards |
| Dashboard tile | `Card` (master) | 2 | 240×378 over `Background Card` 240×378, body `16 sp • Body 1` + `14 sp • Body 2` + icon + counter | KPI tile with bubble chart |

**States**
| State | Behavior |
|---|---|
| Default | `color.surface.card` on `color.surface.page`, `elevation.2`. |
| Hover | `elevation.3`, border `color.border.strong`, action icon `color.text.link`. |
| Active / Focus | Focus ring `color.brand.sky` at `spacing.xs`; the whole card is focusable only when it is a single link. |
| Selected | Border `color.brand.navy` at `spacing.base` weight + `elevation.2`. |
| Disabled | Surface `color.surface.page`, text `color.text.muted`, no shadow. |
| Loading | Body replaced by skeleton blocks in `color.surface.input` at the title/subtitle metrics. |
| Error | Inline message in `color.semantic.danger` at `text.sm` under the title (measured usage: "You are not qualified to edit"). |

**Token Usage**
| Property | Token |
|---|---|
| Surface | color.surface.card |
| Page behind card | color.surface.page |
| Border | color.border.default |
| Border (hover) | color.border.strong |
| Selected border | color.brand.navy |
| Radius | radius.lg |
| Padding (inline / block) | spacing.lg / spacing.md |
| Stack gap | spacing.md |
| Shadow (default) | elevation.2 |
| Shadow (hover) | elevation.3 |
| Title font | font.ui |
| Title size | text.lg |
| Title weight | fontweight.semibold |
| Title color | color.text.primary |
| Subtitle size | text.sm |
| Subtitle color | color.text.secondary |
| Error text | color.semantic.danger |
| Action link | color.text.link |
| Tag gap | spacing.xs |
| Skeleton fill | color.surface.input |
| Focus ring | color.brand.sky |
| Disabled text | color.text.muted |

**Dos and Don'ts**
- One record per card; if you need to compare fields across records use `list-row.md` instead.
- Cards never nest — a card may contain tags/progress/status chips, but never another card surface.
- Keep `elevation.2` as the resting shadow and `elevation.3` only on hover; stacking two resting shadows visually doubles the elevation.
- Title stays `text.lg`; page titles belong to `header.md` (`text.xl`).

**Accessibility**
- Card is a `<article>`/`<section>` with a heading; if the whole card links, make the heading's link the target rather than wrapping everything.
- Hover affordance must have a focus equivalent — focus ring `color.brand.sky` at the same offset.
- Text contrast: `color.text.secondary` on `color.surface.card` ≥ 4.5:1 at `text.sm`; the danger qualifier clears 4.5:1 on white.
- Avatar stacks in the footer need text alternatives (names), not `alt=""` decoration, when they identify people.

## Gaps
- The `Split tab` stat tile (`Cards` 708×181) uses `#e1e1e1` at r=18 — between `radius.lg` (16) and `radius.full`; no token matches r=18.
- `Background Card` ships with its white fill **hidden** (`visible: false`) and relies purely on two drop shadows; the contract's `elevation.*` values must reproduce both shadow layers or the shell disappears on `color.surface.page`.
- Measured card border is 2px `#f0f0f0` while the modal/header borders are 1px `#e1e1e1`; there is one `color.border.default` key but no border-width token to express the difference.
