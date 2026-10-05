#### Modal
**Purpose**
Blocking dialog for a single focused task (import data, add a profile) that keeps the page behind it inert until confirmed or dismissed. 21 `Modals` instances in the library index plus 30 dialog frames measured live.

**Anatomy**
- **Scrim** — page dimmer behind the dialog; no token exists, see `## Gaps`.
- **Dialog surface** — `color.surface.card`, radius `radius.lg`, border `color.border.default`, padding `spacing.xl`, shadow `elevation.3` (measured 0 32 32 rgba(38,50,56,.32)).
- **Title block** — title `font.ui`/`font.display` in `text.2xl` at `fontweight.bold`, subtitle `text.md` at `fontweight.semibold`, both `color.text.primary`.
- **Close control** — 48×48 square, fill `color.surface.page`, radius `radius.md`, icon `text.md`.
- **Content region** — tabs (`tab.md`), field grid (`field.md`), upload/dropdown controls; gap `spacing.md`.
- **Divider** — full-width `color.border.default` hairline above the footer.
- **Footer** — right-aligned action pair: neutral `button.md` (secondary) + primary `button.md` (`color.brand.navy`), gap `spacing.md`.

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Dialog, medium | FRAME `Modal` 538×468 | 2 | 538×468, fill #ffffff, stroke 1 #e1e1e1, r=16, pad 20; title 24 Nunito Bold + sub 16 Nunito SemiBold; close 48×48 #f3f3f4 r=10; footer Btn 96×43 #e1e1e1 + 131×43 #0f3b66 | import/confirm dialog with tabs + upload |
| Dialog, large | FRAME `Modal` 700×694 | 3 | 700×694, same chrome, title 28 Barlow SemiBold, content pad 12, 2-column field grid, footer 238×43 | create/edit form dialog |
| Dialog, compact | FRAME `Modal` 379×472 | 2 | 379×472 | narrow confirmation |
| Dialog, wide | FRAME `Modal` 1154×688 / 1084×671 / 1092×653 | 1 each | up to 1154×688 | data-heavy layouts |
| Library index strip | SYMBOL `Modals` (master of instance `Modals`) | 21 | 11842×37 strip, one child `Group` | **not** a dialog — it's the component-library row that labels modal thumbnails; no anatomy to inherit |

**States**
| State | Behavior |
|---|---|
| Default | Scrim down, dialog at `elevation.3`, primary action focused-forward. |
| Hover | Close control fills `color.surface.input`; buttons follow `button.md`. |
| Active / Focus | Focus trapped inside the dialog; ring `color.brand.sky` on each stop. |
| Disabled | Non-primary buttons disabled while submitting (`button.md` disabled state). |
| Loading | Primary button enters `button.md` loading; footer stays put, content dims to `color.text.muted`. |
| Error | Inline `color.semantic.danger` message above the divider; dialog stays open. |
| Dismiss | `Esc` + close control + scrim click all route to the same cancel path (except destructive confirmations). |

**Token Usage**
| Property | Token |
|---|---|
| Dialog surface | color.surface.card |
| Dialog border | color.border.default |
| Dialog radius | radius.lg |
| Dialog padding | spacing.xl |
| Dialog shadow | elevation.3 |
| Title size | text.2xl |
| Title weight | fontweight.bold |
| Title color | color.text.primary |
| Subtitle size | text.md |
| Subtitle weight | fontweight.semibold |
| Close control fill | color.surface.page |
| Close control radius | radius.md |
| Close hover fill | color.surface.input |
| Content gap | spacing.md |
| Divider | color.border.default |
| Footer gap | spacing.md |
| Primary action | color.brand.navy |
| Secondary action fill | color.surface.input |
| Error message | color.semantic.danger |
| Focus ring | color.brand.sky |
| Dimmed content | color.text.muted |

**Dos and Don'ts**
- One dialog per decision: modal content may compose `field.md`/`tab.md`, never another modal.
- Footer is always right-aligned, cancel-left of confirm; the primary is the only `color.brand.navy` element in the dialog.
- Never use a dialog for reading — long content belongs in `card.md`/`list-row.md` on the page.
- Keep the measured padding pair (`spacing.xl` shell / `spacing.md` content gap); don't inset content by eye.

**Accessibility**
- `role="dialog"` + `aria-modal="true"`, labelled by the title (`aria-labelledby`), description wired via `aria-describedby`.
- Focus is trapped while open, restored to the trigger on close; background is `inert`/`aria-hidden`.
- `Esc` closes; the close control has an accessible name and a `spacing.sm` hit area inside its 48px frame.
- Title at `text.2xl` must be the first heading in the dialog and must not be clipped at 200% zoom.

## Gaps
- **Scrim/overlay color has no token.** The live file's `Overlay` node is a legacy #c4c4c4 rect with a drop shadow, not a usable scrim; `color.*` has no `overlay`/`scrim` key, so the dimmer must borrow `color.neutral.10` (or similar) at an opacity the contract can't express.
- **24px title** appears in the medium dialog (`Import OQ data`) but `text.*` jumps `text.xl` (20) → `text.2xl` (28); the measured 24 has no key.
- **No opacity token** exists for the scrim, the 4% header tint, or the @40% inactive tab label — all three are measured with explicit alpha in the file.
