import { describe, expect, it } from 'vitest';
import { buildCompanyBoard, contractCount } from '../src/board';
import { normCdf } from '../src/exact';
import { CONTENT_VERSION, ENGINE_VERSION, boardFor, buildMarket, quoteAt, sharePriceAt } from '../src/market';
import { centsToDollars, ticketPriceCents } from '../src/money';
import { MIN_TICKET_PRICE_CENTS, QUIET_MARKUP, isTradable, priceTicket } from '../src/pricing';
import type { Side } from '../src/protocol';
import { decodeContractId } from '../src/protocol';

const SIDES: Side[] = ['up', 'down'];
const SEEDS = [4242, 77, 198765432123456];
const DAYS_OF_A_GAME = [1, 2, 3, 4, 5];
const BELL = 500;

describe('priceTicket', () => {
  it('is never NaN, never negative and always whole dollars', () => {
    for (const side of SIDES) {
      for (const price of [0.01, 28, 84, 150, 400]) {
        for (const target of [0.01, 27, 84, 151, 1000]) {
          for (const varianceLeft of [0, 1e-12, 0.0001, 0.001225, 0.03, 1]) {
            const value = priceTicket({ price, target, side, varianceLeft, markup: 1.2 });
            for (const cents of [value.priceCents, value.realCents, value.hopeCents]) {
              expect(Number.isInteger(cents)).toBe(true);
              expect(cents).toBeGreaterThanOrEqual(0);
              expect(cents % 100).toBe(0);
            }
            expect(value.realCents + value.hopeCents).toBe(value.priceCents);
          }
        }
      }
    }
  });

  it('equals real value exactly when no uncertainty is left', () => {
    expect(priceTicket({ price: 90, target: 84, side: 'up', varianceLeft: 0, markup: 1.35 })).toEqual({
      priceCents: 60_000,
      realCents: 60_000,
      hopeCents: 0,
    });
    expect(priceTicket({ price: 80.5, target: 84, side: 'down', varianceLeft: 0, markup: 1.1 })).toEqual({
      priceCents: 35_000,
      realCents: 35_000,
      hopeCents: 0,
    });
    expect(priceTicket({ price: 80, target: 84, side: 'up', varianceLeft: 0, markup: 1.2 }).priceCents).toBe(0);
    expect(priceTicket({ price: 90, target: 84, side: 'down', varianceLeft: 0, markup: 1.2 }).priceCents).toBe(0);
  });

  it('matches a known Black-Scholes value when the mark-up is 1', () => {
    // At the money, vol 20%: call = S (2 N(0.1) - 1) = 100 x 0.0796557 = 7.97 a share.
    const value = priceTicket({ price: 100, target: 100, side: 'up', varianceLeft: 0.04, markup: 1 });
    expect(value.priceCents).toBe(79_700);
    expect(priceTicket({ price: 100, target: 100, side: 'down', varianceLeft: 0.04, markup: 1 }).priceCents).toBe(79_700);
  });

  it('makes an UP ticket cheaper and a DOWN ticket dearer as the target rises', () => {
    let previousUp = Infinity;
    let previousDown = -Infinity;
    for (let target = 70; target <= 100; target += 1.5) {
      const up = priceTicket({ price: 84, target, side: 'up', varianceLeft: 0.002, markup: 1.2 }).priceCents;
      const down = priceTicket({ price: 84, target, side: 'down', varianceLeft: 0.002, markup: 1.2 }).priceCents;
      expect(up).toBeLessThanOrEqual(previousUp);
      expect(down).toBeGreaterThanOrEqual(previousDown);
      previousUp = up;
      previousDown = down;
    }
    expect(previousUp).toBeLessThan(priceTicket({ price: 84, target: 70, side: 'up', varianceLeft: 0.002, markup: 1.2 }).priceCents);
  });

  it('shrinks hope value as time runs out', () => {
    for (const side of SIDES) {
      let previous = Infinity;
      for (const varianceLeft of [0.004, 0.002, 0.001, 0.0005, 0.0001, 0]) {
        const hope = priceTicket({ price: 84, target: 85, side, varianceLeft, markup: 1.2 }).hopeCents;
        expect(hope).toBeLessThanOrEqual(previous);
        previous = hope;
      }
      expect(previous).toBe(0);
    }
  });

  it('charges the mark-up on hope only', () => {
    const plain = priceTicket({ price: 90, target: 84, side: 'up', varianceLeft: 0.002, markup: 1 });
    const marked = priceTicket({ price: 90, target: 84, side: 'up', varianceLeft: 0.002, markup: 1.35 });
    expect(marked.realCents).toBe(plain.realCents);
    expect(marked.hopeCents).toBeGreaterThan(plain.hopeCents);
  });
});

describe('isTradable', () => {
  it('needs at least the cheapest tradable price, $5', () => {
    expect(MIN_TICKET_PRICE_CENTS).toBe(500);
    expect(isTradable(499)).toBe(false);
    expect(isTradable(500)).toBe(true);
  });
});

