import { recordedFrame } from '../../fixtures/recordedGame';
import type { RecordedLabel } from '../../fixtures/recordedGame';
import type { ChartLine, ChartMarker, PriceChartProps, Series, SeriesSource } from './ports';

/**
 * Stand-in data for the chart, for showing it away from the running game and
 * for tests: a seeded synthetic series that moves only when told to, one
 * recorded day of a real game, and a set of lines, markers and a range to
 * draw with them.
 *
 * Nothing here holds a timer or reads a clock, and the synthetic series draws
 * its randomness from the seed it is given. The words on the lines and
 * markers below are stand-ins for a demo; the game chooses its own.
 */

export interface FakeSeriesSource extends SeriesSource {
  /** Adds this many points, then tells subscribers once. */
  readonly push: (count: number) => void;
  /** Adds one point moved by this percentage, rounded to a whole number: a headline landing. */
  readonly jump: (percent: number) => void;
  /** Back to the single opening point, and the randomness starts over, so a demo can loop. */
  readonly reset: () => void;
}

const LARGEST_STEP = 20;
const LOWEST_POINT = 100;

/** The well-known mulberry32 step: a small seeded generator of numbers from 0 up to, not including, 1. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function createFakeSeriesSource(options: { seed: number; startCents: number }): FakeSeriesSource {
  const listeners = new Set<() => void>();
  let random = mulberry32(options.seed);
  let held: Series = { startIndex: 0, values: [options.startCents] };

  /** Always a new object with a new array: one handed out earlier is never touched. */
  function replace(values: readonly number[]): void {
    held = { startIndex: 0, values };
    for (const listener of [...listeners]) listener();
  }

  function last(values: readonly number[]): number {
    return values.at(-1) ?? options.startCents;
  }

  return {
    series: () => held,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push(count) {
      const values = [...held.values];
      for (let added = 0; added < count; added += 1) {
        const step = Math.floor(random() * (2 * LARGEST_STEP + 1)) - LARGEST_STEP;
        values.push(Math.max(LOWEST_POINT, last(values) + step));
      }
      if (values.length > held.values.length) replace(values);
    },
    jump(percent) {
      const from = last(held.values);
      const moved = Math.round(from + (from * percent) / 100);
      replace([...held.values, Math.max(LOWEST_POINT, moved)]);
    },
    reset() {
      random = mulberry32(options.seed);
      replace([options.startCents]);
    },
  };
}

/**
 * One company's prices as a recorded frame holds them, from the day's open.
 * Empty when that frame has no history or no such company. It picks; it does
 * not compute.
 */
export function recordedSeries(label: RecordedLabel, companyId: number): Series {
  return { startIndex: 0, values: recordedFrame(label).history?.[companyId] ?? [] };
}

export const FAKE_RANGE: Pick<PriceChartProps, 'xMin' | 'xMax' | 'yMinCents' | 'yMaxCents'> = {
  xMin: 0,
  xMax: 500,
  yMinCents: 7_300,
  yMaxCents: 9_300,
};

export const FAKE_LINES: readonly ChartLine[] = [
  { id: 'target', yCents: 8_500, label: 'Target $85.00', tone: 'target' },
  { id: 'breakEven', yCents: 8_618, label: 'Break-even $86.18', tone: 'breakEven' },
];

export const FAKE_MARKERS: readonly ChartMarker[] = [
  { id: 'headline', xIndex: 0, label: 'Headline', kind: 'headline' },
  { id: 'entry', xIndex: 40, label: 'Bought', kind: 'entry' },
  { id: 'reveal', xIndex: 260, label: 'News out', kind: 'reveal' },
  { id: 'exit', xIndex: 330, label: 'Cashed out', kind: 'exit' },
  { id: 'bell', xIndex: 500, label: 'Closing bell', kind: 'bell' },
];
