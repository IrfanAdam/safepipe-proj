# Safepipe Production-Ready Polish Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make safepipe_proj client-deployable — quality gates green plus visual polish, in one build.

**Architecture:** Two tracks in one pass: (A) quality gates — test script, error/404 handling, meta/PWA hygiene, log cleanup; (B) visual polish — legacy prototype chrome removal, rail icons, token compliance, responsive/a11y sweep. MPA stays (index/gallery/logic/pitch/ops3d + ops3d-verify) with dev harnesses marked noindex, prod routes stay hash-based.

**Tech Stack:** Vite 5 MPA, vanilla ESM, node:test (111 tests), plan-track.mjs manifest.

---

## Current context / assumptions

- Root: `/Users/irfan/Documents/Portfolio Redo/safepipe_proj`, dev server `npm run dev` → http://localhost:5175/ (verified 200).
- `package.json` scripts: `dev: vite --port 5175 --host 0.0.0.0`, `build: node scripts/plan-track.mjs && vite build`. No `test` script — README claims `node --test tests/` = 111 pass.
- `vite.config.js`: MPA entries main/gallery/logic/pitch/ops3d. `ops3d-verify.html` exists on disk but NOT in rollup input. `public/_redirects` covers /logic /pitch /gallery /fig + SPA fallback to /index.html — no /ops3d rule.
- `src/patterns/router.js:51-56`: unknown hash silently falls back to `/operations` — no 404.
- `src/patterns/router.js:64-66`: render catch shows raw `String(err)` + `console.error`.
- `src/ops3d/twin.js:46`, `src/ops3d/twin.js:72`, `src/ops3d/main.js:10`: stray `console.log` in shipped code.
- `index.html:60`: hardcoded `23rd Sept 2021` + `Safepipe · prototype B` label. `src/app.js:8-14` already upgrades the date at runtime if it contains `2021` — remove the legacy string at source.
- `index.html:16-20`: rail icons are empty `<span class="sp-rail-ic">` — no glyphs/text fallback.
- Meta gaps: `index.html` has title/theme script but no `description`, `theme-color`, OG tags; `gallery.html`/`ops3d.html` minimal heads; no `public/favicon.svg`, no `public/robots.txt`, no `public/manifest.webmanifest`.
- `design-system/tokens.css`: Google Fonts `@import` (render-blocking, offline-fragile); dark `:root` block + light `sp-*` block coexist — dark theme coverage unverified.
- `dist/` is gitignored (good) but present locally; `src/ds/plan-manifest.json` currently dirty (`M` in git status).
- Assumption per user steer: ship everything (all 30+ hash routes + gallery/logic/pitch/ops3d), gate dev harnesses with `noindex` rather than removing entries. If wrong, Task 1 decision point covers it.

## Proposed approach

1. Gates first (test script, 404, error UI, log cleanup, meta hygiene) — small, verifiable, no visual churn.
2. Polish second (legacy strings, rail icons, token audit, responsive/a11y) — screenshot-verify on :5175.
3. Close with full `node --test`, `npm run build`, dist smoke check, manifest sync, single plan-linked commit series.

---

### Task 1: Add `test` script + baseline gates green

**Objective:** `npm test` runs the frozen 111-test suite.

**Files:**
- Modify: `package.json`

**Step 1: Read current scripts**

Run: `cat package.json`
Expected: no `test` script.

**Step 2: Add test script**

```json
"scripts": {
  "test": "node --test tests/"
}
```

Keep existing `dev`/`build`/`preview`/`plan:track` byte-identical.

**Step 3: Verify**

