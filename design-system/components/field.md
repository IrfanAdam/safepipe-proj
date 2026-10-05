#### Field
**Purpose**
Labeled text input for forms and modals — captures one value with a persistent label so validation and read-only states are unambiguous. 84 instances across 14 masters.

**Anatomy**
- **Label** — `font.ui` in `text.xs` at `fontweight.medium`, `color.text.secondary`, sits above the box with `spacing.xs` gap (measured 12 Barlow Medium #828282).
- **Input box** — `color.surface.card` fill, radius `radius.md`, 1px `color.border.default`, inline padding `spacing.lg`, block padding `spacing.md`; measured heights 37 (Small) / 39 (Medium).
- **Value / placeholder** — `font.ui` in `text.md` at `fontweight.medium`; value `color.text.primary`, placeholder `color.text.muted`.
- **Trailing control** (optional) — dropdown caret, date or clear icon at `spacing.md`, sized `text.md`.
- **Read-only mode** — box background drops to `color.surface.page` (transparent in the live master), value steps down to `text.sm`.

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Placeholder, Small | `States=Placeholder, Select=No, Size=Small` | 16 | 288×55 stack, box 288×37 r=12 #ffffff, label 12 #828282, value 16 #9e9e9e, trailing icon 24 | empty input, hint text |
| Entered, Small | `States=Entered, Select=Yes, Size=Small` | 12 | 288×55, box 288×37 r=12, value 16 #000000, icon 16 | filled + trailing control |
| Entered, Medium | `States=Entered, Select=Yes, Size=Medium` | 11 | 288×57, box 288×39 r=12, value 16 #000000, icon 20 | taller form input |
| Entered, no select | `States=Entered, Select=No, Size=Medium` | 10 | 288×57, box 288×39, value 16 #000000 | plain text input |
| Placeholder, Medium | `States=Placeholder, Select=No, Size=Medium` | 4 | 288×57, box fill #f0f0f0, value 16 #000000 | placeholder on tinted box |
| Read only | `States=Read Only, Select=No, Size=Small` | 6 | 288×39, no white box, label 12 #828282, value 14 #000000 | value without editable chrome |
| Textarea / Date / Text | `Types=Textarea` / `Types=Date` / `Types=Text` | 3 / 2 / 2 | 284×123 / 284×55 / 284×55, child radius 12 | input kinds sharing the same label |
| Password (legacy) | `Filled=Yes` / `Filled=No` | 1 / 1 | 389×74, r=60, pad 28/12, label 12 + value 20 Maven Pro, drop shadow | off-system legacy field — do not extend |

**States**
| State | Behavior |
|---|---|
| Default | `color.surface.card` box, `color.border.default` border, value `color.text.primary`. |
| Hover | Border steps up to `color.border.strong`. |
| Active / Focus | Border `color.brand.sky`, ring `color.brand.sky` at `spacing.xs` offset; label turns `color.text.primary`. |
| Disabled | Box `color.surface.page`, value `color.text.muted`, label `color.text.muted`. |
| Loading | Not applicable at field level; async lookups show their own `progress.md` beside the field. |
| Error | Border `color.semantic.danger`, message below in `text.xs` + `color.semantic.danger`; label stays `color.text.secondary`. |

**Token Usage**
| Property | Token |
|---|---|
| Label color | color.text.secondary |
| Label size | text.xs |
| Label weight | fontweight.medium |
| Box fill | color.surface.card |
| Box fill (read-only) | color.surface.page |
| Box border | color.border.default |
| Box border (hover) | color.border.strong |
| Box radius | radius.md |
| Box padding (inline / block) | spacing.lg / spacing.md |
| Label ↔ box gap | spacing.xs |
| Value color | color.text.primary |
| Placeholder color | color.text.muted |
| Value font | font.ui |
| Value size | text.md |
| Value weight | fontweight.medium |
| Read-only value size | text.sm |
| Focus border | color.brand.sky |
| Error border | color.semantic.danger |
| Error message | color.semantic.danger |

**Dos and Don'ts**
- Labels stay visible above the field at every state — placeholders are hints, never replacements (the live `States=Placeholder` masters keep both).
- One `radius.md` box per field; the legacy `Filled=` password field (`r=60`) is off-system and must not be copied.
- Error state changes border + message together; never signal error with color alone or by moving the label.
- Keep Small (37) and Medium (39) as the only heights — don't invent a third from the 44px search field.

**Accessibility**
- Every input has a programmatic label (`<label for>`); the visible label is the accessible name.
- Error message is wired with `aria-describedby` + `aria-invalid="true"`; the field keeps focus after a failed submit.
- Hit height ≥ 44 including padding (measured 37/39 need the vertical padding padded out on touch).
- Placeholder contrast must clear 4.5:1 — the measured #9e9e9e on white is borderline; use `color.text.muted` only if the sibling token is dark enough, otherwise `color.text.secondary`.

## Gaps
- **24px text** is used by the modal title (`Import OQ data`, FRAME `Modal` 538×468) but the contract's `text.*` scale jumps 20 → 28 (`text.xl` → `text.2xl`); a `text.1xl`/`text.24` key is missing.
- No key exists for the legacy Maven Pro password field's elevated `DROP_SHADOW` box; it is intentionally excluded from the system.
