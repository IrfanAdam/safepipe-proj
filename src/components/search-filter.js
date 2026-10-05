import './search-filter.css';

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/* SearchFilter — query field + toggleable filter pills. filters: [{label, selected}]. */
export function SearchFilter({
  placeholder = 'Search…',
  value = '',
  label = 'Search',
  filters = [],
  error = '',
  disabled = false,
  quiet = false,
  id = 'spc-search',
} = {}) {
  const pills = filters
    .map(
      (f, i) =>
        `<button class="spc-search-filter-pill${f.selected ? ' is-selected' : ''}" type="button" aria-pressed="${f.selected ? 'true' : 'false'}" data-filter-index="${i}">${f.selected ? '<span class="spc-search-filter-dot" aria-hidden="true"></span>' : ''}${esc(f.label)}</button>`
    )
    .join('');
  const err = error ? `<p class="spc-search-filter-error" role="alert">${esc(error)}</p>` : '';
  return `<div class="spc-search-filter${quiet ? ' is-quiet' : ''}${disabled ? ' is-disabled' : ''}"><div class="spc-search-filter-field" role="search"><label class="spc-search-filter-label" for="${esc(id)}">${esc(label)}</label><span class="spc-search-filter-icon" aria-hidden="true">⌕</span><input class="spc-search-filter-input" type="search" id="${esc(id)}" placeholder="${esc(placeholder)}" value="${esc(value)}"${disabled ? ' disabled aria-disabled="true"' : ''} /></div>${pills ? `<div class="spc-search-filter-row" role="group" aria-label="Filters">${pills}</div>` : ''}${err}</div>`;
}
