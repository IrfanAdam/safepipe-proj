# Supabase Scheduling Migration — live dues without deploys

**Goal:** Deadline picks write to Supabase in ~200ms and push to all open sessions via Realtime, while GitHub Markdown stays canonical for prose and history.

**Architecture:** Client → `POST /api/schedule` (Vercel, service_role) → Supabase `schedules` → Realtime to sessions + DB webhook → `POST /api/sync-due` (server PAT) → GitHub `*Due*` line with `[skip ci]`. Reads boot from bundled markdown, overlay Supabase live.

**Tech Stack:** Vite 5 MPA, Vercel serverless `api/`, Supabase Postgres + Realtime + DB webhooks, existing `normHead` / `findHeadIndex` / `dueEditText` core, GitHub Contents API.

**Tags:** scheduling, supabase, realtime, vercel, github-sync

---

## Why this plan is the one

| Option | Pros | Cons |
|---|---|---|
| Keep GitHub-backed | Zero infra, git is audit log, `/__ds/due` works offline in dev | Every pick = PUT + cold-start seconds + raw CDN lag + Vercel redeploy; polling burns rate limit |
| Supabase server-mediated (chosen) | ~200ms writes, true push, Due-only commits skip deploy, queryable `schedule_events` | New project/keys/RLS/webhook to operate; dual-truth drift if sync lags |

> No Supabase Auth, no direct client writes. Anon key is read-only. All writes go through Vercel with the existing owner check. Rollback = flip read flag to Git-only.

## How to read a phase

- *What the build gains* = one-line outcome.
- Table = tasks + done-when. Details below in `### Task N`.
- `REF GATE` = what to open, what pass means. Gate fails = phase not done.

## Execution map

| Phase | Mode | Depends on | Lanes |
|---|---|---|---|
| 1 — Foundation | sequential, blocking | — | 1 agent |
| 2 — Write path | sequential inside | Phase 1 | 1 agent, parallel with Phase 3 |
| 3 — Read + Realtime | sequential inside | Phase 1 | 1 agent, parallel with Phase 2 |
| 4 — Sync + skip-deploy | sequential | Phases 2 + 3 stable | 1 agent |
| 5 — Cutover + cleanup | sequential | Phase 4 | 1 agent |

> Phases 2 + 3 may run in parallel (disjoint files). All other phases run in order. Never start Phase 4 until 2 + 3 both gate green.

---

## Phase 1 — Foundation: schema, access, inventory {#phase-1}

*Tags: supabase, schema*

*What the build gains:* tables exist, locked down, and every live Due is inventoried before any write path changes.

| # | Task | Done when |
|---|---|---|
| 1 | Schema + RLS SQL | `supabase/schema.sql` creates 3 tables, anon read-only, no direct writes |
| 2 | Apply + prove RLS | Tables present in dashboard, anon SELECT ok, anon INSERT denied |
| 3 | Due inventory (read-only) | Node probe lists every `*Due*` across `.hermes/plans/*.md`, 0 writes |

### Task 1: Schema + RLS SQL

**Objective:** One SQL file defines all scheduling state with safe defaults.

**Files:**
- Create: `supabase/schema.sql`
- Create: `supabase/README.md`

**Contract — do not rename:**
- Key: `(plan_file, section_key)` where `section_key = normHead(head)` from `src/logic/due-overrides.js`.
- Tables: `schedules` (live), `schedule_events` (append-only history), `sync_state` (GitHub sync status).
- RLS: `anon` gets `SELECT` on `schedules` only. No `INSERT`/`UPDATE` policies — writes bypass RLS via `service_role` in `api/`.

