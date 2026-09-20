import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@strike-desk/shared';
import type { Frame } from '@strike-desk/shared';
import type { Harness, TestClient } from './harness';
import { FIXED_SEEDS, startHarness } from './harness';

/**
 * Every answer a hello can get, over a real connection to the real server:
 * the right version, another version, a session the server no longer has, a
 * session it still has, a board size, and a second hello on the same socket.
 */

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
const start = (commandId: string, pace = 1) => ({ t: 'start', commandId, pace });
const SAMPLE_MS = 200;

let harness: Harness | null = null;
/** How many seeds have been drawn. A session is the only thing that draws one. */
let sessionsMade = 0;

async function boot(): Promise<Harness> {
  sessionsMade = 0;
  harness = await startHarness({
    drawSeed: () => {
      const seed = FIXED_SEEDS[sessionsMade % FIXED_SEEDS.length] ?? 0;
      sessionsMade += 1;
      return seed;
    },
  });
  return harness;
}

afterEach(async () => {
  await harness?.close();
  harness = null;
});

async function open(running: Harness): Promise<TestClient> {
  const client = running.connect();
  await client.opened();
  return client;
}

/** Connect, say hello, and take the frame that answers it. */
async function join(running: Harness, session?: string): Promise<{ client: TestClient; frame: Frame }> {
  const client = await open(running);
  client.send(session === undefined ? HELLO : { ...HELLO, session });
  return { client, frame: await client.nextFrame() };
}

/**
 * Resolves once the server has answered a protocol-level ping sent now. The
 * server reads a socket in order, so everything it sent in answer to earlier
 * messages has arrived by then: "nothing more came" without waiting a duration.
 */
function roundTrip(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    client.socket.once('pong', () => resolve());
    client.socket.ping();
  });
}

describe('the version on hello', () => {
  it('the version this server speaks gets a lobby frame and no error', async () => {
    const running = await boot();
    const { client, frame } = await join(running);
    await roundTrip(client);

    expect(frame.clock.phase).toBe('lobby');
    expect(client.received()).toEqual([frame]);
    expect(sessionsMade).toBe(1);
  });

  it('another version is answered versionMismatch, once, and makes no session', async () => {
    const running = await boot();
    const client = await open(running);
    client.send({ t: 'hello', v: PROTOCOL_VERSION + 1 });

    expect(await client.nextError()).toEqual({ t: 'error', code: 'versionMismatch' });
    await roundTrip(client);
    expect(client.received()).toEqual([{ t: 'error', code: 'versionMismatch' }]);
    expect(sessionsMade).toBe(0);

    // Nothing is sampled to it either: it has no session to be sampled for.
    running.clock.advance(SAMPLE_MS);
    running.sample();
    await roundTrip(client);
    expect(client.received()).toHaveLength(1);
  });

  it('an older version is refused the same way, even when it names a live session', async () => {
    const running = await boot();
    const { frame } = await join(running);
    const client = await open(running);
    client.send({ t: 'hello', v: 0, session: frame.session });

    expect(await client.nextError()).toEqual({ t: 'error', code: 'versionMismatch' });
    await roundTrip(client);
    expect(client.received()).toHaveLength(1);
    expect(sessionsMade).toBe(1);
  });

  it('the same socket can say a correct hello after a refused one', async () => {
    const running = await boot();
    const client = await open(running);
    client.send({ t: 'hello', v: PROTOCOL_VERSION + 1 });
    await client.nextError();

    client.send(HELLO);
    expect((await client.nextFrame()).clock.phase).toBe('lobby');
    expect(sessionsMade).toBe(1);
  });
});

