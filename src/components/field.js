import './field.css';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/**
 * Field — labeled text input. Plain-props factory returning an HTML
 * string; no DOM side effects. `variant` picks input / textarea /
 * date / readonly; `error` adds the message + aria wiring.
 */
export function Field({
  label = '',
  id = '',
  value = '',
  placeholder = '',
  size = 'small',
  variant = 'input',
  error = '',
  disabled = false,
  trailingIcon = '',
} = {}) {
  const fieldId = id || `spc-field-${esc(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'input'}`;
  const errId = `${fieldId}-error`;
  const hasError = Boolean(error);
  const cls = [
    'spc-field',
    `spc-field--${size}`,
    `spc-field--${variant}`,
    hasError ? 'spc-field--error' : '',
    disabled ? 'spc-field--disabled' : '',
  ].filter(Boolean).join(' ');
  const labelHtml = `<label class="spc-field__label" for="${esc(fieldId)}">${esc(label)}</label>`;
  const trailHtml = trailingIcon
    ? `<span class="spc-field__trail" aria-hidden="true">${esc(trailingIcon)}</span>`
    : '';
  const shared = `id="${esc(fieldId)}" class="spc-field__control" data-field data-variant="${esc(variant)}" placeholder="${esc(placeholder)}"${disabled ? ' disabled aria-disabled="true"' : ''}${hasError ? ` aria-invalid="true" aria-describedby="${esc(errId)}"` : ''}`;
  let controlHtml;
  if (variant === 'readonly') {
    controlHtml = `<p id="${esc(fieldId)}" class="spc-field__control spc-field__control--readonly" data-field data-variant="readonly">${esc(value)}</p>`;
  } else if (variant === 'textarea') {
    controlHtml = `<textarea ${shared}>${esc(value)}</textarea>${trailHtml}`;
  } else if (variant === 'date') {
    controlHtml = `<input type="date" value="${esc(value)}" ${shared} />${trailHtml}`;
  } else {
    controlHtml = `<div class="spc-field__box"><input type="text" value="${esc(value)}" ${shared} />${trailHtml}</div>`;
  }
  const errorHtml = hasError
    ? `<p class="spc-field__error" id="${esc(errId)}" role="alert">${esc(error)}</p>`
    : '';
  return `<div class="${cls}">${labelHtml}${controlHtml}${errorHtml}</div>`;
}
