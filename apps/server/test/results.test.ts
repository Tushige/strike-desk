import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameFor, PROTOCOL_VERSION } from '@strike-desk/shared/engine';
import { completedGame, createResultsService } from '../src/results';
import type { PublicStats, ResultsRepository } from '../src/results';
import { msAtStep, PLAYER, sessionAt } from './contracts/sessionAt';
import { startHarness } from './harness';

const totals: PublicStats = { completedGames: '1', pretendProfitsEarnedCents: '0', netProfitCents: '0',
  bestFinalBalanceCents: '100000000', bestNetProfitCents: '0', purchases: '0' };
const finished = () => frameFor(sessionAt('open').session, PLAYER, msAtStep(4500), { history: false }).session;
const repository = (): ResultsRepository => ({ save: vi.fn(() => Promise.resolve()), stats: vi.fn(() => Promise.resolve(totals)) });

afterEach(() => vi.useRealTimers());

describe('completed game records', () => {
  it('excludes unfinished games and read-only workloads, and never stores the resume token', () => {
    expect(completedGame(sessionAt('open').session)).toBeNull();
    const session = finished();
    expect(completedGame({ ...session, game: { ...session.game, stress: true } })).toBeNull();
    const record = completedGame(session, new Date('2026-09-23T00:00:00Z'));
    expect(record).toMatchObject({ startingCashCents: 100000000, finalCashCents: 100000000, purchases: 0 });
    expect(record?.runId).toHaveLength(64);
    expect(JSON.stringify(record)).not.toContain(session.id);
  });

  it('retries a failed write without blocking and avoids duplicate pending writes', async () => {
    vi.useFakeTimers();
    const repo = repository();
    const save = vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const warn = vi.fn();
    const service = createResultsService(repo, { warn });
    service.completed(finished());
    service.completed(finished());
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
    expect(warn).toHaveBeenCalledTimes(1);
    await service.close();
  });

  it('coalesces stats requests and caches results, including an outage cooldown', async () => {
    let now = 0;
    const repo = repository();
    const stats = vi.spyOn(repo, 'stats');
    const service = createResultsService(repo, { now: () => now });
    await Promise.all([service.stats(), service.stats(), service.stats()]);
    expect(stats).toHaveBeenCalledTimes(1);
    now = 60_001;
    stats.mockRejectedValue(new Error('private database detail'));
    await expect(service.stats()).rejects.toThrow('Stats temporarily unavailable');
    await expect(service.stats()).rejects.toThrow('Stats temporarily unavailable');
    expect(stats).toHaveBeenCalledTimes(2);
    await service.close();
  });

  it('records once after five bells through the real socket/sampler and serves only aggregates', async () => {
    const repo = repository();
    const save = vi.spyOn(repo, 'save');
    const service = createResultsService(repo);
    const harness = await startHarness({ results: service });
    try {
      const client = harness.connect();
      await client.opened();
      client.send({ t: 'hello', v: PROTOCOL_VERSION });
      await client.nextFrame();
      client.send({ t: 'start', commandId: 'analytics-start', pace: 1 });
      await client.nextReply();
      expect(save).not.toHaveBeenCalled();
      harness.clock.advance(880000); // last closing bell, before final summary
      harness.sample();
      await client.nextFrame();
      harness.sample();
      await client.nextFrame();
      expect(save).toHaveBeenCalledTimes(1);
      const response = await fetch(`${harness.baseUrl}/api/stats`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ...totals, currency: 'pretend-USD' });
      expect((await fetch(`${harness.baseUrl}/api/stats`, { method: 'POST' })).status).toBe(405);
      await client.close();
    } finally { await harness.close(); }
  });

  it('returns unavailable rather than invented zeros when storage is absent', async () => {
    const harness = await startHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/api/stats`);
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'Stats unavailable' });
    } finally { await harness.close(); }
  });
});
