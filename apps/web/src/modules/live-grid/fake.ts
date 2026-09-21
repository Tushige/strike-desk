import type { GridRow, RowSource } from './ports';

/**
 * A synthetic row source: for showing the grid away from the running game,
 * for tests, and for the stress readout, where the number of rows is whatever
 * is asked for.
 *
 * It moves only when told to. It holds no timer, reads no clock and draws its
 * randomness from the seed it is given, so the same calls give the same rows.
 * A row's `value` is a plain number, not money.
 */

export interface FakeRow extends GridRow {
  readonly n: number;
  readonly label: string;
  readonly group: string;
  readonly value: number;
  /** Which way the value just moved: 1 up, -1 down, 0 for no move. */
  readonly dir: -1 | 0 | 1;
  /** True while the value is under 5,000. */
  readonly dimmed: boolean;
}

export interface FakeRowSource extends RowSource<FakeRow> {
  /**
   * One round of changes: each row changes with this chance (0.1 when not
   * given), by a whole step of 1 to 50, up or down. Returns the changed rows.
   */
  readonly tick: (changeFraction?: number) => readonly FakeRow[];
  /** Steps exactly the named rows up by one; an id it does not hold is ignored. Returns the changed rows. */
  readonly changeRows: (ids: readonly string[]) => readonly FakeRow[];
  /** Replaces the whole set by a fresh one of this size. */
  readonly replaceAll: (rowCount: number) => void;
}

const GROUPS = 6;
const DIMMED_UNDER = 5_000;
const LARGEST_STEP = 50;

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

function freshRows(rowCount: number): FakeRow[] {
  return Array.from({ length: rowCount }, (_unused, n) => ({
    id: `r${String(n)}`,
    n,
    label: `Row ${String(n)}`,
    group: `G${String(n % GROUPS)}`,
    value: 10_000 + 100 * n,
    dir: 0 as const,
    dimmed: false,
  }));
}

function stepped(row: FakeRow, by: number): FakeRow {
  const value = row.value + by;
  return { ...row, value, dir: by > 0 ? 1 : -1, dimmed: value < DIMMED_UNDER };
}

export function createFakeRowSource(options: { rowCount: number; seed: number }): FakeRowSource {
  const random = mulberry32(options.seed);
  const listeners = new Set<() => void>();
  let set: readonly FakeRow[] = freshRows(options.rowCount);
  let newest = new Map(set.map((row) => [row.id, row]));
  let sink: ((changed: readonly FakeRow[]) => void) | null = null;

  function handOver(changed: readonly FakeRow[]): readonly FakeRow[] {
    for (const row of changed) newest.set(row.id, row);
    if (changed.length > 0 && sink !== null) sink(changed);
    return changed;
  }

  return {
    rows: () => set,
    latest: () => set.map((row) => newest.get(row.id) ?? row),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onChanged(next) {
      sink = next;
      return () => {
        if (sink === next) sink = null;
      };
    },
    tick(changeFraction = 0.1) {
      const changed: FakeRow[] = [];
      for (const row of set) {
        if (random() >= changeFraction) continue;
        const size = 1 + Math.floor(random() * LARGEST_STEP);
        const sign = random() < 0.5 ? -1 : 1;
        changed.push(stepped(newest.get(row.id) ?? row, sign * size));
      }
      return handOver(changed);
    },
    changeRows(ids) {
      const changed: FakeRow[] = [];
      for (const id of new Set(ids)) {
        const row = newest.get(id);
        if (row !== undefined) changed.push(stepped(row, 1));
      }
      return handOver(changed);
    },
    replaceAll(rowCount) {
      set = freshRows(rowCount);
      newest = new Map(set.map((row) => [row.id, row]));
      for (const listener of [...listeners]) listener();
    },
  };
}
