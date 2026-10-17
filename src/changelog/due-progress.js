// safepipe changelog — due publish progress card (DOM) · [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-2]
// A small floating card that narrates the background commit:
// publishing → published → live ✓. Deliberately NOT a modal: it never
// traps pointer or keyboard (pointer-events:none), never blocks the page,
// and auto-dismisses. Failures hide it — the inline retry in the due row
// takes over. Keyed per pick so a rapid re-pick never dismisses newer state.
const CARD_ID = 'ds-due-progress';
const STEP_LABELS = { publishing: 'Publishing…', committed: 'Published on git', live: 'Live on this device ✓' };
const STEP_ORDER = ['publishing', 'committed', 'live'];

const doc = () => (typeof document !== 'undefined' ? document : null);

function cardEl() {
  const d = doc();
  return d ? d.getElementById(CARD_ID) : null;
}

function pickKey(detail) {
  const f = detail && detail.file ? String(detail.file) : '';
  const h = detail && detail.head ? String(detail.head) : '';
  const u = detail && detail.due != null ? String(detail.due) : 'none';
  return `${f}::${h}::${u}`;
}

function paintSteps(card, onStep) {
  const order = STEP_ORDER.indexOf(onStep);
  const lis = card.querySelectorAll('[data-prog-step]');
  lis.forEach((li) => {
    const i = STEP_ORDER.indexOf(li.getAttribute('data-prog-step'));
    try { li.classList.toggle('is-on', i <= order); } catch {}
  });
}

export function showDueProgress(detail) {
  const d = doc();
  if (!d || !d.body) return null;
  let card = cardEl();
  if (!card) {
    card = d.createElement('div');
    card.id = CARD_ID;
    card.className = 'ds-due-progress';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    const ul = d.createElement('ul');
    ul.className = 'ds-due-progress__steps';
    STEP_ORDER.forEach((s) => {
      const li = d.createElement('li');
      li.setAttribute('data-prog-step', s);
      li.textContent = STEP_LABELS[s];
      ul.appendChild(li);
    });
    card.appendChild(ul);
    try { d.body.appendChild(card); } catch { return null; }
  }
  try {
    card.dataset.progKey = pickKey(detail);
    card.hidden = false;
    paintSteps(card, 'publishing');
  } catch {}
  return card;
}

export function setDueProgressStep(detail, step) {
  try {
    const card = cardEl();
    if (!card || card.hidden) return;
    if (card.dataset.progKey !== pickKey(detail)) return;
    if (!STEP_LABELS[step]) return;
    paintSteps(card, step);
  } catch {}
}

export function hideDueProgress(detail, afterMs) {
  const key = pickKey(detail);
  const wait = Math.max(0, Number(afterMs) || 0);
  const hide = () => {
    try {
      const card = cardEl();
      if (!card) return;
      if (card.dataset.progKey !== key) return;
      card.hidden = true;
    } catch {}
  };
  if (!wait) { hide(); return; }
  try { setTimeout(hide, wait); } catch { hide(); }
}
