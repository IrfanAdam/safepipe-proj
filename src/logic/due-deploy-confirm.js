// safepipe logic — due redeploy confirmation (pure, zero DOM) · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]
// End-to-end confirmation for a GitHub-backed deadline pick, with zero new
// backend infra. Two phases:
//
//   1. repoConfirmed — poll the GitHub contents API for .hermes/plans/<file>
//      until the file carries the expected Due state under the matching head
//      (or its blob sha becomes the fileSha /api/due just committed).
//   2. deployConfirmed — poll the same-origin document (cache-busted,
//      cache:'no-store') until the content-hashed changelog chunk filename
//      differs from the one this bundle booted with, proving the redeploy
//      that carries the pick is now serving.
//
// Clear-due (due null) confirms the Due line is GONE from the section.
// The caller owns all DOM/identity: it passes its in-memory OAuth token
// (scope read:user public_repo), the repo/branch/fileSha from /api/due,
// currentAsset read from its own script tag, and pageUrl (location.href).
// Resolves { repoConfirmed, deployConfirmed } on full success, or
// { repoConfirmed, deployConfirmed, timedOut: true } after timeoutMs
// (default 5 min, poll every 10 s). Rejects only on bad args, a dead fetch,
// or an aborted signal.
const DUE_SHAPE = /^\s*\*Due:\s*[^*\n]*\*\s*$/;
const escRe = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CHUNK_RE = /changelog-([A-Za-z0-9_-]+)\.js/;

const fetchImplOf = (f) => {
  const impl = f || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  if (!impl) throw new Error('confirmDueLive: no fetch available');
  return impl;
};

const b64decode = (b64) => {
  const clean = String(b64 || '').replace(/\s+/g, '');
  if (typeof globalThis.Buffer !== 'undefined') return globalThis.Buffer.from(clean, 'base64').toString('utf8');
  const bin = globalThis.atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

// Section slice: lines under the `## head` (or ###) up to the next heading
// of equal-or-higher level. Head not found → null.
function sectionLines(raw, head) {
  const lines = String(raw || '').split('\n');
  const want = String(head || '').trim();
  const hi = lines.findIndex((ln) => new RegExp(`^#{2,3}\\s+${escRe(want)}\\s*$`).test(ln));
  if (hi < 0) return null;
  const lvl = (lines[hi].match(/^#+/) || ['##'])[0].length;
  let end = lines.length;
  for (let i = hi + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,3})\s/);
    if (m && m[1].length <= lvl) { end = i; break; }
  }
  return lines.slice(hi + 1, end);
}

// True when the section already carries the expected Due state:
// due set → the exact `*Due: <due>*` line is present;
// due null (clear) → no Due-shaped line remains.
export function dueSectionSatisfied(raw, head, due) {
  const sec = sectionLines(raw, head);
  if (!sec) return false;
  if (due === null || due === undefined) return !sec.some((ln) => DUE_SHAPE.test(ln));
  return sec.includes(`*Due: ${due}*`);
}

// First `changelog-<hash>.js` asset referenced by a fetched document,
// or null when the document carries no such reference.
export function extractChangelogAsset(html) {
  const m = String(html || '').match(CHUNK_RE);
  return m ? m[0] : null;
}

// Content hash portion of a changelog chunk filename, or the raw value.
export function assetHash(asset) {
  const m = String(asset || '').match(CHUNK_RE);
  return m ? m[1] : String(asset || '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const throwIfAborted = (signal) => {
  if (signal && signal.aborted) {
    const e = new Error('confirmDueLive: aborted');
    e.name = 'AbortError';
    throw e;
  }
};

async function pollRepo({ fetchImpl, token, repo, branch, file, head, due, fileSha, deadline, intervalMs, signal }) {
  const path = `.hermes/plans/${file}`;
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  for (;;) {
    throwIfAborted(signal);
    let entry = null;
    try {
      const r = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        cache: 'no-store',
      });
      if (r && r.ok) entry = await r.json();
    } catch { entry = null; }
    if (entry) {
      if (fileSha && entry.sha === fileSha) return true;
      try {
        if (dueSectionSatisfied(b64decode(entry.content || ''), head, due)) return true;
      } catch { /* malformed payload — keep polling */ }
    }
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
}

async function pollDeploy({ fetchImpl, pageUrl, currentAsset, deadline, intervalMs, signal }) {
  const want = assetHash(currentAsset);
  const base = String(pageUrl).split('#')[0];
  const sep = base.includes('?') ? '&' : '?';
  for (;;) {
    throwIfAborted(signal);
    try {
      const r = await fetchImpl(`${base}${sep}_=${Date.now()}`, { cache: 'no-store' });
      if (r && r.ok) {
        const html = await r.text();
        const found = extractChangelogAsset(html);
        // A live hash differing from the booted bundle proves redeploy.
        // No booted hash (caller couldn't read its script tag): any live
        // hash proves the deploy pipeline is serving fresh content.
        if (found && (!want || assetHash(found) !== want)) return true;
      }
    } catch { /* transient — keep polling */ }
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
}

export async function confirmDueLive(opts = {}) {
  const {
    token, repo, branch = 'main', file, head, due = null, fileSha = null,
    currentAsset = null, pageUrl = null,
    timeoutMs = 5 * 60 * 1000, intervalMs = 10 * 1000,
    signal = null, fetchImpl = null,
  } = opts;
  if (typeof token !== 'string' || !token) throw new Error('confirmDueLive: token required');
  if (typeof repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('confirmDueLive: repo must be owner/slug');
  if (typeof file !== 'string' || !file.endsWith('.md') || file.includes('..')) throw new Error('confirmDueLive: invalid file');
  if (typeof head !== 'string' || !head.trim()) throw new Error('confirmDueLive: head required');
  if (due !== null && (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due))) throw new Error('confirmDueLive: invalid due');
  const fetch = fetchImplOf(fetchImpl);
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 5 * 60 * 1000;
  const interval = Number(intervalMs) > 0 ? Number(intervalMs) : 10 * 1000;
  const deadline = Date.now() + timeout;

  const repoConfirmed = await pollRepo({
    fetchImpl: fetch, token, repo, branch, file, head, due, fileSha,
    deadline, intervalMs: interval, signal,
  });
  if (!repoConfirmed) return { repoConfirmed: false, deployConfirmed: false, timedOut: true };
  // No page to poll (caller withheld location): repo proof is all we can get.
  if (!pageUrl) return { repoConfirmed: true, deployConfirmed: false };
  const deployConfirmed = await pollDeploy({
    fetchImpl: fetch, pageUrl, currentAsset, deadline, intervalMs: interval, signal,
  });
  if (!deployConfirmed) return { repoConfirmed: true, deployConfirmed: false, timedOut: true };
  return { repoConfirmed: true, deployConfirmed: true };
}
