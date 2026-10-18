# Supabase scheduling — setup log

## Project

- Provider: Supabase via Vercel Marketplace (recommended) or supabase.com
- Project ref: _fill in after provisioning_
- Applied `supabase/schema.sql` on: _fill in date_

## Keys (Vercel env, never commit)

- `SUPABASE_URL` — server + webhook
- `SUPABASE_SERVICE_ROLE_KEY` — server only (`api/schedule.js`, backfill)
- `VITE_SUPABASE_URL` — client (same as SUPABASE_URL)
- `VITE_SUPABASE_ANON_KEY` — client read-only
- `SUPABASE_WEBHOOK_SECRET` — random string, checked in `api/sync-due.js`
- `DUE_SYNC_TOKEN` — GitHub fine-grained PAT (Contents read+write, this repo only)

## Prove RLS (verified 2026-10-18)

- anon SELECT from `schedules` → `[]` ok; `schedule_events` → `[]`; `sync_state` → `[]`
- anon INSERT into `schedules` → denied `42501 row-level security policy`
- Inventory: `node scripts/supabase-inventory.mjs` → 3 Dues, matches `grep -rh "^\*Due:"` exactly

## Webhook

- Supabase → Database → Webhooks → Create:
  `POST https://<site>/api/sync-due`, event insert+update on `schedules`,
  header `x-webhook-secret: <SUPABASE_WEBHOOK_SECRET>`.

## Realtime publication (one line, SQL editor)

```sql
alter publication supabase_realtime add table schedules;
```

Without this, Realtime pushes stay silent and clients fall back to sha-poll.

## Operate

- Rotate `DUE_SYNC_TOKEN`: GitHub → Settings → Developer settings → rotate;
  Vercel → project → Settings → Environment Variables → update → redeploy.
- Rotate Supabase keys: Dashboard → Settings → API → roll; update the four
  `SUPABASE_*`/`VITE_*` Vercel envs → redeploy.
- Rollback: `pages-changelog.js` `SUPABASE_CONFIGURED` false (remove `VITE_*`
  envs) → site reads Git-only. Supabase tables stay intact.
- Debug one key: `GET /api/schedule?sync=<file>` → per-key
  `{status, attempts, last_error, github_sha}`.
