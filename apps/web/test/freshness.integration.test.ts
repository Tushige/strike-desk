// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173"}
/// <reference types="node" />
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import type { Feed, Outbound } from '@strike-desk/shared/feed';
import { formatCents } from '@strike-desk/shared/money';
import { createWsFeed } from '../src/feed/wsFeed';
import type { SocketLike, WsFeedOptions } from '../src/feed/wsFeed';
import { createSocketFactory, testFrame } from './fakeSocket';
import { createGameStore } from '../src/store/gameStore';

const stops: (() => void)[] = [];
afterEach(() => {
  cleanup();
  stops.splice(0).forEach((stop) => { stop(); });
  vi.doUnmock('../src/feed/wsFeed');
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

async function desk(processingDelay = 0, strict = false) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const sockets = createSocketFactory();
  vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: (options: WsFeedOptions) => {
    const feed = createWsFeed({ ...options, createSocket: (url) => sockets.create(url), random: () => 0.5 });
    if (processingDelay > 0) feed.subscribe((event) => { if (event.type === 'message') vi.advanceTimersByTime(processingDelay); });
    stops.push(() => { feed.close(); });
    return feed;
  } }));
  const boot = await import('../src/boot');
  const { ComparisonDesk } = await import('../src/comparison/ComparisonDesk');
  const element = createElement(ComparisonDesk, { comparison: boot.comparisonStore, game: boot.store });
  const view = render(strict ? createElement(StrictMode, null, element) : element);
  act(() => { sockets.last().fireOpen(); });
  const send = (frame: ServerMessage) => { act(() => { sockets.last().fireMessage(JSON.stringify(frame)); }); };
  const advance = (ms: number) => { act(() => { vi.advanceTimersByTime(ms); }); };
  return { view, sockets, send, advance, boot };
}

const openFrame = () => testFrame({ clock: { phase: 'open', day: 1, stepsLeft: 100, priceIndex: 1, pace: 1 }, step: 1 });

it('shows waiting at the accepted-data deadline and elapsed age through the desk', async () => {
  const { view, send, advance } = await desk();
  advance(100);
  send(openFrame());
  advance(1499);
  expect(view.queryByText('Last update: 1 seconds ago')).toBeNull();
  advance(1);
  expect(view.queryByText('Waiting for new prices')).not.toBeNull();
  expect(view.queryByText('Last update: 1 seconds ago')).not.toBeNull();
  advance(1500);
  expect(view.queryByText('Last update: 3 seconds ago')).not.toBeNull();
});

function boardFrame(): Frame {
  return testFrame({ ...openFrame(), stress: true,
    board: { targetsPerCompany: 1, companies: [{ targets: [8000], lowestUpIndex: 0, highestDownIndex: 0, simpleUp: [0, 0, 0], simpleDown: [0, 0, 0] }] },
    quotes: [5000, 5000], quoteReals: [0, 0], quoteHopes: [5000, 5000], quoteBreakEvens: [13000, 3000],
  });
}

