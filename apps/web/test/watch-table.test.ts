// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173/?board=2500"}
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createSocketFactory, testFrame } from './fakeSocket';
import { createStressMeasurements } from '../src/board/stressMeasurements';
import { watchTable } from '../src/board/watchTable';
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

function watched(options: Parameters<typeof watchTable>[2] = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const measurements = createStressMeasurements({ now: () => performance.now(), schedule: (run, ms) => {
    const timer = setTimeout(run, ms); return () => { clearTimeout(timer); };
  } });
  const table = document.createElement('div');
  table.innerHTML = '<div class="ag-row" row-id="0"><div col-id="price">$50</div><div col-id="hopeCents">$50</div></div>';
  document.body.append(table);
  const callbacks = new Map<number, FrameRequestCallback>();
  let serial = 0;
  const stop = watchTable(table, measurements, {
    requestFrame: (run) => { callbacks.set(++serial, run); return serial; },
    cancelFrame: (id) => { callbacks.delete(id); },
    isVisible: (element) => element.isConnected && element.closest('[hidden]') === null,
    ...options,
  });
  const result = (quoteChanges: Extract<IngestResult, { accepted: true }>['quoteChanges'] = []): IngestResult => ({
    accepted: true, kind: 'frame', session: 's-1', day: 1, phase: 'open', stress: true, boardReplaced: false, quoteChanges,
  });
  measurements.observe(testFrame({ stress: true, quotes: [5000] }), result(), 0);
  const advance = (at: number) => { vi.advanceTimersByTime(at - performance.now()); };
  const frame = (at: number) => {
    advance(at);
    const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach((run) => { run(at); });
  };
  stops.push(() => { stop(); table.remove(); });
  return { measurements, table, callbacks, stop, frame, advance, result };
}

function change(watch: ReturnType<typeof watched>, at: number, priceCents: number, priceChanged = true) {
  watch.advance(at);
  watch.measurements.observe({ t: 'quotes', session: 's-1', rev: 0, day: 1, step: 2, priceIndex: 2, prices: [], changes: [[0, priceCents, 0, priceCents, 13000]] },
    watch.result([{ contractId: 0, priceCents, realCents: 0, hopeCents: priceCents, breakEvenCents: 13000, priceChanged }]), at);
}

async function text(watch: ReturnType<typeof watched>, value: string, column = 'price') {
  watch.table.querySelector(`[col-id="${column}"]`)!.textContent = value;
  await Promise.resolve();
}

it('correlates only the latest accepted price with its original receipt and samples it once', async () => {
  const watch = watched();
  change(watch, 100, 5100);
  change(watch, 120, 5200);
  await text(watch, '$51'); watch.frame(136);
  await text(watch, '$52'); watch.frame(150);
  await text(watch, '$52'); watch.frame(160);
  watch.advance(1000);
  expect(watch.measurements.get().clientDelay).toEqual({ p50: 30, p95: 30, samples: 1 });
});

it('measures a literal 36ms receipt-to-render opportunity without substituting processing time', async () => {
  const watch = watched();
  change(watch, 100, 5100);
  await text(watch, '$51'); watch.frame(136); watch.advance(1000);
  expect(watch.measurements.get().clientDelay).toEqual({ p50: 36, p95: 36, samples: 1 });
});

it('excludes unrelated columns, unchanged prices, hidden, detached and expired cells', async () => {
  const watch = watched();
  change(watch, 100, 5100);
  await text(watch, '$51', 'hopeCents'); watch.frame(136);
  watch.table.querySelector('[col-id="price"]')!.setAttribute('class', 'flash'); watch.frame(150);
  change(watch, 160, 5000, false);
  await text(watch, '$50'); watch.frame(180);
  watch.advance(1000);
  expect(watch.measurements.get().clientDelay).toBe('Collecting…');
  change(watch, 1100, 5200);
  watch.table.hidden = true;
  await text(watch, '$52'); watch.frame(1136);
  expect(watch.measurements.get().records).toBe('Paused');
  watch.table.hidden = false; watch.frame(1200);
  await text(watch, '$52'); watch.frame(1250);
  change(watch, 1300, 5300);
  watch.table.querySelector('.ag-row')!.remove();
  watch.frame(1336);
  watch.advance(2200);
  expect(watch.measurements.get().clientDelay).toBe('Collecting…');
  change(watch, 2300, 5400);
  watch.advance(12300);
  watch.table.innerHTML = '<div class="ag-row" row-id="0"><div col-id="price">$54</div></div>';
  await Promise.resolve(); watch.frame(12301); watch.advance(13200);
  expect(watch.measurements.get().clientDelay).toBe('Collecting…');
});

