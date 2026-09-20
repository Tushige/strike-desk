import { describe, expect, it } from 'vitest';
import { CAST } from '../src/cast';
import { OPEN_STEPS } from '../src/clock';
import { boardFor, buildMarket, expectedMove, marketDay, quoteAt, sharePriceAt } from '../src/market';

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
        expect(Math.abs(after / before - (1 + hidden.move))).toBeLessThan(0.02);
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
