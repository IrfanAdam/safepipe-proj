import { startRouter } from './patterns/router.js';
import fx from './data/fixtures.json';
import variantFx from './data/variants-fixtures.json';
import recordsFx from './data/records-fixtures.json';

const allFx = { ...fx, ...variantFx, ...recordsFx };

const d = new Date();
try {
  const el = document.getElementById('sp-date');
  if (el && el.textContent.includes('2021')) {
    el.textContent = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'Short', year: 'numeric' });
  }
} catch { /* keep legacy date */ }

startRouter(document.getElementById('outlet'), allFx);

const GLYPH = { light: '☾', dark: '☀' };
function paintThemeButton(btn) {
  const dark = document.documentElement.dataset.theme === 'dark';
  btn.setAttribute('aria-pressed', String(dark));
  btn.textContent = dark ? GLYPH.dark : GLYPH.light;
}
try {
  const btn = document.getElementById('sp-theme-toggle');
  if (btn) {
    paintThemeButton(btn);
    btn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('sp-theme', next); } catch { /* private mode */ }
      paintThemeButton(btn);
    });
  }
} catch { /* toggle optional */ }
