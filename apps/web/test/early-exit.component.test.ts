// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EarlyExitScreen } from '../src/screens/EarlyExitScreen';
import { testFrame } from './fakeSocket';

const restart = vi.hoisted(() => vi.fn());
vi.mock('../src/boot', () => ({ playAgain: restart }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('labels an early exit without awarding a final rank or inventing completed days', () => {
  render(createElement(EarlyExitScreen, { exit: { frame: testFrame({ clock: { phase: 'preBell', day: 1, stepsLeft: 300, priceIndex: 0, pace: 1 } }), pending: false, stale: false } }));
  expect(screen.getByRole('heading', { name: 'You rang your own bell.' })).toBe(document.activeElement);
  expect(screen.getByText(/0 of 5 days complete/)).toBeTruthy();
  expect(screen.queryByText('Steady Hand')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Review completed days' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));
  expect(restart).toHaveBeenCalledOnce();
});

it('keeps an open ticket separate from completed-day results and warns about unresolved orders', () => {
  const frame = testFrame({ clock: { phase: 'open', day: 2, stepsLeft: 100, priceIndex: 10, pace: 1 },
    account: { cashCents: 90_000_000, worthCents: 105_000_000, capCents: 45_000_000, canBuy: false },
    days: [{ day: 1, startCents: 100_000_000, endCents: 100_000_000, changeCents: 0 }],
    positions: [{ id: 'p2', day: 2, contractId: 0, companyId: 0, side: 'up', targetCents: 10_000, quantity: 100,
      entryPriceIndex: 0, entryStep: 0, entryPriceCents: 100_000, costCents: 10_000_000, status: 'open',
      valueCents: 15_000_000, profitCents: 5_000_000, realCents: 100_000, hopeCents: 50_000, breakEvenCents: 11_000 }],
  });
  render(createElement(EarlyExitScreen, { exit: { frame, pending: true, stale: true } }));
  expect(screen.getByText('$1,050,000')).toBeTruthy();
  expect(screen.getByText(/Cash \$900,000/).textContent).toContain('Open ticket $150,000');
  expect(screen.getByText(/did not cash it out or settle it/)).toBeTruthy();
  expect(screen.getByText(/An order was still being checked/)).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Review completed days' })).getAllByRole('button')).toHaveLength(1);
  expect(screen.queryByText('Settled at the bell')).toBeNull();
  expect(screen.getByRole('region', { name: 'Day 1 review' })).toBeTruthy();
});
