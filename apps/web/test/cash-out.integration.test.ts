// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173"}
/// <reference types="node" />
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { formatCents } from '@strike-desk/shared/money';
import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import type { Outbound } from '@strike-desk/shared/feed';
import { createWsFeed } from '../src/feed/wsFeed';
import type { SocketLike, WsFeedOptions } from '../src/feed/wsFeed';

interface TestSocket extends SocketLike { ping(): void; once(event: 'pong', listener: () => void): void }
const Socket = createRequire(path.resolve('apps/server/package.json'))('ws') as
  new (url: string, options: { origin: string }) => TestSocket;
const ABSENT_LEGACY_THEME_PROPERTIES = new Set([
  '--ag-grid-size', '--ag-active-color', '--ag-alpine-active-color', '--ag-balham-active-color',
  '--ag-material-primary-color', '--ag-header-foreground-color', '--ag-control-panel-background-color',
  '--ag-cell-horizontal-border', '--ag-header-column-separator-color',
]);
afterEach(() => { cleanup(); vi.doUnmock('../src/feed/wsFeed'); vi.restoreAllMocks(); window.sessionStorage.clear(); });

it.each([false, true])('cashes out from one root ticket and continues the day (open market=%s)', async (open) => {
  vi.resetModules(); window.history.replaceState(null, '', '/');
  const computedStyle = globalThis.getComputedStyle;
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computedStyle(element, pseudo);
    return new Proxy(style, { get(target, key): unknown {
      if (key === 'getPropertyValue') return (name: string) => ABSENT_LEGACY_THEME_PROPERTIES.has(name) ? '' : target.getPropertyValue(name);
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  const child = spawn('pnpm', ['--filter', '@strike-desk/server', 'exec', 'tsx', 'test/news-app.ts'], { stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  let errors = ''; child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`service readiness timeout: ${errors}`)); }, 30000);
    lines.on('line', (line) => {
      if (!line.startsWith('{')) return;
      const message: unknown = JSON.parse(line);
      if (typeof message === 'object' && message !== null && 'url' in message && typeof message.url === 'string') { clearTimeout(timer); resolve(message.url); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`service exited: ${errors}`)); });
  });
  let feed: ReturnType<typeof createWsFeed> | undefined;
  let socket: TestSocket | undefined;
  let sockets = 0;
  let holdNextSale = false;
  const messages: ServerMessage[] = [];
  const outbound: Outbound[] = [];
  let disposeStores = () => {};
  try {
    const url = await ready;
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: (options: WsFeedOptions) => {
      const live = createWsFeed({ ...options, url, createSocket: (address) => {
        sockets += 1; socket = new Socket(address, { origin: window.location.origin }); return socket;
      } });
      feed = live;
      live.subscribe((event) => { if (event.type === 'message') messages.push(event.message); });
      return { ...live, send(message: Outbound) {
        outbound.push(message);
        if (message.t === 'cashOut' && holdNextSale) { holdNextSale = false; return false; }
        return live.send(message);
      } };
    } }));
    const { default: App } = await import('../src/App');
    const boot = await import('../src/boot');
    disposeStores = () => { boot.buyFlow.dispose(); boot.deskFreshness.dispose(); boot.gameLoop.dispose(); };
    const view = render(createElement(App));
    async function sample(ms = 0): Promise<Frame> {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('socket barrier timeout')); }, 3000);
        socket!.once('pong', () => { clearTimeout(timer); resolve(); }); socket!.ping();
      });
      const before = messages.filter((message) => message.t === 'frame').length;
      await act(async () => { child.stdin.write(`${String(ms)}\n`); await waitFor(() => { expect(messages.filter((message) => message.t === 'frame')).toHaveLength(before + 1); }); });
      const frame = messages.at(-1); if (frame?.t !== 'frame') throw new Error('missing sample'); return frame;
    }
    async function buyTicket() {
      const panel = view.getByRole('region', { name: 'Your ticket' });
      fireEvent.click(within(panel).getAllByRole('button', { name: /^Close/ })[0]!);
      fireEvent.change(within(panel).getByRole('textbox'), { target: { value: '1000' } });
      await waitFor(() => { expect(outbound.at(-1)).toMatchObject({ t: 'draft', spendCents: 100000 }); }, { timeout: 2500 });
      await sample(200);
      const action = within(panel).getByRole<HTMLButtonElement>('button', { name: 'Buy ticket' });
      expect(action.disabled).toBe(false);
      fireEvent.click(action);
      await waitFor(() => { expect(within(panel).getByRole('status').textContent).toBe('Accepted. The ticket is yours.'); });
      return panel;
    }
    fireEvent.click(await view.findByRole('button', { name: 'Start at normal speed' }));
    await view.findByRole('heading', { name: 'Day 1: before the bell' });
    expect(outbound.filter((message) => message.t === 'buy' || message.t === 'cashOut')).toEqual([]);
    if (open) {
      fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
      await view.findByRole('heading', { name: 'Day 1: the market is open' });
    }
    const panel = await buyTicket();
    expect(view.queryByText('Cash out before the closing bell, or hold to settle at the bell.')).not.toBeNull();
    expect(view.queryByText('Tickets settle at the closing bell. Cashing out is not available yet.')).toBeNull();
    const disclosure = view.getByRole('button', { name: 'Compare options' });
    fireEvent.click(disclosure); await view.findByRole('grid', { name: 'Contracts' }); fireEvent.click(disclosure);
    expect(view.getByRole('region', { name: 'Your ticket' })).toBe(panel);
    expect(outbound.filter((message) => message.t === 'cashOut')).toEqual([]);
    fireEvent.click(within(panel).getByRole('button', { name: 'Cash out' }));
    expect(within(panel).getByRole('status').textContent).toBe('Pending...');
    await waitFor(() => { expect(within(panel).getByRole('status').textContent).toBe('You cashed out'); });
    const sold = messages.find((message) => message.t === 'reply' && message.receipt.kind === 'cashOut');
    if (sold?.t !== 'reply') throw new Error('missing sale reply');
    expect(sold.receipt.outcome).toBe('accepted');
    expect(sold.frame.clock.phase).toBe(open ? 'open' : 'preBell');
    expect(sold.frame.account.canBuy).toBe(false);
    expect(within(panel).getByText('Money back in your pocket').nextElementSibling?.textContent).toBe(formatCents(sold.frame.positions[0]!.exit!.proceedsCents));
    expect(view.queryByText('Cash out before the closing bell, or hold to settle at the bell.')).toBeNull();
    expect(view.getByText('This is what your ticket would be worth right now. Keep watching. It can still go either way.')).toBeTruthy();
    if (!open) {
      fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
      await view.findByRole('heading', { name: 'Day 1: the market is open' });
    }
    expect(view.getByRole('button', { name: 'Skip to the closing bell' })).toBeTruthy();
    expect(sockets).toBe(1);
    if (!open) return;

    // Reach the final-day route through explicit clock controls, then retain
    // one unanswered sale after the daily form leaves the screen.
    for (let day = 1; day < 5; day += 1) {
      fireEvent.click(view.getByRole('button', { name: 'Skip to the closing bell' }));
      await view.findByRole('heading', { name: `Day ${String(day)}: closing bell` });
      fireEvent.click(view.getByRole('button', { name: `Go to day ${String(day + 1)}` }));
      await view.findByRole('heading', { name: `Day ${String(day + 1)}: before the bell` });
      // Advance the injected server clock between days so this accelerated
      // journey respects the real socket's message-rate window.
      await sample(10000);
      fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
      await view.findByRole('heading', { name: `Day ${String(day + 1)}: the market is open` });
    }
    const lastPanel = await buyTicket(); holdNextSale = true;
    fireEvent.click(within(lastPanel).getByRole('button', { name: 'Cash out' }));
    expect(within(lastPanel).getByRole('status').textContent).toBe('Checking...');
    const original = outbound.at(-1);
    expect(original).toMatchObject({ t: 'cashOut' });
    fireEvent.click(view.getByRole('button', { name: 'Skip to the closing bell' }));
    await view.findByRole('heading', { name: 'Day 5: closing bell' });
    fireEvent.click(view.getByRole('button', { name: 'See your final result' }));
    await view.findByRole('heading', { name: 'That was the final bell!' });
    expect(view.getAllByRole('status').some((status) => status.textContent === 'Checking...')).toBe(true);
    expect(view.queryByRole('region', { name: 'Your ticket' })).toBeNull();
    expect(view.queryByRole('textbox')).toBeNull();
    const beforeRetry = await sample();
    fireEvent.click(view.getByRole('button', { name: 'Retry safely' }));
    await view.findByText('Your ticket settled at the closing bell.');
    const answer = messages.at(-1);
    if (answer?.t !== 'reply') throw new Error('missing retained sale receipt');
    expect(answer.receipt).toMatchObject({ kind: 'cashOut', outcome: 'accepted' });
    expect(answer.frame.account).toEqual(beforeRetry.account);
    expect(answer.frame.positions.at(-1)?.exit?.kind).toBe('bell');
    expect(outbound.filter((message) => message.t === 'cashOut').slice(-2)).toEqual([original, original]);
    expect(outbound.filter((message) => message.t === 'buy')).toHaveLength(2);
    expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
    expect(sockets).toBe(1);
    expect(messages.filter((message) => message.t === 'error')).toEqual([]);
  } finally {
    cleanup(); feed?.close(); disposeStores(); child.stdin.end('close\n');
    await new Promise<void>((resolve) => { const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    lines.close();
  }
}, 45000);
