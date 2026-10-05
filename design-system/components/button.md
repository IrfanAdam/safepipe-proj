#### Button
**Purpose**
Primary action trigger for forms, dialogs and toolbars — the only component that commits a change. 98 instances across 9 masters (all named `Btn` in the live file; variants are distinguished by fill, not by name).

**Anatomy**
- **Container** — rounded rectangle, radius `radius.lg`, inline padding `spacing.xl`, block padding `spacing.md`, internal gap `spacing.md`; icon-only form is square with padding `spacing.lg`.
- **Label** — `font.ui` in `text.md` at `fontweight.bold`, `lineheight.lg`; `color.text.inverse` on primary, `color.text.primary` on neutral/ghost.
- **Leading icon** (optional) — `text.md`-scale icon sized to the label, `spacing.md` before the label (measured 24 in a 44px-high button).
- **Fill** — primary `color.brand.navy`, neutral `color.border.default`-family chrome, ghost `color.surface.input`.

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Neutral / cancel | `Btn` (96×43 master) | 31 | 96×43, r=16, fill #e1e1e1, pad 24/12, label 16 Nunito Bold #000000, lh 32px | low-emphasis action (`Cancel`) |
| Primary | `Btn` (141×43 master) | 30 | 141×43, r=16, fill #0f3b66, pad 24/12, label 16 Nunito Bold #ffffff | the single commit action on screen |
| Ghost + icon | `Btn` (162×44 master) | 16 | 162×44, r=16, stroke 2, fill #edeef9, pad 16/10, leading icon 24 #020bd6, label 16 Bold #020bd6 | additive action (`Add to a Crew`) |
| Icon-only | `Btn` (56×48 master) | 16 | 56×48, r=16, fill #e1e1e1, pad 16/12, single 24 icon | toolbar/close button, no label |
| Icon-only variants | `Property 1=Default` / `Property 1=Variant2` | 1 / 1 | 56×48, r=16, fill #e1e1e1 | same square, alternate icon slot |
| Legacy typography | `Btn` (Barlow masters) | 2 | 96×43 / 141×43, label 16 Barlow SemiBold | pre-Nunito duplicates — collapse into the two masters above |

**States**
| State | Behavior |
|---|---|
| Default | Primary `color.brand.navy` + `color.text.inverse`; neutral `color.surface.input` + `color.text.primary`. |
| Hover | Fill darkens one step (`color.brand.navy` → `color.text.link` deepens are not used; keep hue, drop lightness); ghost gains `color.border.default`. |
| Active / Pressed | Fill `color.brand.navy` at full strength with `elevation.0` — no scale transform. |
| Focus | `color.brand.sky` ring, offset `spacing.xs`, radius `radius.lg`. |
| Disabled | Fill `color.surface.page`, label `color.text.muted`, no shadow, `cursor` not-allowed. |
| Loading | Fill stays, label swaps to a spinner at `text.md` metric; button keeps its measured width so the layout doesn't jump. |
| Error | Not applicable at button level — destructive actions use `color.semantic.danger` as the fill, confirmed inline (see `modal.md` footer). |

**Token Usage**
| Property | Token |
|---|---|
| Primary fill | color.brand.navy |
| Primary label | color.text.inverse |
| Neutral fill | color.surface.input |
| Neutral label | color.text.primary |
| Ghost fill | color.surface.input |
| Ghost label | color.text.link |
| Disabled fill | color.surface.page |
| Disabled label | color.text.muted |
| Destructive fill | color.semantic.danger |
| Border radius | radius.lg |
| Padding (inline / block) | spacing.xl / spacing.md |
| Icon-only padding | spacing.lg |
| Gap (icon ↔ label) | spacing.md |
| Label font | font.ui |
| Label size | text.md |
| Label weight | fontweight.bold |
| Label line height | lineheight.lg |
| Focus ring | color.brand.sky |
| Hover border (ghost) | color.border.default |

**Dos and Don'ts**
- One `color.brand.navy` button per screen region — a second primary is a decision, not a style.
- Never use `color.semantic.danger` for anything that isn't destructive or irreversible.
- Icon-only buttons still need an accessible name; the 56×48 square is a target, not a label.
- Keep padding on the `spacing.xl` / `spacing.md` pair — the live file has 24/12 and 16/10 mixes, don't add a third.

**Accessibility**
- Minimum hit target 44×44 (measured heights 43–48 clear it); keep icon-only at `spacing.2xl` width.
- Contrast: `color.text.inverse` on `color.brand.navy` ≥ 4.5:1 at `text.md`; `color.text.link` on `color.surface.input` ≥ 4.5:1.
- Loading state must set `aria-busy="true"` and keep the accessible name; never replace the label with a spinner and nothing else.
- Focus ring must not be clipped by dialog/modal overflow (`modal.md`).

## Gaps
- The live file carries **two** UI families on buttons — Nunito Bold on 94 of 98 instances, Barlow SemiBold on the 2 legacy masters — while the contract exposes one `font.ui` (plus `font.display`). Either `font.ui` must be a stack that includes Nunito, or a second family key is missing.
- `fontweight.extrabold`-adjacent weights aside, there is no `color.*` key for the measured link/ghost blue #020bd6; it is represented here by `color.text.link`.
