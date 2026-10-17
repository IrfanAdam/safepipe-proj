// safepipe changelog — due publish progress toast (DOM) · [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-2]
// Two stacked slots in one card, both visible at once once the commit lands:
// commit slot: Publishing… → Published ✓
// deploy slot (hidden until commit lands): Updating everywhere… → Live ✓
// In-progress rows show a spinner; landed rows show a check. The toast stays
// visible for the whole cycle and dismisses only at live (or on failure,
// when the inline retry takes over), so it never vanishes mid-cycle.
// Deliberately NOT a modal: it never traps pointer or keyboard
// (pointer-events:none) and never blocks the page. Keyed per pick so a
// rapid re-pick never dismisses newer state.
const CARD_ID = 'ds-due-progress';
const COMMIT_LABELS = { publishing: 'Publishing…', committed: 'Published ✓' };
const DEPLOY_LABELS = { deploying: 'Updating everywhere…', live: 'Live ✓' };
// Spinner while the row is still working; check once it has landed.
const COMMIT_BUSY = { publishing: true, committed: false };
const DEPLOY_BUSY = { deploying: true, live: false };
// The toast's whole vocabulary — exported so tests can pin it: commit slot
// and deploy slot each morph within their own pair, never a single line.
export const DUE_PROGRESS_COMMIT_STEPS = ['publishing', 'committed'];
export const DUE_PROGRESS_DEPLOY_STEPS = ['deploying', 'live'];
// Back-compat union (ordered by lifecycle) for any legacy readers.
export const DUE_PROGRESS_STEPS = [...DUE_PROGRESS_COMMIT_STEPS, ...DUE_PROGRESS_DEPLOY_STEPS];

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

function paintRow(card, scope, step) {
  const labels = scope === 'commit' ? COMMIT_LABELS : DEPLOY_LABELS;
  const busy = scope === 'commit' ? COMMIT_BUSY : DEPLOY_BUSY;
  if (!labels[step]) return;
  try {
    const label = card.querySelector(`[data-prog-${scope}-label]`);
    if (label) label.textContent = labels[step];
  } catch {}
  try {
    const spin = card.querySelector(`[data-prog-${scope}-spin]`);
    if (spin) spin.hidden = !busy[step];
  } catch {}
  try {
    const tick = card.querySelector(`[data-prog-${scope}-tick]`);
    if (tick) tick.hidden = !!busy[step];
  } catch {}
}

function setDeployVisible(card, visible) {
  try {
    const row = card.querySelector('[data-prog-deploy-row]');
    if (row) row.hidden = !visible;
  } catch {}
}

function paintStep(card, step) {
  if (step === 'publishing' || step === 'committed') {
    paintRow(card, 'commit', step);
    if (step === 'committed') {
      // Commit landed while propagation is still awaited: reveal the second
      // slot so both read at once (Published ✓ + Updating everywhere…).
      setDeployVisible(card, true);
      paintRow(card, 'deploy', 'deploying');
    } else {
      setDeployVisible(card, false);
    }
    try { card.dataset.progStep = step; } catch {}
    return;
  }
  if (step === 'deploying') {
    // Idempotent re-assert (commit path already revealed it): never hides
    // the committed commit row, never collapses back to one line.
    setDeployVisible(card, true);
    paintRow(card, 'deploy', 'deploying');
    try { card.dataset.progStep = step; } catch {}
    return;
  }
  if (step === 'live') {
    // Dev-local shortcut can jump straight to live without a committed step:
    // land the commit row too so both read done together.
    paintRow(card, 'commit', 'committed');
    setDeployVisible(card, true);
    paintRow(card, 'deploy', 'live');
    try { card.dataset.progStep = step; } catch {}
  }
}

function buildRow(d, scope) {
  const row = d.createElement('div');
  row.className = 'ds-due-progress__row';
  row.setAttribute(`data-prog-${scope}-row`, '');
  const spin = d.createElement('span');
  spin.className = 'ds-due-spin';
  spin.setAttribute(`data-prog-${scope}-spin`, '');
  spin.setAttribute('aria-hidden', 'true');
  const tick = d.createElement('span');
  tick.className = 'ds-due-tick';
  tick.setAttribute(`data-prog-${scope}-tick`, '');
  tick.setAttribute('aria-hidden', 'true');
  tick.textContent = '✓';
  const label = d.createElement('span');
  label.className = 'ds-due-progress__label';
  label.setAttribute(`data-prog-${scope}-label`, '');
  row.appendChild(spin);
  row.appendChild(tick);
  row.appendChild(label);
  // Legacy single-slot selectors keep resolving (first match = commit row)
  // so any external reader of [data-prog-label] still sees commit state.
  if (scope === 'commit') {
    spin.setAttribute('data-prog-spin', '');
    tick.setAttribute('data-prog-tick', '');
    label.setAttribute('data-prog-label', '');
  }
  return row;
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
    card.appendChild(buildRow(d, 'commit'));
    const deployRow = buildRow(d, 'deploy');
    try { deployRow.hidden = true; } catch {}
    card.appendChild(deployRow);
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
    if (!COMMIT_LABELS[step] && !DEPLOY_LABELS[step]) return;
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
