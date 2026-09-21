import { describe, expect, it } from 'vitest';
import { createFakeTransport, fakeFrameText } from '../src/modules/connection/fake';
import type { FakeTransport, FakeTransportOptions } from '../src/modules/connection/fake';
import { createConnection } from '../src/modules/connection/index';
import type { Connection, ConnectionOptions, SessionStore } from '../src/modules/connection/index';

/**
 * The connection's own cases, over a transport driven entirely by hand: the
 * test opens and closes every socket, runs every wait and moves the clock, so
 * nothing here waits for real time. Expected texts, waits and times are typed
 * in, with the sum beside them, never worked out by the code under test.
 */

interface Rig {
  transport: FakeTransport;
  connection: Connection;
}

function rig(
  options: FakeTransportOptions = {},
  resendOnResume: ConnectionOptions['resendOnResume'] = () => false,
): Rig {
  const transport = createFakeTransport(options);
  const connection = createConnection({ seam: transport.seam, sessionKey: 'test.session', resendOnResume });
  return { transport, connection };
}

describe('where the connection stands', () => {
  it('is connecting before connect, while the socket opens and until the first frame', () => {
    const { transport, connection } = rig();
    expect(connection.state.get()).toEqual({
      phase: 'connecting',
      attempt: 0,
      retryAt: null,
      lastMessageAt: null,
      gameGone: false,
      serverFull: false,
    });

    connection.connect();
    expect(connection.state.get().phase).toBe('connecting');

    // An open socket is not a working line: only a frame says the server is there.
    transport.last().fireOpen();
    expect(connection.state.get().phase).toBe('connecting');
  });

  it('is live from the first frame, and says when that frame arrived', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.clock.advance(40);
    transport.last().fireMessage(fakeFrameText());

    expect(connection.state.get()).toEqual({
      phase: 'live',
      attempt: 0,
      retryAt: null,
      lastMessageAt: 40,
      gameGone: false,
      serverFull: false,
    });
  });

  it('is reconnecting after a drop, and says which attempt is due and when', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.clock.advance(250);
    transport.last().fireClose();

    // The first wait is 1,000 ms, unscaled by a draw of 0.5: 250 + 1,000 = 1,250.
    expect(transport.waits()).toEqual([1000]);
    expect(connection.state.get()).toEqual({
      phase: 'reconnecting',
      attempt: 1,
      retryAt: 1250,
      lastMessageAt: 0,
      gameGone: false,
      serverFull: false,
    });
  });

  it('stays reconnecting while the next socket opens, with no attempt waiting', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.last().fireClose();
    transport.runNextWait();

    expect(transport.sockets).toHaveLength(2);
    expect(connection.state.get().phase).toBe('reconnecting');
    expect(connection.state.get().attempt).toBe(1);
    expect(connection.state.get().retryAt).toBeNull();

    transport.last().fireOpen();
    expect(connection.state.get().phase).toBe('reconnecting');
  });

  it('counts the attempts while no frame arrives, and says when the second is due', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.last().fireClose();
    transport.clock.advance(1000);
    transport.runNextWait();
    transport.last().fireOpen();
    transport.last().fireClose();

    // The second wait is 2,000 ms: 1,000 + 2,000 = 3,000.
    expect(connection.state.get().attempt).toBe(2);
    expect(connection.state.get().retryAt).toBe(3000);
  });

  it('scales a wait by the draw it is handed: 0.8 of it at a draw of 0', () => {
    const { transport, connection } = rig({ random: 0 });
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireClose();

    // 1,000 x 0.8 = 800.
    expect(transport.waits()).toEqual([800]);
    expect(connection.state.get().retryAt).toBe(800);
  });

  it('is closed once the page closes it, and connecting again after another connect', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    connection.close();

    expect(connection.state.get().phase).toBe('closed');
    expect(connection.state.get().retryAt).toBeNull();

    connection.connect();
    expect(connection.state.get().phase).toBe('connecting');
    expect(transport.sockets).toHaveLength(2);
  });

  it('hands out the same snapshot until a member changes, and tells a listener once per change', () => {
    const { transport, connection } = rig();
    let told = 0;
    connection.state.subscribe(() => {
      told += 1;
    });
    const before = connection.state.get();

    // Connecting already: opening a socket changes no member.
    connection.connect();
    transport.last().fireOpen();
    expect(connection.state.get()).toBe(before);
    expect(told).toBe(0);

    transport.last().fireMessage(fakeFrameText());
    const live = connection.state.get();
    expect(live).not.toBe(before);
    expect(told).toBe(1);

    // Rubbish off the wire changes nothing.
    transport.last().fireMessage('not json');
    expect(connection.state.get()).toBe(live);
    expect(told).toBe(1);
  });

  it('tells an unsubscribed state listener nothing more', () => {
    const { transport, connection } = rig();
    let told = 0;
    const stop = connection.state.subscribe(() => {
      told += 1;
    });
    stop();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());

    expect(told).toBe(0);
  });

  it('has moved on before any feed listener hears of it', () => {
    const { transport, connection } = rig();
    const seen: string[] = [];
    connection.subscribe((event) => {
      if (event.type === 'message') seen.push(connection.state.get().phase);
    });
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());

    expect(seen).toEqual(['live']);
  });

  it('reports a server that refused a new game, until a frame says otherwise', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage('{"t":"error","code":"serverFull"}');

    expect(connection.state.get().serverFull).toBe(true);
    // An error is not data: nothing on screen got newer.
    expect(connection.state.get().phase).toBe('connecting');
    expect(connection.state.get().lastMessageAt).toBeNull();

    transport.last().fireMessage(fakeFrameText());
    expect(connection.state.get().serverFull).toBe(false);
  });
});

