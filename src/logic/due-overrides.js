// safepipe logic — due-date overrides (pure, zero DOM) · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]
// Same-device persistence for deadline picks. The dev/preview server writes
// the plan file directly (/__ds/due); a static host (production) answers 404,
// so without this the pick evaporates on reload. Overrides are keyed by plan
// file + section head and re-applied to the live bodies at boot. The FILE is
// source of truth once an entry expires: a stored date paints only while
// fresh (a stored *clear* strips only while fresh) — except a
// SERVER-CONFIRMED pick (committed to git via /api/due), which outranks a
// differing file value during the deploy window so a refresh never flashes
// the stale date.
// Entries expire in a day, by which point the redeploy carries them.
// v2 rotation: pre-change devices hold stale entries (legacy shapes without
// at/committed) that shadow live git values — migrate once, keeping only
// fresh committed picks, then drop the legacy key for good.
const KEY = 'safepipe-due-overrides.v2';
const LEGACY_KEY = 'safepipe-due-overrides';
const DAY_MS = 24 * 60 * 60 * 1000;
const store = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};
const validShape = (o) => o && typeof o.file === 'string' && typeof o.head === 'string';
const isFresh = (o, now) =>
  !!o && Number.isFinite(o.at) && (now - o.at) >= 0 && (now - o.at) < DAY_MS;
const isConfirmedFresh = (o, now) => !!o && o.committed === true && isFresh(o, now);
const isFreshCommitted = (o, now) =>
  validShape(o) && isConfirmedFresh(o, now);
let migrated = false;
const migrateOnce = (s) => {
  if (migrated || !s) return;
  migrated = true;
  let legacyRaw = null;
  try { legacyRaw = s.getItem(LEGACY_KEY); } catch { return; }
  if (legacyRaw == null) return;
  try {
    const now = Date.now();
    const parsed = JSON.parse(legacyRaw);
    const survivors = Array.isArray(parsed) ? parsed.filter((o) => isFreshCommitted(o, now)) : [];
    if (survivors.length) {
      let current = [];
      try {
        const curRaw = s.getItem(KEY);
        const curParsed = curRaw ? JSON.parse(curRaw) : [];
        if (Array.isArray(curParsed)) current = curParsed.filter(validShape);
      } catch { current = []; }
      const seen = new Set(current.map((o) => o.file + '\u0000' + o.head));
      for (const o of survivors) {
        const k = o.file + '\u0000' + o.head;
        if (!seen.has(k)) { current.push(o); seen.add(k); }
      }
      s.setItem(KEY, JSON.stringify(current));
    }
  } catch {}
  try { s.removeItem(LEGACY_KEY); } catch {}
};
export function loadDueOverrides() {
  const s = store();
  if (s) migrateOnce(s);
  try {
    const raw = s && s.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(validShape) : [];
  } catch { return []; }
}
const writeAll = (arr) => {
  const s = store();
  try { if (s) s.setItem(KEY, JSON.stringify(arr)); } catch {}
};
export function saveDueOverride(file, head, due, committed = false) {
  const arr = loadDueOverrides().filter((o) => !(o.file === file && o.head === head));
  arr.push({ file, head, due: due || null, committed: !!committed, at: Date.now() });
  writeAll(arr);
}
export function dropDueOverride(file, head) {
  writeAll(loadDueOverrides().filter((o) => !(o.file === file && o.head === head)));
}

// --- Pure scheduling helpers (zero DOM; node-testable) ---

