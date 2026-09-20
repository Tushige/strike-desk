import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@strike-desk/shared/engine';
import { LIMITS, createTokenBucket, createWindowCounter } from '../src/limits';
import type { Harness, TestClient } from './harness';
import { FIXED_SEEDS, startHarness } from './harness';

/**
 * How fast the service will take on work. Two separate guards: one bucket for
 * the whole service, spent only when a hello is about to build a new market,
 * and one counter per socket, spent by every message that arrives on it.
 * Both take the time as an argument, so nothing here waits for a duration:
 * the time simply moves when the test says it does.
 */

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
const start = (commandId: string, pace = 1) => ({ t: 'start', commandId, pace });
const SECOND_MS = 1000;

describe('the token bucket', () => {
  it('holds a burst, refills at its rate, and never holds more than the burst however long it rests', () => {
    const bucket = createTokenBucket(LIMITS.newSessionBurst, LIMITS.newSessionRefillPerSecond);

    let taken = 0;
    for (let i = 0; i < LIMITS.newSessionBurst; i += 1) if (bucket.take(0)) taken += 1;
    expect(taken).toBe(30);
    expect(bucket.take(0)).toBe(false);

    // One second later: exactly the refill rate, and not one more.
    expect([bucket.take(SECOND_MS), bucket.take(SECOND_MS), bucket.take(SECOND_MS)]).toEqual([true, true, true]);
    expect(bucket.take(SECOND_MS)).toBe(false);

    // An hour of quiet does not bank an hour of tokens.
    let afterResting = 0;
    for (let i = 0; i < 100; i += 1) if (bucket.take(3_600_000)) afterResting += 1;
    expect(afterResting).toBe(LIMITS.newSessionBurst);
  });

  it('refills by parts of a second too, and reads no clock of its own', () => {
    const bucket = createTokenBucket(2, 4);
    expect([bucket.take(0), bucket.take(0), bucket.take(0)]).toEqual([true, true, false]);
    // A quarter of a second at four a second is exactly one token.
    expect(bucket.take(249)).toBe(false);
    expect(bucket.take(250)).toBe(true);
    expect(bucket.take(250)).toBe(false);
  });
});

describe('the window counter', () => {
  it('lets the limit through, refuses the next, and opens again once the window has passed', () => {
    const counter = createWindowCounter(LIMITS.messagesPerWindow, LIMITS.messageWindowMs);

    let allowed = 0;
    for (let i = 0; i < LIMITS.messagesPerWindow; i += 1) if (counter.hit(i)) allowed += 1;
    expect(allowed).toBe(20);

    expect(counter.hit(20)).toBe(false);
    // Still inside the window that opened at the first hit.
    expect(counter.hit(LIMITS.messageWindowMs - 1)).toBe(false);
    expect(counter.hit(LIMITS.messageWindowMs + 1)).toBe(true);

    // And the fresh window is a whole one.
    let afterwards = 1;
    for (let i = 0; i < LIMITS.messagesPerWindow; i += 1) if (counter.hit(LIMITS.messageWindowMs + 1)) afterwards += 1;
    expect(afterwards).toBe(LIMITS.messagesPerWindow);
  });
});

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
  await harness?.close();
  harness = null;
});

async function open(running: Harness): Promise<TestClient> {
  const client = running.connect();
  await client.opened();
  return client;
}

function roundTrip(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    client.socket.once('pong', () => resolve());
    client.socket.ping();
  });
}

describe('how fast new games may be made', () => {
  it('a hello past the budget is answered serverFull and builds nothing, and a second later one may be built again', async () => {
    const running = await boot({ limits: { newSessionBurst: 2 } });

    for (let i = 0; i < 2; i += 1) {
      const client = await open(running);
      client.send(HELLO);
      expect((await client.nextFrame()).clock.phase).toBe('lobby');
    }
    expect(sessionsMade).toBe(2);

    const refused = await open(running);
    refused.send(HELLO);
    expect(await refused.nextError()).toEqual({ t: 'error', code: 'serverFull' });
    await roundTrip(refused);
    expect(refused.received()).toEqual([{ t: 'error', code: 'serverFull' }]);
    expect(sessionsMade).toBe(2);

    running.clock.advance(SECOND_MS);
    const later = await open(running);
    later.send(HELLO);
    expect((await later.nextFrame()).clock.phase).toBe('lobby');
    expect(sessionsMade).toBe(3);
  });

  it('rejoining a game is never counted against the budget', async () => {
    const running = await boot({ limits: { newSessionBurst: 1 } });
    const first = await open(running);
    first.send(HELLO);
    const lobby = await first.nextFrame();
    expect(sessionsMade).toBe(1);

    // The budget is spent, yet a second tab on the same game still gets in.
    const rejoining = await open(running);
    rejoining.send({ ...HELLO, session: lobby.session });
    expect((await rejoining.nextFrame()).session).toBe(lobby.session);
    expect(sessionsMade).toBe(1);

    const wantingANewOne = await open(running);
    wantingANewOne.send(HELLO);
    expect(await wantingANewOne.nextError()).toEqual({ t: 'error', code: 'serverFull' });
    expect(sessionsMade).toBe(1);
  });
});

describe('how many messages one socket may send', () => {
  it('the message past the limit is answered tooManyCommands and is never acted on, and the window opens again', async () => {
    const running = await boot();
    const client = await open(running);

    client.send(HELLO);
    expect((await client.nextFrame()).clock.phase).toBe('lobby');
    for (let i = 1; i < LIMITS.messagesPerWindow; i += 1) {
      client.sendText(`{"t":"nope","n":${i}}`);
      expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    }

    // The twenty-first message is a perfectly good start command, and it is
    // refused before anything reads it: the game does not begin.
    client.send(start('start-0001'));
    expect(await client.nextError()).toEqual({ t: 'error', code: 'tooManyCommands' });
    await roundTrip(client);
    running.sample();
    expect((await client.nextFrame()).clock.phase).toBe('lobby');

    // Another socket is untouched by this one's counter.
    const other = await open(running);
    other.send(HELLO);
    expect((await other.nextFrame()).clock.phase).toBe('lobby');

    // Once the window has passed, the same socket is heard again.
    running.clock.advance(LIMITS.messageWindowMs + 1);
    client.send(start('start-0002'));
    const reply = await client.nextReply();
    expect(reply.receipt).toMatchObject({ commandId: 'start-0002', outcome: 'accepted' });
  });
});
