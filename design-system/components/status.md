#### Status
**Purpose**
At-a-glance state indicator — a dot + label for rows, and a composite card that groups compliance counts with their tags. 80 instances across 11 masters (`Status` 50 + `Status dot` 30).

**Anatomy**
- **Dot** — circular indicator, `radius.full`, measured 6×6, fill from the semantic set; the label follows at `spacing.sm`.
- **Label** — `font.ui` in `text.sm` at `fontweight.medium`; `color.text.primary` for the value, `color.text.secondary` for the qualifier.
- **Composite card** (status row) — `color.surface.card` fill, radius `radius.md`, border `color.border.strong`, padding `spacing.md` / `spacing.sm`, gap `spacing.sm`.
- **Tag cluster** — chips from `tag.md` inside the card's `Tags` frame, gap `spacing.xs`.
- **Trailing affordance** — 28px icon/link slot at the end of the row.

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Horizontal card | `Stack=Horizontal, Hovered=No` | 40 | 309×57, r=12, fill #ffffff, stroke 2 #000000, pad 12/10, gap 8, label 14 Nunito SemiBold, 3 tags + 28 icon | default inline status strip |
| Vertical card | `Stack=Vertical, Hovered=No` | 4 | 116×141, r=12, fill #f0f0f0, pad 12/16/12/12, icon above content | narrow rail form |
| Horizontal, tinted | `Stack=Horizontal, Hovered=No` (alt master) | 4 | 309×57, r=12, fill #f0f0f0, stroke #ffffff, label 14 Barlow Medium, tags #bf52f2/#e31919/#ffd439 | tinted/legacy palette duplicate |
| Inline active toggle | `Active=No` | 2 | 49×17, label 14 Barlow Medium #828282 ("Inactive") | text-only status switch |
| Dot — compliant | `Status=Compliant` | 3 | 6×6 circle, fill #5cd052 | success |
| Dot — non-compliant | `Status=Non Compliant` | 3 | 6×6 circle, fill #e31919 | danger |
| Dot — grace period | `Status=Grace period` | 2 | 6×6 circle, fill #ff8c39 | warning |
| Dot — due soon | `Status=Due <30` / `Status=Due 30<` | 10 / 2 | 6×6 circle, fill #ffd439 / #e3eb8e | warning range |
| Dot — data states | `Status=Data upload` / `Status=Incomplete` | 6 / 4 | 6×6 circle, fill #bf52f2 / #0f3b66 | accent / neutral |

**States**
| State | Behavior |
|---|---|
| Default | Dot in semantic color, label `color.text.primary` on `color.surface.card`. |
| Hover | Card lifts to `elevation.1`; trailing affordance reveals `color.text.link`. |
| Active / Focus | Focus ring `color.brand.sky` at `spacing.xs`; status itself doesn't change on hover. |
| Disabled | Dot `color.neutral.0`-family neutral, label `color.text.muted`. |
| Loading | Pending state shows an indeterminate dot pulse in `color.brand.sky` (no spinner token in contract). |
| Error | Non-compliant state uses `color.semantic.danger` dot **plus** the text label — color is never the only cue. |

**Token Usage**
| Property | Token |
|---|---|
| Card fill | color.surface.card |
| Card fill (tinted) | color.surface.page |
| Card border | color.border.strong |
| Card radius | radius.md |
| Card padding (inline / block) | spacing.md / spacing.sm |
| Card gap | spacing.sm |
| Card hover elevation | elevation.1 |
| Dot — success | color.semantic.success |
| Dot — danger | color.semantic.danger |
| Dot — warning | color.semantic.warning |
| Dot — accent/upload | color.accent.violet |
| Dot — neutral/incomplete | color.brand.navy |
| Dot radius | radius.full |
| Dot ↔ label gap | spacing.sm |
| Label font | font.ui |
| Label size | text.sm |
| Label weight | fontweight.medium |
| Value color | color.text.primary |
| Qualifier color | color.text.secondary |
| Disabled label | color.text.muted |
| Focus ring | color.brand.sky |

**Dos and Don'ts**
- Every colored dot ships with its text label — `color.semantic.danger` alone never means "non-compliant".
- Use one card form per list: the Horizontal master (40 of 50 instances) is the default; Vertical is for narrow rails only.
- Don't recolor a status to make it fit a palette — the seven measured dot colors map one-to-one to the semantic keys.
- Keep the composite card at `radius.md` + `spacing.md` padding; it's a row, not a dialog (`modal.md` owns `radius.lg`).

**Accessibility**
- Dot is `aria-hidden`; the visible label carries the meaning (`role="status"` / `aria-live="polite"` when it changes at runtime).
- Success/danger/warning dots need 3:1 against `color.surface.card` for non-text contrast at their 6×6 size — grow the dot to `spacing.sm` if the token fails.
- The composite card's trailing control is a separate tab stop with its own accessible name; don't make the whole card clickable unless it's the row's only action (see `list-row.md`).

## Gaps
- Four distinct warning-family hues are measured (#ffd439, #ffe605, #ff8c39, #e3eb8e) but the contract has a single `color.semantic.warning`; the due/grace distinction is lost unless a `color.semantic.warning-strong` / `-subtle` pair is added.
- Status dot colors #bf52f2 (Data upload) and #5cd052 (Compliant) only approximate `color.accent.violet` and `color.semantic.success`; no dedicated "data state" key exists.
- The measured card stroke is 2px solid `#000000` at full alpha on the horizontal master (likely an opacity hack in the source); the contract has no opacity token, so use `color.border.strong` at its own value.
