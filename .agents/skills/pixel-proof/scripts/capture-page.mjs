// capture-page.mjs — reliable headless screenshot of a LIVE page via CDP.
// usage: node capture-page.mjs <url> <out.png> [waitMs=9000] [width=1600] [height=1000] [scale=2]
//
// Why not the one-shot `--headless --screenshot` flag: on a live Vite page the HMR socket and
// rAF loop keep the browser 'busy' so the process can hang forever and never write the file
// (--virtual-time-budget does not cap the wait). This driver navigates, waits in REAL time,
// then captures. Requires Node >=22 (built-in WebSocket). No npm deps.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [url, out, waitMsArg, wArg, hArg, sArg] = process.argv.slice(2);
const waitMs = Number(waitMsArg || 9000);
const W = Number(wArg || 1600), H = Number(hArg || 1000), SCALE = Number(sArg || 2);
const PORT = process.env.CAPTURE_CDP_PORT || '9513';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = '/Users/irfan/.hermes/cache/scratch/capture-page-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  '--mute-audio', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' });

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no CDP page target');
}

const ws = new WebSocket(await getWsUrl());
let id = 0;
const pend = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pend.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws error')); });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
await send('Page.navigate', { url });
await sleep(waitMs);
const info = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ready: document.readyState, title: document.title,
    canvas: (() => { const c = document.querySelector('canvas'); return c ? c.width + 'x' + c.height : null })() })`,
  returnByValue: true,
});
console.log('PAGE:', info.result.value);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('SAVED', out, Math.round(shot.data.length / 1024) + 'KB');
try { ws.close(); } catch {}
chrome.kill('SIGTERM');
setTimeout(() => process.exit(0), 400);
