import type { Frame, NewsView, PositionView } from '@strike-desk/shared/protocol';
import { percentChange } from '../format';

/**
 * The one-line tip under the chart: what the desk would whisper to a first
 * timer at this moment. It reacts to the phase, the selected company's
 * headline and whether the player holds a ticket. It never says whether a
 * headline was true; the price says enough.
 */

/** How many price steps the "Plot twist!" banner stays up after a reveal. */
export const TWIST_SHOWS_FOR_STEPS = 40;

/** The headline the selected company has today, if any. */
export function headlineFor(frame: Frame, companyId: number): NewsView | null {
  return frame.news.find((item) => item.companyId === companyId && item.day === frame.clock.day) ?? null;
}

/** Today's ticket, open or already closed, if any. */
export function ticketToday(frame: Frame): PositionView | null {
  return frame.positions.find((position) => position.day === frame.clock.day) ?? null;
}

/** True while the reveal banner should show for this company. */
export function twistShowing(frame: Frame, companyId: number): boolean {
  const news = headlineFor(frame, companyId);
  if (news === null || !news.revealed || news.revealIndex === undefined) return false;
  if (frame.clock.phase !== 'open') return false;
  const since = frame.clock.priceIndex - news.revealIndex;
  return since >= 0 && since < TWIST_SHOWS_FOR_STEPS;
}

const TRUST_TIPS = {
  3: 'Solid news: most traders already believe it, so tickets cost extra.',
  2: 'Could be true: a fair price for a fair guess. Check the other headlines too.',
  1: 'Wild rumor: basically a coin flip. But if it is true, the price can really fly.',
} as const;

export function tipFor(frame: Frame, companyId: number, openingCents: number | null): string {
  const company = frame.companies[companyId];
  const name = company?.name ?? 'This company';
  const news = headlineFor(frame, companyId);
  const phase = frame.clock.phase;

  if (phase === 'preBell') {
    if (news === null) return `No news for ${name} today. Its tickets are priced fairly, so there is no edge here. Sometimes that is the lesson.`;
    return TRUST_TIPS[news.trust];
  }
  if (phase === 'open') {
    if (twistShowing(frame, companyId)) return `Plot twist! Fresh news just hit ${name}. Watch the price.`;
    const ticket = ticketToday(frame);
    if (ticket !== null && ticket.status === 'open') return 'Hope value melts as the closing bell gets closer. Waiting for more always has a price.';
    if (news?.revealed === true) return `The news is out for ${name}. There is less left to hope for.`;
    return 'Watch which headlines come true. It helps you judge tomorrow’s news.';
  }
  const now = frame.prices[companyId];
  const ticker = company?.ticker ?? '';
  if (openingCents === null || now === undefined) return 'Tap the other companies to check how their day went.';
  return `${ticker} moved ${percentChange(openingCents, now)} today. Tap the other companies to check theirs.`;
}
