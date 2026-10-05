export function renderHome(root, fx) {
  const wo = fx.workOrders[0];
  root.innerHTML = `
  <div class="sp-home">
    <div class="sp-phone">
      <div class="sp-home-tabs">${['Today', 'Queue', 'Alerts', 'More'].map((t, i) =>
        `<button class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="sp-client-card"><p class="sp-meta">Client</p><h2>${fx.client.name}</h2>
        <p class="sp-meta">${fx.client.location}</p></div>
      <div class="sp-wo-mini"><p class="sp-sys">${wo.system}</p><h3>${wo.title}</h3>
        <p class="sp-status">${wo.status} · Due in ${wo.dueInDays} days</p>
        <p><a href="#/operations">Open work order →</a></p></div>
      <div class="sp-home-tabs bottom">${['Home', 'Work', 'Assets', 'Profile'].map((t, i) =>
        `<button class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div>
    </div>
  </div>`;
}
