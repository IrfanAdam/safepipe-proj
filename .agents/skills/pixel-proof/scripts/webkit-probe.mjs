#!/usr/bin/env node
// Engine-accurate render probe: measure, click, capture — in WebKit (Safari's engine) or Chromium.
//
// One-time setup, in a scratch dir OUTSIDE the repo (never add playwright to the project):
//   mkdir -p ~/.hermes/cache/scratch/pw && cd ~/.hermes/cache/scratch/pw
//   npm init -y && npm i playwright && npx playwright install webkit
//
// Usage:
//   node webkit-probe.mjs --url http://127.0.0.1:5174/gallery.html#overlays --w 1440 --h 900 \
//     --measure '[data-overlay-target=ov-drawer]' --measure '.ov-stage' \
//     --click '[data-overlay-target=ov-drawer]' --mid 90 --shot /tmp/after.png [--engine chromium]
//
// Prints one JSON line per phase (rest / mid / settled / closed) so two engines can be diffed directly.
// Run the SAME invocation with --engine webkit and --engine chromium before claiming a UI fix:
// a Chrome-only pass does not prove what a Safari user sees.

import { webkit, chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i === -1 ? dflt : argv[i + 1]; };
const many = (name) => argv.reduce((acc, a, i) => (a === '--' + name ? [...acc, argv[i + 1]] : acc), []);

const url = opt('url');
if (!url) { console.error('need --url <url>'); process.exit(2); }
const engineName = opt('engine', 'webkit');
const W = Number(opt('w', 1440)), H = Number(opt('h', 900));
const selects = many('measure');
const clickSel = opt('click');
const mid = Number(opt('mid', 90));
const shot = opt('shot');

// Runs in the page: rects + the computed properties that decide placement.
const MEASURE = `(sels => { const out = {}; for (const s of sels) {
  const el = document.querySelector(s);
  if (!el) { out[s] = null; continue; }
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  out[s] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    pos: cs.position, top: cs.top, right: cs.right, left: cs.left, transform: cs.transform, hidden: el.hidden === true };
} return JSON.stringify(out); })(${JSON.stringify(selects)})`;

const engine = engineName === 'chromium' ? chromium : webkit;
const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(opt('wait', 2200)));

const say = async (phase) => console.log(engineName.padEnd(9) + phase.padEnd(9) + await page.evaluate(MEASURE));
await say('rest');

if (clickSel) {
  await page.click(clickSel);
  await page.waitForTimeout(mid);
  await say('mid');
  if (shot) await page.screenshot({ path: shot.replace(/\.png$/, '') + '-mid.png' });
  await page.waitForTimeout(Math.max(0, 700 - mid));
  await say('settled');
}
if (shot) await page.screenshot({ path: shot });
if (errs.length) console.log('errors    ' + JSON.stringify(errs));
await browser.close();
