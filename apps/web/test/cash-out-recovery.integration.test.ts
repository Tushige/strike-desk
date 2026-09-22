// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173"}
/// <reference types="node" />
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, useState, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { contractId } from '@strike-desk/shared/protocol';
import type { CashOutCommand, Frame, PositionView, Receipt, ServerMessage } from '@strike-desk/shared/protocol';
import { OrderTicket, TradeNotice } from '../src/modules/order-ticket/index';
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
const command: CashOutCommand = { t: 'cashOut', commandId: 'retained-sale', positionId: 'ticket' };
const position: PositionView = { id: 'ticket', day: 1, contractId: 0, companyId: 0, side: 'up', targetCents: 8400, quantity: 2, entryPriceCents: 500, costCents: 1000, entryStep: 0, entryPriceIndex: 0, breakEvenCents: 8900, status: 'open', valueCents: 1200, profitCents: 200, realCents: 400, hopeCents: 200 };
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
    purchase: flow.purchase, cashOut: { position: flow.cashOutPosition, submit: (command) => flow.submitCashOut(command) },
    submit: (command) => flow.submit(command), newCommandId: () => 'retained-sale', onPick() {}, onDraftChange() {},
    spendEditor: { value, spendCents: value === '25' ? 2500 : value === '1000' ? 100000 : 9000, error: null, onChange: setValue } });
}
afterEach(cleanup);

it.each(['cashOut', 'bell', 'rejected', 'noSession'] as const)('retains today’s draft through a late original-day %s answer', (result) => {
  const sockets = createSocketFactory(); const reconnect = createManualScheduler();
  const feed = createWsFeed({ url: 'ws://test', createSocket: (url) => sockets.create(url), schedule: (run, ms) => reconnect.schedule(run, ms), now: () => 0 });
  const store = createGameStore();
  const freshness = createDeskFreshness({ now: () => 0, schedule: () => () => {} });
  feed.subscribe((event) => { if (event.type === 'message') freshness.ingest(store.ingest(event.message), event.receivedAt); else freshness.setStatus(event.status); });
  const flow = createBuyFlow(feed, freshness);
  const receive = (message: ServerMessage) => { act(() => { sockets.last().fireMessage(JSON.stringify(message)); }); };
  feed.connect(); sockets.last().fireOpen();
  const original = testFrame({ positions: [position], clock: { phase: 'open', day: 1, priceIndex: 10, stepsLeft: 490, pace: 1 } });
  receive(original);
  const view = render(createElement(Ticket, { flow, freshness }));
  act(() => { void flow.submitCashOut(command); feed.simulateDrop(); });
  view.rerender(createElement(Ticket, { key: 'day2', flow, freshness, day: 2 }));
  act(() => { reconnect.runNext(); sockets.last().fireOpen(); });
  const nextDay = { ...original, rev: 3, step: 950, positions: [], clock: { ...original.clock, day: 2, phase: 'preBell' as const } };
  receive(nextDay);
  fireEvent.change(view.getByRole('textbox'), { target: { value: '90' } });
  expect(view.getByRole('status').textContent).toBe('Checking...');
  receive({ t: 'error', code: 'badMessage' });
  expect(view.getByRole('status').textContent).toBe('Checking...');
  const receipt: Receipt = result === 'rejected'
    ? { kind: 'cashOut', commandId: command.commandId, step: 11, outcome: 'rejected', reason: 'alreadyClosed' }
    : { kind: 'cashOut', commandId: command.commandId, step: 11, outcome: 'accepted', positionId: position.id };
  const answered: Frame = { ...original, rev: 2, positions: [{ ...position, status: result === 'bell' ? 'settled' : 'cashedOut',
    exit: { kind: result === 'bell' ? 'bell' : 'cashOut', step: 11, priceIndex: 11, priceCents: 600, proceedsCents: 1200 } }] };
  if (result === 'noSession') receive({ t: 'error', code: 'noSession' });
  else receive({ t: 'reply', frame: answered, receipt });
  const expected = result === 'cashOut' ? 'Day 1: cashed out.' : result === 'bell' ? 'Day 1: settled at the bell.'
    : result === 'rejected' ? 'Day 1: cash-out rejected. That ticket is already cashed out. You were paid once.'
    : 'The previous game is no longer available. That cash-out cannot be checked.';
  expect(view.getByRole('status').textContent).toBe(expected);
  expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('90');
  expect(flow.availability.get().day).toBe(2);
  expect(flow.purchase.get()).toBeNull();
  receive({ ...nextDay, step: 951 });
  expect(view.getByRole('status').textContent).toBe(expected);
  expect(sockets.made.flatMap((socket) => socket.sent).filter((text) => (JSON.parse(text) as { t: string }).t === 'cashOut')).toEqual([JSON.stringify(command)]);
  cleanup(); flow.dispose(); freshness.dispose(); feed.close();
});

interface TestSocket extends SocketLike { ping(): void; once(event: 'pong', listener: () => void): void }
const Socket = createRequire(path.resolve('apps/server/package.json'))('ws') as new (url: string) => TestSocket;

