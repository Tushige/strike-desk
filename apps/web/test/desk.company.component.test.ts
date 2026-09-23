// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createSocketFactory, testFrame } from './fakeSocket';

const sockets = createSocketFactory();
let App: typeof import('../src/App')['default'];
let close: () => void;
beforeAll(async () => {
  vi.stubGlobal('WebSocket', function FakeWebSocket(url: string) { return sockets.create(url); });
  vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      if (target.classList.contains('price-chart')) this.callback([{ contentRect: new DOMRect(0, 0, 800, 224) } as ResizeObserverEntry], this);
    }
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 500));
  const { connection } = await import('../src/boot');
  close = () => { connection.close(); };
  App = (await import('../src/App')).default;
  await import('../src/screens/desk/CompareOptions');
}, 30_000);
afterAll(() => {
  cleanup(); close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.sessionStorage.clear();
});

it('company cards and table chips update the actual chart, header and builder together', async () => {
  const prices = [8_400, 10_400, 12_400, 14_400, 16_400, 18_400];
  const frame = testFrame({
    step: 1, rev: 1, prices,
    news: [{ id: 1, day: 1, companyId: 1, trust: 2, source: 'A delivery driver says', title: 'Fizzly adds a delivery route', body: 'More shops can order fizzy drinks.', direction: 'up', revealed: false }],
    clock: { phase: 'preBell', day: 1, stepsLeft: 299, priceIndex: 0, pace: 1 },
    board: { targetsPerCompany: 3, companies: prices.map((value) => ({
      targets: [value + 100, value + 200, value + 300], simpleUp: [0, 1, 2], simpleDown: [0, 1, 2], lowestUpIndex: 0, highestDownIndex: 2,
    })) },
    quotes: Array.from({ length: 36 }, () => 1_000),
    history: prices.map((value) => [value]), leadIn: prices.map((value) => [value - 50, value]),
    account: { cashCents: 100_000_000, worthCents: 100_000_000, capCents: 50_000_000, canBuy: true },
  });
  render(createElement(App));
  act(() => { sockets.last().fireOpen(); sockets.last().fireMessage(JSON.stringify(frame)); });
  const cards = within(screen.getByRole('region', { name: 'Company cards' }));
  expect(cards.getAllByRole('button')).toHaveLength(6);
  const navigation = within(screen.getByRole('navigation', { name: 'Desk sections' }));
  expect(navigation.getByRole('button', { name: 'Market' }).getAttribute('aria-pressed')).toBe('true');
  expect(cards.queryByText('Fizzly adds a delivery route')).toBeNull();
  fireEvent.click(cards.getByRole('button', { name: /^Fizzly/ }));
  expect(screen.getByRole('img', { name: 'Price chart, now $104.00' })).toBeTruthy();
  fireEvent.click(cards.getByRole('button', { name: /^RoboPup/ }));
  fireEvent.click(screen.getByRole('button', { name: '$100K' }));
  fireEvent.click(navigation.getByRole('button', { name: 'News' }));
  expect(navigation.getByRole('button', { name: 'News' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('heading', { name: 'Fizzly adds a delivery route' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View Fizzly chart' }));
  expect(navigation.getByRole('button', { name: 'Market' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('img', { name: 'Price chart, now $104.00' })).toBeTruthy();
  fireEvent.click(navigation.getByRole('button', { name: 'Tickets · 0/3' }));
  expect(within(screen.getByRole('region', { name: 'Your ticket' })).getByRole('button', { name: '$100K' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(cards.getByRole('button', { name: /^RoboPup/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Compare contracts' }));
  await act(async () => { await vi.dynamicImportSettled(); });
  const filters = within(screen.getByRole('group', { name: 'Filters' }));
  const panel = within(screen.getByRole('region', { name: 'Your ticket' }));
  expect(screen.queryByRole('combobox', { name: 'Chart company' })).toBeNull();
  fireEvent.click(filters.getByRole('button', { name: 'DOWN' }));
  expect(screen.getByRole('img', { name: 'Price chart, now $84.00' })).toBeTruthy();
  fireEvent.click(filters.getByRole('button', { name: 'FIZZ' }));
  expect(screen.getByRole('img', { name: 'Price chart, now $104.00' })).toBeTruthy();
  expect(screen.queryByRole('img', { name: 'Price chart, now $84.00' })).toBeNull();
  expect(screen.getByText('Fizzly (FIZZ) makes things')).toBeTruthy();
  expect(panel.getByText('1. Which way will Fizzly go?')).toBeTruthy();
  expect(panel.getByRole('button', { name: '$100K' }).getAttribute('aria-pressed')).toBe('true');
  expect(filters.getByRole('button', { name: 'DOWN' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(filters.getByRole('button', { name: 'JETK' }));
  expect(screen.getByRole('img', { name: 'Price chart, now $124.00' })).toBeTruthy();
  fireEvent.click(filters.getByRole('button', { name: 'All' }));
  expect(screen.getByRole('img', { name: 'Price chart, now $124.00' })).toBeTruthy();
  fireEvent.click(filters.getByRole('button', { name: 'FIZZ' }));
  fireEvent.click(filters.getByRole('button', { name: 'RPUP' }));
  expect(screen.getByRole('img', { name: 'Price chart, now $84.00' })).toBeTruthy();
  expect(filters.getByRole('button', { name: 'RPUP' }).getAttribute('aria-pressed')).toBe('true');
  expect(filters.getByRole('button', { name: 'FIZZ' }).getAttribute('aria-pressed')).toBe('false');

  // A new purchase focuses the received position, while the existing draft stays intact.
  const position = { id: 'd1', day: 1, contractId: 0, companyId: 0, side: 'up' as const, targetCents: 8500,
    quantity: 100, entryPriceCents: 1000, costCents: 100000, entryStep: 1, entryPriceIndex: 0,
    breakEvenCents: 8510, status: 'open' as const, valueCents: 100000, profitCents: 0, realCents: 0, hopeCents: 1000 };
  const second = { ...position, id: 'd1-p2', companyId: 1, contractId: 6, targetCents: 10500 };
  act(() => { sockets.last().fireMessage(JSON.stringify({ ...frame, step: 2, rev: 2, positions: [position, second] })); });
  expect(screen.getByRole('img', { name: 'Price chart, now $104.00' })).toBeTruthy();
  expect(panel.getByRole('button', { name: /Inspect purchase 2/ }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(panel.getByRole('button', { name: /New purchase/ }));
  expect(panel.getByRole('button', { name: '$100K' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('img', { name: 'Price chart, now $84.00' })).toBeTruthy();
  fireEvent.click(panel.getByRole('button', { name: /Inspect purchase 1/ }));
  fireEvent.click(panel.getByRole('button', { name: /Inspect purchase 2/ }));
  fireEvent.click(panel.getByRole('button', { name: /^Cash out/ }));
  const commands = sockets.last().sent.map(value => JSON.parse(value) as { t: string; positionId?: string });
  expect(commands.filter(command => command.t === 'cashOut')).toMatchObject([{ t: 'cashOut', positionId: 'd1-p2' }]);
  expect(panel.getByRole('button', { name: /New purchase/ }).hasAttribute('disabled')).toBe(true);
  expect(panel.getByRole('button', { name: /Inspect purchase 1/ }).hasAttribute('disabled')).toBe(true);
});
