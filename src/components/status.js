import './status.css';
import { Tag } from './tag.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/**
 * Status — dot + label indicator, or a composite card grouping
 * compliance tags. Dot is aria-hidden; the label carries meaning.
 * No DOM side effects.
 */
export function Status({
  label = '',
  qualifier = '',
  tone = 'neutral',
  variant = 'dot',
  active = null,
  pending = false,
  disabled = false,
  tags = [],
  action = '',
} = {}) {
  const dotCls = [
    'spc-status__dot',
    `spc-status__dot--${tone}`,
    pending ? 'spc-status__dot--pending' : '',
  ].filter(Boolean).join(' ');
  const dotHtml = `<span class="${dotCls}" aria-hidden="true"></span>`;
  const labelHtml = `<span class="spc-status__label">${esc(label)}</span>`;
  const qualHtml = qualifier ? `<span class="spc-status__qualifier">${esc(qualifier)}</span>` : '';

  if (variant === 'toggle') {
    const on = active === true || (active === null && tone !== 'neutral');
    return `<span class="spc-status spc-status--toggle${disabled ? ' spc-status--disabled' : ''}" data-status data-variant="toggle">${dotHtml}<span class="spc-status__label">${esc(on ? 'Active' : 'Inactive')}</span></span>`;
  }
  if (variant === 'card' || variant === 'card-vertical') {
    const tagsHtml = tags.map((t) => Tag(typeof t === 'string' ? { label: t } : t)).join('');
    const actionHtml = action
      ? `<span class="spc-status__action" aria-hidden="true">${esc(action)}</span>`
      : '';
    return `<div class="spc-status spc-status--${variant}${disabled ? ' spc-status--disabled' : ''}" role="status" data-status data-variant="${esc(variant)}" data-tone="${esc(tone)}">${dotHtml}<span class="spc-status__body">${labelHtml}${qualHtml}<span class="spc-status__tags">${tagsHtml}</span></span>${actionHtml}</div>`;
  }
  return `<span class="spc-status spc-status--dot${disabled ? ' spc-status--disabled' : ''}" role="status" data-status data-variant="dot" data-tone="${esc(tone)}">${dotHtml}${labelHtml}${qualHtml}</span>`;
}
