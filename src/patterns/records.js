import { sectionBlock, tabStrip } from './_shim.js';

/* Fact-sheet records for Read-only Fig pages (CRM, FAC, Equipments, Annuals,
 * Devices, Valve box, Mapping form, Reports). Same interaction shape as
 * record.js: tab strip (Upcoming/History/Fact sheet/Constructions/Data) +
 * carousel of the first 5 sections + full section list.
 * Fixture records live in src/data/records-fixtures.json (parent wires fx). */

function factSheet(root, rec, cls) {
  const fallback = { tabs: ['Upcoming', 'History', 'Fact sheet', 'Constructions', 'Data'], sections: [] };
  const r = rec || fallback;
  root.innerHTML = `
  <div class="${cls}">
    <h2>${r.title || 'Record'}</h2>
    ${r.subtitle ? `<p class="sp-meta">${r.subtitle}</p>` : ''}
    ${tabStrip(r.tabs, 2)}
    <div class="sp-carousel">${r.sections.slice(0, 5).map((s, i) =>
      `<button class="sp-card${i === 2 ? ' sel' : ''}" data-card="${i}">${s.title}</button>`).join('')}</div>
    <div class="sp-pane" id="rec-pane"></div>
    <div id="rec-sections">${r.sections.map(s => sectionBlock(s.title, s.body)).join('')}</div>
  </div>`;
  const pane = root.querySelector('#rec-pane');
  const panes = {
    0: 'Upcoming — scheduled patrols and inspections.',
    1: 'History — prior inspections and work orders.',
    2: `Fact sheet — all ${r.sections.length} record sections below.`,
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
    const s = r.sections[+c.dataset.card];
    pane.textContent = `${s.title} — ${s.body}`;
  }));
}

export function renderCRM(root, fx) { factSheet(root, fx.crmRecord, 'sp-crm'); }
export function renderFAC(root, fx) { factSheet(root, fx.facRecord, 'sp-fac'); }
export function renderEquipments(root, fx) { factSheet(root, fx.equipmentsRecord, 'sp-equip'); }
export function renderAnnuals(root, fx) { factSheet(root, fx.annualsRecord, 'sp-annuals'); }
export function renderDevices(root, fx) { factSheet(root, fx.devicesRecord, 'sp-devices'); }
export function renderValveBox(root, fx) { factSheet(root, fx.valveBoxRecord, 'sp-valvebox'); }
export function renderMappingForm(root, fx) { factSheet(root, fx.mappingFormRecord, 'sp-mapping'); }
export function renderReports(root, fx) { factSheet(root, fx.reportsRecord, 'sp-reports'); }

export function recordSectionCount(root) {
  return [...root.querySelectorAll('#rec-sections h4')].map(h => h.textContent);
}

/* Data-driven work-order form bodies (WO Forms Fig page: PMP / MOC /
 * Construction / ACS / VI). Form defs come from fx.woForms in
 * src/data/records-fixtures.json; formId is matched case-insensitively
 * against the woForms keys. */
export function renderWOForm(root, fx, formId) {
  const forms = (fx && fx.woForms) || {};
  const key = Object.keys(forms).find(k => k.toLowerCase() === String(formId || '').toLowerCase());
  const form = key ? forms[key] : null;
  if (!form) {
    root.innerHTML = `<div class="sp-woform"><p class="sp-meta">Unknown form “${formId}”. Available: ${Object.keys(forms).join(', ')}</p></div>`;
    return;
  }
  root.innerHTML = `
  <div class="sp-woform" data-form="${key}">
    <h2>${form.title}</h2>
    <form>${(form.fields || []).map(f => woField(f)).join('')}
      <button type="submit">Submit</button></form>
  </div>`;
  root.querySelector('form').addEventListener('submit', e => e.preventDefault());
}

function woField(f) {
  if (f.type === 'select') {
    return `<label class="sp-field"><span>${f.label}</span><select name="${f.label}">${(f.options || []).map(o => `<option>${o}</option>`).join('')}</select></label>`;
  }
  if (f.type === 'boolean') {
    return `<fieldset class="sp-field"><legend>${f.label}</legend>${(f.options || ['Yes', 'No']).map(o => `<label><input type="radio" name="${f.label}" value="${o}"> ${o}</label>`).join('')}</fieldset>`;
  }
  return `<label class="sp-field"><span>${f.label}</span><input type="${f.type || 'text'}" name="${f.label}"></label>`;
}
