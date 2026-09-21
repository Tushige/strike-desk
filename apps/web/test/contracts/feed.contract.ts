import { describe, expect, it } from 'vitest';
import type { Feed, FeedEvent, FeedStatus } from '@strike-desk/shared/feed';
import { createFakeTransport, fakeFrameText } from '../../src/modules/connection/fake';
import type { FakeTransport } from '../../src/modules/connection/fake';
import type { TransportSeam } from '../../src/modules/connection/index';

/**
 * What any feed must do, whatever is behind it. Every case builds its own
 * hand-driven transport: the test opens and closes every socket, runs every
 * wait and moves the clock itself, so nothing here waits for real time. The
 * expected texts, waits and times are written out, never worked out.
 *
 * This file is not a test file by itself: a test file names the feed to try
 * and calls `describeFeedContract`.
 */

interface Rig {
  transport: FakeTransport;
  feed: Feed;
  events: FeedEvent[];
  statuses: () => FeedStatus[];
  messages: () => string[];
}

const START = { t: 'start', commandId: 'command-1', pace: 3 } as const;
const START_TEXT = '{"t":"start","commandId":"command-1","pace":3}';

const FINAL_CLOCK = { phase: 'final', day: 5, stepsLeft: 0, priceIndex: 500, pace: 3 };

