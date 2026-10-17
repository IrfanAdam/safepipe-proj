// safepipe changelog — due publish progress toast (DOM) · [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-2]
// One compact line that morphs through the FULL update lifecycle:
// Publishing… → Published on git → Updating everywhere… → Live ✓.
// In-progress states (publishing, deploying) show a spinner; rest states
// (committed, live) show a check. One slot, never a checklist — the toast
// stays visible for the whole cycle and dismisses only at live (or on
// failure, when the inline retry takes over), so it never vanishes
// mid-cycle. Deliberately NOT a modal: it never traps pointer or keyboard
// (pointer-events:none) and never blocks the page. Keyed per pick so a
// rapid re-pick never dismisses newer state.
const CARD_ID = 'ds-due-progress';
const STEP_LABELS = { publishing: 'Publishing…', committed: 'Published on git', deploying: 'Updating everywhere…', live: 'Live ✓' };
// Spinner while the step is still working; check once it has landed.
const STEP_BUSY = { publishing: true, committed: false, deploying: true, live: false };

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

function paintStep(card, step) {
  if (!STEP_LABELS[step]) return;
  try {
    const label = card.querySelector('[data-prog-label]');
    if (label) label.textContent = STEP_LABELS[step];
  } catch {}
  try {
    const spin = card.querySelector('[data-prog-spin]');
    if (spin) spin.hidden = !STEP_BUSY[step];
  } catch {}
  try {
    const tick = card.querySelector('[data-prog-tick]');
    if (tick) tick.hidden = !!STEP_BUSY[step];
  } catch {}
  try { card.dataset.progStep = step; } catch {}
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
    const spin = d.createElement('span');
    spin.className = 'ds-due-spin';
    spin.setAttribute('data-prog-spin', '');
    spin.setAttribute('aria-hidden', 'true');
    const tick = d.createElement('span');
    tick.className = 'ds-due-tick';
    tick.setAttribute('data-prog-tick', '');
    tick.setAttribute('aria-hidden', 'true');
    tick.textContent = '✓';
    const label = d.createElement('span');
    label.className = 'ds-due-progress__label';
    label.setAttribute('data-prog-label', '');
    card.appendChild(spin);
    card.appendChild(tick);
    card.appendChild(label);
    try { d.body.appendChild(card); } catch { return null; }
  }
  try {
    card.dataset.progKey = pickKey(detail);
    card.hidden = false;
    paintStep(card, 'publishing');
  } catch {}
  return card;
}

export function setDueProgressStep(detail, step) {
  try {
    const card = cardEl();
    if (!card || card.hidden) return;
    if (card.dataset.progKey !== pickKey(detail)) return;
    if (!STEP_LABELS[step]) return;
    paintStep(card, step);
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
