import { describe, expect, it, vi } from 'vitest';
import type { Frame, QuotesMessage } from '@strike-desk/shared/protocol';
import { createComparisonStore } from '../src/comparison/comparisonStore';

function frame(): Frame {
  return {
    t: 'frame', session: 'comparison-session', rev: 1, step: 300,
    clock: { phase: 'open', day: 1, stepsLeft: 500, priceIndex: 0, pace: 1 },
    companies: [{ name: 'Example', ticker: 'EX' }], prices: [8500], minTicketCents: 500,
    board: { targetsPerCompany: 3, companies: [{ targets: [8000, 8500, 9000], simpleUp: [0, 1, 2], simpleDown: [2, 1, 0], lowestUpIndex: 0, highestDownIndex: 2 }] },
    quotes: [5000, 5000, 5000, 5000, 5000, 5000], quoteReals: [0, 0, 0, 0, 0, 0], quoteHopes: [5000, 5000, 5000, 5000, 5000, 5000],
    quoteBreakEvens: [8500, 7500, 9000, 8000, 9500, 8500],
    account: { cashCents: 100000000, worthCents: 100000000, capCents: 50000000, canBuy: true },
    positions: [], receipts: [], days: [], stress: false, news: [],
    // These are synthetic server answers: two $50 tickets cost $100.
    draft: { contractId: 0, spendCents: 10000, costs: [10000, 10000, 10000, 10000, 10000, 10000], ticket: {
      contractId: 0, priceCents: 5000, quantity: 2, costCents: 10000, limitPriceCents: 5100, breakEvenCents: 8500,
      whatIf: [{ atCents: 8400, profitCents: -10000 }, { atCents: 8500, profitCents: 0 }, { atCents: 8600, profitCents: 10000 }],
    } },
  };
}

function batch(overrides: Partial<QuotesMessage> = {}): QuotesMessage {
  return { t: 'quotes', session: 'comparison-session', rev: 1, step: 310, day: 1, priceIndex: 10, prices: [8600], changes: [], ...overrides };
}

