import './list-row.css';

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/* ListRow — one record stretched across list width. variant: row|collapsed|dense|record|tile (+ selected via prop). */
export function ListRow({
  title = '',
  meta = '',
  chips = [],
  icon = '',
  trailing = '›',
  variant = 'row',
  selected = false,
  disabled = false,
  loading = false,
  errorChip = '',
  status = '',
  expiry = '',
  href = '#',
} = {}) {
  const cls = ['spc-list-row', `spc-list-row--${variant}`, selected ? 'is-selected' : '', disabled ? 'is-disabled' : '', loading ? 'is-loading' : ''].filter(Boolean).join(' ');
  if (variant === 'collapsed') {
    return `<div class="${cls}"><a class="spc-list-row-title" href="${esc(href)}">${esc(title)}</a><span class="spc-list-row-count">${esc(meta)}</span></div>`;
  }
  if (variant === 'tile') {
    return `<div class="${cls}"${selected ? ' aria-current="true"' : ''}></div>`;
  }
  const inner = loading
    ? `<div class="spc-list-row-skeleton" aria-hidden="true"><span></span><span></span></div>`
    : `<span class="spc-list-row-icon" aria-hidden="true">${esc(icon || '•')}</span><span class="spc-list-row-main"><a class="spc-list-row-title" href="${esc(href)}">${esc(title)}</a>${meta ? `<span class="spc-list-row-meta">${esc(meta)}</span>` : ''}${chips.length ? `<span class="spc-list-row-chips">${chips.map((c) => `<span class="spc-list-row-chip">${esc(c)}</span>`).join('')}</span>` : ''}${status ? `<span class="spc-list-row-status">${esc(status)}</span>` : ''}${expiry ? `<span class="spc-list-row-expiry">${esc(expiry)}</span>` : ''}${errorChip ? `<span class="spc-list-row-errchip">${esc(errorChip)}</span>` : ''}</span><span class="spc-list-row-divider" aria-hidden="true"></span><span class="spc-list-row-trailing" aria-hidden="true">${esc(trailing)}</span>`;
  return `<div class="${cls}"${selected ? ' aria-current="true"' : ''}>${inner}</div>`;
}
