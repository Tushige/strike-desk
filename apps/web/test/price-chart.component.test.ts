// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PriceChart } from '../src/screens/desk/PriceChart';
import { testFrame } from './fakeSocket';

vi.mock('../src/store/hooks', () => ({
  useSeries: () => ({ leadIn: [9_600, 9_400, 10_000], today: [10_000, 11_000, 9_000, 10_500] }),
}));

let width = 1_000;
let height = 192;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void { this.callback([{ contentRect: { width, height } } as ResizeObserverEntry], this); }
    unobserve(): void {}
    disconnect(): void {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const frame = testFrame({
  clock: { phase: 'open', day: 1, priceIndex: 3, stepsLeft: 497, pace: 1 },
  board: { targetsPerCompany: 2, companies: [{ targets: [8_000, 12_000], simpleUp: [0, 0, 1], simpleDown: [0, 1, 1], lowestUpIndex: 0, highestDownIndex: 1 }] },
});

it.each([[1_000, 192], [1_000, 224], [360, 224]])('uses the compact plot height at %i × %i and separates right-side price labels', (w, h) => {
  width = w;
  height = h;
  const { container } = render(createElement(PriceChart, {
    frame, companyId: 0, compact: true, ticket: null, twist: false,
    target: { side: 'up', targetCents: 10_000, breakEvenCents: 10_001 },
  }));
  const chart = screen.getByRole('img', { name: 'Price chart, now $105.00' });
  const trace = chart.querySelectorAll('polyline')[1];
  const points = trace?.getAttribute('points')?.split(' ').map((point) => point.split(',').map(Number)) ?? [];
  // The same observed $20 swing must have visible amplitude even in the
  // short comparison chart, and must not add any future price samples.
  expect(points).toHaveLength(4);
  const ys = points.map((point) => point[1] ?? 0);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(60);
  expect(Math.min(...ys)).toBeGreaterThan(0);
  expect(Math.max(...ys)).toBeLessThan(h - 30);

  const labels = [...container.querySelectorAll<HTMLElement>('.chart-level-label')];
  expect(labels.map((label) => label.textContent).sort()).toEqual(['Break-even$100.01', 'Target$100.00']);
  const tops = labels.map((label) => Number.parseFloat(label.style.top)).sort((a, b) => a - b);
  expect(tops[1]! - tops[0]!).toBeGreaterThanOrEqual(24);
  for (const label of labels) {
    expect(Number.parseFloat(label.style.left)).toBeGreaterThan(w - 144);
    expect(Number.parseFloat(label.style.top)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(label.style.top)).toBeLessThan(h - 20);
  }
  // Both views use one price bubble by the latest point, never a second
  // current-price presentation in the target/break-even rail.
  const bubble = screen.getByText('$105.00');
  expect(Number.parseFloat(bubble.style.left)).toBeLessThan(w - 144);
  expect(Number.parseFloat(bubble.style.top)).toBeGreaterThanOrEqual(8);
  expect(screen.queryByText('Now')).toBeNull();
});
