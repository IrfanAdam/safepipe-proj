import { resolve, join, sep } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { dueEditText } from './src/changelog/changelog-events.js';

// ——— ds-due-writer: local-only write endpoint for the changelog Due picker ———
// The changelog page is a static build — there are no accounts, so "auth" is
// the wrong frame. The threats that matter for a file write on the authoring
// machine are (a) a random website in the user's browser POSTing to
// localhost:5175 (CSRF), and (b) another device on the LAN while `npm run dev`
// binds 0.0.0.0. Both are blocked at the transport layer: loopback client
// only, same-origin JSON fetch only, and the target is pinned to an existing
// .hermes/plans/*.md file (never a create, never a traversal). `vite build`
// registers no endpoint, so a deployed static build stays read-only.
const PLANS_DIR = resolve(__dirname, '.hermes/plans');
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const dueWriter = () => {
  const fail = (res, code, why) => {
    if (res.writableEnded) return;
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: why }));
  };
  const handler = (req, res, next) => {
    if (!req.url || !req.url.startsWith('/__ds/due')) return next();
    if (req.method !== 'POST') return fail(res, 405, 'method');
    if (!LOOPBACK.has(req.socket && req.socket.remoteAddress)) return fail(res, 403, 'loopback-only');
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return fail(res, 403, 'cross-site');
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return fail(res, 403, 'origin');
    if (!String(req.headers['content-type'] || '').includes('application/json')) return fail(res, 415, 'json-only');
    const buf = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 8192) { fail(res, 413, 'too-large'); req.destroy(); return; }
      buf.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(buf).toString('utf8')); } catch { return fail(res, 400, 'bad-json'); }
      const file = String((body && body.file) || '');
      const head = String((body && body.head) || '');
      const due = body && (body.due === null || body.due === undefined) ? null : String(body.due);
      if (!/^[A-Za-z0-9._-]+\.md$/.test(file) || file.includes('..')) return fail(res, 400, 'file');
      if (!head || head.length > 300 || /[\r\n]/.test(head)) return fail(res, 400, 'head');
      if (due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return fail(res, 400, 'due');
      const target = join(PLANS_DIR, file);
      if (!target.startsWith(PLANS_DIR + sep) || !existsSync(target)) return fail(res, 404, 'not-found');
      const raw = readFileSync(target, 'utf8');
      const nextText = dueEditText(raw, head, due);
      if (nextText === raw) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ changed: false, file, due }));
        return;
      }
      writeFileSync(target, nextText);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ changed: true, file, due }));
    });
  };
  return {
    name: 'ds-due-writer',
    configureServer(s) { s.middlewares.use(handler); },
    configurePreviewServer(s) { s.middlewares.use(handler); },
  };
};

export default defineConfig({
  server: { port: 5175, host: '0.0.0.0', open: false },
  plugins: [dueWriter()],
  // MPA: every root *.html below is a bundled entry — all pages land in dist/
  // with hashed assets. appType 'mpa' disables SPA fallback hijack in dev.
  appType: 'mpa',
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: { input: {
      main: resolve(__dirname, 'index.html'),
      gallery: resolve(__dirname, 'gallery.html'),
      logic: resolve(__dirname, 'logic.html'),
      pitch: resolve(__dirname, 'pitch.html'),
      ops3d: resolve(__dirname, 'ops3d.html'),
      map: resolve(__dirname, 'ops3d-map.html'),
      ring2: resolve(__dirname, 'ops3d-ring2.html'),
      changelog: resolve(__dirname, 'changelog.html'),
    } },
  },
});
