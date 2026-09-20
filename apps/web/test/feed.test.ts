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

function harness(over: Partial<WsFeedOptions> & { stored?: string } = {}): Harness {
  const sockets = createSocketFactory();
  const scheduler = createManualScheduler();
  const storage = createFakeStorage(over.stored === undefined ? {} : { [SESSION_KEY]: over.stored });
  const events: FeedEvent[] = [];
  const feed = createWsFeed({
    url: URL,
    createSocket: (url) => sockets.create(url),
    schedule: (run, ms) => scheduler.schedule(run, ms),
    storage,
    random: () => 0.5,
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
  it('has exactly the four methods of the interface', () => {
    const { feed } = harness();
    expect(Object.keys(feed).sort()).toEqual(['close', 'connect', 'send', 'subscribe']);
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

    expect(seen.filter((event) => event.type === 'message')).toEqual([{ type: 'message', message: frame }]);
    expect(alsoSeen.filter((event) => event.type === 'message')).toEqual([{ type: 'message', message: frame }]);
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
});
