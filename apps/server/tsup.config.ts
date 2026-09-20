import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  noExternal: [/^@strike-desk\//],
  external: ['ws', 'sirv'],
  clean: true,
});
