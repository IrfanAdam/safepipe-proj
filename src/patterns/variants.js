import { pill, sectionBlock, tabStrip } from './_shim.js';
import { FORMS } from '../logic/inspections.js';

function qInput(q) {
  if (q.type === 'boolean') return `<span class="sp-chip">Yes</span> <span class="sp-chip">No</span>`;
  if (q.type === 'choice' || q.type === 'evaluation')
    return (q.options || []).map(o => `<span class="sp-chip">${o}</span>`).join(' ');
  if (q.type === 'textarea') return `<textarea placeholder="${q.label}" aria-label="${q.label}"></textarea>`;
  if (q.type === 'mileage') return `<input value="" placeholder="mi" aria-label="${q.label}" />`;
  return `<input value="" placeholder="${q.label}" aria-label="${q.label}" />`;
}

export function renderOpsConstruction(root, fx) {
  const c = fx.construction;
  root.innerHTML = `
  <div class="sp-ops">
    <div class="sp-ops-left">
      <div class="sp-mapbar"><input value="" placeholder="Search map / chainage…" aria-label="Search map" /><button>Go</button></div>
      <div class="sp-map" role="img" aria-label="Construction corridor map">Map — construction corridor (Plan C twin)</div>
      <div class="sp-toolbar"><input placeholder="Filter phases…" aria-label="Filter phases" />
        <button title="List">☰</button><button title="Map">▦</button><button class="on" title="Detail">◧</button></div>
      <div class="sp-pane">${c.phases.map((p, i) => `<p>${pill(`Phase ${i + 1}`, i === 1 ? 'accent' : '')} ${p}</p>`).join('')}</div>
    </div>
    <aside class="sp-wo" aria-label="Construction work order">
      <p class="sp-client">${c.client}</p>
      <div class="sp-assignee"><span class="sp-avatar"></span><span><strong>${c.assignee}</strong><small>${c.assignedAgo}</small></span></div>
      <p class="sp-sys">${c.system} <span class="sp-due">Due in ${c.dueInDays} days</span></p>
      <h2>${c.title}</h2>
      <p class="sp-status">${c.status} · ${c.county}</p>
      <p class="sp-meta">${c.lastInspected}</p>
      <div class="sp-equip"><p><strong>${c.equipment.length} equipments needed</strong></p>
        ${c.equipment.map(e => `<label class="sp-eq"><input type="checkbox" /> ${e}</label>`).join('')}</div>
      ${tabStrip(c.tabs, 1)}
      <div class="sp-pane" id="v-tabpane">Phases — ${c.phases.join(', ')}.</div>
    </aside>
  </div>`;
  const panes = ['Overview — construction WO summary.', `Phases — ${c.phases.join(', ')}.`, 'Timeline — phase history.', 'Notes — crew notes.', 'Files — drawings and sheets.'];
  root.querySelectorAll('.sp-tabs button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.sp-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    root.querySelector('#v-tabpane').textContent = panes[+b.dataset.tab];
  }));
}

export function renderOpsImp(root, fx) {
  const v = fx.imp;
  root.innerHTML = `
  <div class="sp-ops">
    <div class="sp-ops-left">
      <div class="sp-mapbar"><input value="" placeholder="Search map / HCA…" aria-label="Search map" /><button>Go</button></div>
      <div class="sp-map" role="img" aria-label="HCA segments map">Map — HCA segments overlay (Plan C twin)</div>
      <div class="sp-toolbar"><input placeholder="Filter threats…" aria-label="Filter threats" />
        <button title="List">☰</button><button title="Map">▦</button><button class="on" title="Detail">◧</button></div>
      <div class="sp-pane">${v.hcaSegments.map(s => `<p>${pill('HCA', 'warn')} ${s}</p>`).join('')}</div>
    </div>
    <aside class="sp-wo" aria-label="IMP detail">
      <p class="sp-client">${v.client}</p>
      <p class="sp-sys">${v.system} <span class="sp-due">Due in ${v.dueInDays} days</span></p>
      <h2>${v.title}</h2>
      <p class="sp-status">${v.status} · ${v.county}</p>
      <p class="sp-meta">${v.lastInspected} · ${v.tool}</p>
      ${sectionBlock('Mitigations', v.mitigations.join('; '))}
      ${tabStrip(v.tabs, 2)}
      <div class="sp-pane" id="v-tabpane">Mitigations — ${v.mitigations.join('; ')}.</div>
    </aside>
  </div>`;
  const panes = ['Overview — IMP summary.', 'Threats — HCA segments.', `Mitigations — ${v.mitigations.join('; ')}.`, 'Timeline — assessment history.', 'Files — ILI runs.'];
  root.querySelectorAll('.sp-tabs button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.sp-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    root.querySelector('#v-tabpane').textContent = panes[+b.dataset.tab];
  }));
}

