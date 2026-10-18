// Due-pipeline regression tests — pick → POST → GitHub PUT → sync → paint.
// Synthetic fixtures only (no corpus reads: corpus Dues drift as the owner
// schedules). Each area below pins a production symptom:
//  (a) "published ✓" while the painted date is stale,
//  (b) retry-after-success failing forever (unchanged/timeout even though git
//      holds the value), stale-head 200s,
//  (c) background sync / polls / self-reload disturbing an open picker,
//  (d) healthy logins flapping to logged-out (needs-login on next pick).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// --- api/due.js: anchor matching + idempotency shapes via exported helpers ---
import {
  dueEditText as serverEdit,
  isValidDue,
  DUE_UNCHANGED_REASONS,
  dueHandler,
} from '../api/due.js';
// --- client matcher parity (must stay a port of the server algorithm) ---
import { dueEditText as clientEdit, duePreviewEdit } from '../src/changelog/changelog-events.js';
// --- pure scheduling helpers (zero DOM) ---
import {
  loadDueOverrides,
  saveDueOverride,
  dropDueOverride,
  overrideVerdict,
  canonicalHead,
  dueFailureReason,
  confirmPublish,
  saveDueConfirm,
  readDueConfirm,
  clearDueConfirm,
  dueFetchVerdict,
  DUE_CONFIRM_WINDOW_MS,
  saveDuePending,
  readDuePending,
  clearDuePending,
  dueDeployVerdict,
  DUE_PENDING_WINDOW_MS,
  normHead,
  headingOf,
  findHeadIndex,
  DUE_FAILURE_REASONS,
  DUE_OVERRIDE_TTL_MS,
} from '../src/logic/due-overrides.js';

const FILE_TEXT =
  '# Plan\n\n**Goal:** x\n\n## Task 1 — Head\n*Tags: A*\n\nBody text\n\n## Task 2 — Other\n\nMore\n';
const WITH_DUE = serverEdit(FILE_TEXT, 'Task 1 — Head', '2026-11-01').next;

// --- tiny localStorage stub (repo convention: hand stubs on globalThis) ---
const mkStore = () => {
  const s = {};
  return {
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; },
    _s: s,
  };
};
let realStorage;
beforeEach(() => {
  realStorage = globalThis.localStorage;
  globalThis.localStorage = mkStore();
});
afterEach(() => {
  globalThis.localStorage = realStorage;
});

describe('api/due dueEditText (server anchor matching)', () => {
  it('inserts after a Tags line, replaces idempotently, clears exactly', () => {
    const once = serverEdit(FILE_TEXT, 'Task 1 — Head', '2026-11-01');
    assert.equal(once.found, true);
    const lines = once.next.split('\n');
    assert.equal(lines[6], '*Due: 2026-11-01*');
    assert.equal(lines[5], '*Tags: A*');
    const twice = serverEdit(once.next, 'Task 1 — Head', '2026-11-02');
    assert.equal(twice.next.split('\n').filter((l) => /^\s*\*Due:/.test(l)).length, 1);
    assert.ok(twice.next.includes('*Due: 2026-11-02*'));
    const cleared = serverEdit(twice.next, 'Task 1 — Head', null);
    assert.equal(cleared.next, FILE_TEXT);
    assert.equal(cleared.found, true);
  });
  it('matches across spacing/normalization drift (stale closure heads)', () => {
    const e = serverEdit(FILE_TEXT, 'Task   1 —   Head', '2026-11-01');
    assert.equal(e.found, true);
    assert.ok(e.next.includes('*Due: 2026-11-01*'));
  });
  it('matches CRLF files', () => {
    const e = serverEdit(FILE_TEXT.replace(/\n/g, '\r\n'), 'Task 1 — Head', '2026-11-01');
    assert.equal(e.found, true);
    assert.ok(e.next.includes('*Due: 2026-11-01*'));
  });
  it('fuzzy-matches a single candidate, misses on ambiguous or absent heads', () => {
    assert.equal(serverEdit(FILE_TEXT, 'Task 1', '2026-11-01').found, true);
    assert.equal(serverEdit(FILE_TEXT, 'Task', '2026-11-01').found, false);
    const miss = serverEdit(FILE_TEXT, 'No such head', '2026-11-01');
    assert.equal(miss.found, false);
    assert.equal(miss.next, miss.text);
  });
  it('same-value edit is found with next === text (idempotent-success shape)', () => {
    const e = serverEdit(WITH_DUE, 'Task 1 — Head', '2026-11-01');
    assert.equal(e.found, true);
    assert.equal(e.next, e.text);
  });
});

