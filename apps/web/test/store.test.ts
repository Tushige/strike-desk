import { describe, expect, it } from 'vitest';
import type { Command, Frame, QuotesMessage, ServerMessage } from '@strike-desk/shared/protocol';
import type { Feed, FeedEvent } from '@strike-desk/shared/feed';
import { createGameStore } from '../src/store/gameStore';
import type { GameStore } from '../src/store/gameStore';
import { applyQuoteChange, buildRows } from '../src/store/contractRows';
import type { ContractRow } from '../src/store/contractRows';
import { autoStart } from '../src/autoStart';
import { testFrame } from './fakeSocket';

/**
 * Plain Node, no DOM. "The page root does not redraw on every frame" is
 * proved here, at the store: a frame that changes nothing must tell nobody,
 * and a frame that changes one price must tell only that price.
 */

const COMPANIES = 6;
const OPEN_CLOCK = { phase: 'open', day: 1, stepsLeft: 400, priceIndex: 100, pace: 3 } as const;

interface Counts {
  phase: number;
  day: number;
  status: number;
  sessionGone: number;
  prices: number[];
  total(): number;
}

function watch(store: GameStore): Counts {
  const counts: Counts = {
    phase: 0,
    day: 0,
    status: 0,
    sessionGone: 0,
    prices: Array.from({ length: COMPANIES }, () => 0),
    total() {
      return counts.phase + counts.day + counts.status + counts.sessionGone + counts.prices.reduce((a, b) => a + b, 0);
    },
  };
  store.phase.subscribe(() => {
    counts.phase += 1;
  });
  store.day.subscribe(() => {
    counts.day += 1;
  });
  store.status.subscribe(() => {
    counts.status += 1;
  });
  store.sessionGone.subscribe(() => {
    counts.sessionGone += 1;
  });
  for (let id = 0; id < COMPANIES; id += 1) {
    store.price(id).subscribe(() => {
      counts.prices[id] = (counts.prices[id] ?? 0) + 1;
    });
  }
  return counts;
}

function prices(store: GameStore): Array<number | null> {
  return Array.from({ length: COMPANIES }, (_unused, id) => store.price(id).get());
}