Run: `npm test 2>&1 | tail -n 8`
Expected: 111 pass, 0 fail (per `src/logic/README.md`).

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore(safepipe): add npm test script [plan:2026-10-07_120000-safepipe-production-ready.md#task-1]"
```

### Task 2: Unknown-route 404 (no silent fallback)

**Objective:** Bad hashes render a real Not Found state instead of Operations.

**Files:**
- Modify: `src/patterns/router.js:51-70`
- Test: `tests/router.test.js` (new — node:test, pure route-resolution if extracted; else DOM-lite assert via outlet render)

**Step 1: Write failing test**

```js
// tests/router.test.js — assert unknown hash resolves to 404, not /operations
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// If current() is not exported, extract `resolveRoute(hash)` first, then:
import { resolveRoute } from '../src/patterns/router.js';
describe('router', () => {
  it('unknown hash resolves to /404', () => {
    assert.equal(resolveRoute('#/nope'), '/404');
  });
});
```

Run: `node --test tests/router.test.js`
Expected: FAIL — `resolveRoute not defined` / resolves to `/operations`.

**Step 2: Implement minimal change**

```js
// src/patterns/router.js
export function resolveRoute(hash) {
  const h = String(hash || '').replace(/^#/, '') || '/operations';
  return routes[h] ? h : '/404';
}
```

Add route entry:

```js
'/404': { nav: 'Not found', render: (outlet) => {
  outlet.innerHTML = `<section class="sp-empty"><h1>Page not found</h1><p class="sp-meta">That view doesn't exist.</p><a href="#/operations">Back to Operations</a></section>`;
}},
```

`current()` uses `resolveRoute(location.hash)`; `document.title` handles `/404` → `Safepipe — Not found`.

**Step 3: Verify**

Run: `node --test tests/router.test.js` → PASS; `npm test` → all green.
Manual: http://localhost:5175/#/nope shows Not found with back-link.

**Step 4: Commit**

```bash
git add src/patterns/router.js tests/router.test.js
git commit -m "feat(safepipe): 404 for unknown routes [plan:2026-10-07_120000-safepipe-production-ready.md#task-2]"
```

### Task 3: Safe render-error UI (no raw error leak)

**Objective:** Pattern render failures show a friendly retry card, never raw exception text.

**Files:**
- Modify: `src/patterns/router.js:62-67`

**Step 1: Replace catch block**

```js
} catch (err) {
  console.error(`[safepipe] render failed on ${h}`, err);
  outlet.innerHTML = `<section class="sp-empty" role="alert"><h1>Something went wrong</h1><p class="sp-meta">The ${label} view failed to load.</p><button type="button" data-retry>Try again</button> <a href="#/operations">Back to Operations</a></section>`;
  outlet.querySelector('[data-retry]')?.addEventListener('click', render, { once: true });
}
```

No `String(err)` in DOM. Keep `console.error` (error path, not log spam).

**Step 2: Verify**

Manual: break one render locally (throw), reload route → friendly card + Try again works; restore.
Run: `npm test` green.

**Step 3: Commit**

```bash
git add src/patterns/router.js
git commit -m "fix(safepipe): safe render-error card with retry [plan:2026-10-07_120000-safepipe-production-ready.md#task-3]"
```

### Task 4: Remove shipped `console.log` spam

**Objective:** Zero `console.log` in `src/` prod paths; errors stay `console.error`.

**Files:**
- Modify: `src/ops3d/twin.js:46`, `src/ops3d/twin.js:72`, `src/ops3d/main.js:10`

**Step 1: Confirm hits**

Run: `rg -n "console\.log" src/ ops3d.html gallery.html logic.html pitch.html || true`
Expected: the 3 hits above only (plus plan-track.mjs which is a build script — keep).

**Step 2: Fix**

- `twin.js:46` `((id) => console.log(...))` → no-op callback or real `onCreateWO` hook wiring if the button exists; default to removing the log.
- `twin.js:72` → guard behind `?debug` flag or delete.
- `main.js:10` `onSelect` log → delete.

**Step 3: Verify**

Run: `rg -n "console\.log" src/ || echo clean`
Expected: `clean`. `npm test` green.

**Step 4: Commit**

```bash
git add src/ops3d/twin.js src/ops3d/main.js
git commit -m "chore(safepipe): drop shipped console.log spam [plan:2026-10-07_120000-safepipe-production-ready.md#task-4]"
```

### Task 5: Meta / favicon / robots / manifest hygiene

**Objective:** Every MPA entry has description + theme-color + OG basics; repo has favicon, robots, manifest; dev harnesses are noindex.

**Files:**
- Modify: `index.html`, `gallery.html`, `logic.html`, `pitch.html`, `ops3d.html`, `ops3d-verify.html`
- Create: `public/favicon.svg`, `public/robots.txt`, `public/manifest.webmanifest`

**Step 1: index.html head**

```html
<meta name="description" content="Safepipe — oil & gas pipeline operations: network overview, integrity, work orders." />
<meta name="theme-color" content="#0f3b66" />
<meta property="og:title" content="Safepipe — Operations" />
<meta property="og:description" content="Pipeline network overview, integrity, and work orders." />
<meta property="og:type" content="website" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="manifest" href="/manifest.webmanifest" />
```

**Step 2: Dev harnesses noindex**

`gallery.html`, `logic.html`, `ops3d.html`, `ops3d-verify.html` get:

```html
<meta name="robots" content="noindex, nofollow" />
```

plus matching description + favicon link. `ops3d.html` title `Ops 3D — dev harness` → `Ops 3D — Safepipe` (keep URL).

**Step 3: New public files**

`public/favicon.svg` — simple pipe/S mark on `--sp-navy` rounded square (inline SVG, no emoji).
`public/robots.txt`:
```
User-agent: *
Allow: /
```
`public/manifest.webmanifest`: name Safepipe, short_name Safepipe, display standalone, theme_color #0f3b66, icons → /favicon.svg (any maskable).

**Step 4: Verify**

Run: `npm run build && rg -l "noindex" dist/gallery.html dist/logic.html dist/ops3d.html && ls dist/favicon.svg dist/robots.txt dist/manifest.webmanifest`
Expected: all present.

**Step 5: Commit**

```bash
git add index.html gallery.html logic.html pitch.html ops3d.html ops3d-verify.html public/favicon.svg public/robots.txt public/manifest.webmanifest
git commit -m "feat(safepipe): meta/favicon/robots/manifest hygiene [plan:2026-10-07_120000-safepipe-production-ready.md#task-5]"
```

### Task 6: Drop legacy prototype chrome (2021 date, prototype B)

**Objective:** No `2021` / `prototype B` strings in shipped UI.

**Files:**
- Modify: `index.html:60`, `src/app.js:8-14`

**Step 1: index.html**

```html
<div class="sp-datebar"><span id="sp-date"></span><span>Safepipe</span>...
```

Remove `prototype B` qualifier; leave `#sp-date` empty for JS to fill.

**Step 2: src/app.js**

Always paint current date (keep try/catch + `en-GB` format), drop the `.includes('2021')` legacy branch:

```js
try {
  const el = document.getElementById('sp-date');
  if (el) el.textContent = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
} catch { /* date optional */ }
```

**Step 3: Verify**

Run: `rg -rn "2021|prototype B" index.html src/app.js || echo clean`
Manual: http://localhost:5175/ datebar shows today's date + `Safepipe`.

**Step 4: Commit**

```bash
git add index.html src/app.js
git commit -m "fix(safepipe): drop legacy 2021/prototype chrome [plan:2026-10-07_120000-safepipe-production-ready.md#task-6]"
```

### Task 7: Rail icons — real glyphs + a11y names

**Objective:** Primary rail is usable without CSS (text fallback) and labelled for AT.

**Files:**
- Modify: `index.html:15-24`, `src/styles/main.css` (rail icon rules)

**Step 1: Add text fallbacks**

```html
<a href="#/operations" data-route="/operations" title="Operations" aria-label="Operations"><span class="sp-rail-ic" aria-hidden="true">OP</span></a>
```

Same pattern for Workforce (WF), Assets (AS), PIP (PIP), Home (HM). Keep classes so existing CSS keeps working; glyph font/icons can upgrade later.

**Step 2: Verify**

Manual: disable CSS → rail still reads OP/WF/AS/PIP/HM; VoiceOver/tab order sane; `aria-label`s unchanged.
Screenshots: rail close-up before/after.

**Step 3: Commit**

```bash
git add index.html src/styles/main.css
git commit -m "fix(safepipe): rail icon fallbacks + labels [plan:2026-10-07_120000-safepipe-production-ready.md#task-7]"
```

### Task 8: Token + responsive + a11y sweep

**Objective:** No raw colour hex outside `design-system/tokens.css`; core screens usable at 360px and keyboard-only.

**Files:**
- Audit: `src/styles/*.css`, `src/components/*.css`, `gallery.css`
- Modify: whatever fails the audit (additive token refs only — never rewrite the DS)

**Step 1: Audit**

Run: `rg -n "#[0-9a-fA-F]{3,8}" src/styles src/components gallery.css --glob '!tokens.css' | head -n 40`
Expected: list raw-hex offenders (ops3d harness inline `#0b0c0c` in `ops3d.html:8` is allowed as dev-harness chrome — note it, move only app CSS).

**Step 2: Fix app CSS to `var(--sp-*)`**; add missing focus-visible styles for rail links, buttons, modal close; check 360×800 for horizontal scroll on Operations/Workforce/Assets/PIP/Home.

**Step 3: Verify**

Run: audit command returns only allow-listed hits. Manual keyboard tab-through + 360px screenshots.

**Step 4: Commit**

```bash
git add src/styles src/components gallery.css
git commit -m "fix(safepipe): token compliance + focus/responsive sweep [plan:2026-10-07_120000-safepipe-production-ready.md#task-8]"
```

### Task 9: Build entries + redirects decision lock

**Objective:** `ops3d-verify.html` and `/ops3d` deploy correctly (or are explicitly dev-only).

**Files:**
- Modify: `vite.config.js`, `public/_redirects`

**Step 1: Decide (keep default):** add `ops3d-verify` + `ops3d` to rollup input and `_redirects`:

```js
ops3dVerify: resolve(__dirname, 'ops3d-verify.html'),
```

```
 /ops3d.html  /ops3d.html  200
 /ops3d-verify.html  /ops3d-verify.html  200
```

If the user instead wants them dev-only, skip the input addition and add `noindex` (already done in Task 5) — record the decision in the commit message.

**Step 2: Verify**

Run: `npm run build` → dist contains all 6 html entries; `node scripts/plan-track.mjs` clean.

**Step 3: Commit**

```bash
git add vite.config.js public/_redirects
git commit -m "chore(safepipe): lock MPA entries + redirects [plan:2026-10-07_120000-safepipe-production-ready.md#task-9]"
```

### Task 10: Full verification + manifest sync + screenshots

**Objective:** One green pass, clean manifest, pixel evidence.

**Files:** none (verification only) except regenerated `src/ds/plan-manifest.json` if dirty.

**Step 1: Run gates**

```bash
npm test          # expect 111+ pass (incl. new router test), 0 fail
npm run build     # expect vite build clean, all entries in dist/
```

**Step 2: Dist smoke**

```bash
ls dist/*.html && rg -l "noindex" dist/gallery.html dist/logic.html | cat
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5175/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5175/#/nope
```

**Step 3: Screenshots (user judges on pixels)**

Capture on :5175: Operations, Workforce, 404 state, datebar/rail close-up, 360px mobile pass. Attach to phase output for approval.

**Step 4: Close out**

```bash
git add -A && git status --short
# commit manifest sync separately if dirty:
git commit -m "chore(ds): sync plan manifest [plan:2026-10-07_120000-safepipe-production-ready.md#task-10]"
```

Mark each task `### Task N ✓ done` + shipped sha in this plan file before finishing.

## Files likely to change

`package.json`, `src/patterns/router.js`, `tests/router.test.js`, `src/ops3d/twin.js`, `src/ops3d/main.js`, `index.html`, `gallery.html`, `logic.html`, `pitch.html`, `ops3d.html`, `ops3d-verify.html`, `public/favicon.svg`, `public/robots.txt`, `public/manifest.webmanifest`, `src/app.js`, `src/styles/main.css`, `src/styles/screens.css`, `src/components/*.css`, `vite.config.js`, `public/_redirects`, `src/ds/plan-manifest.json`.

## Tests / validation

- `npm test` — 111+ pass, 0 fail (frozen logic + new router test).
- `npm run build` — vite 5 clean, 6 html entries in `dist/`, favicon/robots/manifest copied.
- Manual on http://localhost:5175/: 5 core screens, `#/nope` 404, error card, theme toggle persist, 360px + keyboard pass.
- `rg` audits: no `console.log` in `src/`, no `2021|prototype B` in app shell, no raw hex in app CSS.

## Risks, tradeoffs, open questions

- Shipping all 30+ hash routes as prod surface is large; mitigated with 404 + noindex on harnesses, no route deletions in this pass.
- Google Fonts `@import` stays (offline risk) — self-hosting fonts is a follow-up, not this build.
- `dist/` stays gitignored; deploy from `npm run build` artifact.
- Dark theme token coverage is audit-only here; full dark-mode QA is a follow-up.
