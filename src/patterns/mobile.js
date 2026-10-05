/* Mobile-UI Fig variants (375px phone frame): Home Queue list, Home Alerts
 * list, and the 375x390 modal. Compact variants of home.js; fixture lists
 * come from fx.mobile in src/data/records-fixtures.json (parent wires fx). */

function phoneFrame(inner) {
  return `<div class="sp-phone" style="width:375px">${inner}</div>`;
}

function homeTabs(active) {
  return `<div class="sp-home-tabs">${['Today', 'Queue', 'Alerts', 'More'].map(t =>
    `<button class="${t === active ? 'on' : ''}">${t}</button>`).join('')}</div>`;
}

function bottomNav() {
  return `<div class="sp-home-tabs bottom">${['Home', 'Work', 'Assets', 'Profile'].map((t, i) =>
    `<button class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div>`;
}

export function renderHomeQueue(root, fx) {
  const queue = ((fx && fx.mobile && fx.mobile.queue) || []).length
    ? fx.mobile.queue
    : (fx.workOrders || []).map(w => ({ system: w.system, title: w.title, meta: `${w.status} · ${w.county || ''}` }));
  root.innerHTML = `
  <div class="sp-home sp-home-queue">
    ${phoneFrame(`
      ${homeTabs('Queue')}
      <div class="sp-queue-list">${queue.map(q => `
        <div class="sp-wo-mini"><p class="sp-sys">${q.system}</p><h3>${q.title}</h3>
          <p class="sp-status">${q.meta}</p></div>`).join('')}</div>
      ${bottomNav()}`)}
  </div>`;
}

export function renderHomeAlerts(root, fx) {
  const alerts = (fx && fx.mobile && fx.mobile.alerts) || [];
  root.innerHTML = `
  <div class="sp-home sp-home-alerts">
    ${phoneFrame(`
      ${homeTabs('Alerts')}
      <div class="sp-alerts-list">${alerts.map(a => `
        <div class="sp-alert"><h3>${a.title}</h3><p class="sp-meta">${a.detail}</p></div>`).join('')}</div>
      ${bottomNav()}`)}
  </div>`;
}

export function renderHomeModal(root, fx) {
  const wo = (fx.workOrders || [])[0] || { system: '', title: 'Work order', status: '' };
  root.innerHTML = `
  <div class="sp-home sp-home-modal">
    ${phoneFrame(`
      ${homeTabs('Today')}
      <div class="sp-modal" style="min-height:390px" role="dialog" aria-modal="true">
        <p class="sp-sys">${wo.system}</p><h3>${wo.title}</h3>
        <p class="sp-status">${wo.status}</p>
        <p><button>Start</button> <button>Snooze</button></p>
      </div>
      ${bottomNav()}`)}
  </div>`;
}