```sql
create table if not exists schedules (
  plan_file text not null,
  section_key text not null,
  due date null,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'owner',
  version int not null default 1,
  idempotency_key uuid null,
  primary key (plan_file, section_key)
);
create table if not exists schedule_events (
  id uuid primary key default gen_random_uuid(),
  plan_file text not null,
  section_key text not null,
  due date null,
  actor text not null,
  at timestamptz not null default now(),
  source text not null,
  commit_sha text null
);
create table if not exists sync_state (
  plan_file text not null,
  section_key text not null,
  last_synced_due date null,
  status text not null default 'pending',
  attempts int not null default 0,
  last_error text null,
  github_sha text null,
  updated_at timestamptz not null default now(),
  primary key (plan_file, section_key)
);
alter table schedules enable row level security;
alter table schedule_events enable row level security;
alter table sync_state enable row level security;
create policy "anon read schedules"
  on schedules for select to anon using (true);
```

**Verify:** `node -e "console.log(require('fs').readFileSync('supabase/schema.sql','utf8').includes('schedules'))"` prints `true`.

### Task 2: Apply + prove RLS

**Objective:** Schema live in Supabase with access proven, not assumed.

**Files:**
- Modify: `supabase/README.md` — paste project ref, applied date, anon-key name.

**Steps:**
1. Paste `supabase/schema.sql` into Supabase Dashboard → SQL editor → Run (manual, once).
2. With anon key: `SELECT` from `schedules` succeeds (0 rows ok).
3. With anon key: `INSERT` into `schedules` fails with RLS denial.

**Verify:** screenshots or curl outputs of allow + deny in `supabase/README.md`. No app code touched.

- REF GATE 1: open Supabase tables + `supabase/schema.sql` + `README` proof. Pass = 3 tables exist, anon read ok, anon write denied, zero app diffs.

---

### Task 3: Due inventory (read-only probe)

**Objective:** Baseline every live Due before migration so backfill is exact.

**Files:**
- Create: `scripts/supabase-inventory.mjs` — read-only, never writes.

**Contract:**
- Reuse `split` + `dueOf` from `src/changelog/changelog-parse.js`. No new parsing.
- Output: `{ file, head, section_key, due }` per incomplete section with Due. Invalid dates excluded (same rule as `parseDue`).

**Steps:**
1. Implement probe over `.hermes/plans/*.md`.
2. Run: `node scripts/supabase-inventory.mjs` — Expected: JSON list, count noted.

**Verify:** count matches `grep -r "^\*Due:" .hermes/plans | wc -l`. No file modified (`git status --short` clean except new script).

---

## Phase 2 — Write path: owner-checked Supabase upsert {#phase-2}

*Tags: scheduling, api*

*What the build gains:* picks land in Supabase idempotently without touching GitHub yet.

| # | Task | Done when |
|---|---|---|
| 4 | `POST /api/schedule` validation | Bad file/head/due rejected 400, missing token 401, non-owner 403 |
| 5 | Service-role upsert + events | Retry with same `idempotency_key` returns same version, no duplicate event |
| 6 | Node tests green | `tests/schedule-api.test.js` passes, `due-pipeline.test.js` still green |

### Task 4: Validate + owner gate

**Objective:** Same security posture as `api/due.js`, no weaker.

**Files:**
- Create: `api/schedule.js`

