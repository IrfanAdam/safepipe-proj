#### List Row
**Purpose**
One record stretched across the page width — the repeating unit inside every list: leading icon, title, meta line, trailing action, with a selected state. 77 instances across 9 masters (`Workstream` 39 + `Asset lineitem` 30 + `Valve set` 8).

**Anatomy**
- **Row surface** — fill `color.surface.card`, radius `radius.md` (measured r=12 on `Workstream` / `Asset lineitem`), border `color.border.default` (measured 1px #f0f0f0, stroke align inside) or no border on the dense form; padding `spacing.lg` inline / `spacing.md` block, gap `spacing.md` (measured 16/12/12, gap 12).
- **Leading icon** — 16–20px, `color.text.secondary`, separated from the content by `spacing.md`.
- **Title** — `font.ui`, `text.sm` at `fontweight.medium`, `color.text.primary` (measured 14 Barlow Medium #000000).
- **Meta line** — `text.xs` in `color.text.secondary` (measured 12 Barlow Medium #9e9e9e, "12 Tasks · 32 Crew members"), gap `spacing.sm` inside its group (measured 10), content stack gap `spacing.xs` (measured 6).
- **Qualifier chips** — `tag.md` chips on a row with gap `spacing.base` (measured `OQ Providers` 76×16 + 46×16, gap 4).
- **Divider** — hairline in `color.border.default` before the trailing region (measured `LINE Divider` 385×0 at opacity 0.1).
- **Trailing action** — single `text.md` icon in `color.text.secondary`; the row itself is the link target.
- **Dense form** (`Asset lineitem`) — 555×44, radius `radius.md`, no divider, leading 20px icon + one `Collapsed=Yes` workstream line (495×19), padding 12/16, gap 12.
- **Record-height form** (`Valve set`) — radius `radius.lg` (r=16), fill `color.surface.card`, border `color.border.default` (measured 2px #f3f3f4), padding `spacing.lg` all sides (measured 16), gap `spacing.sm` (measured 8): key/value pair at `text.lg` `fontweight.semibold` (measured 18 Barlow SemiBold), meta lines at `text.sm` `color.text.secondary` (measured 14 #828282), a `status.md` chip, and an expiry line in `color.semantic.warning` (measured "32 days" #ff8c39).

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Row, default | `Selected=No, View=Default` (`Workstream` 445×91) | 33 | 445×91, r=12, fill #ffffff, stroke 1 #f0f0f0 inside, pad 16/12, gap 12; title 14 Barlow Medium, meta 12 #9e9e9e, 2 chips, divider @10%, trailing icon 16 | unselected workstream row |
| Row, selected | `Selected=Yes, View=Default` | 4 | 445×91, stroke 1.7 #f0f0f0, "12 Tasks" switches to #43a9ef | selected — thicker stroke + brand-blue count |
| Collapsed group header | `Collapsed=Yes` (`Workstream` 499×19) | 2 | 499×19, no surface, title 14 #0f3b66 + count 12 #9e9e9e, nested `Tasks` list 539×98 | section header inside a list, not a record |
| Dense line item, default | `Selected=No` (`Asset lineitem` 555×44) | 24 | 555×44, r=12, fill #ffffff, no stroke, pad 12/16, gap 12; icon 20 + `Workstream` line 495×19 | compact asset line |
| Dense line item, selected | `Selected=Yes` (`Asset lineitem` 555×44) | 6 | 555×44, r=12, fill #ffffff, same children | selected dense line |
| Record row, default | `Selected=No` (`Valve set` 505×150) | 3 | 505×150, r=16, fill #ffffff, stroke 2 #f3f3f4, pad 16, gap 8; "Valve no :" 18 SemiBold, meta 14 #828282, divider @10%, status chip 32×32, "32 days" #ff8c39 | tall record with status |
| Record row, selected | `Selected=Yes` (`Valve set` 505×150) | 1 | 505×150, r=16, same children reordered (divider moves above the status group) | selected record |
| Record tile, default | `Selected=No` (`Valve set` 64×55) | 3 | 64×55, r=16, fill #ffffff, stroke 2 #f3f3f4, no children | collapsed tile shell |
| Record tile, selected | `Selected=Yes` (`Valve set` 64×55) | 1 | 64×55, r=16, fill #ffffff, stroke 2 #f3f3f4, no children | selected tile shell |

Related masters outside this 77: `List` 505×724 (2 instances, vertical stack of `Valve set` rows); `Set` 505×79 (24 instances: `Selected=No` 18 + `Selected=Yes` 6) used by `LHS List - Patrol Main Pipe`.

**States**
| State | Behavior |
|---|---|
| Default | `color.surface.card` on `color.surface.page` with `color.border.default`. |
| Hover | Border `color.border.strong`, trailing icon `color.text.link`, elevation `elevation.1`. |
| Focus | `color.brand.sky` ring at `spacing.xs`, drawn outside the border so it clears the row radius. |
| Selected | Measured as stroke weight 1 → 1.7 plus the meta count switching to `color.brand.sky`; implement as `color.border.strong` + the sky accent, no background flood. |
| Disabled | Fill `color.surface.page`, title and meta in `color.text.muted`, no border emphasis. |
| Loading | Content replaced by skeleton bars in `color.surface.input` at the title (19px) and meta (14px) metrics. |
| Error | Trailing qualifier chip in `color.semantic.danger` from `status.md`; the row surface itself does not change. |

**Token Usage**
| Property | Token |
|---|---|
| Row surface | color.surface.card |
| Collapsed header surface | color.surface.page |
| Border | color.border.default |
| Border (hover / selected) | color.border.strong |
| Row radius | radius.md |
| Record row radius | radius.lg |
| Padding (inline / block) | spacing.lg / spacing.md |
| Stack gap (rows) | spacing.md |
| Content stack gap | spacing.xs |
| Meta group gap | spacing.sm |
| Chip row gap | spacing.base |
| Title font | font.ui |
| Title size | text.sm |
| Title weight | fontweight.medium |
| Title color | color.text.primary |
| Group header color | color.brand.navy |
| Meta size | text.xs |
| Meta color | color.text.secondary |
| Record key/value size | text.lg |
| Record key/value weight | fontweight.semibold |
| Record meta size | text.sm |
| Expiry warning | color.semantic.warning |
| Selected accent | color.brand.sky |
| Divider | color.border.default |
| Leading / trailing icon | color.text.secondary |
| Hover elevation | elevation.1 |
| Focus ring | color.brand.sky |
| Disabled fill | color.surface.page |
| Disabled text | color.text.muted |
| Skeleton fill | color.surface.input |
| Error chip | color.semantic.danger |

**Dos and Don'ts**
- One action per row — the row is a single link; multi-action records belong in `card.md`, and per-row menus live in the trailing slot only.
- Don't nest row surfaces: `Asset lineitem` embeds a `Workstream` title line, never another bordered row.
- Selected is border weight + `color.brand.sky` accent — never a background flood; `color.surface.page` stays the page tone behind the stack.
- Keep meta at `text.xs` (dense) / `text.sm` (record); if a record needs a heading hierarchy it has outgrown the row and becomes a card.
- Rows stack with `spacing.md` between surfaces — `list-row.md` owns the gap, the page owns the section rhythm.

**Accessibility**
- Row is an `<li>` / `<tr>` whose title is its accessible name; when the whole row links, use a real `<a>`/`<button>` around the title rather than a click handler on a `div`.
- Minimum hit height `spacing.2xl` (measured 44 dense / 91 tall are fine; the 19px `Collapsed=Yes` header must be padded out).
- Selected state must not be color-only: add `aria-current="true"` alongside the border-weight change.
- Meta contrast: measured #9e9e9e on white at 12px sits at the 4.5:1 boundary — if `color.text.muted` lands there, promote the row meta to `color.text.secondary`.
- The 10% divider is decorative (`aria-hidden`), and status chips keep the `status.md` rule: color never speaks alone.

## Gaps
- Measured strokes #f0f0f0 (1px row) and #f3f3f4 (2px record) both fold into `color.border.default`; the contract has no border-width token to carry the 1px/2px difference (same issue flagged in `card.md`).
- The selected stroke is 1.7px — a non-integer width no token can express; the spec falls back to `color.border.strong` at `spacing.base`.
- Selected and hover rows have no dedicated fill key: only `color.surface.card` / `color.surface.page` exist, so a "selected row tint" (measured as none in the file) cannot be added without a new surface token.
- Row-shaped masters outside this bucket — `Step` (48 instances: 33+11+2+2), `Set` (24), `Agency forms` (12), `Reports` (3) — repeat the same anatomy under record-type names; if the ranking counted them, `list-row` would rise from 77 to well above `header` (49).
- The `Valve set` 64×55 tile masters ship with no children at all (empty shells), so their inner content is unspecified in the source.
