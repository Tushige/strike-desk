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
} from '@strike-desk/shared/engine';
import type { Frame } from '@strike-desk/shared/engine';
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

  it('keeps repricing: two frames a sampling pass apart differ on at least one ticket', async () => {
    const running = await boot();
    const { client } = await play(running, { board: STRESS_SIZE });

    // Past the opening bell, where the prices actually move: before it every
    // frame shows the opening price, whatever the board size.
    running.clock.advance(OPEN_AT_MS);
    running.sample();
    const first = await client.nextFrame();
    expect(first.clock.phase).toBe('open');

    running.clock.advance(SAMPLE_MS);
    running.sample();
    const later = await client.nextFrame();

    expect(later.quotes).toHaveLength(STRESS_CONTRACTS);
    expect(later.step).toBeGreaterThan(first.step);
    expect(later.quotes.some((price, id) => price !== first.quotes[id])).toBe(true);
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
    // The full projection, not the sampler's live form: the live form sets
    // `canBuy` false for every session, stress or not, because no frame it
    // sends today has a ticket form to enable.
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

  it('never reaches the rule from the door, because the door takes no buy at all today', async () => {
    const running = await boot();
    const { client } = await play(running, { board: STRESS_SIZE });
    client.send({ t: 'buy', commandId: 'buy-000001', day: 1, contractId: 0, spendCents: 1000, seenPriceCents: 1000 });

    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage', commandId: 'buy-000001' });
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