describe('the game store', () => {
  it('holds nothing until the first frame', () => {
    const store = createGameStore();
    expect(prices(store)).toEqual([null, null, null, null, null, null]);
    expect(store.phase.get()).toBe('');
    expect(store.day.get()).toBe(0);
    expect(store.sessionGone.get()).toBe(false);
    expect(store.counters).toEqual({ accepted: 0, dropped: 0 });
  });

  it('gives every slice a primitive snapshot', () => {
    const store = createGameStore();
    store.ingest(testFrame({ clock: OPEN_CLOCK }));
    const snapshots: unknown[] = [
      store.phase.get(),
      store.day.get(),
      store.status.get(),
      store.sessionGone.get(),
      ...prices(store),
    ];
    for (const snapshot of snapshots) {
      // A snapshot that is a fresh object every read makes React loop.
      expect(snapshot === null || typeof snapshot !== 'object').toBe(true);
    }
  });

  it('takes the first frame: six prices, the phase and the day', () => {
    const store = createGameStore();
    store.ingest(testFrame({ clock: OPEN_CLOCK, prices: [1, 2, 3, 4, 5, 6] }));

    expect(prices(store)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(store.phase.get()).toBe('open');
    expect(store.day.get()).toBe(1);
    expect(store.counters.accepted).toBe(1);
  });

  it('drops a frame with a lower step at the same revision', () => {
    const store = createGameStore();
    store.ingest(testFrame({ step: 10, prices: [1, 2, 3, 4, 5, 6] }));
    const counts = watch(store);

    store.ingest(testFrame({ step: 9, prices: [9, 9, 9, 9, 9, 9] }));

    expect(prices(store)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(counts.total()).toBe(0);
    expect(store.counters.dropped).toBe(1);
    expect(store.counters.accepted).toBe(1);
  });

  it('drops a frame with a lower revision, however far ahead its step is', () => {
    const store = createGameStore();
    store.ingest(testFrame({ rev: 2, step: 10, prices: [1, 2, 3, 4, 5, 6] }));
    const counts = watch(store);

    store.ingest(testFrame({ rev: 1, step: 900, prices: [9, 9, 9, 9, 9, 9] }));

    expect(prices(store)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(counts.total()).toBe(0);
    expect(store.counters.dropped).toBe(1);
  });

  it('always takes a frame from another session', () => {
    const store = createGameStore();
    store.ingest(testFrame({ session: 's-1', rev: 5, step: 500, prices: [1, 2, 3, 4, 5, 6] }));
    store.ingest(testFrame({ session: 's-2', rev: 0, step: 0, prices: [7, 7, 7, 7, 7, 7] }));

    expect(prices(store)).toEqual([7, 7, 7, 7, 7, 7]);
    expect(store.counters).toEqual({ accepted: 2, dropped: 0 });
  });

  it('tells the clock slices nothing when only the prices move', () => {
    const store = createGameStore();
    store.ingest(testFrame({ clock: OPEN_CLOCK, step: 0, prices: [100, 200, 300, 400, 500, 600] }));
    const counts = watch(store);

    for (let n = 1; n <= 50; n += 1) {
      store.ingest(testFrame({ clock: OPEN_CLOCK, step: n, prices: [100 + n, 200, 300, 400, 500, 600] }));
    }

    expect(counts.phase).toBe(0);
    expect(counts.day).toBe(0);
    expect(counts.prices[0]).toBe(50);
    expect(counts.prices[1]).toBe(0);
    expect(store.counters.accepted).toBe(51);
  });

  it('tells nobody anything when fifty identical frames arrive', () => {
    const store = createGameStore();
    const frame = testFrame({ clock: OPEN_CLOCK, step: 7, prices: [1, 2, 3, 4, 5, 6] });
    store.ingest(frame);
    const counts = watch(store);

    for (let n = 0; n < 50; n += 1) store.ingest(testFrame({ clock: OPEN_CLOCK, step: 7, prices: [1, 2, 3, 4, 5, 6] }));

    expect(counts.total()).toBe(0);
    expect(store.counters.accepted).toBe(51);
    expect(store.counters.dropped).toBe(0);
  });

  it('ingests a reply through its frame', () => {
    const store = createGameStore();
    const reply: ServerMessage = {
      t: 'reply',
      receipt: { commandId: 'command-1', kind: 'start', step: 0, outcome: 'accepted' },
      frame: testFrame({ rev: 1, clock: OPEN_CLOCK, prices: [1, 2, 3, 4, 5, 6] }),
    };
    store.ingest(reply);

    expect(prices(store)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(store.phase.get()).toBe('open');
  });

  it('raises sessionGone when the server says the session is gone', () => {
    const store = createGameStore();
    store.ingest({ t: 'error', code: 'noSession' });
    expect(store.sessionGone.get()).toBe(true);
  });

  it('changes no slice for any other error', () => {
    const store = createGameStore();
    store.ingest(testFrame({ clock: OPEN_CLOCK }));
    const counts = watch(store);

    store.ingest({ t: 'error', code: 'badMessage', commandId: 'command-1' });
    store.ingest({ t: 'error', code: 'tooManyCommands' });

    expect(counts.total()).toBe(0);
    expect(store.sessionGone.get()).toBe(false);
  });

  it('clears sessionGone once a new session is streaming', () => {
    const store = createGameStore();
    store.ingest(testFrame({ session: 's-1' }));
    store.ingest({ t: 'error', code: 'noSession' });
    expect(store.sessionGone.get()).toBe(true);

    store.ingest(testFrame({ session: 's-2' }));
    expect(store.sessionGone.get()).toBe(false);
  });

  it('reports the feed status and repeats itself to nobody', () => {
    const store = createGameStore();
    const counts = watch(store);

    store.setStatus('connecting');
    store.setStatus('live');
    store.setStatus('live');

    expect(store.status.get()).toBe('live');
    expect(counts.status).toBe(2);
  });

  it('stops telling a listener that unsubscribed', () => {
    const store = createGameStore();
    let told = 0;
    const stop = store.price(0).subscribe(() => {
      told += 1;
    });
    store.ingest(testFrame({ step: 1, prices: [1, 2, 3, 4, 5, 6] }));
    stop();
    store.ingest(testFrame({ step: 2, prices: [2, 2, 3, 4, 5, 6] }));

    expect(told).toBe(1);
  });
});

interface FakeFeed {
  feed: Feed;
  sent: Command[];
  emit(event: FeedEvent): void;
}

function fakeFeed(): FakeFeed {
  const listeners = new Set<(event: FeedEvent) => void>();
  const sent: Command[] = [];
  const feed: Feed = {
    connect: () => undefined,
    close: () => undefined,
    send: (message) => {
      // Commands only: anything else a feed may carry has no command id.
      if ('commandId' in message) sent.push(message);
      return true;
    },
    simulateDrop: () => undefined,
    subscribe: (listener: (event: FeedEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    feed,
    sent,
    emit(event: FeedEvent) {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

function lobbyFrame(session: string, step = 0): Frame {
  return testFrame({ session, step, clock: { phase: 'lobby', day: 0, stepsLeft: 0, priceIndex: 0, pace: null } });
}

function message(frame: Frame): FeedEvent {
  return { type: 'message', message: frame, receivedAt: 0 };
}

describe('auto-start', () => {
  it('starts the game once, at the pace it was given', () => {
    const fake = fakeFeed();
    autoStart(fake.feed, { pace: 3, makeId: () => 'command-abcdefgh' });

    fake.emit(message(lobbyFrame('s-1')));
    fake.emit(message(lobbyFrame('s-1', 1)));
    fake.emit(message(lobbyFrame('s-1', 2)));

    expect(fake.sent).toEqual([{ t: 'start', commandId: 'command-abcdefgh', pace: 3 }]);
    expect(fake.sent[0]?.commandId.length).toBeGreaterThanOrEqual(8);
  });

  it('sends nothing for a frame in any other phase', () => {
    const fake = fakeFeed();
    autoStart(fake.feed, { pace: 3, makeId: () => 'command-abcdefgh' });

    fake.emit(message(testFrame({ session: 's-1', clock: OPEN_CLOCK })));
    fake.emit(
      message(
        testFrame({
          session: 's-1',
          clock: { phase: 'preBell', day: 1, stepsLeft: 200, priceIndex: 0, pace: 3 },
        }),
      ),
    );

    expect(fake.sent).toEqual([]);
  });

  it('resends the same command id after the connection comes back, and only once', () => {
    const fake = fakeFeed();
    autoStart(fake.feed, { pace: 3, makeId: () => 'command-abcdefgh' });

    fake.emit(message(lobbyFrame('s-1')));
    fake.emit({ type: 'status', status: 'reconnecting' });
    fake.emit({ type: 'status', status: 'live' });
    fake.emit(message(lobbyFrame('s-1', 1)));
    fake.emit(message(lobbyFrame('s-1', 2)));

    expect(fake.sent).toEqual([
      { t: 'start', commandId: 'command-abcdefgh', pace: 3 },
      { t: 'start', commandId: 'command-abcdefgh', pace: 3 },
    ]);
  });

  it('uses a new command id for a new session', () => {
    const fake = fakeFeed();
    let made = 0;
    autoStart(fake.feed, {
      pace: 3,
      makeId: () => {
        made += 1;
        return `command-${made}-abcdefgh`;
      },
    });

    fake.emit(message(lobbyFrame('s-1')));
    fake.emit(message(lobbyFrame('s-2')));

    expect(fake.sent).toEqual([
      { t: 'start', commandId: 'command-1-abcdefgh', pace: 3 },
      { t: 'start', commandId: 'command-2-abcdefgh', pace: 3 },
    ]);
  });

  it('stops listening once its unsubscribe is called', () => {
    const fake = fakeFeed();
    const stop = autoStart(fake.feed, { pace: 3, makeId: () => 'command-abcdefgh' });
    stop();

    fake.emit(message(lobbyFrame('s-1')));

    expect(fake.sent).toEqual([]);
  });
});

// ------------------------------------------------------------------- the board

const TARGETS_PER_COMPANY = 21;
const CONTRACTS = COMPANIES * TARGETS_PER_COMPANY * 2;
const DEBRIEF_CLOCK = { phase: 'debrief', day: 1, stepsLeft: 0, priceIndex: 500, pace: 3 } as const;
const TICKERS = ['RPUP', 'FIZZ', 'JETK', 'MUNC', 'PIXL', 'ZAPP'];

type Board = NonNullable<Frame['board']>;

/** A real-shaped board: six companies, 21 targets each, the whole board offered. */
function testBoard(shiftCents = 0): Board {
  return {
    targetsPerCompany: TARGETS_PER_COMPANY,
    companies: Array.from({ length: COMPANIES }, (_unused, companyId) => ({
      targets: Array.from(
        { length: TARGETS_PER_COMPANY },
        (_target, index) => 1000 + companyId * 10_000 + index * 100 + shiftCents,
      ),
      simpleUp: [2, 5, 8] as [number, number, number],
      simpleDown: [18, 15, 12] as [number, number, number],
      lowestUpIndex: 0,
      highestDownIndex: TARGETS_PER_COMPANY - 1,
    })),
  };
}

/** Distinct, comfortably tradable prices: ticket number N costs 1000 + N cents. */
function quotes(changes: Readonly<Record<number, number>> = {}): number[] {
  const all = Array.from({ length: CONTRACTS }, (_unused, id) => 1000 + id);
  for (const [id, cents] of Object.entries(changes)) all[Number(id)] = cents;
  return all;
}

/*
 * The two parts of every one of those prices, as the server sends them: they
 * add up to the price on every ticket, and they are never equal to each
 * other, so a row that read them the wrong way round would fail rather than
 * pass by luck.
 */
function reals(changes: Readonly<Record<number, number>> = {}): number[] {
  const all = Array.from({ length: CONTRACTS }, (_unused, id) => 300 + id);
  for (const [id, cents] of Object.entries(changes)) all[Number(id)] = cents;
  return all;
}

function hopes(changes: Readonly<Record<number, number>> = {}): number[] {
  const all = Array.from({ length: CONTRACTS }, () => 700);
  for (const [id, cents] of Object.entries(changes)) all[Number(id)] = cents;
  return all;
}

function boardFrame(changes: Partial<Frame> = {}): Frame {
  return testFrame({
    clock: OPEN_CLOCK,
    board: testBoard(),
    quotes: quotes(),
    quoteReals: reals(),
    quoteHopes: hopes(),
    minTicketCents: 500,
    ...changes,
  });
}

interface BoardCounts {
  companies: number;
  boardRows: number;
  /** One entry per call of the row sink, holding the rows it was handed. */
  sinkCalls: (readonly ContractRow[])[];
}

function watchBoard(store: GameStore): BoardCounts {
  const counts: BoardCounts = { companies: 0, boardRows: 0, sinkCalls: [] };
  store.companies.subscribe(() => {
    counts.companies += 1;
  });
  store.boardRows.subscribe(() => {
    counts.boardRows += 1;
  });
  store.setRowSink((rows) => {
    counts.sinkCalls.push(rows);
  });
  return counts;
}

describe('building the rows of a board', () => {
  it('builds 252 rows: company by company, the UP block then the DOWN block, targets ascending', () => {
    const board = testBoard();
    const rows = buildRows({
      board,
      companies: testFrame().companies,
      quotes: quotes(),
      quoteReals: reals(),
      quoteHopes: hopes(),
      minTicketCents: 500,
      buyable: true,
    });

    expect(rows).toHaveLength(252);
    expect(rows[0]).toEqual({
      id: '0',
      contractId: 0,
      companyId: 0,
      company: 'RoboPup',
      ticker: 'RPUP',
      side: 'up',
      targetCents: 1000,
      priceCents: 1000,
      realCents: 300,
      hopeCents: 700,
      dimmed: false,
      dir: 0,
    });

    const firstCompany = rows.slice(0, 42);
    expect(firstCompany.slice(0, 21).map((row) => row.side)).toEqual(Array.from({ length: 21 }, () => 'up'));
    expect(firstCompany.slice(21).map((row) => row.side)).toEqual(Array.from({ length: 21 }, () => 'down'));
    expect(firstCompany.slice(0, 21).map((row) => row.targetCents)).toEqual(board.companies[0]?.targets);
    expect(firstCompany.slice(21).map((row) => row.targetCents)).toEqual(board.companies[0]?.targets);

    // Contract ids interleave UP and DOWN, so the default row order is not id order.
    expect(firstCompany.map((row) => row.contractId)).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19,
      21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41,
    ]);
    expect(rows[42]).toMatchObject({ contractId: 42, companyId: 1, company: 'Fizzly', ticker: 'FIZZ', side: 'up' });
    expect(rows[251]).toMatchObject({ contractId: 251, companyId: 5, ticker: 'ZAPP', side: 'down' });

    expect(rows.map((row) => row.id)).toEqual(rows.map((row) => String(row.contractId)));
    expect(rows.map((row) => row.priceCents)).toEqual(rows.map((row) => 1000 + row.contractId));
    expect(rows.every((row) => row.dir === 0)).toBe(true);
  });

  it("carries the server's own real and hope values on every row, and works neither of them out", () => {
    const sentReals = reals();
    const sentHopes = hopes();
    const rows = buildRows({
      board: testBoard(),
      companies: testFrame().companies,
      quotes: quotes(),
      quoteReals: sentReals,
      quoteHopes: sentHopes,
      minTicketCents: 500,
      buyable: true,
    });

    // Each part is the number the frame sent for that contract id, not a
    // number the page arrived at. The two arrays differ on every ticket, so a
    // row that read them the wrong way round fails here.
    expect(rows.map((row) => row.realCents)).toEqual(rows.map((row) => sentReals[row.contractId]));
    expect(rows.map((row) => row.hopeCents)).toEqual(rows.map((row) => sentHopes[row.contractId]));

    // What the player is meant to be able to see on every line of the table.
    expect(rows.every((row) => row.realCents + row.hopeCents === row.priceCents)).toBe(true);
  });
});

describe('the store and the board', () => {
  it('builds the whole row set on the first frame with a board and calls no sink', () => {
    const store = createGameStore();
    const counts = watchBoard(store);

    store.ingest(boardFrame());

    expect(counts.boardRows).toBe(1);
    expect(store.boardRows.get()).toHaveLength(252);
    expect(counts.sinkCalls).toEqual([]);
  });

  it('tells nobody when the next frame repeats every ticket price', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const counts = watchBoard(store);

    store.ingest(boardFrame({ step: 2 }));

    expect(counts.boardRows).toBe(0);
    expect(counts.sinkCalls).toEqual([]);
    expect(counts.companies).toBe(0);
  });

  it('hands the sink only the row whose price moved, as a new object, with its direction', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const before = store.boardRows.get().find((row) => row.contractId === 5);
    const counts = watchBoard(store);

    store.ingest(boardFrame({ step: 2, quotes: quotes({ 5: 9999 }) }));

    expect(counts.boardRows).toBe(0);
    expect(counts.sinkCalls).toHaveLength(1);
    const raised = counts.sinkCalls[0] ?? [];
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ contractId: 5, priceCents: 9999, dir: 1 });
    expect(before?.priceCents).toBe(1005);
    expect(raised[0]).not.toBe(before);

    store.ingest(boardFrame({ step: 3, quotes: quotes({ 5: 2000 }) }));

    expect(counts.sinkCalls).toHaveLength(2);
    expect(counts.sinkCalls[1]).toHaveLength(1);
    expect(counts.sinkCalls[1]?.[0]).toMatchObject({ contractId: 5, priceCents: 2000, dir: -1 });
  });

  it('hands the sink a row whose two parts moved though its price stood still, with no direction', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const before = store.boardRows.get().find((row) => row.contractId === 5);
    const counts = watchBoard(store);

    // A dollar of hope turns into a dollar of real value: the same price, a
    // different ticket. The row must be redrawn, and must not flash.
    store.ingest(boardFrame({ step: 2, quoteReals: reals({ 5: 405 }), quoteHopes: hopes({ 5: 600 }) }));

    expect(counts.boardRows).toBe(0);
    expect(counts.sinkCalls).toHaveLength(1);
    const moved = counts.sinkCalls[0] ?? [];
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ contractId: 5, priceCents: 1005, realCents: 405, hopeCents: 600, dir: 0 });
    expect(before).toMatchObject({ realCents: 305, hopeCents: 700 });
    expect(moved[0]).not.toBe(before);
  });

  it('dims a ticket under the cheapest tradable price only while tickets are buyable', () => {
    const open = createGameStore();
    open.ingest(boardFrame({ quotes: quotes({ 7: 400 }) }));
    expect(open.boardRows.get().filter((row) => row.dimmed).map((row) => row.contractId)).toEqual([7]);

    const closed = createGameStore();
    closed.ingest(boardFrame({ clock: DEBRIEF_CLOCK, quotes: quotes({ 7: 400 }) }));
    expect(closed.boardRows.get().some((row) => row.dimmed)).toBe(false);
    expect(closed.boardRows.get().find((row) => row.contractId === 7)?.priceCents).toBe(400);
  });

  it('sends the rows that stop being dimmed at the closing bell, each with no direction', () => {
    const store = createGameStore();
    const underFloor = quotes({ 7: 400, 19: 100 });
    store.ingest(boardFrame({ step: 1, quotes: underFloor }));
    const counts = watchBoard(store);

    store.ingest(boardFrame({ step: 2, clock: DEBRIEF_CLOCK, quotes: underFloor }));

    expect(counts.boardRows).toBe(0);
    expect(counts.sinkCalls).toHaveLength(1);
    const settled = counts.sinkCalls[0] ?? [];
    expect(settled.map((row) => row.contractId)).toEqual([7, 19]);
    expect(settled.every((row) => row.dir === 0 && !row.dimmed)).toBe(true);
  });

  it('replaces the row set for another day, and for another session, without calling the sink', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const counts = watchBoard(store);

    store.ingest(boardFrame({ step: 2, board: testBoard(500), clock: { ...OPEN_CLOCK, day: 2 } }));

    expect(counts.boardRows).toBe(1);
    expect(counts.sinkCalls).toEqual([]);
    expect(store.boardRows.get()[0]?.targetCents).toBe(1500);

    store.ingest(boardFrame({ session: 's-2', step: 0 }));

    expect(counts.boardRows).toBe(2);
    expect(counts.sinkCalls).toEqual([]);
    expect(store.boardRows.get()[0]?.targetCents).toBe(1000);
  });

  it('holds no rows while there is no board', () => {
    const store = createGameStore();
    expect(store.boardRows.get()).toEqual([]);

    store.ingest(testFrame());
    expect(store.boardRows.get()).toEqual([]);

    store.ingest(boardFrame({ step: 1 }));
    store.ingest(testFrame({ session: 's-2' }));
    expect(store.boardRows.get()).toEqual([]);
  });

  it('gives the latest row for every contract, in the default order', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    store.ingest(boardFrame({ step: 2, quotes: quotes({ 5: 9999 }) }));

    const latest = store.currentRows();
    expect(latest).toHaveLength(252);
    expect(latest.map((row) => row.contractId)).toEqual(store.boardRows.get().map((row) => row.contractId));
    expect(latest.find((row) => row.contractId === 5)?.priceCents).toBe(9999);
    expect(store.boardRows.get().find((row) => row.contractId === 5)?.priceCents).toBe(1005);
  });

  it('takes the company names from the frame and repeats them to nobody', () => {
    const store = createGameStore();
    const counts = watchBoard(store);

    store.ingest(testFrame({ step: 1 }));
    const held = store.companies.get();
    expect(held.map((company) => company.ticker)).toEqual(TICKERS);
    expect(held.map((company) => company.name)).toEqual([
      'RoboPup',
      'Fizzly',
      'JetKicks',
      'MoonMunch',
      'PixelPals',
      'ZapCharge',
    ]);
    expect(counts.companies).toBe(1);

    store.ingest(testFrame({ step: 2 }));
    store.ingest(testFrame({ step: 3 }));

    expect(counts.companies).toBe(1);
    expect(store.companies.get()).toBe(held);

    store.ingest(testFrame({ step: 4, companies: [...held.slice(0, 5), { ticker: 'ZAPP', name: 'ZapCharger' }] }));

    expect(counts.companies).toBe(2);
    expect(store.companies.get()[5]?.name).toBe('ZapCharger');
  });
});

