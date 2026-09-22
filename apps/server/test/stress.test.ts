import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTENT_VERSION,
  ENGINE_VERSION,
  FIRST_PLAYER_ID,
  HEALTH_PATH,
  PROTOCOL_VERSION,
  applyCommand,
  contractId,
  createSession,
  frameFor,
  handleCommand,
  isNewerFrame,
  parseServerMessage,
  quotesMessageSchema,
} from '@strike-desk/shared/engine';
import type { Frame, FrameOrder, QuotesMessage, ServerMessage } from '@strike-desk/shared/engine';
import type { Harness, TestClient } from './harness';
import { FIXED_SEEDS, startHarness } from './harness';

/**
 * The stress board size, over a real connection to the real server: which
 * sizes are granted, what a granted one changes, and what a refused one
 * leaves behind.
 *
 * Every size assertion is made on a frame taken after an accepted `start`: a
 * lobby frame carries no board and no ticket prices whatever the size, so the
 * size only shows once the game is running.
 */

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
const start = (commandId: string, pace = 1) => ({ t: 'start', commandId, pace });
const SAMPLE_MS = 200;
/** Far enough past `start` at pace 1 to be well inside the open market, where prices move. */
const OPEN_AT_MS = 70_000;

/** The two sizes a public instance grants, and what each is in targets a company. */
const DEFAULT_CONTRACTS = 252;
const STRESS_SIZE = 2500;
const STRESS_TARGETS = 209;
const STRESS_CONTRACTS = 2508;

let harness: Harness | null = null;
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

/** Say hello (with a board size, or without) and take the frame that answers it. */
async function join(running: Harness, hello: Record<string, unknown> = {}): Promise<{ client: TestClient; lobby: Frame }> {
  const client = await open(running);
  client.send({ ...HELLO, ...hello });
  return { client, lobby: await client.nextFrame() };
}

/** The frame of a started game: hello, then start, then the reply's frame. */
async function play(running: Harness, hello: Record<string, unknown> = {}): Promise<{ client: TestClient; lobby: Frame; frame: Frame }> {
  const { client, lobby } = await join(running, hello);
  client.send(start('start-0001'));
  const reply = await client.nextReply();
  expect(reply.receipt.outcome).toBe('accepted');
  return { client, lobby, frame: reply.frame };
}

/** The number of live sessions the service admits to, read the way the owner would. */
async function sessionCount(running: Harness): Promise<number> {
  const response = await fetch(`${running.baseUrl}${HEALTH_PATH}`);
  const body = (await response.json()) as { sessions: number };
  return body.sessions;
}

function roundTrip(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    client.socket.once('pong', () => resolve());
    client.socket.ping();
  });
}

const isFrame = (message: ServerMessage): message is Frame => message.t === 'frame';
const isBatch = (message: ServerMessage): message is QuotesMessage => message.t === 'quotes';

/**
 * Everything this client is sent from now on, read after the fact rather than
 * awaited one message at a time: a sampling pass that sends nothing at all is
 * one of the things being asserted, and awaiting a message per pass could only
 * ever hang on it.
 */
function fromHere(client: TestClient): () => ServerMessage[] {
  const already = client.received().length;
  return () =>
    client
      .received()
      .slice(already)
      .flatMap((raw) => {
        const message = parseServerMessage(raw);
        return message === null ? [] : [message];
      });
}

type QuoteArrays = Pick<Frame, 'quotes' | 'quoteReals' | 'quoteHopes' | 'quoteBreakEvens'>;

const arraysOf = (frame: Frame): QuoteArrays => ({
  quotes: [...frame.quotes],
  quoteReals: [...frame.quoteReals],
  quoteHopes: [...frame.quoteHopes],
  quoteBreakEvens: [...frame.quoteBreakEvens],
});

/**
 * What a page holds after a starting frame and everything that followed it:
 * a whole picture replaces the four arrays, a batch merges into them, and
 * anything else is not about ticket prices.
 */
