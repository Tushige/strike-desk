// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173"}
/// <reference types="node" />
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, useState, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { contractId } from '@strike-desk/shared/protocol';
import type { BuyCommand, Frame, PositionView, Receipt, ServerMessage } from '@strike-desk/shared/protocol';
import { OrderTicket } from '../src/modules/order-ticket/index';
import type { OrderTicketProps } from '../src/modules/order-ticket/index';
import { createBuyFlow } from '../src/gameplay/buyFlow';
import type { BuyFlow } from '../src/gameplay/buyFlow';
import { createWsFeed } from '../src/feed/wsFeed';
import type { SocketLike } from '../src/feed/wsFeed';
import { createGameStore } from '../src/store/gameStore';
import { createDeskFreshness } from '../src/comparison/freshness';
import type { DeskFreshness } from '../src/comparison/freshness';
import { createManualScheduler, createSocketFactory, testFrame } from './fakeSocket';

type BuyProps = Extract<OrderTicketProps, { mode: 'buy' }>;
const command: BuyCommand = { t: 'buy', commandId: 'retained-buy', day: 1, contractId: 0, spendCents: 2500, seenPriceCents: 1000 };
const fixed = <T,>(value: T) => ({ get: () => value, subscribe: () => () => {} });
const quote: BuyProps['quote'] = fixed({ contractId: 0, spendCents: 2500, priceCents: 1000, quantity: 2, costCents: 2000, limitPriceCents: 1100, breakEvenCents: 9400, whatIf: [] });
function Ticket({ flow, freshness, day = 1, quoted = quote }: { flow: BuyFlow; freshness: DeskFreshness; day?: number; quoted?: BuyProps['quote'] }) {
  const line = useSyncExternalStore(freshness.subscribe, freshness.get).line;
  const transaction = useSyncExternalStore(flow.transaction.subscribe, flow.transaction.get);
  const [value, setValue] = useState(quoted.get()?.spendCents === 2500 ? '25' : '1000');
  return createElement(OrderTicket, { mode: 'buy', day,
    contract: { contractId: quoted.get()!.contractId, companyName: 'RoboPup', ticker: 'RPUP', side: 'up', targetCents: 8400, offered: true },
    choices: [], quote: quoted, account: fixed({ cashCents: 100000000, capCents: 50000000, canBuy: true, minTicketCents: 500 }),
    line, retryOffered: transaction?.retryAllowed ?? false, onRetry: () => { flow.retry(); }, transaction: flow.transaction,
    submit: (command) => flow.submit(command), newCommandId: () => 'retained-buy', onPick() {}, onDraftChange() {},
    spendEditor: { value, spendCents: value === '25' ? 2500 : value === '1000' ? 100000 : 9000, error: null, onChange: setValue } });
}
afterEach(cleanup);

