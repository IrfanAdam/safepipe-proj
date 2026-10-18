// safepipe — schedule write endpoint (Vercel serverless).
// Phase 2 of the Supabase scheduling migration:
// [plan:2026-10-18_172008-supabase-scheduling-migration.md#phase-2]
// Owner-checked picks land in Supabase `schedules` (+ `schedule_events`),
// idempotently. GitHub sync happens later via api/sync-due.js —
// this endpoint never touches git and never triggers a deploy.
//
// Reads need no server: clients query PostgREST directly with the
// read-only anon key (RLS allows SELECT only). This route is POST-only.
import { normHead } from '../src/logic/due-overrides.js';
import { isValidDue } from './due.js';

// Pure validation — pinned by tests/schedule-api.test.js.
export function validateScheduleBody(body) {
  const b = body || {};
  if (typeof b.file !== 'string' || !/^[\w][\w\-. ]*\.md$/.test(b.file) || b.file.includes('..'))
    return { ok: false, error: 'Invalid file' };
  if (typeof b.head !== 'string' || !b.head.trim() || b.head.length > 200)
    return { ok: false, error: 'Invalid head' };
  if (!isValidDue(b.due === undefined ? null : b.due))
    return { ok: false, error: 'Invalid due' };
  if (b.idempotencyKey !== undefined && typeof b.idempotencyKey !== 'string')
    return { ok: false, error: 'Invalid idempotencyKey' };
  return { ok: true, file: b.file, head: b.head, due: b.due === undefined ? null : b.due, idempotencyKey: b.idempotencyKey || null };
}

const sbHeaders = (key) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=representation',
});

// Core upsert — REST-only, no client lib (same style as api/due.js).
// url = SUPABASE_URL, key = service-role/secret key (bypasses RLS).
// Returns { row, deduped } where deduped means a retry with the same
// idempotencyKey (or an already-converged value) caused no new version.
export async function upsertSchedule({ url, key, file, section_key, due, actor, idempotencyKey }) {
  const base = `${String(url || '').replace(/\/$/, '')}/rest/v1`;
  // idempotency_key is uuid-typed: only real UUIDs participate, anything
  // else degrades to null (plain last-write-wins) instead of 500ing.
  const idem = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey || '')
    ? idempotencyKey : null;
  const q = `plan_file=eq.${encodeURIComponent(file)}&section_key=eq.${encodeURIComponent(section_key)}`;
  const cur = await fetch(`${base}/schedules?${q}&select=*`, { headers: sbHeaders(key) });
  if (!cur.ok) throw new Error(`schedule read failed: ${cur.status}`);
  const rows = await cur.json().catch(() => []);
  const existing = Array.isArray(rows) ? rows[0] : null;
  if (existing && idem && existing.idempotency_key === idem)
    return { row: existing, deduped: true };
  if (existing && (existing.due || null) === (due || null))
    return { row: existing, deduped: true, converged: true };
  const version = existing ? Number(existing.version || 0) + 1 : 1;
  const put = await fetch(`${base}/schedules?on_conflict=plan_file,section_key`, {
    method: 'POST',
    headers: sbHeaders(key),
    body: JSON.stringify([{
      plan_file: file,
      section_key,
      due: due || null,
      updated_at: new Date().toISOString(),
      updated_by: actor || 'owner',
      version,
      idempotency_key: idem,
    }]),
  });
  if (!put.ok) {
    const t = await put.text().catch(() => '');
    throw new Error(`schedule write failed: ${put.status} ${t.slice(0, 160)}`);
  }
  const saved = await put.json().catch(() => []);
  const row = Array.isArray(saved) ? saved[0] : saved;
  await fetch(`${base}/schedule_events`, {
    method: 'POST',
    headers: sbHeaders(key),
    body: JSON.stringify([{
      plan_file: file, section_key, due: due || null,
      actor: actor || 'owner', source: 'ui',
    }]),
  }).catch(() => {});
  return { row, deduped: false };
}

const gh = (token, path) => fetch(`https://api.github.com${path}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
});

export default async function handler(req, res) {
  try {
    await scheduleHandler(req, res);
  } catch (e) {
    try {
      if (!res.headersSent) res.status(500).json({ error: 'Schedule write failed' });
    } catch {}
  }
}

// Task 12: read-only sync-state probe for debugging.
// GET /api/schedule?sync=<file> returns the sync_state rows for that plan
// file (one per section_key) via the server service_role key. No token
// required: rows carry only status fields (no secrets), and the response is
// field-allowlisted so future columns can never leak keys.
const SYNC_ROW_FIELDS = 'plan_file,section_key,last_synced_due,status,attempts,last_error,github_sha,updated_at';
const pickSyncRow = (r) => ({
  plan_file: r.plan_file ?? null,
  section_key: r.section_key ?? null,
  last_synced_due: r.last_synced_due ?? null,
  status: r.status ?? null,
  attempts: r.attempts ?? 0,
  last_error: r.last_error ?? null,
  github_sha: r.github_sha ?? null,
  updated_at: r.updated_at ?? null,
});

export async function scheduleSyncStatus(req, res) {
  const file = req.query ? req.query.sync : undefined;
  if (typeof file !== 'string' || !/^[\w][\w\-. ]*\.md$/.test(file) || file.includes('..')) {
    res.status(400).send('Invalid file');
    return;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { res.status(500).send('Scheduling backend unavailable'); return; }
  try {
    const base = `${String(url).replace(/\/$/, '')}/rest/v1`;
    const r = await fetch(
      `${base}/sync_state?plan_file=eq.${encodeURIComponent(file)}&select=${SYNC_ROW_FIELDS}`,
      { headers: sbHeaders(key) },
    );
    if (!r.ok) { res.status(502).send('Sync state unavailable'); return; }
    const rows = await r.json().catch(() => null);
    const list = Array.isArray(rows) ? rows.map(pickSyncRow) : [];
    res.status(200).json(list);
  } catch {
    res.status(502).send('Sync state unavailable');
  }
}

export async function scheduleHandler(req, res) {
  if (req.method === 'GET') { await scheduleSyncStatus(req, res); return; }
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  const v = validateScheduleBody(req.body || {});
  if (!v.ok) { res.status(400).send(v.error); return; }
  const { token } = req.body || {};
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  if (typeof token !== 'string' || !token) { res.status(401).send('Login required'); return; }
  if (!owner) { res.status(500).send('Repo context unavailable'); return; }
  try {
    // Identity check — identical to api/due.js: caller token proves WHO.
    const me = await gh(token, '/user');
    if (!me.ok) { res.status(401).send('Login required'); return; }
    const { login } = await me.json();
    if (!login || login !== owner) { res.status(403).send('Not the repo owner'); return; }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) { res.status(500).send('Scheduling backend unavailable'); return; }
    const section_key = normHead(v.head);
    const { row } = await upsertSchedule({
      url, key, file: v.file, section_key,
      due: v.due, actor: login, idempotencyKey: v.idempotencyKey,
    });
    res.status(200).json({
      due: row.due || null,
      version: row.version,
      updated_at: row.updated_at,
      section_key,
    });
  } catch (e) {
    try {
      if (!res.headersSent) res.status(500).json({ error: 'Schedule write failed' });
    } catch {}
  }
}
