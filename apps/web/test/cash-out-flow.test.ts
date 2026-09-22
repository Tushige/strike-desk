import { describe, expect, it } from 'vitest';
import type { Feed, FeedEvent, Outbound } from '@strike-desk/shared/feed';
import type { BuyCommand, CashOutCommand, Frame, PositionView, Receipt, ServerMessage } from '@strike-desk/shared/protocol';
import { createBuyFlow } from '../src/gameplay/buyFlow';
import { testFrame } from './fakeSocket';

const command: CashOutCommand = { t: 'cashOut', commandId: 'original-sale', positionId: 'ticket' };
const buy: BuyCommand = { t: 'buy', commandId: 'another-buy', day: 1, contractId: 0, spendCents: 2500, seenPriceCents: 1000 };
const receipt: Receipt = { kind: 'cashOut', commandId: command.commandId, step: 10, outcome: 'accepted', positionId: 'ticket' };
// One ticket costing $10 is currently worth $12: its profit is $2.
const position: PositionView = { id: 'ticket', day: 1, contractId: 0, companyId: 0, side: 'up', targetCents: 10000,
  quantity: 1, entryPriceCents: 1000, costCents: 1000, entryStep: 0, entryPriceIndex: 0, breakEvenCents: 11000,
  status: 'open', valueCents: 1200, profitCents: 200, realCents: 800, hopeCents: 400 };

