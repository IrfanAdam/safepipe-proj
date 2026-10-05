#### Header
**Purpose**
Persistent top bar plus the page-level title blocks that introduce each screen — identity, date, search and the page's primary actions in one band. 49 instances across 3 masters.

**Anatomy**
- **Bar container** — full-width band, `color.surface.card`, height `spacing.3xl` (measured 64), bottom edge tinted `color.brand.navy` at low opacity in the live file.
- **Title block** (section header) — `font.display` in `text.xl` at `fontweight.semibold`, `color.text.primary`, over a `text.sm` + `color.text.secondary` "last updated" line, closed by a `color.border.default` divider.
- **Meta row** — inline stats: value in `color.brand.sky`, qualifier in `color.text.secondary`, both `text.sm`.
- **Right cluster** — date (`text.sm`), notification/search icons at `text.md`, and a 32px avatar with `radius.full`.
- **Toolbar form** — search field from `search-filter.md` followed by icon buttons (`button.md`, `spacing.md` gap).

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| App bar | `Header` (1440×64 master) | 28 | 1440×64, BG rect 1440×92 fill #163267 @4%, inner `Main` 1058×32 with 24 icons + 32 avatar, date 14 Nunito SemiBold lh 28px #000000 | global chrome: identity, date, alerts, avatar |
| Section header | `Header` (435×88 master) | 12 | 435×88, vertical gap 10, overline 14 Barlow Medium #828282, title 20 Barlow SemiBold #000000, meta 14 with #43a9ef value, trailing `Divider` line | introduces a content block |
| Toolbar header | `Header` (505×48 master) | 9 | 505×48, horizontal gap 10: Search 306×48 r16 #ffffff, Btn 56×48 #e1e1e1 ×2, Btn 56×48 #d7d8eb | list toolbar: search + actions |

**States**
| State | Behavior |
|---|---|
| Default | `color.surface.card` band, `color.text.primary` title, `color.border.default` divider. |
| Hover | Icon buttons take `color.surface.input` background (`button.md` hover rules). |
| Active | Current page title at `fontweight.semibold`; siblings drop to `fontweight.medium`. |
| Focus | Ring `color.brand.sky` on the focused icon/button only — the bar itself is never focusable. |
| Disabled | Action icons drop to `color.text.muted` with `aria-disabled`. |
| Loading | Date/meta line swaps to `color.text.muted` placeholder text of the same `text.sm` metric. |
| Error | Not applicable; failure messages live in the content region below the header. |

**Token Usage**
| Property | Token |
|---|---|
| Bar background | color.surface.card |
| Bar tint | color.brand.navy |
| Bar height | spacing.3xl |
| Title font | font.display |
| Title size | text.xl |
| Title weight | fontweight.semibold |
| Title color | color.text.primary |
| Overline / meta size | text.sm |
| Meta color | color.text.secondary |
| Meta value color | color.brand.sky |
| Divider | color.border.default |
| Cluster gap | spacing.md |
| Icon button fill | color.surface.input |
| Avatar radius | radius.full |
| Search / button radius | radius.lg |
| Section gap (title block) | spacing.md |

**Dos and Don'ts**
- One app bar per screen; the section-header form (12 instances) lives *inside* content, never at the window edge.
- The title block carries at most one `text.xl` heading — a second heading of the same size means the page has two owners.
- Don't put commit actions (`button.md` primary) in the app bar; the toolbar form is for search/sort/add only.
- Keep the divider `color.border.default` — the live file also draws dividers at full black in some screens, which is a legacy artifact.

**Accessibility**
- App bar is `<header>` with `role="banner"` (one per page); section headers are `<h2>`+`<header>` inside `<main>`.
- Icon-only controls in the right cluster need accessible names and a `spacing.sm` minimum hit target.
- The title must be in the document outline (heading level, not a styled `<div>`), and sticky bars must not obscure focused content — offset scroll for `:target` and focus.
- Date/meta text stays `color.text.secondary` on `color.surface.card` at ≥ 4.5:1 (`text.sm`).

## Gaps
- No `elevation.*` or `color.*` key covers the measured 4% navy band tint (#163267 @0.04); it is expressed here as `color.brand.navy` applied at low opacity, and the contract has **no opacity token** to do that with.
- The live file has three header heights (64, 88, 48) that map to `spacing.3xl`, `spacing.2xl` and `spacing.xl` only by coincidence — a dedicated `size.header.*` key would be more honest than overloading spacing.
