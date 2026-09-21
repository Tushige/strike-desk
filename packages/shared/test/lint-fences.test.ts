import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';

// Drives the real root eslint.config.js (via the ESLint class, not a
// hand-built rule set) so the file scoping that config applies is what is
// actually under test.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sharedProbePath = path.join(repoRoot, 'packages/shared/src/__fence_probe__.ts');
const serverProbePath = path.join(repoRoot, 'apps/server/src/__fence_probe__.ts');

const eslint = new ESLint({ cwd: repoRoot });

async function lint(code: string, filePath: string): Promise<Linter.LintMessage[]> {
  const results = await eslint.lintText(code, { filePath });
  return results[0]?.messages ?? [];
}

interface Probe {
  name: string;
  code: string;
  ruleId: string;
}

// A hardcoded snapshot of every Math member that must be fenced, kept
// independent of packages/shared/eslint.rules.js's own bannedMathMembers
// export on purpose: if a member is ever silently dropped from that list,
// this test must still fail rather than quietly shrinking its own coverage
// to match. This is the same 23-member list bannedMathMembers is built
// from — verified in sync by the "matches the canonical list" test below.
const expectedBannedMathMembers = [
  'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'pow',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'cbrt', 'hypot', 'random',
];

const probes: Probe[] = [
  ...expectedBannedMathMembers.map((member) => ({
    name: `Math.${member}`,
    code: `void Math.${member};`,
    ruleId: 'no-restricted-properties',
  })),
  { name: 'Date.now', code: 'void Date.now;', ruleId: 'no-restricted-properties' },
  { name: 'Date.parse', code: "void Date.parse('x');", ruleId: 'no-restricted-properties' },
  { name: 'new Date()', code: 'void new Date();', ruleId: 'no-restricted-syntax' },
  { name: 'performance', code: 'void performance;', ruleId: 'no-restricted-globals' },
  { name: 'crypto', code: 'void crypto;', ruleId: 'no-restricted-globals' },
  { name: 'toLocaleString', code: 'void (1).toLocaleString();', ruleId: 'no-restricted-syntax' },
  { name: '** operator', code: 'void (2 ** 3);', ruleId: 'no-restricted-syntax' },
  // One line, like every other probe, so the line-index scheme below holds.
  { name: '**= operator', code: 'let probePower = 2; probePower **= 3;', ruleId: 'no-restricted-syntax' },
  {
    name: 'any type',
    code: '((probeArg: any) => probeArg)(1);',
    ruleId: '@typescript-eslint/no-explicit-any',
  },
];

const probeSource = `${probes.map((probe) => probe.code).join('\n')}\n`;

// Type-aware linting builds a real TypeScript program per unique file path
// the first time it sees it, which is slow relative to Vitest's 5s default.
// The first probe inside the web app loads that whole project, the table
// library's type declarations included: thousands of small files, which a
// slow disk takes most of half a minute to read. The limit is only a ceiling.
const LINT_TIMEOUT_MS = 120000;

