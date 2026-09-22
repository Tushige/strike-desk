import { describe, expect, it } from 'vitest';
import type { Frame } from '@strike-desk/shared/protocol';
import { parseServerMessage } from '@strike-desk/shared/protocol';
import { createConnection, resendWhileFresh } from '../src/modules/connection';
import { createFakeTransport, fakeFrameText } from '../src/modules/connection/fake';
import { createJournal } from '../src/modules/connection/journal';
import type { SavedIntent } from '../src/modules/connection/journal';
import { parseBudget } from '../src/screens/ticket/budget';
import { createGameStore } from '../src/store/gameStore';
import { createGameViews } from '../src/store/views';

const intent: SavedIntent = { version: 1, session: 's-1', day: 1, submittedAt: 100_000,
  command: { t: 'buy', commandId: 'restored-buy', day: 1, contractId: 0, spendCents: 100_000, seenPriceCents: 500 } };
function frame(patch: Partial<Frame> = {}): Frame {
  const message = parseServerMessage(JSON.parse(fakeFrameText({ session: 's-1', clock: { phase: 'preBell', day: 1, stepsLeft: 200, priceIndex: 0, pace: 1 },
    account: { cashCents: 100_000_000, worthCents: 100_000_000, capCents: 50_000_000, canBuy: true }, ...patch })));
  if (message?.t !== 'frame') throw new Error('Invalid test frame');
  return message;
}
function rig() {
  const transport = createFakeTransport();
  const connection = createConnection({ seam: transport.seam, sessionKey: 'test', resendOnResume: resendWhileFresh({ maxAgeMs: 20_000, now: transport.seam.now }) });
  connection.connect(); transport.last().fireOpen();
  const send = (f: Frame) => { transport.last().fireMessage(JSON.stringify(f)); };
  const buys = () => transport.last().sent.map((s) => JSON.parse(s) as { t: string }).filter((s) => s.t === 'buy');
  return { connection, transport, send, buys };
}
describe('refresh recovery uses original intent and receipts', () => {
  it('registers while live without immediate sending or a fresh timestamp; old same-day request waits for explicit retry', () => {
    const r = rig(); r.send(frame());
    void r.connection.restore(intent, 21_000);
    expect(r.buys()).toHaveLength(0);
    r.send(frame()); r.send(frame());
    expect(r.buys()).toHaveLength(0);
    expect(r.connection.pending.get()[0]?.sentAt).toBe(-21_000);
    r.connection.resend(intent.command.commandId);
    expect(r.buys()).toEqual([intent.command]);
  });
  it('retries a recent undelivered intent once across repeated frames with exact payload', () => {
    const r = rig(); void r.connection.restore(intent, 10_000);
    expect(r.buys()).toHaveLength(0);
    r.send(frame()); r.send(frame()); r.send(frame());
    expect(r.buys()).toEqual([intent.command]);
  });
  it.each(['accepted', 'rejected'] as const)('settles an old %s receipt before eligibility checks, even at final', async (outcome) => {
    const r = rig(); const result = r.connection.restore(intent, 100_000);
    const receipt = { commandId: intent.command.commandId, kind: 'buy' as const, step: 0, outcome };
    r.send(frame({ clock: { phase: 'final', day: 5, stepsLeft: 0, priceIndex: 500, pace: 1 }, receipts: [receipt] }));
    expect(await result).toEqual({ outcome, receipt });
    expect(r.buys()).toHaveLength(0);
    expect(r.connection.pending.get()).toHaveLength(0);
  });
  it.each(['day', 'session', 'finished'] as const)('does not replay when %s changes', async (change) => {
    const r = rig(); const result = r.connection.restore(intent, 10);
    r.send(frame(change === 'session' ? { session: 'other' } : { clock: { phase: change === 'finished' ? 'debrief' : 'preBell', day: change === 'day' ? 2 : 1, stepsLeft: 50, priceIndex: change === 'finished' ? 500 : 0, pace: 1 } }));
    expect(await result).toEqual({ outcome: 'lost' });
    r.connection.resend(intent.command.commandId); expect(r.buys()).toHaveLength(0);
  });
  it('does not replay a cash-out for a closed or missing position', async () => {
    const r = rig(); const saved: SavedIntent = { ...intent, command: { t: 'cashOut', commandId: 'out', positionId: 'd1' } };
    const result = r.connection.restore(saved, 10); r.send(frame({ clock: { phase: 'open', day: 1, stepsLeft: 200, priceIndex: 100, pace: 1 } }));
    expect(await result).toEqual({ outcome: 'lost' });
    expect(r.transport.last().sent.some((s) => s.includes('cashOut'))).toBe(false);
  });
});
describe('optional journal storage validates before any replay', () => {
  it.each([null, '{', JSON.stringify({ ...intent, submittedAt: 100_001 }), JSON.stringify({ ...intent, submittedAt: -2_000_000 }), JSON.stringify({ ...intent, command: { t: 'start' } })])('rejects malformed/future/expired records (%s)', (raw) => {
    const journal = createJournal({ getItem: () => raw, setItem() {}, removeItem() {} }, 'journal', () => 100_000);
    expect(journal.read()).toBeNull();
  });
  it('round trips the exact versioned command and timestamp', () => {
    let saved: string | null = null;
    const journal = createJournal({ getItem: () => saved, setItem(_key, value) { saved = value; }, removeItem() { saved = null; } }, 'journal', () => 100_000);
    expect(journal.write(intent)).toBe(true); expect(journal.read()).toEqual(intent); journal.clear(); expect(saved).toBeNull();
  });
  it('works when storage throws', () => {
    const fail = () => { throw new Error('unavailable'); };
    const journal = createJournal({ getItem: fail, setItem: fail, removeItem: fail }, 'journal');
    expect(journal.read()).toBeNull(); expect(journal.write(intent)).toBe(false); expect(() => { journal.clear(); }).not.toThrow();
  });
});
it('clock-only frames notify the clock, but preserve news, ticket, desk and comparison snapshots', () => {
  const store = createGameStore(); const views = createGameViews(store); store.ingest(frame());
  const counts = { clock: 0, ticket: 0, desk: 0, comparison: 0, news: 0 };
  for (const key of Object.keys(counts) as (keyof typeof counts)[]) views[key].subscribe(() => { counts[key]++; });
  store.ingest(frame({ step: 1, clock: { ...frame().clock, stepsLeft: 199 } }));
  expect(counts).toEqual({ clock: 1, ticket: 0, desk: 0, comparison: 0, news: 0 });
});
it.each(['', '-1', '1.2', '0', '9007199254740991', '500001', '1e3'])('blocks invalid custom budget %s', (text) => {
  expect(parseBudget(text, 50_000_000).cents).toBeNull();
});
it('converts valid custom dollars to integer cents without clamping', () => { expect(parseBudget('12345', 50_000_000)).toEqual({ cents: 1_234_500, error: null }); });
