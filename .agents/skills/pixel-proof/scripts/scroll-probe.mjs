// scroll-probe.mjs — headless scroll-frame harness (recipe: references/scroll-probe.md).
// Run from inside the repo dir so `playwright` resolves (ESM ignores NODE_PATH).
// Usage: node scroll-probe.mjs <url> <waitSel> <xformSel> [--click <sel>]... [--snap <sel>] [--reload]
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const clicks = [];
let snap = null;
let reload = false;
const url = args[0];
const waitSel = args[1];
const xformSel = args[2];
for (let i = 3; i < args.length; i++) {
  if (args[i] === '--click') clicks.push(args[++i]);
  else if (args[i] === '--snap') snap = args[++i];
  else if (args[i] === '--reload') reload = true;
}
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const setup = async () => {
  for (const sel of clicks) {
    try {
      if (await page.locator(sel).count()) await page.click(sel, { timeout: 5000 });
    } catch {}
  }
};
const snapshot = () => page.evaluate((s) => {
  if (!s) return null;
  return [...document.querySelectorAll(s)].map((el) => JSON.stringify(el.dataset || {}));
}, snap);
await page.goto(url, { waitUntil: 'networkidle' });
await setup();
await page.waitForSelector(waitSel, { timeout: 15000 });
await page.waitForTimeout(2000);
const coldSnap = await snapshot();
await page.evaluate(() => {
  window.__d = [];
  window.__run = true;
  const t0 = performance.now();
  const loop = (t) => {
    if (!window.__run) return;
    window.__d.push(t);
    if (t - t0 < 4000) requestAnimationFrame(loop);
    else window.__run = false;
  };
  requestAnimationFrame(loop);
  window.__lt = [];
  try {
    const ob = new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(Math.round(e.duration))));
    ob.observe({ entryTypes: ['longtask'] });
  } catch {}
});
for (let i = 0; i < 30; i++) {
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(100);
}
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);
const stats = await page.evaluate((xsel) => {
  const d = window.__d.slice().sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < d.length; i++) gaps.push(d[i] - d[i - 1]);
  gaps.sort((a, b) => a - b);
  const at = (p) => (gaps.length ? +gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))].toFixed(1) : 0);
  return {
    frames: gaps.length,
    p50: at(0.5),
    p95: at(0.95),
    max: gaps.length ? +gaps[gaps.length - 1].toFixed(1) : 0,
    longtasks: window.__lt,
    transforms: [...document.querySelectorAll(xsel)].map((el) => el.style.transform || '(none)'),
  };
}, xformSel);
let snapMatch = null;
if (reload) {
  await page.reload({ waitUntil: 'networkidle' });
  await setup();
  await page.waitForSelector(waitSel, { timeout: 15000 });
  await page.waitForTimeout(2000);
  const warmSnap = await snapshot();
  snapMatch = JSON.stringify(coldSnap) === JSON.stringify(warmSnap);
}
await browser.close();
const nan = stats.transforms.some((t) => t.includes('NaN'));
console.log(JSON.stringify({ stats, snapMatch, errors }, null, 1));
if (nan || errors.length) { console.error('PROBE-FAIL'); process.exit(1); }
console.log('PROBE-OK');