it('hydrates a retained transport intent received while the form is mounted without another press', () => {
  const sockets = createSocketFactory(); const reconnect = createManualScheduler();
  const feed = createWsFeed({ url: 'ws://test', createSocket: (url) => sockets.create(url), schedule: (run, ms) => reconnect.schedule(run, ms), now: () => 0 });
  const store = createGameStore();
  const freshness = createDeskFreshness({ now: () => 0, schedule: () => () => {} });
  feed.subscribe((event) => { if (event.type === 'message') freshness.ingest(store.ingest(event.message), event.receivedAt); else freshness.setStatus(event.status); });
  const flow = createBuyFlow(feed, freshness);
  feed.connect(); sockets.last().fireOpen();
  sockets.last().fireMessage(JSON.stringify(testFrame({ clock: { phase: 'preBell', day: 1, priceIndex: 0, stepsLeft: 300, pace: 1 } })));
  const view = render(createElement(Ticket, { flow, freshness }));
  act(() => { void flow.submit(command); feed.simulateDrop(); });
  expect(view.getByRole('status').textContent).toBe('Checking...');
  expect((view.getByRole('button', { name: 'Buy ticket' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(createElement(Ticket, { key: 'day2', flow, freshness, day: 2 }));
  fireEvent.change(view.getByRole('textbox'), { target: { value: '90' } });
  expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('90');
  expect(sockets.made[0]!.sent.filter((text) => (JSON.parse(text) as { t: string }).t === 'buy')).toEqual([JSON.stringify(command)]);
  act(() => { reconnect.runNext(); sockets.last().fireOpen(); });
  expect(view.queryByRole('button', { name: 'Retry safely' })).toBeNull();
  const nextDay = testFrame({ rev: 2, step: 950, clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 250, pace: 1 } });
  act(() => { sockets.last().fireMessage(JSON.stringify(nextDay)); });
  expect(view.queryByRole('button', { name: 'Retry safely' })).toBeNull();
  act(() => { sockets.last().fireMessage(JSON.stringify({ ...nextDay, step: 951 })); });
  fireEvent.click(view.getByRole('button', { name: 'Retry safely' }));
  expect(sockets.last().sent.filter((text) => (JSON.parse(text) as { t: string }).t === 'buy')).toEqual([JSON.stringify(command)]);
  act(() => { sockets.last().fireMessage(JSON.stringify({ t: 'reply', frame: nextDay,
    receipt: { kind: 'buy', commandId: 'retained-buy', step: 950, outcome: 'rejected', reason: 'wrongDay' } })); });
  expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('90');
  expect(flow.transaction.get()?.outcome?.outcome).toBe('rejected');
  cleanup(); flow.dispose(); freshness.dispose(); feed.close();
});

interface TestSocket extends SocketLike { ping(): void; once(event: 'pong', listener: () => void): void }
const Socket = createRequire(path.resolve('apps/server/package.json'))('ws') as new (url: string) => TestSocket;

it.each(['lost reply', 'unsent command'] as const)('recovers a real %s with receipt-first manual recovery', async (fault) => {
  const child = spawn('pnpm', ['--filter', '@strike-desk/server', 'exec', 'tsx', 'test/news-app.ts'], { stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  let errors = ''; child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  const ready = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error(`service readiness timeout: ${errors}`)); }, 30000);
    lines.on('line', (line) => { if (!line.startsWith('{')) return; const message = JSON.parse(line) as { url: string }; clearTimeout(timeout); resolve(message.url); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(errors)); });
  });
  const schedule = createManualScheduler();
  let socket: TestSocket | undefined;
  const buys: string[] = []; const received: ServerMessage[] = [];
  let withheld: ServerMessage | null = null;
  let armed = true;
  const freshness = createDeskFreshness({ now: () => 0, schedule: () => () => {} });
  let feed: ReturnType<typeof createWsFeed> | undefined;
  let flow: BuyFlow | undefined;
  try {
    const url = await ready;
    feed = createWsFeed({ url, schedule: (run, ms) => schedule.schedule(run, ms), now: () => 0, createSocket(address) {
      const live = new Socket(address); socket = live;
      return { get readyState() { return live.readyState; }, close: () => { live.close(); },
        send(text) {
          const message = JSON.parse(text) as { t: string };
          if (message.t === 'buy') {
            buys.push(text);
            if (fault === 'unsent command' && armed) { armed = false; return; }
          }
          live.send(text);
        },
        addEventListener(type, listener) {
          live.addEventListener(type, (event) => {
            if (type === 'message') {
              const message = JSON.parse(String(event.data)) as ServerMessage;
              if (fault === 'lost reply' && armed && message.t === 'reply' && message.receipt.kind === 'buy') {
                armed = false; withheld = message; return;
              }
            }
            listener(event);
          });
        } };
    } });
    const store = createGameStore();
    feed.subscribe((event) => {
      if (event.type === 'message') { received.push(event.message); freshness.ingest(store.ingest(event.message), event.receivedAt); }
      else freshness.setStatus(event.status);
    });
    flow = createBuyFlow(feed, freshness);
    feed.connect();
    await waitFor(() => { expect(received.at(-1)?.t).toBe('frame'); });
    feed.send({ t: 'start', commandId: 'recovery-start', pace: 1 });
    await waitFor(() => { expect(flow!.availability.get().phase).toBe('preBell'); });
    const start = received.at(-1); if (start?.t !== 'reply' || start.frame.board === null) throw new Error('missing board');
    const id = contractId(start.frame.board.targetsPerCompany, { companyId: 0, targetIndex: start.frame.board.companies[0]!.simpleUp[0], side: 'up' });
    async function barrier() {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { reject(new Error('socket barrier timeout')); }, 3000);
        socket!.once('pong', () => { clearTimeout(timer); resolve(); }); socket!.ping(); });
    }
    async function sample(): Promise<Frame> {
      await barrier(); const before = received.length;
      await act(async () => { child.stdin.write('0\n'); await waitFor(() => { expect(received.length).toBeGreaterThan(before); }); });
      const frame = received.at(-1); if (frame?.t !== 'frame') throw new Error('missing sample'); return frame;
    }
    feed.send({ t: 'draft', contractId: id, spendCents: 100000 });
    const priced = await sample(); if (priced.draft?.ticket === undefined) throw new Error('missing quote');
    const quoted = fixed({ ...priced.draft.ticket, spendCents: 100000 });
    const view = render(createElement(Ticket, { flow, freshness, quoted }));
    fireEvent.click(view.getByRole('button', { name: 'Buy ticket' }));
    expect(view.getByRole('status').textContent).toBe('Pending...');
    await barrier();
    if (fault === 'lost reply') expect(withheld).toMatchObject({ t: 'reply', receipt: { outcome: 'accepted' } });
    expect(flow.transaction.get()?.outcome).toBeUndefined();
    act(() => { feed!.simulateDrop(); });
    expect(view.getByRole('status').textContent).toBe('Checking...');
    const beforeResume = received.length;
    await act(async () => { schedule.runNext(); await waitFor(() => { expect(received.length).toBeGreaterThan(beforeResume); }); });
    expect(buys).toHaveLength(1);
    expect(view.queryByRole('button', { name: 'Retry safely' })).toBeNull();
    expect(freshness.get().line).toBe('stale');
    if (fault === 'lost reply') {
      expect(flow.transaction.get()?.outcome?.outcome).toBe('accepted');
      expect(view.getByRole('status').textContent).toBe('Accepted. The ticket is yours.');
    } else {
      expect(flow.transaction.get()?.outcome).toBeUndefined();
      await sample();
      expect(buys).toHaveLength(1);
      fireEvent.click(view.getByRole('button', { name: 'Retry safely' }));
      await act(async () => { await barrier(); });
      expect(buys).toHaveLength(2);
      expect(buys[1]).toBe(buys[0]);
      expect(flow.transaction.get()?.outcome?.outcome).toBe('accepted');
    }
    const final = await sample();
    expect(final.positions).toHaveLength(1);
    expect(final.account.cashCents).toBeLessThan(100000000);
    expect(final.receipts.filter((item) => item.kind === 'buy')).toHaveLength(1);
  } finally {
    cleanup(); flow?.dispose(); freshness.dispose(); feed?.close(); child.stdin.end('close\n');
    await new Promise<void>((resolve) => { const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    lines.close();
  }
}, 45000);

