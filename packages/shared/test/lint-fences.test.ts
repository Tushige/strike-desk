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
  { name: '** operator', code: 'void (2 ** 3);', ruleId: 'no-restricted-syntax' },
  {
    name: 'any type',
    code: '((probeArg: any) => probeArg)(1);',
    ruleId: '@typescript-eslint/no-explicit-any',
  },
];

const probeSource = `${probes.map((probe) => probe.code).join('\n')}\n`;

// Type-aware linting builds a real TypeScript program per unique file path
// the first time it sees it, which is slow relative to Vitest's 5s default.
const LINT_TIMEOUT_MS = 30000;

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
