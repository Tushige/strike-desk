import { neon } from '@neondatabase/serverless';
import type { PublicStats, ResultsRepository } from './results';

export type StatsEnvironment = 'development' | 'production';

export function createNeonRepository(url: string, environment: StatsEnvironment): ResultsRepository {
  const sql = neon(url);
  const queryOptions = () => ({ fetchOptions: { signal: AbortSignal.timeout(3000) } });
  return {
    async save(game) {
      await sql.query(`INSERT INTO completed_games
        (environment, run_id, completed_at, engine_version, content_version, pace,
         starting_cash_cents, final_cash_cents, purchases)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (environment, run_id) DO NOTHING`,
      [environment, game.runId, game.completedAt, game.engineVersion, game.contentVersion,
        game.pace, game.startingCashCents, game.finalCashCents, game.purchases], queryOptions());
    },
    async stats() {
      const rows: unknown = await sql.query(`SELECT
        count(*)::text AS "completedGames",
        coalesce(sum(greatest(final_cash_cents - starting_cash_cents, 0)), 0)::text AS "pretendProfitsEarnedCents",
        coalesce(sum(final_cash_cents - starting_cash_cents), 0)::text AS "netProfitCents",
        max(final_cash_cents)::text AS "bestFinalBalanceCents",
        max(final_cash_cents - starting_cash_cents)::text AS "bestNetProfitCents",
        coalesce(sum(purchases), 0)::text AS purchases
        FROM completed_games WHERE environment = $1`, [environment], queryOptions());
      // The query fixes this shape; keep the driver's untyped rows out of callers.
      return (rows as PublicStats[])[0]!;
    },
  };
}
