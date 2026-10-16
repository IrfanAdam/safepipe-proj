// safepipe — due-date commit endpoint (Vercel serverless).
// The static production build cannot write plan files, so deadline picks are
// committed to git here and ride the next deploy. Auth: the caller sends its
// OAuth token (read:user + public_repo); the server checks the login against
// DUE_AUTHOR and commits AS THE AUTHOR with that same token — no service
// token, no extra secrets beyond the existing OAuth app.
//
// Env (Vercel -> Settings -> Environment Variables, Production):
//   DUE_AUTHOR  GitHub login allowed to set deadlines (e.g. IrfanAdam)
//   DUE_REPO    owner/repo (e.g. IrfanAdam/safepipe-proj)
//   DUE_BRANCH  main
const DUE_SHAPE = /^\s*\*Due:\s*[^*\n]*\*\s*$/;
const escRe = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Port of dueEditText (src/changelog/changelog-events.js) — keep in sync:
// insert/replace/clear the single `*Due: YYYY-MM-DD*` line under the owning
// head, idempotently. Head not found → text unchanged.
function dueEditText(raw, head, due) {
  const lines = String(raw || '').split('\n');
  const want = String(head || '').trim();
  const hi = lines.findIndex((ln) => new RegExp(`^#{2,3}\\s+${escRe(want)}\\s*$`).test(ln));
  if (hi < 0) return String(raw || '');
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
    return out.join('\n');
  }
  const line = `*Due: ${due}*`;
  if (shaped.length) {
    out[shaped[0]] = line;
    for (let k = shaped.length - 1; k >= 1; k--) out.splice(shaped[k], 1);
    return out.join('\n');
  }
  let at = hi + 1;
  if (/^\s*\*Tags:/i.test(lines[hi + 1] || '')) at = hi + 2;
  out.splice(at, 0, line);
  return out.join('\n');
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
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  const { token, file, head, due = null } = req.body || {};
  const author = process.env.DUE_AUTHOR;
  const repo = process.env.DUE_REPO;
  const branch = process.env.DUE_BRANCH || 'main';
  if (!author || !repo) {
    res.status(500).send('Missing DUE_AUTHOR / DUE_REPO env vars in Vercel.');
    return;
  }
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
    if (!login || login !== author) { res.status(403).send('Not the schedule owner'); return; }
    // Load, edit (same algorithm as the client preview), commit as the author.
    const path = `.hermes/plans/${file}`;
    const cur = await gh(token, `/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`);
    if (!cur.ok) { res.status(400).send('Plan file not found in repo'); return; }
    const { sha, content } = await cur.json();
    const raw = Buffer.from(content || '', 'base64').toString('utf8');
    const next = dueEditText(raw, head.trim(), due);
    if (next === raw) { res.status(200).json({ unchanged: true }); return; }
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
    res.status(200).json({ committed: (done.commit || {}).sha || null });
  } catch (e) {
    res.status(500).send('Due commit failed');
  }
}
