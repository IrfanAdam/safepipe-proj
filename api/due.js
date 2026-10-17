// safepipe — due-date commit endpoint (Vercel serverless).
// The static production build cannot write plan files, so deadline picks are
// committed to git here and ride the next deploy. Auth: the caller sends its
// OAuth token (read:user + public_repo); the server checks the login is the
// REPO OWNER and commits with that same token. Zero extra env, zero extra
// secrets: repo coordinates come from Vercel's own system variables and the
// author is whoever owns the repo.
import { headingOf, findHeadIndex } from '../src/logic/due-overrides.js';
// Reason codes the server may report for leaving the file alone. Only
// allowlisted codes ever reach the UI (client maps anything else generic).
export const DUE_UNCHANGED_REASONS = ['head-not-found'];
// Calendar validation for a due value (mirrors parseDue in
// src/changelog/changelog-parse.js: shape + real calendar day, year ≤ 2099).
const DUE_DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function isValidDue(due) {
  if (due === null) return true;
  if (typeof due !== 'string') return false;
  const m = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= (mo === 2 && leap ? 29 : DUE_DIM[mo - 1]);
}
const DUE_SHAPE = /^\s*\*Due:\s*[^*\n]*\*\s*$/;
// File-text twin of dueEditText (src/changelog/changelog-events.js): head
// matching is shared via findHeadIndex — only the return shape differs
// ({text,next,found} here, plain string there). Parity is pinned by
// tests/due-pipeline.test.js. Inserts/replaces/clears the single
// `*Due: YYYY-MM-DD*` line under the owning head, idempotently; head not
// found → found false, text unchanged.
export function dueEditText(raw, head, due) {
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const hi = findHeadIndex(lines, head);
  if (hi < 0) return { text, next: text, found: false, fileLines: lines.length };
  const lvl = (headingOf(lines[hi]) || {}).lvl || 2;
  let end = lines.length;
  for (let i = hi + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,3})\s/);
    if (m && m[1].length <= lvl) { end = i; break; }
  }
  const shaped = [];
  for (let i = hi + 1; i < end; i++) if (DUE_SHAPE.test(lines[i])) shaped.push(i);
  const out = lines.slice();
  if (!due) {
    for (let k = shaped.length - 1; k >= 0; k--) out.splice(shaped[k], 1);
    return { text, next: out.join('\n'), found: true, fileLines: lines.length };
  }
  const line = `*Due: ${due}*`;
  if (shaped.length) {
    out[shaped[0]] = line;
    for (let k = shaped.length - 1; k >= 1; k--) out.splice(shaped[k], 1);
    return { text, next: out.join('\n'), found: true, fileLines: lines.length };
  }
  let at = hi + 1;
  if (/^\s*\*Tags:/i.test(lines[hi + 1] || '')) at = hi + 2;
  out.splice(at, 0, line);
  return { text, next: out.join('\n'), found: true, fileLines: lines.length };
}
const gh = (token, path, opts = {}) => fetch(`https://api.github.com${path}`, {
  ...opts,
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  },
});
export default async function handler(req, res) {
  try {
    await dueHandler(req, res);
  } catch (e) {
    try {
      if (!res.headersSent) res.status(500).json({ error: 'Due commit failed' });
    } catch {}
  }
}
export async function dueHandler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  const { token, file, head, due = null } = req.body || {};
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  const branch = process.env.VERCEL_GIT_COMMIT_REF || 'main';
  if (!owner || !slug) {
    res.status(500).send('Repo context unavailable');
    return;
  }
  const repo = `${owner}/${slug}`;
  if (typeof token !== 'string' || !token) { res.status(401).send('Login required'); return; }
  // Plan files only — no paths, no traversal, no other trees.
  if (typeof file !== 'string' || !/^[\w][\w\-. ]*\.md$/.test(file) || file.includes('..')) {
    res.status(400).send('Invalid file');
    return;
  }
  if (typeof head !== 'string' || !head.trim() || head.length > 200) {
    res.status(400).send('Invalid head');
    return;
  }
  if (!isValidDue(due)) {
    res.status(400).send('Invalid due');
    return;
  }
  try {
    // Identity check: the caller's token proves WHO they are (read:user).
    const me = await gh(token, '/user');
    if (!me.ok) { res.status(401).send('Login required'); return; }
    const { login } = await me.json();
    if (!login || login !== owner) { res.status(403).send('Not the repo owner'); return; }
    // Load, edit (same algorithm as the client preview), commit as the author.
    const path = `.hermes/plans/${file}`;
    const cur = await gh(token, `/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`);
    if (!cur.ok) { res.status(400).send('Plan file not found in repo'); return; }
    const { sha, content } = await cur.json();
    const raw = Buffer.from(content || '', 'base64').toString('utf8');
    const edit = dueEditText(raw, head, due);
    if (!edit.found) {
      res.status(200).json({
        committed: null,
        unchanged: true,
        reason: 'head-not-found',
        headPreview: String(head).slice(0, 60),
        fileLines: edit.fileLines,
        repo,
        branch,
        fileSha: sha || null,
      });
      return;
    }
    const next = edit.next;
    // Idempotent success: the head is found and the file already carries the
    // requested value (timeout retry or duplicate tap after the commit
    // landed). Report SUCCESS with the current content — never `unchanged`,
    // so a retry-after-success converges instead of failing forever.
    // `unchanged` is reserved for head-not-found above.
    if (next === edit.text) {
      res.status(200).json({ committed: sha || null, repo, branch, fileSha: sha || null, content: edit.text });
      return;
    }
    const msg = `chore(${file}): ${due ? `set due ${due}` : 'clear due'} [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]`;
    const put = await gh(token, `/repos/${repo}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: msg,
        content: Buffer.from(next, 'utf8').toString('base64'),
        sha,
        branch,
      }),
    });
    if (!put.ok) {
      const err = await put.text().catch(() => '');
      res.status(502).send(`Commit failed: ${err.slice(0, 200)}`);
      return;
    }
    const done = await put.json();
    // Server truth for the caller: the committed text lets the client apply
    // the value directly with no CDN wait and no confirm poll.
    // [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-2]
    res.status(200).json({
      committed: (done.commit || {}).sha || null,
      repo,
      branch,
      fileSha: (done.content || {}).sha || null,
      content: next,
    });
  } catch (e) {
    try {
      if (!res.headersSent) res.status(500).json({ error: 'Due commit failed' });
    } catch {}
  }
}