describe('comparison server answers', () => {
  it('publishes the matching server answer and withholds it immediately on a changed request', () => {
    const store = createComparisonStore(vi.fn(() => true));
    store.ingest(frame());
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.ingest(frame());
    expect(store.quote.get()).toMatchObject({ contractId: 0, spendCents: 10000, priceCents: 5000, costCents: 10000, quantity: 2, breakEvenCents: 8500 });
    store.setRequestedDraft({ contractId: 0, spendCents: 20000 });
    expect(store.quote.get()).toBeNull();
  });

  it('withdraws an incompatible selected delta until a whole frame catches up', () => {
    const store = createComparisonStore(vi.fn(() => true));
    store.ingest(frame());
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.ingest(frame());
    const answer = store.quote.get();
    store.ingest(batch({ changes: [[1, 5500, 0, 5500, 8500]] }));
    expect(store.quote.get()).toBe(answer);
    store.ingest(batch({ step: 311, changes: [[0, 5100, 0, 5100, 8501]] }));
    expect(store.quote.get()).toBeNull();
    store.ingest({ ...frame(), step: 310 });
    expect(store.quote.get()).toBeNull();
    store.ingest({ ...frame(), step: 311 });
    expect(store.quote.get()?.priceCents).toBe(5000);
  });

  it('keeps an equal selected quote stable without notifying its readers', () => {
    const store = createComparisonStore(vi.fn(() => true));
    store.ingest(frame());
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.ingest(frame());
    const answer = store.quote.get();
    const changed = vi.fn();
    const stop = store.quote.subscribe(changed);
    store.ingest({ ...frame(), step: 301 });
    expect(store.quote.get()).toBe(answer);
    expect(changed).not.toHaveBeenCalled();
    stop();
  });

  it('publishes structural and account data once and preserves both across quote-only frames', () => {
    const store = createComparisonStore(vi.fn(() => true));
    store.ingest(frame());
    expect(store.overview.get()).toMatchObject({ session: 'comparison-session', day: 1, phase: 'open' });
    expect(store.account.get()).toEqual({ cashCents: 100000000, capCents: 50000000, minTicketCents: 500, canBuy: true });
    const structure = store.overview.get();
    const account = store.account.get();
    const changed = vi.fn();
    const stop = store.overview.subscribe(changed);
    const stopAccount = store.account.subscribe(changed);
    store.ingest({ ...frame(), step: 301, prices: [8600] });
    store.ingest(batch());
    expect(store.overview.get()).toBe(structure);
    expect(store.account.get()).toBe(account);
    expect(changed).not.toHaveBeenCalled();
    stop(); stopAccount();
  });

  it.each(['day', 'session'] as const)('forgets the requested instrument when the %s changes', (change) => {
    const store = createComparisonStore(vi.fn(() => true));
    store.ingest(frame());
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.ingest(frame());
    const next = frame();
    if (change === 'day') { next.clock.day = 2; next.step = 900; }
    else { next.session = 'new-session'; next.rev = 0; next.step = 0; }
    store.ingest(next);
    expect(store.quote.get()).toBeNull();
  });

  it('sends nothing before a frame and retains only the latest failed preview request', () => {
    const send = vi.fn(() => false);
    const store = createComparisonStore(send);
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.sendDraft({ contractId: 0, spendCents: 10000 });
    expect(send).not.toHaveBeenCalled();
    store.ingest(frame());
    expect(send).toHaveBeenLastCalledWith({ t: 'draft', contractId: 0, spendCents: 10000 });
    store.setRequestedDraft({ contractId: 1, spendCents: 20000 });
    store.sendDraft({ contractId: 1, spendCents: 20000 });
    send.mockReturnValue(true);
    store.ingest({ ...frame(), step: 301 });
    expect(send).toHaveBeenLastCalledWith({ t: 'draft', contractId: 1, spendCents: 20000 });
    expect(send).toHaveBeenCalledTimes(3);
    store.ingest({ ...frame(), step: 302 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it.each([
    { session: 'other' }, { day: 2 }, { rev: 0 }, { rev: 2 }, { step: 299 },
  ])('rejects incompatible batches without moving the watermark %j', (overrides) => {
    const store = createComparisonStore(vi.fn(() => true));
    store.ingest(batch({ step: 999 }));
    expect(store.overview.get().session).toBeNull();
    store.ingest(frame());
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.ingest(frame());
    const answer = store.quote.get();
    store.ingest(batch({ step: 999, changes: [[0, 5100, 0, 5100, 8501]], ...overrides }));
    expect(store.quote.get()).toBe(answer);
    const next = frame();
    next.step = 301;
    next.account.cashCents = 90000000;
    store.ingest(next);
    expect(store.account.get().cashCents).toBe(90000000);
  });

  it.each(['outer contract', 'spend', 'ticket contract', 'price', 'break-even', 'absent'] as const)('withholds a full-frame answer with a mismatching %s', (field) => {
    const store = createComparisonStore(vi.fn(() => true));
    store.ingest(frame());
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.ingest(frame());
    const next = frame();
    if (next.draft?.ticket === undefined) throw new Error('missing synthetic answer');
    if (field === 'outer contract') next.draft.contractId = 1;
    if (field === 'spend') next.draft.spendCents = 20000;
    if (field === 'ticket contract') next.draft.ticket.contractId = 1;
    if (field === 'price') next.draft.ticket.priceCents = 5100;
    if (field === 'break-even') next.draft.ticket.breakEvenCents = 8501;
    if (field === 'absent') delete next.draft;
    store.ingest(next);
    expect(store.quote.get()).toBeNull();
  });

  it('accepts equal-watermark replies but rejects older replies after quote batches', () => {
    const store = createComparisonStore(vi.fn(() => true));
    store.ingest(frame());
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.ingest(batch());
    const receipt = { commandId: 'example-start', kind: 'start' as const, step: 0, outcome: 'accepted' as const };
    store.ingest({ t: 'reply', receipt, frame: { ...frame(), step: 309 } });
    expect(store.quote.get()).toBeNull();
    store.ingest({ t: 'reply', receipt, frame: { ...frame(), step: 310 } });
    expect(store.quote.get()?.costCents).toBe(10000);
  });

  it.each([
    { change: [0, 5100, 0, 5100, 8500] },
    { change: [0, 5000, 0, 5000, 8501] },
  ] as const)('withdraws the selected answer when either comparison value changes %j', ({ change }) => {
    const store = createComparisonStore(vi.fn(() => true));
    store.ingest(frame());
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.ingest(frame());
    store.ingest(batch({ changes: [[...change]] }));
    expect(store.quote.get()).toBeNull();
  });

  it('does not retry a pending old choice between an immediate edit and its paced report', () => {
    const send = vi.fn(() => false);
    const store = createComparisonStore(send);
    store.ingest(frame());
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.sendDraft({ contractId: 0, spendCents: 10000 });
    const requested = store.requested.get();
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    expect(store.requested.get()).toBe(requested);
    store.setRequestedDraft({ contractId: 1, spendCents: 20000 });
    store.ingest({ ...frame(), step: 301 });
    store.sendDraft({ contractId: 0, spendCents: 10000 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['day', 'session'] as const)('drops pending context on another %s and ignores stale paced reports', (change) => {
    const send = vi.fn(() => false);
    const store = createComparisonStore(send);
    store.ingest(frame());
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.sendDraft({ contractId: 0, spendCents: 10000 });
    const next = frame();
    if (change === 'day') { next.clock.day = 2; next.step = 900; }
    else next.session = 'new-session';
    store.ingest(next);
    expect(store.requested.get()).toEqual({ contractId: null, spendCents: null });
    store.sendDraft({ contractId: 0, spendCents: 10000 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('waits for a valid frame after reconnection before flushing the latest preview', () => {
    const send = vi.fn(() => true);
    const store = createComparisonStore(send);
    store.ingest(frame());
    store.setStatus('reconnecting');
    store.setRequestedDraft({ contractId: 0, spendCents: 10000 });
    store.sendDraft({ contractId: 0, spendCents: 10000 });
    store.setStatus('live');
    store.ingest(batch());
    expect(send).not.toHaveBeenCalled();
    store.ingest({ ...frame(), step: 310 });
    expect(send).toHaveBeenCalledExactlyOnceWith({ t: 'draft', contractId: 0, spendCents: 10000 });
    expect(store.overview.get().status).toBe('live');
  });
});
