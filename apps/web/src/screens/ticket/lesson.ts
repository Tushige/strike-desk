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
    const wentTheOtherWay =
      openingCents !== null && bellCents !== null && (ticket.side === 'up' ? bellCents < openingCents : bellCents > openingCents);
    if (got === 0 && wentTheOtherWay) return 'The price went the other way and your tickets ended at $0. This is why shaky news is risky to trust.';
    if (got === 0) return 'Right direction, but the price never reached your target before the bell. Closer targets cost more for a reason.';
    if (profit < 0) return 'The price passed your target, but not by enough to win back what you paid for the tickets.';
    return 'You held your nerve to the bell. Every dollar the price finished past your target was yours.';
  }

  const heldWouldPay = ticket.ifHeldCents ?? null;
  const holdingPaidMore = heldWouldPay !== null && heldWouldPay > got;
  if (profit >= 0 && holdingPaidMore) {
    return `You locked in a sure win. Holding to the bell would have paid ${money(heldWouldPay)} instead, but nobody knew that at the time.`;
  }
  if (profit >= 0) return `Great exit. Holding to the bell would have paid ${heldWouldPay === null ? 'less' : money(heldWouldPay)}.`;
  if (!holdingPaidMore) return `You cut your loss early. Holding to the bell would have paid ${heldWouldPay === null ? 'even less' : money(heldWouldPay)}. The pros do this all the time.`;
  return 'You got out early and then the price turned your way. It happens to every trader.';
}
