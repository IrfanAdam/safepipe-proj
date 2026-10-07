import { chromium, webkit } from 'playwright';
const [, , url, out, engine = 'chromium'] = process.argv;
if (!url || !out) { console.error('usage: node shot.mjs <url> <out.png> [chromium|webkit]'); process.exit(1); }
const launch = async () => {
  if (engine === 'webkit') {
    return webkit.launch({ headless: true });
  }
  return chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
};
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push(e.message.slice(0, 200)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(8000);
const state = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const h = document.querySelector('[data-testid="ops-hud"]');
  return { canvas: !!c, w: c?.width, h: c?.height, hud: !!h, hudText: h?.innerText?.slice(0, 400) };
});
console.log('STATE:', JSON.stringify(state));
console.log('ERRS:', errs.slice(-3));
await page.screenshot({ path: out, fullPage: false });
console.log('WROTE', out);
await browser.close();
