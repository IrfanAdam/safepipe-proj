import { pill, tabStrip } from './_shim.js';

export function renderOperations(root, fx) {
  const wo = fx.workOrders[0];
  const checked = new Set();
  root.innerHTML = `
  <div class="sp-ops">
    <div class="sp-ops-left">
      <div class="sp-mapbar"><input value="" placeholder="Search map / chainage…" aria-label="Search map" /><button>Go</button></div>
      <div class="sp-map" role="img" aria-label="Network map placeholder">Map — network canvas (Plan C twin)</div>
      <div class="sp-toolbar"><input placeholder="Filter work items…" aria-label="Filter work items" />
        <button title="List">☰</button><button title="Map">▦</button><button class="on" title="Detail">◧</button></div>
      <div class="sp-pane" id="ops-pane"><p class="sp-meta">Work items for ${wo.system} — select a tab.</p></div>
    </div>
    <aside class="sp-wo" aria-label="Work order detail">
      <div class="sp-wo-top"><span class="sp-sq"></span><span class="sp-wo-actions"><span class="sp-sq dark"></span><span class="sp-sq"></span></span></div>
      <p class="sp-client">${fx.client.name}</p>
      <div class="sp-assignee"><span class="sp-avatar"></span><span><strong>${wo.assignee.replace('Rangel', 'Rangles')}</strong><small>${wo.assignedAgo}</small></span><span class="sp-tick">✓</span></div>
      <p class="sp-sys">${wo.system} <span class="sp-due">Due in ${wo.dueInDays} days</span></p>
      <h2>${wo.title}</h2>
      <p class="sp-status">${wo.status} · ${wo.county}</p>
      <p class="sp-meta">${wo.lastInspected}</p>
      <div class="sp-equip"><p><strong id="eq-count">${wo.equipment.length} equipments needed</strong></p>
        ${wo.equipment.map((e, i) => `<label class="sp-eq"><input type="checkbox" data-eq="${i}" /> ${e}</label>`).join('')}
        <p>${pill('<span id="eq-pill">0 of ' + wo.equipment.length + ' ready</span>', '')}</p></div>
      <div class="sp-times"><div><p class="sp-meta">Start time</p><p>24th Sep 2021, 3:43 PM, PDT</p></div>
        <div><p class="sp-meta">End time</p><p>24th Sep 2021, 3:43 PM, PDT</p></div></div>
      ${tabStrip(['Overview', 'Tasks', 'Timeline', 'Notes', 'Files'], 0)}
      <div class="sp-pane" id="ops-tabpane">Overview — task checklist and progress live here.</div>
    </aside>
  </div>`;
  const panes = ['Overview — task checklist and progress live here.', 'Tasks — open line items for this WO.',
    'Timeline — assignments and inspection history.', 'Notes — crew notes.', 'Files — attachments and sheets.'];
  root.querySelectorAll('.sp-wo .sp-tabs button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.sp-wo .sp-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    root.querySelector('#ops-tabpane').textContent = panes[+b.dataset.tab];
  }));
  root.querySelectorAll('[data-eq]').forEach(cb => cb.addEventListener('change', () => {
    cb.checked ? checked.add(cb.dataset.eq) : checked.delete(cb.dataset.eq);
    root.querySelector('#eq-pill').textContent = `${checked.size} of ${wo.equipment.length} ready`;
  }));
}
