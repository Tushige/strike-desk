import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { HEALTH_PATH, WS_PATH } from '@strike-desk/shared/paths';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
      },
    },
  },
  server: {
    proxy: {
      [WS_PATH]: { target: 'ws://localhost:10000', ws: true },
      [HEALTH_PATH]: 'http://localhost:10000',
    },
  },
});
