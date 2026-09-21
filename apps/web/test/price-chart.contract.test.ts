import { describe, expect, it } from 'vitest';
import { recordedFrame } from '../src/fixtures/recordedGame';
import { FAKE_LINES, FAKE_MARKERS, FAKE_RANGE, createFakeSeriesSource, recordedSeries } from '../src/modules/price-chart/fake';
import { describeSeriesSourceContract } from './contracts/seriesSource.contract';

/**
 * The series source's laws, tried against the synthetic series, and what the
 * chart's stand-in data is.
 */

describeSeriesSourceContract('the synthetic series', () => {
  const source = createFakeSeriesSource({ seed: 7, startCents: 8_400 });
  return {
    source,
    grow: () => {
      source.push(5);
    },
    restart: () => {
      source.reset();
    },
  };
});

describe('the synthetic series', () => {
  it('starts as its one opening point', () => {
    const source = createFakeSeriesSource({ seed: 7, startCents: 8_400 });

    expect(source.series()).toEqual({ startIndex: 0, values: [8_400] });
  });

  it('holds six values after five more', () => {
    const source = createFakeSeriesSource({ seed: 7, startCents: 8_400 });

    source.push(5);

    expect(source.series().values).toHaveLength(6);
  });

  it('moves each point by a whole step of at most 20 and never goes under 100', () => {
    const source = createFakeSeriesSource({ seed: 7, startCents: 110 });

    source.push(200);
    const { values } = source.series();

    expect(values.every((value) => value >= 100)).toBe(true);
    expect(values.every((value, index) => index === 0 || Math.abs(value - (values[index - 1] ?? 0)) <= 20)).toBe(true);
  });

  it('gives equal values from the same seed', () => {
    const one = createFakeSeriesSource({ seed: 7, startCents: 8_400 });
    const two = createFakeSeriesSource({ seed: 7, startCents: 8_400 });

    one.push(50);
    two.push(50);

    expect(one.series().values).toEqual(two.series().values);
    expect(one.series().values).toHaveLength(51);
  });

  it('adds one point on a jump, moved by the percentage', () => {
    const source = createFakeSeriesSource({ seed: 7, startCents: 8_400 });

    source.jump(10);

    // 8,400 plus a tenth of it.
    expect(source.series().values).toEqual([8_400, 9_240]);
  });

  it('tells a subscriber once for a jump', () => {
    const source = createFakeSeriesSource({ seed: 7, startCents: 8_400 });
    let told = 0;
    source.subscribe(() => {
      told += 1;
    });

    source.jump(-10);

    expect(told).toBe(1);
    expect(source.series().values).toEqual([8_400, 7_560]);
  });

  it('is its one opening point again after a reset, and then repeats itself', () => {
    const source = createFakeSeriesSource({ seed: 7, startCents: 8_400 });
    source.push(5);
    const firstRun = source.series().values;

    source.reset();
    expect(source.series()).toEqual({ startIndex: 0, values: [8_400] });

    source.push(5);
    expect(source.series().values).toEqual(firstRun);
  });
});

describe('the recorded day', () => {
  it('is the whole of day one for a company: 501 prices from the open, as the frame holds them', () => {
    const series = recordedSeries('day1-debrief', 0);

    expect(series.startIndex).toBe(0);
    expect(series.values).toHaveLength(501);
    expect(series.values).toEqual(recordedFrame('day1-debrief').history?.[0]);
  });

  it('is empty where the frame has no history, or no such company', () => {
    expect(recordedSeries('lobby', 0)).toEqual({ startIndex: 0, values: [] });
    expect(recordedSeries('day1-debrief', 6)).toEqual({ startIndex: 0, values: [] });
  });
});

describe("the chart's stand-in lines, markers and range", () => {
  it('are these', () => {
    expect(FAKE_RANGE).toEqual({ xMin: 0, xMax: 500, yMinCents: 7_300, yMaxCents: 9_300 });
    expect(FAKE_LINES).toEqual([
      { id: 'target', yCents: 8_500, label: 'Target $85.00', tone: 'target' },
      { id: 'breakEven', yCents: 8_618, label: 'Break-even $86.18', tone: 'breakEven' },
    ]);
    expect(FAKE_MARKERS).toEqual([
      { id: 'headline', xIndex: 0, label: 'Headline', kind: 'headline' },
      { id: 'entry', xIndex: 40, label: 'Bought', kind: 'entry' },
      { id: 'reveal', xIndex: 260, label: 'News out', kind: 'reveal' },
      { id: 'exit', xIndex: 330, label: 'Cashed out', kind: 'exit' },
      { id: 'bell', xIndex: 500, label: 'Closing bell', kind: 'bell' },
    ]);
  });
});
