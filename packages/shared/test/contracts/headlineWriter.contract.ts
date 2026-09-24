import { beforeAll, describe, expect, it } from 'vitest';
import { CAST } from '../../src/cast';
import { CONTENT_VERSION, ENGINE_VERSION, buildMarket } from '../../src/market';
import type { HeadlineSlot, HeadlineWords, WriteHeadlines } from '../../src/news';
import type { Rng } from '../../src/rng';
import { createStream } from '../../src/rng';

/**
 * What any headline writer must do, and what to build one against.
 *
 * A writer is tried over many whole games. Game `n` is the market of seed
 * `n`: its fifteen slots are read off that market's headlines (the public
 * half only), and its random stream is that game's wording stream, made the
 * way the market makes it.
 *
 * This file is not a test file by itself: a test file names the writer to
 * try and calls `describeHeadlineWriterContract`. It also exports the two
 * stand-ins a writer is built against: `scriptedRng`, a random stream that
 * says exactly what the script says, and `referenceWriter`, the dullest
 * writer that passes.
 */

const TWO_32 = 4294967296;

/**
 * A random stream that returns the listed numbers, each in [0, 1), in order,
 * and throws once they run out. A test of a writer scripts the draws and so
 * knows which headline must come out.
 */
export function scriptedRng(floats: readonly number[]): Rng {
  let used = 0;
  function nextFloat(): number {
    const value = floats[used];
    if (value === undefined) throw new Error('the script ran out of numbers');
    used += 1;
    return value;
  }
  function nextInt(n: number): number {
    return Math.floor(nextFloat() * n);
  }
  return {
    nextFloat,
    nextInt,
    nextU32: () => Math.floor(nextFloat() * TWO_32),
    nextNormal: () => {
      throw new Error('a headline writer has no use for a normal draw');
    },
    pick<T>(items: readonly T[]): T {
      const item = items[nextInt(items.length)];
      if (item === undefined) throw new Error('pick needs a non-empty list');
      return item;
    },
  };
}

/**
 * The dullest writer that keeps every rule: one draw per slot, a source
 * named after the trust level, and a title that carries the slot's id, so no
 * two titles of a game can be alike. Not for players' eyes.
 */
export const referenceWriter: WriteHeadlines = (slots, cast, rng) =>
  slots.map((slot) => {
    const draw = rng.nextInt(1000);
    const title = `${cast[slot.companyId]?.name ?? 'Somebody'} ${slot.direction} story ${slot.id}`;
    return { source: `source-${slot.trust}`, title, body: `${title} (${draw}).` };
  });

/**
 * Projects only public keys by construction: this cannot prove what the market
 * actually passes to its writer. The real handover spy in news.test.ts does that.
 */
export function slotsOfGame(seed: number): HeadlineSlot[] {
  const market = buildMarket({ seed, engine: ENGINE_VERSION, content: CONTENT_VERSION });
  return market.days.flatMap((day) =>
    day.news.map(({ headline }) => ({ id: headline.id, day: headline.day, companyId: headline.companyId, trust: headline.trust, direction: headline.direction })),
  );
}

/** A game's wording stream, made the way the market makes it. */
export function wordingStream(seed: number): Rng {
  return createStream(seed, 'newsWording');
}

interface WrittenGame {
  seed: number;
  slots: HeadlineSlot[];
  /** What the writer gave, or what it threw. */
  result: { words: HeadlineWords[] } | { threw: unknown };
}

export function describeHeadlineWriterContract(name: string, write: WriteHeadlines, options: { games?: number } = {}): void {
  const gameCount = options.games ?? 1000;

  // Every game is written once during suite setup and shared by the cases.
  let memo: WrittenGame[] | null = null;
  function games(): WrittenGame[] {
    if (memo !== null) return memo;
    memo = [];
    for (let seed = 0; seed < gameCount; seed += 1) {
      const slots = slotsOfGame(seed);
      try {
        memo.push({ seed, slots, result: { words: write(slots, CAST, wordingStream(seed)) } });
      } catch (error) {
        memo.push({ seed, slots, result: { threw: error } });
      }
    }
    return memo;
  }

  /** Every game the writer got through, with its words. A writer that threw fails the case that says so, not every case. */
  function written(): { seed: number; slots: HeadlineSlot[]; words: HeadlineWords[] }[] {
    return games().flatMap((game) => ('words' in game.result ? [{ seed: game.seed, slots: game.slots, words: game.result.words }] : []));
  }

  describe(`the headline writer contract: ${name}`, () => {
    // Building 1,000 complete five-day markets is fixture preparation, not
    // part of the "never throws" assertion. Give only this setup a bounded
    // budget for busy CI runners; keep every seed and the normal test timeout.
    beforeAll(() => { games(); }, 30_000);

    it('never throws, in any of the games', () => {
      const threw = games().flatMap((game) => ('threw' in game.result ? [`game ${game.seed}: ${String(game.result.threw)}`] : []));

      expect(threw).toEqual([]);
      expect(games()).toHaveLength(gameCount);
    });

    it('gives one entry per slot: fifteen slots, fifteen entries', () => {
      for (const game of written()) {
        expect(game.slots, `game ${game.seed}`).toHaveLength(15);
        expect(game.words, `game ${game.seed}`).toHaveLength(15);
      }
    });

    it('fills in a source, a title and a body, with no space at either end', () => {
      for (const game of written()) {
        for (const words of game.words) {
          for (const text of [words.source, words.title, words.body]) {
            expect(typeof text, `game ${game.seed}`).toBe('string');
            expect(text.length, `game ${game.seed}`).toBeGreaterThan(0);
            expect(text.trim(), `game ${game.seed}`).toBe(text);
          }
        }
      }
    });

    it('gives the same words for the same slots, cast and stream', () => {
      for (const game of written()) {
        expect(write(game.slots, CAST, wordingStream(game.seed)), `game ${game.seed}`).toEqual(game.words);
      }
    });

    it('keeps earlier days identical when later-day directions change', () => {
      for (const game of written().slice(0, 200)) {
        for (let day = 1; day < 5; day += 1) {
          const laterChanged = game.slots.map((slot) => slot.day <= day ? slot : {
            ...slot, direction: slot.direction === 'up' ? 'down' as const : 'up' as const,
          });
          const prefix = game.slots.filter((slot) => slot.day <= day).length;
          expect(write(laterChanged, CAST, wordingStream(game.seed)).slice(0, prefix), `game ${game.seed}, through day ${day}`)
            .toEqual(game.words.slice(0, prefix));
        }
      }
    });

    it('repeats no title within a game', () => {
      for (const game of written()) {
        const titles = game.words.map((words) => words.title);
        expect(new Set(titles).size, `game ${game.seed}: ${titles.join(' | ')}`).toBe(titles.length);
      }
    });

    it('lets the source set the trust level: no source text is used with two levels', () => {
      const levelOf = new Map<string, number>();
      const clashes: string[] = [];
      for (const game of written()) {
        game.words.forEach((words, index) => {
          const trust = game.slots[index]?.trust;
          if (trust === undefined) return;
          const known = levelOf.get(words.source);
          if (known === undefined) levelOf.set(words.source, trust);
          else if (known !== trust) clashes.push(`game ${game.seed}: "${words.source}" at trust ${known} and ${trust}`);
        });
      }

      expect(clashes).toEqual([]);
      expect(levelOf.size).toBeGreaterThanOrEqual(3);
    });
  });
}