describe('api/due isValidDue', () => {
  it('accepts null + real calendar days incl. leap day', () => {
    assert.equal(isValidDue(null), true);
    assert.equal(isValidDue('2026-11-01'), true);
    assert.equal(isValidDue('2024-02-29'), true);
  });
  it('rejects malformed and impossible dates (never written as dead metadata)', () => {
    for (const bad of ['2026-13-01', '2026-10-32', '2026-02-30', '2023-02-29',
      '2100-01-01', '2026-1-1', 'soon', '', 42]) {
      assert.equal(isValidDue(bad), false, String(bad));
    }
  });
});

// --- dueHandler with stubbed GitHub + env (no network) ---
const mkGhFetch = ({ login = 'owner1', fileText = FILE_TEXT, fileSha = 'sha-file' } = {}) => {
  const calls = [];
  const resp = (data, { ok = true, status = 200 } = {}) => ({
    ok, status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
    headers: { get: () => null },
  });
  const fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (String(url).endsWith('/user')) return resp({ login });
    if (String(url).includes('/contents/')) {
      if ((opts.method || 'GET').toUpperCase() === 'PUT') {
        return resp({ commit: { sha: 'sha-put' }, content: { sha: 'sha-content' } });
      }
      return resp({ sha: fileSha, content: Buffer.from(fileText, 'utf8').toString('base64') });
    }
    return resp('not found', { ok: false, status: 404 });
  };
  return { fetch, calls };
};
const mkReqRes = (body) => {
  const res = {
    code: null, body: undefined, headersSent: false,
    status(c) { this.code = c; return this; },
    json(o) { if (this.code == null) this.code = 200; this.body = o; return this; },
    send(t) { if (this.code == null) this.code = 200; this.body = t; return this; },
  };
  return { req: { method: 'POST', body }, res };
};
const withEnv = async (fn) => {
  const keep = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.VERCEL_GIT_REPO_OWNER = 'owner1';
  process.env.VERCEL_GIT_REPO_SLUG = 'repo1';
  process.env.VERCEL_GIT_COMMIT_REF = 'main';
  try {
    await fn();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    for (const [k, v] of Object.entries(keep)) process.env[k] = v;
    globalThis.fetch = realFetch;
  }
};

