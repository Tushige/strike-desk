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

// The web app reads the shared package only through its client-safe entry
// points. The engine entry holds the code that computes a market's future,
// and the repository is public: if it reached the browser bundle, a player
// could work out every price to come.
//
// `paths` is an exact match, so naming the package root there leaves every
// subpath alone. `patterns` follows gitignore rules, so one entry covers the
// engine entry and anything beneath it. (A bare package name in `patterns`
// would also refuse every allowed subpath.)
const SHARED_ENTRY_POINTS =
  "'@strike-desk/shared/protocol', '/money', '/time', '/feed' or '/paths'";
const webSharedImportFence = {
  paths: [
    {
      name: '@strike-desk/shared',
      message: `The shared package has no root entry. Import from ${SHARED_ENTRY_POINTS} instead.`,
    },
  ],
  patterns: [
    {
      group: ['@strike-desk/shared/engine'],
      message: `The engine computes future prices and must never reach the browser. Import from ${SHARED_ENTRY_POINTS} instead; anything else the page needs has to arrive in a frame.`,
    },
  ],
};

// The modules that hold or move live data stay free of React, so that data
// lives outside React state and only `store/hooks.ts` connects the two.
const webDataModules = [
  'apps/web/src/feed/**/*.ts',
  'apps/web/src/store/gameStore.ts',
  'apps/web/src/store/contractRows.ts',
  'apps/web/src/autoStart.ts',
];

const WEB_SOCKET_MESSAGE =
  "Only 'apps/web/src/feed/wsFeed.ts' opens a socket. Read data through the Feed interface from '@strike-desk/shared/feed' instead.";

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
        // real tsconfig project. These three virtual paths do not exist on
        // disk — they are lint-fences.test.ts's in-memory probe files —
        // and must be let through as single-file "default" projects
        // instead of erroring "not found in any project".
        projectService: {
          allowDefaultProject: [
            'packages/shared/src/__fence_probe__.ts',
            'apps/server/src/__fence_probe__.ts',
            'apps/web/src/__fence_probe__.ts',
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
    // The web app, tests and build config included, cannot import the shared
    // package's root or its engine entry.
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', webSharedImportFence],
    },
  },
  {
    // One transport seam: nothing in the web app names the socket constructor...
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    rules: {
      'no-restricted-globals': ['error', { name: 'WebSocket', message: WEB_SOCKET_MESSAGE }],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].map((object) => ({
          object,
          property: 'WebSocket',
          message: WEB_SOCKET_MESSAGE,
        })),
      ],
    },
  },
  {
    // ...except the one feed file, which is that seam.
    files: ['apps/web/src/feed/wsFeed.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    // A later block replaces a rule's options for the files it matches
    // rather than adding to them, so the shared-package fence is repeated
    // here beside the React one.
    files: webDataModules,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: webSharedImportFence.paths,
          patterns: [
            ...webSharedImportFence.patterns,
            {
              group: ['react', 'react-dom'],
              message:
                "Live data stays outside React: this module must not import it. Components read the store through 'apps/web/src/store/hooks.ts'.",
            },
          ],
        },
      ],
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
