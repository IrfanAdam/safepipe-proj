import { sectionBlock, tabStrip } from './_shim.js';

export function renderRecord(root, fx) {
  const rec = fx.pipRecord;
  root.innerHTML = `
  <div class="sp-pip">
    <h2>Pipeline record — ${fx.pipelines[0].name}</h2>
    ${tabStrip(rec.tabs, 2)}
    <div class="sp-carousel">${rec.sections.slice(0, 5).map((s, i) =>
      `<button class="sp-card${i === 2 ? ' sel' : ''}" data-card="${i}">${s.title}</button>`).join('')}</div>
    <div class="sp-pane" id="pip-pane"></div>
    <div id="pip-sections">${rec.sections.map(s => sectionBlock(s.title, s.body)).join('')}</div>
  </div>`;
  const pane = root.querySelector('#pip-pane');
  const panes = {
    0: 'Upcoming — scheduled patrols and inspections.',
    1: 'History — prior inspections and work orders.',
    2: 'Fact sheet — all 14 record sections below.',
    3: 'Constructions — phases and MOC register.',
    4: 'Data — readings, sheets, attachments.'
  };
  const show = i => { pane.textContent = panes[i]; };
  show(2);
  root.querySelectorAll('.sp-tabs button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.sp-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    show(+b.dataset.tab);
  }));
  root.querySelectorAll('[data-card]').forEach(c => c.addEventListener('click', () => {
    root.querySelectorAll('[data-card]').forEach(x => x.classList.toggle('sel', x === c));
    const s = rec.sections[+c.dataset.card];
    pane.textContent = `${s.title} — ${s.body}`;
  }));
}

export function pipSectionCount(root) {
  return [...root.querySelectorAll('#pip-sections h4')].map(h => h.textContent);
}
