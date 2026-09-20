import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAST,
  CONTENT_VERSION,
  ENGINE_VERSION,
  PROTOCOL_VERSION,
  buildMarket,
  frameSchema,
  marketDay,
  sharePriceCents,
} from '@strike-desk/shared/engine';
import type { Frame } from '@strike-desk/shared/engine';
import type { FrameSocket } from '../src/sampler';
import { offerFrame, sampleSessions } from '../src/sampler';
import { drawSessionId } from '../src/seed';
import { createRegistry } from '../src/sessions';
import type { Harness, TestClient } from './harness';
import { FIXED_SEEDS, startHarness } from './harness';

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
const start = (commandId: string, pace = 1) => ({ t: 'start', commandId, pace });

/** Real milliseconds at pace 1 from `start` to the opening bell of day 1. */
const PRE_BELL_MS = 60_000;
const SAMPLE_MS = 200;

let harness: Harness | null = null;

async function boot(overrides: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  harness = await startHarness(overrides);
  return harness;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await harness?.close();
  harness = null;
});

/** Connect, say hello, and take the lobby frame. */
async function join(to: Harness): Promise<{ client: TestClient; lobby: Frame }> {
  const client = to.connect();
  await client.opened();
  client.send(HELLO);
  return { client, lobby: await client.nextFrame() };
}

/** One hand-driven sample, and the frame it produced. */
async function sampleFrame(from: Harness, client: TestClient): Promise<Frame> {
  from.sample();
  return client.nextFrame();
}

function expectThin(frame: Frame): void {
  expect(frame).toMatchObject({ board: null, quotes: [], news: [], positions: [], receipts: [], days: [], stress: false });
  expect(frame.account).toEqual({ cashCents: 100_000_000, worthCents: 100_000_000, capCents: 50_000_000, canBuy: false });
  expect('history' in frame).toBe(false);
  expect('final' in frame).toBe(false);
  expect(frame.prices).toHaveLength(6);
  for (const price of frame.prices) expect(Number.isInteger(price)).toBe(true);
  expect(frameSchema.parse(frame)).toEqual(frame);
}

function pricesAt(seed: number, day: number, priceIndex: number): number[] {
  const market = buildMarket({ seed, engine: ENGINE_VERSION, content: CONTENT_VERSION });
  return marketDay(market, day).paths.map((path) => sharePriceCents(path[priceIndex] ?? NaN));
}

describe('hello and start', () => {
  it('hello gives a lobby frame: six whole-cent prices, everything else empty, the clock stopped', async () => {
    const { lobby } = await join(await boot());
    expectThin(lobby);
    expect(lobby).toMatchObject({ rev: 0, step: 0, clock: { phase: 'lobby', day: 0, stepsLeft: 0, priceIndex: 0, pace: null } });
    expect(lobby.prices).toEqual(CAST.map((company) => sharePriceCents(company.startPrice)));
    expect(lobby.session).toHaveLength(22);
  });

  it('the clock stays stopped until start, however much time passes', async () => {
    const running = await boot();
    const { client, lobby } = await join(running);
    running.clock.advance(10 * 60_000);
    const later = await sampleFrame(running, client);
    expect(later).toEqual(lobby);
  });

  it('start at pace 1 is accepted and answered with its receipt and a thin frame', async () => {
    const running = await boot();
    const { client, lobby } = await join(running);
    client.send(start('start-0001'));
    const reply = await client.nextReply();
    expect(reply.receipt).toEqual({ commandId: 'start-0001', kind: 'start', step: 0, outcome: 'accepted' });
    expectThin(reply.frame);
    expect(reply.frame).toMatchObject({ session: lobby.session, rev: 1, step: 0, clock: { phase: 'preBell', day: 1, pace: 1 } });
  });

  it('a resent start gets the original receipt again and changes nothing; another start is refused', async () => {
    const running = await boot();
    const { client } = await join(running);
    client.send(start('start-0001', 3));
    const first = await client.nextReply();
    running.clock.advance(SAMPLE_MS * 5);
    client.send(start('start-0001', 3));
    const again = await client.nextReply();
    expect(again.receipt).toEqual(first.receipt);
    expect(again.frame.rev).toBe(1);
    expect(again.frame.clock.pace).toBe(3);

    client.send(start('start-0002', 1));
    const refused = await client.nextReply();
    expect(refused.receipt).toMatchObject({ commandId: 'start-0002', outcome: 'rejected', reason: 'alreadyStarted' });
    expect(refused.frame.rev).toBe(2);
    expect(refused.frame.clock.pace).toBe(3);
  });

  it('a start before any hello is answered noSession with its id', async () => {
    const running = await boot();
    const client = running.connect();
    await client.opened();
    client.send(start('start-0001'));
    expect(await client.nextError()).toEqual({ t: 'error', code: 'noSession', commandId: 'start-0001' });
  });
});

