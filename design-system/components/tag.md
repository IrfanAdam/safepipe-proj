#### Tag
**Purpose**
Compact, non-interactive label that classifies an object — provider, work type, compliance state — so lists stay scannable. 143 instances across 25 masters (`Tag` 101 + `Tags` 42).

**Anatomy**
- **Container** — rounded chip; fill `color.surface.input` (neutral) or a semantic/provider fill, radius `radius.sm`, inline padding `spacing.xs`, block padding `spacing.base`, internal gap `spacing.xs`.
- **Label** — `font.ui` in `text.xs` at `fontweight.bold`, all-caps in status form; color `color.text.inverse` on dark fills, `color.text.primary` on light fills.
- **Leading count/data dot** (optional) — `spacing.xs` before the label; e.g. the provider count (`32 Veriforce`).
- **Trailing overflow chip** — `+2 more` variant collapses long provider lists.
- **Status form** — taller block (`radius.none`), padding `spacing.sm`, uppercase `text.xs` label in `color.text.inverse`.

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Neutral | `Tag` | 12 | 76×16, r=4, fill #edeef9, stroke 1 #000000, label 12 Barlow Bold #000000 | default classification chip |
| Neutral, inverse | `Tag` (2nd master) | 2 | 76×16, r=4, fill #ffffff, stroke #43a9ef, label #43a9ef | selected/outline state |
| Provider, minimal | `Provider=Veriforce, Minimal=Yes` | 22 | 86×16, r=6, fill #9202d6, label 12 Barlow ExtraBold #ffffff | solid provider color, count prefix |
| Provider | `Provider=Eweb, Minimal=Yes` | 19 | 80×16, r=6, fill #d63502, label 12 ExtraBold #ffffff | second provider color |
| Overflow | `Provider=More, Minimal=Yes` | 6 | 63×16, r=6, fill #ffe605, label 12 ExtraBold #000000 | `+2 more` collapse |
| Status | `Status=Non Compliant` / `Status=Grace period` / `Status=Compliant` | 5 / 4 / 3 | 142×26, pad 6, fill #e31919, label 12 Barlow Bold #ffffff uppercase | tall uppercase compliance banner |
| List tag | `Tags=Liquid` / `Tags=Default` / `Tags=Work Order` | 23 / 10 / 3 | group master wraps chip rows (`Rows=3 - 2` pattern) | multi-tag rows inside cards |
| Toggle | `Enabled=Yes` / `Enabled=No` | 4 / 4 | 91×19, r=6, label 12 Bold (on) vs 14 Medium (off) | selectable tag; weight encodes state |

**States**
| State | Behavior |
|---|---|
| Default | `color.surface.input` fill, `color.text.primary` label. |
| Hover | Only for toggle tags: border appears in `color.border.strong`. |
| Active / Selected | Fill switches to the semantic/provider color, label `color.text.inverse`. |
| Focus | Ring in `color.brand.sky` around the chip for toggle tags only. |
| Disabled | Fill `color.surface.page`, label `color.text.muted`. |
| Loading | Not applicable — tags render synchronously. |
| Error | Not applicable; a non-compliant state is expressed as the `Status=` variant, not an error style. |

**Token Usage**
| Property | Token |
|---|---|
| Neutral fill | color.surface.input |
| Neutral label | color.text.primary |
| Inverse label | color.text.inverse |
| Compliance fill | color.semantic.danger |
| Provider fill (accent) | color.accent.violet |
| Overflow fill | color.semantic.warning |
| Selected outline | color.brand.sky |
| Border | color.border.strong |
| Radius | radius.sm |
| Padding (inline / block) | spacing.xs / spacing.base |
| Gap | spacing.xs |
| Label font | font.ui |
| Label size | text.xs |
| Label weight | fontweight.bold |
| Status padding | spacing.sm |
| Disabled label | color.text.muted |

**Dos and Don'ts**
- One color meaning per color: `color.semantic.danger` never appears on a tag that isn't a compliance failure.
- Tags are labels, not buttons — if it filters or navigates it belongs to `search-filter.md` or `tab.md`.
- Keep the label at `text.xs` + `fontweight.bold`; never shrink below `text.xs` to make a tag fit — shorten the word instead.
- Use `color.text.inverse` on any fill darker than `color.border.strong`; don't hand-pick a "close enough" gray.

**Accessibility**
- Static tags get no ARIA role (plain text in context); toggle tags get `role="button"` (or `aria-pressed` on a `<button>`) and a `spacing.sm` minimum hit height.
- Contrast: white on `color.semantic.danger` clears 4.5:1 at `text.xs`; black on `color.semantic.warning` must be used, never white.
- Status must be readable without color — the uppercase label carries the meaning, color reinforces it.

## Gaps
- `fontweight.extrabold` — provider tags (`Provider=Veriforce, Minimal=Yes`, 22 instances) are set in Barlow ExtraBold; the contract tops out at `fontweight.bold`, so ExtraBold must be snapped to `fontweight.bold`.
- The live provider fills (#9202d6, #d63502, #05ffb4, #ffe605) are product-specific brand colors with no contract key; they are represented here by `color.accent.violet` / `color.semantic.warning` and would need `color.provider.*` keys to stay literal.
