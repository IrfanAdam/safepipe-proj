import { ONTOLOGY, SEGMENTS } from './logic/ontology.js';

// Tabs
const tabs = [...document.querySelectorAll('.tabs button')];
const panels = { network: document.getElementById('panel-network'), twin: document.getElementById('panel-twin'), integrity: document.getElementById('panel-integrity'), work: document.getElementById('panel-work') };
tabs.forEach(b => b.addEventListener('click', () => {
  tabs.forEach(x => x.setAttribute('aria-selected', String(x === b)));
  Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== b.dataset.tab; });
}));

// Schematic nodes (stub)
const g = document.getElementById('nodes');
const meta = document.getElementById('node-meta');
SEGMENTS.forEach((s, i) => {
  const x = 80 + i * ((520) / Math.max(1, SEGMENTS.length - 1 || 1));
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('cx', x); c.setAttribute('cy', 110); c.setAttribute('r', 11); c.setAttribute('class', 'node');
  c.addEventListener('click', () => {
    g.querySelectorAll('.node').forEach(n => n.classList.remove('sel'));
    c.classList.add('sel');
    meta.textContent = `${s.id} · ${s.name} · ${s.km} km · sensors: ${s.sensors} · status: ${s.status}`;
  });
  g.appendChild(c);
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', x - 12); t.setAttribute('y', 142); t.setAttribute('class', 'nlabel'); t.textContent = s.id;
  g.appendChild(t);
});

// Risks / ILI / work orders (stub data)
const risks = document.getElementById('risks');
[['SEG-03 · coating anomaly', 'warn'], ['SEG-05 · pressure drift', 'bad'], ['SEG-01 · vegetation encroach', 'ok']].forEach(([t, k]) => {
  const li = document.createElement('li'); li.innerHTML = `<span>${t}</span><span class="pill ${k}">${k}</span>`; risks.appendChild(li);
});
document.getElementById('ili').innerHTML = SEGMENTS.slice(0, 4).map(s =>
  `<tr><td>${s.id}</td><td>2025-11</td><td>${s.status === 'ok' ? '—' : '1 flagged'}</td><td><span class="pill ${s.status === 'ok' ? 'ok' : 'warn'}">${s.status}</span></td></tr>`).join('');
document.getElementById('wo').innerHTML = ['WO-118 · coating repair · SEG-03', 'WO-121 · valve test · SEG-05'].map(t =>
  `<li><span>${t}</span><span class="pill">open</span></li>`).join('');
document.getElementById('onto-count').textContent =
  `${ONTOLOGY.entities.length} entities · ${SEGMENTS.length} segments (stub)`;
