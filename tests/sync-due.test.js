// Phase 4 pins — sync worker, stubbed fetch only, no live GitHub/Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncDueHandler } from '../api/sync-due.js';

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sr-key';
process.env.SUPABASE_WEBHOOK_SECRET = 'wh-secret';
process.env.DUE_SYNC_TOKEN = 'gh-pat';
process.env.VERCEL_GIT_REPO_OWNER = 'owner';
process.env.VERCEL_GIT_REPO_SLUG = 'slug';
process.env.VERCEL_GIT_COMMIT_REF = 'main';

const HEADERS = { 'x-webhook-secret': 'wh-secret' };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const mockRes = () => {
  const r = { statusCode: 0, body: undefined };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.send = (t) => { r.body = t; return r; };
  return r;
};
const req = (body, headers = HEADERS) => ({ method: 'POST', body, headers });

// Router: supabase PostgREST vs api.github.com, driven per-test by stubs.
function withFetch(stubs, fn) {
  const real = globalThis.fetch;
  const seen = { puts: [], syncPosts: [], eventPosts: [] };
  globalThis.fetch = async (u, o = {}) => {
    const s = String(u);
    const method = (o.method || 'GET').toUpperCase();
    if (s.startsWith('https://api.github.com')) {
      if (s === 'https://api.github.com/user') {
        return { ok: stubs.userOk === false ? false : true, status: stubs.userOk === false ? 401 : 200, json: async () => ({ login: stubs.userLogin || 'owner' }) };
      }
      if (method === 'PUT') {
        seen.puts.push(JSON.parse(o.body));
        return stubs.githubPut
          ? stubs.githubPut(seen.puts.length)
          : { ok: true, status: 200, json: async () => ({ commit: { sha: 'c1' }, content: { sha: 'f1' } }) };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ sha: stubs.fileSha || 'sha0', content: b64(stubs.raw) }),
      };
    }
    if (s.includes('/rest/v1/schedules?')) {
      return { ok: true, status: 200, json: async () => stubs.rows };
    }
    if (s.includes('/rest/v1/sync_state?')) {
      if (method === 'POST') { seen.syncPosts.push(JSON.parse(o.body)); return { ok: true, status: 201, json: async () => [] }; }
      return { ok: true, status: 200, json: async () => stubs.state || [] };
    }
    if (s.includes('/rest/v1/schedule_events')) {
      seen.eventPosts.push(JSON.parse(o.body));
      return { ok: true, status: 201, json: async () => [] };
    }
    throw new Error(`unexpected fetch: ${s}`);
  };
  return fn(seen).finally(() => { globalThis.fetch = real; });
}

test('non-POST rejected', async () => {
  const res = mockRes();
  await syncDueHandler({ method: 'GET', body: {}, headers: HEADERS }, res);
  assert.equal(res.statusCode, 405);
});

test('bad webhook secret rejected', async () => {
  const res = mockRes();
  await syncDueHandler(req({ plan_file: 'a.md', section_key: 'T' }, { 'x-webhook-secret': 'nope' }), res);
  assert.equal(res.statusCode, 401);
});

test('bad file rejected', async () => {
  const res = mockRes();
  await syncDueHandler(req({ plan_file: '../x.md', section_key: 'T' }), res);
  assert.equal(res.statusCode, 400);
});

