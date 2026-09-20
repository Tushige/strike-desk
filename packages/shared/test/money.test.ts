import { describe, expect, it } from 'vitest';
import { centsToDollars, formatCents, quantityForSpend, sharePriceCents, ticketPriceCents, totalCents } from '../src/money';

describe('ticketPriceCents', () => {
  it('rounds to a whole number of dollars, in cents', () => {
    expect(ticketPriceCents(12.49)).toBe(1200);
    expect(ticketPriceCents(12.5)).toBe(1300);
    expect(ticketPriceCents(0.5)).toBe(100);
    expect(ticketPriceCents(1234.56)).toBe(123500);
  });

  it('is always a multiple of 100 cents', () => {
    for (const dollars of [0.01, 0.49, 3.333, 77.7, 99999.999]) {
      expect(ticketPriceCents(dollars) % 100).toBe(0);
    }
  });

  it('is zero for nothing, a negative value or not-a-number', () => {
    expect(ticketPriceCents(0)).toBe(0);
    expect(ticketPriceCents(0.49)).toBe(0);
    expect(ticketPriceCents(-5)).toBe(0);
    expect(ticketPriceCents(NaN)).toBe(0);
  });
});

describe('sharePriceCents', () => {
  it('rounds to the nearest cent', () => {
    expect(sharePriceCents(84)).toBe(8400);
    expect(sharePriceCents(84.004)).toBe(8400);
    expect(sharePriceCents(84.006)).toBe(8401);
    expect(centsToDollars(8401)).toBe(84.01);
  });
});

describe('quantityForSpend', () => {
  it('buys whole tickets only, rounding down', () => {
    expect(quantityForSpend(100_000, 30_000)).toBe(3);
    expect(quantityForSpend(90_000, 30_000)).toBe(3);
    expect(quantityForSpend(89_999, 30_000)).toBe(2);
    expect(quantityForSpend(29_999, 30_000)).toBe(0);
  });

  it('never costs more than the spend', () => {
    for (const [spend, price] of [[5_000_000, 12_300], [777_777, 1_000], [1_000, 1_000]] as const) {
      expect(totalCents(price, quantityForSpend(spend, price))).toBeLessThanOrEqual(spend);
    }
  });

  it('is zero when the price or the spend is not positive', () => {
    expect(quantityForSpend(100_000, 0)).toBe(0);
    expect(quantityForSpend(100_000, -100)).toBe(0);
    expect(quantityForSpend(0, 1_000)).toBe(0);
    expect(quantityForSpend(-1, 1_000)).toBe(0);
  });
});

describe('formatCents', () => {
  it('groups whole dollars and hides empty cents', () => {
    expect(formatCents(100_000_000)).toBe('$1,000,000');
    expect(formatCents(123_456_700)).toBe('$1,234,567');
    expect(formatCents(0)).toBe('$0');
    expect(formatCents(99_900)).toBe('$999');
  });

  it('shows cents when there are any', () => {
    expect(formatCents(1234)).toBe('$12.34');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(100_001)).toBe('$1,000.01');
  });

  it('puts the minus sign before the dollar sign', () => {
    expect(formatCents(-250_000)).toBe('-$2,500');
    expect(formatCents(-1)).toBe('-$0.01');
  });
});
