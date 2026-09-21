import { describe, expect, it } from 'vitest';
import type { Frame } from '@strike-desk/shared/protocol';
import { createFakeRowSource } from '../src/modules/live-grid/fake';
import type { GridRow, RowSource } from '../src/modules/live-grid/index';
import { createGameStore } from '../src/store/gameStore';
import { describeRowSourceContract } from './contracts/rowSource.contract';
import type { RowSourceUnderTest } from './contracts/rowSource.contract';
import { testFrame } from './fakeSocket';

/**
 * The row source's laws, tried against the synthetic source and against the
 * store that feeds the live table today, which is where the interface was cut
 * from.
 */

describeRowSourceContract('the synthetic rows', () => {
  const source = createFakeRowSource({ rowCount: 12, seed: 7 });
  return {
    source,
    change: () => source.changeRows(['r1', 'r3']).map((row) => row.id),
    repeat: () => {
      source.tick(0);
    },
    replace: () => {
      source.replaceAll(8);
    },
  };
});

// ------------------------------------------------------- the store of the live table

const COMPANIES = 6;
const TARGETS_PER_COMPANY = 21;
const CONTRACTS = COMPANIES * TARGETS_PER_COMPANY * 2;

type Board = NonNullable<Frame['board']>;

/** A real-shaped board: six companies, 21 targets each, the whole board offered. */
function testBoard(): Board {
  return {
    targetsPerCompany: TARGETS_PER_COMPANY,
    companies: Array.from({ length: COMPANIES }, (_unused, companyId) => ({
      targets: Array.from({ length: TARGETS_PER_COMPANY }, (_target, index) => 1000 + companyId * 10_000 + index * 100),
      simpleUp: [2, 5, 8] as [number, number, number],
      simpleDown: [18, 15, 12] as [number, number, number],
      lowestUpIndex: 0,
      highestDownIndex: TARGETS_PER_COMPANY - 1,
    })),
  };
}

/** Ticket number N costs 1000 + N cents, except the one ticket these cases move. */
function quotes(fifth: number): number[] {
  const all = Array.from({ length: CONTRACTS }, (_unused, id) => 1000 + id);
  all[5] = fifth;
  return all;
}

function storeUnderTest(): RowSourceUnderTest {
  const store = createGameStore();
  let step = 0;
  let day = 1;
  let fifth = 1005;
  let remembered: ((changed: readonly GridRow[]) => void) | null = null;

  function ingest(): void {
    step += 1;
    store.ingest(
      testFrame({
        step,
        clock: { phase: 'open', day, stepsLeft: 400, priceIndex: 100, pace: 3 },
        board: testBoard(),
        quotes: quotes(fifth),
      }),
    );
  }

  const source: RowSource<GridRow> = {
    rows: () => store.boardRows.get(),
    subscribe: (listener) => store.boardRows.subscribe(listener),
    latest: () => store.currentRows(),
    onChanged(sink) {
      remembered = sink;
      store.setRowSink(sink);
      return () => {
        if (remembered !== sink) return;
        remembered = null;
        store.setRowSink(null);
      };
    },
  };

  ingest();
  return {
    source,
    change() {
      fifth = fifth === 9_999 ? 2_000 : 9_999;
      ingest();
      return ['5'];
    },
    repeat: ingest,
    replace() {
      day += 1;
      ingest();
    },
  };
}

describeRowSourceContract('the store of the live table', storeUnderTest);

// ------------------------------------------------------------ the synthetic rows alone

describe('the synthetic rows', () => {
  it('start as twelve rows, r0 to r11', () => {
    const source = createFakeRowSource({ rowCount: 12, seed: 7 });

    expect(source.rows().map((row) => row.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11']);
  });

  it('start each row from its number', () => {
    const source = createFakeRowSource({ rowCount: 12, seed: 7 });

    expect(source.rows()[3]).toEqual({ id: 'r3', n: 3, label: 'Row 3', group: 'G3', value: 10_300, dir: 0, dimmed: false });
    expect(source.rows()[7]?.group).toBe('G1');
  });

  it('change every row on a full tick, each one up or down', () => {
    const source = createFakeRowSource({ rowCount: 12, seed: 7 });

    const changed = source.tick(1);

    expect(changed).toHaveLength(12);
    expect(changed.every((row) => row.dir === 1 || row.dir === -1)).toBe(true);
    expect(changed.every((row) => Number.isInteger(row.value))).toBe(true);
  });

  it('change nothing on an empty tick', () => {
    const source = createFakeRowSource({ rowCount: 12, seed: 7 });

    expect(source.tick(0)).toEqual([]);
  });

  it('step exactly the named rows up by one and ignore an id they do not hold', () => {
    const source = createFakeRowSource({ rowCount: 12, seed: 7 });

    const changed = source.changeRows(['r1', 'nope', 'r3']);

    expect(changed).toEqual([
      { id: 'r1', n: 1, label: 'Row 1', group: 'G1', value: 10_101, dir: 1, dimmed: false },
      { id: 'r3', n: 3, label: 'Row 3', group: 'G3', value: 10_301, dir: 1, dimmed: false },
    ]);
  });

  it('give the same changes from the same seed, five ticks running', () => {
    const one = createFakeRowSource({ rowCount: 12, seed: 7 });
    const two = createFakeRowSource({ rowCount: 12, seed: 7 });

    for (let tick = 0; tick < 5; tick += 1) {
      expect(one.tick(0.3)).toEqual(two.tick(0.3));
    }
  });

  it('hold five rows after being replaced by five', () => {
    const source = createFakeRowSource({ rowCount: 12, seed: 7 });

    source.replaceAll(5);

    expect(source.rows().map((row) => row.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(source.latest()).toHaveLength(5);
  });
});