/**
 * What counts as "the same board" at a stress size, where the row set is
 * thousands of rows and rebuilding it on every frame is exactly what must
 * never happen.
 */
describe('when the store rebuilds the row set', () => {
  /** A board of any size, in the same shape as the real one. */
  function boardOf(targetsPerCompany: number): Board {
    return {
      targetsPerCompany,
      companies: Array.from({ length: COMPANIES }, (_unused, companyId) => ({
        targets: Array.from({ length: targetsPerCompany }, (_target, index) => 1000 + companyId * 10_000 + index * 100),
        simpleUp: [2, 5, 8] as [number, number, number],
        simpleDown: [18, 15, 12] as [number, number, number],
        lowestUpIndex: 0,
        highestDownIndex: targetsPerCompany - 1,
      })),
    };
  }

  it('does not rebuild when only the ticket prices moved', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const counts = watchBoard(store);

    store.ingest(boardFrame({ step: 2, quotes: quotes({ 5: 9999, 6: 8888 }) }));

    expect(counts.boardRows).toBe(0);
    // In the table's own row order, not id order: the UP block before the DOWN one.
    expect(counts.sinkCalls.map((rows) => rows.map((row) => row.contractId))).toEqual([[6, 5]]);
  });

  it('rebuilds when the board is a different size', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const counts = watchBoard(store);

    store.ingest(boardFrame({ step: 2, board: boardOf(22) }));

    expect(counts.boardRows).toBe(1);
    expect(store.boardRows.get()).toHaveLength(COMPANIES * 22 * 2);
    expect(counts.sinkCalls).toEqual([]);
  });

  it('rebuilds on a new day', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const counts = watchBoard(store);

    store.ingest(boardFrame({ step: 2, clock: { ...OPEN_CLOCK, day: 2 } }));

    expect(counts.boardRows).toBe(1);
    expect(counts.sinkCalls).toEqual([]);
  });

  it('rebuilds when the board keeps its size but a company\'s targets moved', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const counts = watchBoard(store);

    store.ingest(boardFrame({ step: 2, board: testBoard(500) }));

    expect(counts.boardRows).toBe(1);
    expect(store.boardRows.get()[0]?.targetCents).toBe(1500);
    expect(counts.sinkCalls).toEqual([]);
  });
});

