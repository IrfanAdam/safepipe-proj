import { pill, tabStrip } from './_shim.js';

const FILTERS = ['All', 'Patrol', 'Inspection', 'Repair', 'Construction', 'MOC'];

export function renderOperations(root, fx) {
  let sel = fx.workOrders[0]?.id;
  let filter = '';
  paint();
  function paint() {
    const wo = fx.workOrders.find((w) => w.id === sel) || fx.workOrders[0];
    const checked = new Set();
    const list = fx.workOrders.filter((w) =>
      (w.title + w.status + w.id).toLowerCase().includes(filter.toLowerCase()));
    root.innerHTML = `
  <div class="sp-ops">
    <div class="sp-ops-left">
      <div class="sp-mapbar"><input value="" placeholder="Search map / chainage…" aria-label="Search map" /><button>Go</button></div>
      <div class="sp-map" role="img" aria-label="Network map placeholder">Map — network canvas (Plan C twin)</div>
      <div class="sp-toolbar"><input id="ops-q" placeholder="Filter work items…" aria-label="Filter work items" value="${filter}" />
        <button title="List">☰</button><button title="Map">▦</button><button class="on" title="Detail">◧</button></div>
      <div class="sp-chips">${FILTERS.map((c, i) =>
        `<button class="sp-chip" aria-pressed="${i === 0}">${c}</button>`).join('')}</div>
      <div class="sp-pane" id="ops-pane">${list.map((w) => `
        <div class="sp-member${w.id === wo.id ? ' sel' : ''}" data-wo="${w.id}" role="button" tabindex="0">
          <span class="sp-member-main"><strong>${w.id} · ${w.title}</strong><small>${w.system}</small></span>
          <span class="sp-member-work">${w.status} · Due in ${w.dueInDays} days</span>
        </div>`).join('') || '<p class="sp-meta">No work items match.</p>'}</div>
    </div>
    <aside class="sp-wo" aria-label="Work order detail">
      <div class="sp-wo-top"><span class="sp-sq"></span><span class="sp-wo-actions"><span class="sp-sq dark"></span><span class="sp-sq"></span></span></div>
      <p class="sp-client">${fx.client.name}</p>
      <div class="sp-assignee"><span class="sp-avatar"></span><span><strong>${wo.assignee}</strong><small>${wo.assignedAgo}</small></span><span class="sp-tick">✓</span></div>
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
    root.querySelectorAll('.sp-wo .sp-tabs button').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('.sp-wo .sp-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      root.querySelector('#ops-tabpane').textContent = panes[+b.dataset.tab];
    }));
    root.querySelectorAll('[data-eq]').forEach((cb) => cb.addEventListener('change', () => {
      cb.checked ? checked.add(cb.dataset.eq) : checked.delete(cb.dataset.eq);
      root.querySelector('#eq-pill').textContent = `${checked.size} of ${wo.equipment.length} ready`;
    }));
    root.querySelectorAll('[data-wo]').forEach((el) => el.addEventListener('click', () => {
      sel = el.dataset.wo; paint();
    }));
    root.querySelector('#ops-q').addEventListener('input', (e) => {
      filter = e.target.value;
      const pos = e.target.selectionStart;
      paint();
      const q = root.querySelector('#ops-q');
      q.focus(); q.setSelectionRange(pos, pos);
    });
  }
}