describe('api/due dueHandler (idempotency shapes)', () => {
  it('retry-after-success converges: same value → committed, never unchanged', async () => {
    await withEnv(async () => {
      const { fetch, calls } = mkGhFetch({ fileText: WITH_DUE });
      globalThis.fetch = fetch;
      const { req, res } = mkReqRes({ token: 't', file: '2026-10-15_120000-x.md', head: 'Task 1 — Head', due: '2026-11-01' });
      await dueHandler(req, res);
      assert.equal(res.code, 200);
      assert.ok(res.body.committed, 'idempotent success still reports committed');
      assert.ok(!res.body.unchanged, 'must not report unchanged on a landed value');
      assert.equal(res.body.content, WITH_DUE);
      assert.ok(!calls.some((c) => (c.opts.method || '') === 'PUT'), 'no second PUT for a landed value');
    });
  });
  it('head-not-found stays the ONLY unchanged shape, with the allowlisted reason', async () => {
    await withEnv(async () => {
      const { fetch, calls } = mkGhFetch({});
      globalThis.fetch = fetch;
      const { req, res } = mkReqRes({ token: 't', file: '2026-10-15_120000-x.md', head: 'No such head', due: '2026-11-01' });
      await dueHandler(req, res);
      assert.equal(res.code, 200);
      assert.equal(res.body.unchanged, true);
      assert.equal(res.body.reason, 'head-not-found');
      assert.ok(DUE_UNCHANGED_REASONS.includes(res.body.reason));
      assert.equal(typeof res.body.headPreview, 'string');
      assert.equal(typeof res.body.fileLines, 'number');
      assert.ok(!calls.some((c) => (c.opts.method || '') === 'PUT'));
    });
  });
  it('sets + clears through one PUT carrying the full next text', async () => {
    await withEnv(async () => {
      const { fetch, calls } = mkGhFetch({});
      globalThis.fetch = fetch;
      const setReq = mkReqRes({ token: 't', file: '2026-10-15_120000-x.md', head: 'Task 1 — Head', due: '2026-11-01' });
      await dueHandler(setReq.req, setReq.res);
      assert.equal(setReq.res.code, 200);
      assert.equal(setReq.res.body.committed, 'sha-put');
      assert.ok(setReq.res.body.content.includes('*Due: 2026-11-01*'));
      const put = calls.find((c) => (c.opts.method || '') === 'PUT');
      assert.ok(put, 'set issues a PUT');
      const sent = JSON.parse(put.opts.body);
      assert.equal(sent.sha, 'sha-file');
      assert.equal(sent.branch, 'main');
      assert.ok(Buffer.from(sent.content, 'base64').toString('utf8').includes('*Due: 2026-11-01*'));
    });
    await withEnv(async () => {
      const { fetch } = mkGhFetch({ fileText: WITH_DUE });
      globalThis.fetch = fetch;
      const { req, res } = mkReqRes({ token: 't', file: '2026-10-15_120000-x.md', head: 'Task 1 — Head', due: null });
      await dueHandler(req, res);
      assert.equal(res.code, 200);
      assert.ok(!res.body.content.includes('*Due:'));
    });
  });
  it('rejects impossible dates before any GitHub call', async () => {
    await withEnv(async () => {
      let called = false;
      globalThis.fetch = async () => { called = true; throw new Error('must not fetch'); };
      const { req, res } = mkReqRes({ token: 't', file: '2026-10-15_120000-x.md', head: 'Task 1 — Head', due: '2026-13-01' });
      await dueHandler(req, res);
      assert.equal(res.code, 400);
      assert.equal(called, false);
    });
  });
  it('guards auth/file/head without fetching', async () => {
    await withEnv(async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
      const bad = [
        [{ file: '2026-10-15_120000-x.md', head: 'H', due: null }, 401],
        [{ token: 't', file: '../evil.md', head: 'H', due: null }, 400],
        [{ token: 't', file: '2026-10-15_120000-x.md', head: '  ', due: null }, 400],
      ];
      for (const [body, code] of bad) {
        const { req, res } = mkReqRes(body);
        await dueHandler(req, res);
        assert.equal(res.code, code, JSON.stringify(body));
      }
      assert.equal(calls, 0);
    });
    await withEnv(async () => {
      const { fetch } = mkGhFetch({ login: 'someone-else' });
      globalThis.fetch = fetch;
      const { req, res } = mkReqRes({ token: 't', file: '2026-10-15_120000-x.md', head: 'H', due: null });
      await dueHandler(req, res);
      assert.equal(res.code, 403);
    });
  });
});

describe('client dueEditText stays a port of the server algorithm', () => {
  const vectors = [
    ['## Task 1 — Head\n*Tags: A*\n\nBody\n', 'Task 1 — Head', '2026-11-01'],
    ['## Task 1 — Head\n*Tags: A*\n\nBody\n', 'Task   1 —   Head', '2026-11-01'],
    ['## Task 1 — Head\r\n*Tags: A*\r\n\r\nBody\r\n', 'Task 1 — Head', '2026-11-01'],
    ['## Task 1 — Head {#task-1}\n\nBody\n', 'Task 1 — Head', '2026-11-01'],
    ['## Task 1 — Head\n\nBody\n', 'Task 1', '2026-11-01'],
    ['## Nope\n\nBody\n', 'Missing head entirely', '2026-11-01'],
    ['## Task 1 — A\n\nx\n## Task 1 — B\n\ny\n', 'Task', '2026-11-01'],
  ];
  for (const [raw, head, due] of vectors) {
    it(`parity for head ${JSON.stringify(head)}`, () => {
      assert.equal(clientEdit(raw, head, due), serverEdit(raw, head, due).next);
    });
  }
  it('clear round-trips through the same matcher', () => {
    const set = clientEdit(FILE_TEXT, 'Task 1 — Head', '2026-11-01');
    assert.ok(set.includes('*Due: 2026-11-01*'));
    assert.equal(clientEdit(set, 'Task 1 — Head', null), FILE_TEXT);
  });
  it('duePreviewEdit still edits synthesized live bodies (fallback intact)', () => {
    const live = '- [ ] **1 Do the thing** detail words here';
    const set = duePreviewEdit(live, 'Task 1: Do the thing', '2026-11-01');
    assert.notEqual(set, live);
    assert.ok(set.includes('*Due: 2026-11-01*'));
    assert.equal(duePreviewEdit(set, 'Task 1: Do the thing', null), live);
  });
});

