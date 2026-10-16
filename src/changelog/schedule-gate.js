// safepipe changelog — schedule entry + GitHub login gate · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#follow-up]
// Public Schedule button opens the gate; "Continue with GitHub" runs the
// OAuth popup flow (same-window redirect when popups are blocked). Pane CTAs
// render always but stay hidden by CSS until body.is-sched-auth — login and
// logout need no repaint.
import { getSchedUser, isSchedAuthed, setSchedUser, clearSchedUser, takePendingToken } from '../logic/schedule-auth.js';
const BODY_ON = 'is-sched-auth';
export function applyScheduleState() {
  const user = getSchedUser();
  try { document.body.classList.toggle(BODY_ON, !!user); } catch {}
  const entry = document.querySelector('[data-schedule-entry]');
  if (entry) {
    entry.classList.toggle('on', !!user);
    entry.textContent = user ? 'Schedule ✓' : 'Schedule';
    entry.setAttribute('title', user ? `Signed in as ${user.login} — click to log out` : 'Log in with GitHub to schedule');
  }
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
  if (!gate) {
    gate = document.createElement('div');
    gate.className = 'ds-gate';
    gate.setAttribute('data-schedule-gate', '');
    gate.hidden = true;
    gate.innerHTML = [
      '<div class="ds-gate-card" role="dialog" aria-modal="true" aria-label="Log in with GitHub to schedule">',
      '<p class="ds-gate-eyebrow">Schedule</p>',
      '<h2>Log in to schedule</h2>',
      '<p>Sign in with GitHub — this device remembers you.</p>',
      '<div class="ds-gate-actions">',
      '<button class="ds-gate-primary" data-gate-login>Continue with GitHub</button>',
      '<button class="ds-gate-ghost" data-gate-cancel>Cancel</button>',
      '</div></div>',
    ].join('');
    document.body.appendChild(gate);
    gate.addEventListener('click', (e) => { if (e.target === gate) closeGate(); });
    gate.querySelector('[data-gate-cancel]').addEventListener('click', closeGate);
    gate.querySelector('[data-gate-login]').addEventListener('click', () => {
      closeGate();
      loginWithGitHub();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeGate();
    });
  }
  gate.hidden = false;
  try { gate.querySelector('[data-gate-login]').focus(); } catch {}
}
export function initScheduleGate() {
  applyScheduleState();
  // Same-window OAuth return: complete the pending login, if any.
  try {
    const pending = takePendingToken();
    if (pending) completeWithToken(pending);
  } catch {}
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
    entry.addEventListener('click', () => {
      if (isSchedAuthed()) {
        clearSchedUser();
        applyScheduleState();
      } else {
        openGate();
      }
    });
  }
}
