import './tag.css';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/**
 * Tag — compact classification chip. Static span by default; the
 * `toggle` variant renders a <button> with aria-pressed and
 * data-attributes for host event wiring. No other side effects.
 */
export function Tag({
  label = '',
  variant = 'neutral',
  tone = 'neutral',
  count = null,
  selected = false,
  disabled = false,
  pressed = false,
} = {}) {
  const cls = [
    'spc-tag',
    `spc-tag--${variant}`,
    `spc-tag--${tone}`,
    selected ? 'spc-tag--selected' : '',
    disabled ? 'spc-tag--disabled' : '',
  ].filter(Boolean).join(' ');
  const countHtml =
    count !== null && count !== undefined
      ? `<span class="spc-tag__count" aria-hidden="true">${esc(count)}</span>`
      : '';
  const inner = `${countHtml}<span class="spc-tag__label">${esc(label)}</span>`;
  if (variant === 'toggle') {
    return `<button type="button" class="${cls}" aria-pressed="${pressed ? 'true' : 'false'}"${disabled ? ' disabled aria-disabled="true"' : ''} data-tag data-variant="toggle">${inner}</button>`;
  }
  return `<span class="${cls}" data-tag data-variant="${esc(variant)}">${inner}</span>`;
}
