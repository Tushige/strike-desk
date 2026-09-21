import { describe, expect, it } from 'vitest';
import type { GridRow, RowSource } from '../../src/modules/live-grid/index';

/**
 * What any row source must do, whatever is behind it: the day's rows held
 * still, the changed rows handed over as new objects and only to the one
 * sink, and the latest row for every id there to catch up with.
 *
 * This file is not a test file by itself: a test file names the source to
 * try, says how to make it change, and calls `describeRowSourceContract`.
 */

export interface RowSourceUnderTest {
  source: RowSource<GridRow>;
  /** Changes what at least one row shows, not all of them, and returns the ids it changed. */
  change(): readonly string[];
  /** An update arrives in which nothing changed. */
  repeat(): void;
  /** The whole row set is replaced, as for a new day. */
  replace(): void;
}

interface Watched {
  batches: (readonly GridRow[])[];
  stop: () => void;
}

function watch(source: RowSource<GridRow>): Watched {
  const batches: (readonly GridRow[])[] = [];
  const stop = source.onChanged((changed) => {
    batches.push(changed);
  });
  return { batches, stop };
}

function ids(rows: readonly GridRow[]): string[] {
  return rows.map((row) => row.id);
}

function byId(rows: readonly GridRow[]): Map<string, GridRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

export function describeRowSourceContract(name: string, make: () => RowSourceUnderTest): void {
  describe(`${name}: what any row source must do`, () => {
    it('gives the same array of rows twice in a row: at least three, every id a string that appears once', () => {
      const { source } = make();
      const rows = source.rows();

      expect(source.rows()).toBe(rows);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect(rows.every((row) => typeof row.id === 'string')).toBe(true);
      expect(new Set(ids(rows)).size).toBe(rows.length);
    });

    it('lists the latest rows under the same ids in the same order', () => {
      const { source } = make();

      expect(ids(source.latest())).toEqual(ids(source.rows()));
    });

    it('hands a change to the sink as one batch of exactly the changed ids, each row a new object', () => {
      const under = make();
      const before = byId(under.source.rows());
      const watched = watch(under.source);

      const changed = under.change();

      expect(changed.length).toBeGreaterThanOrEqual(1);
      expect(changed.length).toBeLessThan(before.size);
      expect(watched.batches).toHaveLength(1);
      expect(ids(watched.batches[0] ?? []).sort()).toEqual([...changed].sort());
      for (const row of watched.batches[0] ?? []) expect(row).not.toBe(before.get(row.id));
    });

    it('leaves the array of rows alone on a change and tells no subscriber', () => {
      const under = make();
      const rows = under.source.rows();
      let told = 0;
      under.source.subscribe(() => {
        told += 1;
      });
      watch(under.source);

      under.change();

      expect(under.source.rows()).toBe(rows);
      expect(told).toBe(0);
    });

    it('shows a change in the latest rows and keeps every other row the same object', () => {
      const under = make();
      const before = byId(under.source.latest());
      const watched = watch(under.source);

      const changed = new Set(under.change());
      const batch = byId(watched.batches[0] ?? []);

      for (const row of under.source.latest()) {
        if (changed.has(row.id)) expect(row).toBe(batch.get(row.id));
        else expect(row).toBe(before.get(row.id));
      }
    });

    it('neither loses nor replays a change made while no sink was registered', () => {
      const under = make();
      const before = byId(under.source.latest());

      const changed = under.change();
      const watched = watch(under.source);

      const after = byId(under.source.latest());
      for (const id of changed) expect(after.get(id)).not.toBe(before.get(id));
      expect(watched.batches).toHaveLength(0);
    });

    it('lets a second sink replace the first', () => {
      const under = make();
      const first = watch(under.source);
      const second = watch(under.source);

      under.change();

      expect(first.batches).toHaveLength(0);
      expect(second.batches).toHaveLength(1);
    });

    it('sends a stopped sink nothing; stopping twice is harmless; a replaced sink cannot stop the newer one', () => {
      const under = make();
      const first = watch(under.source);
      const second = watch(under.source);

      first.stop();
      under.change();
      expect(second.batches).toHaveLength(1);

      second.stop();
      second.stop();
      under.change();
      expect(first.batches).toHaveLength(0);
      expect(second.batches).toHaveLength(1);
    });

    it('calls no sink and tells no subscriber for an update in which nothing changed', () => {
      const under = make();
      const watched = watch(under.source);
      let told = 0;
      under.source.subscribe(() => {
        told += 1;
      });

      under.repeat();

      expect(watched.batches).toHaveLength(0);
      expect(told).toBe(0);
    });

    it('gives a new array of rows on a replacement, tells each subscriber once and does not call the sink', () => {
      const under = make();
      const rows = under.source.rows();
      const watched = watch(under.source);
      const told = [0, 0];
      under.source.subscribe(() => {
        told[0] = (told[0] ?? 0) + 1;
      });
      under.source.subscribe(() => {
        told[1] = (told[1] ?? 0) + 1;
      });

      under.replace();

      expect(under.source.rows()).not.toBe(rows);
      expect(told).toEqual([1, 1]);
      expect(watched.batches).toHaveLength(0);
      expect(ids(under.source.latest())).toEqual(ids(under.source.rows()));
    });

    it('tells a subscriber that unsubscribed nothing', () => {
      const under = make();
      let told = 0;
      const unsubscribe = under.source.subscribe(() => {
        told += 1;
      });

      unsubscribe();
      under.replace();

      expect(told).toBe(0);
    });
  });
}
