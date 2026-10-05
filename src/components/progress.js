import './progress.css';

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/* Progress — 4px pill bar. variant: violet|sky|card|segmented|header. */
export function Progress({
  value = 0,
  max = 100,
  variant = 'violet',
  title = '',
  action = '',
  doneLabel = '',
  pendingLabel = '',
  knob = false,
  complete = false,
  disabled = false,
  error = false,
  segments = 3,
} = {}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (Number(value) / Number(max)) * 100)) : 0;
  const cls = ['spc-progress', `spc-progress--${variant}`, knob ? 'has-knob' : '', complete ? 'is-complete' : '', disabled ? 'is-disabled' : '', error ? 'is-error' : ''].filter(Boolean).join(' ');
  if (variant === 'segmented') {
    const segs = Array.from({ length: segments }, (_, i) => `<span class="spc-progress-seg spc-progress-seg--${i}"></span>`).join('');
    return `<div class="${cls}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(title || 'Progress')}"><div class="spc-progress-segs">${segs}</div></div>`;
  }
  if (variant === 'header') {
    return `<div class="${cls}"><span class="spc-progress-header-title">${esc(title)}</span><span class="spc-progress-header-pct">${esc(doneLabel || `${pct} % complete`)}</span>${pendingLabel ? `<span class="spc-progress-header-due">${esc(pendingLabel)}</span>` : ''}<div class="spc-progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(title || 'Progress')}"><span class="spc-progress-fill" style="width:${pct}%"></span>${knob ? '<span class="spc-progress-knob"></span>' : ''}</div></div>`;
  }
  const head = variant === 'card'
    ? `<div class="spc-progress-card-head"><span class="spc-progress-title">${esc(title)}</span>${action ? `<a class="spc-progress-action" href="#">${esc(action)}</a>` : ''}</div>`
    : '';
  const counts = variant === 'card'
    ? `<div class="spc-progress-counts"><span class="spc-progress-done">${esc(doneLabel)}</span><span class="spc-progress-pending">${esc(pendingLabel)}</span></div>`
    : `<span class="spc-progress-visually-hidden">${esc(doneLabel || `${pct}%`)}</span>`;
  return `<div class="${cls}">${head}<div class="spc-progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(title || 'Progress')}"><span class="spc-progress-fill" style="width:${pct}%"></span>${knob ? '<span class="spc-progress-knob"></span>' : ''}</div>${counts}</div>`;
}