describe('where the session is kept', () => {
  it('reads and writes the session under the key it was handed, and no other', () => {
    const kept = new Map<string, string>([['test.session', 's-7']]);
    const storage: SessionStore = {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => {
        kept.set(key, value);
      },
      removeItem: (key) => {
        kept.delete(key);
      },
    };
    const transport = createFakeTransport();
    const connection = createConnection({
      seam: { ...transport.seam, storage },
      sessionKey: 'test.session',
      resendOnResume: () => false,
    });
    connection.connect();
    transport.last().fireOpen();
    expect(transport.last().sent).toEqual(['{"t":"hello","v":1,"session":"s-7"}']);

    transport.last().fireMessage(fakeFrameText({ session: 's-8' }));
    expect([...kept.entries()]).toEqual([['test.session', 's-8']]);
  });

  it('carries on when the storage throws', () => {
    const storage: SessionStore = {
      getItem: () => {
        throw new Error('storage is off');
      },
      setItem: () => {
        throw new Error('storage is off');
      },
      removeItem: () => {
        throw new Error('storage is off');
      },
    };
    const transport = createFakeTransport();
    const connection = createConnection({
      seam: { ...transport.seam, storage },
      sessionKey: 'test.session',
      resendOnResume: () => false,
    });
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.last().fireClose();
    transport.runNextWait();
    transport.last().fireOpen();

    // Kept in memory for this page load all the same.
    expect(transport.last().sent).toEqual(['{"t":"hello","v":1,"session":"s-1"}']);
  });
});

describe('listeners that throw', () => {
  it('keeps every listener error, not only the first', () => {
    const { connection } = rig();
    connection.subscribe(() => {
      throw new Error('first listener failed');
    });
    connection.subscribe(() => {
      throw new Error('second listener failed');
    });

    let thrown: unknown;
    try {
      connection.connect();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const messages = thrown instanceof AggregateError ? thrown.errors.map((one: unknown) => String(one)) : [];
    expect(messages).toEqual(['Error: first listener failed', 'Error: second listener failed']);
  });
});
