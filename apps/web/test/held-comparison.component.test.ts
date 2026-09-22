// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Feed, FeedEvent, Outbound } from '@strike-desk/shared/feed';
import type { Frame, PositionView, ServerMessage } from '@strike-desk/shared/protocol';
import { OrderTicket, TradeNotice } from '../src/modules/order-ticket/index';
import { createBuyFlow } from '../src/gameplay/buyFlow';
import { testFrame } from './fakeSocket';

const fixed = <T,>(value: T) => ({ get: () => value, subscribe: () => () => {} });
// Two $5 tickets cost $10; their $12 sale produces a fixed $2 profit.
const sold: PositionView = { id: 'sold', day: 1, contractId: 0, companyId: 0, side: 'up', targetCents: 8400,
  quantity: 2, entryPriceCents: 500, costCents: 1000, entryStep: 0, entryPriceIndex: 0, breakEvenCents: 8900,
  status: 'cashedOut', valueCents: 1200, profitCents: 200, realCents: 400, hopeCents: 200,
  exit: { kind: 'cashOut', step: 10, priceIndex: 10, priceCents: 600, proceedsCents: 1200 }, ifHeldCents: 1000 };
function setup() {
  vi.useFakeTimers();
  const listeners = new Set<(event: FeedEvent) => void>(); const sent: Outbound[] = [];
  const feed: Feed = { connect() {}, close() {}, simulateDrop() {}, send(message) { sent.push(message); return true; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const flow = createBuyFlow(feed, fixed({ line: 'live' as const, waiting: false, ageSeconds: null }));
  const frame = (changes: Partial<Frame> = {}) => testFrame({ session: 'game', rev: 2, step: 10, positions: [sold],
    clock: { phase: 'open', day: 1, priceIndex: 10, stepsLeft: 490, pace: 1 }, ...changes });
  const receive = (message: ServerMessage) => { act(() => { listeners.forEach((listener) => { listener({ type: 'message', message, receivedAt: 0 }); }); }); };
  receive(frame());
  const props = { mode: 'buy' as const, day: 1, contract: null, choices: [], quote: fixed(null),
    account: fixed({ cashCents: 100000200, capCents: 50000000, canBuy: false, minTicketCents: 500 }),
    line: 'live' as const, retryOffered: false, onRetry() {}, onPick() {}, onDraftChange() {}, newCommandId: () => 'unused',
    submit: (command: Parameters<typeof flow.submit>[0]) => flow.submit(command), transaction: flow.transaction, purchase: flow.purchase,
    cashOut: { position: flow.cashOutPosition, submit: (command: Parameters<typeof flow.submitCashOut>[0]) => flow.submitCashOut(command) },
    spendEditor: { value: '11', spendCents: 1100, error: null, onChange() {} } };
  return { flow, props, frame, receive, sent };
}
const amount = (view: ReturnType<typeof render>, label: string) => view.getByText(label).parentElement?.querySelector('dd')?.textContent;
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows supplied live held values separately from fixed proceeds, cost and profit', () => {
  const h = setup(); const view = render(createElement(OrderTicket, h.props));
  expect(view.queryByText('If you had held on')).not.toBeNull();
  expect(amount(view, 'If you had held on')).toBe('$10');
  expect(view.getByText('This is what your ticket would be worth right now. Keep watching. It can still go either way.')).toBeTruthy();
  h.receive(h.frame({ step: 11, positions: [{ ...sold, ifHeldCents: 1700 }] }));
  act(() => { vi.runOnlyPendingTimers(); });
  expect(amount(view, 'If you had held on')).toBe('$17');
  expect(amount(view, 'Money back in your pocket')).toBe('$12');
  expect(amount(view, 'You paid')).toBe('$10');
  expect(amount(view, 'Profit or loss')).toBe('+$2');
  expect(amount(view, 'Cash')).toBe('$1,000,002');
  expect(view.getByRole('status').textContent).toBe('You cashed out');
  expect(h.sent).toEqual([]); h.flow.dispose();
});

