// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FinalScreen, SummaryComposition } from '../src/screens/FinalScreen';
import { BalanceJourney, balancePoints, journeyGeometry } from '../src/screens/summary/BalanceJourney';
import { testFrame } from './fakeSocket';

const replay = vi.hoisted(() => vi.fn());
vi.mock('../src/boot', () => ({ playAgain: replay }));
vi.mock('../src/store/hooks', () => ({ useScreenFrame: () => frame }));
const days = Array.from({ length: 5 }, (_, index) => ({ day: index + 1,
  startCents: index === 0 ? 100_000_000 : 99_990_000, endCents: 99_990_000, changeCents: index === 0 ? -10_000 : 0 }));
const frame = testFrame({ clock: { phase: 'final', day: 5, stepsLeft: 0, priceIndex: 500, pace: 1 }, days,
  final: { marketCode: 'TEST-MARKET', engine: 'test', content: 'test', finalCents: 99_990_000, changeCents: -10_000 },
  positions: [{ id: 'p1', day: 1, contractId: 0, companyId: 0, side: 'up', targetCents: 10_000, quantity: 1,
    entryPriceIndex: 0, entryStep: 0, entryPriceCents: 30_000, costCents: 30_000, status: 'cashedOut',
    valueCents: 20_000, profitCents: -10_000, realCents: 20_000, hopeCents: 0, breakEvenCents: 10_300, ifHeldCents: 40_000,
    exit: { kind: 'cashOut', step: 10, priceIndex: 10, priceCents: 20_000, proceedsCents: 20_000 } }],
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('defaults to Balance Journey, preserves full records and keeps the trace mounted when reviewing days', () => {
  const { container, rerender } = render(createElement(FinalScreen));
  expect(screen.queryByRole('combobox', { name: 'Summary style' })).toBeNull();
  expect(container.querySelector('.summary-journey')).not.toBeNull();
  const trace = container.querySelector('.summary-chart-trace');
  expect(trace?.getAttribute('d')).toMatch(/^M/);
  expect(screen.getByRole('img', { name: /Recorded balance/ }).getAttribute('aria-label')).toContain('Day 5, $999,900');
  const review = screen.getByRole('region', { name: 'Day 1 review' });
  expect(within(review).getByText('Cashed out during trading')).toBeTruthy();
  expect(within(review).getByText('Holding to the bell')).toBeTruthy();
  expect(within(review).getByText('$400')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review day 2, Sat out, $0' }));
  expect(screen.getByRole('region', { name: 'Day 2 review' }).textContent).toContain('You sat out.');
  expect(container.querySelector('.summary-chart-trace')).toBe(trace);
  rerender(createElement(FinalScreen));
  expect(container.querySelector('.summary-chart-trace')).toBe(trace);
});

it('retains alternative compositions in code with the same records and replay command', () => {
  const { rerender } = render(createElement(SummaryComposition, { frame, layout: 'journey' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review day 2, Sat out, $0' }));
  for (const style of ['receipt', 'journal', 'scorecard', 'journey'] as const) {
    rerender(createElement(SummaryComposition, { frame, layout: style }));
    expect(screen.getByRole('region', { name: 'Day 2 review' })).toBeTruthy();
    expect(screen.getByText('TEST-MARKET')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Review day/ })).toHaveLength(5);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
  expect(replay).toHaveBeenCalledTimes(1);
});

it('uses recorded balances even if changes differ and does not join missing days', () => {
  const input = [{ day: 3, startCents: 90, endCents: 110, changeCents: 0 }, { day: 1, startCents: 100, endCents: 80, changeCents: 999 }];
  expect(balancePoints(input)).toEqual([{ day: 0, cents: 100, start: true }, { day: 1, cents: 80, start: false },
    { day: 2, cents: 90, start: true }, { day: 3, cents: 110, start: false }]);
  expect(input[0]?.day).toBe(3);
  const geometry = journeyGeometry(balancePoints(input), 390, 150);
  expect(geometry.segments).toHaveLength(2);
  expect(geometry.segments[1]!.start).toBe(geometry.segments[0]!.length);
  expect(geometry.distances.at(-1)).toBe(geometry.total);
});

it('ends the responsive trace exactly at the fifth-day point', () => {
  for (const width of [320, 1000]) {
    const geometry = journeyGeometry(balancePoints(days), width, 180);
    const last = geometry.coordinates.at(-1)!;
    expect(last.x).toBe(width * .9);
    expect(geometry.segments.at(-1)!.path.endsWith(`L${String(last.x)},${String(last.y)}`)).toBe(true);
    expect(geometry.total).toBeGreaterThan(0);
  }
});

it('renders a flat run without invalid coordinates and an honest empty state without records', () => {
  const flat = days.map(one => ({ ...one, startCents: 0, endCents: 0, changeCents: 0 }));
  const view = render(createElement(BalanceJourney, { days: flat, selected: 1 }));
  const path = view.container.querySelector('path')?.getAttribute('d');
  expect(path).not.toMatch(/NaN|Infinity/);
  expect(balancePoints(flat).map(point => point.cents)).toEqual([0, 0, 0, 0, 0, 0]);
  view.rerender(createElement(BalanceJourney, { days: [], selected: 1 }));
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText('Daily balance records are not available for this run.')).toBeTruthy();
});