it('keeps the real stale table and preview pinned, then withdraws an incompatible stress answer', async () => {
  const { view, send, advance, sockets, boot } = await desk();
  const frame = boardFrame();
  send(frame);
  advance(100);
  const grid = view.getByRole('grid', { name: 'Contracts' });
  const cell = grid.querySelector('.ag-row[row-id="1"] [col-id="company"]');
  expect(cell).not.toBeNull();
  fireEvent.click(cell!);
  advance(1);
  expect(boot.comparisonStore.requested.get().contractId).toBe(1);
  const spend = view.getByRole('textbox', { name: 'How much to spend' }) as HTMLInputElement;
  fireEvent.change(spend, { target: { value: '1000.50' } });
  // Twenty $50 DOWN tickets cost $1,000; at a $30 close they break even.
  const quoted: Frame = { ...frame, draft: { contractId: 1, spendCents: 100050, ticket: {
    contractId: 1, priceCents: 5000, quantity: 20, costCents: 100000, limitPriceCents: 5100, breakEvenCents: 3000,
    whatIf: [{ atCents: 2000, profitCents: 20000 }, { atCents: 3000, profitCents: 0 }, { atCents: 4000, profitCents: -20000 }],
  } } };
  send(quoted);
  fireEvent.change(view.getByRole('slider'), { target: { value: '2' } });
  advance(1500);
  expect(view.getAllByText('Waiting for new prices')).toHaveLength(1);
  const notice = view.getByText('Waiting for new prices').parentElement!;
  expect(grid.closest('[aria-describedby]')?.getAttribute('aria-describedby')).toBe(notice.id);
  const panel = view.getByRole('region', { name: 'Your ticket' });
  expect(panel.getAttribute('aria-describedby')).toBe(notice.id);
  expect(grid.closest('.opacity-60')).not.toBeNull();
  expect(view.getByText('Ticket price').closest('.opacity-60')).not.toBeNull();
  expect(within(view.getByRole('region', { name: 'Your ticket' })).getByText('Cost & most you can lose').nextElementSibling?.textContent).toBe('$1,000');
  expect(spend.value).toBe('1000.50');
  expect(view.getByRole('slider').getAttribute('aria-valuetext')).toBe('$40. Profit or loss -$200');
  fireEvent.change(view.getByRole('combobox', { name: 'Ticket' }), { target: { value: 'up' } });
  advance(100);
  expect(grid.querySelector('.ag-row[row-id="1"]')).toBeNull();
  expect(spend.value).toBe('1000.50');
  expect((view.getByRole('slider') as HTMLInputElement).value).toBe('2');
  fireEvent.change(view.getByRole('combobox', { name: 'Ticket' }), { target: { value: '' } });
  advance(100);
  expect(grid.querySelector('.ag-row[row-id="1"]')?.getAttribute('aria-selected')).toBe('true');
  act(() => { sockets.last().fireClose(); });
  advance(1000);
  act(() => { sockets.last().fireOpen(); });
  send({ t: 'quotes', session: 's-1', rev: 0, day: 1, step: 2, priceIndex: 2, prices: frame.prices,
    changes: [[1, 5100, 0, 5100, 2900]] });
  expect(within(view.getByRole('region', { name: 'Your ticket' })).queryByText('Cost & most you can lose')).toBeNull();
  expect(view.queryByRole('slider')).toBeNull();
  expect(spend.value).toBe('1000.50');
  expect(view.getAllByText('Waiting for new prices')).toHaveLength(1);
  expect(view.queryByRole('button', { name: /Buy ticket|Cash out|Retry/ })).toBeNull();
});

it('keeps age outside the live status and releases freshness timers across strict remounts', async () => {
  const { view, send, advance, boot } = await desk(0, true);
  send(openFrame());
  advance(1500);
  const status = view.getByText('Waiting for new prices');
  expect(status.getAttribute('role')).toBe('status');
  const announcements = vi.fn();
  const observer = new MutationObserver(announcements);
  observer.observe(status, { childList: true, characterData: true, subtree: true });
  try {
    advance(2500);
    await act(async () => { await Promise.resolve(); });
    expect(view.getByText('Last update: 4 seconds ago').closest('[aria-live], [role="status"]')).toBeNull();
    expect(announcements).not.toHaveBeenCalled();
    const timers = vi.getTimerCount();
    expect(timers).toBeGreaterThan(0);
    view.unmount();
    advance(10000);
    // The boot-owned unanswered-buy observer survives the form's lifetime.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    boot.buyFlow.dispose();
    expect(vi.getTimerCount()).toBe(0);
    boot.buyFlow.dispose();
    expect(vi.getTimerCount()).toBe(0);
    boot.deskFreshness.dispose();
    expect(vi.getTimerCount()).toBe(0);
  } finally { observer.disconnect(); }
});

it('uses the original receipt time even when processing is late', async () => {
  const { view, send, advance } = await desk(3000);
  advance(100);
  send(openFrame());
  expect(view.queryByText('Last update: 3 seconds ago')).not.toBeNull();
});

