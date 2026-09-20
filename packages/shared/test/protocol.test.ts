import { describe, expect, it } from 'vitest';
import {
  clientMessageSchema,
  commandSchema,
  isNewerFrame,
  parseClientMessage,
  parseServerMessage,
  receiptSchema,
  serverMessageSchema,
} from '../src/protocol';

const ID = 'cmd-0001';
const buy = { t: 'buy', commandId: ID, day: 1, contractId: 20, spendCents: 5_000_000, seenPriceCents: 12_300 };

describe('client messages', () => {
  it.each([
    [{ t: 'hello', v: 1 }],
    [{ t: 'hello', v: 1, session: 'abc', board: 2508 }],
    [{ t: 'start', commandId: ID, pace: 1 }],
    [{ t: 'start', commandId: ID, pace: 3 }],
    [{ t: 'start', commandId: ID, pace: 7.5 }],
    [buy],
    [{ t: 'cashOut', commandId: ID, positionId: 'd1' }],
    [{ t: 'openBell', commandId: ID, day: 1 }],
    [{ t: 'skipToBell', commandId: ID, day: 3 }],
    [{ t: 'nextDay', commandId: ID, day: 5 }],
  ])('accepts %j', (message) => {
    expect(clientMessageSchema.parse(message)).toEqual(message);
    expect(parseClientMessage(message)).toEqual(message);
  });

  it.each([
    ['an unknown key on a command', { ...buy, seed: 1 }],
    ['an unknown key on hello', { t: 'hello', v: 1, admin: true }],
    ['an unknown message', { t: 'restart', commandId: ID }],
    ['a wrong version', { t: 'hello', v: 2 }],
    ['a bad pace', { t: 'start', commandId: ID, pace: 2 }],
    ['a pace sent as text', { t: 'start', commandId: ID, pace: '3' }],
    ['a short commandId', { ...buy, commandId: 'short' }],
    ['a very long commandId', { ...buy, commandId: 'x'.repeat(65) }],
    ['a missing commandId', { t: 'start', pace: 1 }],
    ['cents that are not whole', { ...buy, spendCents: 5000.5 }],
    ['a seen price that is not whole', { ...buy, seenPriceCents: 123.4 }],
    ['a spend of nothing', { ...buy, spendCents: 0 }],
    ['a negative spend', { ...buy, spendCents: -100 }],
    ['a negative contract', { ...buy, contractId: -1 }],
    ['day 0', { ...buy, day: 0 }],
    ['day 6', { t: 'nextDay', commandId: ID, day: 6 }],
    ['not-a-number cents', { ...buy, spendCents: NaN }],
    ['infinite cents', { ...buy, spendCents: Infinity }],
    ['text', 'buy'],
    ['nothing', null],
  ])('refuses %s', (_name, message) => {
    expect(parseClientMessage(message)).toBeNull();
  });

  it('does not take hello as a command', () => {
    expect(commandSchema.safeParse({ t: 'hello', v: 1 }).success).toBe(false);
    expect(commandSchema.safeParse(buy).success).toBe(true);
  });
});

describe('server messages', () => {
  const receipt = { commandId: ID, kind: 'buy', step: 310, outcome: 'accepted', positionId: 'd1' };
  const frame = {
    t: 'frame',
    session: 's1',
    rev: 0,
    step: 0,
    clock: { phase: 'lobby', day: 0, stepsLeft: 0, priceIndex: 0, pace: null },
    prices: [8400, 4200, 12000, 2800, 6500, 15000],
    board: null,
    quotes: [],
    news: [],
    account: { cashCents: 100_000_000, worthCents: 100_000_000, capCents: 50_000_000, canBuy: false },
    positions: [],
    receipts: [],
    days: [],
    stress: false,
  };

  it('accepts a frame, a reply, a quotes batch and an error', () => {
    expect(parseServerMessage(frame)).toEqual(frame);
    expect(parseServerMessage({ t: 'reply', receipt, frame })).toEqual({ t: 'reply', receipt, frame });
    const quotes = { t: 'quotes', session: 's1', rev: 3, step: 400, priceIndex: 100, prices: [1, 2, 3, 4, 5, 6], changes: [[0, 12_300], [7, 0]] };
    expect(parseServerMessage(quotes)).toEqual(quotes);
    expect(parseServerMessage({ t: 'error', code: 'badMessage' })).toEqual({ t: 'error', code: 'badMessage' });
  });

  it('lets an older client read a message with a field it does not know', () => {
    expect(serverMessageSchema.safeParse({ ...frame, somethingNew: 1 }).success).toBe(true);
  });

  it('refuses money that is not whole cents and a reject reason it does not know', () => {
    expect(parseServerMessage({ ...frame, prices: [84.5] })).toBeNull();
    expect(parseServerMessage({ ...frame, account: { ...frame.account, cashCents: 0.5 } })).toBeNull();
    expect(receiptSchema.safeParse({ ...receipt, outcome: 'rejected', reason: 'becauseISaidSo' }).success).toBe(false);
    expect(receiptSchema.safeParse({ ...receipt, outcome: 'rejected', reason: 'priceMoved' }).success).toBe(true);
  });
});

describe('isNewerFrame', () => {
  const held = { session: 's1', rev: 5, step: 400 };

  it('takes the first frame', () => {
    expect(isNewerFrame(null, held)).toBe(true);
  });

  it('takes a later step at the same rev, and the same step again', () => {
    expect(isNewerFrame(held, { session: 's1', rev: 5, step: 401 })).toBe(true);
    expect(isNewerFrame(held, { session: 's1', rev: 5, step: 400 })).toBe(true);
  });

  it('refuses an older frame', () => {
    expect(isNewerFrame(held, { session: 's1', rev: 5, step: 399 })).toBe(false);
    expect(isNewerFrame(held, { session: 's1', rev: 4, step: 450 })).toBe(false);
  });

  it('lets rev beat step', () => {
    expect(isNewerFrame(held, { session: 's1', rev: 6, step: 398 })).toBe(true);
  });

  it('lets a new session win whatever its numbers', () => {
    expect(isNewerFrame(held, { session: 's2', rev: 0, step: 0 })).toBe(true);
  });
});
