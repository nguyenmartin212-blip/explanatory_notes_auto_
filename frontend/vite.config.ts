import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '^/(?:admin/[^/]|api/|poi(?:/|s(?:/|$))|audio/|localizations/|media/|static/|health(?:/|$)|docs(?:/|$)|openapi[.]json$|warmup$)': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
