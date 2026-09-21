import { describe, expect, it } from 'vitest';
import { quoteDraft } from '../src/draft';
import type { Frame } from '../src/protocol';
import { draftViewSchema } from '../src/protocol';

/**
 * Every expected number here was worked out by hand from the inputs below and
 * typed in. One company, three targets, so six tickets:
 *
 *   id 0  UP   on $83.00   $200 a ticket
 *   id 1  DOWN on $83.00     $3
 *   id 2  UP   on $85.00   $118
 *   id 3  DOWN on $85.00    $45
 *   id 4  UP   on $87.00    $25
 *   id 5  DOWN on $87.00     $0  (no price)
 *
 * A ticket is 100 shares. At the bell it pays 100 times how far the share
 * price finished past its target, in whole dollars.
 *
 * The targets are $2.00 apart, so a what-if table ends $2.00 past its
 * break-even: above it for UP, below it for DOWN.
 */
const BOARD: NonNullable<Frame['board']> = {
  targetsPerCompany: 3,
  companies: [{ targets: [8300, 8500, 8700], simpleUp: [0, 1, 2], simpleDown: [0, 1, 2], lowestUpIndex: 0, highestDownIndex: 2 }],
};
const QUOTES = [20000, 300, 11800, 4500, 2500, 0];
const SPEND = 5_000_000;

/**
 * $50,000 on each ticket: 250 x $200, 16,666 x $3, 423 x $118, 1,111 x $45,
 * 2,000 x $25, and nothing where there is no price.
 */
const COSTS = [5_000_000, 4_999_800, 4_991_400, 4_999_500, 5_000_000, 0];