describe('a company with no headline', () => {
  it('carries a mark-up of 1.10 on hope value', () => {
    expect(QUIET_MARKUP).toBe(1.1);
  });

  it('has a tradable DOWN Moonshot at the open on a $58 share and not on a $57 one', () => {
    // The target sits 1.6 expected moves of 3.5% under the opening price, and a whole day's wobble is still to come.
    // Worked by hand: fair value is 7.08% of the share price, so 1.1 x $4.10 = $4.51 shows as $5, and 1.1 x $4.03 = $4.44 as $4.
    const quietDownMoonshot = (price: number, target: number): number =>
      priceTicket({ price, target, side: 'down', varianceLeft: 0.035 * 0.035, markup: QUIET_MARKUP }).priceCents;
    expect(quietDownMoonshot(58, 58 * (1 - 1.6 * 0.035))).toBe(500);
    expect(quietDownMoonshot(57, 57 * (1 - 1.6 * 0.035))).toBe(400);
    expect(isTradable(quietDownMoonshot(58, 58 * (1 - 1.6 * 0.035)))).toBe(true);
    expect(isTradable(quietDownMoonshot(57, 57 * (1 - 1.6 * 0.035)))).toBe(false);
  });

  it('has the same answer on the board itself, where the Moonshot target is a whole cent', () => {
    for (const [price, targetCents, priceCents] of [
      [58, 5475, 500],
      [57, 5381, 400],
    ] as const) {
      const board = buildCompanyBoard(price, 0.035, 21);
      const moonshot = board.targets[board.simpleDown[2]];
      expect(moonshot).toBe(targetCents);
      const value = priceTicket({ price, target: centsToDollars(moonshot ?? NaN), side: 'down', varianceLeft: 0.035 * 0.035, markup: QUIET_MARKUP });
      expect(value).toEqual({ priceCents, realCents: 0, hopeCents: priceCents });
    }
  });
});

describe('the cheapest tradable price', () => {
  it('never lets a ticket that is all hope value trade under its fair value', () => {
    // At the money the fair value has a closed form, S x (2 N(vol / 2) - 1) a share, and the real value is zero.
    // The sweep walks the hope value from under $4.09 to over $20 a ticket in steps of under a cent.
    const share = 100;
    let lowest = Infinity;
    let highest = -Infinity;
    let tradableUnderFiveDollarsOfHope = 0;
    for (let i = 400; i <= 2010; i += 1) {
      const vol = i * 2.5e-6;
      const hopeDollars = 100 * share * (2 * normCdf(vol / 2) - 1);
      lowest = Math.min(lowest, hopeDollars);
      highest = Math.max(highest, hopeDollars);
      const value = priceTicket({ price: share, target: share, side: 'up', varianceLeft: vol * vol, markup: QUIET_MARKUP });
      expect(value.realCents).toBe(0);
      if (!isTradable(value.priceCents)) continue;
      if (hopeDollars < 5) tradableUnderFiveDollarsOfHope += 1;
      expect(centsToDollars(value.priceCents) + 1e-9).toBeGreaterThanOrEqual(hopeDollars);
    }
    expect(lowest).toBeLessThan(4.0909);
    expect(highest).toBeGreaterThan(20);
    // The knife edge is walked, not skipped: hope values of $4.55 to $5 show as $5 and trade.
    expect(tradableUnderFiveDollarsOfHope).toBeGreaterThan(40);
  });

  it('is what keeps the $4 ticket out: $4.09 of hope value shows as $4, under its fair value, and cannot be bought', () => {
    const vol = 1025 * 1e-6;
    const hopeDollars = 100 * 100 * (2 * normCdf(vol / 2) - 1);
    expect(hopeDollars).toBeGreaterThan(4.0);
    expect(hopeDollars).toBeLessThan(4.0909);
    const value = priceTicket({ price: 100, target: 100, side: 'up', varianceLeft: vol * vol, markup: QUIET_MARKUP });
    expect(value.priceCents).toBe(400);
    expect(isTradable(value.priceCents)).toBe(false);
  });
});

describe('every quote of a real market', () => {
  const markets = SEEDS.map((seed) => buildMarket({ seed, engine: ENGINE_VERSION, content: CONTENT_VERSION }));

  it('is real value plus hope value, in whole cents at or above zero, at the open, one step in, mid-day, one step from the bell and at the bell', () => {
    let quotes = 0;
    for (const market of markets) {
      for (const day of DAYS_OF_A_GAME) {
        const board = boardFor(market, day);
        expect(contractCount(board)).toBe(252);
        for (const priceIndex of [0, 1, 250, 499, BELL]) {
          for (let id = 0; id < 252; id += 1) {
            const value = quoteAt(market, day, priceIndex, board, id);
            if (value === null) throw new Error(`contract ${id} has no quote`);
            for (const cents of [value.priceCents, value.realCents, value.hopeCents]) {
              expect(Number.isFinite(cents)).toBe(true);
              expect(Number.isInteger(cents)).toBe(true);
              expect(cents).toBeGreaterThanOrEqual(0);
            }
            expect(value.realCents + value.hopeCents).toBe(value.priceCents);
            quotes += 1;
          }
        }
      }
    }
    expect(quotes).toBe(3 * 5 * 5 * 252);
  });

  it('is its real value exactly at the bell, with no hope value left', () => {
    let paying = 0;
    for (const market of markets) {
      for (const day of DAYS_OF_A_GAME) {
        const board = boardFor(market, day);
        for (let id = 0; id < 252; id += 1) {
          const ref = decodeContractId(board.targetsPerCompany, id);
          const target = centsToDollars(board.companies[ref.companyId]?.targets[ref.targetIndex] ?? NaN);
          const price = sharePriceAt(market, day, BELL, ref.companyId);
          const real = Math.max(0, ref.side === 'up' ? price - target : target - price);
          const value = quoteAt(market, day, BELL, board, id);
          expect(value?.hopeCents).toBe(0);
          expect(value?.priceCents).toBe(ticketPriceCents(100 * real));
          if (real >= 0.5) paying += 1;
        }
      }
    }
    // Both halves are met: tickets that pay and tickets that end at $0.
    expect(paying).toBeGreaterThan(1000);
    expect(paying).toBeLessThan(3 * 5 * 252 - 1000);
  });
});
