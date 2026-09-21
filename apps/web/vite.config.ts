import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { HEALTH_PATH, WS_PATH } from '@strike-desk/shared/paths';

export default defineConfig({
  plugins: [react()],
  build: {
    // Two pages out of one build: the game at `/`, and the module lab at
    // `/lab`. Each input is named, so a file in `dist/assets` says which page
    // it belongs to. The lab is a page of its own rather than a route inside
    // the game, because the game's page starts a real game the moment its
    // code loads.
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        lab: fileURLToPath(new URL('lab/index.html', import.meta.url)),
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