describe('overrideVerdict (confirm + drop rules)', () => {
  const NOW = 1700000000000;
  const FRESH = NOW - 1000;
  const STALE = NOW - DUE_OVERRIDE_TTL_MS - 1;
  const base = (over) => ({ file: 'f.md', head: 'Task 1 — H', ...over });
  it('converged entries drop (never repaint what the file already carries)', () => {
    assert.equal(overrideVerdict(base({ due: '2026-11-01', committed: true, at: FRESH }), '2026-11-01', NOW), 'drop');
    assert.equal(overrideVerdict(base({ due: null, committed: true, at: FRESH }), null, NOW), 'drop');
  });
  it('fresh picks paint: confirmed-outranks-file, optimistic fills dateless', () => {
    assert.equal(overrideVerdict(base({ due: '2026-11-01', committed: true, at: FRESH }), '2026-10-01', NOW), 'apply');
    assert.equal(overrideVerdict(base({ due: '2026-11-01', committed: true, at: FRESH }), null, NOW), 'apply');
    assert.equal(overrideVerdict(base({ due: '2026-11-01', committed: false, at: FRESH }), null, NOW), 'apply');
    assert.equal(overrideVerdict(base({ due: null, committed: true, at: FRESH }), '2026-10-01', NOW), 'strip');
    assert.equal(overrideVerdict(base({ due: null, committed: false, at: FRESH }), '2026-10-01', NOW), 'strip');
  });
  it('the file wins over unconfirmed picks (hand edits are never clobbered)', () => {
    assert.equal(overrideVerdict(base({ due: '2026-11-01', committed: false, at: FRESH }), '2026-10-01', NOW), 'drop');
    assert.equal(overrideVerdict(base({ due: '2026-11-01', at: FRESH }), '2026-10-01', NOW), 'drop');
  });
  it('everything expires: stale sets and stale clears drop, file wins', () => {
    assert.equal(overrideVerdict(base({ due: '2026-11-01', committed: true, at: STALE }), null, NOW), 'drop');
    assert.equal(overrideVerdict(base({ due: '2026-11-01', committed: false, at: STALE }), null, NOW), 'drop');
    assert.equal(overrideVerdict(base({ due: null, committed: true, at: STALE }), '2026-10-01', NOW), 'drop');
    assert.equal(overrideVerdict(base({ due: null, committed: false, at: STALE }), '2026-10-01', NOW), 'drop');
    assert.equal(overrideVerdict(base({ due: '2026-11-01' }), null, NOW), 'drop');
  });
  it('TTL boundary is [0, TTL): exactly TTL old is stale, future-dated drops', () => {
    assert.equal(overrideVerdict(base({ due: '2026-11-01', at: NOW - DUE_OVERRIDE_TTL_MS + 1 }), null, NOW), 'apply');
    assert.equal(overrideVerdict(base({ due: '2026-11-01', at: NOW - DUE_OVERRIDE_TTL_MS }), null, NOW), 'drop');
    assert.equal(overrideVerdict(base({ due: '2026-11-01', at: NOW + 1000 }), null, NOW), 'drop');
  });
  it('malformed entries drop', () => {
    assert.equal(overrideVerdict(null, null, NOW), 'drop');
    assert.equal(overrideVerdict({ head: 'H' }, null, NOW), 'drop');
  });
});

