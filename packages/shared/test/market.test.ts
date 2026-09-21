import { describe, expect, it } from 'vitest';
import type { Company } from '../src/cast';
import { CAST, MARKET_WOBBLE } from '../src/cast';
import { OPEN_STEPS } from '../src/clock';
import { exactExp } from '../src/exact';
import type { Market } from '../src/market';
import { CONTENT_VERSION, ENGINE_VERSION, boardFor, buildMarket, expectedMove, marketDay, quoteAt, sharePriceAt } from '../src/market';
import { createStream } from '../src/rng';
import { TEST_CAST } from './testCast';

const identity = { seed: 777, engine: ENGINE_VERSION, content: CONTENT_VERSION };
const market = buildMarket(identity);

describe('buildMarket', () => {
  it('builds the identical market from the same identity, and another from another seed', () => {
    expect(buildMarket(identity)).toEqual(market);
    expect(buildMarket({ ...identity, seed: 778 }).days[0]?.paths).not.toEqual(market.days[0]?.paths);
  });

  it('has five days of six paths, each from the opening price to the bell', () => {
    expect(market.days.map((day) => day.day)).toEqual([1, 2, 3, 4, 5]);
    for (const day of market.days) {
      expect(day.paths).toHaveLength(6);
      for (const path of day.paths) {
        expect(path).toHaveLength(OPEN_STEPS + 1);
        for (const price of path) expect(Number.isFinite(price) && price > 0).toBe(true);
      }
    }
  });

  it('opens day 1 at the cast prices and every later day at the last bell', () => {
    CAST.forEach((company) => expect(sharePriceAt(market, 1, 0, company.id)).toBe(company.startPrice));
    for (let day = 2; day <= 5; day += 1) {
      CAST.forEach((company) => expect(sharePriceAt(market, day, 0, company.id)).toBe(sharePriceAt(market, day - 1, OPEN_STEPS, company.id)));
    }
  });

  it('gives each day three headlines, one per trust level, about different companies', () => {
    const ids = new Set<number>();
    for (const day of market.days) {
      expect(day.news.map((item) => item.headline.trust)).toEqual([3, 2, 1]);
      expect(new Set(day.news.map((item) => item.headline.companyId)).size).toBe(3);
      for (const { headline, hidden } of day.news) {
        ids.add(headline.id);
        expect(headline.day).toBe(day.day);
        expect(hidden.revealIndex).toBeGreaterThanOrEqual(175);
        expect(hidden.revealIndex).toBeLessThanOrEqual(350);
        expect(hidden.move).not.toBe(0);
      }
    }
    expect(ids.size).toBe(15);
  });

  it('lands the whole news move at the reveal moment', () => {
    for (const day of market.days) {
      for (const { headline, hidden } of day.news) {
        const before = sharePriceAt(market, day.day, hidden.revealIndex - 1, headline.companyId);
        const after = sharePriceAt(market, day.day, hidden.revealIndex, headline.companyId);
        // One ordinary step moves a price by a fraction of a percent; the news move is several percent.
        expect(Math.abs(Math.log(after / before) - hidden.move)).toBeLessThan(0.01);
        expect(Math.abs(hidden.move)).toBeGreaterThan(0.015);
      }
    }
  });

  it('refuses a day that does not exist', () => {
    expect(() => marketDay(market, 0)).toThrow();
    expect(() => marketDay(market, 6)).toThrow();
    expect(() => sharePriceAt(market, 1, 501, 0)).toThrow();
  });
});

describe('the market identity', () => {
  it('refuses another engine version, naming both', () => {
    const refusal = (): unknown => buildMarket({ ...identity, engine: 'e-other' });
    expect(refusal).toThrow('engine e-other');
    expect(refusal).toThrow(`engine ${ENGINE_VERSION}`);
    expect(() => buildMarket({ ...identity, engine: '' })).toThrow();
  });

  it('refuses another content version, naming both', () => {
    const refusal = (): unknown => buildMarket({ ...identity, content: 'c-other' });
    expect(refusal).toThrow('content c-other');
    expect(refusal).toThrow(`content ${CONTENT_VERSION}`);
  });

  it('builds with the current versions and keeps the identity it was given', () => {
    expect(buildMarket(identity).identity).toEqual({ seed: 777, engine: ENGINE_VERSION, content: CONTENT_VERSION });
  });
});

