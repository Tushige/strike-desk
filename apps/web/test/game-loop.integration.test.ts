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
import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import { formatCents } from '@strike-desk/shared/money';
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

afterEach(() => {
  cleanup();
  vi.doUnmock('../src/feed/wsFeed');
  window.sessionStorage.clear();
});

it.each([
  [1, 'Start at normal speed', null], [3, 'Start fast (3x)', null], [7.5, 'Start turbo (7.5x)', null],
  [3, 'Start fast (3x)', 2500],
] as const)('waits for an explicit start at pace %s and opens the server bell (%s, board %s)', async (pace, label, board) => {
  vi.resetModules();
  // These legacy aliases are absent from the browser's theme. Avoid jsdom's
  // recursive inherited-variable lookup; every other computed style stays real.
  const computedStyle = globalThis.getComputedStyle;
  const styleLookup = vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computedStyle(element, pseudo);
    return new Proxy(style, { get(target, key): unknown {
      if (key === 'getPropertyValue') return (name: string) => ABSENT_LEGACY_THEME_PROPERTIES.has(name) ? '' : target.getPropertyValue(name);
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  window.history.replaceState(null, '', board === null ? '/' : '/?board=2500');
  const child = spawn('pnpm', ['--filter', '@strike-desk/server', 'exec', 'tsx', 'test/news-app.ts'], { stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service readiness timeout: ${errors}`)), 30000);
    lines.on('line', (line) => {
      if (!line.startsWith('{')) return;
      const message: unknown = JSON.parse(line);
      if (typeof message === 'object' && message !== null && 'url' in message && typeof message.url === 'string') {
        clearTimeout(timer); resolve(message.url);
      }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`service exited: ${errors}`)); });
  });
  const messages: ServerMessage[] = [];
  const outbound: Outbound[] = [];
  let feed: ReturnType<typeof createWsFeed> | undefined;
  let sockets = 0;
  let receiveFrames = true;
  try {
    const url = await ready;
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: (options: WsFeedOptions) => {
      const live = createWsFeed({ ...options, url, createSocket: (address) => {
        sockets += 1; return new Socket(address, { origin: window.location.origin });
      } });
      live.subscribe((event) => { if (event.type === 'message') messages.push(event.message); });
      feed = { ...live,
        subscribe: (listener: Parameters<typeof live.subscribe>[0]) => live.subscribe((event) => {
          if (receiveFrames || event.type !== 'message') listener(event);
        }),
        send: (message: Outbound) => { outbound.push(message); return live.send(message); } };
      return feed;
    } }));
    const { default: App } = await import('../src/App');
    let view = render(createElement(App));
    await waitFor(() => expect(messages[0]?.t).toBe('frame'));
    expect(outbound).toEqual([]);
    expect(view.getAllByText(board === null ? 'Five trading days. Read the news, buy tickets, and see how you finish.'
      : 'Buying is switched off while the stress test runs.').length).toBeGreaterThan(0);
    expect(view.queryByText('Tickets settle at the closing bell. Cashing out is not available yet.')).toBeNull();
    expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
    async function sample(ms: number): Promise<Frame> {
      const count = messages.length;
      await act(async () => {
        child.stdin.write(`${String(board === null ? ms : Math.max(ms, 1500))}\n`);
        await waitFor(() => expect(messages.length).toBe(count + 1));
      });
      const newest = messages.at(-1);
      if (newest?.t !== 'frame') throw new Error('missing sampled frame');
      return newest;
    }
    expect((await sample(1000000)).clock.phase).toBe('lobby');
    expect(outbound).toEqual([]);
    fireEvent.click(view.getByRole('button', { name: label }));
    expect(view.getByText('Checking...')).toBeTruthy();
    await view.findByRole('heading', { name: 'Day 1: before the bell' });
    expect(outbound.filter((message) => message.t !== 'draft')).toHaveLength(1);
    expect(outbound[0]).toMatchObject({ t: 'start', pace });
    const reply = messages.at(-1);
    if (reply?.t !== 'reply') throw new Error('missing start reply');
    // $1,000,000 in cents; half is available as the cap. Preview spends nothing.
    expect(reply.frame.account).toEqual({ cashCents: 100000000, worthCents: 100000000, capCents: 50000000, canBuy: board === null });
    expect(reply.frame.leadIn?.[0]).toHaveLength(40);
    expect(reply.frame.history?.[0]).toHaveLength(1);
    expect(view.getAllByText('$1,000,000').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(view.getByRole('button', { name: 'Compare options' }));
    const grid = await view.findByRole('grid', { name: 'Contracts' });
    await waitFor(() => expect(grid.querySelector('.ag-row[row-id="0"] [col-id="company"]')).not.toBeNull());
    fireEvent.click(grid.querySelector('.ag-row[row-id="0"] [col-id="company"]')!);
    const spend = view.getByRole('textbox', { name: 'How much to spend' }) as HTMLInputElement;
    fireEvent.change(spend, { target: { value: '1000.50' } });
    const beforeBell = await sample(200);
    expect(beforeBell.prices).toEqual(reply.frame.prices);
    fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
    await view.findByRole('heading', { name: 'Day 1: the market is open' });
    // A comparison request can follow the bell before its assertion runs.
    // Make that ordering deterministic with the same current draft.
    expect(feed?.send({ t: 'draft', contractId: 0, spendCents: 100050 })).toBe(true);
    expect(outbound.at(-1)).toEqual({ t: 'draft', contractId: 0, spendCents: 100050 });
    const opening = messages.find((message) => message.t === 'reply' && message.receipt.kind === 'openBell');
    if (opening?.t !== 'reply') throw new Error('missing opening-bell receipt');
    expect(opening.receipt.outcome).toBe('accepted');
    expect(opening.receipt.commandId).not.toBe(reply.receipt.commandId);
    expect(outbound.filter((message) => message.t !== 'draft')).toHaveLength(2);
    expect(outbound.filter((message) => message.t === 'openBell')).toEqual([
      { t: 'openBell', day: 1, commandId: opening.receipt.commandId },
    ]);
    expect(view.getAllByText(board === null ? 'Prices are moving. You can buy one ticket today, until the closing bell.'
      : 'Buying is switched off while the stress test runs.').length).toBeGreaterThan(0);
    const chartFrame = await sample(400);
    const chart = view.queryByRole('img', { name: chartFrame.companies[0]?.name });
    expect(chart).not.toBeNull();
    expect(chartFrame.history?.[0]).toHaveLength(chartFrame.clock.priceIndex + 1);
    expect(chartFrame.leadIn?.[0]).toHaveLength(40);
    expect(view.getByRole('textbox', { name: 'How much to spend' })).toBe(spend);
    expect(spend.value).toBe('1000.50');
    await waitFor(() => expect(chart?.querySelector('path')?.getAttribute('d')?.split('L')).toHaveLength(40 + chartFrame.clock.priceIndex + 1));
    const { chartStore } = await import('../src/boot');
    const heldHistory = chartStore.source(0).series();
    receiveFrames = false;
    await sample(1500);
    expect(chartStore.source(0).series()).toBe(heldHistory);
    receiveFrames = true;
    const repaired = await sample(1500);
    expect(chartStore.source(0).series().values).toEqual([...repaired.leadIn![0]!, ...repaired.history![0]!]);
    expect(view.queryByText('Market number')).toBeNull();
    const buy = view.getByRole('button', { name: 'Buy ticket' }) as HTMLButtonElement;
    if (board !== null) expect(buy.disabled).toBe(true);
    expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
    expect(sockets).toBe(1);
    expect(outbound.every((message) => message.t === 'start' || message.t === 'openBell' || message.t === 'draft')).toBe(true);
    for (const day of [1, 2, 3, 4, 5]) {
      // Let the server's input budget refill between deliberate day controls.
      // Even at turbo this stays within the pre-bell/open phase.
      await sample(2000);
      if (day !== 1) {
        fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
        await view.findByRole('heading', { name: `Day ${String(day)}: the market is open` });
      }
      fireEvent.click(view.getByRole('button', { name: 'Skip to the closing bell' }));
      await view.findByRole('heading', { name: `Day ${String(day)}: closing bell` });
      expect(view.getByText('A quiet day.')).toBeTruthy();
      if (day === 1) {
        expect(view.getByRole('textbox', { name: 'How much to spend' })).toBe(spend);
        expect(spend.value).toBe('1000.50');
        expect(view.getByRole('grid', { name: 'Contracts' })).toBe(grid);
      }
      expect(view.getByText('Change today').nextElementSibling?.textContent).toBe('$0');
      expect(view.getByText('Ended the day with').nextElementSibling?.textContent).toBe('$1,000,000');
      expect(view.queryByText('Market number')).toBeNull();
      const closing = messages.at(-1);
      if (closing?.t !== 'reply') throw new Error('missing closing history');
      fireEvent.click(view.getByRole('button', { name: day === 5 ? 'See your final result' : `Go to day ${String(day + 1)}` }));
      await view.findByRole('heading', { name: day === 5 ? 'That was the final bell!' : `Day ${String(day + 1)}: before the bell` });
      if (day < 5) {
        const next = messages.at(-1);
        if (next?.t !== 'reply') throw new Error('missing next day history');
        expect(next.frame.leadIn?.[0]).toEqual(closing.frame.history?.[0]?.slice(460, 500));
        expect(next.frame.history?.[0]).toEqual([closing.frame.history?.[0]?.[500]]);
        const nextChart = view.getByRole('img', { name: next.frame.companies[0]?.name });
        await waitFor(() => expect(nextChart.querySelector('path')?.getAttribute('d')?.split('L')).toHaveLength(41));
        if (day === 1) {
          const session = next.frame.session;
          view.unmount(); feed?.close();
          vi.resetModules();
          const { default: ResumedApp } = await import('../src/App');
          view = render(createElement(ResumedApp));
          await view.findByRole('heading', { name: 'Day 2: before the bell' });
          const resumed = messages.at(-1);
          expect(resumed).toMatchObject({ t: 'frame', session, clock: { day: 2, phase: 'preBell' } });
          expect(outbound.filter((message) => message.t === 'start')).toHaveLength(1);
        }
      }
    }
    expect(view.getByText('You finished with').nextElementSibling?.textContent).toBe('$1,000,000');
    expect(view.getByText('Since the start').nextElementSibling?.textContent).toBe('$0');
    expect(view.getByText('Market number').nextElementSibling?.textContent).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{4}$/);
    expect(view.getByRole('table', { name: 'Day by day' }).querySelectorAll('tbody tr')).toHaveLength(5);
    expect((await sample(1500)).clock.phase).toBe('final');
    const oldSession = reply.frame.session;
    const reload = vi.fn();
    const realWindow = window;
    vi.stubGlobal('window', new Proxy(realWindow, { get(target, key): unknown {
      return key === 'location' ? { ...target.location, reload } : Reflect.get(target, key);
    } }));
    fireEvent.click(view.getByRole('button', { name: 'Play again' }));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    view.unmount(); feed?.close();
    // Recreate the page after the requested navigation. Feed's final frame
    // already forgot the old session; unrelated tab storage stays untouched.
    window.sessionStorage.setItem('unrelated', 'keep');
    vi.resetModules();
    const { default: FreshApp } = await import('../src/App');
    const freshView = render(createElement(FreshApp));
    await freshView.findByRole('button', { name: label });
    const fresh = messages.at(-1);
    if (fresh?.t !== 'frame') throw new Error('missing fresh lobby');
    expect(fresh.clock.phase).toBe('lobby');
    expect(fresh.session).not.toBe(oldSession);
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep');
  } finally {
    styleLookup.mockRestore();
    vi.unstubAllGlobals();
    cleanup(); feed?.close(); child.stdin.end('close\n');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    lines.close();
  }
}, 45000);

it.each(['before delivery', 'after acceptance'] as const)('recovers an opening bell lost %s through the real mounted desk', async (loss) => {
  vi.resetModules(); window.history.replaceState(null, '', '/');
  const child = spawn('pnpm', ['--filter', '@strike-desk/server', 'exec', 'tsx', 'test/news-app.ts'], { stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service readiness timeout: ${errors}`)), 30000);
    lines.on('line', (line) => {
      if (!line.startsWith('{')) return;
      const message: unknown = JSON.parse(line);
      if (typeof message === 'object' && message !== null && 'url' in message && typeof message.url === 'string') {
        clearTimeout(timer); resolve(message.url);
      }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`service exited: ${errors}`)); });
  });
  let feed: ReturnType<typeof createWsFeed> | undefined;
  let lose = true;
  const outbound: Outbound[] = [];
  const messages: ServerMessage[] = [];
  try {
    const url = await ready;
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: (options: WsFeedOptions) => {
      const live = createWsFeed({ ...options, url, random: () => 0.5, createSocket: (address) => new Socket(address, { origin: window.location.origin }) });
      feed = live;
      live.subscribe((event) => { if (event.type === 'message') messages.push(event.message); });
      return {
        ...live,
        send: (message: Outbound) => {
          outbound.push(message);
          if (lose && loss === 'before delivery' && message.t === 'openBell') return true;
          return live.send(message);
        },
        subscribe: (listener: Parameters<typeof live.subscribe>[0]) => live.subscribe((event) => {
          if (lose && loss === 'after acceptance' && event.type === 'message' && event.message.t === 'reply' && event.message.receipt.kind === 'openBell') return;
          listener(event);
        }),
      };
    } }));
    const { default: App } = await import('../src/App');
    const view = render(createElement(App));
    fireEvent.click(await view.findByRole('button', { name: 'Start fast (3x)' }));
    const bell = await view.findByRole('button', { name: 'Ring the opening bell' });
    fireEvent.click(bell);
    expect(view.getByText('Checking...')).toBeTruthy();
    expect((bell as HTMLButtonElement).disabled).toBe(true);
    if (loss === 'after acceptance') await waitFor(() => expect(messages.some((message) => message.t === 'reply' && message.receipt.kind === 'openBell')).toBe(true));
    const first = outbound.find((message) => message.t === 'openBell');
    await act(async () => {
      feed?.simulateDrop(); lose = false;
      await waitFor(() => expect(messages.filter((message) => message.t === 'frame')).toHaveLength(2), { timeout: 5000 });
    });
    expect(outbound.filter((message) => message.t === 'openBell')).toHaveLength(1);
    if (loss === 'before delivery') {
      const retry = await view.findByRole('button', { name: 'Retry safely' });
      expect(view.getByText('Send the same request again. It will not happen twice.')).toBeTruthy();
      expect((view.getByRole('button', { name: 'Ring the opening bell' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(retry);
      expect(outbound.filter((message) => message.t === 'openBell')).toEqual([first, first]);
    } else expect(view.queryByRole('button', { name: 'Retry safely' })).toBeNull();
    await view.findByRole('heading', { name: 'Day 1: the market is open' });
    expect(view.queryByText('Checking...')).toBeNull();
    const current = messages.at(-1);
    const frame = current?.t === 'reply' ? current.frame : current?.t === 'frame' ? current : null;
    expect(frame?.rev).toBe(2);
    expect(frame?.receipts.filter((receipt) => receipt.kind === 'openBell')).toHaveLength(1);
    expect(frame?.leadIn?.[0]).toHaveLength(40);
    expect(frame?.history?.[0]).toHaveLength(1);
  } finally {
    cleanup(); feed?.close(); child.stdin.end('close\n');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    }); lines.close();
  }
}, 45000);

