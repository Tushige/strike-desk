import { describe, expect, it } from 'vitest';
import type { Series, SeriesSource } from '../../src/modules/price-chart/index';

/**
 * What any series source must do, whatever is behind it: hand out one object
 * until a point arrives, never change an object it has handed out, and tell
 * each subscriber once per change.
 *
 * This file is not a test file by itself: a test file names the source to
 * try, says how to make it grow and start again, and calls
 * `describeSeriesSourceContract`.
 */

export interface SeriesSourceUnderTest {
  source: SeriesSource;
  /** At least one more point arrives. */
  grow(): void;
  /** A new day starts the series again. */
  restart(): void;
}

function countTold(source: SeriesSource, subscribers: number): number[] {
  const told = Array.from({ length: subscribers }, () => 0);
  told.forEach((_count, index) => {
    source.subscribe(() => {
      told[index] = (told[index] ?? 0) + 1;
    });
  });
  return told;
}

function wholeAndAboveZero(series: Series): boolean {
  return series.values.every((value) => Number.isInteger(value) && value > 0);
}

export function describeSeriesSourceContract(name: string, make: () => SeriesSourceUnderTest): void {
  describe(`${name}: what any series source must do`, () => {
    it('gives the same series object twice in a row', () => {
      const { source } = make();

      expect(source.series()).toBe(source.series());
    });

    it('holds whole numbers above zero from a whole-number start index, before and after it grows', () => {
      const under = make();

      expect(Number.isInteger(under.source.series().startIndex)).toBe(true);
      expect(wholeAndAboveZero(under.source.series())).toBe(true);

      under.grow();

      expect(Number.isInteger(under.source.series().startIndex)).toBe(true);
      expect(wholeAndAboveZero(under.source.series())).toBe(true);
    });

    it('grows into another object that begins with the earlier values, and tells each subscriber once', () => {
      const under = make();
      const before = under.source.series();
      const earlier = [...before.values];
      const told = countTold(under.source, 2);

      under.grow();
      const after = under.source.series();

      expect(after).not.toBe(before);
      expect(after.startIndex).toBe(before.startIndex);
      expect(after.values.length).toBeGreaterThan(earlier.length);
      expect(after.values.slice(0, earlier.length)).toEqual(earlier);
      expect(told).toEqual([1, 1]);
    });

    it('never changes a series it has handed out', () => {
      const under = make();
      const before = under.source.series();
      const earlier = [...before.values];

      under.grow();
      under.restart();
      under.grow();

      expect(before.values).toEqual(earlier);
    });

    it('starts again as another object, and tells each subscriber once', () => {
      const under = make();
      under.grow();
      const before = under.source.series();
      const told = countTold(under.source, 2);

      under.restart();

      expect(under.source.series()).not.toBe(before);
      expect(told).toEqual([1, 1]);
    });

    it('tells a subscriber that unsubscribed nothing, and lets it unsubscribe twice', () => {
      const under = make();
      let told = 0;
      const unsubscribe = under.source.subscribe(() => {
        told += 1;
      });

      unsubscribe();
      unsubscribe();
      under.grow();
      under.restart();

      expect(told).toBe(0);
    });
  });
}
