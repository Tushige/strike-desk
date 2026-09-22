// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { Feed, FeedEvent } from '@strike-desk/shared/feed';
import type { Frame, PositionView, Receipt, ServerMessage } from '@strike-desk/shared/protocol';
import { OrderTicket } from '../src/modules/order-ticket/index';
import { createBuyFlow } from '../src/gameplay/buyFlow';
import type { BuyFlow } from '../src/gameplay/buyFlow';
import { testFrame } from './fakeSocket';

const fixed = <T,>(value: T) => ({ get: () => value, subscribe: () => () => {} });
const position: PositionView = { id: 'bought-one', day: 1, contractId: 0, companyId: 0, side: 'up', targetCents: 8400,
  quantity: 2, entryPriceCents: 1000, costCents: 2000, entryStep: 1, entryPriceIndex: 0, breakEvenCents: 9400,
  status: 'open', valueCents: 2000, profitCents: 0, realCents: 0, hopeCents: 1000 };
const settled: PositionView = { ...position, status: 'settled', valueCents: 0, profitCents: -2000,
  exit: { kind: 'bell', step: 800, priceIndex: 500, priceCents: 0, proceedsCents: 0 } };
const receipt: Receipt = { kind: 'buy', commandId: 'summary-buy', step: 1, outcome: 'accepted', positionId: 'bought-one' };
function harness() {
  const listeners = new Set<(event: FeedEvent) => void>();
  const feed: Feed = { connect() {}, close() {}, simulateDrop() {}, send: () => true,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const flow = createBuyFlow(feed, fixed({ line: 'live' as const, waiting: false, ageSeconds: null }));
  const frame = (changes: Partial<Frame> = {}) => testFrame({ session: 'one-game', rev: 1, step: 10,
    clock: { phase: 'preBell', day: 1, priceIndex: 0, stepsLeft: 290, pace: 1 }, ...changes });
  const receive = (message: ServerMessage) => { listeners.forEach((listener) => { listener({ type: 'message', message, receivedAt: 0 }); }); };
  receive(frame()); return { flow, frame, receive };
}
function Ticket({ flow, day = 1 }: { flow: BuyFlow; day?: number }) {
  const [value, setValue] = useState('25');
  return createElement(OrderTicket, { mode: 'buy', day,
    contract: { contractId: 0, companyName: 'RoboPup', ticker: 'RPUP', side: 'up', targetCents: 8400, offered: true },
    choices: [], quote: fixed({ contractId: 0, spendCents: 2500, priceCents: 1000, quantity: 2, costCents: 2000,
      limitPriceCents: 1100, breakEvenCents: 9400, whatIf: [] }),
    account: fixed({ cashCents: 99998000, capCents: 50000000, canBuy: true, minTicketCents: 500 }),
    line: 'live', retryOffered: false, onRetry() {}, onPick() {}, onDraftChange() {}, newCommandId: () => 'summary-buy',
    submit: (command) => flow.submit(command), transaction: flow.transaction, purchase: flow.purchase,
    spendEditor: { value, spendCents: value === '25' ? 2500 : 9000, error: null, onChange: setValue } });
}
afterEach(cleanup);
function amount(view: ReturnType<typeof render>, label: string) { return view.getByText(label).parentElement?.querySelector('dd')?.textContent; }

it('replaces the builder with actual server entry price, quantity and cost', () => {
  const h = harness(); const view = render(createElement(Ticket, { flow: h.flow }));
  fireEvent.click(view.getByRole('button', { name: 'Buy ticket' }));
  act(() => { h.receive({ t: 'reply', receipt, frame: h.frame({ rev: 2, positions: [position] }) }); });
  expect(view.queryByRole('textbox')).toBeNull();
  expect(view.queryByRole('button', { name: 'Buy ticket' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
  expect(amount(view, 'Ticket price')).toBe('$10');
  expect(amount(view, 'Tickets')).toBe('2');
  expect(amount(view, 'Bought for')).toBe('$20');
  expect(view.getByRole('status').textContent).toBe('Accepted. The ticket is yours.');
  cleanup(); h.flow.dispose();
});

it.each([[0, -2000, '$0', '-$20'], [7311, 4444, '$73.11', '+$44.44']] as const)('shows supplied bell payout %s and profit %s without recomputing', (proceedsCents, profitCents, paid, profit) => {
  const h = harness();
  h.receive(h.frame({ rev: 2, positions: [{ ...settled, profitCents, exit: { ...settled.exit!, proceedsCents } }],
    clock: { phase: 'debrief', day: 1, priceIndex: 500, stepsLeft: 100, pace: 1 } }));
  const view = render(createElement(Ticket, { flow: h.flow }));
  expect(amount(view, 'Paid at the bell')).toBe(paid);
  expect(amount(view, 'Profit or loss')).toBe(profit);
  expect(view.queryByRole('textbox')).toBeNull();
  act(() => { h.receive(h.frame({ rev: 3, step: 901, positions: [settled], clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 299, pace: 1 } })); });
  view.rerender(createElement(Ticket, { key: 'day2', day: 2, flow: h.flow }));
  expect(view.getAllByRole('textbox')).toHaveLength(1);
  expect(view.queryByText('Bought for')).toBeNull();
  cleanup(); h.flow.dispose();
});

it.each([true, false])('names the submitted day for acceptance after the same-day bell (position present: %s)', (withPosition) => {
  const h = harness(); const view = render(createElement(Ticket, { flow: h.flow }));
  fireEvent.click(view.getByRole('button', { name: 'Buy ticket' }));
  act(() => { h.receive({ t: 'reply', receipt, frame: h.frame({ rev: 3, step: 801, positions: withPosition ? [settled] : [],
    clock: { phase: 'debrief', day: 1, priceIndex: 500, stepsLeft: 99, pace: 1 } }) }); });
  expect(view.getByRole('status').textContent).toBe('Your Day 1 buy was accepted. That ticket has settled at the closing bell.');
  cleanup(); h.flow.dispose();
});

it('preserves today’s edited draft and uses the latest settled position for an older direct receipt', () => {
  const h = harness(); const view = render(createElement(Ticket, { flow: h.flow }));
  fireEvent.click(view.getByRole('button', { name: 'Buy ticket' }));
  act(() => { h.receive(h.frame({ rev: 4, step: 950, positions: [settled], clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 250, pace: 1 } })); });
  view.rerender(createElement(Ticket, { key: 'day2', flow: h.flow, day: 2 }));
  fireEvent.change(view.getByRole('textbox'), { target: { value: '90' } });
  act(() => { h.receive({ t: 'reply', receipt, frame: h.frame({ positions: [position] }) }); });
  expect(view.getByRole('status').textContent).toBe('Your Day 1 buy was accepted. That ticket has settled at the closing bell.');
  expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('90');
  expect(view.getAllByRole('textbox')).toHaveLength(1);
  expect(view.queryByText('Bought for')).toBeNull();
  expect(amount(view, 'Paid at the bell')).toBe('$0');
  expect(amount(view, 'Profit or loss')).toBe('-$20');
  expect(h.flow.purchase.get()).toBeNull();
  expect(h.flow.availability.get().day).toBe(2);
  cleanup(); h.flow.dispose();
});

it('does not attach another position that merely shares the old contract number', () => {
  const h = harness(); const view = render(createElement(Ticket, { flow: h.flow }));
  fireEvent.click(view.getByRole('button', { name: 'Buy ticket' }));
  act(() => { h.receive({ t: 'reply', receipt, frame: h.frame({ rev: 4, step: 950,
    positions: [{ ...settled, id: 'another-buy' }], clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 250, pace: 1 } }) }); });
  view.rerender(createElement(Ticket, { key: 'day2', flow: h.flow, day: 2 }));
  expect(h.flow.transaction.get()?.purchase).toBeUndefined();
  expect(view.queryByText('Paid at the bell')).toBeNull();
  cleanup(); h.flow.dispose();
});

it('keeps static purchase snapshots stable while open valuation changes', () => {
  const h = harness(); h.receive(h.frame({ rev: 2, positions: [position] }));
  const snapshot = h.flow.purchase.get();
  h.receive(h.frame({ rev: 2, step: 11, positions: [{ ...position, valueCents: 3123, profitCents: 1123, hopeCents: 500 }] }));
  expect(h.flow.purchase.get()).toBe(snapshot);
  h.receive(h.frame({ rev: 3, step: 800, positions: [settled] }));
  expect(h.flow.purchase.get()).not.toBe(snapshot);
  h.flow.dispose();
});

it.each([false, true])('uses ordinary or submitted-day rejection wording (late: %s)', (late) => {
  const h = harness(); const view = render(createElement(Ticket, { flow: h.flow }));
  fireEvent.click(view.getByRole('button', { name: 'Buy ticket' }));
  const frame = late ? h.frame({ rev: 3, step: 950, clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 250, pace: 1 } }) : h.frame();
  act(() => { h.receive({ t: 'reply', frame, receipt: { ...receipt, outcome: 'rejected', reason: 'priceMoved' } }); });
  expect(view.getByRole('status').textContent).toBe(late
    ? 'Your Day 1 buy was rejected. The price moved. Check the new price and press again.'
    : 'Rejected. The price moved. Check the new price and press again.');
  cleanup(); h.flow.dispose();
});