test('head-not-found marks sync_state error, no PUT', async () => {
  await withFetch({
    raw: '## Task 1\n*Due: 2026-10-21*\n',
    rows: [{ plan_file: 'a.md', section_key: 'Nope', due: '2026-10-20' }],
  }, async (seen) => {
    const res = mockRes();
    await syncDueHandler(req({ plan_file: 'a.md', section_key: 'Nope' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.synced, false);
    assert.equal(res.body.reason, 'head-not-found');
    assert.equal(seen.puts.length, 0);
    assert.equal(seen.syncPosts.length, 1);
    assert.equal(seen.syncPosts[0][0].status, 'error');
    assert.equal(seen.syncPosts[0][0].last_error, 'head-not-found');
  });
});

test('idempotent noop issues no PUT', async () => {
  await withFetch({
    raw: '## Task 1\n*Due: 2026-10-20*\n',
    rows: [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-20' }],
  }, async (seen) => {
    const res = mockRes();
    await syncDueHandler(req({ plan_file: 'a.md', section_key: 'Task 1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.synced, true);
    assert.equal(res.body.noop, true);
    assert.equal(seen.puts.length, 0);
    assert.equal(seen.syncPosts[0][0].status, 'ok');
  });
});

test('success PUTs with [skip ci] and records state + event', async () => {
  await withFetch({
    raw: '## Task 1\n*Due: 2026-10-20*\n',
    rows: [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-21' }],
  }, async (seen) => {
    const res = mockRes();
    await syncDueHandler(req({ plan_file: 'a.md', section_key: 'Task 1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.synced, true);
    assert.equal(seen.puts.length, 1);
    assert.ok(seen.puts[0].message.includes('[skip ci]'), 'message skips deploy');
    assert.ok(seen.puts[0].message.includes('chore(sync): due a.md Task 1'));
    assert.ok(seen.puts[0].message.includes('[plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]'));
    const ok = seen.syncPosts[0][0];
    assert.equal(ok.status, 'ok');
    assert.equal(ok.attempts, 0);
    assert.equal(ok.last_synced_due, '2026-10-21');
    const ev = seen.eventPosts[0][0];
    assert.equal(ev.source, 'sync');
    assert.equal(ev.commit_sha, 'c1');
  });
});

test('owner token auth syncs without webhook secret', async () => {
  await withFetch({
    raw: '## Task 1\n*Due: 2026-10-20*\n',
    rows: [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-21' }],
  }, async (seen) => {
    const res = mockRes();
    await syncDueHandler({ method: 'POST', body: { plan_file: 'a.md', section_key: 'Task 1', token: 'user-oauth' }, headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.synced, true);
    assert.equal(seen.puts.length, 1);
    assert.ok(seen.puts[0].message.includes('[skip ci]'));
  });
});

test('wrong-login token rejected even with valid shape', async () => {
  await withFetch({
    raw: '## Task 1\n*Due: 2026-10-20*\n',
    rows: [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-21' }],
    userLogin: 'someone-else',
  }, async (seen) => {
    const res = mockRes();
    await syncDueHandler({ method: 'POST', body: { plan_file: 'a.md', section_key: 'Task 1', token: 'user-oauth' }, headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(seen.puts.length, 0);
  });
});

test('409 sha race refetches once and retries', async () => {
  let gets = 0;
  const real = globalThis.fetch;
  const seen = { puts: [] };
  globalThis.fetch = async (u, o = {}) => {
    const s = String(u);
    const method = (o.method || 'GET').toUpperCase();
    if (s.startsWith('https://api.github.com')) {
      if (method === 'PUT') {
        seen.puts.push(JSON.parse(o.body));
        if (seen.puts.length === 1) return { ok: false, status: 409, text: async () => 'conflict' };
        return { ok: true, status: 200, json: async () => ({ commit: { sha: 'c2' }, content: { sha: 'f2' } }) };
      }
      gets++;
      const raw = gets === 1 ? '## Task 1\n*Due: 2026-10-20*\n' : '## Task 1\n*Due: 2026-10-22*\n';
      return { ok: true, status: 200, json: async () => ({ sha: `sha${gets}`, content: b64(raw) }) };
    }
    if (s.includes('/rest/v1/schedules?')) {
      return { ok: true, status: 200, json: async () => [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-21' }] };
    }
    if (s.includes('/rest/v1/sync_state')) return { ok: true, status: 200, json: async () => [] };
    if (s.includes('/rest/v1/schedule_events')) return { ok: true, status: 201, json: async () => [] };
    throw new Error(`unexpected fetch: ${s}`);
  };
  try {
    const res = mockRes();
    await syncDueHandler(req({ plan_file: 'a.md', section_key: 'Task 1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.synced, true);
    assert.equal(seen.puts.length, 2, 'one retry after 409');
    assert.equal(res.body.sha, 'f2');
  } finally {
    globalThis.fetch = real;
  }
});

test('transient 500 retried with backoff then recorded ok', async () => {
  await withFetch({
    raw: '## Task 1\n*Due: 2026-10-20*\n',
    rows: [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-21' }],
    githubPut: (n) => n === 1
      ? { ok: false, status: 500, text: async () => 'boom' }
      : { ok: true, status: 200, json: async () => ({ commit: { sha: 'c9' }, content: { sha: 'f9' } }) },
  }, async (seen) => {
    const res = mockRes();
    await syncDueHandler(req({ plan_file: 'a.md', section_key: 'Task 1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.synced, true);
    assert.equal(seen.puts.length, 2, 'one transient retry');
    assert.equal(seen.syncPosts[0][0].status, 'ok');
  });
});

test('persistent 500 retried to budget then recorded verbatim', async () => {
  await withFetch({
    raw: '## Task 1\n*Due: 2026-10-20*\n',
    rows: [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-21' }],
    githubPut: () => ({ ok: false, status: 500, text: async () => 'boom' }),
  }, async (seen) => {
    const res = mockRes();
    await syncDueHandler(req({ plan_file: 'a.md', section_key: 'Task 1' }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(seen.puts.length, 3, 'max 3 PUT attempts');
    assert.equal(seen.syncPosts[0][0].status, 'error');
    assert.equal(seen.syncPosts[0][0].last_error, 'github-write-500');
  });
});

test('429 rate-limit retried then recorded ok', async () => {
  await withFetch({
    raw: '## Task 1\n*Due: 2026-10-20*\n',
    rows: [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-21' }],
    githubPut: (n) => n === 1
      ? { ok: false, status: 429, text: async () => 'rate limited' }
      : { ok: true, status: 200, json: async () => ({ commit: { sha: 'c8' }, content: { sha: 'f8' } }) },
  }, async (seen) => {
    const res = mockRes();
    await syncDueHandler(req({ plan_file: 'a.md', section_key: 'Task 1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.synced, true);
    assert.equal(seen.puts.length, 2);
  });
});

test('network throw on PUT retried then recorded ok', async () => {
  let n = 0;
  const real = globalThis.fetch;
  const seen = { puts: [] };
  globalThis.fetch = async (u, o = {}) => {
    const s = String(u);
    const method = (o.method || 'GET').toUpperCase();
    if (s.startsWith('https://api.github.com') && method === 'PUT') {
      n++;
      seen.puts.push(n);
      if (n === 1) throw new Error('socket hang up');
      return { ok: true, status: 200, json: async () => ({ commit: { sha: 'c7' }, content: { sha: 'f7' } }) };
    }
    if (s.startsWith('https://api.github.com')) {
      return { ok: true, status: 200, json: async () => ({ sha: 'sha0', content: b64('## Task 1\n*Due: 2026-10-20*\n') }) };
    }
    if (s.includes('/rest/v1/schedules?')) {
      return { ok: true, status: 200, json: async () => [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-21' }] };
    }
    if (s.includes('/rest/v1/sync_state')) return { ok: true, status: 200, json: async () => [] };
    if (s.includes('/rest/v1/schedule_events')) return { ok: true, status: 201, json: async () => [] };
    throw new Error(`unexpected fetch: ${s}`);
  };
  try {
    const res = mockRes();
    await syncDueHandler(req({ plan_file: 'a.md', section_key: 'Task 1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.synced, true);
    assert.equal(seen.puts.length, 2, 'throw retried once');
  } finally {
    globalThis.fetch = real;
  }
});

test('403 write recorded once, verbatim, never looped', async () => {
  await withFetch({
    raw: '## Task 1\n*Due: 2026-10-20*\n',
    rows: [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-21' }],
    githubPut: () => ({ ok: false, status: 403, text: async () => 'read-only token' }),
  }, async (seen) => {
    const res = mockRes();
    await syncDueHandler(req({ plan_file: 'a.md', section_key: 'Task 1' }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, 'github-write-403');
    assert.equal(seen.puts.length, 1, 'permanent failure never retried');
    assert.equal(seen.syncPosts.length, 1, 'recorded exactly once');
    assert.equal(seen.syncPosts[0][0].status, 'error');
    assert.equal(seen.syncPosts[0][0].last_error, 'github-write-403');
  });
});

test('404 write recorded once, never looped', async () => {
  await withFetch({
    raw: '## Task 1\n*Due: 2026-10-20*\n',
    rows: [{ plan_file: 'a.md', section_key: 'Task 1', due: '2026-10-21' }],
    githubPut: () => ({ ok: false, status: 404, text: async () => 'not found' }),
  }, async (seen) => {
    const res = mockRes();
    await syncDueHandler(req({ plan_file: 'a.md', section_key: 'Task 1' }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(seen.puts.length, 1, 'permanent failure never retried');
    assert.equal(seen.syncPosts[0][0].last_error, 'github-write-404');
  });
});
