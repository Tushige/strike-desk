// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173"}
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@strike-desk/shared/protocol';
import { createWsFeed } from '../src/feed/wsFeed';
import type { WsFeedOptions } from '../src/feed/wsFeed';
import { createSocketFactory, testFrame } from './fakeSocket';
import { createGameStore } from '../src/store/gameStore';

const stops: (() => void)[] = [];
afterEach(() => {
  cleanup();
  stops.splice(0).forEach((stop) => { stop(); });
  vi.doUnmock('../src/feed/wsFeed');
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

async function desk(processingDelay = 0) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const sockets = createSocketFactory();
  vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: (options: WsFeedOptions) => {
    const feed = createWsFeed({ ...options, createSocket: (url) => sockets.create(url), random: () => 0.5 });
    if (processingDelay > 0) feed.subscribe((event) => { if (event.type === 'message') vi.advanceTimersByTime(processingDelay); });
    stops.push(() => { feed.close(); });
    return feed;
  } }));
  const boot = await import('../src/boot');
  const { ComparisonDesk } = await import('../src/comparison/ComparisonDesk');
  const view = render(createElement(ComparisonDesk, { comparison: boot.comparisonStore, game: boot.store }));
  act(() => { sockets.last().fireOpen(); });
  const send = (frame: ServerMessage) => { act(() => { sockets.last().fireMessage(JSON.stringify(frame)); }); };
  const advance = (ms: number) => { act(() => { vi.advanceTimersByTime(ms); }); };
  return { view, sockets, send, advance, boot };
}

const openFrame = () => testFrame({ clock: { phase: 'open', day: 1, stepsLeft: 100, priceIndex: 1, pace: 1 }, step: 1 });

it('shows waiting at the accepted-data deadline and elapsed age through the desk', async () => {
  const { view, send, advance } = await desk();
  advance(100);
  send(openFrame());
  advance(1499);
  expect(view.queryByText('Last update: 1 seconds ago')).toBeNull();
  advance(1);
  expect(view.queryByText('Waiting for new prices')).not.toBeNull();
  expect(view.queryByText('Last update: 1 seconds ago')).not.toBeNull();
  advance(1500);
  expect(view.queryByText('Last update: 3 seconds ago')).not.toBeNull();
});

it('uses the original receipt time even when processing is late', async () => {
  const { view, send, advance } = await desk(3000);
  advance(100);
  send(openFrame());
  expect(view.queryByText('Last update: 3 seconds ago')).not.toBeNull();
});

it('refreshes equal quiet pre-bell frames without publishing every timestamp', async () => {
  const { view, send, advance, boot } = await desk();
  const frame = { ...openFrame(), clock: { ...openFrame().clock, phase: 'preBell' as const } };
  send(frame);
  const snapshot = boot.deskFreshness.get();
  const changed = vi.fn();
  const stop = boot.deskFreshness.subscribe(changed);
  advance(1400);
  send(frame);
  expect(boot.deskFreshness.get()).toBe(snapshot);
  expect(changed).not.toHaveBeenCalled();
  advance(1499);
  expect(view.queryByText('Waiting for new prices')).toBeNull();
  advance(1);
  expect(view.queryByText('Waiting for new prices')).not.toBeNull();
  send(frame);
  expect(view.queryByText('Waiting for new prices')).toBeNull();
  stop();
});

it('never refreshes from malformed input, errors, old frames or mismatched deltas', async () => {
  const { view, send, advance, sockets } = await desk();
  send(openFrame());
  advance(3100);
  const delta = { t: 'quotes' as const, priceIndex: 2, session: 's-1', rev: 0, step: 2, day: 1, prices: [8400], changes: [] };
  const rejected: ServerMessage[] = [
    { t: 'error', code: 'badMessage' }, { ...openFrame(), step: 0 },
    { ...delta, session: 'other' }, { ...delta, day: 2 }, { ...delta, rev: 1 }, { ...delta, step: 0 },
  ];
  act(() => { sockets.last().fireMessage('{broken'); });
  for (const message of rejected) {
    send(message);
    expect(view.queryByText('Last update: 3 seconds ago')).not.toBeNull();
  }
  send(delta);
  expect(view.queryByText('Waiting for new prices')).toBeNull();
});

