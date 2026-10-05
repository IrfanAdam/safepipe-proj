import { resolve } from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5175, host: '0.0.0.0', open: false },
  // mpa prevents SPA fallback from hijacking /logic.html; public/logic.html is
  // served as a static asset (public/ → dist/) so no extra rollup input is
  // needed — adding resolve(__dirname,'public/logic.html') as input would
  // violate Vite MPA's root-input expectation and break build when the
  // companion agent hasn't yet written the file.
  appType: 'mpa',
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html') } },
  },
});
