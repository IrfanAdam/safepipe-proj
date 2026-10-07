# Plan B — Safepipe web prototype: replicated screens + flows

> **For Hermes:** implement with a fresh subagent. Parallel-safe: owns `index.html`, `src/patterns/`,
> `src/data/`, `src/styles/` (never edits `design-system/`, `src/components/`, `src/logic/`).
> Runs alongside Plan A (DS) and Plan C (logic).

**Goal:** Clickable web-first prototype replicating the legacy screens, section-for-section, verified
live against the `.fig` so layout never drifts.

**Architecture:** One Vite MPA-ish shell (`index.html` with hash routes `#/operations`, `#/workforce`,
`#/assets`, `#/pip`, `#/home`). Screens compose `src/components/*` (built by Plan A; until they land,
stub same-named local shims in `src/patterns/_shim.js` — deleted at integration). Data from `src/data/`
fixtures (shape frozen below; Plan C upgrades them to logic-backed later). Every screen ends with a
section-presence check against a live render of the source frame.

**Tech Stack:** Vanilla JS + CSS, hash routing, `var(--sp-*)` tokens, Chrome headless screenshots.

---

## Step 0 — Live-fig setup + screen-frame locator (copy-paste)

```bash
FIG="/Users/irfan/Documents/2023 before/Figs/Clarity/Safepipe - UI.fig"
mkdir -p /Users/irfan/.hermes/cache/scratch/sp-proto && cd /Users/irfan/.hermes/cache/scratch/sp-proto
npm init -y >/dev/null 2>&1 && npm install openfig-core
```

Reuse the wireframe renderer at `/Users/irfan/.hermes/cache/scratch/figextract/render.mjs` as the
oracle: `node render.mjs` re-renders source frames on demand. Reference renders live in
`docs/fig-legacy/*.png` (ops-desktop, workforce-desktop, pip-readonly).

> Rule: before building a screen, re-render its source frame live and diff the section list against
> `docs/fig-legacy/legacy-fig-context.md`. New sections found → build them, then patch the md.

## Task 1 — Shell + routing + fixtures

**Objective:** Hash router with 5 routes and fixture data matching the legacy demo personas.
**Files:** Modify `index.html`; create `src/patterns/router.js`, `src/data/fixtures.json`.

1. Fixture shape (frozen contract with Plan C): `{ client: {name}, staff: [{name, role, location, certs, exp, workload:{wos, tasks}}], workOrders: [{id, system, title, status, county, dueInDays, lastInspected, assignee, equipment[]}], pipelines: [{name, tabs[], sections[]}] }`. Seed with Motiva enterprises / Raymond Rangel / Nueces Bay / `Pipeline Patrol Main Pipe` (values verified live: TEXT nodes with those exact strings must exist — assert).
2. Router: `#/operations` (default), `#/workforce`, `#/assets`, `#/pip`, `#/home`; left nav rail + top date bar shell per legacy.
3. Verify: `npm run dev -- --port 5175` in background; `curl -s http://127.0.0.1:5175/ | grep -o "<title>[^<]*</title>"` → 200. All 5 routes render without JS errors.

## Task 2 — Operations work-order detail (`#/operations`)

**Objective:** Section-for-section replica of source frame `Operations` 1440×810 (Desktop - UI page).
**Files:** Create `src/patterns/operations.js` (+css).

1. Live-render oracle, then build left (map placeholder + toolbar + tabs) and right (client → assignee →
   WO card with due pill, status line, last-inspected line → equipment checklist → start/end times → tabs).
2. Flow: clicking equipment checkboxes updates a progress pill; tabs switch content panes.
3. Verify: screenshot at 1440×810 vs `docs/fig-legacy/ops-desktop.png` — checklist: nav rail ✓, date bar ✓,
   WO card fields ✓, equipment rows ✓, tabs ✓. `npm run build` exit 0.

## Task 3 — Workforce master-detail (`#/workforce`)

**Objective:** Replica of source `Workforce` 1440×810: list (`All the Workforce / Seeing all 423 staff`,
search, member rows with `In progress N WOs, M tasks`) → profile (certs, location, exp, tab strip).
**Files:** Create `src/patterns/workforce.js` (+css).

1. Flow: search filters list live; selecting a member swaps the detail panel; tabs switch panes.
2. Verify: screenshot vs `docs/fig-legacy/workforce-desktop.png` checklist (list header, search row,
   member card, profile header, info card, tab strip). `npm run build` exit 0.

## Task 4 — PIP fact-sheet record (`#/pip`) + Assets (`#/assets`)

**Objective:** Tabbed record (Upcoming / History / Fact sheet / Constructions / Data) with all 14 legacy
sections (Correspondence, ROW & Permits, …, HCA Mapping); Assets screen as card grid from `Cards` page.
**Files:** Create `src/patterns/record.js`, `src/patterns/assets.js` (+css).

1. Assert live that all 14 section headers exist as TEXT ≥15px in source `PIP` frame before building.
2. Flow: record tabs switch; asset cards link to `#/pip`.
3. Verify: section-presence script (14/14 strings in DOM). `npm run build` exit 0.

## Task 5 — Mobile Home (`#/home`) + integration

**Objective:** 375×812 Home replica (tabs + client card); then swap shims for real Plan A components
and Plan C logic.
**Files:** Create `src/patterns/home.js`; delete `src/patterns/_shim.js` at integration.

1. Build Home against source `Home` 375×812 frame.
2. Integration (gated on A + C done): replace shim imports with `src/components/*`, replace fixture
   mutations with `src/logic/*` calls (signatures frozen in Plan C); no visual change allowed —
   re-run all Task 2–4 screenshot checklists.
3. Commit: `git add index.html src/patterns src/data src/styles`.

**Merge notes:** Read-only consumer of `design-system/`, `src/components/`, `src/logic/`. Missing
token/component/logic → gap list appended to the plan file, never local forks.

## Gap list for Plan A/C (appended by Plan B subagent, 2026-10-05)
- `src/components/*` empty at build time → screens use `src/patterns/_shim.js` (pill, memberRow, woCard, tabStrip, sectionBlock). Delete shim at integration when Plan A lands.
- `design-system/` has only `tokens.css` (no `--sp-*` tokens yet) → `src/styles/screens.css` maps `--sp-*` to legacy vars with fallbacks. Swap fallbacks when Plan A freezes `--sp-*`.
- `src/logic/` has only `ontology.js` → equipment progress, workforce search/select, tab panes are local DOM state in pattern modules; rewire to `src/logic/*` calls when Plan C freezes signatures (no visual change).
- Screenshots: no headless browser in this env → verification done via jsdom DOM string/section-presence checks (54/56 raw, 2 misses are `&amp;` escaping only) + `npm run build` exit 0. Re-run pixel checklist vs `docs/fig-legacy/*.png` where Chrome is available.
- Staged (not committed): `index.html src/patterns src/data src/styles` per plan.