describe('due override store (save/supersede/drop + legacy migration)', () => {
  it('saves, supersedes same key, and drops', () => {
    saveDueOverride('f.md', 'H', '2026-11-01');
    saveDueOverride('f.md', 'H', '2026-11-02', true);
    const all = loadDueOverrides();
    assert.equal(all.length, 1);
    assert.equal(all[0].due, '2026-11-02');
    assert.equal(all[0].committed, true);
    assert.ok(Number.isFinite(all[0].at));
    dropDueOverride('f.md', 'H');
    assert.deepEqual(loadDueOverrides(), []);
  });
  it('migrates only fresh committed legacy entries, then drops the legacy key', async () => {
    const fresh = await import('../src/logic/due-overrides.js?due-mig=1');
    const now = Date.now();
    globalThis.localStorage.setItem('safepipe-due-overrides', JSON.stringify([
      { file: 'a.md', head: 'H', due: '2026-11-01', committed: true, at: now - 1000 },
      { file: 'b.md', head: 'H', due: '2026-11-01', committed: false, at: now - 1000 },
      { file: 'c.md', head: 'H', due: '2026-11-01', committed: true, at: now - DUE_OVERRIDE_TTL_MS - 1 },
      { file: 'd.md', head: 'H', due: '2026-11-01' },
    ]));
    const all = fresh.loadDueOverrides();
    assert.equal(all.length, 1);
    assert.equal(all[0].file, 'a.md');
    assert.equal(globalThis.localStorage.getItem('safepipe-due-overrides'), null);
  });
});

describe('shared head-matching core (explicit return shapes)', () => {
  it('normHead collapses whitespace + NFKC, never throws', () => {
    assert.equal(normHead('  Task   1 —  Head '), 'Task 1 — Head');
    assert.equal(normHead(null), '');
    assert.equal(normHead(42), '42');
  });
  it('headingOf parses ## / ### with level, null otherwise', () => {
    assert.deepEqual(headingOf('## Task 1 — H'), { lvl: 2, text: 'Task 1 — H' });
    assert.deepEqual(headingOf('### Task 1 — H  '), { lvl: 3, text: 'Task 1 — H' });
    assert.equal(headingOf('# Top'), null);
    assert.equal(headingOf('#### Deep'), null);
    assert.equal(headingOf('plain'), null);
    assert.equal(headingOf(null), null);
  });
  it('findHeadIndex: exact → fuzzy-single → -1', () => {
    const lines = FILE_TEXT.split('\n');
    assert.equal(findHeadIndex(lines, 'Task 1 — Head'), 4);
    assert.equal(findHeadIndex(lines, 'Task   1 — Head'), 4);
    assert.equal(findHeadIndex(lines, 'Task 1'), 4);
    assert.equal(findHeadIndex(lines, 'Task'), -1);
    assert.equal(findHeadIndex(lines, 'Missing'), -1);
    assert.equal(findHeadIndex(lines, ''), -1);
    assert.equal(findHeadIndex(null, 'Task 1'), -1);
  });
});

describe('canonicalHead (send-time head resolution)', () => {
  const heads = ['Task 1 — Open work', 'Task 2 — Shipped', 'Follow-up polish {#follow-up}'];
  it('exact match wins', () => {
    assert.equal(canonicalHead(heads, 'Task 2 — Shipped'), 'Task 2 — Shipped');
  });
  it('resolves whitespace/normalization drift', () => {
    assert.equal(canonicalHead(heads, 'Task   1 —   Open work'), 'Task 1 — Open work');
  });
  it('fuzzy-resolves an unambiguous prefix, null on ambiguous or missing', () => {
    assert.equal(canonicalHead(heads, 'Task 1'), 'Task 1 — Open work');
    assert.equal(canonicalHead(heads, 'Task'), null);
    assert.equal(canonicalHead(heads, 'No such head'), null);
    assert.equal(canonicalHead(heads, ''), null);
    assert.equal(canonicalHead([], 'Task 1'), null);
  });
});

describe('due progress + published status are read-back-verified, never assumed', () => {
  it('toast vocabulary is pinned: commit slot + deploy slot, two at a time', async () => {
    const prog = await import('../src/changelog/due-progress.js?due-prog-steps=1');
    assert.deepEqual(prog.DUE_PROGRESS_COMMIT_STEPS, ['publishing', 'committed']);
    assert.deepEqual(prog.DUE_PROGRESS_DEPLOY_STEPS, ['deploying', 'live']);
  });
  it('read-back mismatch never shows published (saved iff paint equals pick)', () => {
    assert.equal(confirmPublish('2026-11-01', '2026-11-01'), 'saved');
    assert.equal(confirmPublish(null, null), 'saved', 'clear verifies against empty paint');
    assert.equal(confirmPublish('2026-10-01', '2026-11-01'), 'mismatch', 'stale paint');
    assert.equal(confirmPublish(null, '2026-11-01'), 'mismatch', 'missing paint');
    assert.equal(confirmPublish('2026-11-01', null), 'mismatch', 'unexpected paint on clear');
    assert.equal(confirmPublish(undefined, '2026-11-01'), 'mismatch', 'unreadable paint');
    assert.equal(confirmPublish(undefined, null), 'mismatch', 'never assume, even on clear');
  });
});

