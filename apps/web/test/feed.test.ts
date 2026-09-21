import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@strike-desk/shared/protocol';
import type { FeedEvent, FeedStatus } from '@strike-desk/shared/feed';
import { SESSION_KEY, createWsFeed } from '../src/feed/wsFeed';
import type { WsFeedOptions } from '../src/feed/wsFeed';
import {
  createFakeStorage,
  createManualScheduler,
  createSocketFactory,
  testFrame,
} from './fakeSocket';
import type { FakeStorage, ManualScheduler, SocketFactory } from './fakeSocket';

/**
 * Every socket, every wait and every random draw is handed in, so each test
 * drives the feed by hand and nothing here waits on a real clock.
 */

const URL = 'ws://example.test/ws';

interface Harness {
  feed: ReturnType<typeof createWsFeed>;
  sockets: SocketFactory;
  scheduler: ManualScheduler;
  storage: FakeStorage;
  events: FeedEvent[];
  statuses: () => FeedStatus[];
}

function harness(over: Partial<WsFeedOptions> & { stored?: string; storedRaw?: Record<string, string> } = {}): Harness {
  const sockets = createSocketFactory();
  const scheduler = createManualScheduler();
  const storage = createFakeStorage({
    ...(over.stored === undefined ? {} : { [SESSION_KEY]: over.stored }),
    ...over.storedRaw,
  });
  const events: FeedEvent[] = [];
  const feed = createWsFeed({
    url: URL,
    createSocket: (url) => sockets.create(url),
    schedule: (run, ms) => scheduler.schedule(run, ms),
    storage,
    random: () => 0.5,
    now: () => 0,
    ...over,
  });
  feed.subscribe((event) => events.push(event));
  return {
    feed,
    sockets,
    scheduler,
    storage,
    events,
    statuses: () => events.flatMap((event) => (event.type === 'status' ? [event.status] : [])),
  };
}

function helloTexts(sent: string[]): unknown[] {
  return sent.map((text) => JSON.parse(text) as unknown).filter((value) => (value as { t?: string }).t === 'hello');
}