function replay(from: Frame, stream: readonly ServerMessage[]): QuoteArrays {
  let held = arraysOf(from);
  for (const message of stream) {
    if (isFrame(message)) {
      held = arraysOf(message);
      continue;
    }
    if (!isBatch(message)) continue;
    for (const [id, priceCents, realCents, hopeCents, breakEvenCents] of message.changes) {
      held.quotes[id] = priceCents;
      held.quoteReals[id] = realCents;
      held.quoteHopes[id] = hopeCents;
      held.quoteBreakEvens[id] = breakEvenCents;
    }
  }
  return held;
}

describe('a granted board size', () => {
  it('builds the same board with finer spacing: 209 targets a company and 2508 ticket prices', async () => {
    const running = await boot();
    const { frame } = await play(running, { board: STRESS_SIZE });

    expect(frame.board?.targetsPerCompany).toBe(STRESS_TARGETS);
    expect(frame.board?.companies).toHaveLength(6);
    expect(frame.quotes).toHaveLength(STRESS_CONTRACTS);
    expect(frame.stress).toBe(true);
  });

  it('leaves an ordinary hello at the ordinary size', async () => {
    const running = await boot();
    const { frame } = await play(running);

    expect(frame.board?.targetsPerCompany).toBe(21);
    expect(frame.quotes).toHaveLength(DEFAULT_CONTRACTS);
    expect(frame.stress).toBe(false);
  });

  it('still answers the hello itself with a lobby frame that has no board and no ticket prices', async () => {
    const running = await boot();
    const { lobby } = await join(running, { board: STRESS_SIZE });

    expect(lobby).toMatchObject({ clock: { phase: 'lobby' }, board: null, quotes: [], stress: true });
  });

  it('keeps repricing: the message a sampling pass later moves at least one ticket', async () => {
    const running = await boot();
    const { client } = await play(running, { board: STRESS_SIZE });

    // Past the opening bell, where the prices actually move: before it every
    // frame shows the opening price, whatever the board size.
    running.clock.advance(OPEN_AT_MS);
    running.sample();
    const first = await client.nextFrame();
    expect(first.clock.phase).toBe('open');
    expect(first.quotes).toHaveLength(STRESS_CONTRACTS);

    running.clock.advance(SAMPLE_MS);
    running.sample();
    // With the switch on, what follows the whole picture is a batch of the
    // tickets that changed, not another whole picture.
    const later = await client.next();
    if (!isBatch(later)) throw new Error(`expected a batch, got a ${later.t}`);

    expect(later.step).toBeGreaterThan(first.step);
    expect(later.changes.length).toBeGreaterThan(0);
    expect(later.changes.some(([id, priceCents]) => priceCents !== first.quotes[id])).toBe(true);
  });
});

describe('a board size the service will not grant', () => {
  it('is answered badMessage and makes no session', async () => {
    const running = await boot();
    const before = await sessionCount(running);
    const client = await open(running);
    client.send({ ...HELLO, board: 999_999 });

    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    await roundTrip(client);
    expect(client.received()).toHaveLength(1);
    expect(sessionsMade).toBe(0);
    expect(await sessionCount(running)).toBe(before);
  });

  it('is refused for a size that is not on the list even when it is small', async () => {
    const running = await boot();
    const client = await open(running);
    client.send({ ...HELLO, board: 2508 });

    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    expect(sessionsMade).toBe(0);
  });
});

describe('how many stress sessions the service will hold', () => {
  it('refuses the next one serverFull and disturbs nobody already playing', async () => {
    const running = await boot({ limits: { maxStressSessions: 1 } });
    const { client: playing, frame } = await play(running, { board: STRESS_SIZE });
    expect(frame.stress).toBe(true);

    const second = await open(running);
    second.send({ ...HELLO, board: STRESS_SIZE });
    expect(await second.nextError()).toEqual({ t: 'error', code: 'serverFull' });
    await roundTrip(second);
    expect(second.received()).toHaveLength(1);

    // An ordinary game is never refused because of a stress one.
    const { lobby } = await join(running);
    expect(lobby.stress).toBe(false);

    // And the game already running is untouched.
    running.clock.advance(SAMPLE_MS);
    running.sample();
    const sampled = await playing.nextFrame();
    expect(sampled.session).toBe(frame.session);
    expect(sampled.stress).toBe(true);
  });
});

