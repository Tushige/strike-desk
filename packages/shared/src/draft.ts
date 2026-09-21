import { breakEvenCents, toleranceLimitCents } from './game';
import type { Cents } from './money';
import { centsToDollars, quantityForSpend, totalCents } from './money';
import { priceTicket } from './pricing';
import type { DraftRequest, DraftTicket, DraftView, Frame, Side, WhatIfPoint } from './protocol';
import { decodeContractId } from './protocol';

/**
 * The quote of a ticket being built.
 *
 * The point of the signature: it takes what the player is choosing, and the
 * board and the ticket prices of one frame. It is handed no market, no random
 * stream and no clock, so it reads only numbers that frame already shows and
 * cannot show the future.
 *
 * The buy check, a bought ticket and this quote share their rules
 * (`toleranceLimitCents`, `breakEvenCents`, `quantityForSpend`, `totalCents`),
 * so what the form shows is what a buy at the same price does.
 */

/**
 * What one ticket pays at the bell when the share price finishes exactly at
 * `atCents`: its real value alone, through the pricing function with nothing
 * left to hope for, so it rounds exactly as a settlement does.
 */
function valueAtBellCents(atCents: Cents, targetCents: Cents, side: Side): Cents {
  return priceTicket({ price: centsToDollars(atCents), target: centsToDollars(targetCents), side, varianceLeft: 0, markup: 1 }).priceCents;
}

/**
 * The board's average gap between neighbouring targets, in whole cents: top
 * target minus bottom target, over the number of gaps, half a cent rounding
 * up. The average and not any one gap, because targets are rounded to the
 * cent and so neighbouring gaps differ by a cent: the average is one number
 * for a company's board, the same for UP and DOWN, so the two sides mirror
 * exactly. Whole numbers throughout, so the half is exact. Null on a board
 * with a single target, which has no gap.
 */
function averageGapCents(targets: readonly Cents[]): Cents | null {
  const gaps = targets.length - 1;
  if (gaps < 1) return null;
  const spanCents = (targets[gaps] ?? 0) - (targets[0] ?? 0);
  return Math.floor((2 * spanCents + gaps) / (2 * gaps));
}

function quoteTicket(contractId: number, spendCents: Cents | null, board: NonNullable<Frame['board']>, quotes: readonly number[]): DraftTicket | null {
  const priceCents = quotes[contractId];
  if (priceCents === undefined) return null;
  const { companyId, targetIndex, side } = decodeContractId(board.targetsPerCompany, contractId);
  const targets = board.companies[companyId]?.targets;
  const targetCents = targets?.[targetIndex];
  if (targets === undefined || targetCents === undefined) return null;

  const quantity = spendCents === null ? 0 : quantityForSpend(spendCents, priceCents);
  const costCents = totalCents(priceCents, quantity);
  const breakEven = breakEvenCents(targetCents, priceCents, side);

  // The stops: every target of the board, the break-even, and one gap past the
  // break-even (above it for UP, below it for DOWN, never below a share price
  // of zero), so that no table ends on "at best you get your money back".
  let whatIf: WhatIfPoint[] = [];
  if (quantity > 0) {
    const gapCents = averageGapCents(targets);
    const pastBreakEven = gapCents === null ? [] : [Math.max(0, side === 'up' ? breakEven + gapCents : breakEven - gapCents)];
    const stops = [...new Set([...targets, breakEven, ...pastBreakEven])].sort((a, b) => a - b);
    whatIf = stops.map((atCents) => ({
      atCents,
      profitCents: totalCents(valueAtBellCents(atCents, targetCents, side), quantity) - costCents,
    }));
  }

  return { contractId, priceCents, quantity, costCents, limitPriceCents: toleranceLimitCents(priceCents), breakEvenCents: breakEven, whatIf };
}

/**
 * The `draft` section of a frame, from the request it answers and that
 * frame's own board and ticket prices (by contract id). Null when nothing is
 * chosen. `costs` is present when a spend is named; `ticket` when the named
 * contract is on the board.
 */
export function quoteDraft(request: DraftRequest, board: NonNullable<Frame['board']>, quotes: readonly number[]): DraftView | null {
  const { contractId, spendCents } = request;
  if (contractId === null && spendCents === null) return null;
  const view: DraftView = { contractId, spendCents };
  if (spendCents !== null) view.costs = quotes.map((priceCents) => totalCents(priceCents, quantityForSpend(spendCents, priceCents)));
  const ticket = contractId === null ? null : quoteTicket(contractId, spendCents, board, quotes);
  if (ticket !== null) view.ticket = ticket;
  return view;
}
