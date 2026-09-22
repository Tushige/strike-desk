import type { PositionView } from '@strike-desk/shared/protocol';
import { money } from '../format';

/**
 * One plain-language sentence about what the player's choice just taught
 * them, chosen from what actually happened: whether a ticket was bought,
 * held to the bell or cashed out, and how the money came back. Every amount
 * named is one the server sent; nothing is added or subtracted here.
 *
 * `openingCents` and `bellCents` are the company's opening and closing
 * prices, used only to say which way the price went.
 */
export function lessonFor(ticket: PositionView | null, openingCents: number | null, bellCents: number | null): string {
  if (ticket === null) return 'You sat this one out, so your cash did not move. Sometimes no trade is the best trade.';
  const got = ticket.exit?.proceedsCents ?? ticket.valueCents;
  const profit = ticket.profitCents;

  if (ticket.status !== 'cashedOut') {
    const known = openingCents !== null && bellCents !== null;
    const wentTheOtherWay = known && (ticket.side === 'up' ? bellCents < openingCents : bellCents > openingCents);
    const wentYourWay = known && (ticket.side === 'up' ? bellCents > openingCents : bellCents < openingCents);
    if (got === 0 && wentTheOtherWay) return 'The price went the other way and your tickets ended at $0. A ticket that misses its target pays nothing, whatever the news said.';
    if (got === 0 && wentYourWay) return 'Right direction, but the price finished on the non-paying side of your target. Closer targets cost more for a reason.';
    if (got === 0) return 'The price finished on the non-paying side of your target, so the tickets ended at $0. Closer targets cost more for a reason.';
    if (profit < 0) return 'The price finished past your target, but not far enough to cover the premium you paid. A true headline or the right direction does not guarantee profit.';
    return 'Your ticket paid at the bell. Profit is that payout minus the premium you paid.';
  }

  return `You cashed out for ${money(got)}. ${ticket.ifHeldCents === undefined ? 'The hold-to-bell comparison is not available yet.' : `Holding to the bell would have paid ${money(ticket.ifHeldCents)}.`} That later result was not knowable at your exit.`;
}