describe('how large a board the instance will build', () => {
  it('refuses the largest listed size on an instance left at the public maximum', async () => {
    const running = await boot();
    const client = await open(running);
    client.send({ ...HELLO, board: 25_000 });

    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    expect(sessionsMade).toBe(0);
  });

  it('grants it on an instance started for it', async () => {
    const running = await boot({ maxBoardSize: 25_000 });
    const { frame } = await play(running, { board: 25_000 });

    expect(frame.board?.targetsPerCompany).toBe(2084);
    expect(frame.quotes).toHaveLength(25_008);
    expect(frame.stress).toBe(true);
  });
});

describe('a stress session can never buy', () => {
  /** A session of the given size, started at pace 1, so a step is 200 ms from the start. */
  function started(targetsPerCompany?: number): ReturnType<typeof createSession> {
    const identity = { seed: FIXED_SEEDS[0] ?? 0, engine: ENGINE_VERSION, content: CONTENT_VERSION };
    const fresh = createSession('s-rule', identity, { targetsPerCompany });
    const handled = handleCommand(fresh, FIRST_PLAYER_ID, { t: 'start', commandId: 'start-0001', pace: 1 }, 0);
    expect(handled.receipt.outcome).toBe('accepted');
    return handled.session;
  }

  /** A step in day 1's open market, and the wall-clock reading it falls on at pace 1. */
  const OPEN_STEP = 400;
  const OPEN_AT = OPEN_STEP * 200;

  it('is refused at the rule, not only at the door', () => {
    const session = started(STRESS_TARGETS);
    const buy = {
      t: 'buy',
      commandId: 'buy-000001',
      day: 1,
      contractId: contractId(STRESS_TARGETS, { companyId: 0, targetIndex: 125, side: 'up' }),
      spendCents: 1_000_000,
      seenPriceCents: 1000,
    } as const;

    const result = applyCommand(session.market, session.game, FIRST_PLAYER_ID, buy, OPEN_STEP);

    expect(result.receipt).toMatchObject({ commandId: 'buy-000001', outcome: 'rejected', reason: 'stressMode' });
  });

  it('reports that buying is not available, where an ordinary open market reports that it is', () => {
    // Ordinary permission is enabled; the stress setting remains read-only.
    const sections = { history: false, sections: 'full' } as const;
    const stressed = frameFor(started(STRESS_TARGETS), FIRST_PLAYER_ID, OPEN_AT, sections).frame;
    const ordinary = frameFor(started(), FIRST_PLAYER_ID, OPEN_AT, sections).frame;

    expect(stressed.clock.phase).toBe('open');
    expect(stressed.stress).toBe(true);
    expect(stressed.account.canBuy).toBe(false);

    expect(ordinary.clock.phase).toBe('open');
    expect(ordinary.stress).toBe(false);
    expect(ordinary.account.canBuy).toBe(true);
  });

  it('returns the stress refusal through the real door without charging cash', async () => {
    const running = await boot();
    const { client } = await play(running, { board: STRESS_SIZE });
    client.send({ t: 'buy', commandId: 'buy-000001', day: 1, contractId: 0, spendCents: 1000, seenPriceCents: 1000 });

    const reply = await client.nextReply();
    expect(reply.receipt).toMatchObject({ kind: 'buy', commandId: 'buy-000001', outcome: 'rejected', reason: 'stressMode' });
    expect(reply.frame.account).toMatchObject({ cashCents: 100000000, canBuy: false });
    expect(reply.frame.positions).toEqual([]);
    expect(reply.frame.receipts).toContainEqual(reply.receipt);
  });
});

/**
 * With the switch on the whole picture is too big to send five times a second,
 * so only the tickets that changed go out, with one whole picture every
 * `stressFullFrameMs` as the way back into step. Everything below is driven
 * over a real socket with the injected clock.
 */
