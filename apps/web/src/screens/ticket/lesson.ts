import type { NewsView, PositionView } from '@strike-desk/shared/protocol';
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

/** Relate the player's actual timing and direction to the landed event, then the payout. */
export function tradeStoryFor(ticket: PositionView | null, news: NewsView | null, openingCents: number | null, bellCents: number | null): string {
  if (!ticket) return 'You sat out this day, so the price moves did not change your cash.';
  const parts: string[] = [];
  if (news?.eventDirection && news.revealIndex !== undefined) {
    const side = ticket.side === 'up' ? 'UP' : 'DOWN';
    const matched = ticket.side === news.eventDirection;
    if (ticket.status === 'cashedOut' && ticket.exit && ticket.exit.priceIndex < news.revealIndex) {
      parts.push(`You cashed out your ${side} tickets before this update. Its ${news.eventDirection === 'up' ? 'upward' : 'downward'} pressure came after your exit.`);
    } else if (ticket.entryPriceIndex >= news.revealIndex) {
      parts.push(`You bought ${side} after this update, once its initial price move had already happened.`);
    } else {
      const report = news.direction === 'up' ? 'UP' : 'DOWN';
      if (matched) parts.push(ticket.side === news.direction
        ? `Your ${side} pick matched the original report, and the event went your way.`
        : `You picked ${side} against the original ${report} report. The reversal went your way.`);
      else parts.push(ticket.side === news.direction
        ? `Your ${side} pick matched the original report, but the update reversed it.`
        : `You picked ${side} against the original ${report} report, which held up.`);
    }
    if (openingCents !== null && bellCents !== null && openingCents !== bellCents &&
      (bellCents > openingCents ? 'up' : 'down') !== news.eventDirection) {
      parts.push(`Other price moves outweighed that event: the share price finished ${bellCents > openingCents ? 'higher' : 'lower'} overall.`);
    }
  }
  const returned = ticket.exit?.proceedsCents ?? ticket.valueCents;
  if (ticket.status === 'cashedOut') parts.push(lessonFor(ticket, openingCents, bellCents));
  else if (returned === 0) parts.push(`The closing price missed your ${ticket.side === 'up' ? 'UP' : 'DOWN'} target, so the tickets paid $0.`);
  else if (ticket.profitCents < 0) parts.push('Your target was reached, but the payout did not cover what you paid for the tickets.');
  else if (ticket.profitCents === 0) parts.push('The payout exactly covered what you paid for the tickets.');
  else parts.push('The closing price passed your target far enough for the payout to cover your ticket cost and leave a profit.');
  return parts.join(' ');
}
