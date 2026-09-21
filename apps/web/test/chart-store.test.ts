import { expect, it, vi } from 'vitest';
import type { Frame, QuotesMessage } from '@strike-desk/shared/protocol';
import { createChartStore } from '../src/gameplay/chartStore';

function frame(index = 0, prices = [10000, 20000], history?: number[][]): Frame {
  return {
    t: 'frame', session: 'chart-session', rev: 1, step: 300 + index,
    clock: { phase: 'open', day: 1, stepsLeft: 500 - index, priceIndex: index, pace: 1 },
    companies: [{ name: 'First company', ticker: 'ONE' }, { name: 'Second company', ticker: 'TWO' }],
    prices, minTicketCents: 500,
    board: { targetsPerCompany: 3, companies: [
      { targets: [9000, 10000, 11000], simpleUp: [1, 2, 2], simpleDown: [1, 0, 0], lowestUpIndex: 0, highestDownIndex: 2 },
      { targets: [19000, 20000, 21000], simpleUp: [1, 2, 2], simpleDown: [1, 0, 0], lowestUpIndex: 0, highestDownIndex: 2 },
    ] },
    quotes: [], quoteReals: [], quoteHopes: [], quoteBreakEvens: [],
    account: { cashCents: 100000000, worthCents: 100000000, capCents: 50000000, canBuy: false },
    positions: [], receipts: [], days: [], news: [], stress: false,
    ...(history === undefined ? {} : { history }),
  };
}

function batch(index: number, price: number, over: Partial<QuotesMessage> = {}): QuotesMessage {
  return { t: 'quotes', session: 'chart-session', rev: 1, step: 300 + index, day: 1, priceIndex: index, prices: [price, 20000], changes: [], ...over };
}

it('keeps literal cents at indexes zero, one and two without changing prior snapshots', () => {
  const store = createChartStore();
  const source = store.source(0);
  store.ingest(frame());
  const first = source.series();
  store.ingest(frame(1, [10100, 20000]));
  store.ingest(batch(2, 9900));
  expect(source.series()).toEqual({ startIndex: 0, values: [10000, 10100, 9900] });
  expect(first).toEqual({ startIndex: 0, values: [10000] });
  expect(store.source(0)).toBe(source);
});

it('holds a complete contiguous path across missing indexes until authoritative history repairs it', () => {
  const store = createChartStore();
  store.ingest(frame(2, [9900, 20000], [[10000, 10100, 9900], [20000, 20000, 20000]]));
  const complete = store.source(0).series();
  store.ingest(batch(5, 10500));
  store.ingest(frame(6, [10400, 20000]));
  expect(store.source(0).series()).toBe(complete);
  store.ingest(frame(6, [10400, 20000], [[10000, 10100, 9900, 9800, 10200, 10500, 10400]]));
  expect(store.source(0).series().values).toEqual([10000, 10100, 9900, 9800, 10200, 10500, 10400]);
});

it('preserves unchanged source and structural identity and replaces a duplicate index once', () => {
  const store = createChartStore();
  store.ingest(frame());
  const source = store.source(0);
  const initial = source.series();
  const view = store.get();
  const changed = vi.fn();
  const stop = source.subscribe(changed);
  store.ingest(frame(0, [10000, 20000], [[10000], [20000]]));
  expect(source.series()).toBe(initial);
  expect(changed).not.toHaveBeenCalled();
  store.ingest(frame(0, [10100, 20000]));
  expect(source.series().values).toEqual([10100]);
  expect(changed).toHaveBeenCalledOnce();
  expect(store.get()).toBe(view);
  expect(view.companies[0]).toEqual({ name: 'First company', yMinCents: 9000, yMaxCents: 11000 });
  stop(); stop();
  store.ingest(frame(1, [9900, 20000]));
  expect(changed).toHaveBeenCalledOnce();
});

it('orders frames and replies after accepted deltas and refuses mismatched deltas', () => {
  const store = createChartStore();
  store.ingest(batch(1, 50));
  expect(store.source(0).series().values).toEqual([]);
  store.ingest(frame());
  store.ingest(batch(1, 10100));
  const before = store.source(0).series();
  store.ingest(frame(0, [1, 2]));
  store.ingest({ t: 'reply', receipt: { commandId: 'start-chart', kind: 'start', step: 0, outcome: 'accepted' }, frame: { ...frame(20), rev: 0 } });
  for (const over of [{ session: 'foreign' }, { rev: 2 }, { day: 2 }]) store.ingest(batch(2, 5, over));
  expect(store.source(0).series()).toBe(before);
  store.ingest(batch(2, 9900));
  expect(store.source(0).series().values).toEqual([10000, 10100, 9900]);
});

it('clears unrelated day and session data, including when the first observation has a gap', () => {
  const store = createChartStore();
  store.ingest(frame());
  const old = store.source(0).series();
  const later = frame(5);
  store.ingest({ ...later, step: 1205, clock: { ...later.clock, day: 2 } });
  expect(store.source(0).series().values).toEqual([]);
  store.ingest({ ...frame(), session: 'new-session' });
  expect(store.get()).toMatchObject({ session: 'new-session', day: 1 });
  expect(store.source(0).series().values).toEqual([10000]);
  expect(old.values).toEqual([10000]);
});
