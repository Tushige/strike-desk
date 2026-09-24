// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { gsap } from 'gsap';
import { createSocketFactory, testFrame } from './fakeSocket';

const sockets = createSocketFactory();
let Desk: typeof import('../src/screens/desk/Desk')['Desk'];
let close: () => void;
let css: HTMLStyleElement;
beforeAll(async () => {
  vi.stubGlobal('WebSocket', function FakeWebSocket(url: string) { return sockets.create(url); });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const { connection } = await import('../src/boot');
  close = () => { connection.close(); };
  Desk = (await import('../src/screens/desk/Desk')).Desk;
}, 30_000);
afterAll(() => {
  cleanup(); close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  window.sessionStorage.clear();
  css?.remove();
});

it('keeps companies and chart mounted without dimming the company list during a purchase', async () => {
  // Supply the shared Button's Tailwind opacity utility to jsdom (which does not compile CSS).
  css = document.createElement('style');
  css.textContent = '.desk-control { opacity: 1 } .disabled\\:opacity-40:disabled { opacity: .4 }';
  document.head.append(css);
  const animations = vi.spyOn(gsap, 'fromTo');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  const frame = testFrame({ step: 1, rev: 1,
    clock: { phase: 'preBell', day: 1, stepsLeft: 299, priceIndex: 0, pace: 1 },
    board: { targetsPerCompany: 3, companies: Array.from({ length: 6 }, () => ({
      targets: [8400, 8500, 8600], simpleUp: [0, 1, 2], simpleDown: [0, 1, 2], lowestUpIndex: 0, highestDownIndex: 2,
    })) },
    quotes: Array.from({ length: 36 }, () => 1000),
    history: Array.from({ length: 6 }, () => [8400]),
    leadIn: Array.from({ length: 6 }, () => [8350, 8400]),
    account: { cashCents: 100_000_000, worthCents: 100_000_000, capCents: 50_000_000, canBuy: true },
  });
  act(() => { sockets.last().fireOpen(); sockets.last().fireMessage(JSON.stringify(frame)); });
  const view = render(createElement(Desk));
  fireEvent.click(screen.getByRole('button', { name: /^UP/ }));
  fireEvent.click(screen.getByRole('button', { name: '$100K' }));
  act(() => { vi.advanceTimersByTime(1100); });
  const messages = sockets.last().sent.map(text => JSON.parse(text) as { t: string; contractId: number; spendCents: number });
  const draft = messages.filter(message => message.t === 'draft').at(-1)!;
  const quoted = { ...frame, step: 2, draft: { contractId: draft.contractId, spendCents: draft.spendCents,
    ticket: { contractId: draft.contractId, priceCents: 1000, quantity: 100, costCents: 100_000,
      limitPriceCents: 1025, breakEvenCents: 8410, whatIf: [] } } };
  act(() => { sockets.last().fireMessage(JSON.stringify(quoted)); });
  const cards = screen.getByRole('region', { name: 'Company cards' });
  const buttons = within(cards).getAllByRole('button');
  const chart = view.container.querySelector('.price-chart');
  expect(chart).not.toBeNull();
  const desk = view.container.querySelector('.desk-layout');
  const panels = ['.desk-sidebar', '.market-region', '.ticket-region'].map(selector => view.container.querySelector(selector));
  const panelEntrances = () => animations.mock.calls.filter(([target]) => panels.includes(target as Element)).length;
  const before = panelEntrances();
  expect(buttons.map(button => getComputedStyle(button).opacity)).toEqual(Array(6).fill('1'));
  fireEvent.click(screen.getByRole('button', { name: /^Buy for/ }));
  const buys = sockets.last().sent.map(text => JSON.parse(text) as { t: string; commandId: string }).filter(message => message.t === 'buy');
  expect(buys).toHaveLength(1);
  expect(buttons.every(button => button.hasAttribute('disabled'))).toBe(true);
  fireEvent.click(buttons[1]!);
  expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true');
  expect(buttons[1]!.getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('region', { name: 'Company cards' })).toBe(cards);
  expect(within(cards).getAllByRole('button')).toEqual(buttons);
  expect(view.container.querySelector('.price-chart')).toBe(chart);
  expect(view.container.querySelector('.desk-layout')).toBe(desk);
  expect(panelEntrances()).toBe(before);
  // Hold the server response: locked navigation must not flash the whole list to 40% opacity.
  expect(buttons.map(button => getComputedStyle(button).opacity)).toEqual(Array(6).fill('1'));
  // The purchase action still communicates its disabled state locally.
  expect(screen.getByRole('button', { name: /^Buy for/ }).hasAttribute('disabled')).toBe(true);
  expect(getComputedStyle(screen.getByRole('button', { name: /^Buy for/ })).opacity).toBe('0.4');
  await act(async () => {
    sockets.last().fireMessage(JSON.stringify({ ...quoted, step: 3, rev: 2,
      account: { ...frame.account, cashCents: 99_900_000, capCents: 49_900_000 },
      positions: [{ id: 'd1-p1', day: 1, contractId: draft.contractId, companyId: 0, side: 'up', targetCents: 8400,
        quantity: 100, entryPriceCents: 1000, costCents: 100_000, entryStep: 2, entryPriceIndex: 0,
        breakEvenCents: 8410, status: 'open', valueCents: 100_000, profitCents: 0, realCents: 0, hopeCents: 1000 }],
      receipts: [{ commandId: buys[0]!.commandId, kind: 'buy', step: 3, outcome: 'accepted', positionId: 'd1-p1' }],
    }));
    await Promise.resolve();
  });
  expect(screen.getByRole('region', { name: 'Company cards' })).toBe(cards);
  expect(within(cards).getAllByRole('button')).toEqual(buttons);
  expect(view.container.querySelector('.price-chart')).toBe(chart);
  expect(view.container.querySelector('.desk-layout')).toBe(desk);
  expect(panelEntrances()).toBe(before);
  expect(buttons.every(button => !button.hasAttribute('disabled'))).toBe(true);
  expect(buttons.map(button => getComputedStyle(button).opacity)).toEqual(Array(6).fill('1'));
  expect(buttons[0]!.getAttribute('aria-label')).toContain('your ticket');
});