it('refreshes equal quiet pre-bell frames without publishing every timestamp', async () => {
  const { view, send, advance, boot } = await desk();
  const frame = { ...openFrame(), clock: { ...openFrame().clock, phase: 'preBell' as const } };
  send(frame);
  const snapshot = boot.deskFreshness.get();
  const changed = vi.fn();
  const stop = boot.deskFreshness.subscribe(changed);
  advance(1400);
  send(frame);
  expect(boot.deskFreshness.get()).toBe(snapshot);
  expect(changed).not.toHaveBeenCalled();
  advance(1499);
  expect(view.queryByText('Waiting for new prices')).toBeNull();
  advance(1);
  expect(view.queryByText('Waiting for new prices')).not.toBeNull();
  send(frame);
  expect(view.queryByText('Waiting for new prices')).toBeNull();
  stop();
});

it('never refreshes from malformed input, errors, old frames or mismatched deltas', async () => {
  const { view, send, advance, sockets } = await desk();
  send(openFrame());
  advance(3100);
  const delta = { t: 'quotes' as const, priceIndex: 2, session: 's-1', rev: 0, step: 2, day: 1, prices: [8400], changes: [] };
  const rejected: ServerMessage[] = [
    { t: 'error', code: 'badMessage' }, { ...openFrame(), step: 0 },
    { ...delta, session: 'other' }, { ...delta, day: 2 }, { ...delta, rev: 1 }, { ...delta, step: 0 },
  ];
  act(() => { sockets.last().fireMessage('{broken'); });
  for (const message of rejected) {
    send(message);
    expect(view.queryByText('Last update: 3 seconds ago')).not.toBeNull();
  }
  send(delta);
  expect(view.queryByText('Waiting for new prices')).toBeNull();
});

it('reports accepted quote changes without counting baselines, repeats or cost-only updates', () => {
  const game = createGameStore();
  const frame = testFrame({ ...openFrame(), stress: true,
    board: { targetsPerCompany: 1, companies: [{ targets: [8000], lowestUpIndex: 0, highestDownIndex: 0, simpleUp: [0, 0, 0], simpleDown: [0, 0, 0] }] },
    quotes: [5000, 6000], quoteReals: [1000, 2000], quoteHopes: [4000, 4000], quoteBreakEvens: [13000, 2000],
  });
  expect(game.ingest(frame)).toMatchObject({ accepted: true, kind: 'frame', session: 's-1', day: 1, phase: 'open', stress: true, boardReplaced: true, quoteChanges: [] });
  expect(game.ingest(frame)).toMatchObject({ accepted: true, boardReplaced: false, quoteChanges: [] });
  game.setRequestedDraft({ contractId: 0, spendCents: 10000 });
  expect(game.ingest({ ...frame, draft: { contractId: 0, spendCents: 10000, costs: [10000, 6000] } })).toMatchObject({ quoteChanges: [] });
  const updated = { ...frame, step: 2, quoteReals: [2000, 2000], quoteHopes: [3000, 4000] };
  expect(game.ingest(updated)).toMatchObject({ quoteChanges: [{ contractId: 0, priceCents: 5000, realCents: 2000, hopeCents: 3000, breakEvenCents: 13000, priceChanged: false }] });
  const delta = { t: 'quotes' as const, priceIndex: 2, session: 's-1', rev: 0, day: 1, step: 3, prices: frame.prices, changes: [[0, 5100, 2000, 3100, 13100] as [number, number, number, number, number]] };
  expect(game.ingest(delta)).toMatchObject({ kind: 'quotes', stress: true, quoteChanges: [{ contractId: 0, priceCents: 5100, realCents: 2000, hopeCents: 3100, breakEvenCents: 13100, priceChanged: true }] });
  expect(game.ingest(delta)).toMatchObject({ quoteChanges: [] });
  expect(game.ingest(frame)).toEqual({ accepted: false });
  expect(game.ingest({ ...frame, session: 's-2' })).toMatchObject({ boardReplaced: true, quoteChanges: [] });
});