describe('the sampler', () => {
  it('ten samples 200 ms apart give ten frames with a rising step and the same rev', async () => {
    const running = await boot();
    const { client } = await join(running);
    client.send(start('start-0001'));
    await client.nextReply();

    const frames: Frame[] = [];
    for (let i = 0; i < 10; i += 1) {
      running.clock.advance(SAMPLE_MS);
      frames.push(await sampleFrame(running, client));
    }
    expect(frames.map((frame) => frame.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(frames.map((frame) => frame.rev)).toEqual(Array.from({ length: 10 }, () => 1));
    frames.forEach(expectThin);
    expect(client.waiting()).toBe(0);
  });

  it('a faster pace covers more steps per sample', async () => {
    const running = await boot();
    const { client } = await join(running);
    client.send(start('start-0001', 7.5));
    await client.nextReply();
    running.clock.advance(SAMPLE_MS * 2);
    expect((await sampleFrame(running, client)).step).toBe(15);
  });

  it('once the bell has opened the market, the six prices are the market\'s own, in whole cents', async () => {
    const running = await boot();
    const { client } = await join(running);
    client.send(start('start-0001'));
    await client.nextReply();
    const seed = FIXED_SEEDS[0] ?? NaN;

    running.clock.advance(PRE_BELL_MS - SAMPLE_MS);
    const stillShut = await sampleFrame(running, client);
    expect(stillShut.clock).toMatchObject({ phase: 'preBell', priceIndex: 0 });
    expect(stillShut.prices).toEqual(pricesAt(seed, 1, 0));

    running.clock.advance(SAMPLE_MS * 2);
    const justOpen = await sampleFrame(running, client);
    expect(justOpen.clock).toMatchObject({ phase: 'open', day: 1, priceIndex: 1 });
    expect(justOpen.prices).toEqual(pricesAt(seed, 1, 1));

    running.clock.advance(SAMPLE_MS * 99);
    const later = await sampleFrame(running, client);
    expect(later.clock).toMatchObject({ phase: 'open', day: 1, priceIndex: 100 });
    expect(later.step).toBe(400);
    expect(later.prices).toEqual(pricesAt(seed, 1, 100));
    expect(later.prices).not.toEqual(justOpen.prices);
    expect(later.rev).toBe(1);
    expectThin(later);
  });

  it('stays thin through the debrief, across a day boundary and on the final screen, and the step never resets', async () => {
    const running = await boot();
    const { client } = await join(running);
    client.send(start('start-0001', 7.5));
    await client.nextReply();
    const seed = FIXED_SEEDS[0] ?? NaN;
    // At this pace a step is 200 / 7.5 ms: 22 s, 34 s and 130 s after the start
    // land on step 825, step 1275 and past the end of the game.
    const seen: Frame[] = [];
    for (const advanceMs of [22_000, 12_000, 96_000]) {
      running.clock.advance(advanceMs);
      seen.push(await sampleFrame(running, client));
    }
    seen.forEach(expectThin);
    expect(seen.map((frame) => frame.step)).toEqual([825, 1275, 4500]);
    expect(seen.map((frame) => frame.clock.phase)).toEqual(['debrief', 'open', 'final']);
    expect(seen[1]?.clock).toMatchObject({ day: 2, priceIndex: 75 });
    expect(seen[1]?.prices).toEqual(pricesAt(seed, 2, 75));
    expect(seen[2]?.prices).toEqual(pricesAt(seed, 5, 500));
    expect(seen.map((frame) => frame.rev)).toEqual([1, 1, 1]);
  });

  it('two hellos are two sessions with two markets', async () => {
    const running = await boot();
    const one = await join(running);
    const two = await join(running);
    expect(one.lobby.session).not.toBe(two.lobby.session);

    one.client.send(start('start-0001'));
    two.client.send(start('start-0002'));
    await one.client.nextReply();
    await two.client.nextReply();
    running.clock.advance(PRE_BELL_MS + SAMPLE_MS * 100);
    running.sample();
    const first = await one.client.nextFrame();
    const second = await two.client.nextFrame();
    expect(first.prices).toEqual(pricesAt(FIXED_SEEDS[0] ?? NaN, 1, 100));
    expect(second.prices).toEqual(pricesAt(FIXED_SEEDS[1] ?? NaN, 1, 100));
    expect(first.prices).not.toEqual(second.prices);
  });

  it('runs on one timer however many games are going', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const running = await boot();
    const before = spy.mock.calls.length;
    for (let i = 0; i < 3; i += 1) {
      const { client } = await join(running);
      client.send(start(`start-000${i}`));
      await client.nextReply();
    }
    running.clock.advance(SAMPLE_MS);
    running.sample();
    expect(spy.mock.calls.length).toBe(before);
  });

  it('the sampling timer is one more interval, and none when it is switched off', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const off = await startHarness();
    const withoutSampler = spy.mock.calls.length;
    await off.close();
    spy.mockClear();

    const on = await boot({ sampleMs: 250 });
    expect(spy.mock.calls.length).toBe(withoutSampler + 1);
    expect(spy.mock.calls.filter(([, delay]) => delay === 250)).toHaveLength(1);
    expect(() => on.app.sampleOnce(0)).not.toThrow();
  });

  it('the timer drives the same sampling pass', async () => {
    // A clock that moves one sample forward every time it is read, so the
    // frames do not depend on how fast this machine is. The test awaits
    // messages, never a duration.
    let nowMs = 0;
    const running = await boot({ sampleMs: 5, now: () => (nowMs += SAMPLE_MS) });
    const { client } = await join(running);
    client.send(start('start-0001'));
    // The timer may have sent lobby frames already; the reply comes after them.
    let message = await client.next();
    while (message.t !== 'reply') message = await client.next();
    const steps = [message.frame.step];
    for (let i = 0; i < 3; i += 1) steps.push((await client.nextFrame()).step);
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]).toBeGreaterThan(steps[i - 1] ?? NaN);
  });
});