it.each(['lost reply', 'unsent command', 'unsent command at final'] as const)('recovers a real cash-out %s with receipt-first manual recovery', async (fault) => {
  const atFinal = fault === 'unsent command at final';
  const day = atFinal ? 5 : 1;
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
  const sales: string[] = []; const hellos: string[] = []; const received: ServerMessage[] = [];
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
          if (message.t === 'hello') hellos.push(text);
          if (message.t === 'cashOut') {
            sales.push(text);
            if (fault !== 'lost reply' && armed) { armed = false; return; }
          }
          live.send(text);
        },
        addEventListener(type, listener) {
          live.addEventListener(type, (event) => {
            if (type === 'message') {
              const message = JSON.parse(String(event.data)) as ServerMessage;
              if (fault === 'lost reply' && armed && message.t === 'reply' && message.receipt.kind === 'cashOut') {
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
    async function barrier() {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { reject(new Error('socket barrier timeout')); }, 3000);
        socket!.once('pong', () => { clearTimeout(timer); resolve(); }); socket!.ping(); });
    }
    async function sample(ms = 0): Promise<Frame> {
      await barrier(); const before = received.length;
      await act(async () => { child.stdin.write(`${String(ms)}\n`); await waitFor(() => { expect(received.length).toBeGreaterThan(before); }); });
      const frame = received.at(-1); if (frame?.t !== 'frame') throw new Error('missing sample'); return frame;
    }
    const today = atFinal ? await sample(720000) : start.frame;
    if (today.board === null) throw new Error('missing daily board');
    const id = contractId(today.board.targetsPerCompany, { companyId: 0, targetIndex: today.board.companies[0]!.simpleUp[0], side: 'up' });
    feed.send({ t: 'draft', contractId: id, spendCents: 100000 });
    const priced = await sample(); if (priced.draft?.ticket === undefined) throw new Error('missing quote');
    const quoted = fixed({ ...priced.draft.ticket, spendCents: 100000 });
    feed.send({ t: 'buy', commandId: 'buy-before-sale', day, contractId: id, spendCents: 100000, seenPriceCents: priced.draft.ticket.priceCents });
    await barrier();
    const bought = await sample();
    expect(bought.positions).toHaveLength(1);
    const view = render(createElement(Ticket, { flow, freshness, quoted, day }));
    fireEvent.click(view.getByRole('button', { name: 'Cash out' }));
    expect(view.getByRole('status').textContent).toBe('Pending...');
    await barrier();
    if (fault === 'lost reply') expect(withheld).toMatchObject({ t: 'reply', receipt: { outcome: 'accepted' } });
    expect(flow.transaction.get()?.outcome).toBeUndefined();
    const settled = atFinal ? await sample(180000) : null;
    if (atFinal) {
      expect(settled?.clock.phase).toBe('final');
      expect(settled?.positions[0]?.exit?.kind).toBe('bell');
      view.rerender(createElement(TradeNotice, { transaction: flow.transaction, day: 5, phase: 'final',
        line: freshness.get().line, retryOffered: false, onRetry: () => { flow!.retry(); } }));
    }
    act(() => { feed!.simulateDrop(); });
    expect(view.getByRole('status').textContent).toBe('Checking...');
    const beforeResume = received.length;
    await act(async () => { schedule.runNext(); await waitFor(() => { expect(received.length).toBeGreaterThan(beforeResume); }); });
    expect(JSON.parse(hellos.at(-1)!) as unknown).toMatchObject({ t: 'hello', session: bought.session });
    expect(sales).toHaveLength(1);
    expect(view.queryByRole('button', { name: 'Retry safely' })).toBeNull();
    expect(freshness.get().line).toBe(atFinal ? 'live' : 'stale');
    if (fault === 'lost reply') {
      expect(flow.transaction.get()?.outcome?.outcome).toBe('accepted');
      expect(view.getByRole('status').textContent).toBe('You cashed out');
    } else {
      expect(flow.transaction.get()?.outcome).toBeUndefined();
      await sample();
      if (atFinal) view.rerender(createElement(TradeNotice, { transaction: flow.transaction, day: 5, phase: 'final',
        line: freshness.get().line, retryOffered: flow.availability.get().retryAllowed, onRetry: () => { flow!.retry(); } }));
      expect(sales).toHaveLength(1);
      fireEvent.click(view.getByRole('button', { name: 'Retry safely' }));
      await act(async () => { await barrier(); });
      expect(sales).toHaveLength(2);
      expect(sales[1]).toBe(sales[0]);
      expect(flow.transaction.get()?.outcome?.outcome).toBe('accepted');
    }
    const final = await sample();
    expect(final.positions).toHaveLength(1);
    expect(final.account.cashCents).toBe(settled?.account.cashCents ?? 100000000);
    expect(final.positions[0]?.exit?.kind).toBe(atFinal ? 'bell' : 'cashOut');
    if (settled !== null) {
      expect(final.final).toEqual(settled.final);
      expect(final.days).toEqual(settled.days);
      expect(final.positions).toEqual(settled.positions);
    }
    expect(final.receipts.filter((item) => item.kind === 'cashOut')).toHaveLength(1);
  } finally {
    cleanup(); flow?.dispose(); freshness.dispose(); feed?.close(); child.stdin.end('close\n');
    await new Promise<void>((resolve) => { const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    lines.close();
  }
}, 45000);
