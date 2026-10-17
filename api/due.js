// safepipe — due-date commit endpoint (Vercel serverless).
// The static production build cannot write plan files, so deadline picks are
// committed to git here and ride the next deploy. Auth: the caller sends its
// OAuth token (read:user + public_repo); the server checks the login is the
// REPO OWNER and commits with that same token. Zero extra env, zero extra
// secrets: repo coordinates come from Vercel's own system variables and the
// author is whoever owns the repo.
const DUE_SHAPE = /^\s*\*Due:\s*[^*\n]*\*\s*$/;
const normHead = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const headingOf = (ln) => {
  const m = String(ln || '').match(/^(#{2,3})\s+(.*?)\s*$/);
  if (!m) return null;
  return { lvl: m[1].length, text: normHead(m[2]) };
};
// Port of dueEditText (src/changelog/changelog-events.js) — keep in sync:
// insert/replace/clear the single `*Due: YYYY-MM-DD*` line under the owning
// head, idempotently. Head not found → found false, text unchanged.
function dueEditText(raw, head, due) {
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const want = normHead(head);
  let hi = lines.findIndex((ln) => {
    const h = headingOf(ln);
    return h !== null && h.text === want;
  });
  if (hi < 0 && want) {
    const key = want.slice(0, 40);
    if (key) {
      const cand = [];
      for (let i = 0; i < lines.length; i++) {
        const h = headingOf(lines[i]);
        if (h !== null && h.text.includes(key)) cand.push(i);
      }
      if (cand.length === 1) hi = cand[0];
    }
  }
  if (hi < 0) return { text, next: text, found: false, fileLines: lines.length };
  const lvl = (lines[hi].match(/^#+/) || ['##'])[0].length;
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
async function dueHandler(req, res) {
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
  if (due !== null && (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due))) {
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
