import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareContentRevision } from '../scripts/check-news-content';
import type { ContentRevision } from '../scripts/check-news-content';

function neutral(): ContentRevision {
  const labels = ['lobby', 'day1-before-bell', 'day1-draft', 'day1-bought', 'day1-open',
    'day1-after-reveal', 'day1-cashed-out', 'day1-debrief', 'day2-before-bell',
    'day2-rejected', 'day2-bought', 'day2-held-to-bell', 'final'];
  return {
    market: "export const ENGINE_VERSION = 'engine-a';\nexport const CONTENT_VERSION = 'copy-a';\n",
    pool: 'neutral pool',
    castTest: "const PINNED = { content: 'copy-a', digest: 'cast-digest' };",
    poolTest: "const PINNED = { content: 'copy-a', digest: 'pool-digest' };",
    prices: JSON.stringify({ note: 'keep prices', engine: 'engine-a', content: 'copy-a', seed: 123,
      marketCode: 'market-a', digest: 'a'.repeat(64),
      samples: [{ day: 1, companyId: 0, revealIndex: 4, points: [{ index: 0, bits: '4055000000000000', cents: 8400 }] }] }),
    recording: JSON.stringify({ recordedWith: { protocol: 1, engine: 'engine-a', content: 'copy-a' },
      frames: labels.map((label) => ({ label, frame: {
        protocol: 1, clock: { phase: label === 'final' ? 'final' : 'open', day: 1, step: 2 },
        news: [{ id: 1, companyId: 0, day: 1, trust: 3, direction: 'up',
          source: 'Neutral source', title: 'Neutral title', body: 'Neutral body', revealed: false }],
        prices: [8400], quotes: [200], account: { cashCents: 100000, positions: [{ id: 'p', quantity: 1 }] },
        receipts: [{ outcome: 'accepted' }], history: [[8400]], leadIn: [[8300]],
        ...(label === 'final' ? { final: { engine: 'engine-a', content: 'copy-a', marketCode: 'market-a',
          finalCents: 100000, changeCents: 0 } } : {}),
      } })) }),
    sheet: JSON.stringify({ recordedWith: { content: 'copy-a' }, pool: { sources: {}, situations: [] }, games: [] }),
    transcript: '{"recordedWith":{"protocol":1,"engine":"engine-a"},"entries":[]}\n',
  };
}

function relabel(base: ContentRevision): ContentRevision {
  return Object.fromEntries((Object.keys(base) as (keyof ContentRevision)[])
    .map((key) => [key, base[key].replaceAll('copy-a', 'copy-b')])) as unknown as ContentRevision;
}

function changeJson(revision: ContentRevision, file: 'prices' | 'recording' | 'sheet', path: string[], value: unknown): void {
  const document = JSON.parse(revision[file]) as Record<string, unknown>;
  let parent = document;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  const last = path.at(-1);
  if (last === undefined) throw new Error('missing mutation path');
  parent[last] = value;
  revision[file] = JSON.stringify(document);
}

