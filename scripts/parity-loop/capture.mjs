#!/usr/bin/env node
/* parity-loop/capture.mjs — capture TOP/ISO/NEAR via headless Chromium on :5198.
 * Reuses the running dev server (never starts one, never touches :5173/:5175).
 * Captures land in scratch only (--out dir). Emits probes.json alongside.
 * Usage: node scripts/parity-loop/capture.mjs --out <scratchDir> --base http://localhost:5198 [--settle 5000] */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]?.startsWith('--') ? '1' : arr[i + 1]]] : [],
  ),
);
const OUT = args.out;
const BASE = (args.base ?? 'http://localhost:5198').replace(/\/$/, '');
const SETTLE = Number(args.settle ?? 5000); // close views stream DEM tiles per move; 2.5 s flapped NEAR
const VW = Number(args.vw ?? 1280);
const VH = Number(args.vh ?? 800);
if (!OUT) { console.error('capture.mjs: --out <dir> required'); process.exit(1); }

// TOP/ISO/NEAR map onto the ring2 level presets (src/ring2/main.js VIEW_PRESETS).
const VIEWS = [
  { name: 'TOP', preset: 'network' },
  { name: 'ISO', preset: 'segment' },
  { name: 'NEAR', preset: 'asset' },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));

await page.goto(`${BASE}/ops3d-ring2.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForFunction(() => !!window.__ring2, { timeout: 25000 });
await page.waitForTimeout(4000); // let DEM + sat base settle once

const probes = { base: BASE, viewport: { w: VW, height: VH }, errors, views: {} };
for (const v of VIEWS) {
  const applied = await page.evaluate((p) => {
    try { return window.__ring2.setViewPreset(p) ?? window.__ring2.setLevel?.(p) ?? null; }
    catch { return null; }
  }, v.preset);
  await page.waitForTimeout(SETTLE);
  const probe = await page.evaluate(() => {
    const r2 = window.__ring2;
    let pose = null, diag = null;
    try { pose = r2.getPose?.() ?? null; } catch { /* probe never breaks capture */ }
    try { diag = r2.diag?.() ?? null; } catch { /* probe never breaks capture */ }
    const canvases = [...document.querySelectorAll('canvas')].map((c) => ({
      w: c.width, h: c.height,
    }));
    return { pose, diag, canvases };
  });
  const shot = join(OUT, `${v.name}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  probes.views[v.name] = { preset: applied ?? v.preset, ...probe, capture: shot };
  console.log(`CAPTURE ${v.name} preset=${applied ?? v.preset} -> ${shot}`);
}
await browser.close();
writeFileSync(join(OUT, 'probes.json'), JSON.stringify(probes, null, 2));
console.log(`PROBES ${join(OUT, 'probes.json')} consoleErrors=${errors.length}`);
