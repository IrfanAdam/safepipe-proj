# Lint-Manage + Smoke Gates — Phase 0 Freeze

Reusable gate pair for the refactor-manageability shape: freeze behavior before splitting files. Both gates are ≤40 lines and live in `scripts/`.

## lint-manage.mjs (≤40 lines, readable itself)

Checks: `≤100 lines/file` (excl. `changelog-manifest.json`), `/* ADAM/` header line 1, `≤120ch/line`.

```js
/* ADAM/TOOL — lint-manage · ≤100 lines + readability + headers · [plan:file#phase-0] */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 100;
const fail = [];
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) return walk(p);
  return (p.endsWith('.js') || p.endsWith('.css')) ? [p] : [];
});
for (const f of [join(ROOT,'src'), join(ROOT,'scripts')].flatMap(r => { try{return walk(r)}catch{return[]}})) {
  if (f.includes('changelog-manifest.json')) continue;
  const src = readFileSync(f,'utf8');
  const lines = src.split('\n');
  const n = lines[lines.length-1]==='' ? lines.length-1 : lines.length;
  const short = f.replace(ROOT+'/','');
  if (n > MAX) fail.push(`${short} ${n} lines (limit ${MAX})`);
  if (!src.startsWith('/* ADAM/')) fail.push(`${short} missing ADAM header`);
  const idx = lines.findIndex(ln => ln.length > 120);
  if (idx > -1) fail.push(`${short}:${idx+1} line >120ch — wrap it`);
}
if (fail.length) { console.error(`✗ manage lint — ${fail.length}:\n  ${fail.join('\n  ')}`); process.exit(1); }
console.log('✓ manage lint — lines + headers + width clean');
```

- **Path pitfall:** never `new URL('..', import.meta.url).pathname` — `%20` breaks `readdirSync` on spaced paths; always `fileURLToPath`.
- **Package:** add `"lint:manage": "node scripts/lint-manage.mjs"` to `scripts`; keep `test` as `lint:tokens && build` until line failures are cleared (phase 2), otherwise baseline `npm test` fails intentionally. `lint:manage` is the phase-gate, not the CI gate, until clean.
- **Expected before splits:** `✗ manage lint — 97:` listing all 13 over-limit files + header/width misses — proves gate works. After phase 2, expect `✓ manage lint`.

## smoke.mjs (≤35 lines, port 5199 never 5173)

```js
/* ADAM/TOOL — smoke · route 200 + markers on 5199 (never 5173) · [plan:file#phase-0] */
import { spawn } from 'node:child_process';
const PORT = 5199, HOST='127.0.0.1';
const URLS = [[`http://${HOST}:${PORT}/`, /Irfan Adam|Portfolio/i],[`http://${HOST}:${PORT}/ds/`, /ADAM\/DS|Design System/i]];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const fetchOk=async(url,re)=>{ const res=await fetch(url); if(res.status!==200) throw new Error(`${url} status ${res.status}`); const txt=await res.text(); if(!re.test(txt)) throw new Error(`${url} missing marker ${re}`); };
const preview=spawn('npx',['vite','preview','--port',String(PORT),'--host',HOST,'--strictPort'],{stdio:'pipe'});
let ready=false; preview.stdout.on('data',d=>{if(String(d).includes(String(PORT))) ready=true}); preview.stderr.on('data',d=>{if(String(d).includes(String(PORT))) ready=true});
for(let i=0;i<30&&!ready;i++){ await wait(300); try{await fetch(`http://${HOST}:${PORT}/`); ready=true;}catch{}}
if(!ready){ preview.kill('SIGTERM'); console.error('✗ smoke — preview not ready on '+PORT); process.exit(1); }
try{ for(const[u,re] of URLS) await fetchOk(u,re); console.log('✓ smoke — / + /ds/ 200 with markers'); preview.kill('SIGTERM'); process.exit(0);}catch(e){ console.error('✗ smoke —',e.message); preview.kill('SIGTERM'); process.exit(1); }
```

- Markers must match built HTML titles, not JS-rendered strings: `/` is `Irfan Adam|Portfolio`, `/ds/` is `ADAM/DS|Design System` — `masonry` is absent from `dist/index.html`.
- `vite preview` serves `dist/`; `configureServer` rewrites (`/ds`→`/ds/index.html`) run only under dev, so smoke uses `/ds/` trailing slash and asserts 200 + marker.
- Add `"smoke": "node scripts/smoke.mjs"` to `package.json` for `npm run smoke`.

## Baseline doc

`docs/baseline.md` lists the 13 over-limit files with `wc -l` counts, CSS at cap (99/99/96), total lines, and freeze constraints (routes, `npm test` green, `ds:track` tagged, `plan:names` 0 missing, smoke port rule, barrel + `git stash` deletion guarantee). Each later phase diffs against it; no split may change pixels/audio/timing.

## Verify loop (every phase)

```bash
node scripts/lint-manage.mjs   # phase-appropriate: 97 fails at baseline, 0 after phase 2
npm run lint:tokens && npm run build  # = npm test
node scripts/plan-names.mjs && node scripts/ds-track.mjs
node scripts/smoke.mjs         # ✓ smoke — / + /ds/ 200 with markers (port 5199, never 5173)
cat docs/baseline.md | head -n 20
```