describe('a passed-in cast', () => {
  const small = buildMarket(identity, { cast: TEST_CAST });

  it('gives one path per company, opening day 1 at that cast\'s prices', () => {
    expect(small.cast).toBe(TEST_CAST);
    for (const day of small.days) expect(day.paths).toHaveLength(4);
    expect(small.days[0]?.paths.map((path) => path[0])).toEqual([100, 50, 20, 200]);
  });

  it('gives each day three headlines about three of its companies', () => {
    for (const day of small.days) {
      const about = day.news.map((item) => item.headline.companyId);
      expect(new Set(about).size).toBe(3);
      for (const companyId of about) expect(companyId).toBeLessThan(4);
    }
  });

  it('builds a board with one entry per company', () => {
    expect(boardFor(small, 1).companies).toHaveLength(4);
  });

  it('is the real cast when none is passed in', () => {
    expect(market.cast).toBe(CAST);
    expect(buildMarket(identity, {})).toEqual(market);
    expect(buildMarket(identity, { cast: CAST.map((company) => ({ ...company })) }).days).toEqual(market.days);
  });

  it('wobbles by 3.5% a day for every stand-in company', () => {
    for (const company of TEST_CAST) {
      const marketPart = company.beta * MARKET_WOBBLE;
      expect(Math.sqrt(marketPart * marketPart + company.ownWobble * company.ownWobble).toPrecision(4)).toBe('0.03500');
    }
  });

  it('refuses a cast it could not draw a day from', () => {
    expect(() => buildMarket(identity, { cast: TEST_CAST.slice(0, 2) })).toThrow();
    expect(() => buildMarket(identity, { cast: TEST_CAST.map((company) => ({ ...company, id: company.id + 1 })) })).toThrow();
    expect(() => buildMarket(identity, { cast: TEST_CAST.map((company) => ({ ...company, rivalId: 4 })) })).toThrow();
    expect(() => buildMarket(identity, { cast: TEST_CAST.map((company) => ({ ...company, startPrice: 0 })) })).toThrow();
  });
});

function marketsFor(firstSeed: number, lastSeed: number): Market[] {
  const markets: Market[] = [];
  for (let seed = firstSeed; seed <= lastSeed; seed += 1) markets.push(buildMarket({ ...identity, seed }));
  return markets;
}

describe('the news move', () => {
  const markets = marketsFor(1, 40);

  it('is a log move: the price is multiplied by the exponential of it', () => {
    for (const each of markets) {
      for (const day of each.days) {
        for (const { headline, hidden } of day.news) {
          const before = sharePriceAt(each, day.day, hidden.revealIndex - 1, headline.companyId);
          const after = sharePriceAt(each, day.day, hidden.revealIndex, headline.companyId);
          // One ordinary step is a log move of about 0.0016, so the news move stands clear of it.
          expect(Math.abs(Math.log(after / before) - hidden.move)).toBeLessThan(0.01);
        }
      }
    }
  });

  it('is not a plain percentage: on a large move the two forms are far apart', () => {
    let largeMoves = 0;
    for (const each of markets) {
      for (const day of each.days) {
        for (const { headline, hidden } of day.news) {
          if (Math.abs(hidden.move) < 0.2) continue;
          largeMoves += 1;
          const before = sharePriceAt(each, day.day, hidden.revealIndex - 1, headline.companyId);
          const after = sharePriceAt(each, day.day, hidden.revealIndex, headline.companyId);
          expect(Math.abs(after / before - (1 + hidden.move))).toBeGreaterThan(0.01);
        }
      }
    }
    if (largeMoves < 5) throw new Error(`only ${largeMoves} large moves in the seed list: too few to tell the two forms apart`);
  });

  it('mirrors: the same move up and then down returns the start price', () => {
    for (const move of [0.05, 0.08, 0.15, 0.3]) {
      const start = 84;
      expect(Math.abs(start * exactExp(move) * exactExp(-move) - start)).toBeLessThan(1e-9);
    }
  });
});

