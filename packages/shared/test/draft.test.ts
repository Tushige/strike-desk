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
        ],
      },
    });
  });

  it('quotes a DOWN ticket: 1,111 tickets at $45, a limit of $46, break-even at $84.55', () => {
    // Limit: 2% of $45 is 90 cents, so the $1 floor decides. Break-even: $85 minus $45 / 100.
    // At $83.00 each ticket pays 100 x $2 = $200: 1,111 x $200 = $222,200, less the $49,995 cost.
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
        { atCents: 8300, profitCents: 17_220_500 },
        { atCents: 8455, profitCents: 0 },
        { atCents: 8500, profitCents: -4_999_500 },
        { atCents: 8700, profitCents: -4_999_500 },
      ],
    });
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