describe('shared package lint fences', () => {
  it('lint fences: the canonical bannedMathMembers list matches this test\'s expectation', async () => {
    const { bannedMathMembers } = await import('../eslint.rules.js');

    expect(bannedMathMembers).toEqual(expectedBannedMathMembers);
  });

  it(
    'lint fences: flags every banned construct inside shared, with the expected rule',
    async () => {
      const messages = await lint(probeSource, sharedProbePath);

      probes.forEach((probe, index) => {
        const lineNumber = index + 1;
        const lineMessages = messages.filter((message) => message.line === lineNumber);
        expect(lineMessages.length, `expected a fence message for ${probe.name}`).toBeGreaterThan(0);
        expect(
          lineMessages.some((message) => message.ruleId === probe.ruleId),
          `expected rule ${probe.ruleId} for ${probe.name}, got ${lineMessages.map((m) => m.ruleId).join(', ')}`,
        ).toBe(true);
      });
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'lint fences: does not flag the exactly-specified Math members inside shared',
    async () => {
      const controlSource = [
        'void Math.sqrt(4);',
        'void Math.abs(-1);',
        'void Math.floor(1.5);',
        'void Math.imul(2, 3);',
      ].join('\n');

      const messages = await lint(controlSource, sharedProbePath);
      const fenceMessages = messages.filter((message) => message.ruleId === 'no-restricted-properties');

      expect(fenceMessages).toHaveLength(0);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'lint fences: does not flag Date.now outside shared, where the fence is not scoped',
    async () => {
      const messages = await lint('void Date.now();', serverProbePath);
      const fenceMessages = messages.filter((message) => message.ruleId === 'no-restricted-properties');

      expect(fenceMessages).toHaveLength(0);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'lint fences: does not flag new Date() outside shared, where the fence is not scoped',
    async () => {
      const lines = ['void new Date();', "void Date.parse('x');", 'void (1).toLocaleString();'];

      expect(await linesReported(lines, serverProbePath, 'no-restricted-syntax')).toEqual([]);
      expect(await linesReported(lines, serverProbePath, 'no-restricted-properties')).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'lint fences: an inline eslint-disable comment inside shared does not silence a fence',
    async () => {
      const source = ['// eslint-disable-next-line no-restricted-properties', 'void Math.random;'].join('\n');

      const messages = await lint(source, sharedProbePath);
      const fenceMessages = messages.filter(
        (message) => message.ruleId === 'no-restricted-properties' && message.line === 2,
      );

      expect(fenceMessages.length).toBeGreaterThan(0);
    },
    LINT_TIMEOUT_MS,
  );
});

// The web app may read the shared package only through its client-safe
// entry points. Each case is one line of source linted as if it were the
// named file, through the same root config `pnpm run lint` uses.
const webProbePath = path.join(repoRoot, 'apps/web/src/__fence_probe__.ts');
const webFeedPath = path.join(repoRoot, 'apps/web/src/feed/wsFeed.ts');
const webDecodePath = path.join(repoRoot, 'apps/web/src/feed/decode.ts');
const webStorePath = path.join(repoRoot, 'apps/web/src/store/gameStore.ts');
const webAutoStartPath = path.join(repoRoot, 'apps/web/src/autoStart.ts');
const webHooksPath = path.join(repoRoot, 'apps/web/src/store/hooks.ts');
const webTestPath = path.join(repoRoot, 'apps/web/test/feed.test.ts');
const webBlockPath = path.join(repoRoot, 'apps/web/src/modules/connection/ports.ts');
const webBlockFakePath = path.join(repoRoot, 'apps/web/src/modules/connection/fake.ts');
const webLabPath = path.join(repoRoot, 'apps/web/src/lab/modules/connection.lab.ts');

// Hardcoded on purpose, like the Math list above: the fence is checked
// against what the web app is meant to reach, not against the config's own
// lists, so an entry quietly dropped from the config fails here.
const allowedWebImports = [
  '@strike-desk/shared/paths',
  '@strike-desk/shared/protocol',
  '@strike-desk/shared/money',
  '@strike-desk/shared/time',
  '@strike-desk/shared/feed',
];
const bannedWebImports = [
  '@strike-desk/shared',
  '@strike-desk/shared/engine',
  '@strike-desk/shared/engine/market',
];

/** The 1-based lines of `lines` on which `ruleId` reported something. */
async function linesReported(lines: string[], filePath: string, ruleId: string): Promise<number[]> {
  const messages = await lint(`${lines.join('\n')}\n`, filePath);
  // A probe that could not be parsed reports no rule at all, which would
  // read as "nothing refused": make that a failure instead.
  expect(messages.filter((message) => message.fatal === true)).toEqual([]);
  const reported = messages.filter((message) => message.ruleId === ruleId).map((message) => message.line);
  return [...new Set(reported)].sort((a, b) => a - b);
}

const everyLine = (lines: string[]): number[] => lines.map((_line, index) => index + 1);

describe('web app lint fences', () => {
  it('web fences: the shared package manifest offers the allowed entry points, the engine, and no root', async () => {
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(path.join(repoRoot, 'packages/shared/package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    const offered = Object.keys(manifest.exports).map((subpath) => path.posix.join('@strike-desk/shared', subpath));

    expect(offered.sort()).toEqual([...allowedWebImports, '@strike-desk/shared/engine'].sort());
    expect(manifest.exports['./engine']).toBe('./src/index.ts');
  });

  it(
    'web fences: refuses the package root and the engine, as a value, a type or a bare import',
    async () => {
      const lines = [
        ...bannedWebImports.map((name) => `import '${name}';`),
        "import { buildMarket } from '@strike-desk/shared/engine';",
        "import type { Market } from '@strike-desk/shared/engine';",
        "import * as everything from '@strike-desk/shared';",
        "export { buildMarket as leaked } from '@strike-desk/shared/engine';",
        "export * from '@strike-desk/shared';",
      ];

      expect(await linesReported(lines, webProbePath, 'no-restricted-imports')).toEqual(everyLine(lines));
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'web fences: leaves the five client-safe entry points alone',
    async () => {
      const lines = allowedWebImports.map((name) => `import '${name}';`);

      expect(await linesReported(lines, webProbePath, 'no-restricted-imports')).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'web fences: the engine is refused in the web app\'s tests too',
    async () => {
      const lines = bannedWebImports.map((name) => `import '${name}';`);

      expect(await linesReported(lines, webTestPath, 'no-restricted-imports')).toEqual(everyLine(lines));
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'web fences: the server may import the engine',
    async () => {
      const lines = ["import '@strike-desk/shared/engine';", "import '@strike-desk/shared/protocol';"];

      expect(await linesReported(lines, serverProbePath, 'no-restricted-imports')).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'web fences: refuses the name WebSocket everywhere in the web app but the one feed file',
    async () => {
      const globalLines = ['void WebSocket;', "void new WebSocket('ws://example.test');"];
      const memberLines = ['void window.WebSocket;', 'void globalThis.WebSocket;', 'void self.WebSocket;'];

      for (const filePath of [webProbePath, webDecodePath, webStorePath]) {
        expect(await linesReported(globalLines, filePath, 'no-restricted-globals')).toEqual(everyLine(globalLines));
        expect(await linesReported(memberLines, filePath, 'no-restricted-properties')).toEqual(everyLine(memberLines));
      }
      expect(await linesReported(globalLines, webFeedPath, 'no-restricted-globals')).toEqual([]);
      expect(await linesReported(memberLines, webFeedPath, 'no-restricted-properties')).toEqual([]);
    },
    LINT_TIMEOUT_MS * 2,
  );

  it(
    'web fences: refuses React in the feed, the store and the auto-start module, and nowhere else',
    async () => {
      const lines = ["import 'react';", "import { useState } from 'react';", "import 'react-dom';", "import 'react-dom/client';"];

      for (const filePath of [webStorePath, webFeedPath, webDecodePath, webAutoStartPath]) {
        expect(await linesReported(lines, filePath, 'no-restricted-imports')).toEqual(everyLine(lines));
      }
      expect(await linesReported(lines, webHooksPath, 'no-restricted-imports')).toEqual([]);
      expect(await linesReported(lines, webProbePath, 'no-restricted-imports')).toEqual([]);
    },
    LINT_TIMEOUT_MS * 2,
  );

  it(
    'web fences: the React rule does not loosen the engine rule in the files it covers',
    async () => {
      const banned = bannedWebImports.map((name) => `import '${name}';`);
      const allowed = allowedWebImports.map((name) => `import '${name}';`);

      for (const filePath of [webStorePath, webFeedPath, webAutoStartPath]) {
        expect(await linesReported([...banned, ...allowed], filePath, 'no-restricted-imports')).toEqual(everyLine(banned));
      }
    },
    LINT_TIMEOUT_MS * 2,
  );

  it(
    'web fences: a block, its stand-in source and the lab may import the shared Feed interface, but not the page\'s own feed',
    async () => {
      // The running-game fence names '**/feed' for the page's socket feed at
      // 'apps/web/src/feed/'. That pattern also reads the package path
      // '@strike-desk/shared/feed' — the Feed interface every block is built
      // against — so the two are pinned apart here.
      const allowed = [
        "import type { Feed } from '@strike-desk/shared/feed';",
        "import type { Frame } from '@strike-desk/shared/protocol';",
      ];
      const refused = [
        "import '../../feed/wsFeed';",
        "import '../../feed';",
        "import '../../feed/index';",
        "import '../../boot';",
        "import '../../store/hooks';",
        "import '../../autoStart';",
        "import '../../App';",
      ];

      // Every path is two steps up from each of these files, so one list of
      // lines reads the same from all three.
      for (const filePath of [webBlockPath, webBlockFakePath, webLabPath]) {
        expect(await linesReported(allowed, filePath, 'no-restricted-imports')).toEqual([]);
        expect(await linesReported(refused, filePath, 'no-restricted-imports')).toEqual(everyLine(refused));
      }
    },
    LINT_TIMEOUT_MS * 2,
  );

  it(
    'web fences: a dynamic import of the running game is refused from a block, its stand-in and the lab',
    async () => {
      // A block hands the lab its demo as `() => import('…')`, and the import
      // fence never sees a dynamic import: it visits import and export
      // declarations only. So the same names are refused a second time, by
      // shape, or the one import every block writes would pass every fence.
      const refused = [
        "void import('../../boot');",
        "void import('../../store');",
        "void import('../../store/hooks');",
        "void import('../../feed');",
        "void import('../../feed/wsFeed');",
        "void import('../../autoStart');",
        "void import('../../App');",
        "void import('@strike-desk/shared/engine');",
        "void import('@strike-desk/shared/engine/market');",
      ];
      // What a demo actually loads: another block through its public entry or
      // its stand-in source, its own files, and the client-safe entry points.
      const allowed = [
        "void import('../../modules/live-grid');",
        "void import('../../modules/live-grid/index');",
        "void import('../../modules/live-grid/fake');",
        "void import('./fake');",
        "void import('./inner/thing');",
        "void import('@strike-desk/shared/feed');",
        "void import('@strike-desk/shared/protocol');",
      ];

      for (const filePath of [webBlockPath, webBlockFakePath, webLabPath]) {
        expect(await linesReported(refused, filePath, 'no-restricted-syntax')).toEqual(everyLine(refused));
        expect(await linesReported(allowed, filePath, 'no-restricted-syntax')).toEqual([]);
      }
    },
    LINT_TIMEOUT_MS * 2,
  );
});