describe('dueFailureReason (reason allowlist)', () => {
  it('passes head-not-found, keeps bare unchanged, stays generic otherwise', () => {
    assert.equal(dueFailureReason({ unchanged: true, reason: 'head-not-found' }), 'head-not-found');
    assert.equal(dueFailureReason({ unchanged: true }), 'unchanged');
    assert.equal(dueFailureReason({ committed: false }), 'error');
    assert.equal(dueFailureReason({ reason: 'weird-server-text' }), 'error');
    assert.equal(dueFailureReason({ reason: '<script>alert(1)</script>' }), 'error');
    assert.equal(dueFailureReason(null), 'error');
    assert.equal(dueFailureReason({}), 'error');
  });
  it('documents the allowlisted code list', () => {
    assert.ok(DUE_FAILURE_REASONS.includes('head-not-found'));
  });
});

describe('schedule-gate sticky session (401-only logout)', () => {
  const realFetch = globalThis.fetch;
  const realWindow = globalThis.window;
  const realDocument = globalThis.document;
  const realSession = globalThis.sessionStorage;
  afterEach(() => {
    globalThis.fetch = realFetch;
    globalThis.window = realWindow;
    globalThis.document = realDocument;
    globalThis.sessionStorage = realSession;
  });
  const setup = async (fetchImpl) => {
    globalThis.fetch = fetchImpl;
    globalThis.window = { addEventListener() {} };
    globalThis.document = {
      body: { classList: { toggle() {} } },
      querySelector: () => null,
      addEventListener() {},
    };
    const sess = {};
    globalThis.sessionStorage = {
      getItem: (k) => (k in sess ? sess[k] : null),
      setItem: (k, v) => { sess[k] = String(v); },
      removeItem: (k) => { delete sess[k]; },
    };
    const auth = await import('../src/logic/schedule-auth.js');
    auth.setSchedUser({ login: 'owner1', provider: 'github' });
    auth.setSchedToken('tok');
    const gate = await import('../src/changelog/schedule-gate.js?due-gate=1');
    gate.initScheduleGate();
    await new Promise((r) => setTimeout(r, 60));
    return auth;
  };
  it('keeps a healthy session on 403 (rate limit is not a dead token)', async () => {
    const auth = await setup(async () => ({ ok: false, status: 403 }));
    assert.ok(auth.getSchedUser(), 'session survives a 403 revalidation');
    assert.equal(auth.getSchedToken(), 'tok');
  });
  it('keeps the session when the network fails (offline is not logged-out)', async () => {
    const auth = await setup(async () => { throw new Error('offline'); });
    assert.ok(auth.getSchedUser(), 'session survives offline revalidation');
  });
  it('logs out on 401 (dead token)', async () => {
    const auth = await setup(async () => ({ ok: false, status: 401 }));
    assert.equal(auth.getSchedUser(), null);
    assert.equal(auth.getSchedToken(), null);
  });
});