describe('quoteDraft', () => {
  it('quotes an UP ticket: 423 tickets at $118, a limit of $120.36, break-even at $86.18', () => {
    // Limit: 2% of $118 is $2.36, more than $1. Break-even: $85 plus $118 / 100.
    // At $87.00 each ticket pays 100 x $2 = $200: 423 x $200 = $84,600, less the $49,914 cost.
    // One gap past the break-even, at $88.18, each pays 100 x $3.18 = $318: 423 x $318 = $134,514, less the cost.
    expect(quoteDraft({ contractId: 2, spendCents: SPEND }, BOARD, QUOTES)).toEqual({
      contractId: 2,
      spendCents: 5_000_000,
      costs: COSTS,
      ticket: {
        contractId: 2,
        priceCents: 11800,
        quantity: 423,
        costCents: 4_991_400,
        limitPriceCents: 12_036,
        breakEvenCents: 8618,
        whatIf: [
          { atCents: 8300, profitCents: -4_991_400 },
          { atCents: 8500, profitCents: -4_991_400 },
          { atCents: 8618, profitCents: 0 },
          { atCents: 8700, profitCents: 3_468_600 },
          { atCents: 8818, profitCents: 8_460_000 },
        ],
      },
    });
  });

  it('quotes a DOWN ticket: 1,111 tickets at $45, a limit of $46, break-even at $84.55', () => {
    // Limit: 2% of $45 is 90 cents, so the $1 floor decides. Break-even: $85 minus $45 / 100.
    // At $83.00 each ticket pays 100 x $2 = $200: 1,111 x $200 = $222,200, less the $49,995 cost.
    // One gap past the break-even, at $82.55, each pays 100 x $2.45 = $245: 1,111 x $245 = $272,195, less the cost.
    const quote = quoteDraft({ contractId: 3, spendCents: SPEND }, BOARD, QUOTES);
    expect(quote?.costs).toEqual(COSTS);
    expect(quote?.ticket).toEqual({
      contractId: 3,
      priceCents: 4500,
      quantity: 1111,
      costCents: 4_999_500,
      limitPriceCents: 4600,
      breakEvenCents: 8455,
      whatIf: [
        { atCents: 8255, profitCents: 22_220_000 },
        { atCents: 8300, profitCents: 17_220_500 },
        { atCents: 8455, profitCents: 0 },
        { atCents: 8500, profitCents: -4_999_500 },
        { atCents: 8700, profitCents: -4_999_500 },
      ],
    });
  });

  it('an UP ticket on the top target no longer ends at $0: one gap past its break-even it shows a profit', () => {
    // 2,000 tickets at $25 cost $50,000 and break even at $87.25. At $89.25 each
    // pays 100 x $2.25 = $225: 2,000 x $225 = $450,000, less the cost.
    expect(quoteDraft({ contractId: 4, spendCents: SPEND }, BOARD, QUOTES)?.ticket?.whatIf).toEqual([
      { atCents: 8300, profitCents: -5_000_000 },
      { atCents: 8500, profitCents: -5_000_000 },
      { atCents: 8700, profitCents: -5_000_000 },
      { atCents: 8725, profitCents: 0 },
      { atCents: 8925, profitCents: 40_000_000 },
    ]);
  });

  it('a DOWN ticket on the bottom target mirrors it: one gap below its break-even it shows a profit', () => {
    // 16,666 tickets at $3 cost $49,998 and break even at $82.97. At $80.97 each
    // pays 100 x $2.03 = $203: 16,666 x $203 = $3,383,198, less the cost.
    expect(quoteDraft({ contractId: 1, spendCents: SPEND }, BOARD, QUOTES)?.ticket?.whatIf).toEqual([
      { atCents: 8097, profitCents: 333_320_000 },
      { atCents: 8297, profitCents: 0 },
      { atCents: 8300, profitCents: -4_999_800 },
      { atCents: 8500, profitCents: -4_999_800 },
      { atCents: 8700, profitCents: -4_999_800 },
    ]);
  });

  it('no stop is listed twice when the break-even and the stop past it both land on targets', () => {
    // UP on $83.00 at $200: 250 tickets cost $50,000, break even at $85.00 (a
    // target) and the stop past that is $87.00 (a target too). At $87.00 each
    // pays 100 x $4 = $400: 250 x $400 = $100,000, less the cost.
    expect(quoteDraft({ contractId: 0, spendCents: SPEND }, BOARD, QUOTES)?.ticket?.whatIf).toEqual([
      { atCents: 8300, profitCents: -5_000_000 },
      { atCents: 8500, profitCents: 0 },
      { atCents: 8700, profitCents: 5_000_000 },
    ]);
  });

  describe('on a board whose gaps are not all the same', () => {
    /**
     * Twenty-one targets as the game lays them out: evenly spaced in dollars,
     * each rounded to the cent, so the gaps are 76 and 77 cents by turns (the
     * first is 76, the last 77). Top minus bottom is 11,733 - 10,198 = 1,535
     * cents over 20 gaps: 76.75, so the board's gap is 77 cents, for UP and
     * DOWN alike.
     */
    const TARGETS = [10198, 10274, 10351, 10428, 10505, 10581, 10658, 10735, 10812, 10888, 10965, 11042, 11119, 11195, 11272, 11349, 11426, 11502, 11579, 11656, 11733];
    const UNEVEN: NonNullable<Frame['board']> = {
      targetsPerCompany: 21,
      companies: [{ targets: TARGETS, simpleUp: [12, 15, 18], simpleDown: [8, 5, 2], lowestUpIndex: 0, highestDownIndex: 20 }],
    };
    // $25 on every ticket: id 40 is UP on the top target, id 1 is DOWN on the bottom one.
    const PRICES = Array.from({ length: 42 }, () => 2500);

    it('the stop past the break-even is the average gap away, 77 cents, on both sides, so UP and DOWN mirror exactly', () => {
      // Either way 2,000 tickets cost $50,000. UP on $117.33 breaks even at
      // $117.58; 77 cents on is $118.35, $1.02 past the target. DOWN on $101.98
      // breaks even at $101.73; 77 cents below is $100.96, $1.02 past the
      // target. Each ticket pays 100 x $1.02 = $102: 2,000 x $102 = $204,000,
      // less the cost.
      const up = quoteDraft({ contractId: 40, spendCents: SPEND }, UNEVEN, PRICES)?.ticket?.whatIf ?? [];
      const down = quoteDraft({ contractId: 1, spendCents: SPEND }, UNEVEN, PRICES)?.ticket?.whatIf ?? [];
      expect(up).toHaveLength(23);
      expect(up.slice(-2)).toEqual([
        { atCents: 11758, profitCents: 0 },
        { atCents: 11835, profitCents: 15_400_000 },
      ]);
      expect(down).toHaveLength(23);
      expect(down.slice(0, 2)).toEqual([
        { atCents: 10096, profitCents: 15_400_000 },
        { atCents: 10173, profitCents: 0 },
      ]);
    });

    it('every ticket\'s stops are whole cents, strictly ascending, and end one gap past the break-even', () => {
      for (let contractId = 0; contractId < 42; contractId += 1) {
        const ticket = quoteDraft({ contractId, spendCents: SPEND }, UNEVEN, PRICES)?.ticket;
        const stops = (ticket?.whatIf ?? []).map((stop) => stop.atCents);
        expect(stops.every((stop, index) => Number.isInteger(stop) && (index === 0 || stop > (stops[index - 1] ?? NaN)))).toBe(true);
        const past = contractId % 2 === 0 ? (ticket?.breakEvenCents ?? NaN) + 77 : (ticket?.breakEvenCents ?? NaN) - 77;
        expect({ contractId, listed: stops.includes(past) }).toEqual({ contractId, listed: true });
        expect(ticket?.whatIf.find((stop) => stop.atCents === past)?.profitCents).toBeGreaterThan(0);
      }
    });
  });

  it('half a cent of average gap rounds up: targets 29 cents apart over two gaps give 15', () => {
    // Top minus bottom is 29 cents over 2 gaps: 14.5, so the gap is 15. UP on
    // $10.00 at $1 breaks even at $10.01; the stop past it is $10.16.
    const board: NonNullable<Frame['board']> = {
      targetsPerCompany: 3,
      companies: [{ targets: [1000, 1014, 1029], simpleUp: [0, 1, 2], simpleDown: [0, 1, 2], lowestUpIndex: 0, highestDownIndex: 2 }],
    };
    const stops = quoteDraft({ contractId: 0, spendCents: SPEND }, board, [100, 0, 0, 0, 0, 0])?.ticket?.whatIf.map((stop) => stop.atCents);
    expect(stops).toEqual([1000, 1001, 1014, 1016, 1029]);
  });

  it('a board with one target has no gap, so its table ends at the break-even', () => {
    const single: NonNullable<Frame['board']> = {
      targetsPerCompany: 1,
      companies: [{ targets: [8500], simpleUp: [0, 0, 0], simpleDown: [0, 0, 0], lowestUpIndex: 0, highestDownIndex: 0 }],
    };
    expect(quoteDraft({ contractId: 0, spendCents: SPEND }, single, [11800, 4500])?.ticket?.whatIf).toEqual([
      { atCents: 8500, profitCents: -4_991_400 },
      { atCents: 8618, profitCents: 0 },
    ]);
    expect(quoteDraft({ contractId: 1, spendCents: SPEND }, single, [11800, 4500])?.ticket?.whatIf).toEqual([
      { atCents: 8455, profitCents: 0 },
      { atCents: 8500, profitCents: -4_999_500 },
    ]);
  });

  it('a stop is never below a share price of zero', () => {
    // DOWN on $1.00 at $1: 50,000 tickets cost $50,000 and break even at $0.99.
    // The targets are $1.00 apart, and $1.00 below the break-even would be
    // under zero, so the stop is $0.00, where each ticket pays 100 x $1 = $100:
    // 50,000 x $100 = $5,000,000, less the cost.
    const low: NonNullable<Frame['board']> = {
      targetsPerCompany: 3,
      companies: [{ targets: [100, 200, 300], simpleUp: [0, 1, 2], simpleDown: [0, 1, 2], lowestUpIndex: 0, highestDownIndex: 2 }],
    };
    expect(quoteDraft({ contractId: 1, spendCents: SPEND }, low, [0, 100, 0, 0, 0, 0])?.ticket?.whatIf).toEqual([
      { atCents: 0, profitCents: 495_000_000 },
      { atCents: 99, profitCents: 0 },
      { atCents: 100, profitCents: -5_000_000 },
      { atCents: 200, profitCents: -5_000_000 },
      { atCents: 300, profitCents: -5_000_000 },
    ]);
  });

  it('with a ticket chosen and no spend yet: the price, the limit and the break-even, nothing bought and no costs', () => {
    expect(quoteDraft({ contractId: 2, spendCents: null }, BOARD, QUOTES)).toEqual({
      contractId: 2,
      spendCents: null,
      ticket: { contractId: 2, priceCents: 11800, quantity: 0, costCents: 0, limitPriceCents: 12_036, breakEvenCents: 8618, whatIf: [] },
    });
  });

  it('with a spend and no ticket chosen: what the spend would cost on every row, and no ticket', () => {
    expect(quoteDraft({ contractId: null, spendCents: SPEND }, BOARD, QUOTES)).toEqual({ contractId: null, spendCents: 5_000_000, costs: COSTS });
  });

  it('with a ticket that is not on the board: the costs, and no ticket', () => {
    expect(quoteDraft({ contractId: 99, spendCents: SPEND }, BOARD, QUOTES)).toEqual({ contractId: 99, spendCents: 5_000_000, costs: COSTS });
  });

  it('a spend too small for one ticket buys nothing, costs nothing and has no what-if', () => {
    // $100 does not buy one $118 ticket.
    expect(quoteDraft({ contractId: 2, spendCents: 10_000 }, BOARD, QUOTES)?.ticket).toEqual({
      contractId: 2,
      priceCents: 11800,
      quantity: 0,
      costCents: 0,
      limitPriceCents: 12_036,
      breakEvenCents: 8618,
      whatIf: [],
    });
  });

  it('a ticket with no price breaks even at its target, and its what-if never lists that target twice', () => {
    const ticket = quoteDraft({ contractId: 5, spendCents: SPEND }, BOARD, QUOTES)?.ticket;
    expect(ticket).toMatchObject({ priceCents: 0, quantity: 0, costCents: 0, breakEvenCents: 8700, whatIf: [] });
  });

  it('at the largest spend a draft may name, on the cheapest ticket with the richest stop, every number is still an exact whole number', () => {
    // The worst case by construction: a $1 ticket, UP on the lowest target, on a
    // board whose top target is $90.00 higher. $1 billion buys 1,000,000,000
    // tickets. At $490.00 each pays 100 x $90 = $9,000: $9,000,000,000,000 in
    // all, less the $1,000,000,000 cost.
    const wide: NonNullable<Frame['board']> = {
      targetsPerCompany: 3,
      companies: [{ targets: [40_000, 44_500, 49_000], simpleUp: [0, 1, 2], simpleDown: [0, 1, 2], lowestUpIndex: 0, highestDownIndex: 2 }],
    };
    const quote = quoteDraft({ contractId: 0, spendCents: 100_000_000_000 }, wide, [100, 0, 0, 0, 0, 0]);
    expect(quote?.ticket).toMatchObject({ quantity: 1_000_000_000, costCents: 100_000_000_000, breakEvenCents: 40_001 });
    expect(quote?.ticket?.whatIf.find((stop) => stop.atCents === 49_000)).toEqual({ atCents: 49_000, profitCents: 899_900_000_000_000 });
    const numbers = [...(quote?.costs ?? []), ...(quote?.ticket?.whatIf ?? []).flatMap((stop) => [stop.atCents, stop.profitCents])];
    expect(numbers.length).toBeGreaterThan(6);
    expect(numbers.filter((value) => !Number.isSafeInteger(value))).toEqual([]);
    expect(draftViewSchema.parse(quote)).toEqual(quote);
  });

  it('with nothing chosen there is no quote at all', () => {
    expect(quoteDraft({ contractId: null, spendCents: null }, BOARD, QUOTES)).toBeNull();
  });

  it('every quote passes the wire schema unchanged', () => {
    for (const request of [
      { contractId: 2, spendCents: SPEND },
      { contractId: 3, spendCents: SPEND },
      { contractId: 2, spendCents: null },
      { contractId: null, spendCents: SPEND },
      { contractId: 99, spendCents: SPEND },
    ]) {
      const quote = quoteDraft(request, BOARD, QUOTES);
      expect(draftViewSchema.parse(quote)).toEqual(quote);
    }
  });
});