describe('a headline\'s direction', () => {
  const markets = marketsFor(1, 200);

  it('is the way a true headline moves the price, and the opposite of the way a false one does', () => {
    const seen = { upTrue: 0, upFalse: 0, downTrue: 0, downFalse: 0 };
    for (const each of markets) {
      for (const day of each.days) {
        for (const { headline, hidden } of day.news) {
          expect(['up', 'down']).toContain(headline.direction);
          const claimed = headline.direction === 'up' ? 1 : -1;
          expect(Math.sign(hidden.move)).toBe(hidden.wasTrue ? claimed : -claimed);
          seen[`${headline.direction}${hidden.wasTrue ? 'True' : 'False'}`] += 1;
        }
      }
    }
    // The direction alone says nothing about the outcome: each claim comes true and comes false.
    for (const [kind, count] of Object.entries(seen)) expect({ kind, often: count > 100 }).toEqual({ kind, often: true });
  });
});

describe('the daily wobble', () => {
  it('is 3.3% to 3.7% on a quiet day, over the 500 steps the market is open', () => {
    const returns: number[] = [];
    for (const each of marketsFor(1, 60)) {
      for (const day of each.days) {
        day.paths.forEach((path, companyId) => {
          expect(path).toHaveLength(501);
          if (day.news.some((item) => item.headline.companyId === companyId)) return;
          returns.push(Math.log((path[500] ?? NaN) / (path[0] ?? NaN)));
        });
      }
    }
    expect(returns).toHaveLength(60 * 5 * 3);
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / (returns.length - 1);
    const wobble = Math.sqrt(variance);
    expect(wobble).toBeGreaterThan(0.033);
    expect(wobble).toBeLessThan(0.037);
  });
});

describe('the whole-market shocks', () => {
  it('come from a stream of their own, never from a company-numbered price stream', () => {
    const day = marketDay(market, 1);
    const quiet = CAST.find((company) => !day.news.some((item) => item.headline.companyId === company.id));
    if (quiet === undefined) throw new Error('no quiet company on day 1');
    // Rebuild the quiet company's day from the two streams that should feed it.
    const marketRng = createStream(identity.seed, 'marketWide', 1);
    const ownRng = createStream(identity.seed, 'prices', 1, quiet.id);
    const scale = 1 / Math.sqrt(OPEN_STEPS);
    const marketSd = quiet.beta * MARKET_WOBBLE * scale;
    const ownSd = quiet.ownWobble * scale;
    const drift = -0.5 * (marketSd * marketSd + ownSd * ownSd);
    let price = quiet.startPrice;
    for (let k = 1; k <= OPEN_STEPS; k += 1) {
      price *= exactExp(drift + marketSd * marketRng.nextNormal() + ownSd * ownRng.nextNormal());
      expect(Math.abs(sharePriceAt(market, 1, k, quiet.id) / price - 1)).toBeLessThan(1e-9);
    }
  });
});

