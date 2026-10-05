import './modal.css';

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/* Modal — blocking dialog. size: medium|large|compact|wide. open=false renders hidden scrim. */
export function Modal({
  title = '',
  subtitle = '',
  body = '',
  size = 'medium',
  open = true,
  loading = false,
  error = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  id = 'spc-modal',
} = {}) {
  const cls = ['spc-modal-scrim', open ? 'is-open' : 'is-closed'].join(' ');
  const err = error ? `<p class="spc-modal-error" role="alert">${esc(error)}</p>` : '';
  const content = loading
    ? `<div class="spc-modal-dimmed"><p class="spc-modal-loading">Loading…</p></div>`
    : (body ? `<div class="spc-modal-content-body">${body}</div>` : '');
  return `<div class="${cls}" data-modal-scrim="${esc(id)}"><div class="spc-modal spc-modal--${esc(size)}" role="dialog" aria-modal="true" aria-labelledby="${esc(id)}-title" aria-describedby="${esc(id)}-desc" id="${esc(id)}"><div class="spc-modal-head"><div><h2 class="spc-modal-title" id="${esc(id)}-title">${esc(title)}</h2>${subtitle ? `<p class="spc-modal-subtitle" id="${esc(id)}-desc">${esc(subtitle)}</p>` : ''}</div><button class="spc-modal-close" type="button" data-modal-close="${esc(id)}" aria-label="Close dialog">✕</button></div><div class="spc-modal-content">${content}</div>${err}<div class="spc-modal-divider" aria-hidden="true"></div><div class="spc-modal-footer"><button class="spc-modal-btn spc-modal-btn--secondary" type="button" data-modal-close="${esc(id)}">${esc(cancelLabel)}</button><button class="spc-modal-btn spc-modal-btn--primary" type="button"${loading ? ' disabled aria-disabled="true"' : ''}>${esc(confirmLabel)}</button></div></div></div>`;
}
