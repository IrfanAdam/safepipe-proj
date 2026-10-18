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

- Supabase → Database Webhooks → `POST https://<site>/api/sync-due`
- Header: webhook secret. Event: insert+update on `schedules`.