it('uses nearest-rank p50 and p95 and expires empty windows', async () => {
  const watch = watched();
  for (let sample = 1; sample <= 20; sample++) {
    change(watch, sample * 30, 5100);
    await text(watch, '$51'); watch.frame(sample * 30 + sample);
  }
  watch.advance(1000);
  expect(watch.measurements.get().clientDelay).toEqual({ p50: 10, p95: 19, samples: 20 });
  watch.advance(11000);
  expect(watch.measurements.get().clientDelay).toBe('Collecting…');
});

it('bounds retained distributions and long tasks under sustained input', () => {
  let deliver: (entries: readonly { startTime: number; duration: number }[]) => void = () => {};
  const watch = watched({ observeLongTasks: (callback) => { deliver = callback; return () => {}; } });
  for (let i = 0; i < 5000; i++) watch.frame(i / 10);
  watch.advance(600);
  deliver(Array.from({ length: 1200 }, () => ({ startTime: 100, duration: 51 })));
  watch.advance(1000);
  expect(watch.measurements.get().frameInterval).toMatchObject({ samples: 4096 });
  expect(watch.measurements.get().longTasks).toBe(1024);
  watch.stop(); watch.stop();
  expect(watch.callbacks.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(watch.measurements.get().records).toBe('Paused');
});

it.each([null, () => { throw new Error('observer refused'); }])('reports unavailable observation separately from a measured zero', (observeLongTasks) => {
  const watch = watched({ observeLongTasks });
  watch.frame(100); watch.frame(116); watch.advance(1000);
  expect(watch.measurements.get().longTasks).toBe('Unsupported');
  expect(watch.measurements.get().records).toBe(1);
  expect(watch.measurements.get().frameInterval).toEqual({ p50: 16, p95: 16, samples: 1 });
});

it('reports missing frame/text APIs honestly and resets candidates on board replacement', async () => {
  const unavailable = watched({ requestFrame: null, observeText: null });
  unavailable.advance(1000);
  expect(unavailable.measurements.get().clientDelay).toBe('Unsupported');
  expect(unavailable.measurements.get().frameInterval).toBe('Unsupported');
  unavailable.stop();
  const watch = watched();
  change(watch, 100, 5100);
  watch.measurements.observe(testFrame({ stress: true, quotes: [5000] }), { ...watch.result(), accepted: true, kind: 'frame', session: 'new', day: 2, phase: 'open', stress: true, quoteChanges: [], boardReplaced: true }, 100);
  await text(watch, '$51'); watch.frame(136); watch.advance(1100);
  expect(watch.measurements.get().clientDelay).toBe('Collecting…');
});

it('cleans up idempotently when both browser animation-frame APIs are absent', () => {
  vi.stubGlobal('requestAnimationFrame', undefined);
  vi.stubGlobal('cancelAnimationFrame', undefined);
  const stopTexts = vi.fn();
  const stopTasks = vi.fn();
  const watch = watched({ requestFrame: undefined, cancelFrame: undefined,
    observeText: () => stopTexts, observeLongTasks: () => stopTasks });
  watch.advance(1000);
  expect(watch.measurements.get().clientDelay).toBe('Unsupported');
  expect(watch.measurements.get().frameInterval).toBe('Unsupported');
  expect(() => { watch.stop(); watch.stop(); }).not.toThrow();
  expect(stopTexts).toHaveBeenCalledTimes(1);
  expect(stopTasks).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(watch.measurements.get().records).toBe('Paused');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(watch.measurements.get().records).toBe('Paused');
});

it('cancels a scheduled browser frame with handle zero once and ignores a late callback', () => {
  let pending: FrameRequestCallback = () => {};
  const requestFrame = vi.fn((run: FrameRequestCallback) => { pending = run; return 0; });
  const cancelFrame = vi.fn();
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  const watch = watched({ requestFrame: undefined, cancelFrame: undefined });
  expect(requestFrame).toHaveBeenCalledTimes(1);
  watch.stop(); watch.stop(); pending(16);
  expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(0);
  expect(requestFrame).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(watch.measurements.get().records).toBe('Paused');
});

it('excludes a table clipped outside its internal scrolling panel', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.id === 'clip' ? new DOMRect(0, 0, 300, 100) : new DOMRect(0, 120, 300, 400);
  });
  const watch = watched({ isVisible: undefined });
  const clip = document.createElement('div'); clip.id = 'clip'; clip.style.overflowY = 'auto';
  document.body.append(clip); clip.append(watch.table);
  stops.push(() => { clip.remove(); });
  watch.frame(100);
  expect(watch.measurements.get().records).toBe('Paused');
});

