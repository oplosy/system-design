import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { designApi } from './server/api.ts';

export default defineConfig({
  plugins: [react(), designApi()],
  server: { port: 5180, host: '127.0.0.1' },
  // yaml loads only when an import runs; listing it stops the dev server from reloading the page on first use.
  optimizeDeps: { include: ['yaml'] },
});