it.each([
  ['accepted', true], ['rejected', true], ['accepted', false], ['noSession', false],
] as const)('keeps the unanswered last-day buy visible at the final result (%s, manual retry: %s)', async (outcome, retry) => {
  vi.resetModules();
  const absent = new Set(['--ag-grid-size', '--ag-active-color', '--ag-alpine-active-color', '--ag-balham-active-color',
    '--ag-material-primary-color', '--ag-header-foreground-color', '--ag-control-panel-background-color',
    '--ag-cell-horizontal-border', '--ag-header-column-separator-color']);
  const computedStyle = globalThis.getComputedStyle;
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computedStyle(element, pseudo);
    return new Proxy(style, { get(target, key): unknown {
      if (key === 'getPropertyValue') return (name: string) => absent.has(name) ? '' : target.getPropertyValue(name);
      const value: unknown = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  const sockets = createSocketFactory(); const reconnect = createManualScheduler();
  const feed = createWsFeed({ url: 'ws://test', createSocket: (url) => sockets.create(url),
    schedule: (run, ms) => reconnect.schedule(run, ms), now: () => performance.now() });
  vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: () => feed }));
  const boot = await import('../src/boot');
  const { GameDesk } = await import('../src/gameplay/GameDesk');
  const receive = (message: ServerMessage) => { act(() => { sockets.last().fireMessage(JSON.stringify(message)); }); };
  const sentBuys = () => sockets.made.flatMap((socket) => socket.sent.filter((text) => (JSON.parse(text) as { t: string }).t === 'buy'));
  const original: BuyCommand = { t: 'buy', commandId: 'last-day-buy', day: 5, contractId: 24, spendCents: 2500, seenPriceCents: 1000 };
  try {
    sockets.last().fireOpen();
    const open = testFrame({ session: 'last-day-game', rev: 10, step: 4000,
      clock: { phase: 'open', day: 5, priceIndex: 100, stepsLeft: 400, pace: 1 } });
    receive(open);
    const view = render(createElement(GameDesk, { loop: boot.gameLoop, game: boot.store, comparison: boot.comparisonStore, news: boot.newsStore }));
    act(() => { void boot.buyFlow.submit(original); feed.simulateDrop(); });
    expect(view.getAllByText('Checking...').length).toBeGreaterThan(0);
    act(() => { reconnect.runNext(); sockets.last().fireOpen(); });
    const debrief: Frame = { ...open, rev: 11, step: 4400,
      clock: { phase: 'debrief', day: 5, priceIndex: 500, stepsLeft: 100, pace: 1 } };
    receive(debrief); receive(debrief);
    fireEvent.click(view.getByRole('button', { name: 'See your final result' }));
    const nextDay = JSON.parse(sockets.last().sent.at(-1)!) as { commandId: string };
    const final: Frame = { ...debrief, rev: 12, step: 4500,
      clock: { phase: 'final', day: 5, priceIndex: 500, stepsLeft: 0, pace: 1 },
      final: { finalCents: 99998000, changeCents: -2000, marketCode: 'FINISHED-GAME', engine: 'test-engine', content: 'test-content' } };
    receive({ t: 'reply', frame: final, receipt: { commandId: nextDay.commandId, kind: 'nextDay', outcome: 'accepted', step: 4500 } });
    expect(view.getByRole('heading', { name: 'That was the final bell!' })).toBeTruthy();
    expect(view.getByText('You finished with').nextElementSibling?.textContent).toBe('$999,980');
    expect(view.getAllByRole('status').some((status) => status.textContent === 'Checking...')).toBe(true);
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.queryByRole('button', { name: 'Buy ticket' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
    expect(sentBuys()).toEqual([JSON.stringify(original)]);
    act(() => { feed.simulateDrop(); reconnect.runNext(); sockets.last().fireOpen(); });
    expect(view.queryByRole('button', { name: 'Retry safely' })).toBeNull();
    const position: PositionView = { id: 'last-position', day: 5, contractId: 24, companyId: 0, side: 'up', targetCents: 8400,
      quantity: 2, entryPriceCents: 1000, costCents: 2000, entryStep: 4000, entryPriceIndex: 100, breakEvenCents: 9400,
      status: 'settled', valueCents: 0, profitCents: -2000, realCents: 0, hopeCents: 0,
      exit: { kind: 'bell', step: 4400, priceIndex: 500, priceCents: 0, proceedsCents: 0 } };
    const receipt: Receipt = outcome === 'rejected'
      ? { commandId: original.commandId, kind: 'buy', outcome: 'rejected', reason: 'marketClosed', step: 4500 }
      : { commandId: original.commandId, kind: 'buy', outcome: 'accepted', positionId: position.id, step: 4000 };
    const answered: Frame = { ...final, rev: 13, receipts: [receipt], positions: outcome === 'accepted' ? [position] : [] };
    if (retry) {
      receive(final);
      expect(view.queryByRole('button', { name: 'Retry safely' })).toBeNull();
      receive(final);
      const action = view.getByRole('button', { name: 'Retry safely' });
      action.focus(); expect(document.activeElement).toBe(action);
      expect(view.getByText('Send the same request again. It will not happen twice.')).toBeTruthy();
      expect(sentBuys()).toEqual([JSON.stringify(original)]);
      act(() => { action.click(); action.click(); });
      expect(sentBuys()).toEqual([JSON.stringify(original), JSON.stringify(original)]);
      receive({ t: 'reply', receipt, frame: answered });
    } else if (outcome === 'noSession') receive({ t: 'error', code: 'noSession' });
    else receive(answered);
    const expected = outcome === 'accepted' ? 'Your Day 5 buy was accepted. That ticket has settled at the closing bell.'
      : outcome === 'rejected' ? 'Your Day 5 buy was rejected. Market closed. The closing bell has rung.'
      : 'The previous game is no longer available. That buy cannot be checked.';
    expect(view.getAllByRole('status').some((status) => status.textContent === expected)).toBe(true);
    expect(view.queryByRole('button', { name: 'Retry safely' })).toBeNull();
    expect(view.getByText('You finished with').nextElementSibling?.textContent).toBe('$999,980');
    expect(view.getByRole('button', { name: 'Play again' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Buy ticket' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
    if (!retry) expect(sentBuys()).toEqual([JSON.stringify(original)]);
    if (outcome === 'accepted') {
      expect(view.getByText('Paid at the bell').nextElementSibling?.textContent).toBe('$0');
      expect(view.getByText('Profit or loss').nextElementSibling?.textContent).toBe('-$20');
    }
  } finally {
    cleanup(); boot.buyFlow.dispose(); boot.gameLoop.dispose(); boot.deskFreshness.dispose(); feed.close();
    vi.doUnmock('../src/feed/wsFeed'); vi.restoreAllMocks();
  }
});
