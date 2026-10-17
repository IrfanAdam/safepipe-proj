// safepipe logic — schedule gate state (pure, zero DOM) · [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-1]
// Real GitHub identity (via /api/auth + /api/callback): the signed-in user
// is remembered on this device, and so is the OAuth token — one login per
// device (owner-approved; single-owner site, token scoped read:user
// public_repo, revocable under GitHub Settings → Applications). The token
// travels only in POST bodies to same-origin /api/due — never in a URL.
const USER_KEY = 'safepipe-schedule-user';
const TOKEN_KEY = 'safepipe-schedule-token';
const PENDING_KEY = 'safepipe-oauth-pending';
let memUser = null;
let memToken = null; // OAuth token: proves identity to /api/due
// (validated server-side against the repo owner; commits as the author).
export function setSchedToken(token) {
  memToken = typeof token === 'string' && token ? token : null;
  const s = localStore();
  try {
    if (s) {
      if (memToken) s.setItem(TOKEN_KEY, memToken);
      else s.removeItem(TOKEN_KEY);
    }
  } catch {}
}
export function getSchedToken() {
  if (memToken) return memToken;
  const s = localStore();
  try {
    if (s) {
      const t = s.getItem(TOKEN_KEY);
      if (t) { memToken = t; return t; }
    }
  } catch {}
  return null;
}
export function clearSchedToken() {
  memToken = null;
  try { const s = localStore(); if (s) s.removeItem(TOKEN_KEY); } catch {}
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