it('keeps reconnect waiting through socket-open and the first accepted full frame', async () => {
  const { view, send, advance, sockets, boot } = await desk();
  expect(view.getAllByText('Waiting for new prices')).toHaveLength(1);
  expect(view.queryByText(/Last update:/)).toBeNull();
  send(openFrame());
  act(() => { sockets.last().fireClose(); });
  expect(view.queryByText('Waiting for new prices')).not.toBeNull();
  advance(1000);
  act(() => { sockets.last().fireOpen(); });
  expect(view.queryByText('Waiting for new prices')).not.toBeNull();
  act(() => { sockets.last().fireMessage(JSON.stringify({ t: 'quotes', priceIndex: 2, session: 's-1', rev: 0, step: 2, day: 1, prices: [8400], changes: [] })); });
  expect(boot.deskFreshness.get().line).toBe('offline');
  send({ ...openFrame(), step: 3 });
  expect(boot.deskFreshness.get().line).toBe('stale');
  expect(view.queryByText('Waiting for new prices')).not.toBeNull();
  send({ ...openFrame(), step: 3 });
  expect(boot.deskFreshness.get().line).toBe('live');
  expect(view.queryByText('Waiting for new prices')).toBeNull();
});

it.each(['lobby', 'debrief', 'final'] as const)('does not warn about silence in authoritative %s', async (phase) => {
  const { view, send, advance } = await desk();
  send(testFrame({ clock: { ...openFrame().clock, phase } }));
  advance(4000);
  expect(view.queryByText('Waiting for new prices')).toBeNull();
  expect(view.queryByText(/Last update:/)).toBeNull();
});

it('resets freshness identity when a full frame replaces the session or day', async () => {
  const { send, sockets, advance, boot, view } = await desk();
  send(openFrame());
  act(() => { sockets.last().fireClose(); });
  advance(1000);
  act(() => { sockets.last().fireOpen(); });
  send({ ...openFrame(), session: 's-2', step: 0 });
  expect(boot.deskFreshness.get().line).toBe('live');
  advance(1500);
  expect(view.queryByText(/Last update:/)).not.toBeNull();
  send({ ...openFrame(), session: 's-2', rev: 1, clock: { ...openFrame().clock, day: 2 } });
  expect(view.queryByText(/Last update:/)).toBeNull();
  advance(1500);
  send({ t: 'quotes', priceIndex: 2, session: 's-2', rev: 1, step: 2, day: 1, prices: [8400], changes: [] });
  expect(boot.deskFreshness.get().waiting).toBe(true);
});