it('measures adjacent animation frames and resets the hidden-tab baseline', () => {
  const { measurements, frame, advance } = watched();
  frame(100); frame(116); frame(136);
  advance(1000);
  expect(measurements.get().frameInterval).toEqual({ p50: 16, p95: 20, samples: 2 });
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(measurements.get().frameInterval).toBe('Paused');
  advance(5000);
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  frame(5000); frame(5016);
  advance(6000);
  expect(measurements.get().frameInterval).toEqual({ p50: 16, p95: 16, samples: 1 });
});

it('counts only supported tasks strictly over 50ms within a continuous visible interval', () => {
  let deliver: (entries: readonly { startTime: number; duration: number }[]) => void = () => {};
  const disconnect = vi.fn();
  const { measurements, advance, stop } = watched({ observeLongTasks: (callback) => { deliver = callback; return disconnect; } });
  advance(500);
  deliver([{ startTime: 100, duration: 49 }, { startTime: 200, duration: 50 }, { startTime: 300, duration: 51 }]);
  advance(1000);
  expect(measurements.get().longTasks).toBe(1);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  advance(2000);
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  advance(2500);
  deliver([{ startTime: 950, duration: 100 }, { startTime: 1950, duration: 100 }]);
  advance(3000);
  expect(measurements.get().longTasks).toBe(0);
  stop(); stop();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('samples a changed Price cell rendered by the actual contract columns', async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 500));
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => { frames.set(++serial, run); return serial; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  const sockets = createSocketFactory();
  // Boot names the socket constructor once; a fake stands in for it here.
  vi.stubGlobal('WebSocket', function FakeWebSocket(url: string) { return sockets.create(url); });
  const { connection, stressMeasurements } = await import('../src/boot');
  stops.push(() => { connection.close(); });
  const { ContractBoard } = await import('../src/board/ContractBoard');
  const view = render(createElement(ContractBoard, { selectedId: null, onSelect: () => {}, filter: null, isHighlighted: () => false }));
  const frame = testFrame({ stress: true, step: 1,
    clock: { phase: 'open', day: 1, stepsLeft: 100, priceIndex: 1, pace: 1 },
    board: { targetsPerCompany: 1, companies: [{ targets: [8000], lowestUpIndex: 0, highestDownIndex: 0, simpleUp: [0, 0, 0], simpleDown: [0, 0, 0] }] },
    quotes: [5000, 5000], quoteReals: [0, 0], quoteHopes: [5000, 5000], quoteBreakEvens: [13000, 3000],
  });
  act(() => { sockets.last().fireOpen(); sockets.last().fireMessage(JSON.stringify(frame)); });
  act(() => { vi.advanceTimersByTime(100); });
  const price = view.getByRole('grid', { name: 'Contracts' }).querySelector('.ag-row[row-id="0"] [col-id="price"]');
  expect(price?.textContent).toBe('$50');
  act(() => { sockets.last().fireMessage(JSON.stringify({ t: 'quotes', session: 's-1', rev: 0, day: 1, step: 2, priceIndex: 2,
    prices: frame.prices, changes: [[0, 5100, 0, 5100, 13100]] })); vi.advanceTimersByTime(60); });
  await act(async () => { await Promise.resolve(); });
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((run) => { run(160); }); });
  expect(price?.textContent).toBe('$51');
  act(() => { vi.advanceTimersByTime(840); });
  expect(stressMeasurements.get().clientDelay).toEqual({ p50: 60, p95: 60, samples: 1 });
});
