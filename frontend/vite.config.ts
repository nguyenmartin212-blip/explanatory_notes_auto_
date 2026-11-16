import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [{
    name: 'offline-shell',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const assets = ['/', ...Object.keys(bundle).filter((name) => name.startsWith('assets/')).sort().map((name) => `/${name}`)];
        const worker = readFileSync(new URL('./src/features/content/service-worker.js', import.meta.url), 'utf8');
        const version = createHash('sha256').update(JSON.stringify(assets)).update(worker).digest('hex').slice(0, 12);
        this.emitFile({
          type: 'asset',
          fileName: 'service-worker.js',
          source: `const SHELL_CACHE = 'gth-shell-${version}';\nconst SHELL_ASSETS = ${JSON.stringify(assets)};\n${worker}`,
        });
      },
    },
  }],
  server: {
    port: 5173,
    proxy: {
      '^/(?:admin/[^/]|api/|pois(?:[/?]|$)|audio/|localizations/|media/|static/|health(?:/|$)|docs(?:/|$)|openapi[.]json$|warmup$)': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  preview: { host: '127.0.0.1', port: 4173 },
});
