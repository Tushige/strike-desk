// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { NewsView, PositionView } from '@strike-desk/shared/protocol';
import { NewsUpdate } from '../src/screens/desk/NewsUpdate';
import { DayReview } from '../src/screens/ticket/DayReview';
import { tradeStoryFor } from '../src/screens/ticket/lesson';
import { testFrame } from './fakeSocket';

afterEach(cleanup);
const news: NewsView = { id: 0, day: 1, companyId: 0, trust: 1, source: 'An online post', title: 'RoboPup gets an order', body: 'A shop orders robot pets.', direction: 'up', revealed: true, revealIndex: 200, wasTrue: false,
  updateTitle: 'Order falls through', updateBody: 'The buyer cancels the order, taking the expected sales off the table.', eventDirection: 'down', eventBeforeCents: 8400, eventAfterCents: 8000 };
const ticket: PositionView = { id: 'd1', day: 1, contractId: 0, companyId: 0, side: 'up', targetCents: 9000, quantity: 1, entryPriceIndex: 0, entryStep: 0, entryPriceCents: 1000, costCents: 1000, status: 'settled', valueCents: 0, profitCents: -1000, realCents: 0, hopeCents: 0, breakEvenCents: 9010 };

it('keeps the update hidden until revealed and shows the actual event and observed prices afterward', () => {
  const view = render(createElement(NewsUpdate, { news: { ...news, revealed: false } }));
  expect(view.container.textContent).toBe('');
  view.rerender(createElement(NewsUpdate, { news }));
  expect(screen.getByText('Order falls through')).toBeTruthy();
  expect(screen.getByText(/At the update/).textContent).toContain('$84.00 → $80.00');
});

it('connects reversal, direction, premium and timing without assuming a matched event guarantees profit', () => {
  expect(tradeStoryFor(ticket, news, 8400, 8000)).toContain('Your UP pick matched the original report, but the update reversed it.');
  const down = { ...ticket, side: 'down' as const, valueCents: 500, profitCents: -500 };
  expect(tradeStoryFor(down, news, 8400, 8000)).toContain('You picked DOWN against the original UP report. The reversal went your way.');
  expect(tradeStoryFor(ticket, { ...news, eventDirection: 'up' }, 8400, 9400)).toContain('the event went your way');
  expect(tradeStoryFor(down, { ...news, eventDirection: 'up' }, 8400, 9400)).toContain('original UP report, which held up');
  expect(tradeStoryFor(down, news, 8400, 8000)).toContain('did not cover what you paid');
  expect(tradeStoryFor({ ...down, profitCents: 100 }, news, 8400, 8000)).toContain('leave a profit');
  expect(tradeStoryFor(ticket, { ...news, eventDirection: 'up', wasTrue: true }, 8400, 8000)).toContain('Other price moves outweighed');
  expect(tradeStoryFor({ ...ticket, entryPriceIndex: 220 }, news, 8400, 8000)).toContain('You bought UP after this update');
  const sold = { ...ticket, status: 'cashedOut' as const, exit: { kind: 'cashOut' as const, step: 400, priceIndex: 100, priceCents: 900, proceedsCents: 900 } };
  expect(tradeStoryFor(sold, news, 8400, 8000)).toContain('before this update');
});

it('reviews the saved day’s event rather than the current headline', () => {
  const frame = testFrame({ news: [{ ...news, title: 'Different day', updateTitle: 'Different update' }], positions: [ticket],
    days: [{ day: 1, startCents: 100000000, endCents: 99999000, changeCents: -1000, review: { companyId: 0, openingCents: 8400, closingCents: 8000, news } }] });
  render(createElement(DayReview, { frame, day: 1 }));
  expect(screen.getByText('Order falls through')).toBeTruthy();
  expect(screen.queryByText('Different update')).toBeNull();
  expect(screen.getByText(/Your UP pick/)).toBeTruthy();
});