describe('what a switched-on session is sent', () => {
  /** Five sampling passes' worth, so a whole picture is due on every fifth pass. */
  const FULL_FRAME_MS = SAMPLE_MS * 5;
  const CADENCE = { limits: { stressFullFrameMs: FULL_FRAME_MS } };

  it('sends the whole picture first, then only the tickets that changed', async () => {
    const running = await boot(CADENCE);
    const { client } = await play(running, { board: STRESS_SIZE });
    running.clock.advance(OPEN_AT_MS);
    const since = fromHere(client);

    // Nothing has been sampled on this session yet, so there is nothing to
    // send a difference against: the first sampled message is the whole one.
    running.sample();
    running.clock.advance(SAMPLE_MS);
    running.sample();
    await roundTrip(client);

    const stream = since();
    expect(stream.map((message) => message.t)).toEqual(['frame', 'quotes']);
    const batch = stream[1];
    if (batch === undefined || !isBatch(batch)) throw new Error('the second message was not a batch');
    expect(batch.changes.length).toBeGreaterThan(0);
    expect(batch.changes.length).toBeLessThan(STRESS_CONTRACTS);
    expect(batch.changes.every((change) => change.length === 5)).toBe(true);
    expect(batch).toMatchObject({ session: stream[0]?.t === 'frame' ? stream[0].session : '', day: 1 });
  });

  it('sends the whole picture once every stressFullFrameMs and changed quotes in between', async () => {
    const running = await boot(CADENCE);
    const { client } = await play(running, { board: STRESS_SIZE });
    running.clock.advance(OPEN_AT_MS);
    running.sample();
    // The priming whole picture has to have arrived before the window opens:
    // a pass sends on the server before the client is told.
    await roundTrip(client);
    const since = fromHere(client);

    for (let pass = 0; pass < 10; pass += 1) {
      running.clock.advance(SAMPLE_MS);
      running.sample();
      // Let the socket drain between simulated ticks; synchronous bursts exercise backpressure instead.
      await roundTrip(client);
    }
    await roundTrip(client);

    expect(since().map((message) => message.t)).toEqual([
      'quotes',
      'quotes',
      'quotes',
      'quotes',
      'frame',
      'quotes',
      'quotes',
      'quotes',
      'quotes',
      'frame',
    ]);
  });

  it('replaying every batch onto the whole picture before them gives the whole picture of that same moment', async () => {
    // Two instances of the same game on the same market, sampled at the same
    // moments: one sends the whole picture only when it must, the other sends
    // it on every pass. What the batches leave a page holding has to be what
    // the whole picture of that moment says, ticket for ticket.
    //
    // The comparison is against a whole picture of the *same* moment, not
    // against the next periodic one: the next one is a pass later and carries
    // that pass's own movement, which no batch before it could have said.
    const seed = () => FIXED_SEEDS[0] ?? 0;
    const batched = await startHarness({ drawSeed: seed, limits: { stressFullFrameMs: 1_000_000 } });
    const every = await startHarness({ drawSeed: seed, limits: { stressFullFrameMs: 0 } });

    try {
      const one = await play(batched, { board: STRESS_SIZE });
      const two = await play(every, { board: STRESS_SIZE });
      for (const run of [batched, every]) run.clock.advance(OPEN_AT_MS);
      const sinceBatched = fromHere(one.client);
      const sinceEvery = fromHere(two.client);

      for (let pass = 0; pass < 8; pass += 1) {
        for (const run of [batched, every]) {
          run.sample();
          run.clock.advance(SAMPLE_MS);
        }
        await roundTrip(one.client);
        await roundTrip(two.client);
      }
      await roundTrip(one.client);
      await roundTrip(two.client);

      const stream = sinceBatched();
      const wholePictures = sinceEvery();
      expect(stream.map((message) => message.t)).toEqual(['frame', ...Array.from({ length: 7 }, () => 'quotes')]);
      expect(wholePictures.map((message) => message.t)).toEqual(Array.from({ length: 8 }, () => 'frame'));

      const [first] = stream;
      const last = wholePictures[wholePictures.length - 1];
      if (first === undefined || !isFrame(first) || last === undefined || !isFrame(last)) throw new Error('the two runs did not line up');
      expect(first.quotes).toEqual(wholePictures[0] !== undefined && isFrame(wholePictures[0]) ? wholePictures[0].quotes : []);

      expect(replay(first, stream.filter(isBatch))).toEqual({
        quotes: last.quotes,
        quoteReals: last.quoteReals,
        quoteHopes: last.quoteHopes,
        quoteBreakEvens: last.quoteBreakEvens,
      });
      expect(last.quotes).toHaveLength(STRESS_CONTRACTS);
      expect(last.step).toBeGreaterThan(first.step);
    } finally {
      await batched.close();
      await every.close();
    }
  });

  it('leaves an ordinary game on whole pictures only', async () => {
    const running = await boot(CADENCE);
    const { client } = await play(running);
    running.clock.advance(OPEN_AT_MS);
    const since = fromHere(client);

    for (let pass = 0; pass < 10; pass += 1) {
      running.clock.advance(SAMPLE_MS);
      running.sample();
      // Let the socket drain between simulated ticks; synchronous bursts exercise backpressure instead.
      await roundTrip(client);
    }
    await roundTrip(client);

    const stream = since();
    expect(stream).toHaveLength(10);
    expect(stream.filter(isBatch)).toEqual([]);
    expect(stream.every(isFrame)).toBe(true);
  });

  it('sends no batch at all before the game has started', async () => {
    const running = await boot(CADENCE);
    const { client } = await join(running, { board: STRESS_SIZE });
    const since = fromHere(client);

    for (let pass = 0; pass < 10; pass += 1) {
      running.clock.advance(SAMPLE_MS);
      running.sample();
      // Let the socket drain between simulated ticks; synchronous bursts exercise backpressure instead.
      await roundTrip(client);
    }
    await roundTrip(client);

    const stream = since();
    // Asserted by name, not as a side effect of the lobby's empty quote list:
    // a lobby frame's day is 0 and a batch's day is bounded 1 to 5, so a batch
    // here would be a message this service's own wire contract refuses.
    expect(stream.filter(isBatch)).toEqual([]);
    expect(stream).toHaveLength(10);
    expect(stream.every((message) => isFrame(message) && message.clock.day === 0)).toBe(true);
  });

  it('every batch it sends parses the wire contract, across a day boundary', async () => {
    // A whole second between passes and a five-second cadence, so one run
    // reaches day 2 without thousands of contracts being priced hundreds of
    // times over.
    const everyMs = 1000;
    const running = await boot({ limits: { stressFullFrameMs: everyMs * 5 } });
    const { client } = await join(running, { board: STRESS_SIZE });
    client.send(start('start-0001', 7.5));
    await client.nextReply();
    const since = fromHere(client);

    for (let pass = 0; pass < 32; pass += 1) {
      running.clock.advance(everyMs);
      running.sample();
      // Let the socket drain between simulated ticks; synchronous bursts exercise backpressure instead.
      await roundTrip(client);
    }
    await roundTrip(client);

    const stream = since();
    expect(new Set(stream.filter(isFrame).map((frame) => frame.clock.day))).toEqual(new Set([1, 2]));
    const batches = stream.filter(isBatch);
    expect(batches.length).toBeGreaterThan(0);
    for (const message of batches) expect(quotesMessageSchema.parse(message)).toEqual(message);
  });

  it('sends nothing at all when no ticket moved and no whole picture is due', async () => {
    const running = await boot(CADENCE);
    const { client } = await play(running, { board: STRESS_SIZE });
    // Before the opening bell every frame shows the day's opening price, so
    // nothing moves from one pass to the next.
    running.clock.advance(SAMPLE_MS);
    running.sample();
    await roundTrip(client);
    const since = fromHere(client);

    running.clock.advance(SAMPLE_MS);
    running.sample();
    running.clock.advance(SAMPLE_MS);
    running.sample();
    await roundTrip(client);

    expect(since()).toEqual([]);
  });
});

