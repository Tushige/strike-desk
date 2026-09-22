// @vitest-environment jsdom
/// <reference types="node" />
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, useState, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { contractId } from '@strike-desk/shared/protocol';
import type { BuyCommand, Frame, ServerMessage } from '@strike-desk/shared/protocol';
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
