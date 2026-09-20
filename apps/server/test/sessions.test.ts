import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@strike-desk/shared/engine';
import type { Frame } from '@strike-desk/shared/engine';
import { LIMITS } from '../src/limits';
import type { Harness, TestClient } from './harness';
import { FIXED_SEEDS, startHarness } from './harness';

/**
 * What the service is allowed to hold, and how it lets go. A session is made
 * only when somebody says hello; there are only ever so many; a session only
 * ever has so many sockets; and a session nobody has been connected to for
 * half an hour is freed by one piece of housekeeping that a test drives by
 * hand. Every reading of time here comes from the harness's fake clock.
 */

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
const start = (commandId: string, pace = 1) => ({ t: 'start', commandId, pace });
/** Real milliseconds at pace 1 from `start` to the opening bell of day 1. */
const PRE_BELL_MS = 60_000;
const SAMPLE_MS = 200;
const MINUTE_MS = 60_000;
const FAILURE_TIMEOUT_MS = 5000;

let harness: Harness | null = null;
/** How many seeds have been drawn. Making a session is the only thing that draws one. */
let sessionsMade = 0;

async function boot(overrides: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  sessionsMade = 0;
  harness = await startHarness({
    drawSeed: () => {
      const seed = FIXED_SEEDS[sessionsMade % FIXED_SEEDS.length] ?? 0;
      sessionsMade += 1;
      return seed;
    },
    ...overrides,
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

/** Connect, say hello, and take the frame that answers it. */
async function join(running: Harness, session?: string): Promise<{ client: TestClient; frame: Frame }> {
  const client = running.connect();
  await client.opened();
  client.send(session === undefined ? HELLO : { ...HELLO, session });
  return { client, frame: await client.nextFrame() };
}

/**
 * Resolves once the service itself has finished with a socket. A client sees
 * its own close first; the service letting go of the session and noting the
 * time happens a moment later. The listener is attached after the service's
 * own, so it runs second. Bounded by a failure timeout, never by a wait.
 */
function serverHasLetGo(running: Harness): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the service did not let go of a socket within ${FAILURE_TIMEOUT_MS} ms`)), FAILURE_TIMEOUT_MS);
    let watched = 0;
    for (const ws of running.app.wss.clients) {
      watched += 1;
      ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    }
    if (watched === 0) {
      clearTimeout(timer);
      reject(new Error('the service holds no socket to let go of'));
    }
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

describe('what makes a session', () => {
  it('two tabs get two sessions, and at the same open step the two markets differ', async () => {
    const running = await boot();
    const one = await join(running);
    const two = await join(running);

    expect(two.frame.session).not.toBe(one.frame.session);
    expect(sessionsMade).toBe(2);

    one.client.send(start('start-0001'));
    two.client.send(start('start-0002'));
    await one.client.nextReply();
    await two.client.nextReply();

    running.clock.advance(PRE_BELL_MS + SAMPLE_MS);
    running.sample();
    const first = await one.client.nextFrame();
    const second = await two.client.nextFrame();

    expect(first.clock).toMatchObject({ phase: 'open', day: 1, priceIndex: 1 });
    expect(second.clock).toEqual(first.clock);
    expect(second.prices).not.toEqual(first.prices);
    expect(await counts(running)).toEqual({ sessions: 2, sockets: 2 });
  });

  it('nothing but a hello makes a session: not a page view, not a health check, not a silent socket', async () => {
    const running = await boot();

    expect((await fetch(`${running.baseUrl}/`)).status).toBe(200);
    expect((await fetch(`${running.baseUrl}/some/deep/route`)).status).toBe(200);
    const silent = running.connect();
    await silent.opened();
    await roundTrip(silent);

    expect(await counts(running)).toEqual({ sessions: 0, sockets: 1 });
    expect(sessionsMade).toBe(0);
  });
});

describe('the number of sessions the service will hold', () => {
  it('a hello past the cap is answered serverFull and makes nothing, and room comes back when one is swept', async () => {
    const running = await boot({ limits: { maxSessions: 2 } });
    const one = await join(running);
    await join(running);
    expect(sessionsMade).toBe(2);

    const refused = running.connect();
    await refused.opened();
    refused.send(HELLO);
    expect(await refused.nextError()).toEqual({ t: 'error', code: 'serverFull' });
    await roundTrip(refused);
    expect(refused.received()).toEqual([{ t: 'error', code: 'serverFull' }]);
    expect(sessionsMade).toBe(2);
    expect((await counts(running)).sessions).toBe(2);

    // The two already playing are untouched: one of them is simply left alone
    // long enough to be swept, and the room it frees is real.
    const letGo = serverHasLetGo(running);
    await one.client.close();
    await letGo;
    running.clock.advance(LIMITS.sessionTtlMs);
    running.app.sweepOnce(running.clock.now());
    expect((await counts(running)).sessions).toBe(1);

    const { frame } = await join(running);
    expect(frame.clock.phase).toBe('lobby');
    expect(sessionsMade).toBe(3);
    expect((await counts(running)).sessions).toBe(2);
  });
});

describe('the number of sockets one session will hold', () => {
  it('a fourth socket on one session is answered serverFull, and the three already there keep their frames', async () => {
    const running = await boot();
    const first = await join(running);
    const id = first.frame.session;
    const second = await join(running, id);
    const third = await join(running, id);
    expect([second.frame.session, third.frame.session]).toEqual([id, id]);
    expect(sessionsMade).toBe(1);

    const fourth = running.connect();
    await fourth.opened();
    fourth.send({ ...HELLO, session: id });
    expect(await fourth.nextError()).toEqual({ t: 'error', code: 'serverFull' });
    expect(sessionsMade).toBe(1);

    running.clock.advance(SAMPLE_MS);
    running.sample();
    const frames = await Promise.all([first.client.nextFrame(), second.client.nextFrame(), third.client.nextFrame()]);
    for (const frame of frames) expect(frame.session).toBe(id);

    // Nobody was pushed off, and the refused socket is sampled nothing.
    await roundTrip(fourth);
    expect(fourth.received()).toEqual([{ t: 'error', code: 'serverFull' }]);
    expect(await counts(running)).toEqual({ sessions: 1, sockets: 4 });
  });
});

describe('the idle sweep', () => {
  it('frees a session half an hour after its last socket left, and not a minute before', async () => {
    const running = await boot();
    const { client, frame } = await join(running);

    const letGo = serverHasLetGo(running);
    await client.close();
    await letGo;
    expect((await counts(running)).sessions).toBe(1);

    running.clock.advance(LIMITS.sessionTtlMs - MINUTE_MS);
    running.app.sweepOnce(running.clock.now());
    expect((await counts(running)).sessions).toBe(1);

    running.clock.advance(2 * MINUTE_MS);
    running.app.sweepOnce(running.clock.now());
    expect((await counts(running)).sessions).toBe(0);

    // The game really is gone: naming it gets the wire signal, then a new one.
    const returning = running.connect();
    await returning.opened();
    returning.send({ ...HELLO, session: frame.session });
    expect(await returning.nextError()).toEqual({ t: 'error', code: 'noSession' });
    expect((await returning.nextFrame()).session).not.toBe(frame.session);
  });

  it('never frees a session somebody is connected to, however late the clock', async () => {
    const running = await boot();
    const { client, frame } = await join(running);

    running.clock.advance(LIMITS.sessionTtlMs * 100);
    running.app.sweepOnce(running.clock.now());
    expect((await counts(running)).sessions).toBe(1);

    running.sample();
    expect((await client.nextFrame()).session).toBe(frame.session);
  });

  it('frees a session nobody ever connected a second socket to, counting from when it was made', async () => {
    const running = await boot();
    const { client } = await join(running);
    const letGo = serverHasLetGo(running);
    await client.close();
    await letGo;

    // A second session is made after the first is already waiting to be swept.
    const later = await join(running);
    running.clock.advance(LIMITS.sessionTtlMs);
    running.app.sweepOnce(running.clock.now());

    expect((await counts(running)).sessions).toBe(1);
    running.sample();
    expect((await later.client.nextFrame()).clock.phase).toBe('lobby');
  });
});

describe('the housekeeping timer', () => {
  it('is made once for the whole service, whatever the number of sessions, and not at all when it is turned off', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const running = await boot();
    const sweepTimers = (): number => spy.mock.calls.filter((call) => call[1] === LIMITS.sweepIntervalMs).length;
    expect(sweepTimers()).toBe(1);

    for (let i = 0; i < 5; i += 1) await join(running);
    expect((await counts(running)).sessions).toBe(5);
    expect(sweepTimers()).toBe(1);

    await running.close();
    harness = null;
    spy.mockClear();

    harness = await startHarness({ sweepMs: 0 });
    expect(spy.mock.calls.filter((call) => call[1] === LIMITS.sweepIntervalMs)).toEqual([]);
  });
});
