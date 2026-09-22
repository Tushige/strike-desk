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
  'apps/web/src/store/gameStore.ts',
  'apps/web/src/store/contractRows.ts',
];

const reactFreeGroup = {
  group: ['react', 'react-dom'],
  message:
    "Live data stays outside React: this module must not import it. Components read the store through 'apps/web/src/store/hooks.ts'.",
};

// A building block is built and tested on its own, against its ports. It is
// not part of the running game, so it may not reach into it: importing any
// of these would open a socket and start a real game from a test that is
// supposed to talk to nothing.
const webBlockFiles = [
  'apps/web/src/modules/**/*.ts',
  'apps/web/src/modules/**/*.tsx',
  'apps/web/src/fixtures/**/*.ts',
];

// The running game is boot (the one connection), the store, the screens and
// App. `**/feed` also matches the package path `@strike-desk/shared/feed` —
// the Feed interface a block is built against. The negation lets that one
// path back in; it works here because no pattern above it excludes a parent
// of it, and gitignore rules cannot re-include anything under an excluded
// parent.
const runningGameGroup = {
  group: [
    '**/boot',
    '**/store',
    '**/store/**',
    '**/screens',
    '**/screens/**',
    '**/feed',
    '**/feed/**',
    '!@strike-desk/shared/feed',
    '**/App',
  ],
  message:
    'A building block never reaches the running game: no boot, no store, no App. A block is built against its port and tested against its stand-in source.',
};

// The group above never sees a dynamic `import()`: no-restricted-imports
// visits import and export declarations and nothing else, so a block could
// otherwise reach the running game through `import('../boot')`.
//
// The same names as the group above, read off the text of the specifier: a
// relative path whose last step is boot or App; a relative path
// with a store or screens step anywhere in it; and the shared package's engine
// entry. Whole steps only, so `../feeds/x` and `../my-store/x` are somebody
// else's folders and are left alone — as are the shared package's client-safe
// entry points, `@strike-desk/shared/feed` (the interface a block is built
// against) included, since those are not relative paths.
const RUNNING_GAME_SPECIFIER = String.raw`^\.{1,2}\/(?:.*\/)?(?:boot|App)(?:\.[jt]sx?)?$|^\.{1,2}\/(?:.*\/)?(?:store|screens)(?:\/|$)|^@strike-desk\/shared\/engine(?:\/|$)`;

const runningGameDynamicImport = {
  selector: `ImportExpression > Literal[value=/${RUNNING_GAME_SPECIFIER}/]`,
  message: runningGameGroup.message,
};

// Matched as a regular expression rather than by the gitignore rules the
// other groups use, because this fence has to say "into that folder, and no
// further". A gitignore pattern always matches everything beneath what it
// matches, so `../*/*` also swallows `../../fixtures/probe` and
// `../../modules/other/index` — and a negation cannot let those back in,
// since nothing under an excluded parent can be re-included.
//
// Read left to right: a path that climbs out of the file's own folder
// (`../`, however many), optionally through a `modules/` step, into some
// named folder — and then anything at all except that folder's `index` or
// `fake`, with or without an extension. It says nothing about how deep the
// file doing the importing sits, so it reads the same from a block, from a
// stand-in source and from a test.
//
// It is text, not resolved paths, so it has to be told which folders are not
// blocks: `fixtures/` is the one folder a block legitimately reaches
// sideways into, and a further `../` is a climb that has not landed yet. A
// second such folder has to be added here.
const siblingBlockGroup = {
  regex: String.raw`^(?:\.\./)+(?:modules/)?(?!\.\.|fixtures/|modules/)[^/]+/(?!(?:index|fake)(?:\.[jt]sx?)?$)`,
  message:
    'Import another block only through its index.ts (or its fake.ts from a test), never its inner files.',
};

const WEB_SOCKET_MESSAGE =
  "Only 'apps/web/src/boot.ts' names the socket constructor; it hands it to the connection through its transport seam. Read data through the Feed interface from '@strike-desk/shared/feed' instead.";

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
    // ...except boot, which hands the constructor to the connection's seam.
    files: ['apps/web/src/boot.ts'],
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
          patterns: [...webSharedImportFence.patterns, reactFreeGroup],
        },
      ],
    },
  },
  {
    // A block is fenced off from the running game, and from every other
    // other's inner files. The shared-package fence is repeated here because
    // a later block replaces a rule's options rather than adding to them.
    files: webBlockFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: webSharedImportFence.paths,
          patterns: [...webSharedImportFence.patterns, runningGameGroup, siblingBlockGroup],
        },
      ],
      'no-restricted-syntax': ['error', runningGameDynamicImport],
    },
  },
  {
    // The connection and every stand-in data source live outside React, like
    // every other module that holds or moves data. Both fences are repeated
    // whole, for the same reason: a later block replaces a rule's options
    // rather than adding to them, so anything left out here is lost for
    // these files.
    files: ['apps/web/src/modules/connection/**/*.ts', 'apps/web/src/modules/*/fake.ts', 'apps/web/src/fixtures/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: webSharedImportFence.paths,
          patterns: [...webSharedImportFence.patterns, runningGameGroup, siblingBlockGroup, reactFreeGroup],
        },
      ],
      'no-restricted-syntax': ['error', runningGameDynamicImport],
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
