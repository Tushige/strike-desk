import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createNeonRepository } from '../src/neon';
import type { CompletedGame } from '../src/results';

let database: PGlite;
// Exercise repository SQL with a real Postgres engine, without a cloud credential.
vi.mock('@neondatabase/serverless', () => ({ neon: () => ({
  query: async (sql: string, values: unknown[]) => (await database.query(sql, values)).rows,
}) }));

beforeAll(async () => {
  database = new PGlite();
  await database.exec(await readFile(new URL('../migrations/001_completed_games.sql', import.meta.url), 'utf8'));
}, 30_000);
afterAll(async () => { await database.close(); });

const game = (id: string, finalCashCents: number): CompletedGame => ({
  runId: id.repeat(64), completedAt: '2026-09-23T00:00:00Z', engineVersion: 'e4', contentVersion: 'c3',
  pace: 3, startingCashCents: 100000000, finalCashCents, purchases: 3,
});

describe('Neon repository SQL', () => {
  it('separates environments and distinguishes gross positive profits, net profit and starting money', async () => {
    const development = createNeonRepository('unused', 'development');
    const production = createNeonRepository('unused', 'production');
    expect(await production.stats()).toEqual({ completedGames: '0', pretendProfitsEarnedCents: '0',
      netProfitCents: '0', bestFinalBalanceCents: null, purchases: '0' });
    await development.save(game('a', 999999999));
    await production.save(game('a', 120000000));
    await production.save(game('b', 90000000));
    await production.save(game('c', 100000000));
    // A retry, even with different values, must never overwrite or double count.
    await production.save(game('a', 500000000));
    expect(await production.stats()).toEqual({ completedGames: '3', pretendProfitsEarnedCents: '20000000',
      netProfitCents: '10000000', bestFinalBalanceCents: '120000000', purchases: '9' });
  });

  it('preserves sums beyond JavaScript safe integer precision', async () => {
    const repo = createNeonRepository('unused', 'development');
    await repo.save(game('d', Number.MAX_SAFE_INTEGER));
    await repo.save(game('e', Number.MAX_SAFE_INTEGER));
    const expected = 2n * (BigInt(Number.MAX_SAFE_INTEGER) - 100000000n) + 899999999n;
    expect((await repo.stats()).pretendProfitsEarnedCents).toBe(String(expected));
  });
});
