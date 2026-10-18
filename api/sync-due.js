// safepipe — Supabase → GitHub Due sync worker (Vercel serverless).
// Phase 4 of the Supabase scheduling migration:
// [plan:2026-10-18_172008-supabase-scheduling-migration.md#phase-4]
// Writer-driven sync (pivot 2026-10-18 — Supabase-issued tokens here are
// read-scoped, so no DB trigger/webhook could be installed from outside):
// the changelog UI fires POST /api/sync-due right after a confirmed
// /api/schedule write, authenticating with the writer's owner OAuth token.
// The Supabase DB-webhook path (x-webhook-secret) is kept as a second
// door for later — whichever proves identity wins.
// service_role key, applies dueEditText (imported from api/due.js — never
// reimplemented; section_key is already normHead(head)) to the GitHub plan
// file with the server PAT DUE_SYNC_TOKEN, and records the outcome in
// `sync_state` (+ `schedule_events.commit_sha`). Due-only commits carry
// [skip ci] so Vercel skips the redeploy.
// Secrets come only from env at runtime (SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_URL, SUPABASE_WEBHOOK_SECRET, DUE_SYNC_TOKEN) — never files,
// never the client.
import { dueEditText, isValidDue } from './due.js';

// Identical file shape to api/due.js: plan files only, no paths.
const FILE_RE = /^[\w][\w\-. ]*\.md$/;
const PLAN_TRAILER = '[plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]';

// Same header style as api/due.js.
const gh = (token, path, opts = {}) => fetch(`https://api.github.com${path}`, {
  ...opts,
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  },
});

// Same PostgREST style as api/schedule.js (REST-only, no client lib).
const sbHeaders = (key) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=representation',
});
const sb = (url) => `${String(url || '').replace(/\/$/, '')}/rest/v1`;
const q2 = (f, k) => `plan_file=eq.${encodeURIComponent(f)}&section_key=eq.${encodeURIComponent(k)}`;

// Transient GitHub write faults get retried with backoff; anything else
// (4xx incl. 403, needs-login shape) is permanent — recorded verbatim,
// never looped. Max 3 PUT attempts total (the sha-race refetch+retry below
// consumes attempts from the same budget).
const isTransientWrite = (status) =>
  status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599);
const writeRetryDelayMs = (done) =>
  Math.min(2000, 500 * (2 ** Math.max(0, Number(done) - 1)));
const sleepMs = (ms) => new Promise((res) => {
  try { setTimeout(res, ms); } catch { try { res(); } catch {} }
});
const retryAfterMs = (attempts) =>
  Math.min(15 * 60 * 1000, 5000 * (3 ** Math.max(0, Number(attempts || 1) - 1)));

export default async function handler(req, res) {
  try {
    await syncDueHandler(req, res);
  } catch (e) {
    try {
      if (!res.headersSent) res.status(500).json({ error: 'Due sync failed' });
    } catch {}
  }
}