// --------------------------------------------------- batches of changed quotes

/**
 * The stress setting's second message shape: only the tickets that changed,
 * with a whole frame every second or so as the way back into step. A batch is
 * not the whole picture, so everything it is applied against has to come from
 * the frame the page already holds — the board, the day, the cheapest tradable
 * price and whether the market is open.
 */

const BATCH_PRICES = [8401, 4201, 12001, 2801, 6501, 15001];

/** A batch of the same session and day as `boardFrame`, one step later. */
function batch(changes: QuotesMessage['changes'], over: Partial<QuotesMessage> = {}): QuotesMessage {
  return {
    t: 'quotes',
    session: 's-1',
    rev: 0,
    step: 2,
    day: 1,
    priceIndex: 101,
    prices: BATCH_PRICES,
    changes,
    ...over,
  };
}

describe('applying one changed quote to one row', () => {
  const held: ContractRow = {
    id: '5',
    contractId: 5,
    companyId: 0,
    company: 'RoboPup',
    ticker: 'RPUP',
    side: 'down',
    targetCents: 1200,
    priceCents: 1005,
    realCents: 305,
    hopeCents: 700,
    dimmed: false,
    dir: 0,
  };
  const open = { buyable: true, minTicketCents: 500 };

  it('flashes up for a higher price, down for a lower one, and not at all for the same one', () => {
    expect(applyQuoteChange(held, [5, 1100, 400, 700, 9], open)?.dir).toBe(1);
    expect(applyQuoteChange(held, [5, 900, 200, 700, 9], open)?.dir).toBe(-1);
    // The same price with its two parts moved: a different ticket at the same
    // price, so the row is redrawn and must not flash.
    expect(applyQuoteChange(held, [5, 1005, 405, 600, 9], open)?.dir).toBe(0);
  });

  it('takes the price and both its parts exactly as sent, on a new object', () => {
    const next = applyQuoteChange(held, [5, 1100, 400, 700, 9], open);

    expect(next).toMatchObject({ id: '5', contractId: 5, priceCents: 1100, realCents: 400, hopeCents: 700 });
    expect(next).not.toBe(held);
    expect(held).toMatchObject({ priceCents: 1005, realCents: 305, hopeCents: 700 });
    // Everything a batch does not carry is the held row's.
    expect(next).toMatchObject({ company: 'RoboPup', ticker: 'RPUP', side: 'down', targetCents: 1200 });
  });

  it('says nothing changed when every number it carries is the one already held', () => {
    expect(applyQuoteChange(held, [5, 1005, 305, 700, 9], open)).toBeNull();
  });

  it('dims a ticket under the cheapest tradable price only while the market is open', () => {
    expect(applyQuoteChange(held, [5, 400, 100, 300, 9], open)?.dimmed).toBe(true);
    expect(applyQuoteChange(held, [5, 400, 100, 300, 9], { buyable: false, minTicketCents: 500 })?.dimmed).toBe(false);
  });
});