describe('the WebSocket feed', () => {
  it('has exactly the five methods of the interface', () => {
    const { feed } = harness();
    expect(Object.keys(feed).sort()).toEqual(['close', 'connect', 'send', 'simulateDrop', 'subscribe']);
  });

  it('opens one socket however often connect is called', () => {
    const { feed, sockets } = harness();
    feed.connect();
    feed.connect();
    expect(sockets.made).toHaveLength(1);

    sockets.last().fireOpen();
    feed.connect();
    expect(sockets.made).toHaveLength(1);
  });

  it('opens a second socket after close, and leaves one live', () => {
    const { feed, sockets } = harness();
    feed.connect();
    sockets.last().fireOpen();
    feed.close();
    feed.connect();
    sockets.last().fireOpen();

    expect(sockets.made).toHaveLength(2);
    expect(sockets.live()).toHaveLength(1);
    expect(sockets.made[0]?.closeCalls).toBe(1);
  });

  it('says hello with the protocol version and no session when it has none', () => {
    const { feed, sockets } = harness();
    feed.connect();
    sockets.last().fireOpen();

    const hellos = helloTexts(sockets.last().sent);
    expect(hellos).toHaveLength(1);
    expect(hellos[0]).toEqual({ t: 'hello', v: PROTOCOL_VERSION });
  });

  it('resumes the session it last saw, and writes the id to storage', () => {
    const { feed, sockets, scheduler, storage } = harness();
    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireMessage(JSON.stringify(testFrame({ session: 's-1' })));
    expect(storage.held.get(SESSION_KEY)).toBe('s-1');

    sockets.last().fireClose();
    scheduler.runNext();
    sockets.last().fireOpen();

    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, session: 's-1' }]);
  });

  it('says hello with the session id already in storage', () => {
    const { feed, sockets } = harness({ stored: 's-kept' });
    feed.connect();
    sockets.last().fireOpen();

    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, session: 's-kept' }]);
  });

  it('hands a valid frame to every listener and drops a message that fails the schema', () => {
    const { feed, sockets } = harness();
    const seen: FeedEvent[] = [];
    const alsoSeen: FeedEvent[] = [];
    feed.subscribe((event) => seen.push(event));
    feed.subscribe((event) => alsoSeen.push(event));

    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireMessage('{');
    sockets.last().fireMessage(JSON.stringify({ t: 'frame', session: 's-1' }));
    sockets.last().fireMessage(JSON.stringify({ type: 'tick', tick: 3 }));
    expect(seen.filter((event) => event.type === 'message')).toEqual([]);

    const frame = testFrame({ session: 's-1', step: 4 });
    sockets.last().fireMessage(JSON.stringify(frame));

    const expected = [{ type: 'message', message: frame, receivedAt: 0 }];
    expect(seen.filter((event) => event.type === 'message')).toEqual(expected);
    expect(alsoSeen.filter((event) => event.type === 'message')).toEqual(expected);
  });

  it('stops telling an unsubscribed listener', () => {
    const { feed, sockets } = harness();
    const seen: FeedEvent[] = [];
    const stop = feed.subscribe((event) => seen.push(event));
    feed.connect();
    stop();
    sockets.last().fireOpen();

    expect(seen).toEqual([{ type: 'status', status: 'connecting' }]);
  });

  it('reports connecting, live, reconnecting and closed', () => {
    const { feed, sockets, statuses } = harness();
    feed.connect();
    expect(statuses()).toEqual(['connecting']);

    sockets.last().fireOpen();
    expect(statuses()).toEqual(['connecting', 'live']);

    sockets.last().fireClose();
    expect(statuses()).toEqual(['connecting', 'live', 'reconnecting']);

    feed.close();
    expect(statuses()).toEqual(['connecting', 'live', 'reconnecting', 'closed']);
  });

  it('schedules no reconnect after close', () => {
    const { feed, sockets, scheduler, statuses } = harness();
    feed.connect();
    sockets.last().fireOpen();
    feed.close();
    // A real socket still echoes its close event after close() was called.
    sockets.last().fireClose();

    expect(scheduler.pending()).toBe(0);
    expect(sockets.made).toHaveLength(1);
    expect(statuses()).toEqual(['connecting', 'live', 'closed']);
  });

  it('cancels a scheduled reconnect when close is called', () => {
    const { feed, sockets, scheduler } = harness();
    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireClose();
    expect(scheduler.pending()).toBe(1);

    feed.close();
    expect(scheduler.pending()).toBe(0);
  });

  it('waits 1, 2, 4, 8 and then 8 seconds between attempts', () => {
    const { feed, sockets, scheduler } = harness();
    feed.connect();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      sockets.last().fireOpen();
      sockets.last().fireClose();
      scheduler.runNext();
    }

    expect(scheduler.delays()).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it('scales every wait by a jitter factor between 0.8 and 1.2', () => {
    const draws = [0, 0.999, 0.25];
    let drawn = 0;
    const { feed, sockets, scheduler } = harness({
      random: () => {
        const value = draws[drawn % draws.length] ?? 0;
        drawn += 1;
        return value;
      },
    });

    feed.connect();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      sockets.last().fireOpen();
      sockets.last().fireClose();
      scheduler.runNext();
    }

    const bases = [1000, 2000, 4000];
    const delays = scheduler.delays();
    expect(delays).toHaveLength(3);
    delays.forEach((delay, index) => {
      const base = bases[index] ?? 0;
      expect(delay).toBeGreaterThanOrEqual(base * 0.8);
      expect(delay).toBeLessThanOrEqual(base * 1.2);
    });
    expect(delays[0]).toBe(800);
    expect(delays[1]).not.toBe(2000);
  });

  it('starts the waits again once a frame has arrived', () => {
    const { feed, sockets, scheduler } = harness();
    feed.connect();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      sockets.last().fireOpen();
      sockets.last().fireClose();
      scheduler.runNext();
    }
    expect(scheduler.delays()).toEqual([1000, 2000, 4000]);

    sockets.last().fireOpen();
    sockets.last().fireMessage(JSON.stringify(testFrame()));
    sockets.last().fireClose();

    expect(scheduler.delays()).toEqual([1000, 2000, 4000, 1000]);
  });

  it('drops a command while it is not live and sends one when it is', () => {
    const { feed, sockets } = harness();
    const command = { t: 'start', commandId: 'command-1', pace: 3 } as const;

    feed.send(command);
    feed.connect();
    feed.send(command);
    expect(sockets.last().sent).toEqual([]);

    sockets.last().fireOpen();
    feed.send(command);
    expect(sockets.last().sent.at(-1)).toBe(JSON.stringify(command));

    sockets.last().fireClose();
    feed.send(command);
    expect(sockets.made).toHaveLength(1);
  });

  it('forgets the stored session when the server says it is gone', () => {
    const { feed, sockets, storage } = harness({ stored: 's-old' });
    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireMessage(JSON.stringify({ t: 'error', code: 'noSession' }));

    expect(storage.held.has(SESSION_KEY)).toBe(false);
  });

  it('takes up the new session the server sends after saying the old one is gone', () => {
    const { feed, sockets, scheduler, storage, events } = harness({ stored: 's-old' });
    feed.connect();
    sockets.last().fireOpen();
    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, session: 's-old' }]);

    // The order the server answers in: the error first, then the new game's frame.
    sockets.last().fireMessage(JSON.stringify({ t: 'error', code: 'noSession' }));
    sockets.last().fireMessage(JSON.stringify(testFrame({ session: 's-new' })));

    expect(storage.held.get(SESSION_KEY)).toBe('s-new');
    const messages = events.flatMap((event) => (event.type === 'message' ? [event.message.t] : []));
    expect(messages).toEqual(['error', 'frame']);

    sockets.last().fireClose();
    scheduler.runNext();
    sockets.last().fireOpen();
    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, session: 's-new' }]);
  });

  it('forgets the stored session once the game is over', () => {
    const { feed, sockets, scheduler, storage } = harness();
    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireMessage(JSON.stringify(testFrame({ session: 's-1' })));
    expect(storage.held.get(SESSION_KEY)).toBe('s-1');

    const over = testFrame({
      session: 's-1',
      step: 4500,
      clock: { phase: 'final', day: 5, stepsLeft: 0, priceIndex: 500, pace: 3 },
    });
    sockets.last().fireMessage(JSON.stringify(over));
    expect(storage.held.has(SESSION_KEY)).toBe(false);

    sockets.last().fireClose();
    scheduler.runNext();
    sockets.last().fireOpen();
    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION }]);
  });

  it('survives a socket error without throwing', () => {
    const { feed, sockets } = harness();
    feed.connect();
    expect(() => sockets.last().fireError()).not.toThrow();
  });

  it('says whether a message was handed to an open socket', () => {
    const { feed, sockets } = harness();
    const command = { t: 'start', commandId: 'command-1', pace: 3 } as const;

    expect(feed.send(command)).toBe(false);

    feed.connect();
    expect(feed.send(command)).toBe(false);
    expect(sockets.last().sent).toEqual([]);

    sockets.last().fireOpen();
    expect(feed.send(command)).toBe(true);
    expect(sockets.last().sent.at(-1)).toBe('{"t":"start","commandId":"command-1","pace":3}');

    sockets.last().fireClose();
    expect(feed.send(command)).toBe(false);
  });

  it('stamps every message with the time it arrived on its own clock', () => {
    let clock = 0;
    const { feed, sockets, events } = harness({ now: () => clock });
    feed.connect();
    sockets.last().fireOpen();

    clock = 5000;
    sockets.last().fireMessage(JSON.stringify(testFrame({ step: 1 })));
    clock = 5200;
    sockets.last().fireMessage(JSON.stringify(testFrame({ step: 2 })));

    const times = events.flatMap((event) => (event.type === 'message' ? [event.receivedAt] : []));
    expect(times).toEqual([5000, 5200]);
  });

  it('drops the line on purpose the way the network would', () => {
    const { feed, sockets, scheduler, events, statuses } = harness();
    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireMessage(JSON.stringify(testFrame({ session: 's-1' })));
    const dropped = sockets.last();
    const messagesBefore = events.filter((event) => event.type === 'message').length;

    feed.simulateDrop();

    expect(statuses()).toEqual(['connecting', 'live', 'reconnecting']);
    expect(scheduler.delays()).toEqual([1000]);
    expect(dropped.closeCalls).toBe(1);

    // Whatever the dropped socket still says, late close included, is ignored.
    dropped.fireMessage(JSON.stringify(testFrame({ session: 's-1', step: 9 })));
    dropped.fireClose();
    expect(events.filter((event) => event.type === 'message')).toHaveLength(messagesBefore);
    expect(statuses()).toEqual(['connecting', 'live', 'reconnecting']);
    expect(scheduler.delays()).toEqual([1000]);

    scheduler.runNext();
    expect(sockets.made).toHaveLength(2);
    sockets.last().fireOpen();
    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: 1, session: 's-1' }]);
  });

  it('ignores a drop on purpose while it is not live', () => {
    const { feed, sockets, scheduler, events } = harness();

    feed.simulateDrop();
    expect(events).toEqual([]);

    feed.connect();
    feed.simulateDrop();
    expect(events).toEqual([{ type: 'status', status: 'connecting' }]);
    expect(sockets.last().closeCalls).toBe(0);
    expect(scheduler.delays()).toEqual([]);

    sockets.last().fireOpen();
    sockets.last().fireClose();
    feed.simulateDrop();
    expect(scheduler.delays()).toEqual([1000]);
    expect(sockets.made).toHaveLength(1);
  });

  it('gives every listener its event even when an earlier one throws, and still throws', () => {
    const { feed, sockets } = harness();
    const seen: FeedEvent[] = [];
    // Subscribed before the recorder below, so it throws first on every event.
    feed.subscribe(() => {
      throw new Error('listener failed');
    });
    feed.subscribe((event) => seen.push(event));

    expect(() => {
      feed.connect();
    }).toThrow('listener failed');
    expect(() => {
      sockets.last().fireOpen();
    }).toThrow('listener failed');
    expect(() => {
      sockets.last().fireMessage(JSON.stringify(testFrame()));
    }).toThrow('listener failed');

    expect(seen.map((event) => (event.type === 'status' ? event.status : event.message.t))).toEqual([
      'connecting',
      'live',
      'frame',
    ]);
  });

  it('still says hello and still retries when a listener throws', () => {
    const { feed, sockets, scheduler } = harness();
    feed.subscribe(() => {
      throw new Error('listener failed');
    });

    expect(() => {
      feed.connect();
    }).toThrow('listener failed');
    expect(() => {
      sockets.last().fireOpen();
    }).toThrow('listener failed');
    expect(sockets.last().sent).toEqual(['{"t":"hello","v":1}']);

    expect(() => {
      sockets.last().fireClose();
    }).toThrow('listener failed');
    expect(scheduler.delays()).toEqual([1000]);
  });
});