/**
 * A batch is not the whole picture, so everything the brief never lets a
 * client miss has to be carried by a whole frame instead. Each rule here is
 * one condition in the sampler, pinned over a real socket.
 */
describe('what a batch is never allowed to carry on its own', () => {
  /** Long enough that nothing below sends a whole frame for the cadence alone: every one is a trigger. */
  const TRIGGERS_ONLY = { limits: { stressFullFrameMs: 1_000_000 } };
  /** A second of wall clock at pace 7.5 is 37.5 logical steps, so one run reaches day 2 in 40 passes. */
  const FAST_PASS_MS = 1000;

  /** The session, revision and step of a message of either shape. */
  const orderOf = (message: Frame | QuotesMessage): FrameOrder => ({ session: message.session, rev: message.rev, step: message.step });
  const dayOf = (message: Frame | QuotesMessage): number => (isFrame(message) ? message.clock.day : message.day);
  const ordered = (stream: readonly ServerMessage[]): (Frame | QuotesMessage)[] => stream.flatMap((message) => (isFrame(message) || isBatch(message) ? [message] : []));

  it('brings the whole picture on a new day, before any batch of that day', async () => {
    const running = await boot(TRIGGERS_ONLY);
    const { client } = await join(running, { board: STRESS_SIZE });
    client.send(start('start-0001', 7.5));
    await client.nextReply();
    const since = fromHere(client);

    for (let pass = 0; pass < 40; pass += 1) {
      running.clock.advance(FAST_PASS_MS);
      running.sample();
      // Let the socket drain between simulated ticks; synchronous bursts exercise backpressure instead.
      await roundTrip(client);
    }
    await roundTrip(client);

    const stream = ordered(since());
    const firstOfDayTwo = stream.findIndex((message) => dayOf(message) === 2);
    expect(firstOfDayTwo).toBeGreaterThanOrEqual(0);
    expect(stream[firstOfDayTwo]?.t).toBe('frame');
    // And the batches that follow belong to the new day, not the old one.
    const after = stream.slice(firstOfDayTwo + 1).filter(isBatch);
    expect(after.length).toBeGreaterThan(0);
    expect(new Set(after.map((message) => message.day))).toEqual(new Set([2]));
  });

  it('brings the whole picture on a phase change, at each bell', async () => {
    const running = await boot(TRIGGERS_ONLY);
    const { client } = await play(running, { board: STRESS_SIZE });
    const startedAtMs = running.clock.now();
    const since = fromHere(client);

    // At pace 1 a step is 200 ms: the last steps before the opening bell, the
    // first of the open market, the next one, and the closing bell.
    for (const step of [295, 305, 306, 805]) {
      running.clock.advance(startedAtMs + step * SAMPLE_MS - running.clock.now());
      running.sample();
      // Let the socket drain between simulated ticks; synchronous bursts exercise backpressure instead.
      await roundTrip(client);
    }
    await roundTrip(client);

    const stream = ordered(since());
    expect(stream.map((message) => message.t)).toEqual(['frame', 'frame', 'quotes', 'frame']);
    // The phase is what decides whether a row is dimmed as too cheap to
    // trade, and a batch carries none, so every bell has to arrive whole.
    expect(stream.filter(isFrame).map((frame) => frame.clock.phase)).toEqual(['preBell', 'open', 'debrief']);
  });

  it('brings the whole picture when a command moves the revision', async () => {
    const running = await boot(TRIGGERS_ONLY);
    const { client } = await play(running, { board: STRESS_SIZE });
    running.clock.advance(OPEN_AT_MS);
    running.sample();
    // Taken one at a time so nothing is left queued in front of the reply below.
    await client.nextFrame();
    running.clock.advance(SAMPLE_MS);
    running.sample();
    expect((await client.next()).t).toBe('quotes');
    const since = fromHere(client);

    // A second start is refused, and a refusal is a stored receipt, which is
    // what moves the revision. A batch carrying the new revision without the
    // account behind it would leave the page holding a newer ordering triple
    // than the picture it shows.
    client.send(start('start-0002'));
    const reply = await client.nextReply();
    expect(reply.receipt).toMatchObject({ outcome: 'rejected', reason: 'alreadyStarted' });

    running.clock.advance(SAMPLE_MS);
    running.sample();
    await roundTrip(client);

    // The reply carries its own fresh frame; what is asserted here is the
    // sampled message that follows it, which is a whole picture and not a batch.
    const stream = ordered(since());
    expect(stream.map((message) => message.t)).toEqual(['frame']);
    expect(reply.frame.rev).toBe(2);
    expect(stream[0]?.rev).toBe(reply.frame.rev);
  });

  it('brings the whole picture to a session a socket has just joined', async () => {
    const running = await boot(TRIGGERS_ONLY);
    const { client: playing } = await join(running, { board: STRESS_SIZE });
    // Pace 3 is what the page sends. It matters here: a step is 200/3 ms, so
    // a hello between two sampling passes lands on a step of its own.
    playing.send(start('start-0001', 3));
    const reply = await playing.nextReply();
    expect(reply.receipt.outcome).toBe('accepted');

    // Well inside day 1's open market, where the prices really move.
    running.clock.advance(30_000);
    running.sample();
    const opening = await playing.nextFrame();
    expect(opening.clock.phase).toBe('open');

    // A page reload, or any reconnect naming the stored game: the door
    // answers the joining socket out of band, with a whole picture of its own
    // moment, which is not the moment the sampler last sent.
    running.clock.advance(100);
    const joiner = running.connect();
    await joiner.opened();
    joiner.send({ ...HELLO, session: reply.frame.session, board: STRESS_SIZE });
    const joined = await joiner.nextFrame();
    expect(joined.session).toBe(reply.frame.session);

    const sinceJoin = fromHere(joiner);
    const sincePlaying = fromHere(playing);
    running.clock.advance(100);
    running.sample();
    await roundTrip(joiner);
    await roundTrip(playing);

    const arrived = sinceJoin();
    // The scenario is only worth anything if the three moments are three
    // different steps: asserted, so this can never pass by lining up.
    expect(opening.step).toBeLessThan(joined.step);
    expect(joined.step).toBeLessThan(arrived[0]?.t === 'frame' || arrived[0]?.t === 'quotes' ? arrived[0].step : 0);

    // A batch here would be worked out against arrays this socket never held,
    // leaving it showing prices no frame ever carried.
    expect(arrived.map((message) => message.t)).toEqual(['frame']);
    // And the two sockets on the one game agree, ticket for ticket.
    expect(replay(joined, arrived)).toEqual(replay(opening, sincePlaying()));
  });

  it('keeps every message newer than the one before it, batches and whole pictures alike', async () => {
    const running = await boot({ limits: { stressFullFrameMs: SAMPLE_MS * 4 } });
    const { client } = await play(running, { board: STRESS_SIZE });
    running.clock.advance(OPEN_AT_MS);
    const since = fromHere(client);

    for (let pass = 0; pass < 12; pass += 1) {
      running.sample();
      running.clock.advance(SAMPLE_MS);
    }
    await roundTrip(client);

    const stream = ordered(since());
    expect(stream.filter(isBatch).length).toBeGreaterThan(0);
    expect(stream.filter(isFrame).length).toBeGreaterThan(1);
    let held: FrameOrder | null = null;
    for (const message of stream) {
      expect({ t: message.t, step: message.step, newer: isNewerFrame(held, orderOf(message)) }).toEqual({ t: message.t, step: message.step, newer: true });
      held = orderOf(message);
    }
  });
});

describe('a board size beside a session the server already has', () => {
  it('resumes the named session at its own size', async () => {
    const running = await boot();
    const { client: first, lobby } = await join(running);
    await first.close();

    const { lobby: resumed } = await join(running, { session: lobby.session, board: STRESS_SIZE });

    expect(resumed.session).toBe(lobby.session);
    expect(resumed.stress).toBe(false);
    expect(sessionsMade).toBe(1);
  });

  it('is still refused when the size is not on the list, because the value is judged first', async () => {
    const running = await boot();
    const { client: first, lobby } = await join(running);
    await first.close();

    const client = await open(running);
    client.send({ ...HELLO, session: lobby.session, board: 999_999 });

    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    await roundTrip(client);
    expect(client.received()).toHaveLength(1);
  });
});