describe('a move is the whole market\'s times the company\'s sensitivity, plus the company\'s own', () => {
  const scale = 1 / Math.sqrt(OPEN_STEPS);

  /** Six stand-ins, five of one shape and one of another, so every day leaves two of the five quiet. */
  function castOf(shape: (id: number) => Pick<Company, 'beta' | 'ownWobble'>): Company[] {
    return [0, 1, 2, 3, 4, 5].map((id): Company => ({
      id,
      ticker: `TST${id}`,
      name: `Test ${id}`,
      product: 'test things',
      kind: 'toys',
      rivalId: (id + 1) % 6,
      startPrice: 100,
      ...shape(id),
    }));
  }

  /** Two of the first five companies that drew no headline that day. */
  function twoQuiet(each: Market, day: number): [number, number] {
    const data = marketDay(each, day);
    const quiet = [0, 1, 2, 3, 4].filter((id) => !data.news.some((item) => item.headline.companyId === id));
    const [first, second] = quiet;
    if (first === undefined || second === undefined) throw new Error('a day without two quiet companies to compare');
    return [first, second];
  }

  it('gives two quiet companies with no own wobble the same market shocks, each scaled by its sensitivity', () => {
    const cast = castOf((id) => (id === 5 ? { beta: 1, ownWobble: 0.02 } : { beta: 0.5 + id * 0.25, ownWobble: 0 }));
    const each = buildMarket(identity, { cast });
    const paths = marketDay(each, 1).paths;
    // Take the drift out and divide by beta: what is left is the market's own shock, the same for both.
    const shocksOf = (companyId: number): number[] => {
      const company = cast[companyId];
      if (company === undefined) throw new Error('no such company');
      const marketSd = company.beta * MARKET_WOBBLE * scale;
      const drift = -0.5 * marketSd * marketSd;
      const path = paths[companyId] ?? [];
      const shocks: number[] = [];
      for (let k = 1; k <= OPEN_STEPS; k += 1) shocks.push((Math.log((path[k] ?? NaN) / (path[k - 1] ?? NaN)) - drift) / company.beta);
      return shocks;
    };
    const [a, b] = twoQuiet(each, 1);
    const first = shocksOf(a);
    const second = shocksOf(b);
    expect(first).toHaveLength(OPEN_STEPS);
    // A path that never moved would make the comparison below pass for the wrong reason.
    expect(first.some((value) => Math.abs(value) > 1e-6)).toBe(true);
    first.forEach((value, k) => expect(Math.abs(value - (second[k] ?? NaN))).toBeLessThan(1e-9));
  });

  it('does not move two companies together when all they share is the size of their own wobble', () => {
    const cast = castOf((id) => (id === 5 ? { beta: 1, ownWobble: 0.02 } : { beta: 0, ownWobble: 0.035 }));
    const each = buildMarket(identity, { cast });
    const paths = marketDay(each, 1).paths;
    const [a, b] = twoQuiet(each, 1);
    expect(paths[a]?.[0]).toBe(paths[b]?.[0]);
    expect(paths[a]).not.toEqual(paths[b]);
  });
});

describe('the engine version', () => {
  it('is e3', () => {
    expect(ENGINE_VERSION).toBe('e3');
  });
});

describe('expectedMove', () => {
  it('depends on the headline trust level only', () => {
    const day = marketDay(market, 1);
    const quiet = CAST.find((company) => !day.news.some((item) => item.headline.companyId === company.id));
    expect(expectedMove(day, quiet?.id ?? -1)).toBeCloseTo(0.035, 12);
    const bold = day.news.find((item) => item.headline.trust === 1);
    expect(expectedMove(day, bold?.headline.companyId ?? -1)).toBeCloseTo(Math.sqrt(0.035 * 0.035 + 0.15 * 0.15), 12);
  });
});

describe('quoteAt', () => {
  const board = boardFor(market, 2);

  it('is null for an id that is not on the board', () => {
    expect(quoteAt(market, 2, 0, board, 252)).toBeNull();
    expect(quoteAt(market, 2, 0, board, -1)).toBeNull();
    expect(quoteAt(market, 2, 0, board, 0.5)).toBeNull();
  });

  it('is all real value at the bell', () => {
    for (let id = 0; id < 252; id += 1) {
      const quote = quoteAt(market, 2, OPEN_STEPS, board, id);
      expect(quote?.hopeCents).toBe(0);
      expect(quote?.priceCents).toBe(quote?.realCents);
    }
  });

  it('drops the news uncertainty from the price at the reveal moment', () => {
    const { headline, hidden } = marketDay(market, 2).news[2] ?? { headline: undefined, hidden: undefined };
    if (headline === undefined) throw new Error('no headline');
    // The contract whose target is the opening price: almost all hope value.
    const id = (headline.companyId * 21 + 10) * 2;
    const hopeBefore = quoteAt(market, 2, hidden.revealIndex - 1, board, id)?.hopeCents ?? NaN;
    const hopeAfter = quoteAt(market, 2, hidden.revealIndex, board, id)?.hopeCents ?? NaN;
    expect(hopeBefore).toBeGreaterThan(0);
    expect(hopeAfter).toBeLessThan(hopeBefore);
  });
});