it('reserves previous-game loss wording for explicit noSession', () => {
  const h = harness(); const view = render(createElement(Ticket, { flow: h.flow }));
  fireEvent.click(view.getByRole('button', { name: 'Buy ticket' }));
  act(() => { h.receive({ t: 'error', code: 'tooManyCommands' }); });
  expect(view.getByRole('status').textContent).toBe('Checking...');
  act(() => { h.receive(h.frame({ rev: 2 })); });
  expect(view.getByRole('status').textContent).toBe('Checking...');
  act(() => { h.receive({ t: 'error', code: 'noSession' }); });
  expect(view.getByRole('status').textContent).toBe('The previous game is no longer available. That buy cannot be checked.');
  cleanup(); h.flow.dispose();
});

it('does not announce yesterday’s already-confirmed acceptance again on today’s builder', () => {
  const h = harness(); const view = render(createElement(Ticket, { flow: h.flow }));
  fireEvent.click(view.getByRole('button', { name: 'Buy ticket' }));
  act(() => { h.receive({ t: 'reply', receipt, frame: h.frame({ rev: 2, positions: [position] }) }); });
  act(() => { h.receive(h.frame({ rev: 3, step: 950, positions: [settled], clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 250, pace: 1 } })); });
  view.rerender(createElement(Ticket, { key: 'day2', day: 2, flow: h.flow }));
  expect(view.getByRole('status').textContent).toBe('');
  expect(view.queryByText('Bought for')).toBeNull();
  expect(view.getAllByRole('textbox')).toHaveLength(1);
  cleanup(); h.flow.dispose();
});