export function describeFeedContract(name: string, make: (seam: TransportSeam) => Feed): void {
  function rig(options?: Parameters<typeof createFakeTransport>[0]): Rig {
    const transport = createFakeTransport(options);
    const feed = make(transport.seam);
    const events: FeedEvent[] = [];
    feed.subscribe((event) => events.push(event));
    return {
      transport,
      feed,
      events,
      statuses: () => events.flatMap((event) => (event.type === 'status' ? [event.status] : [])),
      messages: () => events.flatMap((event) => (event.type === 'message' ? [event.message.t] : [])),
    };
  }

  /** Connected, open, and one frame in: the usual place a case starts from. */
  function liveRig(): Rig {
    const made = rig();
    made.feed.connect();
    made.transport.last().fireOpen();
    made.transport.last().fireMessage(fakeFrameText());
    return made;
  }

  describe(`the feed contract: ${name}`, () => {
    it('says hello first, with no session when it has none', () => {
      const { feed, transport } = rig();
      feed.connect();
      transport.last().fireOpen();

      // The whole of `sent`, not just its first text: one hello per socket
      // and no second one.
      expect(transport.last().sent).toEqual(['{"t":"hello","v":1}']);
    });

    it('says hello first, naming the session it has stored', () => {
      const { feed, transport } = rig({ session: 's-9' });
      feed.connect();
      transport.last().fireOpen();

      expect(transport.last().sent[0]).toBe('{"t":"hello","v":1,"session":"s-9"}');
    });

    it('opens every socket to the address it was given', () => {
      const { feed, transport } = rig({ url: 'ws://elsewhere.invalid/ws' });
      feed.connect();

      expect(transport.last().url).toBe('ws://elsewhere.invalid/ws');
    });

    it('announces its statuses in order and never the same one twice in a row', () => {
      const { feed, transport, statuses } = rig();
      feed.connect();
      transport.last().fireOpen();
      transport.last().fireClose();
      transport.runNextWait();
      transport.last().fireOpen();
      feed.close();

      expect(statuses()).toEqual(['connecting', 'live', 'reconnecting', 'connecting', 'live', 'closed']);
      // Closing for good closes the socket it holds, exactly once: a feed
      // that only forgets its socket leaks it, and leaves a seat taken.
      expect(transport.last().closeCalls).toBe(1);
    });

    it('waits 1, 2, 4, 8 and then 8 seconds while no frame arrives', () => {
      const { feed, transport } = rig();
      feed.connect();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        transport.last().fireOpen();
        transport.last().fireClose();
        transport.runNextWait();
      }

      expect(transport.waits()).toEqual([1000, 2000, 4000, 8000, 8000]);
    });

    it('starts the waits again once a frame has arrived on a new socket', () => {
      const { feed, transport } = rig();
      feed.connect();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        transport.last().fireOpen();
        transport.last().fireClose();
        transport.runNextWait();
      }
      transport.last().fireOpen();
      transport.last().fireMessage(fakeFrameText());
      transport.last().fireClose();

      expect(transport.waits()).toEqual([1000, 2000, 4000, 1000]);
    });

    it('sends nothing, and says so, before it is connected', () => {
      const { feed, transport } = rig();

      expect(feed.send(START)).toBe(false);
      expect(transport.sockets).toEqual([]);
    });

    it('sends nothing, and says so, while it is reconnecting', () => {
      const { feed, transport } = liveRig();
      transport.last().fireClose();
      const sentBefore = [...transport.last().sent];

      expect(feed.send(START)).toBe(false);
      expect(transport.last().sent).toEqual(sentBefore);
    });

    it('hands a message to the open socket, and says so, while it is live', () => {
      const { feed, transport } = liveRig();

      expect(feed.send(START)).toBe(true);
      expect(transport.last().sent.at(-1)).toBe(START_TEXT);
    });

    it('hands nothing over, and says so, once its socket is no longer open', () => {
      const { feed, transport } = liveRig();
      const socket = transport.last();
      const sentBefore = [...socket.sent];
      // A browser marks a dead socket closed straight away and delivers its
      // close event as a later task. In that gap the feed has not been told
      // anything, so it still believes the line is up — and a socket that is
      // no longer open takes a text without a word and throws it away.
      socket.close();

      expect(feed.send(START)).toBe(false);
      expect(socket.sent).toEqual(sentBefore);
      expect(socket.discarded).toEqual([]);
    });

    it('stamps a message with the time it arrived', () => {
      const { feed, transport, events } = rig();
      feed.connect();
      transport.last().fireOpen();
      transport.clock.advance(5000);
      transport.last().fireMessage(fakeFrameText());

      const times = events.flatMap((event) => (event.type === 'message' ? [event.receivedAt] : []));
      expect(times).toEqual([5000]);
    });

    it('lets no rubbish through and changes no status over it', () => {
      const { feed, transport, statuses, messages } = rig();
      feed.connect();
      transport.last().fireOpen();
      transport.last().fireMessage('not json');
      transport.last().fireMessage('{"t":"nope"}');

      expect(messages()).toEqual([]);
      expect(statuses()).toEqual(['connecting', 'live']);
    });

    it('drops the line on purpose the way the network would', () => {
      const { feed, transport, statuses, messages } = liveRig();
      const dropped = transport.last();

      feed.simulateDrop();
      expect(statuses()).toEqual(['connecting', 'live', 'reconnecting']);
      expect(transport.waits()).toEqual([1000]);

      dropped.fireMessage(fakeFrameText({ step: 9 }));
      dropped.fireClose();
      expect(messages()).toEqual(['frame']);
      expect(statuses()).toEqual(['connecting', 'live', 'reconnecting']);
      expect(transport.waits()).toEqual([1000]);

      transport.runNextWait();
      expect(transport.sockets).toHaveLength(2);
      transport.last().fireOpen();
      expect(transport.last().sent[0]).toBe('{"t":"hello","v":1,"session":"s-1"}');
    });

    it('ignores a drop on purpose while it is not live', () => {
      const { feed, transport, events } = rig();

      feed.simulateDrop();
      feed.connect();
      feed.simulateDrop();

      expect(events).toEqual([{ type: 'status', status: 'connecting' }]);
      expect(transport.waits()).toEqual([]);
      expect(transport.pendingWaits()).toBe(0);
    });

    it('remembers the session a frame names', () => {
      const { transport } = liveRig();

      expect(transport.stored()).toBe('s-1');
    });

    it('forgets the session once the game is over', () => {
      const { transport } = liveRig();
      transport.last().fireMessage(fakeFrameText({ step: 4500, clock: FINAL_CLOCK }));

      expect(transport.stored()).toBeNull();
    });

    it('forgets the session when the server says the game is gone', () => {
      const { feed, transport } = rig({ session: 's-9' });
      feed.connect();
      transport.last().fireOpen();
      transport.last().fireMessage('{"t":"error","code":"noSession"}');

      expect(transport.stored()).toBeNull();
    });

    it('makes no socket when a wait runs after close', () => {
      const { feed, transport } = liveRig();
      transport.last().fireClose();
      expect(transport.pendingWaits()).toBe(1);

      feed.close();
      // A feed may cancel the wait or let it run to nothing; either way no socket follows.
      while (transport.pendingWaits() > 0) transport.runNextWait();
      expect(transport.sockets).toHaveLength(1);
    });

    it('gives the next listener its event when the one before it throws', () => {
      const { feed, transport } = rig();
      const seen: string[] = [];
      feed.subscribe(() => {
        throw new Error('listener failed');
      });
      feed.subscribe((event) => seen.push(event.type === 'status' ? event.status : event.message.t));

      expect(() => {
        feed.connect();
      }).toThrow('listener failed');
      expect(() => {
        transport.last().fireOpen();
      }).toThrow('listener failed');
      expect(() => {
        transport.last().fireMessage(fakeFrameText());
      }).toThrow('listener failed');

      expect(seen).toEqual(['connecting', 'live', 'frame']);
    });

    it('tells an unsubscribed listener nothing more', () => {
      const { feed, transport } = rig();
      const seen: FeedEvent[] = [];
      const stop = feed.subscribe((event) => seen.push(event));
      feed.connect();
      stop();
      transport.last().fireOpen();
      transport.last().fireMessage(fakeFrameText());

      expect(seen).toEqual([{ type: 'status', status: 'connecting' }]);
    });
  });
}
