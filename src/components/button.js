import './button.css';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/**
 * Button — primary action trigger. Plain-props factory returning an
 * HTML string; no DOM side effects.
 */
export function Button({
  label = '',
  variant = 'primary',
  icon = '',
  iconOnly = false,
  disabled = false,
  loading = false,
} = {}) {
  const cls = [
    'spc-button',
    `spc-button--${variant}`,
    iconOnly ? 'spc-button--icon-only' : '',
    loading ? 'spc-button--loading' : '',
  ].filter(Boolean).join(' ');
  const iconHtml = icon ? `<span class="spc-button__icon" aria-hidden="true">${esc(icon)}</span>` : '';
  const labelHtml =
    loading
      ? `<span class="spc-button__spinner" aria-hidden="true"></span><span class="spc-button__label">${esc(label)}</span>`
      : iconOnly
        ? `<span class="spc-button__label spc-button__label--sr">${esc(label)}</span>${iconHtml}`
        : `${iconHtml}<span class="spc-button__label">${esc(label)}</span>`;
  const attrs = [
    `class="${cls}"`,
    `data-button`,
    `data-variant="${esc(variant)}"`,
    disabled || loading ? 'disabled aria-disabled="true"' : '',
    loading ? 'aria-busy="true"' : '',
    iconOnly ? `aria-label="${esc(label)}"` : '',
  ].filter(Boolean).join(' ');
  return `<button type="button" ${attrs}>${labelHtml}</button>`;
}
