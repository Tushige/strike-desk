// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173/?board=2500"}
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import { createSocketFactory, testFrame } from './fakeSocket';
import { createStressMeasurements } from '../src/board/stressMeasurements';
import type { IngestResult } from '../src/store/gameStore';

const stops: (() => void)[] = [];
afterEach(() => {
  cleanup();
  stops.splice(0).forEach((stop) => { stop(); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

function frame(): Frame {
  return testFrame({ stress: true, step: 1,
    clock: { phase: 'open', day: 1, stepsLeft: 100, priceIndex: 1, pace: 1 },
    board: { targetsPerCompany: 1, companies: [{ targets: [8000], lowestUpIndex: 0, highestDownIndex: 0, simpleUp: [0, 0, 0], simpleDown: [0, 0, 0] }] },
    quotes: [5000, 5000], quoteReals: [0, 0], quoteHopes: [5000, 5000], quoteBreakEvens: [13000, 3000],
  });
}

async function board() {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 500));
  const sockets = createSocketFactory();
  // Boot names the socket constructor once; a fake stands in for it here.
  vi.stubGlobal('WebSocket', function FakeWebSocket(url: string) { return sockets.create(url); });
  const boot = await import('../src/boot');
  stops.push(() => { boot.connection.close(); });
  const { ContractBoard } = await import('../src/board/ContractBoard');
  const view = render(createElement(ContractBoard, { selectedId: null, onSelect: () => {}, filter: null, isHighlighted: () => false }));
  act(() => { sockets.last().fireOpen(); });
  const send = (message: ServerMessage) => { act(() => { sockets.last().fireMessage(JSON.stringify(message)); }); };
  const advance = (ms: number) => { act(() => { vi.advanceTimersByTime(ms); }); };
  return { boot, view, sockets, send, advance };
}

it('shows received workload through the one Feed while the actual price cell updates', async () => {
  const { view, send, advance, sockets } = await board();
  send(frame());
  expect(view.queryByText('Records/s')).not.toBeNull();
  expect(view.getAllByText('Collecting…').length).toBeGreaterThan(0);
  send(frame());
  send({ t: 'quotes', session: 's-1', rev: 0, day: 1, step: 2, priceIndex: 2, prices: frame().prices,
    changes: [[0, 5100, 0, 5100, 13100]] });
  advance(1000);
  expect(view.getByText('Records/s').parentElement?.textContent).toContain('3');
  expect(view.getByText('Changes/s').parentElement?.textContent).toContain('1');
  expect(view.getByRole('grid', { name: 'Contracts' }).querySelector('.ag-row[row-id="0"] [col-id="price"]')?.textContent).toBe('$51');
  expect(sockets.made).toHaveLength(1);
});

const accepted = (extra: Partial<Extract<IngestResult, { accepted: true }>> = {}): IngestResult => ({
  accepted: true, kind: 'frame', session: 's-1', day: 1, phase: 'open', stress: true, boardReplaced: false, quoteChanges: [], ...extra,
});

function meter() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const measurements = createStressMeasurements({ now: () => performance.now(), schedule: (run, ms) => {
    const timer = setTimeout(run, ms); return () => { clearTimeout(timer); };
  } });
  measurements.setActive(true);
  stops.push(() => { measurements.setActive(false); });
  return measurements;
}

it('counts baseline and identical records separately from accepted four-value changes', () => {
  const measurements = meter();
  const baseline = testFrame({ quotes: [5000, 5100, 5200], stress: true });
  measurements.observe(baseline, accepted({ boardReplaced: true }), 0);
  measurements.observe(baseline, accepted(), 100);
  expect(measurements.get().records).toBe('Collecting…');
  vi.advanceTimersByTime(1000);
  expect(measurements.get()).toMatchObject({ records: 6, changes: 0 });
  const delta: ServerMessage = { t: 'quotes', session: 's-1', rev: 0, day: 1, step: 2, priceIndex: 2, prices: [8400], changes: [[0, 5000, 1, 4999, 13000]] };
  measurements.observe(delta, accepted({ kind: 'quotes', quoteChanges: [{ contractId: 0, priceCents: 5000, realCents: 1, hopeCents: 4999, breakEvenCents: 13000, priceChanged: false }] }), 1100);
  measurements.observe(delta, accepted({ kind: 'quotes' }), 1200);
  vi.advanceTimersByTime(1000);
  expect(measurements.get()).toMatchObject({ records: 2, changes: 1 });
});

it('counts discarded deltas and reply records once, but never error messages', () => {
  const measurements = meter();
  measurements.observe(frame(), accepted(), 0);
  vi.advanceTimersByTime(1000);
  measurements.observe({ t: 'quotes', session: 'old', rev: 0, day: 1, step: 0, priceIndex: 0, prices: [], changes: [[0, 1, 0, 1, 1], [1, 1, 0, 1, 1]] }, { accepted: false }, 1000);
  measurements.observe({ t: 'reply', receipt: { commandId: 'reply-1', kind: 'buy', step: 1, outcome: 'rejected', reason: 'marketClosed' }, frame: frame() }, accepted(), 1000);
  measurements.observe({ t: 'error', code: 'badMessage' }, { accepted: false }, 1000);
  vi.advanceTimersByTime(1000);
  expect(measurements.get()).toMatchObject({ records: 4, changes: 0 });
});

it('publishes stable once-second snapshots and discards partial paused or replaced windows', () => {
  const measurements = meter();
  measurements.observe(frame(), accepted(), 0);
  const snapshot = measurements.get();
  const listener = vi.fn();
  const unsubscribe = measurements.subscribe(listener);
  for (let i = 0; i < 20; i++) measurements.observe(frame(), accepted(), 100);
  vi.advanceTimersByTime(999);
  expect(measurements.get()).toBe(snapshot);
  expect(listener).not.toHaveBeenCalled();
  measurements.setActive(false);
  expect(measurements.get().records).toBe('Paused');
  vi.advanceTimersByTime(5000);
  measurements.setActive(true);
  expect(measurements.get().records).toBe('Collecting…');
  measurements.observe(frame(), accepted(), 6000);
  vi.advanceTimersByTime(1000);
  expect(measurements.get()).toMatchObject({ records: 2, changes: 0 });
  measurements.observe(frame(), accepted({ session: 'new', boardReplaced: true }), 7000);
  expect(measurements.get().records).toBe('Collecting…');
  unsubscribe();
});

it('leaves an ordinary granted fallback without a readout despite a stress URL', async () => {
  const { view, send, advance } = await board();
  send({ ...frame(), stress: false });
  advance(1000);
  expect(view.queryByText('Records/s')).toBeNull();
  expect(view.getByRole('grid', { name: 'Contracts' })).toBeDefined();
});
