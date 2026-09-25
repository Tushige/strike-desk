import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// App imports build metadata even when tests run before any build command.
// Prepare both generated files once, before workers load application modules.
execFileSync(
  process.execPath,
  [fileURLToPath(new URL('./scripts/write-version.mjs', import.meta.url))],
  { stdio: 'inherit' },
);

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'apps/*/test/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
    ],
    passWithNoTests: false,
    // The runner hands back an empty string for every stylesheet a test
    // imports, unless told which ones to let through. One test reads the
    // page's stylesheet to check the table's cells against the rules meant
    // for them, and `?raw` means the file exactly as written, nothing
    // processed. This names that one import and nothing else.
    css: { include: [/styles\.css\?raw$/] },
  },
});