describe('due progress card (DOM keying, repo stub conventions)', () => {
  const realDocument = globalThis.document;
  afterEach(() => { globalThis.document = realDocument; });
  const mkEl = (tag) => {
    const el = {
      tag, children: [], dataset: {}, hidden: false, textContent: '',
      attrs: {},
      classList: {
        _s: new Set(),
        toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); },
        contains(c) { return this._s.has(c); },
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      appendChild(c) { this.children.push(c); return c; },
      querySelector(sel) {
        const m = /^\[([^\]]+)\]$/.exec(String(sel).trim());
        const attr = m && m[1];
        let found = null;
        const walk = (n) => {
          if (found) return;
          if (attr && n.attrs && n.attrs[attr] !== undefined) { found = n; return; }
          n.children.forEach(walk);
        };
        walk(el);
        return found;
      },
      querySelectorAll() {
        const out = [];
        const walk = (n) => {
          if (n.attrs && n.attrs['data-prog-step'] !== undefined) out.push(n);
          n.children.forEach(walk);
        };
        walk(el);
        return out;
      },
    };
    return el;
  };
  const setup = async () => {
    let card = null;
    globalThis.document = {
      body: { appendChild: (el) => { card = el; } },
      createElement: (t) => mkEl(t),
      getElementById: (id) => (card && card.id === id ? card : null),
    };
    return import('../src/changelog/due-progress.js?due-prog=1');
  };
  it('linear track: Saved lands, Syncing spins, Synced lands with check; stale keys ignored', async () => {
    const prog = await setup();
    const a = { file: 'f.md', head: 'H', due: '2026-11-01' };
    prog.showDueProgress(a);
    const card = globalThis.document.getElementById('ds-due-progress');
    assert.ok(card && card.hidden, 'saving is silent — the card parks');
    const node = (n) => card.querySelector(`[data-prog-node-${n}]`);
    const label = (n) => node(n).querySelector('[data-prog-label]').textContent;
    const cls = (n, c) => node(n).classList.contains(c);
    prog.setDueProgressStep(a, 'saved');
    assert.equal(card.hidden, false, 'Saved reveals the track');
    assert.equal(label('saved'), 'Saved');
    assert.ok(cls('saved', 'is-done'));
    assert.ok(cls('syncing', 'is-todo'));
    assert.ok(cls('synced', 'is-todo'));
    prog.setDueProgressStep(a, 'committed');
    assert.equal(label('syncing'), 'Syncing', 'legacy commit signal starts the sync watch');
    assert.ok(cls('syncing', 'is-active'), 'active stage spins');
    assert.ok(cls('saved', 'is-done'));
    prog.setDueProgressStep({ file: 'f.md', head: 'OTHER', due: '2026-11-01' }, 'synced');
    assert.ok(cls('synced', 'is-todo'), 'a stale pick never advances newer state');
    prog.setDueProgressStep(a, 'deploying');
    assert.ok(cls('syncing', 'is-active'), 'deploy vocabulary is a no-op — sync commits skip ci');
    prog.setDueProgressStep(a, 'bogus-step');
    assert.ok(cls('synced', 'is-todo'), 'unknown steps are ignored');
    prog.setDueProgressStep(a, 'synced');
    assert.equal(label('synced'), 'Synced ✓');
    assert.ok(cls('synced', 'is-done'));
    assert.ok(cls('syncing', 'is-done'));
  });
  it('a rapid re-pick keeps its own key; stale hide and stale steps never disturb it', async () => {
    const prog = await setup();
    const a = { file: 'f.md', head: 'H', due: '2026-11-01' };
    const b = { file: 'f.md', head: 'H', due: '2026-11-02' };
    prog.showDueProgress(a);
    prog.hideDueProgress(a, 20);
    prog.showDueProgress(b);
    await new Promise((r) => setTimeout(r, 50));
    const card = globalThis.document.getElementById('ds-due-progress');
    assert.equal(card.dataset.progKey, 'f.md::H::2026-11-02', 're-pick owns the card');
    prog.setDueProgressStep(a, 'committed');
    assert.equal(card.hidden, true, 'a stale pick never reveals the parked card');
    prog.setDueProgressStep(b, 'committed');
    assert.equal(card.hidden, false, 'the watch reveals the track at Syncing');
    assert.equal(card.dataset.progStep, 'syncing');
    prog.hideDueProgress(b, 0);
    assert.equal(card.hidden, true);
  });
});

