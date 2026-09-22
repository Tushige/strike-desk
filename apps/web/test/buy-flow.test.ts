import { describe, expect, it } from 'vitest';
import type { Feed, FeedEvent, Outbound } from '@strike-desk/shared/feed';
import type { BuyCommand, Frame, Receipt, ServerMessage } from '@strike-desk/shared/protocol';
import { createBuyFlow } from '../src/gameplay/buyFlow';
import { testFrame } from './fakeSocket';

const command: BuyCommand = { t: 'buy', commandId: 'original-buy', day: 1, contractId: 0, spendCents: 2500, seenPriceCents: 1000 };
const receipt: Receipt = { kind: 'buy', commandId: command.commandId, step: 10, outcome: 'accepted' };
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
  const frame = (changes: Partial<Frame> = {}) => testFrame({ session: 'game', rev: 1, step: 10,
    clock: { phase: 'preBell', day: 1, priceIndex: 0, stepsLeft: 290, pace: 1 }, ...changes });
  return { flow, messages, frame, listeners, freshnessListeners,
    sendResult(value: boolean) { sent = value; },
    fresh(value: typeof line) { line = value; freshnessListeners.forEach((listener) => { listener(); }); },
    receive(message: ServerMessage) { listeners.forEach((listener) => { listener({ type: 'message', message, receivedAt: 0 }); }); },
    drop() { listeners.forEach((listener) => { listener({ type: 'status', status: 'reconnecting' }); }); } };
}

describe('buy transport intent', () => {
  it('never queues a buy before a session and resolves disposal without closing its Feed', async () => {
    const h = harness();
    await expect(h.flow.submit(command)).resolves.toEqual({ outcome: 'lost' });
    expect(h.messages).toEqual([]);
    h.receive(h.frame()); const pending = h.flow.submit(command);
    h.flow.dispose(); await expect(pending).resolves.toEqual({ outcome: 'lost' });
    expect(h.listeners.size).toBe(0); expect(h.freshnessListeners.size).toBe(0);
  });

  it('publishes pending before sending, keeps one immutable identity and resolves only the matching receipt', async () => {
    const h = harness(); h.receive(h.frame());
    const observed: number[] = [];
    h.flow.transaction.subscribe(() => { observed.push(h.messages.length); });
    const input = { ...command }; const pending = h.flow.submit(input);
    input.spendCents = 9999;
    expect(observed[0]).toBe(0);
    expect(h.flow.submit({ ...command, spendCents: 9999 })).toBe(pending);
    await expect(h.flow.submit({ ...command, commandId: 'another-buy' })).resolves.toEqual({ outcome: 'lost' });
    expect(h.messages).toEqual([command]);
    h.receive(h.frame({ rev: 2, account: { cashCents: 99998000, worthCents: 100000000, capCents: 50000000, canBuy: false } }));
    expect(h.flow.transaction.get()?.outcome).toBeUndefined();
    h.receive({ t: 'reply', frame: h.frame(), receipt: { ...receipt, kind: 'start' } });
    expect(h.flow.transaction.get()?.outcome).toBeUndefined();
    h.receive({ t: 'reply', frame: h.frame(), receipt });
    await expect(pending).resolves.toEqual({ outcome: 'accepted', receipt });
    expect(h.flow.availability.get().day).toBe(1);
    h.flow.dispose();
  });

  it('waits for full recovery and fresh data before manual retry, keeping the original day and payload', () => {
    const h = harness(); h.receive(h.frame()); void h.flow.submit(command); h.drop(); h.fresh('offline');
    h.flow.retry(); expect(h.messages).toHaveLength(1);
    h.fresh('stale'); h.receive(h.frame({ step: 950, clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 250, pace: 1 } }));
    expect(h.flow.transaction.get()?.retryAllowed).toBe(false);
    h.fresh('live'); h.receive(h.frame({ step: 951, clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 249, pace: 1 } })); h.flow.retry(); h.flow.retry();
    expect(h.messages).toEqual([command, command]);
    h.flow.dispose();
  });

  it('checks recovered receipts before offering retry and keeps false sends uncertain', async () => {
    const h = harness(); h.receive(h.frame()); h.sendResult(false); const pending = h.flow.submit(command);
    expect(h.flow.transaction.get()?.interrupted).toBe(true);
    const retry: boolean[] = []; h.flow.transaction.subscribe(() => { retry.push(h.flow.transaction.get()!.retryAllowed); });
    h.receive(h.frame({ receipts: [receipt] }));
    await expect(pending).resolves.toEqual({ outcome: 'accepted', receipt });
    expect(retry).not.toContain(true); h.flow.dispose();
  });

  it('keeps anonymous errors uncertain and retires replaced sessions permanently', async () => {
    const h = harness(); h.receive(h.frame()); const pending = h.flow.submit(command);
    h.receive({ t: 'error', code: 'badMessage' });
    expect(h.flow.transaction.get()?.outcome).toBeUndefined();
    h.receive(h.frame({ session: 'replacement' }));
    await expect(pending).resolves.toEqual({ outcome: 'lost' });
    expect(h.flow.transaction.get()?.gameGone).toBe(false);
    h.receive(h.frame({ rev: 100 }));
    expect(h.flow.availability.get().session).toBe('replacement');
    h.flow.retry(); expect(h.messages).toHaveLength(1); h.flow.dispose();
  });

  it('ignores bad recovery data and anonymous rate errors without resolving or resending', () => {
    const h = harness(); h.receive(h.frame()); void h.flow.submit(command); h.drop();
    h.receive({ t: 'error', code: 'tooManyCommands' });
    h.fresh('live');
    h.receive(h.frame({ rev: 0, receipts: [receipt] }));
    for (const changes of [{ session: 'other' }, { day: 2 }, { rev: 0 }, { step: 9 }]) {
      h.receive({ t: 'quotes', session: 'game', day: 1, rev: 1, step: 11, priceIndex: 0, prices: [], changes: [], ...changes });
    }
    h.flow.retry();
    expect(h.flow.transaction.get()?.outcome).toBeUndefined();
    expect(h.flow.transaction.get()?.retryAllowed).toBe(false);
    expect(h.messages).toEqual([command]);
    h.flow.dispose();
  });

  it.each(['noSession', 'badMessage'] as const)('ends only a known terminal %s and never replays into the replacement game', async (code) => {
    const h = harness(); h.receive(h.frame()); const pending = h.flow.submit(command);
    if (code === 'badMessage') {
      h.receive({ t: 'error', code, commandId: 'unrelated-command' });
      expect(h.flow.transaction.get()?.outcome).toBeUndefined();
    }
    h.receive({ t: 'error', code, commandId: command.commandId });
    await expect(pending).resolves.toEqual({ outcome: 'lost' });
    expect(h.flow.transaction.get()?.gameGone).toBe(code === 'noSession');
    h.receive(h.frame({ session: 'replacement' })); h.flow.retry();
    expect(h.messages).toEqual([command]); h.flow.dispose();
  });
});