// Head normalization + matching core, shared by the server endpoint
// (api/due.js) and the client preview (changelog-events.js) so the two
// dueEditText ports can never drift apart again. Single responsibilities:
// normHead (one head), headingOf (one line), findHeadIndex (one scan).
export const normHead = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
export const headingOf = (ln) => {
  const m = String(ln || '').match(/^(#{2,3})\s+(.*?)\s*$/);
  if (!m) return null;
  return { lvl: m[1].length, text: normHead(m[2]) };
};
// Exact normalized match, then a single-candidate prefix-fuzzy fallthrough
// (a head that gained/lost spacing or an {#anchor} suffix still resolves).
// Returns the line index, or -1.
export function findHeadIndex(lines, head) {
  const arr = Array.isArray(lines) ? lines : [];
  const want = normHead(head);
  const hi = arr.findIndex((ln) => {
    const h = headingOf(ln);
    return h !== null && h.text === want;
  });
  if (hi >= 0 || !want) return hi;
  const key = want.slice(0, 40);
  if (!key) return -1;
  const cand = [];
  for (let i = 0; i < arr.length; i++) {
    const h = headingOf(arr[i]);
    if (h !== null && h.text.includes(key)) cand.push(i);
  }
  return cand.length === 1 ? cand[0] : -1;
}

// Override time-to-live: an optimistic pick (committed or not) may outrank
// the file only while fresh. Past the TTL the file wins and the entry drops,
// so a failed pick or a stale clear can never shadow live git values forever.
export const DUE_OVERRIDE_TTL_MS = DAY_MS;

// Merge verdict for one stored override against the file's current Due:
// 'apply' (paint o.due), 'strip' (paint a clear), 'drop' (delete the entry).
// Rules: converged entries drop; the file wins over stale or unconfirmed
// entries; a fresh entry (optimistic or server-confirmed) paints while the
// file has not yet converged. Both set and clear expire — a stored clear
// must never strip Dues committed after it.
export function overrideVerdict(o, current, now = Date.now()) {
  if (!validShape(o)) return 'drop';
  const n = Number.isFinite(now) ? now : Date.now();
  if (o.due) {
    if (current === o.due) return 'drop';
    if (current && !isConfirmedFresh(o, n)) return 'drop';
    if (!isFresh(o, n)) return 'drop';
    return 'apply';
  }
  if (!current) return 'drop';
  if (!isFresh(o, n)) return 'drop';
  return 'strip';
}

// Canonical-head resolution core: pick the live head for a (possibly stale)
// pick-time head. Exact match wins; then normalized; then a single-candidate
// prefix-fuzzy match (server parity, cf. api/due.js); ambiguous or missing
// → null (caller surfaces head-not-found).
export function canonicalHead(heads, head) {
  try {
    const list = Array.isArray(heads) ? heads : [];
    const want = String(head || '');
    if (list.some((h) => h === want)) return want;
    const nw = normHead(want);
    if (!nw) return null;
    const byNorm = list.find((h) => normHead(h) === nw);
    if (byNorm !== undefined) return byNorm;
    const key = nw.slice(0, 40);
    if (key) {
      const cand = list.filter((h) => normHead(h).includes(key));
      if (cand.length === 1) return cand[0];
    }
  } catch {}
  return null;
}

// Failure-reason allowlist for /api/due responses: only known codes reach
// the UI — anything else (including raw server text) stays generic 'error',
// and a head-not-found report without the flag is plain 'unchanged'.
export const DUE_FAILURE_REASONS = ['head-not-found', 'unchanged'];
export function dueFailureReason(body) {
  try {
    if (body && body.reason === 'head-not-found') return 'head-not-found';
  } catch {}
  try {
    if (body && body.unchanged) return 'unchanged';
  } catch {}
  return 'error';
}

// Publish-indication rules (read-back-verified, never assumed):
// the progress card earns its live step only when the server-returned file
// text was actually applied to the visible plans (applied === true); an
// override-painted commit stops at Published on git. The published row
// status earns 'saved' only when the date read back from the painted plans
// equals the pick (or empty on clear) — anything else, including an
// unreadable paint, is 'mismatch' (retry), never published.
export function duePublishStep(applied) {
  return applied === true ? 'live' : 'committed';
}
export function confirmPublish(painted, want) {
  const w = want || null;
  return painted === w ? 'saved' : 'mismatch';
}

// Post-commit fetch guard: after our own commit lands, a lagged sync fetch
// (CDN serving the pre-commit file) must not regress the painted date back
// to the previous value. The commit records {file, head, due, at}; each
// changed file from a sync fetch is checked against it while fresh
// (DUE_CONFIRM_WINDOW_MS). Verdicts: 'apply' (no claim or claim settled —
// take the fetched text), 'skip' (fetched text predates our commit — hold
// the current paint for this tick), 'confirmed' (fetched text carries our
// value — take it and clear the claim).
export const DUE_CONFIRM_WINDOW_MS = 120000;
const CONFIRM_KEY = 'safepipe-due-confirm.v1';
export function saveDueConfirm(rec) {
  try {
    const s = store();
    if (!s) return;
    if (!rec || typeof rec.file !== 'string' || typeof rec.head !== 'string') return;
    s.setItem(CONFIRM_KEY, JSON.stringify({
      file: rec.file, head: rec.head, due: rec.due || null, at: Date.now(),
    }));
  } catch {}
}
export function readDueConfirm() {
  try {
    const s = store();
    if (!s) return null;
    const raw = s.getItem(CONFIRM_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.file !== 'string' || typeof o.head !== 'string') return null;
    if (!Number.isFinite(o.at)) return null;
    return { file: o.file, head: o.head, due: o.due || null, at: o.at };
  } catch { return null; }
}
export function clearDueConfirm() {
  try { const s = store(); if (s) s.removeItem(CONFIRM_KEY); } catch {}
}
export function dueFetchVerdict(rec, file, currentDue, now = Date.now()) {
  try {
    if (!rec || rec.file !== file) return 'apply';
    const n = Number.isFinite(now) ? now : Date.now();
    if (!Number.isFinite(rec.at) || (n - rec.at) < 0 || (n - rec.at) >= DUE_CONFIRM_WINDOW_MS) return 'apply';
    if ((currentDue || null) === (rec.due || null)) return 'confirmed';
    return 'skip';
  } catch { return 'apply'; }
}
