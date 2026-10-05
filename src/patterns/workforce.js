import { memberRow, tabStrip } from './_shim.js';

export function renderWorkforce(root, fx) {
  const total = fx.staffTotal;
  let active = fx.staff[0];
  root.innerHTML = `
  <div class="sp-wf">
    <div class="sp-wf-list">
      <h2>All the Workforce</h2><p class="sp-meta">Seeing all ${total} staff</p>
      <div class="sp-cards4">${['Crew', 'OQ valid', 'On shift', 'Attention'].map(c => `<div class="sp-cat">${c}</div>`).join('')}</div>
      <div class="sp-searchrow"><input id="wf-q" placeholder="Search the members" aria-label="Search the members" />
        <button title="Filter">⧩</button><button title="Sort">⇅</button><button title="View">▦</button></div>
      <div class="sp-chips">${['All', 'Repair', 'Survey', 'Inspection', 'Patrol'].map((c, i) =>
        `<button class="sp-chip" aria-pressed="${i === 0}">${c}</button>`).join('')}</div>
      <div class="sp-members" id="wf-members"></div>
    </div>
    <aside class="sp-profile" aria-label="Staff profile"><div id="wf-profile"></div>
      ${tabStrip(['History', 'Work orders', 'Certs', 'Notes'], 0)}
      <div class="sp-pane" id="wf-tabpane">History — assignments and evaluations.</div></aside>
  </div>`;
  const membersEl = root.querySelector('#wf-members');
  const profileEl = root.querySelector('#wf-profile');
  const q = root.querySelector('#wf-q');
  function drawList(filter = '') {
    const list = fx.staff.filter(m => (m.name + m.role).toLowerCase().includes(filter.toLowerCase()));
    membersEl.innerHTML = list.map(memberRow).join('') || '<p class="sp-meta">No members match.</p>';
    membersEl.querySelectorAll('.sp-member').forEach(el => el.addEventListener('click', () => {
      active = fx.staff.find(m => m.name === el.dataset.member);
      membersEl.querySelectorAll('.sp-member').forEach(x => x.classList.toggle('sel', x === el));
      drawProfile();
    }));
    membersEl.querySelector(`[data-member="${active.name}"]`)?.classList.add('sel');
  }
  function drawProfile() {
    profileEl.innerHTML = `<div class="sp-prof-top"><span class="sp-sq"></span><span class="sp-sq"></span></div>
      <div class="sp-prof-id"><span class="sp-avatar big"></span>
      <h2>${active.name}</h2><p class="sp-meta">${active.certs} Certificates · ${active.location}</p>
      <p><span class="sp-pill">OQ valid</span> <span class="sp-pill">Available</span></p>
      <p class="sp-meta">${active.exp} · ${active.role}</p>
      <p class="sp-member-work">In progress ${active.workload.wos} WOs, ${active.workload.tasks} tasks</p></div>`;
  }
  q.addEventListener('input', () => drawList(q.value));
  const panes = ['History — assignments and evaluations.', 'Work orders — current queue.', 'Certs — OQ register.', 'Notes — supervisor notes.'];
  root.querySelectorAll('.sp-profile .sp-tabs button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.sp-profile .sp-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    root.querySelector('#wf-tabpane').textContent = panes[+b.dataset.tab];
  }));
  drawList(); drawProfile();
}
