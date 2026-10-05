import './sidebar.css';

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/* Sidebar — minimized icon-only nav rail. items: [{id, label, icon, disabled}]. */
export function Sidebar({ items = [], active = '', brand = 'SP', avatar = '', variant = 'rail', state = 'default' } = {}) {
  const list = items.length
    ? items
    : [
        { id: 'workforce', label: 'Workforce', icon: '◈' },
        { id: 'operations', label: 'Operations', icon: '⬢' },
        { id: 'assets', label: 'Assets', icon: '▣' },
        { id: 'settings', label: 'Settings', icon: '⚙' },
      ];
  const current = active || 'workforce';
  const lis = list
    .map((it) => {
      const isActive = it.id === current;
      const cls = ['spc-sidebar-item', isActive ? 'is-active' : '', it.disabled ? 'is-disabled' : ''].filter(Boolean).join(' ');
      const cur = isActive ? ' aria-current="page"' : '';
      const dis = it.disabled ? ' aria-disabled="true" tabindex="-1"' : '';
      return `<li><a class="${cls}" href="#${esc(it.id)}" title="${esc(it.label)}"${cur}${dis} aria-label="${esc(it.label)}"><span class="spc-sidebar-icon" aria-hidden="true">${esc(it.icon || '•')}</span></a></li>`;
    })
    .join('');
  return `<nav class="spc-sidebar spc-sidebar--${esc(variant)} is-${esc(state)}" aria-label="Primary"><div class="spc-sidebar-logo" aria-hidden="true">${esc(brand)}</div><div class="spc-sidebar-divider" aria-hidden="true"></div><button class="spc-sidebar-avatar" type="button" aria-label="Account: ${esc(avatar || 'Client')}">${esc((avatar || 'C').slice(0, 1))}</button><ul class="spc-sidebar-list">${lis}</ul></nav>`;
}
