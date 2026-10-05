#### Tab
**Purpose**
Single-select navigation control that switches between views of the same dataset without leaving the page — used in page headers, filter bars, step panels and modals. Most-used component in the file: 766 instances across 27 masters (`Tab` 600 + `Tabs` 98 + `Floating tab` 52 + `Tabs tags` 16).

**Anatomy**
- **Container** — pill or underline shell; fill `color.surface.input` (pill) or transparent (underline), radius `radius.md`, inline padding `spacing.md`, block padding `spacing.sm`, internal gap `spacing.xs`.
- **Label** — `font.ui` in `text.sm` (pill) / `text.md` (underline) at `fontweight.medium`; inactive uses `color.text.secondary`, selected uses `color.text.primary`.
- **Data indicator** — small trailing dot, fill `color.brand.sky`, separated from the label by `spacing.xs`.
- **Leading icon** (optional) — sits before the label with `spacing.sm` gap and inherits the label color.
- **Selection affordance** — floating tabs lift off the surface with `elevation.1`; underline tabs switch to full-strength `color.text.primary`.

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Pill, data dot | `Selected=No, Data=Yes, Dot=Yes, Disabled=No` | 199 | 129×25, r=10, fill #edeef9, pad 6/4, label 14 Barlow Medium #828282, dot #43a9ef | compact chip with trailing status dot |
| Pill, no dot | `Selected=No, Data=Yes, Dot=No, Disabled=No` | 23 | 119×25, r=10, fill #edeef9, label #505050 | same pill, dot removed |
| Underline, Medium | `Selected=No, Size=Medium` / `Selected=Yes, Size=Medium` | 153 / 54 | 69×37, r=0, label 16 Nunito SemiBold; inactive #000000 @40%, active #000000 | tab bar item; selection = full-strength label |
| Underline, Large | `Selected=No, Size=Large` / `Selected=Yes, Size=Large` | 46 / 10 | 75×42, label 18 Nunito SemiBold | larger text-only tab |
| Floating | `Selected=No, Hovered=No` / `Selected=Yes, Hovered=No` | 76 / 18 | 140×37, r=16, stroke 2 #000000; selected adds fill #ffffff + shadow 0 4 12 rgba(0,0,0,.07) | raised toggle; selection = `elevation.1` |
| Tab group | `Options=Dashboard` (one of 7 `Options=` masters) | 14 each (98 total) | 287×44 wrapper containing one `Tab` 287×44 | horizontal nav set (`Tabs`) |
| Wrapped pill row | `Rows=3 - 2` (master of `Tabs tags`) | 16 | 399×58, rows of 129/57/197×25 pills | wraps pill tabs onto multiple rows |

**States**
| State | Behavior |
|---|---|
| Default | Container `color.surface.input`, label `color.text.secondary`. |
| Hover | Container darkens one step toward `color.border.default`, label `color.text.primary`. |
| Active / Selected | Label `color.text.primary` at full weight; floating form gains `elevation.1` and `color.surface.card` fill. |
| Focus | Visible focus ring in `color.brand.sky`, offset `spacing.xs`; never remove the ring. |
| Disabled | Label drops to `color.text.muted`, container stays `color.surface.input`; pointer events off. |
| Loading | Not applicable — tabs swap content instantly; the view they control may show `progress.md`. |
| Error | Not applicable at tab level; validation errors belong to the panel below. |

**Token Usage**
| Property | Token |
|---|---|
| Container fill | color.surface.input |
| Selected container fill | color.surface.card |
| Container radius | radius.md |
| Container padding (inline / block) | spacing.md / spacing.sm |
| Container gap | spacing.xs |
| Label font | font.ui |
| Label size | text.sm |
| Label weight | fontweight.medium |
| Label color (default) | color.text.secondary |
| Label color (selected) | color.text.primary |
| Data dot fill | color.brand.sky |
| Floating selected elevation | elevation.1 |
| Focus ring | color.brand.sky |
| Disabled label | color.text.muted |

**Dos and Don'ts**
- Keep one tab set per view: tabs swap content in place, they never navigate to a different page (use links).
- Selection must be visible without color alone — pair the `color.text.primary` weight change with `elevation.1` or an indicator.
- Never stack more than two rows of pill tabs; if it wraps past `Tabs tags` (`Rows=3 - 2`) the IA needs rethinking.
- Use `text.md` for nav tabs and `text.sm` for filter pills — never invent a size between the two.

**Accessibility**
- Wrapper `role="tablist"`, each tab `role="tab"` with `aria-selected`; move focus with roving `tabindex` and arrow keys.
- Minimum touch target `spacing.2xl` square even though the pill itself is smaller — pad the hit area.
- Label contrast: `color.text.secondary` on `color.surface.input` must clear 4.5:1 at `text.sm`; the measured inactive value (#828282 on #edeef9) sits at the edge, so darken rather than lighten.
- Focus ring must remain visible against both `color.surface.card` and `color.surface.page`.

## Gaps
- The underline tab bar (153 + 54 Medium, 46 + 10 Large masters) draws its selected state as full-strength text with **no** underline element and no `color.brand.navy` accent — if the revamp wants an active bar, the color key exists (`color.brand.navy`) but no geometry/indicator token is defined in the contract.
- Two font families carry tab labels in the live file (Barlow for pills, Nunito for tab bars) while the contract exposes a single `font.ui`; see `button.md` Gaps.
