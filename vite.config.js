import { resolve } from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5175, host: '0.0.0.0', open: false },
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
    } },
  },
});