describe('offerFrame and sampleSessions', () => {
  function fakeSocket(fields: { open?: boolean; bufferedAmount?: number } = {}): FrameSocket & { sent: string[] } {
    const sent: string[] = [];
    return {
      OPEN: 1,
      readyState: fields.open === false ? 3 : 1,
      bufferedAmount: fields.bufferedAmount ?? 0,
      sent,
      send(text: string) {
        sent.push(text);
      },
    };
  }

  it('sends to an open socket with nothing waiting', () => {
    const socket = fakeSocket();
    expect(offerFrame(socket, 'frame-text')).toBe('sent');
    expect(socket.sent).toEqual(['frame-text']);
  });

  it('skips a socket that still has bytes waiting, and queues nothing', () => {
    const socket = fakeSocket({ bufferedAmount: 1 });
    expect(offerFrame(socket, 'frame-text')).toBe('skipped');
    expect(socket.sent).toEqual([]);
  });

  it('leaves a socket that is not open alone', () => {
    const socket = fakeSocket({ open: false });
    expect(offerFrame(socket, 'frame-text')).toBe('closed');
    expect(socket.sent).toEqual([]);
  });

  it('one pass: one frame text per session, offered to each of its sockets, counted', () => {
    const registry = createRegistry({ drawSeed: () => 77, drawId: drawSessionId });
    const entry = registry.create();
    const idle = registry.create();
    const ready = fakeSocket();
    const alsoReady = fakeSocket();
    const backedUp = fakeSocket({ bufferedAmount: 4096 });
    const gone = fakeSocket({ open: false });
    for (const socket of [ready, alsoReady, backedUp, gone]) registry.attach(entry.session.id, socket);

    const stats = { sent: 0, skipped: 0 };
    sampleSessions(registry, 5_000, stats);
    expect(stats).toEqual({ sent: 2, skipped: 1 });
    expect(ready.sent).toHaveLength(1);
    expect(alsoReady.sent).toEqual(ready.sent);
    expect(backedUp.sent).toEqual([]);
    expect(gone.sent).toEqual([]);
    const frame = frameSchema.parse(JSON.parse(ready.sent[0] ?? ''));
    expect(frame.session).toBe(entry.session.id);
    expect(frame.session).not.toBe(idle.session.id);
    expectThin(frame);

    sampleSessions(registry, 5_200, stats);
    expect(stats).toEqual({ sent: 4, skipped: 2 });
  });
});