it('pins a DOWN draft and slider through UP filtering while real server quotes stream', async () => {
  vi.resetModules();
  // Supply viewport height at the browser seam; the real grid still owns virtualization.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  window.history.replaceState(null, '', '/');
  interface BarrierSocket extends SocketLike {
    ping: () => void;
    once: (event: 'pong', listener: () => void) => void;
  }
  const Socket = createRequire(path.resolve('apps/server/package.json'))('ws') as
    new (url: string, options: { origin: string }) => BarrierSocket;
  const child = spawn('pnpm', ['--filter', '@strike-desk/server', 'exec', 'tsx', 'test/news-app.ts'], { stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`service readiness timeout: ${errors}`)); }, 30000);
    lines.on('line', (line) => {
      if (!line.startsWith('{')) return;
      const message: unknown = JSON.parse(line);
      if (typeof message === 'object' && message !== null && 'url' in message && typeof message.url === 'string') {
        clearTimeout(timer); resolve(message.url);
      }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`service exited: ${errors}`)); });
  });
  let feed: Feed | undefined;
  let socket: BarrierSocket | undefined;
  let socketCount = 0;
  const messages: ServerMessage[] = [];
  const outbound: Outbound[] = [];
  try {
    const url = await ready;
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: (options: WsFeedOptions) => {
      const live = createWsFeed({ ...options, url, createSocket: (address) => {
        socketCount += 1;
        socket = new Socket(address, { origin: window.location.origin });
        return socket;
      } });
      feed = live;
      live.subscribe((event) => { if (event.type === 'message') messages.push(event.message); });
      return { ...live, send: (message: Outbound) => { outbound.push(message); return live.send(message); } };
    } }));
    const { store, comparisonStore } = await import('../src/boot');
    const { default: App } = await import('../src/App');
    const view = render(createElement(App));
    fireEvent.click(await view.findByRole('button', { name: 'Start fast (3x)' }));
    await waitFor(() => expect(store.currentRows()).toHaveLength(252));
    const disclosure = view.getByRole('button', { name: 'Compare options' });
    fireEvent.click(disclosure);
    const grid = await view.findByRole('grid', { name: 'Contracts' });
    await waitFor(() => expect(grid.querySelector('.ag-row[row-id="0"] [col-id="company"]')).not.toBeNull());
    fireEvent.click(grid.querySelector('.ag-row[row-id="0"] [col-id="company"]')!);
    await waitFor(() => expect(comparisonStore.requested.get().contractId).toBe(0));
    const down = view.getByRole('group', { name: 'DOWN ticket. Pays if the price ends below the target' });
    fireEvent.click(within(down).getByRole('button', { name: /^Close/ }));
    const selectedId = comparisonStore.requested.get().contractId;
    expect(selectedId).not.toBeNull();
    const spend = view.getByRole('textbox', { name: 'How much to spend' }) as HTMLInputElement;
    fireEvent.change(spend, { target: { value: '1000.50' } });
    fireEvent.click(grid.querySelector('[col-id="side"] .ag-header-cell-label')!);
    await waitFor(() => expect(grid.querySelector('[col-id="side"][aria-sort="ascending"]')).not.toBeNull());
    await waitFor(() => expect(outbound).toContainEqual({ t: 'draft', contractId: selectedId, spendCents: 100050 }), { timeout: 2000 });

    async function sample(ms: number): Promise<Frame> {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('socket barrier timeout')); }, 3000);
        socket?.once('pong', () => { clearTimeout(timer); resolve(); });
        socket?.ping();
      });
      const before = messages.length;
      await act(async () => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { stop?.(); reject(new Error('sample timeout')); }, 5000);
          const stop = feed?.subscribe((event) => {
            if (event.type !== 'message') return;
            clearTimeout(timer); stop?.(); resolve();
          });
          child.stdin.write(`${String(ms)}\n`);
        });
      });
      expect(messages.length).toBe(before + 1);
      const newest = messages.at(-1);
      if (newest?.t !== 'frame') throw new Error('expected full ordinary frame');
      return newest;
    }

    await sample(1500);
    const beforeFilter = await sample(23000);
    expect(beforeFilter.clock.phase).toBe('open');
    expect(beforeFilter.draft?.ticket?.contractId).toBe(selectedId);
    const slider = view.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0' } });
    const side = view.getByRole('combobox', { name: 'Ticket' }) as HTMLSelectElement;
    fireEvent.change(side, { target: { value: 'up' } });
    await waitFor(() => expect(grid.querySelector(`.ag-row[row-id="${String(selectedId)}"]`)).toBeNull());
    const afterFilter = await sample(200);
    expect(afterFilter.step).toBeGreaterThan(beforeFilter.step);
    expect(afterFilter.quotes).not.toEqual(beforeFilter.quotes);
    expect(afterFilter.draft?.ticket?.contractId).toBe(selectedId);
    expect(spend.value).toBe('1000.50');
    expect(side.value).toBe('up');
    expect((view.getByRole('slider') as HTMLInputElement).value).toBe('0');
    expect(view.getByText('Ticket price').nextElementSibling?.textContent).toBe(formatCents(afterFilter.draft!.ticket!.priceCents));
    expect(within(view.getByRole('region', { name: 'Your ticket' })).getByText('Cost & most you can lose').nextElementSibling?.textContent).toBe(formatCents(afterFilter.draft!.ticket!.costCents));
    fireEvent.click(disclosure);
    fireEvent.click(disclosure);
    expect(view.getByRole('textbox', { name: 'How much to spend' })).toBe(spend);
    expect(side.value).toBe('up');
    expect((view.getByRole('slider') as HTMLInputElement).value).toBe('0');
    fireEvent.change(side, { target: { value: '' } });
    await waitFor(() => expect(grid.querySelector(`.ag-row[row-id="${String(selectedId)}"]`)?.getAttribute('aria-selected')).toBe('true'));
    expect(spend.value).toBe('1000.50');
    expect(socketCount).toBe(1);
    expect(outbound.every((message) => message.t === 'start' || message.t === 'draft')).toBe(true);
    expect(view.getByRole('button', { name: 'Buy ticket' })).toBeTruthy();
    expect(view.queryByRole('button', { name: /Cash out|Retry/ })).toBeNull();
  } finally {
    cleanup();
    feed?.close();
    child.stdin.end('close\n');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    lines.close();
  }
}, 45000);