**Contract:**
- Filename: `^[\w][\w\-. ]*\.md$`, no `..` — identical to `api/due.js:92`.
- `due`: reuse `isValidDue` logic (shape + calendar, year ≤ 2099). Copy, don't loosen.
- Identity: caller token → `GET /user` → `login === VERCEL_GIT_REPO_OWNER`, else 401/403.
- Env (server only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Never `VITE_`.

**Steps:**
1. Export `validateScheduleBody(body)` pure for tests.
2. Handler: 405 unless POST; 400/401/403 per contract; on valid, delegate to Task 5 logic.

**Verify:** curl with bad file → 400 `Invalid file`; no token → 401; non-owner token → 403.

### Task 5: Upsert + event log

**Objective:** One pick = one row version bump + one history event, retry-safe.

**Files:**
- Modify: `api/schedule.js`

**Contract:**
- `section_key = normHead(head)` imported from `../src/logic/due-overrides.js` — no forked normalizer.
- Upsert: `version = old.version + 1` on change; same `idempotency_key` returns existing row without bump.
- Insert `schedule_events { plan_file, section_key, due, actor: login, source: 'ui' }` once per new version.
- Response: `{ due, version, updated_at, section_key }` for client overlay.

**Verify:** POST same body twice with same key → same `version` second time; different key + different due → `version + 1`.

### Task 6: Pin with tests

**Objective:** Write path locked against regressions.

**Files:**
- Create: `tests/schedule-api.test.js`

**Cases:**
- valid body ok / traversal file rejected / bad due rejected / empty head rejected.
- `normHead` parity: `" Task  1 "` and `"Task 1 {#task-1}"` resolve per shared core.

**Verify:** Run `node --test tests/schedule-api.test.js tests/due-pipeline.test.js` — Expected: all pass.

- REF GATE 2: POST valid pick in staging → row in `schedules` + event in `schedule_events`; retry same key idempotent; bad inputs rejected; both test files green. Pass = no GitHub commit made by this phase.

---

## Phase 3 — Read + Realtime: live overlay, no reload {#phase-3}

*Tags: realtime, ui*

*What the build gains:* open sessions converge in seconds with selection and filters untouched.

| # | Task | Done when |
|---|---|---|
| 7 | `supabase-schedule.js` fetch + subscribe | Realtime ON → push; OFF → fallback, never throw |
| 8 | Overlay wiring in `pages-changelog.js` | Supabase dues paint over file text; file convergence drops stale |
| 9 | Foreground refresh + same-tab sync | `visibilitychange`/`focus`/`online` refetch; rapid picks last-wins |

### Task 7: Fetch + subscribe module

**Objective:** One module owns all Supabase reads on the client.

**Files:**
- Create: `src/changelog/supabase-schedule.js`

**Contract:**
- `fetchSchedules()` → `GET /api/schedule?list=1` (server reads via service_role, returns `{ "file\u0000key": "YYYY-MM-DD"|null }`). Never expose service key.
- `subscribeSchedules(cb)` → `supabase-js` channel on `postgres_changes` `schedules`. Uses `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only. Returns `unsubscribe()`.
- Never throws: any failure resolves `null` / no-op; caller falls back to `fetchLatestPlanSha` in `src/changelog/plan-source.js`.

**Steps:**
1. Implement fetch with 10s budget, single retry.
2. Implement subscribe with `document.hidden` guard (background tabs quiet).

**Verify:** block network → module returns null, page still renders from bundled markdown.

### Task 8: Overlay wiring

**Objective:** Supabase dues paint exactly where localStorage overrides paint today.

**Files:**
- Modify: `src/changelog/pages-changelog.js` — extend `applyDueOverrides`, don't replace.
- Modify: `src/logic/due-overrides.js` — add `supabaseVerdict` reuse, no TTL change.

**Rules:**
- Precedence: Supabase confirmed > file > localStorage optimistic. File convergence drops any overlay (reuse `overrideVerdict` drop rule).
- Repaint preserves `st.sel`, `st.day`, `st.tags`, open datepicker (reuse existing `snapshotDuePop`/`restoreDuePop`).
- No new colors, no layout changes — data only.

**Verify:** seed one Supabase due → rebuild paints it; clear in Supabase → file value returns after refetch.

### Task 9: Foreground + multi-pick behavior

**Objective:** Slow radio and rapid taps converge, never freeze.

**Files:**
- Modify: `src/changelog/pages-changelog.js`
- Modify: `src/changelog/changelog-events.js` — keep `applyDue` optimistic paint, point commit at `/api/schedule`.

**Rules (carried from smooth-scheduling):**
- Paint instantly + `Saved` at once; commit in background (20s budget, 1 retry, generation counter last-wins).
- `document.hidden` → no poll; `visible`/`focus`/`online` → immediate refetch.
- No blocking overlay on any path.

**Verify:** 3 rapid picks → last wins; offline pick → inline Retry, date intact after refresh.

- REF GATE 3: laptop pick → second session paints in <30s with zero touches, selection intact, no reload, no login prompt. Backgrounded tab refreshes on foreground. `npm run build` green.

---

## Phase 4 — Sync worker: Supabase → GitHub without deploys {#phase-4}

*Tags: sync, vercel*

*What the build gains:* GitHub stays canonical with zero deploy spam and visible sync state.

| # | Task | Done when |
|---|---|---|
| 10 | `POST /api/sync-due` webhook worker | Valid webhook updates one Due line, 409 retried once, else `sync_state=error` |
| 11 | Skip-deploy wiring | Due-only pushes skip Vercel; code pushes still deploy |
| 12 | Sync status in UI | `publishing… → published ✓ / retry` with terse cause, no popup |

### Task 10: Webhook worker

**Objective:** Server-side Due-line sync with no client secrets.

**Files:**
- Create: `api/sync-due.js`

**Contract:**
- Trigger: Supabase DB webhook on `schedules` insert/update → `POST /api/sync-due` with `SUPABASE_WEBHOOK_SECRET` header check.
- GitHub auth: server PAT `DUE_SYNC_TOKEN` (Contents read+write, repo-only). Never user token, never client.
- Edit: import `dueEditText` from `api/due.js` — do not fork. Resolve head via `findHeadIndex`; `found=false` → `sync_state=error('head-not-found')`, no commit.
- Idempotent: file already carries value → mark `ok`, no commit.
- Commit msg MUST contain `[skip ci]`: `chore(sync): due <file> <key> [skip ci] [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]`.
- State: update `sync_state { last_synced_due, status, attempts, last_error, github_sha }` + `schedule_events.commit_sha`.

**Steps:**
1. Verify secret → load row → load GitHub file (`sha` + base64) → `dueEditText` → PUT if changed.
2. On 409/422 sha race: refetch once, re-apply, retry once.

**Verify:** webhook dry-run on one test key → file diff shows exactly one Due line; rerun same payload → no second commit.

### Task 11: Skip-deploy wiring

**Objective:** Schedule sync never redeploys; code always does.

**Files:**
- Modify: `vercel.json` — add `ignoreCommand` alongside existing headers.
- Modify: `scripts/plan-track.mjs` — no shape change; confirm Due-only commits don't break manifest stability.

```json
{
  "ignoreCommand": "git diff --name-only HEAD^ HEAD | grep -v '^.hermes/plans/' | grep -q . && exit 0 || exit 1"
}
```

**Rules:**
- `[skip ci]` in msg is primary; `ignoreCommand` is belt-and-braces for Due-only pushes.
- Verify Vercel docs wording during implementation — if `[skip ci]` unsupported, `ignoreCommand` becomes primary.

**Verify:** push Due-only commit → Vercel dashboard shows skipped; push `src/` change → deploys.

### Task 12: Status + retries

**Objective:** Failures are quiet, visible, and retryable inline.

**Files:**
- Modify: `src/changelog/due-progress.js`
- Modify: `src/changelog/changelog/paint-detail.js`

**Contract:**
- States: `saving(silent) → saved | retry`. Failure renders inline Retry with terse cause (`timeout` / `offline` / `http <status>` / `unchanged` / `head-not-found`), `console.error` full body.
- Retries: webhook 3x exponential server-side; client 1x on write. No auto-popup gate on any async path.
- `sync_state` readable via `GET /api/schedule?sync=<file>` for debugging.

**Verify:** revoke PAT in staging → pick shows Retry with cause; restore PAT → retry succeeds.

- REF GATE 4: valid pick → Supabase row → GitHub Due line within minutes → Vercel skipped → UI `published ✓`. Kill webhook once → status `error` + inline retry, no popup, no lost pick.

---

## Phase 5 — Cutover: backfill, flip, retire {#phase-5}

*Tags: cutover, cleanup*

*What the build gains:* Supabase is live truth, GitHub is synced history, legacy paths are fallback only.

| # | Task | Done when |
|---|---|---|
| 13 | Backfill apply | Every inventoried Due in Supabase with `source='backfill'`, rerun adds 0 |
| 14 | Flip write path | Picks POST to `/api/schedule`; `/api/due` kept one release as fallback |
| 15 | Docs + two-device drill | README updated, drill passes, build green, plan closed |

### Task 13: Backfill apply

**Objective:** No Due left behind.

**Files:**
- Create: `scripts/supabase-backfill.mjs` — reads inventory from Phase 1, writes via service_role.

**Steps:**
1. Run: `node scripts/supabase-backfill.mjs --dry` — Expected: N rows listed.
2. Run: `node scripts/supabase-backfill.mjs --apply` — Expected: N upserted.
3. Rerun `--apply` — Expected: 0 new versions (idempotent).

**Verify:** `SELECT count(*) FROM schedules` equals inventory count; `schedule_events` has N `backfill` rows.

### Task 14: Flip + deprecate

**Objective:** One write path live, old path parked.

**Files:**
- Modify: `src/changelog/changelog-events.js` — POST to `/api/schedule`.
- Modify: `api/due.js` — header comment `DEPRECATED: fallback only, remove after <date>`.
- Modify: `src/logic/due-overrides.js` — keep as offline fallback; Supabase outranks.

**Rules:**
- Keep `/__ds/due` (dev loopback writer) — local authoring still needs it.
- Keep sha-poll + `version.json` self-update as Realtime fallback — never delete fallback in this phase.

**Verify:** pick → Supabase row in <2s → GitHub sync → no Vercel deploy → refresh keeps value.

### Task 15: Docs + drill + close

**Objective:** Sustained operation without tribal knowledge.

**Files:**
- Modify: `docs/` scheduling note — Supabase project, table names, env names, PAT scope, webhook URL, rollback flag.
- Modify: `supabase/README.md` — rotation steps for `DUE_SYNC_TOKEN` + anon key.

**Drill:**
1. Laptop pick → phone converges <30s, no reload.
2. Revoked token → silent logged-out, no nag loop.
3. Offline pick → inline retry, intact after refresh.
4. `npm run build` green, second `plan-track` run diff-clean.

- REF GATE 5 (ship): drill pass on chromium + webkit, zero page errors, Vercel skip proven, build green. Then append `### Task 15 ✓ done <sha>` and close phase.

---

## File map (no other files touched)

| Lane | Files |
|---|---|
| Schema | `supabase/schema.sql`, `supabase/README.md` |
| Write | `api/schedule.js`, `tests/schedule-api.test.js` |
| Read | `src/changelog/supabase-schedule.js`, `src/changelog/pages-changelog.js`, `src/logic/due-overrides.js` |
| Sync | `api/sync-due.js`, `vercel.json`, `src/changelog/due-progress.js`, `src/changelog/changelog/paint-detail.js` |
| Cutover | `scripts/supabase-inventory.mjs`, `scripts/supabase-backfill.mjs`, `src/changelog/changelog-events.js`, `api/due.js` (comment only) |
| Generated (never hand-edit) | `src/ds/plan-manifest.json`, `src/ds/plan-history.json`, `public/version.json` |

## Pitfalls carried forward (binding)

- Single-source matchers: `normHead` + `findHeadIndex` imported from `src/logic/due-overrides.js` everywhere — never fork normalization or server answers head-not-found for heads the client just read.
- `dueEditText` parity pinned by `tests/due-pipeline.test.js` — sync worker imports it from `api/due.js`, never reimplements.
- Anchor rule: bare `task-1` collides with `task-10` — always braced `{#phase-N}` in trailers.
- Manifest second-run must be timestamp-stable or repo never reaches diff-clean.
- No auto-open of login gate on any async path — a popup the user didn't summon is the bug.
- No blocking overlay on any scheduling path.
- Only HTTP 401 clears persisted login; 403/rate-limit keeps session.
- `published` only when painted value equals pick; `live` only when server-returned content applied.
