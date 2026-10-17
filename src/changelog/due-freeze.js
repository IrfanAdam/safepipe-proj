// safepipe changelog — due commit freeze overlay · [plan:2026-10-15_120000-safepipe-changelog-timeline.md#follow-up]
// Full-screen blocking overlay + spinner shown while a deadline pick is being
// committed and redeploy-confirmed. Imperative module (schedule-gate idiom):
// the overlay node is created from JS — no changelog.html mount needed.
// Always releasable: hideDueFreeze() is idempotent and safe to call twice.
const STEPS = ['committed', 'deploying', 'live'];
const STEP_LABEL = {
  committed: 'Committed to git',
  deploying: 'Deploying',
  live: 'Live',
};
let el = null;
let stepEls = {};
let noteEl = null;
let liveEl = null;
let detailEl = null;
let staleTimer = 0;
let prevOverflow = '';

function ensure() {
  if (el && el.isConnected) return el;
  el = document.createElement('div');
  el.className = 'ds-freeze';
  el.setAttribute('data-due-freeze', '');
  el.hidden = true;
  el.innerHTML = [
    '<div class="ds-freeze-card" role="status">',
    '<div class="ds-freeze-spinner" aria-hidden="true"></div>',
    '<p class="ds-freeze-eyebrow">Saving due date</p>',
    '<p class="ds-freeze-detail" data-freeze-detail></p>',
    '<ol class="ds-freeze-steps">',
    '<li data-freeze-step="committed">Committed to git</li>',
    '<li data-freeze-step="deploying">Deploying</li>',
    '<li data-freeze-step="live">Live</li>',
    '</ol>',
    '<p class="ds-freeze-note" data-freeze-note hidden></p>',
    '<p class="ds-freeze-live" data-freeze-live aria-live="polite"></p>',
    '</div>',
  ].join('');
  try {
    (document.body || document.documentElement).appendChild(el);
  } catch {}
  stepEls = {};
  try {
    el.querySelectorAll('[data-freeze-step]').forEach((li) => {
      stepEls[li.getAttribute('data-freeze-step')] = li;
    });
  } catch {}
  noteEl = el.querySelector('[data-freeze-note]');
  liveEl = el.querySelector('[data-freeze-live]');
  detailEl = el.querySelector('[data-freeze-detail]');
  return el;
}

function paint(step) {
  try {
    Object.keys(stepEls).forEach((k) => {
      const on = k === step || (step === 'stale' && k === 'deploying');
      stepEls[k].classList.toggle('is-on', on);
      if (on) stepEls[k].setAttribute('aria-current', 'step');
      else stepEls[k].removeAttribute('aria-current');
    });
  } catch {}
  try {
    if (!liveEl) return;
    if (step === 'stale') liveEl.textContent = 'Still deploying — released, date is safe on git.';
    else if (STEP_LABEL[step]) liveEl.textContent = `${STEP_LABEL[step]}.`;
    else liveEl.textContent = '';
  } catch {}
}

function clearStaleTimer() {
  try {
    if (staleTimer) window.clearTimeout(staleTimer);
  } catch {}
  staleTimer = 0;
}

export function showDueFreeze(root, meta) {
  void root;
  const node = ensure();
  clearStaleTimer();
  const m = meta || {};
  try {
    if (noteEl) {
      noteEl.hidden = true;
      noteEl.textContent = '';
    }
    if (detailEl) {
      const bits = [m.file, m.head, m.due].filter(Boolean);
      detailEl.textContent = bits.join(' · ');
      detailEl.hidden = bits.length === 0;
    }
    try {
      prevOverflow = document.body ? document.body.style.overflow : '';
      if (document.body) document.body.style.overflow = 'hidden';
    } catch {}
    node.hidden = false;
    node.classList.add('is-open');
  } catch {}
  paint('committed');
  return node;
}

export function setDueFreezeStep(step) {
  const node = ensure();
  if (!step) return node;
  if (step === 'stale') {
    clearStaleTimer();
    paint('stale');
    try {
      if (noteEl) {
        noteEl.textContent = 'Still deploying — released, date is safe on git.';
        noteEl.hidden = false;
      }
    } catch {}
    try {
      staleTimer = window.setTimeout(() => {
        hideDueFreeze();
      }, 5000);
    } catch {}
    return node;
  }
  if (!STEPS.includes(step)) return node;
  clearStaleTimer();
  try {
    if (noteEl) {
      noteEl.hidden = true;
      noteEl.textContent = '';
    }
  } catch {}
  paint(step);
  return node;
}

export function hideDueFreeze() {
  clearStaleTimer();
  try {
    if (!el) return;
    el.classList.remove('is-open');
    el.hidden = true;
    if (document.body && 'overflow' in document.body.style) {
      try { document.body.style.overflow = prevOverflow || ''; } catch {}
    }
  } catch {}
}
