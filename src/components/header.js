import './header.css';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/**
 * Header — app bar, section title block, or list toolbar.
 * Plain-props factory returning an HTML string; no DOM side effects.
 */
export function Header({
  variant = 'appbar',
  title = '',
  overline = '',
  meta = [],
  date = '',
  avatar = '',
  brand = '',
  searchPlaceholder = '',
  actions = [],
} = {}) {
  if (variant === 'section') {
    const metaHtml = meta.length
      ? `<p class="spc-header__meta">${meta.map((m) => `<span class="spc-header__meta-value">${esc(m.value)}</span> <span class="spc-header__meta-qual">${esc(m.qualifier)}</span>`).join(' · ')}</p>`
      : '';
    return `<header class="spc-header spc-header--section" data-header data-variant="section">${overline ? `<p class="spc-header__overline">${esc(overline)}</p>` : ''}<h2 class="spc-header__title">${esc(title)}</h2>${metaHtml}<hr class="spc-header__divider" />${date ? `<p class="spc-header__date">Last updated ${esc(date)}</p>` : ''}</header>`;
  }
  if (variant === 'toolbar') {
    const actionsHtml = actions
      .map((a) => `<button type="button" class="spc-header__iconbtn" aria-label="${esc(a.label || a.icon)}" data-header-action="${esc(a.label || '')}"><span aria-hidden="true">${esc(a.icon || '')}</span></button>`)
      .join('');
    return `<header class="spc-header spc-header--toolbar" data-header data-variant="toolbar"><div class="spc-header__search"><input type="search" class="spc-header__search-input" placeholder="${esc(searchPlaceholder || 'Search')}" aria-label="${esc(searchPlaceholder || 'Search')}" data-header-search /></div><div class="spc-header__cluster">${actionsHtml}</div></header>`;
  }
  const actionsHtml = actions
    .map((a) => `<button type="button" class="spc-header__iconbtn" aria-label="${esc(a.label || a.icon)}"${a.disabled ? ' disabled aria-disabled="true"' : ''} data-header-action="${esc(a.label || '')}"><span aria-hidden="true">${esc(a.icon || '')}</span></button>`)
    .join('');
  return `<header class="spc-header spc-header--appbar" role="banner" data-header data-variant="appbar"><span class="spc-header__brand">${esc(brand || title)}</span><div class="spc-header__cluster">${date ? `<span class="spc-header__date">${esc(date)}</span>` : ''}${actionsHtml}${avatar ? `<span class="spc-header__avatar" aria-hidden="true">${esc(avatar)}</span>` : ''}</div></header>`;
}
