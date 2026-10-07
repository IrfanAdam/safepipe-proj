# Plan A — Safepipe Design System extracted from `.fig`

> **For Hermes:** implement with a fresh subagent. Parallel-safe: owns `design-system/` only.
> Runs alongside Plan B (screens) and Plan C (logic).

**Goal:** Token + component library reverse-engineered from `Safepipe - UI.fig`, live-queried so nothing drifts.

**Architecture:** Snapshot (`docs/fig-legacy/design-context.json`) is the starting point; the live `.fig`
is the authority — every value is re-verified against the binary before it enters the system.
Tokens land as flat dot-notation JSON + regenerated `tokens.css`; components as spec sheets + vanilla
implementations in `src/components/` per `ARCHITECTURE.md` layer rules.

**Tech Stack:** Node 20, `openfig-core` (live queries), vanilla CSS/JS, `node --test`, `npm run build`.

---

## Step 0 — Live-fig query setup (copy-paste, independent per agent)

```bash
FIG="/Users/irfan/Documents/2023 before/Figs/Clarity/Safepipe - UI.fig"
mkdir -p /Users/irfan/.hermes/cache/scratch/sp-ds && cd /Users/irfan/.hermes/cache/scratch/sp-ds
npm init -y >/dev/null 2>&1 && npm install openfig-core
```

```js
// q.mjs — reuse for every gate below
import { readFileSync } from 'fs';
import { parseFigBinary, nodeId } from 'openfig-core';
const FIG = "/Users/irfan/Documents/2023 before/Figs/Clarity/Safepipe - UI.fig";
export const doc = parseFigBinary(new Uint8Array(readFileSync(FIG)));
export const nm = (n) => n.name ?? '';
```

> Rule: on any conflict between snapshot and live query, **live wins**, and `docs/fig-legacy/design-context.json`
> gets patched in the same commit (Plan A owns that patch).

## Task 1 — Token JSON from live fills, fonts, and styles ✓ done

*Shipped in ba00e7f · design-system/tokens.json (66 keys) · task-1.*

**Objective:** Produce `design-system/tokens.json` grounded in measured values.
**Files:** Create `design-system/tokens.json`. Read-only: live `.fig`, `docs/fig-legacy/design-context.json`.

1. Query live: histogram of SOLID fills (expect `#0f3b66`, `#43a9ef`, `#7b61ff`, `#e31919` in top 25),
   font families (expect Barlow > 1,400 hits), font-size peaks (12/14/16/18/20/28/36).
2. Write `design-system/tokens.json` (flat dot-notation), minimum keys:
   `color.brand.navy #0f3b66`, `color.brand.sky #43a9ef`, `color.accent.violet #7b61ff`,
   `color.semantic.danger #e31919`, full neutral ramp from measured grays,
   `font.ui "Barlow"`, `font.display "MuseoModerno"`, `text.*` sizes 12/14/16/18/20/28/36 with
   line-heights sampled from live `lineHeight` fields, `spacing.*` 4pt base, `radius.*`, `elevation.*`.
3. Verify: `node -e` assert every hex in tokens.json occurs ≥5× in the live file. Expected: PASS.

## Task 2 — Regenerate `tokens.css` (light, legacy-faithful) ✓ done

*Shipped in ba00e7f · design-system/tokens.css (`--sp-*`) · task-2.*

**Objective:** CSS variables implement the JSON; prototype screens consume `var(--sp-*)`.
**Files:** Modify `design-system/tokens.css` (keep v0 dark vars untouched); create `design-system/README.md` stub if missing content.

1. Map JSON → `:root` as `--sp-*` (e.g. `--sp-navy`, `--sp-text-md: 14px`). Light theme: surfaces white/`#f3f3f4`/`#fafafa`, ink `#101418`.
2. Add Barlow + MuseoModerno via Google Fonts `<link>` (with system-font fallback stack).
3. Verify: `npm run build`. Expected: exit 0. Grep: no raw hex outside `tokens.css` in new code.

## Task 3 — Component specs from live masters (top 12 by instance count) ✓ done

*Shipped in ba00e7f · design-system/components/*.md (12 specs) · task-3.*

**Objective:** Spec sheets for Tab, Tag, Btn, Field, Status, Header, Sidebar, Card, Modal, Search/Filter,
Progress, Table/List-row — each with anatomy, variants (from `SYMBOL` variant names like
`Selected=No/Yes`, `Filled=No/Yes`), states, token table.
**Files:** Create `design-system/components/*.md` (one per component).

1. Per component: live-query 2–3 master SYMBOLs ( sizes, fills, cornerRadius, text sizes) + count instances.
2. Follow the `design-system-builder` spec template (purpose, anatomy, variants table, states, token usage, dos/don'ts, a11y).
3. Verify: each spec's token table references only keys existing in `tokens.json` (script-check). Expected: 0 unknown.

## Task 4 — Build `src/components/` implementations + gallery proof ✓ done

*Shipped in ba00e7f · src/components/ (12+1) + gallery.html · task-4.*

**Objective:** Vanilla JS/CSS implementations, one file per component, token-only styling.
**Files:** Create `src/components/<name>.js` + `src/components/<name>.css`; create `gallery.html` mount.

1. Implement from specs (Task 3), no hardcoded values.
2. `gallery.html` renders every component in all variants/states (mount-only file, no styling of its own).
3. Verify: `npm run build` exit 0; serve + `curl -s http://127.0.0.1:5175/gallery.html | grep -o "<title>[^<]*</title>"` → 200 + title. Screenshot each component; eyeball against `docs/fig-legacy/*.png`.

## Task 5 — Contract publish + drift gate ✓ done

*Closed 2026-10-07 · gate: 18/18 token hexes ≥5× in live `.fig` (fills+strokes via openfig-core, 14,481 nodes); 46 spec token refs, 0 unknown in tables (3 prose gap notes filed in tag.md/field.md); `npm run build` exit 0 · task-5.*

**Objective:** Freeze the consumer contract and prove it matches the live file.
**Files:** Modify `design-system/README.md` (contract table: var names, component tags, fixture hooks).

1. Run full gate: token coverage (Task 1 assert) + spec token-check (Task 3) + `npm run build`.
2. Commit: `git add design-system src/components gallery.html docs/fig-legacy/design-context.json`.

**Merge notes:** Plan B consumes `var(--sp-*)` + `src/components/*` (read-only use, never edits).
Plan C consumes nothing from A. If B/C need a missing token/variant, they file it as a gap list —
only Plan A edits `design-system/`.