export async function syncDueHandler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  const secret = req.headers ? req.headers['x-webhook-secret'] : undefined;
  const expected = process.env.SUPABASE_WEBHOOK_SECRET;
  const { plan_file, section_key, token: caller } = req.body || {};
  // Door 1: Supabase DB-webhook shared secret (for the trigger, if ever installed).
  let authed = typeof secret === 'string' && !!expected && secret === expected;
  // Door 2: writer-driven sync — the caller's owner OAuth token, verified
  // against GitHub identity exactly like api/schedule.js and api/due.js.
  if (!authed && typeof caller === 'string' && caller) {
    const owner = process.env.VERCEL_GIT_REPO_OWNER;
    if (!owner) { res.status(500).send('Repo context unavailable'); return; }
    try {
      const me = await gh(caller, '/user');
      if (me.ok) {
        const who = await me.json().catch(() => null);
        authed = !!(who && who.login && who.login === owner);
      }
    } catch {}
  }
  if (!authed) { res.status(401).send('Unauthorized'); return; }
  if (typeof plan_file !== 'string' || !FILE_RE.test(plan_file) || plan_file.includes('..')) {
    res.status(400).send('Invalid file');
    return;
  }
  if (typeof section_key !== 'string' || !section_key.trim() || section_key.length > 200) {
    res.status(400).send('Invalid section_key');
    return;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = process.env.DUE_SYNC_TOKEN;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  const branch = process.env.VERCEL_GIT_COMMIT_REF || 'main';
  if (!url || !key) { res.status(500).send('Scheduling backend unavailable'); return; }
  if (!token || !owner || !slug) { res.status(500).send('Sync not configured'); return; }
  const repo = `${owner}/${slug}`;
  const base = sb(url);
  const ghPath = `.hermes/plans/${plan_file}`;
  const encPath = encodeURIComponent(ghPath);

  const readJson = async (r) => {
    try { return await r.json(); } catch { return null; }
  };
  const getState = async () => {
    try {
      const r = await fetch(`${base}/sync_state?${q2(plan_file, section_key)}&select=*`, {
        headers: sbHeaders(key),
      });
      if (!r.ok) return null;
      const rows = await readJson(r);
      return Array.isArray(rows) ? rows[0] || null : null;
    } catch { return null; }
  };
  const putState = async (patch) => {
    try {
      await fetch(`${base}/sync_state?on_conflict=plan_file,section_key`, {
        method: 'POST',
        headers: sbHeaders(key),
        body: JSON.stringify([{
          plan_file, section_key, updated_at: new Date().toISOString(), ...patch,
        }]),
      });
    } catch {}
  };
  const markError = async (last_error) => {
    const prev = await getState();
    const attempts = Number(prev && prev.attempts ? prev.attempts : 0) + 1;
    await putState({
      status: 'error', attempts,
      last_error: String(last_error).slice(0, 160),
      github_sha: (prev && prev.github_sha) || null,
    });
    return attempts;
  };
  const fail = async (status, error) => {
    const attempts = await markError(error);
    res.status(status).json({ synced: false, error, attempts, retryAfterMs: retryAfterMs(attempts) });
  };

  try {
    // 1. Live row via service_role PostgREST (bypasses RLS, server only).
    let row = null;
    try {
      const r = await fetch(`${base}/schedules?${q2(plan_file, section_key)}&select=*`, {
        headers: sbHeaders(key),
      });
      if (!r.ok) { await fail(502, `schedule-read-${r.status}`); return; }
      const rows = await readJson(r);
      row = Array.isArray(rows) ? rows[0] || null : null;
    } catch { await fail(502, 'schedule-read-failed'); return; }
    if (!row) {
      const attempts = await markError('row-not-found');
      res.status(200).json({ synced: false, reason: 'row-not-found', attempts });
      return;
    }
    const due = row.due || null;
    if (!isValidDue(due)) {
      const attempts = await markError('invalid-due');
      res.status(200).json({ synced: false, reason: 'invalid-due', attempts });
      return;
    }

    // 2. Current GitHub file (sha + text).
    const getFile = async () => {
      const r = await gh(token, `/repos/${repo}/contents/${encPath}?ref=${encodeURIComponent(branch)}`);
      if (!r.ok) return { res: r };
      const j = await readJson(r);
      return {
        res: r,
        sha: (j && j.sha) || null,
        raw: Buffer.from((j && j.content) || '', 'base64').toString('utf8'),
      };
    };
    let cur;
    try {
      cur = await getFile();
    } catch { await fail(502, 'github-read-failed'); return; }
    if (!cur.res.ok) { await fail(502, `github-read-${cur.res.status}`); return; }

    // 3. Apply (section_key is already normHead(head) — pass through directly).
    const putFile = async (sha, text) => gh(token, `/repos/${repo}/contents/${encPath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `chore(sync): due ${plan_file} ${section_key} [skip ci] ${PLAN_TRAILER}`,
        content: Buffer.from(text, 'utf8').toString('base64'),
        sha,
        branch,
      }),
    });
    const putStateOk = async (sha) => {
      await putState({
        last_synced_due: due, status: 'ok', attempts: 0, last_error: null, github_sha: sha,
      });
    };
    let edit = dueEditText(cur.raw, section_key, due);
    if (!edit.found) {
      const attempts = await markError('head-not-found');
      res.status(200).json({ synced: false, reason: 'head-not-found', attempts });
      return;
    }
    if (edit.next === edit.text) {
      await putStateOk(cur.sha);
      res.status(200).json({ synced: true, noop: true });
      return;
    }
    let put = null;
    let raced = false;
    let lastWriteStatus = 0;
    let finalSha = cur.sha;
    let puts = 0;
    for (;;) {
      if (puts >= 3) { await fail(502, `github-write-${lastWriteStatus || 'failed'}`); return; }
      puts++;
      try {
        put = await putFile(cur.sha, edit.next);
      } catch {
        // Network throw: transient — backoff and retry while budget remains.
        if (puts < 3) { await sleepMs(writeRetryDelayMs(puts)); continue; }
        await fail(502, 'github-write-failed'); return;
      }
      if (put.ok) break;
      lastWriteStatus = (put && Number.isInteger(put.status)) ? put.status : 0;
      if ((lastWriteStatus === 409 || lastWriteStatus === 422) && !raced) {
        // Sha race: refetch once, re-apply, retry once (no backoff — the
        // file moved under us, waiting changes nothing).
        raced = true;
        try {
          cur = await getFile();
        } catch { await fail(502, 'github-read-failed'); return; }
        if (!cur.res.ok) { await fail(502, `github-read-${cur.res.status}`); return; }
        edit = dueEditText(cur.raw, section_key, due);
        if (!edit.found) {
          const attempts = await markError('head-not-found');
          res.status(200).json({ synced: false, reason: 'head-not-found', attempts });
          return;
        }
        if (edit.next === edit.text) {
          await putStateOk(cur.sha);
          res.status(200).json({ synced: true, noop: true, converged: true });
          return;
        }
        finalSha = cur.sha;
        continue;
      }
      if (!isTransientWrite(lastWriteStatus)) {
        // Permanent (4xx incl. 403, needs-login shape): record the verbatim
        // reason immediately and never loop.
        await fail(502, `github-write-${lastWriteStatus}`);
        return;
      }
      if (puts < 3) { await sleepMs(writeRetryDelayMs(puts)); continue; }
      await fail(502, `github-write-${lastWriteStatus}`);
      return;
    }
    if (!put.ok) { await fail(502, `github-write-${lastWriteStatus || 'failed'}`); return; }

    // 4. Record success: sync_state + history event.
    const done = await readJson(put);
    const commit = (done && done.commit && done.commit.sha) || null;
    const contentSha = (done && done.content && done.content.sha) || finalSha;
    await putStateOk(contentSha);
    try {
      await fetch(`${base}/schedule_events`, {
        method: 'POST',
        headers: sbHeaders(key),
        body: JSON.stringify([{
          plan_file, section_key, due, actor: 'sync', source: 'sync', commit_sha: commit,
        }]),
      });
    } catch {}
    res.status(200).json({ synced: true, commit, sha: contentSha });
  } catch (e) {
    try {
      if (!res.headersSent) res.status(500).json({ error: 'Due sync failed' });
    } catch {}
  }
}
