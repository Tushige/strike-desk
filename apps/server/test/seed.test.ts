import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, SEED_LIMIT, isValidSeed } from '@strike-desk/shared/engine';
import { drawSeed, drawSessionId } from '../src/seed';
import type { Harness } from './harness';
import { FIXED_SEEDS, startHarness } from './harness';

/**
 * A new game's seed decides every price of that game, so it must be valid,
 * must never fail to be drawn, and must not be guessable from when the game
 * was made.
 */

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
/** Real milliseconds at pace 1 from `start` to the opening bell of day 1. */
const PRE_BELL_MS = 60_000;
const SAMPLE_MS = 200;

let harness: Harness | null = null;

afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  harness = null;
});

describe('the seed draw', () => {
  it('a thousand draws never throw and every one is a valid seed', () => {
    let highest = 0;
    for (let i = 0; i < 1000; i += 1) {
      const seed = drawSeed();
      expect(isValidSeed(seed)).toBe(true);
      highest = Math.max(highest, seed);
    }
    // A thousand uniform draws all below 2^40 would be a 1 in 2^8000 event: the top bits are in use.
    expect(highest).toBeGreaterThan(2 ** 40);
    expect(highest).toBeLessThan(SEED_LIMIT);
  });

  it('does not follow the clock: with time frozen, the draws still differ', () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
    const frozenAt = Date.now();

    const seeds = new Set(Array.from({ length: 50 }, () => drawSeed()));

    expect(Date.now()).toBe(frozenAt);
    expect(seeds.size).toBeGreaterThanOrEqual(49);
  });
});

describe('the session id draw', () => {
  it('gives 22 characters that are safe in a URL, and never the same twice', () => {
    const ids = Array.from({ length: 50 }, () => drawSessionId());
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('does not give the seed away', async () => {
    harness = await startHarness();
    const client = harness.connect();
    await client.opened();
    client.send(HELLO);
    const lobby = JSON.stringify(await client.nextFrame());
    for (const seed of FIXED_SEEDS) expect(lobby).not.toContain(String(seed));
  });
});

describe('two games made at the same moment', () => {
  it('are two different markets when the real draw is in use', async () => {
    harness = await startHarness({ drawSeed });
    const clients = [harness.connect(), harness.connect()];
    for (const [index, client] of clients.entries()) {
      await client.opened();
      client.send(HELLO);
      await client.nextFrame();
      client.send({ t: 'start', commandId: `start-000${String(index)}`, pace: 1 });
      await client.nextReply();
    }

    // The clock never moved between the two hellos: same `now`, same step.
    harness.clock.advance(PRE_BELL_MS + SAMPLE_MS * 100);
    harness.sample();
    const [first, second] = await Promise.all(clients.map((client) => client.nextFrame()));

    expect(first?.clock).toMatchObject({ phase: 'open', day: 1, priceIndex: 100 });
    expect(second?.clock).toEqual(first?.clock);
    expect(second?.step).toBe(first?.step);
    expect(second?.prices).not.toEqual(first?.prices);
  });
});
