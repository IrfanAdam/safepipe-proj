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
