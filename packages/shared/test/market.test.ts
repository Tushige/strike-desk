import { describe, expect, it } from 'vitest';
import { CAST, MARKET_WOBBLE } from '../src/cast';
import { OPEN_STEPS } from '../src/clock';
import { exactExp } from '../src/exact';
import type { Market } from '../src/market';
import { ENGINE_VERSION, boardFor, buildMarket, expectedMove, marketDay, quoteAt, sharePriceAt } from '../src/market';
import { createStream } from '../src/rng';

const identity = { seed: 777, engine: 'e-test', content: 'c-test' };
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

describe('the engine version', () => {
  it('is e2', () => {
    expect(ENGINE_VERSION).toBe('e2');
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
