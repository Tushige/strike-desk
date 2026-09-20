import { describe, expect, it } from 'vitest';
import { MIN_TICKET_PRICE_CENTS, isTradable, priceTicket } from '../src/pricing';
import type { Side } from '../src/protocol';

const SIDES: Side[] = ['up', 'down'];

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
  it('needs at least the minimum ticket price', () => {
    expect(MIN_TICKET_PRICE_CENTS).toBe(1000);
    expect(isTradable(900)).toBe(false);
    expect(isTradable(1000)).toBe(true);
  });
});