function harness() {
  const listeners = new Set<(event: FeedEvent) => void>();
  const freshnessListeners = new Set<() => void>();
  let line: 'live' | 'stale' | 'offline' = 'live';
  let sent = true;
  const messages: Outbound[] = [];
  const feed: Feed = { connect() {}, close() {}, simulateDrop() {},
    send(message) { messages.push(message); return sent; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const flow = createBuyFlow(feed, { get: () => ({ line, waiting: line !== 'live', ageSeconds: null }),
    subscribe(listener) { freshnessListeners.add(listener); return () => { freshnessListeners.delete(listener); }; } });
  const frame = (changes: Partial<Frame> = {}) => testFrame({ session: 'game', rev: 1, step: 10, positions: [position],
    clock: { phase: 'open', day: 1, priceIndex: 0, stepsLeft: 290, pace: 1 }, ...changes });
  return { flow, messages, frame, listeners, freshnessListeners,
    sendResult(value: boolean) { sent = value; },
    fresh(value: typeof line) { line = value; freshnessListeners.forEach((listener) => { listener(); }); },
    receive(message: ServerMessage) { listeners.forEach((listener) => { listener({ type: 'message', message, receivedAt: 0 }); }); },
    drop() { listeners.forEach((listener) => { listener({ type: 'status', status: 'reconnecting' }); }); } };
}

describe('cash-out transport intent', () => {
  it('never queues an unsent request and derives cash-out availability only from an ordinary current open position', async () => {
    const h = harness();
    await expect(h.flow.submitCashOut(command)).resolves.toEqual({ outcome: 'lost' });
    h.receive(h.frame()); expect(h.messages).toEqual([]);
    const first = h.flow.cashOutPosition.get();
    h.receive(h.frame({ step: 11 })); expect(h.flow.cashOutPosition.get()).toBe(first);
    h.receive(h.frame({ step: 12, stress: true })); expect(h.flow.cashOutPosition.get()).toBeNull();
    h.receive(h.frame({ step: 13, positions: [{ ...position, day: 2 }] })); expect(h.flow.cashOutPosition.get()).toBeNull();
    h.receive(h.frame({ step: 14, positions: [{ ...position, status: 'cashedOut' }] })); expect(h.flow.cashOutPosition.get()).toBeNull();
    await expect(h.flow.submitCashOut({ ...command, positionId: 'unknown' })).resolves.toEqual({ outcome: 'lost' });
    expect(h.messages).toEqual([]); h.flow.dispose();
  });

  it('publishes one immutable original-day intent before send and excludes competing trades', async () => {
    const h = harness(); h.receive(h.frame());
    expect(typeof h.flow.submitCashOut).toBe('function');
    expect(h.flow.cashOutPosition.get()).toMatchObject({ positionId: 'ticket', valueCents: 1200, costCents: 1000, profitCents: 200 });
    const observed: number[] = [];
    h.flow.transaction.subscribe(() => { observed.push(h.messages.length); });
    const input = { ...command }; const pending = h.flow.submitCashOut(input); input.positionId = 'changed';
    expect(observed[0]).toBe(0);
    expect(h.flow.transaction.get()).toMatchObject({ originalDay: 1, command });
    expect(h.flow.submitCashOut({ ...command, positionId: 'changed' })).toBe(pending);
    await expect(h.flow.submit(buy)).resolves.toEqual({ outcome: 'lost' });
    await expect(h.flow.submitCashOut({ ...command, commandId: 'another-sale' })).resolves.toEqual({ outcome: 'lost' });
    expect(h.messages).toEqual([command]);
    h.receive({ t: 'reply', frame: h.frame(), receipt: { ...receipt, kind: 'buy' } });
    expect(h.flow.transaction.get()?.outcome).toBeUndefined();
    h.receive({ t: 'reply', frame: h.frame({ rev: 2 }), receipt });
    await expect(pending).resolves.toEqual({ outcome: 'accepted', receipt });
    h.flow.dispose();
  });

  it('does not allow a cash-out to compete with an unanswered buy, even under the same id', async () => {
    const h = harness(); h.receive(h.frame()); void h.flow.submit(buy);
    await expect(h.flow.submitCashOut({ ...command, commandId: buy.commandId })).resolves.toEqual({ outcome: 'lost' });
    expect(h.messages).toEqual([buy]); h.flow.dispose();
  });

  it('keeps a bound send=false checking and retries only its original payload after recovery', async () => {
    const h = harness(); h.receive(h.frame()); h.sendResult(false); const pending = h.flow.submitCashOut(command);
    expect(h.flow.transaction.get()).toMatchObject({ sent: false, interrupted: true, originalDay: 1 });
    h.drop(); h.fresh('offline'); h.flow.retry();
    expect(h.messages).toEqual([command]);
    const nextDay: Frame['clock'] = { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 290, pace: 1 };
    h.fresh('stale'); h.receive(h.frame({ step: 950, clock: nextDay }));
    expect(h.flow.transaction.get()?.retryAllowed).toBe(false);
    h.fresh('live'); h.receive(h.frame({ step: 951, clock: nextDay }));
    expect(h.messages).toEqual([command]);
    h.sendResult(true); h.flow.retry(); h.flow.retry();
    expect(h.messages).toEqual([command, command]);
    expect(h.flow.transaction.get()?.originalDay).toBe(1);
    h.receive({ t: 'reply', frame: h.frame({ step: 952, clock: nextDay }), receipt });
    await expect(pending).resolves.toEqual({ outcome: 'accepted', receipt });
    expect(h.flow.availability.get().day).toBe(2); h.flow.dispose();
  });

  it('checks resumed receipts before retry and never substitutes position motion for an answer', async () => {
    const h = harness(); h.receive(h.frame()); const pending = h.flow.submitCashOut(command);
    const sold: PositionView = { ...position, status: 'cashedOut', exit: { kind: 'cashOut', step: 10, priceIndex: 0, priceCents: 1200, proceedsCents: 1200 }, ifHeldCents: 1700 };
    h.receive(h.frame({ rev: 2, positions: [sold] }));
    expect(h.flow.transaction.get()?.outcome).toBeUndefined();
    expect(h.flow.cashOutPosition.get()).toBeNull();
    h.drop(); h.fresh('stale');
    const retries: boolean[] = [];
    h.flow.transaction.subscribe(() => { retries.push(h.flow.transaction.get()!.retryAllowed); });
    h.receive(h.frame({ rev: 2, step: 11, positions: [sold], receipts: [receipt] }));
    await expect(pending).resolves.toEqual({ outcome: 'accepted', receipt });
    expect(retries).not.toContain(true);
    expect(h.flow.transaction.get()?.purchase?.position).toEqual(sold);
    expect(h.messages).toEqual([command]); h.flow.dispose();
  });

  it('retains receipt-linked original position evidence from an older reply without regressing the current game', async () => {
    const h = harness(); h.receive(h.frame()); const pending = h.flow.submitCashOut(command);
    h.receive(h.frame({ rev: 3, step: 951, positions: [], clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 290, pace: 1 } }));
    const sold: PositionView = { ...position, status: 'cashedOut', exit: { kind: 'cashOut', step: 10, priceIndex: 0, priceCents: 1200, proceedsCents: 1200 }, ifHeldCents: 1200 };
    h.receive({ t: 'reply', frame: h.frame({ rev: 2, positions: [sold] }), receipt });
    await expect(pending).resolves.toEqual({ outcome: 'accepted', receipt });
    expect(h.flow.transaction.get()?.purchase?.position).toEqual(sold);
    expect(h.flow.availability.get().day).toBe(2);
    expect(h.flow.purchase.get()).toBeNull(); h.flow.dispose();
  });

  it('keeps anonymous errors uncertain and retires a replaced game without replaying the old sale', async () => {
    const h = harness(); h.receive(h.frame()); const pending = h.flow.submitCashOut(command);
    h.receive({ t: 'error', code: 'badMessage' });
    expect(h.flow.transaction.get()?.outcome).toBeUndefined();
    h.receive(h.frame({ session: 'replacement' }));
    await expect(pending).resolves.toEqual({ outcome: 'lost' });
    expect(h.flow.transaction.get()?.gameGone).toBe(false);
    h.receive(h.frame({ rev: 99 })); h.flow.retry();
    expect(h.flow.availability.get().session).toBe('replacement');
    expect(h.messages).toEqual([command]); h.flow.dispose();
    expect(h.listeners.size).toBe(0); expect(h.freshnessListeners.size).toBe(0);
  });
});