function pipelineQuestions(fx) {
  const local = (fx.questionnaire && fx.questionnaire.questions) || [];
  if (local.length) return local;
  const form = (FORMS && FORMS[fx.questionnaire?.formId || 'pipelinePatrol']) || FORMS.pipelinePatrol;
  return form.questions.map(q => ({ label: q.label, type: q.type, options: q.options }));
}

export function renderQuestionnairePipeline(root, fx) {
  const q = fx.questionnaire;
  const questions = pipelineQuestions(fx);
  root.innerHTML = `
  <div class="sp-ops">
    <div class="sp-ops-left">
      <div class="sp-mapbar"><input value="" placeholder="Search questions…" aria-label="Search questions" id="vq" /><button>Go</button></div>
      <div class="sp-pane" id="v-qlist">
        ${questions.map((item, i) => `<div class="sp-section"><h4>Q${i + 1}. ${item.label}</h4><p>${qInput(item)}</p></div>`).join('')}
      </div>
    </div>
    <aside class="sp-wo" aria-label="Questionnaire context">
      <p class="sp-client">Motiva enterprises</p>
      <p class="sp-sys">${q.system}</p>
      <h2>${q.title}</h2>
      <p class="sp-meta">Inspector ${q.assignee} · ${questions.length} questions</p>
      <p>${pill(`0 of ${questions.length} answered`, '')}</p>
      <p class="sp-meta">Progress 0%</p>
    </aside>
  </div>`;
  const box = root.querySelector('#vq');
  box?.addEventListener('input', () => {
    const f = box.value.toLowerCase();
    root.querySelectorAll('#v-qlist .sp-section').forEach(s => {
      s.style.display = s.textContent.toLowerCase().includes(f) ? '' : 'none';
    });
  });
}

function editForm(root, fx, key) {
  const f = fx[key];
  root.innerHTML = `
  <div class="sp-ops"><aside class="sp-wo" aria-label="${f.heading}">
    <h2>${f.heading}</h2>
    <p class="sp-meta">${f.assetId ? f.assetId + ' · ' : ''}${f.county || f.phase || ''}</p>
    ${f.fields.map(fd => `<label class="sp-eq">${fd.label}<input value="${fd.value}" aria-label="${fd.label}" /></label>`).join('')}
    <p><button>Save</button> <button>Cancel</button></p>
  </aside></div>`;
}

export function renderAcsEdit(root, fx) { editForm(root, fx, 'acsEdit'); }
export function renderViEdit(root, fx) { editForm(root, fx, 'viEdit'); }
export function renderConstructionEdit(root, fx) { editForm(root, fx, 'constructionEdit'); }

export function renderMocDescrip(root, fx) {
  const m = fx.mocDescrip;
  root.innerHTML = `
  <div class="sp-ops"><aside class="sp-wo" aria-label="MOC description">
    <h2>${m.heading}</h2>
    <p>${pill(m.type, 'accent')}</p>
    ${sectionBlock('Description of Change', m.description)}
    ${sectionBlock('Reason for Change', m.reason)}
    ${sectionBlock('Associated Hazards', m.hazards)}
    <p><button>Submit MOC</button></p>
  </aside></div>`;
}

export function renderLegendOverlay(root, fx) {
  const l = fx.legend;
  root.innerHTML = `
  <div class="sp-map" role="img" aria-label="Map with legend">Map — network canvas (Plan C twin)</div>
  <div class="sp-pane" role="dialog" aria-label="${l.heading}">
    <h4>${l.heading}</h4>
    ${l.entries.map(e => `<p><span class="sp-sq ${e.swatch}"></span> ${e.label}</p>`).join('')}
    <p><button>Close</button></p>
  </div>`;
}

export function renderGenericModal(root, fx) {
  const m = fx.modal;
  root.innerHTML = `
  <div class="sp-pane" role="dialog" aria-modal="true" aria-label="${m.heading}">
    <h4>${m.heading}</h4><p>${m.body}</p>
    <p>${m.buttons.map(b => `<button>${b}</button>`).join(' ')}</p>
  </div>`;
}

export function renderCalendarPopover(root, fx) {
  const c = fx.calendar;
  root.innerHTML = `
  <div class="sp-pane" role="dialog" aria-label="${c.heading}">
    <h4>${c.heading} — ${c.month}</h4>
    <p class="sp-datebar">${c.events.map(e => `${pill(e.date === c.selected ? e.date : e.date, e.date === c.selected ? 'accent' : '')} ${e.label}`).join('<br>')}</p>
    <p><button>Confirm ${c.selected}</button></p>
  </div>`;
}