describe('the session on hello', () => {
  it('a session the server does not have is answered noSession, then a new session\'s frame', async () => {
    const running = await boot();
    const client = await open(running);
    client.send({ ...HELLO, session: 'not-a-session-the-server-has' });

    const first = await client.next();
    const second = await client.next();
    await roundTrip(client);

    expect(first).toEqual({ t: 'error', code: 'noSession' });
    expect(second).toMatchObject({ t: 'frame', rev: 0, step: 0, clock: { phase: 'lobby' } });
    expect((second as Frame).session).not.toBe('not-a-session-the-server-has');
    expect((second as Frame).session).toHaveLength(22);
    expect(client.received()).toEqual([first, second]);
    expect(sessionsMade).toBe(1);

    // The new session is this socket's own: it is sampled like any other.
    running.sample();
    const sampled = await client.nextFrame();
    expect(sampled.session).toBe((second as Frame).session);
  });

  it('a session the server still has is resumed where it is, on a new socket, and nothing restarts', async () => {
    const running = await boot();
    const { client: firstSocket, frame: lobby } = await join(running);
    firstSocket.send(start('start-0001'));
    const started = await firstSocket.nextReply();
    expect(started.receipt.outcome).toBe('accepted');
    await firstSocket.close();

    // Thirty seconds at pace 1 is 150 steps, whether or not anybody was connected.
    running.clock.advance(30_000);
    const { client, frame: resumed } = await join(running, lobby.session);
    await roundTrip(client);

    expect(client.received()).toEqual([resumed]);
    expect(resumed).toMatchObject({ session: lobby.session, rev: 1, step: 150, clock: { phase: 'preBell', day: 1, pace: 1 } });
    expect(resumed.clock.phase).not.toBe('lobby');
    expect(sessionsMade).toBe(1);

    // A start sent again is refused, and the clock keeps counting from the first one.
    client.send(start('start-0002', 3));
    const refused = await client.nextReply();
    expect(refused.receipt).toMatchObject({ commandId: 'start-0002', outcome: 'rejected', reason: 'alreadyStarted' });
    expect(refused.frame).toMatchObject({ step: 150, clock: { pace: 1 } });

    running.clock.advance(SAMPLE_MS * 25);
    running.sample();
    expect(await client.nextFrame()).toMatchObject({ session: lobby.session, step: 175, clock: { phase: 'preBell', pace: 1 } });
  });

  it('two sockets may hold the same session, and both are sampled', async () => {
    const running = await boot();
    const one = await join(running);
    const two = await join(running, one.frame.session);
    expect(two.frame.session).toBe(one.frame.session);
    expect(sessionsMade).toBe(1);

    running.sample();
    expect(await one.client.nextFrame()).toEqual(await two.client.nextFrame());
  });
});

describe('what hello may not do', () => {
  it('a hello that asks for a board size is answered badMessage and makes no session', async () => {
    const running = await boot();
    const client = await open(running);
    client.send({ ...HELLO, board: 2508 });

    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    await roundTrip(client);
    expect(client.received()).toHaveLength(1);
    expect(sessionsMade).toBe(0);

    client.send(HELLO);
    const lobby = await client.nextFrame();
    expect(lobby).toMatchObject({ stress: false, board: null, quotes: [] });
  });

  it('a board size is refused even beside a session the server has', async () => {
    const running = await boot();
    const { frame } = await join(running);
    const client = await open(running);
    client.send({ ...HELLO, session: frame.session, board: 2508 });

    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    running.sample();
    await roundTrip(client);
    expect(client.received()).toHaveLength(1);
  });

  it('a second hello on a socket that has a session is answered badMessage and changes nothing', async () => {
    const running = await boot();
    const { client, frame: lobby } = await join(running);

    client.send(HELLO);
    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    client.send({ ...HELLO, session: 'not-a-session-the-server-has' });
    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    expect(sessionsMade).toBe(1);

    running.sample();
    expect(await client.nextFrame()).toEqual(lobby);
  });

  it('a second hello is refused before its version is even looked at', async () => {
    const running = await boot();
    const { client } = await join(running);
    client.send({ t: 'hello', v: PROTOCOL_VERSION + 1 });
    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
  });
});
