import { renderOperations } from './operations.js';
import { renderWorkforce } from './workforce.js';
import { renderAssets } from './assets.js';
import { renderRecord } from './record.js';
import { renderHome } from './home.js';

const routes = {
  '/operations': { nav: 'Operations', render: renderOperations },
  '/workforce': { nav: 'Workforce', render: renderWorkforce },
  '/assets': { nav: 'Assets', render: renderAssets },
  '/pip': { nav: 'PIP record', render: renderRecord },
  '/home': { nav: 'Home', render: renderHome },
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
