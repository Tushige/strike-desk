import { fileURLToPath } from 'node:url';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { sharedFenceRules } from './packages/shared/eslint.rules.js';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

const typedProjectFiles = ['**/*.ts', '**/*.tsx'];

// recommendedTypeChecked's own rule-setting entries carry no `files` glob of
// their own (they rely on being combined with a scoped parser block), which
// means the plain rule-set would otherwise apply everywhere, including every
// .js/.mjs file in the repo — and then crash on any of them ("a rule which
// requires type information, but don't have parserOptions set ..."), since
// no type info is ever configured for non-TypeScript files. Scope every
// entry that doesn't already carry its own `files` glob to TypeScript files.
const scopedRecommendedTypeChecked = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: config.files ?? typedProjectFiles,
}));

// Config/script files that are never part of a project's tsconfig "include"
// (this file, the per-project bundler configs, and the root scripts) — no
// type info is available for them, so type-checked rules are switched off
// and they get Node globals instead of the per-project browser/node split
// below.
const configFileGlobs = ['**/*.config.{js,ts,mjs}', 'scripts/**/*.mjs'];

export default tseslint.config(
  {
    // Lint only the workspace's own code and root config files; anything else
    // at the repository root is outside this config's scope.
    ignores: [
      '*',
      '!apps',
      '!packages',
      '!scripts',
      '!*.config.js',
      '!*.config.ts',
      '**/dist/**',
      '**/node_modules/**',
      'apps/*/src/generated/**',
    ],
  },
  ...scopedRecommendedTypeChecked,
  {
    files: typedProjectFiles,
    languageOptions: {
      parserOptions: {
        // Files inside packages/shared/src and apps/*/src are covered by a
        // real tsconfig project. These two virtual paths do not exist on
        // disk — they are lint-fences.test.ts's in-memory probe files —
        // and must be let through as single-file "default" projects
        // instead of erroring "not found in any project".
        projectService: {
          allowDefaultProject: [
            'packages/shared/src/__fence_probe__.ts',
            'apps/server/src/__fence_probe__.ts',
          ],
        },
        tsconfigRootDir: repoRoot,
      },
    },
  },
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: configFileGlobs,
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: configFileGlobs,
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // The fence: no `any`, and no inexact/non-deterministic maths or
    // clocks, inside packages/shared source. noInlineConfig refuses an
    // eslint-disable comment from switching a fence off from inside shared.
    files: ['packages/shared/src/**/*.ts'],
    rules: sharedFenceRules,
    linterOptions: {
      noInlineConfig: true,
    },
  },
);
