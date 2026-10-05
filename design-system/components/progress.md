#### Progress
**Purpose**
Completion indicator for tasks, qualifications and work orders — a 4px pill bar that lives inside cards, rows and page headers, plus a titled card form that carries the counts. 32 instances across 4 masters (`Knob=No, Progress bar=Yes, Completed=No` violet 26 + `Knob=No, Progress bar=Yes, Completed=No` sky 2 + `Progress` 422×111 2 + `Progress` 120×4 2).

**Anatomy**
- **Track** — full-width rail, fill `color.surface.input` (measured #e2e2e2 / #e1e1e1), radius `radius.md`; measured 237×4 at r=8, so it renders as a pill. No stroke.
- **Fill** — same height and radius as the track, width = percent complete; fill `color.accent.violet` in the dominant master (measured #6663ff, 106 of 237) or `color.brand.sky` in the second (measured #43a9ef, 106 of 237).
- **Knob** — 18px circle, fill `color.surface.card`, radius `radius.full`, centered on the fill end. The `Knob=No` masters ship it with `visible: false` (measured FRAME `Knob` 16×18); `Knob=Yes` turns it on.
- **Counts row** — two `text.sm` labels at `fontweight.medium`: value in `color.text.primary`, remainder in `color.semantic.warning` (measured 14 Barlow Medium, "22 out of 33 OQs aquired" / "11 pending" #d63502).
- **Title row** — `text.md` at `fontweight.medium` in `color.text.primary` (measured 16 Barlow Medium) plus a trailing action link `text.xs` in `color.text.link` with a 24px icon.
- **Card shell** (card form only) — fill `color.surface.page` (measured #f7f8fc), radius `radius.md` (r=12), padding `spacing.xl` on all sides (measured 20), gap `spacing.md` between title / bar / counts (measured 12).
- **Page header form** — the `Type=Progress` 537×48 header: `text.lg` at `fontweight.semibold` for the back action, percent copy `text.sm` in `color.brand.sky` (measured "50 % complete" 14 Barlow Medium #43a9ef), due copy `text.sm` in `color.text.secondary` (measured #828282).

**Variants**
| Variant | Live master | Instances | Measured (live) | Key differences |
|---|---|---|---|---|
| Bar, violet (default) | `Knob=No, Progress bar=Yes, Completed=No` (track #e2e2e2) | 26 | 237×4, r=8, track #e2e2e2, fill 106×4 #6663ff, knob `visible:false`, trailing Base @0% | the in-card completion strip |
| Bar, sky | `Knob=No, Progress bar=Yes, Completed=No` (track #e1e1e1) | 2 | 237×4, r=8, track #e1e1e1, fill 106×4 #43a9ef, knob `visible:false` | brand-blue restatement of the same strip |
| Card form | `Progress` (422×111) | 2 | 422×111, fill #f7f8fc, r=12, pad 20, gap 12; title 16 Barlow Medium; action 12 Nunito SemiBold #020bd6 + 24 icon; bar 382×6; footer 14 with "11 pending" #d63502 | titled progress with counts |
| Segmented strip | `Progress` (120×4) | 2 | 120×4, fill #f7f8fc, r=8; three 4px #43a9ef segments at opacity 1 / .6 / .3 | stepped display, no count text |

Related masters outside this 32: `Knob=Yes, Progress bar=Yes, Completed=No` / `Completed=Yes` / `Progress bar=No` (8 masters total in the flag set, 6 of them unused — 0 instances); `Type=Progress` 537×48 page header (4 instances named `Nav Back`); `Type=Progress` 28×28 radial (2 instances named `Component 2`) → `Type=50%` 28×28 (2 instances named `Variants`) → `Donut` 78×78 (18 instances).

**States**
| State | Behavior |
|---|---|
| Default | Fill at the stored percent over the `color.surface.input` track, knob hidden (`Knob=No`). |
| Hover / scrub | Knob shown (`Knob=Yes` master) — `color.surface.card` circle on the fill end; track and fill unchanged. |
| Complete | `Completed=Yes` master: fill spans 220 of 237 (~93%) with the knob visible; counts row collapses to the done value. |
| Focus | `color.brand.sky` ring at `spacing.xs` around the track when the bar is interactive (knob form). |
| Disabled | Fill `color.border.default`, counts in `color.text.muted`, knob off. |
| Loading | No indeterminate master exists in the file (see Gaps) — hold the last known percent rather than inventing a shimmer. |
| Error | Remainder count switches to `color.semantic.danger`; pending/late stays `color.semantic.warning`. |

**Token Usage**
| Property | Token |
|---|---|
| Track fill | color.surface.input |
| Fill (dominant) | color.accent.violet |
| Fill (brand) | color.brand.sky |
| Bar radius | radius.md |
| Knob fill | color.surface.card |
| Knob radius | radius.full |
| Card shell | color.surface.page |
| Card radius | radius.md |
| Card padding (all sides) | spacing.xl |
| Card gap | spacing.md |
| Title font | font.ui |
| Title size | text.md |
| Title weight | fontweight.medium |
| Title color | color.text.primary |
| Action link | color.text.link |
| Action size | text.xs |
| Count color | color.text.primary |
| Count size | text.sm |
| Count weight | fontweight.medium |
| Remainder color | color.semantic.warning |
| Remainder color (error) | color.semantic.danger |
| Page-header percent | color.brand.sky |
| Page-header due copy | color.text.secondary |
| Header title size | text.lg |
| Header title weight | fontweight.semibold |
| Focus ring | color.brand.sky |
| Disabled fill | color.border.default |
| Disabled text | color.text.muted |

**Dos and Don'ts**
- Ship the count text with every bar — the fill alone never carries the value (the card form's "22 out of 33" is the pattern).
- One bar per record: `card.md` owns the container, `list-row.md` owns the row; progress is always an inner strip, never its own surface.
- Keep the track at `radius.md` and `radius.full` for the knob only — never round the card shell to `radius.full`.
- Incomplete ≠ failed: pending stays `color.semantic.warning`; `color.semantic.danger` is reserved for overdue or errored records.
- Keep the static measured widths (106/237, 220/237) as the reference values — don't animate from zero when the number is known at render.

**Accessibility**
- Bar carries `role="progressbar"` with `aria-valuenow` / `aria-valuemin` / `aria-valuemax`; the counts row is the human-readable equivalent and must exist in the DOM.
- Fill vs track needs 3:1 non-text contrast — measured #6663ff on #e2e2e2 clears it, so re-check `color.accent.violet` against `color.surface.input` once tokens land.
- At 4px the bar is decorative at a glance: minimum count size `text.sm`, never the bar as the only indicator.
- Knob hit area padded to `spacing.2xl` (the circle itself is 18px, far below the 44px target).

## Gaps
- Measured #6663ff (fill on 26 of 32), #e2e2e2 / #e1e1e1 (track) and #f7f8fc (card) have no exact keys; they map to `color.accent.violet`, `color.surface.input` and `color.surface.page`, and the violet delta (#6663ff vs #7b61ff) would recolor every live bar.
- "11 pending" #d63502 matches no semantic key — the warning family measured elsewhere is #ffd439/#ffe605/#ff8c39 (see `status.md` Gaps); a warning-strong variant is needed.
- The 120×4 strip encodes three steps as 100 / 60 / 30% opacity of `color.brand.sky`; the contract has no opacity token, so the segment falloff cannot be expressed.
- The card form's action label is Nunito 12 SemiBold while the contract ships one `font.ui` (same conflict as `button.md` / `tab.md` Gaps).
- Variant flag `Progress bar=No` still renders a visible fill frame, `Completed=Yes` stops at 220/237 (~93%) with no documented end gap, and no indeterminate/loading master exists at all.
