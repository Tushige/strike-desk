import { afterEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@strike-desk/shared/engine';
import { LIMITS } from '../src/limits';
import type { Harness, TestClient } from './harness';
import { FIXED_SEEDS, startHarness } from './harness';

/**
 * How many connections the service will hold open at once. A connection that
 * never speaks is charged nothing anywhere else — no game is built, no
 * message is counted, and a client that sends no Origin is allowed by design
 * — so without a count of its own, silent sockets alone could take the host's
 * memory and every game running on it. Every reading of time here comes from
 * the harness's fake clock; nothing waits for a duration.
 */

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
/** The cap these tests run the service with, small enough to fill by hand. */
const CAP = 2;
const FAILURE_TIMEOUT_MS = 5000;

let harness: Harness | null = null;
/** How many seeds have been drawn. Making a session is the only thing that draws one. */
let sessionsMade = 0;
/** Every socket the service has accepted, in the order it accepted them. */
let accepted: WebSocket[] = [];

async function boot(overrides: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  sessionsMade = 0;
  accepted = [];
  harness = await startHarness({
    drawSeed: () => {
      const seed = FIXED_SEEDS[sessionsMade % FIXED_SEEDS.length] ?? 0;
      sessionsMade += 1;
      return seed;
    },
    ...overrides,
  });
  // Registered before any client connects. The service registers its own
  // close listener before it announces a connection, so a close listener
  // added from here always runs after the service has let go.
  harness.app.wss.on('connection', (ws: WebSocket) => {
    accepted.push(ws);
  });
  return harness;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await harness?.close();
  harness = null;
});

interface Counts {
  sessions: number;
  sockets: number;
}

async function counts(running: Harness): Promise<Counts> {
  const res = await fetch(`${running.baseUrl}/healthz`);
  expect(res.status).toBe(200);
  const body: unknown = await res.json();
  const { sessions, sockets } = body as Counts;
  return { sessions, sockets };
}

/**
 * Resolves with the message of the error the client reports when its upgrade
 * is refused: `ws` reports an answer that is not a handshake as an error
 * naming the status it got. Rejects if the socket ever opens.
 */
