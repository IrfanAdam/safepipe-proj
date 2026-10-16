// safepipe logic — due-date overrides (pure, zero DOM) · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#follow-up]
// Same-device persistence for deadline picks. The dev/preview server writes
// the plan file directly (/__ds/due); a static host (production) answers 404,
// so without this the pick evaporates on reload. Overrides are keyed by plan
// file + section head and re-applied to the live bodies at boot. The FILE is
// source of truth whenever it already carries a Due: a stored date is applied
// only to a section with no Due (a stored *clear* always strips) — except a
// SERVER-CONFIRMED pick (committed to git via /api/due), which outranks the
// bundle during the deploy window so a refresh never flashes the stale date.
// Confirmed picks expire in a day, by which point the redeploy carries them.
const KEY = 'safepipe-due-overrides';
const store = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};
export function loadDueOverrides() {
  const s = store();
  try {
    const raw = s && s.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((o) => o && typeof o.file === 'string' && typeof o.head === 'string') : [];
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
