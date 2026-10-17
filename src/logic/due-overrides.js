// safepipe logic — due-date overrides (pure, zero DOM) · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]
// Same-device persistence for deadline picks. The dev/preview server writes
// the plan file directly (/__ds/due); a static host (production) answers 404,
// so without this the pick evaporates on reload. Overrides are keyed by plan
// file + section head and re-applied to the live bodies at boot. The FILE is
// source of truth whenever it already carries a Due: a stored date is applied
// only to a section with no Due (a stored *clear* always strips) — except a
// SERVER-CONFIRMED pick (committed to git via /api/due), which outranks the
// bundle during the deploy window so a refresh never flashes the stale date.
// Confirmed picks expire in a day, by which point the redeploy carries them.
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
const isFreshCommitted = (o, now) =>
  validShape(o) && o.committed === true && Number.isFinite(o.at) && (now - o.at) >= 0 && (now - o.at) < DAY_MS;
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
