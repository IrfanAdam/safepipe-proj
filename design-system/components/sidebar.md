#### Sidebar
**Purpose**
Persistent left navigation rail that keeps the primary sections one click away while content scrolls. 28 instances across 7 masters — every live master is the minimized (icon-only) form.

**Anatomy**
- **Rail** — fixed-width column, `color.surface.card`, full viewport height, shadow `elevation.1` on the content edge (measured drop shadow 0 8 16 rgba(7,35,46,.04)).
- **Logo slot** — top of the rail, `spacing.lg` inset, `radius.none` (measured 20×32 mark).
- **Client avatar** — `radius.full` circular button, `spacing.sm` below the divider (measured 48×44, r=32).
- **Nav item list** — vertical stack of `tab.md` items (measured 60×44 each), gap `spacing.xs`, grouped by `color.border.default` dividers into primary (top) and utility (bottom) sections.
- **Active indicator** — selected item uses the `tab.md` selected state (fill + `color.text.primary`).

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Rail — Workforce | `Tab=WF, Minimized=Yes` | 7 | 60×810, fill #ffffff, drop shadow 0 8 16 rgba(7,35,46,.04), `Content` 60×364 + bottom `Tabs` 60×88, items 60×44 | icon rail with WF marked active |
| Rail — Operations | `Tab=Ops, Minimized=Yes` | 7 | 60×810, identical structure | active section = Ops |
| Rail — Assets | `Tab=Assets, Minimized=Yes` | 6 | 60×810 | active section = Assets |
| Rail — Settings | `Tab=Settings, Minimized=Yes` | 5 | 60×810 | active section = Settings |
| Rail — Dash / Reports / Programs | `Tab=Dash…`, `Tab=Reports…`, `Tab=Programs…` | 1 each | 60×810 | remaining active sections |

**States**
| State | Behavior |
|---|---|
| Default | `color.surface.card` rail, nav labels `color.text.secondary`. |
| Hover | Item fills `color.surface.input`, icon `color.text.primary`. |
| Active | Item selected per `tab.md`: `color.surface.card` + `color.text.primary` + `elevation.0`. |
| Focus | `color.brand.sky` ring inside the item, `spacing.xs` offset — never on the rail itself. |
| Disabled | Item label `color.text.muted`, no hover fill; hidden destinations are removed, not disabled. |
| Loading | Section switch shows `progress.md` in the content region; the rail never spins. |
| Error | Not applicable; failed loads report in content. |

**Token Usage**
| Property | Token |
|---|---|
| Rail background | color.surface.card |
| Rail shadow | elevation.1 |
| Rail width | spacing.3xl |
| Section divider | color.border.default |
| Item height | spacing.3xl |
| Item radius | radius.md |
| Item gap | spacing.xs |
| Item padding | spacing.sm |
| Item label color | color.text.secondary |
| Item label (hover) | color.text.primary |
| Item hover fill | color.surface.input |
| Item font | font.ui |
| Item size | text.sm |
| Item weight | fontweight.medium |
| Avatar radius | radius.full |
| Focus ring | color.brand.sky |

**Dos and Don'ts**
- The rail is navigation, never a container for actions — commit buttons belong in the header toolbar or content.
- Keep the minimized rail as the only collapsed form: the live file has **zero** expanded `Minimized=No` instances, so an expanded drawer must be specced before it ships.
- Nav items reuse `tab.md` exactly (measured items are `Tabs` instances) — don't fork a second nav item style.
- One active section at a time; nesting a second highlight inside the rail breaks the `Tab=` variant model.

**Accessibility**
- `<nav aria-label="Primary">` with a list markup (`<ul>`/`<li>`); current page gets `aria-current="page"`.
- Minimized items are icon-only: each needs an accessible name and a tooltip; hit target ≥ `spacing.3xl` square.
- Collapsed rail width must not push content below `color.text.primary` contrast — labels never render at `color.text.muted` on the active item.
- Keyboard order runs logo → avatar → primary items → utility items, matching DOM order.

## Gaps
- Every live master is `Minimized=Yes` (28/28 instances); there is **no expanded-sidebar master** in the file, so the label-bearing form has no measured sizes to derive from.
- The rail width (60px) and item height (44px) only approximate `spacing.3xl`; the contract has no `size.*` namespace for component dimensions.
