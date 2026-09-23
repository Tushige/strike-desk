// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createSocketFactory, testFrame } from './fakeSocket';

const sockets = createSocketFactory();
let App: typeof import('../src/App')['default'];
let boot: typeof import('../src/boot');
beforeAll(async () => {
  vi.stubGlobal('WebSocket', function FakeWebSocket(url: string) { return sockets.create(url); });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); } });
  boot = await import('../src/boot');
  App = (await import('../src/App')).default;
}, 30_000);
afterAll(() => { cleanup(); boot?.connection.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.sessionStorage.clear();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

it('cancels safely, then freezes the latest snapshot and forgets the abandoned run', () => {
  const frame = testFrame({ step: 1, clock: { phase: 'preBell', day: 1, stepsLeft: 299, priceIndex: 0, pace: 1 },
    account: { cashCents: 100_000_000, worthCents: 100_000_000, capCents: 50_000_000, canBuy: true } });
  render(createElement(App));
  act(() => { sockets.last().fireOpen(); sockets.last().fireMessage(JSON.stringify(frame)); });
  expect(window.sessionStorage.getItem(boot.sessionKey)).toBe(frame.session);
  expect(within(screen.getByRole('banner')).getByRole('button', { name: 'End game' })).toBeTruthy();
  expect(within(screen.getByRole('contentinfo')).queryByRole('button', { name: 'End game' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'End game' }));
  expect(screen.getByRole('dialog', { name: 'End this game?' })).toBeTruthy();
  expect(screen.getByText('You won’t be able to resume this run.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(sockets.last().closeCalls).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'End game' }));
  act(() => { sockets.last().fireMessage(JSON.stringify({ ...frame, step: 2, account: { ...frame.account, cashCents: 99_000_000, worthCents: 99_000_000 } })); });
  window.sessionStorage.setItem(`${boot.sessionKey}.journal`, 'old intent');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End game' }));
  expect(screen.getByRole('heading', { name: 'You rang your own bell.' })).toBeTruthy();
  expect(screen.getByText('$990,000')).toBeTruthy();
  expect(window.sessionStorage.getItem(boot.sessionKey)).toBeNull();
  expect(window.sessionStorage.getItem(`${boot.sessionKey}.journal`)).toBeNull();
  expect(sockets.last().closeCalls).toBe(1);
  act(() => { sockets.last().fireMessage(JSON.stringify({ ...frame, step: 3 })); });
  expect(screen.getByText('$990,000')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'End game' })).toBeNull();
});
