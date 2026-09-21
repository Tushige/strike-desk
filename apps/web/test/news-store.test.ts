import { describe, expect, it, vi } from 'vitest';
import type { Frame, QuotesMessage, Reply } from '@strike-desk/shared/protocol';
import { createNewsStore } from '../src/news/newsStore';

function frame(): Frame {
  return {
    t: 'frame', session: 'news-session', rev: 1, step: 300,
    clock: { phase: 'open', day: 1, stepsLeft: 500, priceIndex: 0, pace: 1 },
    companies: [{ name: 'First company', ticker: 'ONE' }, { name: 'Second company', ticker: 'TWO' }],
    prices: [10000, 20000], minTicketCents: 500, board: null,
    quotes: [], quoteReals: [], quoteHopes: [], quoteBreakEvens: [],
    account: { cashCents: 100000000, worthCents: 100000000, capCents: 50000000, canBuy: false },
    positions: [], receipts: [], days: [], stress: false,
    news: [{ id: 0, day: 1, companyId: 0, trust: 3, source: 'Source', title: 'Headline', body: 'Body', direction: 'up', revealed: false }],
  };
}

function batch(overrides: Partial<QuotesMessage> = {}): QuotesMessage {
  return { t: 'quotes', session: 'news-session', rev: 1, step: 320, day: 1, priceIndex: 20, prices: [10100, 20100], changes: [], ...overrides };
}

function reply(current: Frame): Reply {
  return { t: 'reply', receipt: { commandId: 'start-news', kind: 'start', step: 0, outcome: 'accepted' }, frame: current };
}

describe('the public news slice', () => {
  it('keeps the same snapshot and sends no notification when only quotes and the clock change', () => {
    const store = createNewsStore();
    const initial = frame();
    store.ingest(initial);
    const snapshot = store.getSnapshot();
    const changed = vi.fn();
    store.subscribe(changed);
    store.ingest({ ...initial, step: 310, prices: [10200, 20100], clock: { ...initial.clock, priceIndex: 10, stepsLeft: 490 } });
    store.ingest(batch());
    store.ingest(reply({ ...initial, step: 320, clock: { ...initial.clock, priceIndex: 20, stepsLeft: 480 } }));
    expect(store.getSnapshot()).toBe(snapshot);
    expect(changed).toHaveBeenCalledTimes(0);
  });

  it('notifies for a changed headline and a passed reveal, but not for a repeated frame', () => {
    const store = createNewsStore();
    const current = frame();
    store.ingest(current);
    const changed = vi.fn();
    const stop = store.subscribe(changed);
    const headline = current.news[0];
    if (headline === undefined) throw new Error('missing test headline');
    const updated = { ...current, news: [{ ...headline, body: 'Changed body' }] };
    store.ingest(updated);
    const snapshot = store.getSnapshot();
    expect(snapshot.news[0]?.body).toBe('Changed body');
    store.ingest(updated);
    expect(store.getSnapshot()).toBe(snapshot);
    expect(changed).toHaveBeenCalledTimes(1);
    const revealed: Frame = { ...updated, step: 500, clock: { ...current.clock, priceIndex: 200 }, news: [{ ...headline, revealed: true, revealIndex: 190 }] };
    store.ingest(revealed);
    expect(store.getSnapshot().news[0]).toMatchObject({ revealed: true, revealIndex: 190 });
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    store.ingest({ ...revealed, step: 501, news: [] });
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('uses accepted quote batches as an ordering watermark against late frames and replies', () => {
    const store = createNewsStore();
    const current = frame();
    store.ingest(current);
    const snapshot = store.getSnapshot();
    store.ingest(batch());
    store.ingest({ ...current, step: 319, news: [] });
    store.ingest(reply({ ...current, rev: 0, step: 999, news: [] }));
    expect(store.getSnapshot()).toBe(snapshot);
    store.ingest({ ...current, step: 320, news: [] });
    expect(store.getSnapshot().news).toEqual([]);
  });

  it.each([
    { session: 'other-session' }, { day: 2 }, { rev: 2 }, { rev: 0 }, { step: 299 },
  ])('ignores an incompatible or older quote batch %j without poisoning the next whole frame', (overrides) => {
    const store = createNewsStore();
    const current = frame();
    store.ingest(batch({ step: 999 }));
    expect(store.getSnapshot().session).toBeNull();
    store.ingest(current);
    const snapshot = store.getSnapshot();
    store.ingest(batch({ step: 999, ...overrides }));
    expect(store.getSnapshot()).toBe(snapshot);
    store.ingest({ ...current, step: 301, news: [] });
    expect(store.getSnapshot().news).toEqual([]);
  });

  it('resets on a new day or session and excludes another day or a missing company', () => {
    const store = createNewsStore();
    const current = frame();
    store.ingest(current);
    store.ingest({ ...current, step: 900, clock: { ...current.clock, day: 2, phase: 'preBell' } });
    expect(store.getSnapshot()).toMatchObject({ session: 'news-session', day: 2, news: [] });
    store.ingest({ ...current, session: 'next-session', rev: 0, step: 0, companies: [] });
    expect(store.getSnapshot()).toMatchObject({ session: 'next-session', day: 1, news: [] });
  });

  it('copies only card data, discarding outcomes, future reveal indices and every unrelated section', () => {
    const store = createNewsStore();
    const current = frame();
    const headline = current.news[0];
    if (headline === undefined) throw new Error('missing test headline');
    const contaminated: Frame = { ...current, news: [{ ...headline, wasTrue: true, revealIndex: 200 }] };
    store.ingest(contaminated);
    const snapshot = store.getSnapshot();
    expect(Object.keys(snapshot).every((key) => ['day', 'news', 'session', 'bannerCompanyName'].includes(key))).toBe(true);
    expect(snapshot.news[0]).toEqual({
      id: 0, day: 1, companyId: 0, companyName: 'First company', ticker: 'ONE', trust: 3,
      source: 'Source', title: 'Headline', body: 'Body', direction: 'up', revealed: false,
    });
    contaminated.news[0]!.body = 'Mutated after ingestion';
    contaminated.companies[0]!.name = 'Mutated company';
    expect(snapshot.news[0]?.body).toBe('Body');
    expect(snapshot.news[0]?.companyName).toBe('First company');
    store.ingest({ ...current, step: 301, news: [{ ...headline, revealed: true, revealIndex: 200 }] });
    expect(store.getSnapshot().news[0]).not.toHaveProperty('revealIndex');
  });
});
