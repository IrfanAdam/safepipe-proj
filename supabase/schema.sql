-- Supabase scheduling migration — Phase 1 foundation.
-- Apply once in Supabase Dashboard → SQL editor.
-- Key: (plan_file, section_key) where section_key = normHead(head).

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

drop policy if exists "anon read schedules" on schedules;
create policy "anon read schedules"
  on schedules for select to anon using (true);

-- No INSERT/UPDATE policies: writes go through service_role in api/schedule.js only.