describe('the feed with a stress board size', () => {
  const BOARD = 2500;
  const BOARD_KEY = `${SESSION_KEY}.b2500`;

  it('sends the size on the first hello of every socket, reconnects included', () => {
    const { feed, sockets, scheduler } = harness({ board: BOARD });
    feed.connect();
    sockets.last().fireOpen();
    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, board: BOARD }]);

    sockets.last().fireClose();
    scheduler.runNext();
    sockets.last().fireOpen();
    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, board: BOARD }]);
  });

  it('sends no board key at all without one, and keeps the plain session key', () => {
    const { feed, sockets, storage } = harness({ stored: 's-plain' });
    feed.connect();
    sockets.last().fireOpen();

    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, session: 's-plain' }]);
    sockets.last().fireMessage(JSON.stringify(testFrame({ session: 's-2' })));
    expect(storage.held.get(SESSION_KEY)).toBe('s-2');
    expect(storage.held.has(BOARD_KEY)).toBe(false);
  });

  it('keeps its session under the size\'s own key, and never reads the plain one', () => {
    const { feed, sockets, storage } = harness({ board: BOARD, stored: 's-plain' });
    feed.connect();
    sockets.last().fireOpen();

    // The owner's own gesture: a tab showing the ordinary game, pointed at
    // the stress address, gets a stress game and not the game it held.
    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, board: BOARD }]);

    sockets.last().fireMessage(JSON.stringify(testFrame({ session: 's-stress' })));
    expect(storage.held.get(BOARD_KEY)).toBe('s-stress');
    expect(storage.held.get(SESSION_KEY)).toBe('s-plain');
  });

  it('is ignored the other way round: no size resumes the plain game', () => {
    const { feed, sockets } = harness({ stored: 's-plain', storedRaw: { [BOARD_KEY]: 's-stress' } });
    feed.connect();
    sockets.last().fireOpen();

    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, session: 's-plain' }]);
  });

  it('sends both the session and the size when it has a session for that size', () => {
    const { feed, sockets } = harness({ board: BOARD, storedRaw: { [BOARD_KEY]: 's-stress' } });
    feed.connect();
    sockets.last().fireOpen();

    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, session: 's-stress', board: BOARD }]);
  });
});