it('trades through five real days with sales, holds and an original-day late receipt', async () => {
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

    fireEvent.click(await view.findByRole('button', { name: 'Start at normal speed' }));
    await view.findByRole('heading', { name: 'Day 1: before the bell' });
    const positionIds: string[] = [];
    let delayedSale: Outbound | undefined;
    const signed = (cents: number) => `${cents > 0 ? '+' : ''}${formatCents(cents)}`;
    const lastReply = (kind: string) => {
      const message = messages.findLast((item) => item.t === 'reply' && item.receipt.kind === kind);
      if (message?.t !== 'reply') throw new Error(`missing ${kind} receipt`);
      expect(message.receipt.outcome).toBe('accepted');
      return message;
    };
    for (const day of [1, 2, 3, 4, 5]) {
      await view.findByRole('heading', { name: `Day ${String(day)}: before the bell` });
      // The injected wall clock refills the unchanged real socket budget.
      await sample(10000);
      const panel = view.getByRole('region', { name: 'Your ticket' });
      const input = within(panel).getByRole<HTMLInputElement>('textbox', { name: 'How much to spend' });
      expect(input.value).toBe('');
      expect(boot.comparisonStore.requested.get().contractId).toBeNull();
      expect(outbound.filter((item) => item.t === 'buy')).toHaveLength(day - 1);
      if (day === 2 || day === 3) {
        fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
        await view.findByRole('heading', { name: `Day ${String(day)}: the market is open` });
      }
      if (day === 2) {
        fireEvent.click(view.getByRole('button', { name: 'Compare options' }));
        const grid = await view.findByRole('grid', { name: 'Contracts' });
        await waitFor(() => { expect(grid.querySelector('.ag-row[row-id="0"] [col-id="company"]')).not.toBeNull(); });
        fireEvent.click(grid.querySelector('.ag-row[row-id="0"] [col-id="company"]')!);
        await waitFor(() => { expect(boot.comparisonStore.requested.get().contractId).toBe(0); });
      } else fireEvent.click(within(panel).getAllByRole('button', { name: /^Close/ })[0]!);
      const chosen = boot.comparisonStore.requested.get().contractId;
      fireEvent.change(input, { target: { value: '1000.50' } });
      await waitFor(() => { expect(outbound.at(-1)).toEqual({ t: 'draft', contractId: chosen, spendCents: 100050 }); }, { timeout: 2500 });
      const quoted = await sample(200);
      expect(quoted.draft?.ticket?.contractId).toBe(chosen);

      if (day === 5) {
        // Yesterday's unanswered sale resolves without replacing today's draft.
        expect(boot.buyFlow.transaction.get()?.command).toEqual(delayedSale);
        fireEvent.click(view.getByRole('button', { name: 'Retry safely' }));
        await view.findByText('Day 4: settled at the bell.');
        const recovered = lastReply('cashOut');
        expect(recovered.receipt.commandId).toBe(delayedSale?.t === 'cashOut' ? delayedSale.commandId : '');
        expect(recovered.frame.account).toEqual(quoted.account);
        expect(boot.comparisonStore.requested.get()).toEqual({ contractId: chosen, spendCents: 100050 });
        expect(input.value).toBe('1000.50');
        expect(view.getByRole('region', { name: 'Your ticket' })).toBe(panel);
      }

      const buy = within(panel).getByRole<HTMLButtonElement>('button', { name: 'Buy ticket' });
      expect(buy.disabled).toBe(false);
      fireEvent.click(buy);
      expect(within(panel).getByRole('status').textContent).toBe('Pending...');
      await waitFor(() => { expect(within(panel).getByRole('status').textContent).toBe('Accepted. The ticket is yours.'); });
      const purchase = lastReply('buy');
      const position = purchase.frame.positions.find((item) => item.day === day)!;
      positionIds.push(position.id);
      expect(new Set(positionIds).size).toBe(day);
      expect(position).toMatchObject({ contractId: chosen, status: 'open', entryPriceCents: quoted.draft!.ticket!.priceCents,
        costCents: quoted.draft!.ticket!.costCents, quantity: quoted.draft!.ticket!.quantity });
      expect(purchase.frame.account.canBuy).toBe(false);
      expect(within(panel).getByText('Bought for').nextElementSibling?.textContent).toBe(formatCents(position.costCents));
      expect(view.queryByRole('textbox')).toBeNull();
      expect(view.queryByRole('button', { name: 'Buy ticket' })).toBeNull();

      let sale: Frame['positions'][number] | undefined;
      if (day === 1 || day === 3) {
        fireEvent.click(within(panel).getByRole('button', { name: 'Cash out' }));
        await waitFor(() => { expect(within(panel).getByRole('status').textContent).toBe('You cashed out'); });
        const result = lastReply('cashOut');
        sale = result.frame.positions.find((item) => item.id === position.id)!;
        expect(result.frame.clock.phase).toBe(day === 1 ? 'preBell' : 'open');
        expect(sale.exit?.kind).toBe('cashOut');
        expect(result.frame.account.canBuy).toBe(false);
        expect(within(panel).getByText('Money back in your pocket').nextElementSibling?.textContent).toBe(formatCents(sale.exit!.proceedsCents));
        expect(within(panel).getByText('If you had held on').nextElementSibling?.textContent).toContain(formatCents(sale.ifHeldCents!));
        expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
      }
      if (day === 1 || day === 4 || day === 5) {
        fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
        await view.findByRole('heading', { name: `Day ${String(day)}: the market is open` });
      }
      const watching = await sample(2000);
      if (sale !== undefined) {
        const held = watching.positions.find((item) => item.id === position.id)!;
        expect(held.exit).toEqual(sale.exit);
        expect(held.profitCents).toBe(sale.profitCents);
        await waitFor(() => {
          expect(within(panel).getByText('If you had held on').nextElementSibling?.textContent).toContain(formatCents(held.ifHeldCents!));
        });
        expect(within(panel).getByText('Money back in your pocket').nextElementSibling?.textContent).toBe(formatCents(sale.exit!.proceedsCents));
      }
      if (day === 4) {
        holdNextSale = true;
        fireEvent.click(within(panel).getByRole('button', { name: 'Cash out' }));
        delayedSale = outbound.at(-1);
        expect(delayedSale).toMatchObject({ t: 'cashOut', positionId: position.id });
        expect(within(panel).getByRole('status').textContent).toBe('Checking...');
      }
      fireEvent.click(view.getByRole('button', { name: 'Skip to the closing bell' }));
      await view.findByRole('heading', { name: `Day ${String(day)}: closing bell` });
      const closing = lastReply('skipToBell').frame;
      const closedPosition = closing.positions.find((item) => item.id === position.id)!;
      expect(closedPosition.status).toBe(sale === undefined ? 'settled' : 'cashedOut');
      expect(closedPosition.exit?.kind).toBe(sale === undefined ? 'bell' : 'cashOut');
      expect(closing.positions.filter((item) => item.day === day)).toHaveLength(1);
      if (sale !== undefined) {
        expect(closedPosition.exit).toEqual(sale.exit);
        expect(within(panel).getByText('If you had held to the bell').nextElementSibling?.textContent).toContain(formatCents(closedPosition.ifHeldCents!));
      } else expect(within(panel).getByText('Paid at the bell').nextElementSibling?.textContent).toBe(formatCents(closedPosition.exit!.proceedsCents));
      const dayResult = closing.days.find((item) => item.day === day)!;
      expect(dayResult.endCents).toBe(closing.account.cashCents);
      expect(view.getByText('Ended the day with').nextElementSibling?.textContent).toBe(formatCents(dayResult.endCents));
      expect(view.getByText('Change today').nextElementSibling?.textContent).toBe(signed(dayResult.changeCents));
      expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
      expect(outbound.filter((item) => item.t === 'buy')).toHaveLength(day);
      const frozen = await sample(200);
      expect(frozen.positions).toEqual(closing.positions);
      expect(frozen.account).toEqual(closing.account);
      expect(frozen.days).toEqual(closing.days);
      fireEvent.click(view.getByRole('button', { name: day === 5 ? 'See your final result' : `Go to day ${String(day + 1)}` }));
      await view.findByRole('heading', { name: day === 5 ? 'That was the final bell!' : `Day ${String(day + 1)}: before the bell` });
    }
    const final = lastReply('nextDay').frame;
    expect(final.clock.phase).toBe('final');
    expect(final.positions.map((item) => item.id)).toEqual(positionIds);
    expect(final.days.map((item) => item.day)).toEqual([1, 2, 3, 4, 5]);
    expect(view.getByText('You finished with').nextElementSibling?.textContent).toBe(formatCents(final.final!.finalCents));
    expect(view.getByText('Since the start').nextElementSibling?.textContent).toBe(signed(final.final!.changeCents));
    expect(final.account.cashCents).toBe(final.final!.finalCents);
    const finalRows = view.getByRole('table', { name: 'Day by day' }).querySelectorAll('tbody tr');
    expect(finalRows).toHaveLength(5);
    for (const [index, result] of final.days.entries()) expect(finalRows[index]?.textContent).toContain(formatCents(result.endCents));
    expect(view.queryByRole('region', { name: 'Your ticket' })).toBeNull();
    expect(view.queryByRole('button', { name: /Buy ticket|Cash out/ })).toBeNull();
    const trades = outbound.filter((item) => item.t === 'buy' || item.t === 'cashOut');
    expect(trades.filter((item) => item.t === 'buy')).toHaveLength(5);
    expect(trades.filter((item) => item.t === 'cashOut')).toHaveLength(4);
    expect(new Set(trades.map((item) => item.commandId)).size).toBe(8);
    expect(trades.filter((item) => item.t === 'cashOut').slice(-2)).toEqual([delayedSale, delayedSale]);
    expect(messages.filter((item) => item.t === 'error')).toEqual([]);
    expect(sockets).toBe(1);
  } finally {
    vi.restoreAllMocks(); cleanup(); feed?.close(); disposeStores(); child.stdin.end('close\n');
    await new Promise<void>((resolve) => { const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    lines.close();
  }
}, 45000);