describe('content-only revision', () => {
  it('rejects a changed price bit even after content relabelling', () => {
    const base = neutral();
    const changed = relabel(base);
    changed.prices = changed.prices.replace('4055000000000000', '4055000000000001');
    expect(compareContentRevision(base, changed)).toContain('prices.samples[0].points[0].bits');
  });

  it('accepts identical documents without mutating the inputs', () => {
    const base = neutral();
    const copy = structuredClone(base);
    expect(compareContentRevision(base, copy)).toEqual([]);
    expect(base).toEqual(copy);
  });

  it('allows only content labels and news words, including every final object', () => {
    const base = neutral();
    changeJson(base, 'recording', ['frames', '11', 'frame', 'final'], {
      engine: 'engine-a', content: 'copy-a', marketCode: 'market-a', finalCents: 100000, changeCents: 0,
    });
    const revised = relabel(base);
    revised.pool = 'new neutral pool';
    for (const field of ['source', 'title', 'body']) {
      changeJson(revised, 'recording', ['frames', '0', 'frame', 'news', '0', field], `New ${field}`);
    }
    const original = structuredClone(revised);
    expect(compareContentRevision(base, revised, true)).toEqual([]);
    expect(revised).toEqual(original);
    changeJson(revised, 'recording', ['frames', '11', 'frame', 'final', 'content'], 'copy-a');
    expect(compareContentRevision(base, revised, true).join('\n')).toContain('frames[11].frame.final.content');
  });

  it.each([
    ['digest', ['digest'], 'b'.repeat(64)], ['seed', ['seed'], 124], ['marketCode', ['marketCode'], 'market-b'],
    ['engine', ['engine'], 'engine-b'], ['note', ['note'], 'rewritten'],
    ['revealIndex', ['samples', '0', 'revealIndex'], 5], ['cents', ['samples', '0', 'points', '0', 'cents'], 8401],
    ['sample index', ['samples', '0', 'points', '0', 'index'], 1], ['company', ['samples', '0', 'companyId'], 1],
  ] as const)('rejects a changed price fixture %s after relabelling', (_name, path, value) => {
    const base = neutral();
    const revised = relabel(base);
    changeJson(revised, 'prices', [...path], value);
    expect(compareContentRevision(base, revised, true).length).toBeGreaterThan(0);
  });

  it.each([
    ['quote', ['quotes', '0'], 201], ['price', ['prices', '0'], 8401],
    ['cash', ['account', 'cashCents'], 100001], ['position', ['account', 'positions', '0', 'quantity'], 2],
    ['receipt', ['receipts', '0', 'outcome'], 'rejected'], ['clock', ['clock', 'step'], 3],
    ['history', ['history', '0', '0'], 8401], ['leadIn', ['leadIn', '0', '0'], 8301],
    ['news id', ['news', '0', 'id'], 2], ['news company', ['news', '0', 'companyId'], 1],
    ['news day', ['news', '0', 'day'], 2], ['news trust', ['news', '0', 'trust'], 1],
    ['news direction', ['news', '0', 'direction'], 'down'], ['news reveal', ['news', '0', 'revealed'], true],
    ['new news field', ['news', '0', 'outcome'], false], ['seed', ['seed'], 456],
  ] as const)('rejects a changed recording %s after relabelling', (_name, path, value) => {
    const base = neutral();
    const revised = relabel(base);
    changeJson(revised, 'recording', ['frames', '0', 'frame', ...path], value);
    expect(compareContentRevision(base, revised, true).length).toBeGreaterThan(0);
  });

  it.each(['engine', 'marketCode', 'finalCents', 'changeCents'])('preserves final.%s', (field) => {
    const base = neutral();
    const revised = relabel(base);
    changeJson(revised, 'recording', ['frames', '12', 'frame', 'final', field], field.endsWith('Cents') ? 1 : 'changed');
    expect(compareContentRevision(base, revised, true).join('\n')).toContain(`final.${field}`);
  });

  it.each(['pool', 'words', 'required change'])('rejects unchanged content identity for %s', (change) => {
    const base = neutral();
    const revised = structuredClone(base);
    if (change === 'pool') revised.pool += ' changed';
    if (change === 'words') changeJson(revised, 'recording', ['frames', '0', 'frame', 'news', '0', 'title'], 'Reworded');
    expect(compareContentRevision(base, revised, change === 'required change').join('\n')).toContain('CONTENT_VERSION');
  });

  it.each(['castTest', 'poolTest', 'prices', 'recording', 'sheet'] as const)('rejects a stale %s label', (file) => {
    const base = neutral();
    const revised = relabel(base);
    revised[file] = base[file];
    expect(compareContentRevision(base, revised, true).join('\n')).toContain(file);
  });

  it.each(['engine', 'logic', 'cast pin', 'cast whitespace', 'transcript', 'frame label', 'frame order', 'missing label', 'malformed'])('rejects %s changes', (change) => {
    const base = neutral();
    const revised = relabel(base);
    if (change === 'engine') revised.market = revised.market.replace('engine-a', 'engine-b');
    if (change === 'logic') revised.market += 'const changed = 1;';
    if (change === 'cast pin') revised.castTest = revised.castTest.replace('cast-digest', 'new-digest');
    if (change === 'cast whitespace') revised.castTest = revised.castTest.replace('{ content', '{  content');
    if (change === 'transcript') revised.transcript += ' ';
    if (change === 'frame label') changeJson(revised, 'recording', ['frames', '0', 'label'], 'renamed');
    if (change === 'frame order') {
      const doc = JSON.parse(revised.recording) as { frames: unknown[] };
      doc.frames.reverse(); revised.recording = JSON.stringify(doc);
    }
    if (change === 'missing label') changeJson(revised, 'recording', ['frames'], []);
    if (change === 'malformed') revised.prices = '{';
    expect(compareContentRevision(base, revised, true).length).toBeGreaterThan(0);
  });
});

