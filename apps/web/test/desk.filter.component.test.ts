// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import { contractId } from '@strike-desk/shared/protocol';
import { createSocketFactory, testFrame } from './fakeSocket';

/**
 * The one usability rule a table is most likely to break, proved on the real
 * page: filtering the contract table while quotes stream in never touches
 * the half-built ticket. The player picks UP, Far and $100K, opens
 * "Compare options", filters the table down to DOWN tickets — which hides
 * the chosen row — while five frames of moving prices arrive, and the ticket
 * still says Far, $100K and the same target.
 */

const stops: (() => void)[] = [];
afterEach(() => {
  cleanup();
  stops.splice(0).forEach((stop) => { stop(); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

const TARGETS = 21;
const CONTRACTS = 6 * TARGETS * 2;

function board(): NonNullable<Frame['board']> {
  return {
    targetsPerCompany: TARGETS,
    companies: Array.from({ length: 6 }, (_unused, companyId) => ({
      targets: Array.from({ length: TARGETS }, (_target, index) => 8_000 + companyId * 2_000 + index * 100),
      simpleUp: [12, 15, 18] as [number, number, number],
      simpleDown: [8, 5, 2] as [number, number, number],
      lowestUpIndex: 0,
      highestDownIndex: TARGETS - 1,
    })),
  };
}

/** A frame before the bell on day 1, with every ticket priced `base` cents plus its id. */
function preBellFrame(step: number, base: number): Frame {
  const quotes = Array.from({ length: CONTRACTS }, (_unused, id) => base + id);
  return testFrame({
    step,
    rev: 1,
    clock: { phase: 'preBell', day: 1, stepsLeft: 300 - step, priceIndex: 0, pace: 1 },
    board: board(),
    quotes,
    quoteReals: quotes.map(() => 0),
    quoteHopes: quotes,
    quoteBreakEvens: quotes.map((cents, id) => 10_000 + cents + id),
    news: [
      { id: 0, day: 1, companyId: 0, trust: 3, source: 'The boss says', title: 'RoboPup sells out', body: 'Every store is empty.', direction: 'up', revealed: false },
      { id: 1, day: 1, companyId: 1, trust: 2, source: 'A shop owner says', title: 'Fizzly is fizzing', body: 'Sales are up.', direction: 'up', revealed: false },
      { id: 2, day: 1, companyId: 2, trust: 1, source: 'People online say', title: 'JetKicks rumour', body: 'Something is coming.', direction: 'down', revealed: false },
    ],
    account: { cashCents: 100_000_000, worthCents: 100_000_000, capCents: 50_000_000, canBuy: true },
    history: Array.from({ length: 6 }, () => [8_400]),
    leadIn: Array.from({ length: 6 }, () => Array.from({ length: 40 }, () => 8_400)),
  });
}

it('filtering the table while quotes stream keeps the half-built ticket', async () => {
  // Draft reports to the server are paced to one a second; the clock is moved by hand.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 500));
  const sockets = createSocketFactory();
  vi.stubGlobal('WebSocket', function FakeWebSocket(url: string) { return sockets.create(url); });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });

  const { connection } = await import('../src/boot');
  stops.push(() => { connection.close(); });
  const { default: App } = await import('../src/App');
  render(createElement(App));

  const send = (message: ServerMessage): void => { act(() => { sockets.last().fireMessage(JSON.stringify(message)); }); };
  act(() => { sockets.last().fireOpen(); });
  send(preBellFrame(1, 1_000));

  // Build the ticket the simple way on the first headline's company (RoboPup): UP, Far, $100K.
  fireEvent.click(screen.getByRole('button', { name: /^UP/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Far/ }));
  fireEvent.click(screen.getByRole('button', { name: '$100K' }));
  const far = contractId(TARGETS, { companyId: 0, targetIndex: 15, side: 'up' });
  expect(screen.getByRole('button', { name: /^Far/ }).getAttribute('aria-pressed')).toBe('true');
  act(() => { vi.advanceTimersByTime(1_100); });

  // The page asks the server to quote it; the next frame answers, and the buy button names the cost.
  const drafts = sockets.last().sent.map((text) => JSON.parse(text) as { t: string; contractId?: number | null; spendCents?: number | null })
    .filter((message) => message.t === 'draft');
  expect(drafts.at(-1)).toEqual({ t: 'draft', contractId: far, spendCents: 10_000_000 });
  const quoted = preBellFrame(2, 1_000);
  quoted.draft = { contractId: far, spendCents: 10_000_000, ticket: { contractId: far, priceCents: 1_000 + far, quantity: 9, costCents: 9 * (1_000 + far), limitPriceCents: 1_100 + far, breakEvenCents: 11_000 + 2 * far,
    whatIf: [{ atCents: 9_000, profitCents: -9 * (1_000 + far) }, { atCents: 11_000 + 2 * far, profitCents: 0 }, { atCents: 12_000, profitCents: 4_500 }] } };
  send(quoted);
  expect(screen.getByRole('button', { name: /^Buy for/ })).toBeTruthy();

  // Open the table and filter it down to DOWN tickets, which hides the chosen UP row, while prices stream.
  fireEvent.click(screen.getByRole('button', { name: 'Compare options' }));
  const filters = screen.getByRole('group', { name: 'Filters' });
  fireEvent.click(within(filters).getByRole('button', { name: 'DOWN' }));
  for (let step = 3; step <= 7; step += 1) {
    const moving = preBellFrame(step, 1_000 + step * 7);
    moving.draft = quoted.draft;
    send(moving);
  }

  // The ticket is untouched: the same target, the same spend, still buyable.
  const panel = screen.getByRole('region', { name: 'Your ticket' });
  expect(within(panel).getByRole('button', { name: /^Far/ }).getAttribute('aria-pressed')).toBe('true');
  expect(within(panel).getByRole('button', { name: '$100K' }).getAttribute('aria-pressed')).toBe('true');
  expect(within(panel).getByText(/You get 9 UP tickets for/)).toBeTruthy();
  expect(within(panel).getByRole('button', { name: /^Buy for/ })).toBeTruthy();
  expect(within(panel).getByText(/What if, at the closing bell, RPUP is at/)).toBeTruthy();
  const later = sockets.last().sent.map((text) => JSON.parse(text) as { t: string }).filter((message) => message.t === 'draft');
  expect(later).toHaveLength(drafts.length);
});
