// safepipe changelog — schedule entry + login gate · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#follow-up]
// Public Schedule button in the header opens a personal-site-style gate
// (one click, remembered). Pane CTAs render always but stay hidden by CSS
// until body.is-sched-auth — so login/logout needs no repaint.
import { isSchedAuthed, schedLogIn, schedLogOut } from '../logic/schedule-auth.js';
const BODY_ON = 'is-sched-auth';
export function applyScheduleState() {
  const on = isSchedAuthed();
  try { document.body.classList.toggle(BODY_ON, on); } catch {}
  const entry = document.querySelector('[data-schedule-entry]');
  if (entry) {
    entry.classList.toggle('on', on);
    entry.textContent = on ? 'Schedule ✓' : 'Schedule';
    entry.setAttribute('title', on ? 'Logged in — click to log out' : 'Log in to schedule');
  }
}
function closeGate() {
  const gate = document.querySelector('[data-schedule-gate]');
  if (gate) gate.hidden = true;
}
function openGate() {
  let gate = document.querySelector('[data-schedule-gate]');
  if (!gate) {
    gate = document.createElement('div');
    gate.className = 'ds-gate';
    gate.setAttribute('data-schedule-gate', '');
    gate.hidden = true;
    gate.innerHTML = [
      '<div class="ds-gate-card" role="dialog" aria-modal="true" aria-label="Log in to schedule">',
      '<p class="ds-gate-eyebrow">Schedule</p>',
      '<h2>Log in to schedule</h2>',
      '<p>One click is all it takes — this device remembers you.</p>',
      '<div class="ds-gate-actions">',
      '<button class="ds-gate-primary" data-gate-login>Log in</button>',
      '<button class="ds-gate-ghost" data-gate-cancel>Cancel</button>',
      '</div></div>',
    ].join('');
    document.body.appendChild(gate);
    gate.addEventListener('click', (e) => { if (e.target === gate) closeGate(); });
    gate.querySelector('[data-gate-cancel]').addEventListener('click', closeGate);
    gate.querySelector('[data-gate-login]').addEventListener('click', () => {
      schedLogIn();
      closeGate();
      applyScheduleState();
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
  const entry = document.querySelector('[data-schedule-entry]');
  if (entry && !entry.dataset.bound) {
    entry.dataset.bound = '1';
    entry.addEventListener('click', () => {
      if (isSchedAuthed()) {
        schedLogOut();
        applyScheduleState();
      } else {
        openGate();
      }
    });
  }
}
