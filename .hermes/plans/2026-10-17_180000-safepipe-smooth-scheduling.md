# Smooth scheduling — sticky auth, optimistic save, live sync

**Goal:** Deadline picks feel instant and effortless: login once per device, pick shows Saved in <300ms, every device converges in seconds with no reload, failures surface as quiet inline retry — never a popup loop or a blocking spinner.

**Background:** Today's pipeline commits through `/api/due` (Vercel cold-start + GitHub PUT, seconds), then polls GitHub every 10s behind a full-screen freeze (minutes on mobile radio), while cross-device sync re-fetches all 14 plans via `raw.githubusercontent.com` (CDN-cached ~5min) every 20s. The OAuth token is memory-only by an earlier constraint, so every refresh/tab/device loses it while the user badge persists — the commit path then auto-opens the login gate on every pick.

**Security note (owner decision, Task 1):** persisting the OAuth token in localStorage overturns the earlier memory-only rule. Acceptable here because this is a single-owner site, the token is scoped `read:user public_repo`, and it is revocable in one click under GitHub Settings → Applications. No new scopes, no new secrets, no server-side token store.

---

## Task 1: Sticky login — log in once per device, never auto-nag {#task-1}

**Files:**
- Modify: `src/logic/schedule-auth.js` — persist token (localStorage, e.g. `safepipe-schedule-token`); keep `getSchedToken/setSchedToken` signatures.
- Modify: `src/changelog/schedule-gate.js` — boot-time silent health check (`GET /user`, 10s budget, single attempt); invalid → clear user+token once, render logged-out.
- Modify: `src/changelog/changelog-events.js` — gate opens ONLY on explicit user action (Schedule entry click, or pick while logged out shows inline "Log in to save" affordance). 401/403 on `/api/due` → clear token, one inline re-login affordance with scope note, never an auto-popup.

**Rules:**
- No auto-open of the gate on any async path (pick, retry, poll, boot). A popup the user didn't summon is the bug.
- Logout clears user AND token together (today logout clears both but 401/403 clears token only — unify).
- Old scope-less grants (pre-`public_repo`) get one clear "grant access" message, then behave.

**Verify:** login → refresh keeps session; new tab keeps session; revoked token degrades to logged-out silently; pick while logged out never popups by itself; logout wipes all.

- REF GATE 1: cold-load logged-in, refresh, pick — zero gate opens; revocation drill degrades silently.

### Task 1 ✓ done ac86a68

## Task 2: Optimistic save — Saved instantly, commit in background, no freeze {#task-2}

**Files:**
- Modify: `api/due.js` — success JSON also returns the updated file content (`content`, base64 or utf8) alongside `{committed, repo, branch, fileSha}`.
- Modify: `src/changelog/changelog-events.js` — `applyDue` paints instantly + inline "Saved" at once; the `/api/due` commit runs in background (20s fetch budget, 1 retry, generation counter stays so rapid re-picks resolve last-wins). On success, apply the server-returned content directly to the live body (server truth, no CDN wait, no confirm poll for own picks).
- Modify: `src/changelog/due-freeze.js` — retire the blocking overlay; keep at most a tiny non-blocking sync indicator (or delete the module + its CSS if unused).
- Modify: `src/changelog/changelog/paint-detail.js` — commit states become `saving(silent) → saved | retry`; failure renders inline Retry, never a modal.

**Rules:**
- The pick is never hostage to the network: preview + override apply synchronously before any fetch.
- No screen-blocking UI on any scheduling path. `due-freeze.js` must end deleted or unreachable from pick flows.
- `confirmDueLive` stays for nothing in the own-pick path (repo proof arrives in the commit response); keep the module only if cross-device sync reuses its section check.

**Verify:** pick → "Saved" in <300ms on wifi; offline pick → inline Retry, date intact after refresh; 3 rapid picks → last wins, no stuck `saving…`; zero full-screen overlays in any scheduling flow.

- REF GATE 2: network-throttled (Slow 3G) pick → instant Saved, background commit lands, no freeze, no popup.

### Task 2 ✓ done cfb6e18

## Task 3: Fast cross-device sync — no reload, seconds not minutes {#task-3}

**Files:**
- Modify: `src/changelog/plan-source.js` — add cheap change detection: single GitHub commits-API request `GET /repos/{owner}/{slug}/commits?path=.hermes/plans&per_page=1` (unauthenticated OK for a public repo, no CDN lag); export `fetchLatestPlanSha()` + `fetchFileText(file)`.
- Modify: `src/changelog/pages-changelog.js` — poll the sha every ~15s (not all 14 files); on change, fetch + rebuild only changed files, repaint with selection/filter untouched. Refresh immediately on `visibilitychange` visible / `focus` / `online`. Same-device tabs sync via `storage` event on the override key.
- Keep: the 24h committed-override outranking applies to OWN picks only; drop any override the moment live text carries its value.

**Rules:**
- No polling of `raw.githubusercontent.com` on a timer (CDN staleness is the reload bug). Raw fetch only for a file whose sha just changed, cache-busted.
- Unauthenticated poll budget: 1 req / 15s ≈ 240/hr per device worst-case — stays under the 60/hr unauthenticated cap ONLY if conditional (use `If-None-Match`/ETag on the commits request, or stretch to 30s). Implement ETag caching; fall back to 30s interval without ETag support.
- Background tabs do nothing (`document.hidden` guard stays).

**Verify:** laptop pick → phone shows in <30s with zero touches; backgrounded phone refreshes on foreground; offline→online refreshes; second run of tracker/build unaffected (no manifest shape change).

- REF GATE 3 (ship): two-device drill (laptop pick → phone converges, no reload, no login prompt), chromium + webkit screenshots, zero page errors, `npm run build` green.

### Task 3 ✓ done 1cdecb2

---

## File map (no other files touched)

| Lane | Files |
|---|---|
| Auth | `src/logic/schedule-auth.js`, `src/changelog/schedule-gate.js` |
| Save | `api/due.js`, `src/changelog/changelog-events.js`, `src/changelog/due-freeze.js` (+ CSS if deleted), `src/changelog/changelog/paint-detail.js` |
| Sync | `src/changelog/plan-source.js`, `src/changelog/pages-changelog.js` |
| Maybe-retired | `src/logic/due-deploy-confirm.js` (only if nothing reuses it), `src/changelog/due-freeze.js` |
| Generated (never hand-edit) | `src/ds/plan-manifest.json`, `src/ds/plan-history.json` via build hook |

## Pitfalls carried forward (binding)

- Token in localStorage is owner-approved (see Security note); never log it, never put it in a URL, POST body only to same-origin `/api/due`.
- Plan-file items race a shared worktree — re-read tails before appending; stage explicit paths only.
- Every colour/size via `var(--token)`; logic zero DOM; `--cl-*` page-local bridge rule.
- Feature commit first, regen, then refresh commit; manifest-only refresh carries NO trailer.
- Commits carry `[plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-N]` (braced anchors for N<10).
