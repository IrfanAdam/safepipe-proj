import { renderOperations } from './operations.js';
import { renderWorkforce } from './workforce.js';
import { renderAssets } from './assets.js';
import { renderRecord } from './record.js';
import { renderHome } from './home.js';
import {
  renderOpsConstruction, renderOpsImp, renderQuestionnairePipeline,
  renderAcsEdit, renderViEdit, renderConstructionEdit, renderMocDescrip,
  renderLegendOverlay, renderGenericModal, renderCalendarPopover,
} from './variants.js';
import {
  renderCRM, renderFAC, renderEquipments, renderAnnuals, renderDevices,
  renderValveBox, renderMappingForm, renderReports, renderWOForm,
} from './records.js';
import { renderHomeQueue, renderHomeAlerts, renderHomeModal } from './mobile.js';

const routes = {
  '/operations': { nav: 'Operations', render: renderOperations },
  '/workforce': { nav: 'Workforce', render: renderWorkforce },
  '/assets': { nav: 'Assets', render: renderAssets },
  '/pip': { nav: 'PIP record', render: renderRecord },
  '/home': { nav: 'Home', render: renderHome },
  '/ops-construction': { nav: 'Ops · Construction', render: renderOpsConstruction },
  '/ops-imp': { nav: 'Ops · IMP', render: renderOpsImp },
  '/questionnaire': { nav: 'Questionnaire', render: renderQuestionnairePipeline },
  '/acs-edit': { nav: 'ACS edit', render: renderAcsEdit },
  '/vi-edit': { nav: 'VI edit', render: renderViEdit },
  '/construction-edit': { nav: 'Construction edit', render: renderConstructionEdit },
  '/moc-descrip': { nav: 'MOC', render: renderMocDescrip },
  '/legend': { nav: 'Legend', render: renderLegendOverlay },
  '/modal': { nav: 'Modal', render: renderGenericModal },
  '/calendar': { nav: 'Calendar', render: renderCalendarPopover },
  '/crm': { nav: 'CRM record', render: renderCRM },
  '/fac': { nav: 'FAC record', render: renderFAC },
  '/equipments': { nav: 'Equipments', render: renderEquipments },
  '/annuals': { nav: 'Annuals', render: renderAnnuals },
  '/devices': { nav: 'Devices', render: renderDevices },
  '/valvebox': { nav: 'Valve box', render: renderValveBox },
  '/mapping': { nav: 'Mapping form', render: renderMappingForm },
  '/reports': { nav: 'Reports', render: renderReports },
  '/wo-pmp': { nav: 'WO · PMP', render: (r, f) => renderWOForm(r, f, 'PMP') },
  '/wo-moc': { nav: 'WO · MOC', render: (r, f) => renderWOForm(r, f, 'MOC') },
  '/wo-construction': { nav: 'WO · Construction', render: (r, f) => renderWOForm(r, f, 'Construction') },
  '/wo-acs': { nav: 'WO · ACS', render: (r, f) => renderWOForm(r, f, 'ACS') },
  '/wo-vi': { nav: 'WO · VI', render: (r, f) => renderWOForm(r, f, 'VI') },
  '/home-queue': { nav: 'Home · Queue', render: renderHomeQueue },
  '/home-alerts': { nav: 'Home · Alerts', render: renderHomeAlerts },
  '/home-modal': { nav: 'Home · Modal', render: renderHomeModal },
};

export function startRouter(outlet, fx) {
  const links = [...document.querySelectorAll('[data-route]')];
  function current() {
    const h = location.hash.replace(/^#/, '') || '/operations';
    return routes[h] ? h : '/operations';
  }
  function render() {
    const h = current();
    links.forEach(a => a.classList.toggle('on', a.dataset.route === h));
    const label = routes[h].nav;
    document.title = `Safepipe — ${label}`;
    try {
      routes[h].render(outlet, fx);
    } catch (err) {
      outlet.innerHTML = `<p class="sp-meta">Render error on ${h}: ${String(err)}</p>`;
      console.error(err);
    }
  }
  window.addEventListener('hashchange', render);
  render();
  return { routes: Object.keys(routes) };
}
