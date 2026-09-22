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
  expect(cards.getAllByText('No news today. Still tradable.')).toHaveLength(6);
  fireEvent.click(cards.getByRole('button', { name: /^Fizzly/ }));
  expect(screen.getByRole('img', { name: 'Price chart, now $104.00' })).toBeTruthy();
  fireEvent.click(cards.getByRole('button', { name: /^RoboPup/ }));
  fireEvent.click(screen.getByRole('button', { name: '$100K' }));
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
});
