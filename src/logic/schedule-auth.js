// safepipe logic — schedule gate state (pure, zero DOM) · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#follow-up]
// Personal-site-style auth: one click, remembered on this device only.
const KEY = 'safepipe-schedule-auth';
let mem = false;
const store = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};
export function isSchedAuthed() {
  const s = store();
  try { if (s) return s.getItem(KEY) === 'on'; } catch {}
  return mem;
}
export function schedLogIn() {
  const s = store();
  try { if (s) s.setItem(KEY, 'on'); } catch {}
  mem = true;
}
export function schedLogOut() {
  const s = store();
  try { if (s) s.removeItem(KEY); } catch {}
  mem = false;
}
