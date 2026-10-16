// safepipe logic — schedule gate state (pure, zero DOM) · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#follow-up]
// Real GitHub identity (via /api/auth + /api/callback): the signed-in user
// is remembered on this device; the OAuth token itself is never persisted.
const USER_KEY = 'safepipe-schedule-user';
const PENDING_KEY = 'safepipe-oauth-pending';
let memUser = null;
let memToken = null; // read:user OAuth token, memory-only: proves identity to
// /api/due (validated server-side against DUE_AUTHOR). Never persisted.
export function setSchedToken(token) {
  memToken = typeof token === 'string' && token ? token : null;
}
export function getSchedToken() {
  return memToken;
}
const localStore = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};
const sessionStore = () => {
  try { return globalThis.sessionStorage || null; } catch { return null; }
};
export function getSchedUser() {
  const s = localStore();
  try {
    if (s) {
      const raw = s.getItem(USER_KEY);
      if (raw) return JSON.parse(raw);
    }
  } catch {}
  return memUser;
}
export function isSchedAuthed() {
  return !!getSchedUser();
}
export function setSchedUser(user) {
  const s = localStore();
  try { if (s) s.setItem(USER_KEY, JSON.stringify(user)); } catch {}
  memUser = user;
}
export function clearSchedUser() {
  const s = localStore();
  try { if (s) s.removeItem(USER_KEY); } catch {}
  memUser = null;
}
// Same-window OAuth return: one-time pickup of the pending token.
export function takePendingToken() {
  const s = sessionStore();
  try {
    if (s) {
      const t = s.getItem(PENDING_KEY);
      if (t) { s.removeItem(PENDING_KEY); return t; }
    }
  } catch {}
  return null;
}