it('coalesces comparison-only frames, retains equal snapshots, flushes the bell and cancels disposal work', () => {
  const h = setup(); const view = render(createElement(OrderTicket, h.props));
  const first = h.flow.purchase.get();
  let notifications = 0; h.flow.purchase.subscribe(() => { notifications++; });
  h.receive(h.frame({ step: 11 })); expect(h.flow.purchase.get()).toBe(first);
  h.receive(h.frame({ step: 12, positions: [{ ...sold, ifHeldCents: 1500 }] }));
  h.receive(h.frame({ step: 13, positions: [{ ...sold, ifHeldCents: 1700 }] }));
  expect(h.flow.purchase.get()).toBe(first);
  expect(notifications).toBe(0);
  act(() => { vi.runOnlyPendingTimers(); });
  expect(notifications).toBe(1); expect(amount(view, 'If you had held on')).toBe('$17');
  const stable = h.flow.purchase.get();
  h.receive(h.frame({ step: 14, positions: [{ ...sold, ifHeldCents: 1700 }] }));
  expect(h.flow.purchase.get()).toBe(stable);
  h.receive(h.frame({ step: 15, positions: [{ ...sold, ifHeldCents: 1800 }] }));
  h.receive(h.frame({ rev: 3, step: 800, positions: [{ ...sold, ifHeldCents: 900 }],
    clock: { phase: 'debrief', day: 1, priceIndex: 500, stepsLeft: 100, pace: 1 } }));
  expect(amount(view, 'If you had held to the bell')).toBe('$9');
  expect(view.getByText('This is what your ticket would have paid at the closing bell.')).toBeTruthy();
  act(() => { vi.runOnlyPendingTimers(); });
  expect(amount(view, 'If you had held to the bell')).toBe('$9');
  expect(amount(view, 'Money back in your pocket')).toBe('$12');
  h.receive(h.frame({ rev: 4, step: 801, positions: [{ ...sold, ifHeldCents: 800 }],
    clock: { phase: 'debrief', day: 1, priceIndex: 500, stepsLeft: 99, pace: 1 } }));
  const beforeDispose = h.flow.purchase.get(); h.flow.dispose();
  act(() => { vi.runOnlyPendingTimers(); });
  expect(h.flow.purchase.get()).toBe(beforeDispose);
});

it.each([0, undefined])('preserves zero versus missing comparison data (%s)', (ifHeldCents) => {
  const h = setup(); const position = { ...sold }; delete position.ifHeldCents;
  if (ifHeldCents !== undefined) position.ifHeldCents = ifHeldCents;
  h.receive(h.frame({ rev: 3, positions: [position] }));
  act(() => { vi.runOnlyPendingTimers(); });
  const view = render(createElement(OrderTicket, { ...h.props, line: 'stale', staleNoticeId: 'common-stale' }));
  if (ifHeldCents === 0) {
    expect(amount(view, 'If you had held on')).toBe('$0');
    expect(view.getByText('If you had held on').closest('.opacity-60')).not.toBeNull();
  } else expect(view.queryByText('If you had held on')).toBeNull();
  expect(view.getByRole('region').getAttribute('aria-describedby')).toBe('common-stale');
  h.flow.dispose();
});

it('flushes outcome evidence immediately and retains the original ticket’s frozen comparison in final notices', () => {
  const h = setup();
  act(() => { void h.flow.submitCashOut({ t: 'cashOut', commandId: 'sale', positionId: sold.id }); });
  h.receive({ t: 'reply', receipt: { kind: 'cashOut', commandId: 'sale', positionId: sold.id, step: 10, outcome: 'accepted' },
    frame: h.frame({ rev: 3, positions: [{ ...sold, ifHeldCents: 1700 }] }) });
  expect(h.flow.transaction.get()?.outcome?.outcome).toBe('accepted');
  expect(h.flow.purchase.get()?.position.ifHeldCents).toBe(1700);
  h.receive(h.frame({ rev: 4, step: 950, positions: [{ ...sold, ifHeldCents: 900 }],
    clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 300, pace: 1 } }));
  const view = render(createElement(TradeNotice, { transaction: h.flow.transaction, day: 5, phase: 'final', line: 'live', retryOffered: false, onRetry() {} }));
  expect(amount(view, 'If you had held to the bell')).toBe('$9');
  const retained = h.flow.transaction.get();
  h.receive(h.frame({ rev: 5, step: 4500, prices: [90000], positions: [{ ...sold, ifHeldCents: 900 }],
    clock: { phase: 'final', day: 5, priceIndex: 500, stepsLeft: 0, pace: 1 } }));
  expect(h.flow.transaction.get()).toBe(retained);
  expect(amount(view, 'Money back in your pocket')).toBe('$12');
  expect(amount(view, 'If you had held to the bell')).toBe('$9');
  h.flow.dispose();
});
