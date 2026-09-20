import { describe, expect, it } from 'vitest';
import type { Command, Frame, ServerMessage } from '@strike-desk/shared/protocol';
import type { Feed, FeedEvent } from '@strike-desk/shared/feed';
import { createGameStore } from '../src/store/gameStore';
import type { GameStore } from '../src/store/gameStore';
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
    send: (command: Command) => {
      sent.push(command);
    },
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
  return { type: 'message', message: frame };
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
