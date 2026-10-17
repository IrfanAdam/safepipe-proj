// safepipe changelog — schedule entry + GitHub login gate · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#follow-up]
// Public Schedule button opens the gate; "Continue with GitHub" runs the
// OAuth popup flow (same-window redirect when popups are blocked). Pane CTAs
// render always but stay hidden by CSS until body.is-sched-auth — login and
// logout need no repaint.
import { getSchedUser, isSchedAuthed, setSchedUser, clearSchedUser, takePendingToken, setSchedToken, getSchedToken, clearSchedToken } from '../logic/schedule-auth.js';
const BODY_ON = 'is-sched-auth';
// Canonical live site — scheduling (OAuth + /api/due) only exists there.
// Update this if the production domain ever changes.
const PROD_SITE = 'https://safepipe-proj.vercel.app/changelog.html';
// Local authoring hosts: login is disabled here on purpose — the OAuth
// callback and /api/due are production serverless routes, so a local token
// could never commit. Show a redirect to the live site instead.
function isLocalHost() {
  try {
    const h = String(window.location.hostname || '').toLowerCase();
    if (!h || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0') return true;
    if (/\.local$|\.lan$|\.internal$/.test(h)) return true;
  } catch { return false; }
  return false;
}
let menuBound = false;
export function applyScheduleState() {
  const user = getSchedUser();
  try { document.body.classList.toggle(BODY_ON, !!user); } catch {}
  const entry = document.querySelector('[data-schedule-entry]');
  if (entry) {
    entry.classList.toggle('on', !!user);
    entry.textContent = user ? user.login : 'Schedule';
    entry.setAttribute('title', user ? `Signed in as ${user.login}` : 'Log in with GitHub to schedule');
    entry.setAttribute('aria-haspopup', user ? 'menu' : 'dialog');
  }
  closeUserMenu();
}
function closeUserMenu() {
  const menu = document.querySelector('[data-user-menu]');
  if (menu) menu.hidden = true;
  const entry = document.querySelector('[data-schedule-entry]');
  if (entry) entry.setAttribute('aria-expanded', 'false');
}
function toggleUserMenu() {
  const entry = document.querySelector('[data-schedule-entry]');
  let menu = document.querySelector('[data-user-menu]');
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'ds-user-menu';
    menu.setAttribute('data-user-menu', '');
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    menu.innerHTML = '<button role="menuitem" data-user-logout>Log out</button>';
    document.body.appendChild(menu);
    menu.querySelector('[data-user-logout]').addEventListener('click', () => {
      clearSchedUser();
      clearSchedToken();
      applyScheduleState();
    });
  }
  if (!menu.hidden) { closeUserMenu(); return; }
  try {
    const r = entry.getBoundingClientRect();
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  } catch {}
  menu.hidden = false;
  try { entry.setAttribute('aria-expanded', 'true'); } catch {}
  try { menu.querySelector('[data-user-logout]').focus(); } catch {}
}
function closeGate() {
  const gate = document.querySelector('[data-schedule-gate]');
  if (gate) gate.hidden = true;
}
async function completeWithToken(token) {
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error('user fetch failed');
    const u = await r.json();
    if (!u || !u.login) throw new Error('no login');
    setSchedUser({ login: u.login, provider: 'github' });
    setSchedToken(token); // persisted per-device: identity proof for /api/due commits
  } catch {
    // Token rejected (or offline) — stay logged out, gate stays available.
  }
  applyScheduleState();
}
function loginWithGitHub() {
  let popup = null;
  try {
    popup = window.open('/api/auth', 'safepipe-schedule-login', 'width=560,height=700');
  } catch {}
  if (!popup) {
    // Popup blocked — same-window flow; /api/callback returns us to changelog.
    try { window.location.href = '/api/auth'; } catch {}
  }
}
function openGate() {
  let gate = document.querySelector('[data-schedule-gate]');
  const local = isLocalHost();
  if (!gate) {
    gate = document.createElement('div');
    gate.className = 'ds-gate';
    gate.setAttribute('data-schedule-gate', '');
    gate.hidden = true;
    gate.innerHTML = [
      '<div class="ds-gate-card" role="dialog" aria-modal="true" aria-label="Log in with GitHub to schedule">',
      '<p class="ds-gate-eyebrow">Schedule</p>',
      // Local authoring build: no login here — scheduling is a production
      // action. The card swaps to a redirect to the live site.
      local
        ? `<h2>Scheduling lives on the live site</h2><p>Log in and pick dates on production — they commit to git and reach every device.</p><div class="ds-gate-actions"><a class="ds-gate-primary" data-gate-prod href="${PROD_SITE}">Open live site</a><button class="ds-gate-ghost" data-gate-cancel>Cancel</button></div>`
        : '<h2>Log in to schedule</h2>',
      local ? '' : '<p>Sign in with GitHub — this device remembers you.</p>',
      local ? '' : '<div class="ds-gate-actions"><button class="ds-gate-primary" data-gate-login>Continue with GitHub</button><button class="ds-gate-ghost" data-gate-cancel>Cancel</button></div>',
      '</div>',
    ].join('');
    document.body.appendChild(gate);
    gate.addEventListener('click', (e) => { if (e.target === gate) closeGate(); });
    gate.querySelector('[data-gate-cancel]').addEventListener('click', closeGate);
    if (!local) {
      gate.querySelector('[data-gate-login]').addEventListener('click', () => {
        closeGate();
        loginWithGitHub();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeGate();
    });
  }
  gate.hidden = false;
  try { gate.querySelector('[data-gate-login],[data-gate-prod]').focus(); } catch {}
}
export function openScheduleGate() {
  openGate();
}
export function initScheduleGate() {
  applyScheduleState();
  // Same-window OAuth return: complete the pending login, if any.
  try {
    const pending = takePendingToken();
    if (pending) completeWithToken(pending);
  } catch {}
  // Sticky session check (silent, one attempt): a badge without a token, or
  // a dead token, resolves to logged-out. A network failure leaves the
  // session untouched (offline is not logged-out). Never opens the gate —
  // the gate opens only on an explicit tap.
  // [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-1]
  (async () => {
    try {
      if (!getSchedUser()) return;
      let token = null;
      try { token = getSchedToken(); } catch {}
      if (!token) {
        try { clearSchedUser(); } catch {}
        try { applyScheduleState(); } catch {}
        return;
      }
      const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = c ? setTimeout(() => { try { c.abort(); } catch {} }, 10000) : null;
      let ok = false;
      try {
        const r = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
          ...(c ? { signal: c.signal } : {}),
        });
        ok = !!(r && r.ok);
      } catch { return; }
      finally { if (t) clearTimeout(t); }
      if (!ok) {
        try { clearSchedUser(); } catch {}
        try { clearSchedToken(); } catch {}
      }
      try { applyScheduleState(); } catch {}
    } catch {}
  })();
  // Popup OAuth return: token arrives by postMessage from /api/callback.
  try {
    window.addEventListener('message', (e) => {
      try {
        if (e.origin !== window.location.origin) return;
        let d = e.data;
        if (typeof d === 'string') d = JSON.parse(d);
        if (!d || d.type !== 'safepipe-oauth' || !d.token) return;
        completeWithToken(d.token);
      } catch {}
    });
  } catch {}
  const entry = document.querySelector('[data-schedule-entry]');
  if (entry && !entry.dataset.bound) {
    entry.dataset.bound = '1';
    entry.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSchedAuthed()) {
        toggleUserMenu();
      } else {
        openGate();
      }
    });
  }
  if (!menuBound) {
    menuBound = true;
    document.addEventListener('click', (e) => {
      const menu = document.querySelector('[data-user-menu]');
      if (!menu || menu.hidden) return;
      const entry = document.querySelector('[data-schedule-entry]');
      if (entry && entry.contains(e.target)) return;
      if (menu.contains(e.target)) return;
      closeUserMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeUserMenu();
    });
  }
}
