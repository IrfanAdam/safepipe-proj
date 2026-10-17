// plan-source.js — live plan markdown loader (logic, zero I/O except fetch).
// Pure fetch + pure functions only; URL built from parameters.

function repoOwner() {
  try {
    if (typeof __REPO_OWNER__ !== 'undefined' && __REPO_OWNER__) return String(__REPO_OWNER__);
  } catch { /* ignore */ }
  return 'IrfanAdam';
}

function repoSlug() {
  try {
    if (typeof __REPO_SLUG__ !== 'undefined' && __REPO_SLUG__) return String(__REPO_SLUG__);
  } catch { /* ignore */ }
  return 'safepipe-proj';
}

function repoRef(branch) {
  if (branch) return String(branch);
  try {
    if (typeof __REPO_REF__ !== 'undefined' && __REPO_REF__) return String(__REPO_REF__);
  } catch { /* ignore */ }
  return 'main';
}

export function planRawUrl(file, branch) {
  const owner = repoOwner();
  const slug = repoSlug();
  const ref = repoRef(branch);
  return 'https://raw.githubusercontent.com/' + owner + '/' + slug + '/' + ref + '/.hermes/plans/' + String(file);
}

async function fetchOne(file, url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res || res.ok !== true) return null;
    const text = await res.text();
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

export async function fetchLiveTexts(files, opts = {}) {
  const list = Array.isArray(files) ? files : [];
  const branch = opts && opts.branch ? String(opts.branch) : undefined;
  const fetchImpl = (opts && opts.fetchImpl) || fetch;
  const settled = await Promise.allSettled(
    list.map((file) => fetchOne(file, planRawUrl(file, branch), fetchImpl)),
  );
  const out = {};
  for (let i = 0; i < list.length; i += 1) {
    const s = settled[i];
    out[list[i]] = s && s.status === 'fulfilled' ? s.value : null;
  }
  return out;
}

export function changedTexts(prev, next) {
  const a = prev && typeof prev === 'object' ? prev : {};
  const b = next && typeof next === 'object' ? next : {};
  const out = {};
  for (const key of Object.keys(b)) {
    const text = b[key];
    if (text === null || text === undefined) continue;
    if (a[key] !== text) out[key] = text;
  }
  return out;
}

// Cheap change detection: latest commit touching .hermes/plans via the
// GitHub commits API (no raw.githubusercontent.com CDN lag on this path).
// opts: { branch, owner, slug, fetchImpl, etag, token }. Sends
// If-None-Match when etag is given (conditional requests don't count toward
// the unauthenticated rate limit) and Authorization when a token is given.
// Never throws: any failure resolves { sha: null, etag, notModified: false }.
// [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-3]
export async function fetchLatestPlanSha(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const owner = o.owner ? String(o.owner) : repoOwner();
  const slug = o.slug ? String(o.slug) : repoSlug();
  const ref = repoRef(o.branch);
  const fetchImpl = o.fetchImpl || fetch;
  const incomingEtag = o.etag ? String(o.etag) : null;
  const url = 'https://api.github.com/repos/' + owner + '/' + slug
    + '/commits?path=.hermes/plans&per_page=1&sha=' + encodeURIComponent(ref);
  try {
    const headers = { Accept: 'application/vnd.github+json' };
    if (incomingEtag) headers['If-None-Match'] = incomingEtag;
    if (o.token) headers.Authorization = 'Bearer ' + String(o.token);
    const res = await fetchImpl(url, { headers });
    if (!res) return { sha: null, etag: incomingEtag, notModified: false };
    if (res.status === 304) return { sha: null, etag: incomingEtag, notModified: true };
    if (res.ok !== true) return { sha: null, etag: incomingEtag, notModified: false };
    let etag = null;
    try { etag = res.headers ? res.headers.get('etag') : null; } catch { etag = null; }
    const data = await res.json();
    const sha = Array.isArray(data) && data[0] && data[0].sha ? String(data[0].sha) : null;
    return { sha, etag: etag || incomingEtag, notModified: false };
  } catch {
    return { sha: null, etag: incomingEtag, notModified: false };
  }
}

// Fetch ONE plan file's live text (cache-busted, no CDN staleness).
// Returns the text, or null on any failure / bad args. Never throws.
// [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-3]
export async function fetchFileText(file, opts = {}) {
  if (!file || typeof file !== 'string') return null;
  const o = opts && typeof opts === 'object' ? opts : {};
  const fetchImpl = o.fetchImpl || fetch;
  const branch = o.branch ? String(o.branch) : undefined;
  let bust = 0;
  try { bust = Date.now(); } catch { bust = 0; }
  const url = planRawUrl(file, branch) + '?_=' + String(bust);
  return fetchOne(file, url, fetchImpl);
}