describe('commands this service does not take yet', () => {
  const REFUSED = [
    { t: 'buy', commandId: 'refused-buy', day: 1, contractId: 3, spendCents: 1_000_000, seenPriceCents: 5_000 },
    { t: 'cashOut', commandId: 'refused-cashOut', positionId: 'd1' },
    { t: 'openBell', commandId: 'refused-openBell', day: 1 },
    { t: 'skipToBell', commandId: 'refused-skipToBell', day: 1 },
    { t: 'nextDay', commandId: 'refused-nextDay', day: 1 },
  ];

  it.each(REFUSED)('$t is answered badMessage with its id and changes nothing', async (command) => {
    const running = await boot();
    const { client } = await join(running);
    client.send(start('start-0001'));
    await client.nextReply();
    // Inside the open market, where a buy or a skip would otherwise be taken.
    running.clock.advance(PRE_BELL_MS + SAMPLE_MS * 10);
    const before = await sampleFrame(running, client);

    client.send(command);
    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage', commandId: command.commandId });

    const after = await sampleFrame(running, client);
    expect(after).toEqual(before);
  });

  it('openBell before the bell does not open the market', async () => {
    const running = await boot();
    const { client } = await join(running);
    client.send(start('start-0001'));
    await client.nextReply();
    client.send({ t: 'openBell', commandId: 'refused-openBell', day: 1 });
    await client.nextError();
    running.clock.advance(SAMPLE_MS);
    expect(await sampleFrame(running, client)).toMatchObject({ rev: 1, step: 1, clock: { phase: 'preBell' } });
  });
});

describe('bad input at the door', () => {
  const BAD_TEXTS: [string, string][] = [
    ['text that is not JSON', '{'],
    ['an empty string', ''],
    ['null', 'null'],
    ['an array', '[]'],
    ['an unknown kind', '{"t":"nope"}'],
    ['a hello that tries to pick the seed', JSON.stringify({ ...HELLO, seed: 77 })],
    ['a start with a pace that does not exist', JSON.stringify(start('start-0001', 2))],
  ];

  it.each(BAD_TEXTS)('%s is answered badMessage and the socket stays usable', async (_name, text) => {
    const running = await boot();
    const client = running.connect();
    await client.opened();
    client.sendText(text);
    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    client.send(HELLO);
    expect((await client.nextFrame()).clock.phase).toBe('lobby');
  });

  it('a message over the size limit closes that socket only', async () => {
    const running = await boot();
    const { client: bystander } = await join(running);
    const client = running.connect();
    await client.opened();
    client.sendText('x'.repeat(5000));
    expect(await client.closed()).toBe(1009);
    expect((await sampleFrame(running, bystander)).clock.phase).toBe('lobby');
  });
});

describe('the session registry', () => {
  it('makes a session only when asked, and remembers when its last socket left', () => {
    const registry = createRegistry({ drawSeed: () => 4242424242, drawId: drawSessionId });
    expect(registry.size).toBe(0);
    const entry = registry.create();
    expect(registry.size).toBe(1);
    expect(entry.session.market.identity).toEqual({ seed: 4242424242, engine: ENGINE_VERSION, content: CONTENT_VERSION });
    expect(entry.session.clock).toBeNull();
    expect(registry.get(entry.session.id)).toBe(entry);
    expect(registry.get('someone-else')).toBeUndefined();

    const socket = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: () => undefined };
    expect(registry.attach('someone-else', socket)).toBe(false);
    expect(registry.attach(entry.session.id, socket)).toBe(true);
    expect(entry.sockets.size).toBe(1);
    expect(entry.lastSocketClosedMs).toBeNull();
    registry.detach(entry.session.id, socket, 9_000);
    expect(entry.sockets.size).toBe(0);
    expect(entry.lastSocketClosedMs).toBe(9_000);
    expect([...registry.entries()]).toEqual([entry]);
  });

  it('a session with no socket is not sampled', () => {
    const registry = createRegistry({ drawSeed: () => 77, drawId: drawSessionId });
    const entry = registry.create();
    const before = entry.session;
    const stats = { sent: 0, skipped: 0 };
    sampleSessions(registry, 1_000, stats);
    expect(stats).toEqual({ sent: 0, skipped: 0 });
    expect(entry.session).toBe(before);
  });
});