describe('the store and a batch of changed quotes', () => {
  it('merges it into the rows it holds and rebuilds nothing', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const before = store.boardRows.get().find((row) => row.contractId === 5);
    const counts = watchBoard(store);

    store.ingest(batch([[5, 9999, 4000, 5999, 12_345]]));

    expect(counts.boardRows).toBe(0);
    expect(counts.sinkCalls).toHaveLength(1);
    const changed = counts.sinkCalls[0] ?? [];
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ id: '5', contractId: 5, priceCents: 9999, realCents: 4000, hopeCents: 5999, dir: 1 });
    expect(changed[0]).not.toBe(before);
    expect(before?.priceCents).toBe(1005);
    expect(store.counters).toEqual({ accepted: 2, dropped: 0 });
  });

  it('sets the six share prices it carries', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1, prices: [1, 2, 3, 4, 5, 6] }));

    store.ingest(batch([[5, 9999, 4000, 5999, 12_345]]));

    expect(prices(store)).toEqual(BATCH_PRICES);
  });

  it('hands the sink a row whose two parts moved though its price stood still, with no direction', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const counts = watchBoard(store);

    store.ingest(batch([[5, 1005, 405, 600, 12_345]]));

    expect(counts.sinkCalls).toHaveLength(1);
    expect(counts.sinkCalls[0]?.[0]).toMatchObject({ contractId: 5, priceCents: 1005, realCents: 405, hopeCents: 600, dir: 0 });
  });

  it('tells the sink nothing when every number in the batch is already held', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const counts = watchBoard(store);

    store.ingest(batch([[5, 1005, 305, 700, 12_345]]));

    expect(counts.sinkCalls).toEqual([]);
    expect(store.counters.accepted).toBe(2);
  });

  it('dims a ticket whose sent price crosses the cheapest tradable one, while the market is open', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));
    const counts = watchBoard(store);

    store.ingest(batch([[7, 400, 100, 300, 12_345]]));

    expect(counts.sinkCalls[0]?.[0]).toMatchObject({ contractId: 7, priceCents: 400, dimmed: true });
  });

  it('dims nothing at any price once the market is shut, because the last frame said so', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1, clock: DEBRIEF_CLOCK }));
    const counts = watchBoard(store);

    store.ingest(batch([[7, 400, 100, 300, 12_345]]));

    expect(counts.sinkCalls[0]?.[0]).toMatchObject({ contractId: 7, priceCents: 400, dimmed: false });
  });

  it('gives the merged rows back as the latest rows, in the default order', () => {
    const store = createGameStore();
    store.ingest(boardFrame({ step: 1 }));

    store.ingest(batch([[5, 9999, 4000, 5999, 12_345]]));

    const latest = store.currentRows();
    expect(latest).toHaveLength(252);
    expect(latest.map((row) => row.contractId)).toEqual(store.boardRows.get().map((row) => row.contractId));
    expect(latest.find((row) => row.contractId === 5)?.priceCents).toBe(9999);
    // The row set the table was handed on the day's first frame is untouched.
    expect(store.boardRows.get().find((row) => row.contractId === 5)?.priceCents).toBe(1005);
  });
});