describe('a board size the service will not grant', () => {
  const BOARD = 25_000;
  const BOARD_KEY = `${SESSION_KEY}.b25000`;
  const BAD_MESSAGE = JSON.stringify({ t: 'error', code: 'badMessage' });

  it('asks again on the same socket, plainly, and takes the game that follows', () => {
    const { feed, sockets, events, storage } = harness({ board: BOARD, storedRaw: { [BOARD_KEY]: 's-stress' } });
    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireMessage(BAD_MESSAGE);

    expect(helloTexts(sockets.last().sent)).toEqual([
      { t: 'hello', v: PROTOCOL_VERSION, session: 's-stress', board: BOARD },
      { t: 'hello', v: PROTOCOL_VERSION },
    ]);
    expect(sockets.made).toHaveLength(1);

    // The ordinary game that answers it reaches the listeners as usual, and
    // is kept under the plain key, because that is what it now is.
    const frame = testFrame({ session: 's-plain' });
    sockets.last().fireMessage(JSON.stringify(frame));
    expect(events.filter((event) => event.type === 'message').map((event) => event.message.t)).toEqual(['error', 'frame']);
    expect(storage.held.get(SESSION_KEY)).toBe('s-plain');
    expect(storage.held.get(BOARD_KEY)).toBe('s-stress');
  });

  it('asks again once per socket and never a third time', () => {
    const { feed, sockets } = harness({ board: BOARD });
    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireMessage(BAD_MESSAGE);
    sockets.last().fireMessage(BAD_MESSAGE);

    expect(helloTexts(sockets.last().sent)).toHaveLength(2);
  });

  it('stays plain after a reconnect: the size is dropped for the rest of the page load', () => {
    const { feed, sockets, scheduler } = harness({ board: BOARD });
    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireMessage(BAD_MESSAGE);

    sockets.last().fireClose();
    scheduler.runNext();
    sockets.last().fireOpen();
    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION }]);
  });

  it('sends no second hello when no size was asked for', () => {
    const { feed, sockets } = harness({ stored: 's-plain' });
    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireMessage(BAD_MESSAGE);

    expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, session: 's-plain' }]);
  });

  it('sends no second hello for a badMessage that follows a frame', () => {
    const { feed, sockets } = harness({ board: BOARD });
    feed.connect();
    sockets.last().fireOpen();
    sockets.last().fireMessage(JSON.stringify(testFrame({ session: 's-stress' })));
    sockets.last().fireMessage(BAD_MESSAGE);

    expect(helloTexts(sockets.last().sent)).toHaveLength(1);
  });

  it('leaves versionMismatch, serverFull and noSession exactly as they were', () => {
    for (const code of ['versionMismatch', 'serverFull', 'noSession'] as const) {
      const { feed, sockets, storage } = harness({ board: BOARD, storedRaw: { [BOARD_KEY]: 's-stress' } });
      feed.connect();
      sockets.last().fireOpen();
      sockets.last().fireMessage(JSON.stringify({ t: 'error', code }));

      expect(helloTexts(sockets.last().sent)).toEqual([{ t: 'hello', v: PROTOCOL_VERSION, session: 's-stress', board: BOARD }]);
      expect(storage.held.has(BOARD_KEY)).toBe(code !== 'noSession');
    }
  });
});
