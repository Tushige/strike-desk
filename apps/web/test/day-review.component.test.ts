// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { PositionView } from '@strike-desk/shared/protocol';
import { DayReview } from '../src/screens/ticket/DayReview';
import { lessonFor } from '../src/screens/ticket/lesson';
import { testFrame } from './fakeSocket';

afterEach(cleanup);
const bought: PositionView = {
  id: 'd1', day: 1, contractId: 0, entryStep: 0, companyId: 0, side: 'up', targetCents: 10_000, quantity: 1,
  entryPriceIndex: 0, entryPriceCents: 30_000, costCents: 30_000, status: 'settled',
  valueCents: 20_000, profitCents: -10_000, realCents: 20_000, hopeCents: 0, breakEvenCents: 10_300,
  exit: { kind: 'bell', step: 800, priceIndex: 500, priceCents: 20_000, proceedsCents: 20_000 },
};
it('shows the chosen historical position and no current-day news', () => {
  const frame = testFrame({ clock: { phase: 'final', day: 5, stepsLeft: 0, priceIndex: 500, pace: 1 }, positions: [bought],
    news: [{ id: 10, day: 5, companyId: 0, title: 'Day five only', body: 'Never day one', source: 'Test', trust: 3, direction: 'up', revealed: true, wasTrue: true }] });
  render(createElement(DayReview, { frame, day: 1 }));
  expect(screen.getByText('Day 1 · RoboPup UP / call')).toBeTruthy();
  expect(screen.getByText('$300')).toBeTruthy();
  expect(screen.getByText('$200')).toBeTruthy();
  expect(screen.getByText('−$100')).toBeTruthy();
  expect(screen.queryByText('Day five only')).toBeNull();
});
it('labels skipped days explicitly without attributing another day’s position', () => {
  const frame = testFrame({ positions: [bought], days: [{ day: 2, startCents: 100_000_000, endCents: 100_000_000, changeCents: 0 }] });
  render(createElement(DayReview, { frame, day: 2 }));
  expect(screen.getByText('Day 2 · No trade')).toBeTruthy();
  expect(screen.getByText('You sat out. Trading result: $0.')).toBeTruthy();
});
it('explains a paying ticket can still lose and uses the closing endpoint precisely', () => {
  expect(lessonFor(bought, 10_000, 10_200)).toContain('not far enough to cover the premium');
  const worthless = { ...bought, valueCents: 0, exit: { ...bought.exit!, proceedsCents: 0 } };
  expect(lessonFor(worthless, 9_000, 9_500)).toContain('finished on the non-paying side');
  expect(lessonFor(worthless, 9_000, 9_500)).not.toContain('never reached');
});
