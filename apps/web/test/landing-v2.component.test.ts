// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createSocketFactory, testFrame } from './fakeSocket';

const sockets = createSocketFactory();
let App: typeof import('../src/App')['default'];
let close: () => void;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => ({
    completedGames: '12', pretendProfitsEarnedCents: '140000000', bestNetProfitCents: '40000000', currency: 'pretend-USD',
  }) }));
  vi.stubGlobal('WebSocket', function FakeWebSocket(url: string) { return sockets.create(url); });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  window.history.replaceState({}, '', '/');
  const { connection } = await import('../src/boot');
  close = () => { connection.close(); };
  App = (await import('../src/App')).default;
}, 30_000);
afterAll(() => {
  cleanup(); close(); vi.unstubAllGlobals(); window.sessionStorage.clear(); window.history.replaceState({}, '', '/');
});

it('defaults to V2, preserves the original fallback, and starts the real game with the selected pace', async () => {
  window.history.replaceState({}, '', '/?landing=original');
  const view = render(createElement(App));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Here is $1,000,000.');
  expect(screen.getByRole('button', { name: 'Connecting to the desk…' }).hasAttribute('disabled')).toBe(true);

  window.history.replaceState({}, '', '/');
  view.rerender(createElement(App));
  await screen.findByRole('heading', { level: 1, name: /Grow it.*Or blow it/ });
  expect(view.container.querySelector('.contrast-page')?.getAttribute('data-palette')).toBe('lilac');
  expect(screen.queryByRole('complementary', { name: 'Sketch controls' })).toBeNull();
  const stats = await screen.findByRole('region', { name: /The desk, so far/ });
  expect(stats.textContent).toContain('Games completed');
  expect(stats.textContent).toContain('Pretend profits earned');
  expect(stats.textContent).toContain('Best completed run');
  expect(await screen.findByRole('img', { name: '12' })).toBeTruthy();
  expect(stats.textContent).toContain('Starting $1M excluded');
  expect(screen.queryByRole('banner')?.textContent).not.toContain('Total worth');
  expect(screen.getByRole('button', { name: 'Connecting to the desk…' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('status', { name: 'Loading companies' })).toBeTruthy();

  const socket = sockets.last();
  await act(async () => {
    socket.fireOpen(); socket.fireMessage(JSON.stringify(testFrame()));
    await Promise.resolve();
  });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Read the news.' }), { key: 'End' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Beat the bell.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Beat the bell.' }));
  expect(screen.queryByRole('status', { name: 'Loading companies' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Beat the bell.' }).getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('region', { name: 'Beat the bell.' }).textContent).toContain('A payout isn’talways a profit.');
  fireEvent.click(screen.getByRole('button', { name: 'Make your move.' }));
  expect(screen.getByRole('region', { name: 'Make your move.' }).textContent).toContain('Sit this one out.');
  fireEvent.click(screen.getByRole('button', { name: 'Read the news.' }));
  expect(screen.getByRole('region', { name: 'Read the news.' }).textContent).toContain('fetch your slippers');

  fireEvent.click(screen.getByRole('button', { name: '5 min' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open the desk' }));
  fireEvent.click(screen.getByRole('button', { name: 'Opening the desk…' }));
  const commands = socket.sent.map(text => JSON.parse(text) as { t: string; commandId: string; pace?: number }).filter(command => command.t === 'start');
  expect(commands).toHaveLength(1);
  expect(commands[0]?.pace).toBe(3);
  expect(screen.getByRole('button', { name: 'Opening the desk…' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Grow it.');

  await act(async () => {
    socket.fireMessage(JSON.stringify(testFrame({ rev: 1, step: 1,
      clock: { phase: 'preBell', day: 1, stepsLeft: 299, priceIndex: 0, pace: 3 },
      receipts: [{ commandId: commands[0]!.commandId, kind: 'start', step: 1, outcome: 'accepted' }],
    })));
    await Promise.resolve();
  });
  expect(screen.getByRole('navigation', { name: 'Desk sections' })).toBeTruthy();
  expect(screen.queryByRole('heading', { level: 1, name: /Grow it/ })).toBeNull();
});