const files: Record<keyof ContentRevision, string> = {
  market: 'packages/shared/src/market.ts', pool: 'packages/shared/src/newsPool.ts',
  castTest: 'packages/shared/test/cast.test.ts', poolTest: 'packages/shared/test/news-pool.test.ts',
  prices: 'packages/shared/test/fixtures/price-paths.json', recording: 'apps/web/src/fixtures/recorded-game.json',
  sheet: 'apps/server/test/fixtures/news-engine.sheet.json', transcript: 'apps/server/test/fixtures/command-path.transcript.json',
};
const script = fileURLToPath(new URL('../scripts/check-news-content.ts', import.meta.url));
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

describe('content revision command', () => {
  it('reads an immutable Git baseline and current files, rejects bad input, and never writes', () => {
    const root = mkdtempSync(join(tmpdir(), 'news-content-'));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    const write = (revision: ContentRevision): void => {
      for (const [key, path] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), revision[key as keyof ContentRevision]);
      }
    };
    const run = (...args: string[]) => spawnSync(process.execPath, ['--import', loader, script, ...args], { cwd: root, encoding: 'utf8' });
    try {
      git('init', '--quiet', '--initial-branch=fixture');
      const base = neutral();
      write(base);
      git('add', '--', ...Object.values(files));
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        'commit', '--quiet', '-m', 'fixture');
      const commit = git('rev-parse', 'HEAD').trim();
      expect(run('--base', commit).status).toBe(0);
      expect(run('--base', commit, '--require-change').status).not.toBe(0);
      for (const args of [[], ['--base'], ['--base', 'HEAD'], ['--base', '0'.repeat(40)],
        ['--base', commit, '--unknown'], ['--base', 'HEAD;touch injected']]) {
        expect(run(...args).status, args.join(' ')).not.toBe(0);
      }
      const revised = relabel(base);
      revised.pool += ' changed';
      write(revised);
      const before = git('diff', '--binary');
      expect(run('--base', commit, '--require-change').status).toBe(0);
      expect(git('diff', '--binary')).toBe(before);
      for (const [key, path] of Object.entries(files)) expect(readFileSync(join(root, path), 'utf8')).toBe(revised[key as keyof ContentRevision]);
      changeJson(revised, 'recording', ['frames', '0', 'frame', 'account', 'cashCents'], 5);
      write(revised);
      const rejected = run('--base', commit, '--require-change');
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain('recording.frames[0].frame.account.cashCents');
      write(base);
      writeFileSync(join(root, files.prices), '{');
      expect(run('--base', commit).status).not.toBe(0);
      write(base);
      rmSync(join(root, files.sheet));
      expect(run('--base', commit).status).not.toBe(0);
      git('rm', '--quiet', '--', files.sheet);
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        'commit', '--quiet', '-m', 'missing fixture');
      write(base);
      expect(run('--base', git('rev-parse', 'HEAD').trim()).status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  // This CLI matrix launches many real Node and Git processes. Windows startup dominates it.
  }, process.platform === 'win32' ? 90_000 : 15_000);
});
