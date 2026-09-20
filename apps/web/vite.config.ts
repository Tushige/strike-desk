import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { HEALTH_PATH, WS_PATH } from '@strike-desk/shared';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      [WS_PATH]: { target: 'ws://localhost:10000', ws: true },
      [HEALTH_PATH]: 'http://localhost:10000',
    },
  },
});