describe('dueFetchVerdict (post-commit lagged-fetch guard)', () => {
  const rec = { file: 'p.md', head: 'H', due: '2026-11-02', pre: '2026-10-01', at: 1000000 };
  it('no claim takes the fetched text', () => {
    assert.equal(dueFetchVerdict(null, 'p.md', '2026-10-01', 1000000), 'apply');
  });
  it('other files are unaffected', () => {
    assert.equal(dueFetchVerdict(rec, 'other.md', null, 1000000), 'apply');
  });
  it('lagged pre-commit text is held, never painted', () => {
    assert.equal(dueFetchVerdict(rec, 'p.md', '2026-10-01', 1000000 + 5000), 'skip');
  });
  it('file truth carrying our value confirms and settles', () => {
    assert.equal(dueFetchVerdict(rec, 'p.md', '2026-11-02', 1000000 + 5000), 'confirmed');
  });
  it("another device's newer value is taken, never held (no refresh needed)", () => {
    assert.equal(dueFetchVerdict(rec, 'p.md', '2026-11-05', 1000000 + 5000), 'superseded');
    assert.equal(dueFetchVerdict(rec, 'p.md', null, 1000000 + 5000), 'superseded');
  });
  it('clear claims: absence confirms, pre value holds, third value yields', () => {
    const clr = { file: 'p.md', head: 'H', due: null, pre: '2026-10-01', at: 1000000 };
    assert.equal(dueFetchVerdict(clr, 'p.md', null, 1000000 + 1000), 'confirmed');
    assert.equal(dueFetchVerdict(clr, 'p.md', '2026-10-01', 1000000 + 1000), 'skip');
    assert.equal(dueFetchVerdict(clr, 'p.md', '2026-11-05', 1000000 + 1000), 'superseded');
  });
  it('first pick from empty: lagged emptiness holds, anything else settles', () => {
    const first = { file: 'p.md', head: 'H', due: '2026-11-02', pre: null, at: 1000000 };
    assert.equal(dueFetchVerdict(first, 'p.md', null, 1000000 + 1000), 'skip');
    assert.equal(dueFetchVerdict(first, 'p.md', '2026-11-02', 1000000 + 1000), 'confirmed');
    assert.equal(dueFetchVerdict(first, 'p.md', '2026-11-05', 1000000 + 1000), 'superseded');
  });
  it('expired claims accept the fetched text', () => {
    assert.equal(dueFetchVerdict(rec, 'p.md', '2026-10-01', 1000000 + DUE_CONFIRM_WINDOW_MS), 'apply');
    assert.equal(dueFetchVerdict(rec, 'p.md', '2026-10-01', 1000000 + DUE_CONFIRM_WINDOW_MS + 1), 'apply');
  });
  it('confirm store round-trips with pre and clears', () => {
    saveDueConfirm({ file: 'p.md', head: 'H', due: '2026-11-02', pre: '2026-10-01' });
    const back = readDueConfirm();
    assert.equal(back.file, 'p.md');
    assert.equal(back.due, '2026-11-02');
    assert.equal(back.pre, '2026-10-01');
    assert.ok(Number.isFinite(back.at));
    clearDueConfirm();
    assert.equal(readDueConfirm(), null);
  });
  it('malformed records never block a fetch', () => {
    assert.equal(dueFetchVerdict({ file: 'p.md' }, 'p.md', null, 1000000), 'apply');
    saveDueConfirm({ file: 'p.md' });
    assert.equal(readDueConfirm(), null);
  });
});

describe('due deploy lifecycle (freeze remains until the redeploy, editing stays allowed)', () => {
  const now = 2000000;
  const rec = { file: 'p.md', head: 'H', due: '2026-11-02', at: now };
  it('fresh claims stay pending (freeze remains, toast parked)', () => {
    assert.equal(dueDeployVerdict(rec, now + 1000), 'pending');
    assert.equal(dueDeployVerdict(rec, now + DUE_PENDING_WINDOW_MS - 1), 'pending');
  });
  it('unshown deploys expire (toast heals away deterministically)', () => {
    assert.equal(dueDeployVerdict(rec, now + DUE_PENDING_WINDOW_MS), 'expired');
    assert.equal(dueDeployVerdict(rec, now + DUE_PENDING_WINDOW_MS + 1), 'expired');
  });
  it('missing or malformed claims never freeze anything', () => {
    assert.equal(dueDeployVerdict(null, now), 'none');
    assert.equal(dueDeployVerdict({ file: 'p.md' }, now), 'none');
    assert.equal(dueDeployVerdict({ ...rec, at: NaN }, now), 'none');
    assert.equal(dueDeployVerdict({ ...rec, at: now + 5000 }, now), 'none');
  });
  it('pending store round-trips, supersedes, and clears', () => {
    saveDuePending({ file: 'p.md', head: 'H', due: '2026-11-02' });
    let back = readDuePending();
    assert.equal(back.file, 'p.md');
    assert.equal(back.due, '2026-11-02');
    assert.ok(Number.isFinite(back.at));
    // A re-pick before the redeploy supersedes with a new claim.
    saveDuePending({ file: 'p.md', head: 'H', due: '2026-11-05' });
    back = readDuePending();
    assert.equal(back.due, '2026-11-05');
    clearDuePending();
    assert.equal(readDuePending(), null);
    saveDuePending({ file: 'p.md' });
    assert.equal(readDuePending(), null);
  });
});