function refusedWith(client: TestClient): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the socket neither opened nor was refused within ${FAILURE_TIMEOUT_MS} ms`)), FAILURE_TIMEOUT_MS);
    client.socket.once('open', () => {
      clearTimeout(timer);
      reject(new Error('an upgrade past the cap must never reach open'));
    });
    client.socket.once('error', (error: Error) => {
      clearTimeout(timer);
      resolve(error.message);
    });
  });
}

/**
 * Resolves once the service itself has finished with a socket, never after a
 * duration. A client sees its own close first; the service letting go of the
 * slot happens a moment later.
 */
function serverHasLetGo(ws: WebSocket | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws === undefined) {
      reject(new Error('the service holds no such socket to let go of'));
      return;
    }
    const timer = setTimeout(() => reject(new Error(`the service did not let go of a socket within ${FAILURE_TIMEOUT_MS} ms`)), FAILURE_TIMEOUT_MS);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Resolves once the server has worked through everything this socket sent:
 * the answering pong is written after them. Lets a test assert that something
 * was *not* answered without waiting for a duration.
 */
function roundTrip(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    client.socket.once('pong', () => resolve());
    client.socket.ping();
  });
}

/** Open a connection and wait for it to be there. */
async function open(running: Harness): Promise<TestClient> {
  const client = running.connect();
  await client.opened();
  return client;
}

describe('the number of connections the service will hold', () => {
  it('answers the upgrade past the cap 503, makes no session, and leaves those already connected answering', async () => {
    const running = await boot({ limits: { maxConnections: CAP } });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await open(running);
    const second = await open(running);

    const refused = running.connect();
    expect(await refusedWith(refused)).toContain('503');
    expect(sessionsMade).toBe(0);
    expect(await counts(running)).toEqual({ sessions: 0, sockets: CAP });

    // The refusal disturbed neither of the two already there.
    first.send(HELLO);
    expect((await first.nextFrame()).clock.phase).toBe('lobby');
    await roundTrip(second);
    expect(second.received()).toEqual([]);
    expect(second.socket.readyState).toBe(second.socket.OPEN);
  });

  it('lets the next upgrade in once one of the connections has closed', async () => {
    const running = await boot({ limits: { maxConnections: CAP } });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await open(running);
    await open(running);

    await refusedWith(running.connect());

    const letGo = serverHasLetGo(accepted[0]);
    await first.close();
    await letGo;

    const next = await open(running);
    next.send(HELLO);
    expect((await next.nextFrame()).clock.phase).toBe('lobby');
    expect(await counts(running)).toEqual({ sessions: 1, sockets: CAP });
  });

  it('logs one line each time the cap is reached, however many upgrades are refused', async () => {
    const running = await boot({ limits: { maxConnections: CAP } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await open(running);
    await open(running);

    await refusedWith(running.connect());
    await refusedWith(running.connect());
    expect(warn.mock.calls).toEqual([['ws connection cap reached', CAP]]);

    // A slot frees, an upgrade is taken, and the cap is reached again: that
    // crossing is worth a line of its own.
    const letGo = serverHasLetGo(accepted[0]);
    await first.close();
    await letGo;
    await open(running);
    await refusedWith(running.connect());
    expect(warn.mock.calls).toEqual([
      ['ws connection cap reached', CAP],
      ['ws connection cap reached', CAP],
    ]);
  });

  it('still refuses a page on another site the old way when the service is full', async () => {
    const running = await boot({ limits: { maxConnections: CAP } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await open(running);
    await open(running);

    const foreign = running.connect({ socket: { origin: 'https://evil.example' } });
    await refusedWith(foreign);

    expect(warn.mock.calls).toEqual([['ws origin refused', 'https://evil.example']]);
  });

  it('is never lower than the sockets the other limits already allow', () => {
    expect(LIMITS.maxConnections).toBeGreaterThanOrEqual(LIMITS.maxSessions * LIMITS.maxSocketsPerSession);
  });
});

describe('a connection that has not been given a session', () => {
  it('is closed once the deadline has passed, and not a millisecond before', async () => {
    const running = await boot();
    const silent = await open(running);

    running.clock.advance(LIMITS.helloDeadlineMs - 1);
    running.helloDeadline();
    await roundTrip(silent);
    expect(silent.socket.readyState).toBe(silent.socket.OPEN);

    running.clock.advance(1);
    running.helloDeadline();
    await silent.closed();
    expect(silent.socket.readyState).toBe(silent.socket.CLOSED);
  });

  it('is closed when its only hello was refused, and when it sent nothing readable at all', async () => {
    const running = await boot();
    const wrongVersion = await open(running);
    wrongVersion.send({ t: 'hello', v: PROTOCOL_VERSION + 1 });
    expect(await wrongVersion.nextError()).toEqual({ t: 'error', code: 'versionMismatch' });

    const gibberish = await open(running);
    gibberish.sendText('{');
    expect(await gibberish.nextError()).toEqual({ t: 'error', code: 'badMessage' });

    running.clock.advance(LIMITS.helloDeadlineMs);
    running.helloDeadline();
    await Promise.all([wrongVersion.closed(), gibberish.closed()]);
    expect([wrongVersion.socket.readyState, gibberish.socket.readyState]).toEqual([wrongVersion.socket.CLOSED, gibberish.socket.CLOSED]);
    expect((await counts(running)).sockets).toBe(0);
  });

  it('frees the place it was holding, so the next upgrade is let in', async () => {
    const running = await boot({ limits: { maxConnections: 1 } });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await open(running);
    await refusedWith(running.connect());

    const letGo = serverHasLetGo(accepted[0]);
    running.clock.advance(LIMITS.helloDeadlineMs);
    running.helloDeadline();
    await letGo;

    const next = await open(running);
    next.send(HELLO);
    expect((await next.nextFrame()).clock.phase).toBe('lobby');
  });
});

describe('a connection that holds a session', () => {
  it('is never closed by the deadline, however late the clock', async () => {
    const running = await boot();
    const client = await open(running);
    client.send(HELLO);
    const lobby = await client.nextFrame();
    expect(lobby.clock.phase).toBe('lobby');

    running.clock.advance(LIMITS.helloDeadlineMs);
    running.helloDeadline();
    running.clock.advance(LIMITS.helloDeadlineMs * 100);
    running.helloDeadline();

    await roundTrip(client);
    expect(client.socket.readyState).toBe(client.socket.OPEN);
    expect(await counts(running)).toEqual({ sessions: 1, sockets: 1 });
  });

  it('is left alone even when its hello came in the last moment before the deadline', async () => {
    const running = await boot();
    const client = await open(running);

    running.clock.advance(LIMITS.helloDeadlineMs - 1);
    client.send(HELLO);
    expect((await client.nextFrame()).clock.phase).toBe('lobby');

    running.clock.advance(LIMITS.helloDeadlineMs * 10);
    running.helloDeadline();
    await roundTrip(client);
    expect(client.socket.readyState).toBe(client.socket.OPEN);
  });
});

describe('the measurement modes and the deadline', () => {
  it('holds no measurement connection to it, while an ordinary one beside them is closed', async () => {
    const running = await boot({ probeModes: true });
    const silentProbe = running.connect({ search: 'probe=silent' });
    const quietProbe = running.connect({ search: 'probe=quiet' });
    const ordinary = running.connect();
    await Promise.all([silentProbe.opened(), quietProbe.opened(), ordinary.opened()]);

    running.clock.advance(LIMITS.helloDeadlineMs * 100);
    running.helloDeadline();

    // The ordinary connection is the witness that the round ran at all.
    await ordinary.closed();
    await Promise.all([roundTrip(silentProbe), roundTrip(quietProbe)]);
    expect([silentProbe.socket.readyState, quietProbe.socket.readyState]).toEqual([silentProbe.socket.OPEN, quietProbe.socket.OPEN]);
  });

  it('closes a connection asking for a measurement mode like any other when the modes are off', async () => {
    const running = await boot();
    const asking = running.connect({ search: 'probe=silent' });
    await asking.opened();

    running.clock.advance(LIMITS.helloDeadlineMs);
    running.helloDeadline();
    await asking.closed();
    expect(asking.socket.readyState).toBe(asking.socket.CLOSED);
  });
});

describe('the hello-deadline timer', () => {
  it('is made once for the whole service, whatever the number of connections, and not at all when it is turned off', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const running = await boot({ helloCheckMs: LIMITS.helloCheckIntervalMs });
    const helloTimers = (): number => spy.mock.calls.filter((call) => call[1] === LIMITS.helloCheckIntervalMs).length;
    expect(helloTimers()).toBe(1);

    // The fake clock never moves here, so the real timer can close nothing.
    for (let i = 0; i < 5; i += 1) await open(running);
    expect((await counts(running)).sockets).toBe(5);
    expect(helloTimers()).toBe(1);

    await running.close();
    harness = null;
    spy.mockClear();

    harness = await startHarness();
    expect(spy.mock.calls.filter((call) => call[1] === LIMITS.helloCheckIntervalMs)).toEqual([]);
  });
});
