import './tab.css';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/**
 * Tab — single-select pill / underline / floating tab.
 * No DOM side effects; selection is expressed via aria-selected +
 * data-attributes for host event wiring.
 */
export function Tab({
  label = '',
  variant = 'pill',
  size = 'medium',
  selected = false,
  disabled = false,
  dot = false,
  icon = '',
} = {}) {
  const cls = [
    'spc-tab',
    `spc-tab--${variant}`,
    `spc-tab--${size}`,
    selected ? 'spc-tab--selected' : '',
    disabled ? 'spc-tab--disabled' : '',
  ].filter(Boolean).join(' ');
  const iconHtml = icon ? `<span class="spc-tab__icon" aria-hidden="true">${esc(icon)}</span>` : '';
  const dotHtml = dot ? '<span class="spc-tab__dot" aria-hidden="true"></span>' : '';
  return `<button type="button" class="${cls}" role="tab" aria-selected="${selected ? 'true' : 'false'}"${disabled ? ' disabled aria-disabled="true"' : ''} data-tab data-variant="${esc(variant)}">${iconHtml}<span class="spc-tab__label">${esc(label)}</span>${dotHtml}</button>`;
}