it('reports accepted quote changes without counting baselines, repeats or cost-only updates', () => {
  const game = createGameStore();
  const frame = testFrame({ ...openFrame(), stress: true,
    board: { targetsPerCompany: 1, companies: [{ targets: [8000], lowestUpIndex: 0, highestDownIndex: 0, simpleUp: [0, 0, 0], simpleDown: [0, 0, 0] }] },
    quotes: [5000, 6000], quoteReals: [1000, 2000], quoteHopes: [4000, 4000], quoteBreakEvens: [13000, 2000],
  });
  expect(game.ingest(frame)).toMatchObject({ accepted: true, kind: 'frame', session: 's-1', day: 1, phase: 'open', stress: true, boardReplaced: true, quoteChanges: [] });
  expect(game.ingest(frame)).toMatchObject({ accepted: true, boardReplaced: false, quoteChanges: [] });
  game.setRequestedDraft({ contractId: 0, spendCents: 10000 });
  expect(game.ingest({ ...frame, draft: { contractId: 0, spendCents: 10000, costs: [10000, 6000] } })).toMatchObject({ quoteChanges: [] });
  const updated = { ...frame, step: 2, quoteReals: [2000, 2000], quoteHopes: [3000, 4000] };
  expect(game.ingest(updated)).toMatchObject({ quoteChanges: [{ contractId: 0, priceCents: 5000, realCents: 2000, hopeCents: 3000, breakEvenCents: 13000, priceChanged: false }] });
  const delta = { t: 'quotes' as const, priceIndex: 2, session: 's-1', rev: 0, day: 1, step: 3, prices: frame.prices, changes: [[0, 5100, 2000, 3100, 13100] as [number, number, number, number, number]] };
  expect(game.ingest(delta)).toMatchObject({ kind: 'quotes', stress: true, quoteChanges: [{ contractId: 0, priceCents: 5100, realCents: 2000, hopeCents: 3100, breakEvenCents: 13100, priceChanged: true }] });
  expect(game.ingest(delta)).toMatchObject({ quoteChanges: [] });
  expect(game.ingest(frame)).toEqual({ accepted: false });
  expect(game.ingest({ ...frame, session: 's-2' })).toMatchObject({ boardReplaced: true, quoteChanges: [] });
});

it('keeps reconnect waiting through socket-open and the first accepted full frame', async () => {
  const { view, send, advance, sockets, boot } = await desk();
  expect(view.queryByText(/Last update:/)).toBeNull();
  send(openFrame());
  act(() => { sockets.last().fireClose(); });
  expect(view.queryByText('Waiting for new prices')).not.toBeNull();
  advance(1000);
  act(() => { sockets.last().fireOpen(); });
  expect(view.queryByText('Waiting for new prices')).not.toBeNull();
  act(() => { sockets.last().fireMessage(JSON.stringify({ t: 'quotes', priceIndex: 2, session: 's-1', rev: 0, step: 2, day: 1, prices: [8400], changes: [] })); });
  expect(boot.deskFreshness.get().line).toBe('offline');
  send({ ...openFrame(), step: 3 });
  expect(boot.deskFreshness.get().line).toBe('stale');
  expect(view.queryByText('Waiting for new prices')).not.toBeNull();
  send({ ...openFrame(), step: 3 });
  expect(boot.deskFreshness.get().line).toBe('live');
  expect(view.queryByText('Waiting for new prices')).toBeNull();
});

it.each(['lobby', 'debrief', 'final'] as const)('does not warn about silence in authoritative %s', async (phase) => {
  const { view, send, advance } = await desk();
  send(testFrame({ clock: { ...openFrame().clock, phase } }));
  advance(4000);
  expect(view.queryByText('Waiting for new prices')).toBeNull();
  expect(view.queryByText(/Last update:/)).toBeNull();
});

it('resets freshness identity when a full frame replaces the session or day', async () => {
  const { send, sockets, advance, boot, view } = await desk();
  send(openFrame());
  act(() => { sockets.last().fireClose(); });
  advance(1000);
  act(() => { sockets.last().fireOpen(); });
  send({ ...openFrame(), session: 's-2', step: 0 });
  expect(boot.deskFreshness.get().line).toBe('live');
  advance(1500);
  expect(view.queryByText(/Last update:/)).not.toBeNull();
  send({ ...openFrame(), session: 's-2', rev: 1, clock: { ...openFrame().clock, day: 2 } });
  expect(view.queryByText(/Last update:/)).toBeNull();
  advance(1500);
  send({ t: 'quotes', priceIndex: 2, session: 's-2', rev: 1, step: 2, day: 1, prices: [8400], changes: [] });
  expect(boot.deskFreshness.get().waiting).toBe(true);
});
