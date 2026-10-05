import './card.css';

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/* Card — one record surface. variant: background|inspection|stack|split-stat|report|dashboard|stat */
export function Card({
  title = '',
  subtitle = '',
  body = '',
  tags = [],
  progress = null,
  footer = '',
  action = '',
  variant = 'inspection',
  selected = false,
  disabled = false,
  loading = false,
  error = '',
  stats = [],
} = {}) {
  const cls = ['spc-card', `spc-card--${variant}`, selected ? 'is-selected' : '', disabled ? 'is-disabled' : '', loading ? 'is-loading' : ''].filter(Boolean).join(' ');
  if (variant === 'background') return `<div class="${cls}" aria-hidden="true"></div>`;
  if (variant === 'split-stat' || variant === 'stat') {
    const tiles = (stats.length ? stats : [{ value: '0', label: 'Stat' }])
      .map((s) => `<div class="spc-card-stat"><span class="spc-card-stat-value">${esc(s.value)}</span><span class="spc-card-stat-label">${esc(s.label)}</span></div>`)
      .join('');
    return `<div class="${cls}">${tiles}</div>`;
  }
  const tagRow = tags.length
    ? `<div class="spc-card-tags">${tags.map((t) => `<span class="spc-card-tag">${esc(t)}</span>`).join('')}</div>`
    : '';
  const bar = progress != null
    ? `<div class="spc-card-progress" role="progressbar" aria-valuenow="${Number(progress)}" aria-valuemin="0" aria-valuemax="100"><span class="spc-card-progress-fill" style="width:${Number(progress)}%"></span></div>`
    : '';
  const bodyHtml = loading
    ? `<div class="spc-card-skeleton" aria-hidden="true"><span></span><span></span></div>`
    : (body ? `<p class="spc-card-body">${esc(body)}</p>` : '');
  const err = error ? `<p class="spc-card-error" role="alert">${esc(error)}</p>` : '';
  const foot = footer ? `<div class="spc-card-footer"><span class="spc-card-attribution">${esc(footer)}</span>${action ? `<span class="spc-card-action" aria-hidden="true">${esc(action)}</span>` : ''}</div>` : '';
  const sub = subtitle ? `<p class="spc-card-subtitle">${esc(subtitle)}</p>` : '';
  const head = title ? `<h3 class="spc-card-title">${esc(title)}</h3>` : '';
  return `<article class="${cls}">${head}${sub}${tagRow}${bodyHtml}${bar}${err}${foot}</article>`;
}
