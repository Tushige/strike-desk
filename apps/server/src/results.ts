import { createHash } from 'node:crypto';
import { DAYS, STARTING_CASH_CENTS } from '@strike-desk/shared/engine';
import type { Session } from '@strike-desk/shared/engine';

export interface CompletedGame {
  runId: string;
  completedAt: string;
  engineVersion: string;
  contentVersion: string;
  pace: number;
  startingCashCents: number;
  finalCashCents: number;
  purchases: number;
}

/** All large totals are decimal strings so JSON cannot round integer cents. */
export interface PublicStats {
  completedGames: string;
  pretendProfitsEarnedCents: string;
  netProfitCents: string;
  bestFinalBalanceCents: string | null;
  purchases: string;
}

export interface ResultsRepository {
  save(game: CompletedGame): Promise<void>;
  stats(): Promise<PublicStats>;
}

/** Five settled days count, even if the player leaves during the last debrief. */
export function completedGame(session: Session, now = new Date()): CompletedGame | null {
  const player = session.game.players[0];
  if (session.game.stress || session.game.pace === null || session.game.players.length !== 1 ||
      player === undefined || player.dayEndCents.length !== DAYS) return null;
  return {
    // Session IDs grant resume access. Persist only a one-way digest, never the token.
    runId: createHash('sha256').update(session.id).digest('hex'),
    completedAt: now.toISOString(),
    engineVersion: session.market.identity.engine,
    contentVersion: session.market.identity.content,
    pace: session.game.pace,
    startingCashCents: STARTING_CASH_CENTS,
    finalCashCents: player.dayEndCents[DAYS - 1]!,
    purchases: player.positions.length,
  };
}

/** Optional persistence: no network request is awaited by the game loop. */
export function createResultsService(repository: ResultsRepository, options: {
  now?: () => number; retryMs?: number; maxPending?: number; warn?: (message: string) => void;
} = {}) {
  const now = options.now ?? Date.now;
  const warn = options.warn ?? console.warn;
  const pending = new Map<string, { game: CompletedGame; nextAttempt: number; failed: boolean; active: boolean }>();
  let closing = false;
  const active = new Set<Promise<void>>();
  let overflowReported = false;

  function flush(): void {
    for (const [id, item] of pending) {
      if (active.size >= 4) break;
      if (item.active || item.nextAttempt > now()) continue;
      item.active = true;
      const task = Promise.resolve().then(() => repository.save(item.game)).then(() => {
        pending.delete(id);
      }, () => {
        if (!item.failed) warn('Completed game persistence failed; queued for retry.');
        item.failed = true;
        item.nextAttempt = now() + 30_000;
      }).finally(() => {
        item.active = false;
        active.delete(task);
        if (!closing) flush();
      });
      active.add(task);
    }
  }
  const timer = setInterval(flush, options.retryMs ?? 5_000);
  timer.unref();

  let cached: { value: PublicStats; until: number } | null = null;
  let reading: Promise<PublicStats> | null = null;
  let retryReadAt = 0;
  return {
    completed(session: Session): void {
      const game = completedGame(session, new Date(now()));
      if (game === null || closing || pending.has(game.runId)) return;
      if (pending.size >= (options.maxPending ?? 1000)) {
        if (!overflowReported) warn('Completed game queue is full; new results cannot be recorded.');
        overflowReported = true;
        return;
      }
      pending.set(game.runId, { game, nextAttempt: 0, failed: false, active: false });
      flush();
    },
    stats(): Promise<PublicStats> {
      if (cached !== null && now() < cached.until) return Promise.resolve(cached.value);
      if (reading !== null) return reading;
      if (now() < retryReadAt) return Promise.reject(new Error('Stats temporarily unavailable'));
      reading = Promise.resolve().then(() => repository.stats()).then(value => {
        cached = { value, until: now() + 60_000 };
        return value;
      }, () => {
        retryReadAt = now() + 10_000;
        throw new Error('Stats temporarily unavailable');
      }).finally(() => { reading = null; });
      return reading;
    },
    async close(): Promise<void> {
      closing = true;
      clearInterval(timer);
      // One bounded final batch. The driver times each request out after 3 seconds.
      for (const item of pending.values()) item.nextAttempt = 0;
      flush();
      await Promise.all(active);
      if (pending.size > 0) warn(`${String(pending.size)} completed game results remain unsaved at shutdown.`);
    },
  };
}

export type ResultsService = ReturnType<typeof createResultsService>;
