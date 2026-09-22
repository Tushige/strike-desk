import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BELL_STEP_IN_DAY,
  CONTENT_VERSION,
  DAY_STEPS,
  ENGINE_VERSION,
  FIRST_PLAYER_ID,
  GAME_STEPS,
  PRE_BELL_STEPS,
  PROTOCOL_VERSION,
  STEP_MS,
  buildMarket,
  frameSchema,
  handleCommand,
  momentAt,
  parseServerMessage,
  playerOf,
  seedToMarketCode,
} from '@strike-desk/shared/engine';
import type { CashOutCommand, Frame, Market, QuotesMessage } from '@strike-desk/shared/engine';
import { LIMITS, createTokenBucket, createWindowCounter } from '../src/limits';
import { handleInbound } from '../src/door';
import type { Connection, DoorOptions } from '../src/door';
import { PUBLIC_MAX_BOARD_SIZE } from '../src/boardSizes';
import type { FrameSocket } from '../src/sampler';
import { sampleSessions } from '../src/sampler';
import { drawSessionId } from '../src/seed';
import { createRegistry } from '../src/sessions';
import type { Harness, TestClient } from './harness';
import { FIXED_SEEDS, startHarness } from './harness';

/**
 * What actually leaves the service, read off a real socket. One game, one
 * fixed market, sampled at every kind of moment there is — the lobby, either
 * side of both bells, across a day boundary, and past the last step of the
 * last day. Two things are asserted about every frame collected: that the
 * only sections filled in are the ones this service owns (the clock, the
 * share prices, names, board, public news, receipts and day results). Trades
 * are absent without a purchase, and the market identity appears only at final.
 *
 * The fake clock is jumped straight to each moment. It may jump forward as
 * far as it likes and must never go back.
 */

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
const SEED = FIXED_SEEDS[0] ?? Number.NaN;
const STARTING_CASH_CENTS = 100_000_000;
const LOBBY = 'the lobby';
const COMPANIES = 6;
const TARGETS_PER_COMPANY = 21;
/** Six companies, 21 targets each, UP and DOWN on every target. */
const CONTRACTS = 252;

/** Every moment worth sampling, as a step of the game, in the order they happen. */
const MOMENTS: [where: string, step: number][] = [
  ['the first step', 1],
  ['the last step before the opening bell', PRE_BELL_STEPS - 1],
  ['the first open step', PRE_BELL_STEPS],
  ['the middle of day 1', PRE_BELL_STEPS + 250],
  ['the closing bell of day 1', BELL_STEP_IN_DAY],
  ['the last step of day 1', DAY_STEPS - 1],
  ['the first step of day 2', DAY_STEPS],
  ["day 5's debrief", 4 * DAY_STEPS + BELL_STEP_IN_DAY + 50],
  ['the last step of the game', GAME_STEPS - 1],
  ['one step past the end of the game', GAME_STEPS + 1],
];

interface Sampled {
  where: string;
  frame: Frame;
}

const collected: Sampled[] = [];
let wire: Harness | null = null;

beforeAll(async () => {
  wire = await startHarness();
  const client = wire.connect();
  await client.opened();

  client.send(HELLO);
  collected.push({ where: LOBBY, frame: await client.nextFrame() });

  const startedAtMs = wire.clock.now();
  client.send({ t: 'start', commandId: 'start-0001', pace: 1 });
  await client.nextReply();

  for (const [where, step] of MOMENTS) {
    // At pace 1 one step is one STEP_MS of real time from the anchor.
    wire.clock.advance(startedAtMs + step * STEP_MS - wire.clock.now());
    wire.sample();
    collected.push({ where, frame: await client.nextFrame() });
  }
});

afterAll(async () => {
  await wire?.close();
  wire = null;
});

const wholeCentsFromZero = (values: readonly number[]): boolean => values.every((value) => Number.isInteger(value) && value >= 0);

/** Everything the allow-list cares about, with the moment attached so a failure names itself. */
function allowList(sampled: Sampled): Record<string, unknown> {
  const { where, frame } = sampled;
  return {
    where,
    boardSize: frame.board === null ? null : { targetsPerCompany: frame.board.targetsPerCompany, targetsOfEachCompany: frame.board.companies.map((company) => company.targets.length) },
    quoteCount: frame.quotes.length,
    realCount: frame.quoteReals.length,
    hopeCount: frame.quoteHopes.length,
    breakEvenCount: frame.quoteBreakEvens.length,
    everyQuoteIsWholeCentsFromZero:
      wholeCentsFromZero(frame.quotes) && wholeCentsFromZero(frame.quoteReals) && wholeCentsFromZero(frame.quoteHopes) && wholeCentsFromZero(frame.quoteBreakEvens),
    quotesThatAreNotRealPlusHope: frame.quotes.flatMap((price, id) => ((frame.quoteReals[id] ?? Number.NaN) + (frame.quoteHopes[id] ?? Number.NaN) === price ? [] : [id])),
    companyKeys: frame.companies.map((company) => Object.keys(company).sort().join(',')),
    newsCount: frame.news.length,
    positions: frame.positions,
    receipts: frame.receipts.map(({ kind, step, outcome }) => ({ kind, step, outcome })),
    days: frame.days,
    canBuy: frame.account.canBuy,
    stress: frame.stress,
    hasHistory: 'history' in frame,
    hasFinal: 'final' in frame,
    hasDraft: 'draft' in frame,
    priceCount: frame.prices.length,
    everyPriceIsWholeCents: frame.prices.every((price) => Number.isInteger(price)),
  };
}

/** The lobby has no board and no ticket price. Every other moment has the whole board and one price, with its two parts and its break-even, per contract. */
function thinAt(where: string): Record<string, unknown> {
  const started = where !== LOBBY;
  const finishedDays: Record<string, number[]> = {
    'the closing bell of day 1': [1], 'the last step of day 1': [1], 'the first step of day 2': [1],
    "day 5's debrief": [1, 2, 3, 4, 5], 'the last step of the game': [1, 2, 3, 4, 5],
    'one step past the end of the game': [1, 2, 3, 4, 5],
  };
  return {
    where,
    boardSize: started ? { targetsPerCompany: TARGETS_PER_COMPANY, targetsOfEachCompany: Array.from({ length: COMPANIES }, () => TARGETS_PER_COMPANY) } : null,
    quoteCount: started ? CONTRACTS : 0,
    realCount: started ? CONTRACTS : 0,
    hopeCount: started ? CONTRACTS : 0,
    breakEvenCount: started ? CONTRACTS : 0,
    everyQuoteIsWholeCentsFromZero: true,
    quotesThatAreNotRealPlusHope: [],
    companyKeys: Array.from({ length: COMPANIES }, () => 'name,ticker'),
    newsCount: started ? 3 : 0,
    positions: [],
    receipts: started ? [{ kind: 'start', step: 0, outcome: 'accepted' }] : [],
    days: (finishedDays[where] ?? []).map((day) => ({ day, startCents: 100000000, endCents: 100000000, changeCents: 0 })),
    canBuy: ['the first step', 'the last step before the opening bell', 'the first open step',
      'the middle of day 1', 'the first step of day 2', 'draft sample'].includes(where),
    stress: false,
    hasHistory: ['the first open step', 'the middle of day 1', 'the closing bell of day 1',
      'the first step of day 2', "day 5's debrief", 'one step past the end of the game', 'draft sample'].includes(where),
    hasFinal: where === 'one step past the end of the game',
    hasDraft: false,
    priceCount: 6,
    everyPriceIsWholeCents: true,
  };
}

describe('every frame this service emits', () => {
  it.each([undefined, 209])('keeps serialized history secret at every reveal and day boundary (targets %s)', (targets) => {
    const original = buildMarket({ seed: SEED, engine: ENGINE_VERSION, content: CONTENT_VERSION });
    const firstReveal = Math.min(...original.days[0]!.news.map((item) => item.hidden.revealIndex));
    function emitted(market: Market, step: number): string {
      const registry = createRegistry({ drawSeed: () => SEED, drawId: () => 'serialized-history', limits: LIMITS });
      const entry = registry.create(0, targets)!;
      registry.replace(entry.session.id, { ...handleCommand(entry.session, FIRST_PLAYER_ID, { t: 'start', commandId: 'history-secrecy', pace: 1 }, 0).session, market });
      const sent: string[] = [];
      const socket: FrameSocket = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (text) => { sent.push(text); } };
      registry.attach(entry.session.id, FIRST_PLAYER_ID, socket);
      sampleSessions(registry, step * 200, { sent: 0, skipped: 0 }, 1500);
      return sent[0]!;
    }
    for (const step of [0, 300 + firstReveal - 1, 300 + firstReveal, 800, 900, 4500]) {
      const changed = structuredClone(original);
      const moment = momentAt(step);
      for (const day of changed.days) {
        if (day.day < moment.day) continue;
        const today = day.day === moment.day;
        day.paths = day.paths.map((path) => path.map((price, index) => today && index <= moment.priceIndex ? price : price * 1.37 + 11 + index));
        if (!today) day.leadIn = day.leadIn.map((path) => path.map((price) => price + 17));
        for (const item of day.news) {
          if (today && item.hidden.revealIndex <= moment.priceIndex) continue;
          const next = today ? moment.priceIndex + 1 : 1;
          item.hidden.revealIndex = item.hidden.revealIndex === next ? next + 1 : next;
          item.hidden.wasTrue = !item.hidden.wasTrue;
          item.hidden.move = -item.hidden.move + 0.01;
          if (!today) item.headline.body = 'Changed future body';
        }
      }
      const raw = emitted(original, step);
      expect(emitted(changed, step)).toBe(raw);
      const parsed = frameSchema.parse(JSON.parse(raw));
      expect(parsed.leadIn?.[0]).toHaveLength(40);
      expect(parsed.history?.[0]).toHaveLength(moment.priceIndex + 1);
      expect(JSON.parse(raw)).toEqual(parsed);
      if (step < 4500) {
        expect(raw).not.toContain('marketCode');
        expect(raw).not.toContain(String(SEED));
      }
      const present = structuredClone(original);
      present.days[moment.day - 1]!.leadIn[0]![0] = 1;
      expect(emitted(present, step)).not.toBe(raw);
    }
  });
  it('was collected at every moment of the game', () => {
    expect(collected.map(({ where }) => where)).toEqual([LOBBY, ...MOMENTS.map(([where]) => where)]);
  });

  it('fills public quotes and ordered game results with buying available only during active days', () => {
    for (const sampled of collected) {
      expect(allowList(sampled)).toEqual(thinAt(sampled.where));
      expect({ where: sampled.where, account: sampled.frame.account }).toEqual({
        where: sampled.where,
        // $1,000,000 × 100 cents; the cap is half, $500,000 × 100.
        account: { cashCents: STARTING_CASH_CENTS, worthCents: STARTING_CASH_CENTS, capCents: 50_000_000, canBuy: thinAt(sampled.where)['canBuy'] },
      });
    }
  });

  it('carries three current headlines with only public fields even after the bell and at final', () => {
    for (const { frame } of collected) {
      if (frame.clock.phase === 'lobby') {
        expect(frame.news).toEqual([]);
        continue;
      }
      expect(frame.news).toHaveLength(3);
      expect(frame.news.map((news) => news.trust).sort()).toEqual([1, 2, 3]);
      expect(new Set(frame.news.map((news) => news.companyId)).size).toBe(3);
      for (const news of frame.news) {
        const keys = ['id', 'day', 'companyId', 'trust', 'source', 'title', 'body', 'direction', 'revealed'];
        if (news.revealed) {
          keys.push('revealIndex');
          expect(news.revealIndex).toBeLessThanOrEqual(frame.clock.priceIndex);
        }
        expect(Object.keys(news).sort()).toEqual(keys.sort());
        expect(news.day).toBe(frame.clock.day);
        expect(news.source.length).toBeGreaterThan(0);
        expect(news.title.length).toBeGreaterThan(0);
        expect(news.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('round-trips the shared schema unchanged', () => {
    for (const { where, frame } of collected) {
      expect({ where, frame: frameSchema.parse(frame) }).toEqual({ where, frame });
      expect(frame.leadIn !== undefined).toBe(frame.history !== undefined);
      if (frame.leadIn !== undefined) {
        expect(frame.leadIn).toHaveLength(6);
        for (const path of frame.leadIn) {
          expect(path).toHaveLength(40);
          expect(wholeCentsFromZero(path)).toBe(true);
        }
      }
    }
  });

  it('carries neither the market code, nor the seed, nor even the name of the field it would live in', () => {
    const code = seedToMarketCode(SEED);
    const codeWithoutDashes = code.replace(/-/g, '');
    // A sanity check on the thing being searched for: ten characters from the
    // look-alike-free alphabet, grouped 3-3-4. A search for the wrong string
    // would pass this test for the wrong reason.
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{4}$/);
    expect(codeWithoutDashes).toHaveLength(10);

    for (const { where, frame } of collected) {
      if (frame.clock.phase === 'final') {
        expect(frame.final).toMatchObject({ marketCode: code, finalCents: 100000000, changeCents: 0 });
        continue;
      }
      const text = JSON.stringify(frame);
      expect({
        where,
        marketCode: text.includes(code),
        marketCodeWithoutDashes: text.includes(codeWithoutDashes),
        seedInDecimal: text.includes(String(SEED)),
        theFieldName: text.includes('marketCode'),
      }).toEqual({ where, marketCode: false, marketCodeWithoutDashes: false, seedInDecimal: false, theFieldName: false });
    }
  });

  it('never lets the step go back, across a day boundary or at the end of the game', () => {
    const steps = collected.map(({ frame }) => frame.step);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1] ?? Number.NaN);
    }
    expect(steps).toEqual([0, 1, 299, 300, 550, 800, 899, 900, 4450, 4499, GAME_STEPS]);
    expect(collected.map(({ frame }) => `${frame.clock.phase} ${String(frame.clock.day)}`)).toEqual([
      'lobby 0',
      'preBell 1',
      'preBell 1',
      'open 1',
      'open 1',
      'debrief 1',
      'debrief 1',
      'preBell 2',
      'debrief 5',
      'debrief 5',
      'final 5',
    ]);
  });

  it('keeps one session throughout', () => {
    const sessions = new Set(collected.map(({ frame }) => frame.session));
    expect(sessions.size).toBe(1);
  });
});

/**
 * The stress setting's second message shape, held to exactly the same secrecy
 * claim as a frame: what it carries is what the market says at the moment it
 * was sent, and nothing about what has not happened yet.
 */
describe('every batch of changed quotes this service emits', () => {
  /** 2,500 contracts is 209 targets a company: the size a public instance grants. */
  const STRESS_TARGETS = 209;
  /** A step well inside day 1's open market, and the point of the day's path it falls on. */
  const BATCH_STEP = PRE_BELL_STEPS + 50;
  const BATCH_PRICE_INDEX = 50;

  function fakeSocket(): FrameSocket & { sent: string[] } {
    const sent: string[] = [];
    return { OPEN: 1, readyState: 1, bufferedAmount: 0, sent, send: (text: string) => void sent.push(text) };
  }

  /**
   * A copy of the market with every share price from `fromIndex` of `day` on,
   * and every later day entirely, replaced by something else.
   */
  function scrambleFrom(source: Market, day: number, fromIndex: number): Market {
    const copy = structuredClone(source);
    for (const marketDay of copy.days) {
      if (marketDay.day < day) continue;
      const from = marketDay.day === day ? fromIndex : 0;
      marketDay.paths = marketDay.paths.map((path) => path.map((price, index) => (index < from ? price : price * 1.37 + 11 + index)));
    }
    return copy;
  }

  /**
   * One switched-on session on the fixed seed, sampled twice a step apart: the
   * whole picture, then the batch. `market` replaces the one the session built
   * for itself, which is how a scrambled future is fed in.
   */
  function batchOn(market: Market | null): QuotesMessage {
    const registry = createRegistry({ drawSeed: () => SEED, drawId: drawSessionId, limits: LIMITS });
    const entry = registry.create(0, STRESS_TARGETS);
    if (entry === null) throw new Error('the registry refused a session it has room for');
    const started = handleCommand(entry.session, FIRST_PLAYER_ID, { t: 'start', commandId: 'start-0001', pace: 1 }, 0);
    expect(started.receipt.outcome).toBe('accepted');
    registry.replace(entry.session.id, market === null ? started.session : { ...started.session, market });

    const socket = fakeSocket();
    registry.attach(entry.session.id, FIRST_PLAYER_ID, socket);
    const stats = { sent: 0, skipped: 0 };
    // At pace 1 a step is one STEP_MS of wall clock from a start at 0.
    sampleSessions(registry, (BATCH_STEP - 1) * STEP_MS, stats, LIMITS.stressFullFrameMs);
    sampleSessions(registry, BATCH_STEP * STEP_MS, stats, LIMITS.stressFullFrameMs);

    const [whole, batch] = socket.sent;
    if (whole === undefined || batch === undefined) throw new Error('the session did not send a whole picture and then a batch');
    const parsed = parseServerMessage(JSON.parse(batch));
    if (parsed === null || parsed.t !== 'quotes') throw new Error('the second message was not a batch');
    // The session field is the one thing that is not the market's: pinned
    // here so the comparisons below are about the numbers.
    expect(parsed).toMatchObject({ day: 1, priceIndex: BATCH_PRICE_INDEX, step: BATCH_STEP });
    return parsed;
  }

  it('carries neither the market code, nor the seed, nor even the name of the field it would live in', async () => {
    const running = await startHarness({ limits: { stressFullFrameMs: 1_000_000 } });
    try {
      const client = running.connect();
      await client.opened();
      client.send({ ...HELLO, board: 2500 });
      await client.nextFrame();
      client.send({ t: 'start', commandId: 'start-0001', pace: 1 });
      await client.nextReply();

      const startedAtMs = running.clock.now();
      const batches: unknown[] = [];
      for (const step of [BATCH_STEP, BATCH_STEP + 1, BATCH_STEP + 2]) {
        running.clock.advance(startedAtMs + step * STEP_MS - running.clock.now());
        running.sample();
      }
      await new Promise<void>((resolve) => {
        client.socket.once('pong', () => resolve());
        client.socket.ping();
      });
      for (const raw of client.received()) {
        const message = parseServerMessage(raw);
        if (message !== null && message.t === 'quotes') batches.push(message);
      }
      expect(batches.length).toBeGreaterThan(0);

      const code = seedToMarketCode(SEED);
      const codeWithoutDashes = code.replace(/-/g, '');
      for (const message of batches) {
        const text = JSON.stringify(message);
        expect({
          marketCode: text.includes(code),
          marketCodeWithoutDashes: text.includes(codeWithoutDashes),
          seedInDecimal: text.includes(String(SEED)),
          theFieldName: text.includes('marketCode'),
        }).toEqual({ marketCode: false, marketCodeWithoutDashes: false, seedInDecimal: false, theFieldName: false });
      }
    } finally {
      await running.close();
    }
  });

  it('says exactly the same thing when everything still to come is scrambled', () => {
    const market = buildMarket({ seed: SEED, engine: ENGINE_VERSION, content: CONTENT_VERSION });
    const future = scrambleFrom(market, 1, BATCH_PRICE_INDEX + 1);
    expect(future).not.toEqual(market);

    expect(batchOn(future).changes).toEqual(batchOn(null).changes);
    expect(batchOn(future).prices).toEqual(batchOn(null).prices);
  });

  it('says something different when the moment it is about is scrambled too', () => {
    // The mutation that proves the assertion above discriminates: scrambling
    // from the batch's own point of the path, rather than from the one after
    // it, has to change what the batch says.
    const market = buildMarket({ seed: SEED, engine: ENGINE_VERSION, content: CONTENT_VERSION });
    const now = scrambleFrom(market, 1, BATCH_PRICE_INDEX);

    expect(batchOn(now).changes).not.toEqual(batchOn(null).changes);
  });
});

describe('cash-out refusals on the ordinary wire', () => {
  let harness: Harness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  /**
   * Each one is typed as the contract's own command, so a command that the
   * schema would refuse on its own could not be written here: what is being
   * proved is that a well-formed command reaches the game and gets a receipt.
   */
  const cashOut: CashOutCommand = { t: 'cashOut', commandId: 'refused-cashOut', positionId: 'd1' };
  const REFUSED = [cashOut];

  it.each(REFUSED)('$t records an unknown-position refusal without changing cash', async (command) => {
    harness = await startHarness();
    const client = harness.connect();
    await client.opened();
    client.send(HELLO);
    await client.nextFrame();

    const startedAtMs = harness.clock.now();
    client.send({ t: 'start', commandId: 'start-0001', pace: 1 });
    await client.nextReply();

    // Inside the open market, where these commands would otherwise be taken.
    harness.clock.advance(startedAtMs + (PRE_BELL_STEPS + 10) * STEP_MS - harness.clock.now());
    harness.sample();
    const before = await client.nextFrame();
    expect(before.clock.phase).toBe('open');

    client.send(command);
    const refused = await client.nextReply();
    expect(refused.receipt).toMatchObject({ kind: 'cashOut', commandId: command.commandId,
      outcome: 'rejected', reason: 'unknownPosition' });
    expect(frameSchema.parse(refused.frame)).toEqual(refused.frame);

    harness.clock.advance(STEP_MS);
    harness.sample();
    const after = await client.nextFrame();
    expect(after.rev).toBe(before.rev + 1);
    expect(after.account.cashCents).toBe(before.account.cashCents);
    expect(after.positions).toEqual([]);
    expect(after.receipts).toEqual([...before.receipts, refused.receipt]);
    client.send({ ...command, positionId: 'other-position' });
    const repeated = await client.nextReply();
    expect(repeated.receipt).toEqual(refused.receipt);
    expect(repeated.frame.rev).toBe(after.rev);
    expect(repeated.frame.account).toEqual(after.account);
  });
});

/** A protocol round trip proves all preceding client messages reached the server. */
function roundTrip(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    client.socket.once('pong', () => resolve());
    client.socket.ping();
  });
}

function expectDraftAtFrame(frame: Frame, contractId: number, spendCents: number): void {
  expect(frameSchema.parse(frame)).toEqual(frame);
  expect(frame.draft).toMatchObject({ contractId, spendCents });
  expect(frame.draft?.costs).toHaveLength(frame.quotes.length);
  expect(frame.draft?.ticket).toMatchObject({
    contractId,
    priceCents: frame.quotes[contractId],
    breakEvenCents: frame.quoteBreakEvens[contractId],
    costCents: frame.draft?.costs?.[contractId],
  });
  expect(frame.draft?.ticket?.quantity).toBeGreaterThan(0);
  expect(frame.draft?.ticket?.whatIf).toContainEqual({ atCents: frame.quoteBreakEvens[contractId], profitCents: 0 });
  expect(frame).toMatchObject({ positions: [], days: [], account: { cashCents: STARTING_CASH_CENTS, canBuy: !frame.stress } });
  expect(frame.receipts).toHaveLength(1);
  expect(frame.receipts[0]).toMatchObject({ kind: 'start', step: 0, outcome: 'accepted' });
  if (frame.history !== undefined) {
    expect(frame.leadIn).toHaveLength(6);
    frame.leadIn?.forEach((path) => expect(path).toHaveLength(40));
    expect(frame.history).toHaveLength(6);
    frame.history.forEach((path, companyId) => {
      expect(path).toHaveLength(frame.clock.priceIndex + 1);
      expect(path.at(-1)).toBe(frame.prices[companyId]);
      expect(wholeCentsFromZero(path)).toBe(true);
    });
  }
  else expect(frame).not.toHaveProperty('leadIn');
  expect(frame).not.toHaveProperty('final');
  for (const news of frame.news) expect(news).not.toHaveProperty('wasTrue');
  expect(JSON.stringify(frame)).not.toContain(seedToMarketCode(SEED));
  expect(JSON.stringify(frame)).not.toContain(String(SEED));
}

describe('connection-local draft quotes', () => {
  it('answers only in the next sample at that frame price without a receipt or cash change', async () => {
    const running = await startHarness();
    try {
      const client = running.connect();
      await client.opened();
      client.send(HELLO);
      await client.nextFrame();
      client.send({ t: 'start', commandId: 'start-draft', pace: 1 });
      const start = await client.nextReply();
      expect(start.frame).not.toHaveProperty('draft');
      client.send({ t: 'draft', contractId: 0, spendCents: 100_000 });
      await roundTrip(client);
      expect(client.waiting()).toBe(0);
      running.clock.advance(70_000);
      running.sample();
      const frame = await client.nextFrame();
      expectDraftAtFrame(frame, 0, 100_000);
      expect(frame.rev).toBe(start.frame.rev);
      expect(frame.account).toEqual(start.frame.account);
      // The request precedes moving prices: this must quote the sampled moment.
      expect(frame.quotes[0]).not.toBe(start.frame.quotes[0]);
      expect(allowList({ where: 'draft sample', frame })).toEqual({ ...thinAt('draft sample'), hasDraft: true });
      await roundTrip(client);
      expect(client.waiting()).toBe(0);
    } finally {
      await running.close();
    }
  });

  it.each([undefined, 2500])('isolates two latest drafts and a draftless socket at the existing cadence (board %s)', async (board) => {
    const running = await startHarness();
    try {
      const first = running.connect();
      await first.opened();
      first.send({ ...HELLO, ...(board === undefined ? {} : { board }) });
      const lobby = await first.nextFrame();
      first.send({ t: 'start', commandId: 'start-tabs', pace: 1 });
      await first.nextReply();
      const second = running.connect();
      const plain = running.connect();
      for (const client of [second, plain]) {
        await client.opened();
        client.send({ ...HELLO, session: lobby.session });
        expect(await client.nextFrame()).not.toHaveProperty('draft');
      }
      first.send({ t: 'draft', contractId: 0, spendCents: 1_000_000 });
      second.send({ t: 'draft', contractId: 2, spendCents: 2_000_000 });
      await Promise.all([first, second, plain].map(roundTrip));
      expect([first.waiting(), second.waiting(), plain.waiting()]).toEqual([0, 0, 0]);
      running.clock.advance(70_000);
      running.sample();
      const [a, b, c] = await Promise.all([first, second, plain].map((client) => client.nextFrame()));
      expectDraftAtFrame(a!, 0, 1_000_000);
      expectDraftAtFrame(b!, 2, 2_000_000);
      expect(c).not.toHaveProperty('draft');
      expect({ ...a, draft: undefined }).toEqual({ ...c, draft: undefined });
      expect({ ...b, draft: undefined }).toEqual({ ...c, draft: undefined });

      // A new choice replaces the old one without resetting the whole-frame deadline.
      first.send({ t: 'draft', contractId: 4, spendCents: 3_000_000 });
      await roundTrip(first);
      expect(first.waiting()).toBe(0);
      const kinds: string[] = [];
      for (let pass = 1; pass <= 8; pass += 1) {
        running.clock.advance(200);
        running.sample();
        const [one, two, none] = await Promise.all([first, second, plain].map((client) => client.next()));
        kinds.push(one!.t);
        expect(two!.t).toBe(one!.t);
        expect(none!.t).toBe(one!.t);
        if (one!.t === 'frame' && two!.t === 'frame' && none!.t === 'frame') {
          expectDraftAtFrame(one as Frame, 4, 3_000_000);
          expectDraftAtFrame(two as Frame, 2, 2_000_000);
          expect(none).not.toHaveProperty('draft');
        } else {
          expect(one).toEqual(two);
          expect(two).toEqual(none);
          expect(one).not.toHaveProperty('draft');
          expect(Object.keys(one!).sort()).toEqual(['changes', 'day', 'priceIndex', 'prices', 'rev', 'session', 'step', 't']);
          expect((one as QuotesMessage).changes.every((change) => change.length === 5)).toBe(true);
        }
      }
      expect(kinds).toEqual(board === undefined ? Array.from({ length: 8 }, () => 'frame') : [
        'quotes', 'quotes', 'quotes', 'quotes', 'quotes', 'quotes', 'quotes', 'frame',
      ]);

      first.send({ t: 'draft', contractId: null, spendCents: null });
      await roundTrip(first);
      running.clock.advance(1600);
      running.sample();
      expect(await first.nextFrame()).not.toHaveProperty('draft');
      expectDraftAtFrame(await second.nextFrame(), 2, 2_000_000);
      expect(await plain.nextFrame()).not.toHaveProperty('draft');
      first.send({ t: 'draft', contractId: 4, spendCents: 3_000_000 });
      await roundTrip(first);
      await first.close();
      const resumed = running.connect();
      await resumed.opened();
      resumed.send({ ...HELLO, session: lobby.session });
      expect(await resumed.nextFrame()).not.toHaveProperty('draft');
      running.sample();
      expect(await resumed.nextFrame()).not.toHaveProperty('draft');
      expectDraftAtFrame(await second.nextFrame(), 2, 2_000_000);
      expect(await plain.nextFrame()).not.toHaveProperty('draft');
    } finally {
      await running.close();
    }
  });

  it('refuses pre-hello and malformed requests, and quotes a lobby choice only once started', async () => {
    const running = await startHarness();
    try {
      const client = running.connect();
      await client.opened();
      client.send({ t: 'draft', contractId: 0, spendCents: 100_000 });
      expect(await client.nextError()).toEqual({ t: 'error', code: 'noSession' });
      client.send(HELLO);
      expect(await client.nextFrame()).not.toHaveProperty('draft');
      for (const spendCents of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER, '1000']) {
        client.send({ t: 'draft', contractId: 0, spendCents });
        expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
      }
      client.send({ t: 'draft', contractId: 0, spendCents: 100_000 });
      await roundTrip(client);
      expect(client.waiting()).toBe(0);
      running.sample();
      expect(await client.nextFrame()).not.toHaveProperty('draft');
      client.send({ t: 'start', commandId: 'start-lobby-draft', pace: 1 });
      const reply = await client.nextReply();
      expectDraftAtFrame(reply.frame, 0, 100_000);
      expect(reply.receipt.outcome).toBe('accepted');
      expect(reply.frame.rev).toBe(1);
    } finally {
      await running.close();
    }
  });

  it('charges previews to the existing message budget and retains only the last admitted request', async () => {
    const running = await startHarness({ limits: { messagesPerWindow: 3 } });
    try {
      const client = running.connect();
      await client.opened();
      client.send(HELLO);
      await client.nextFrame();
      client.send({ t: 'start', commandId: 'start-budget', pace: 1 });
      await client.nextReply();
      client.send({ t: 'draft', contractId: 0, spendCents: 100_000 });
      await roundTrip(client);
      expect(client.waiting()).toBe(0);
      client.send({ t: 'draft', contractId: 2, spendCents: 200_000 });
      expect(await client.nextError()).toEqual({ t: 'error', code: 'tooManyCommands' });
      running.sample();
      expectDraftAtFrame(await client.nextFrame(), 0, 100_000);
    } finally {
      await running.close();
    }
  });

  it('keeps draft input out of the game log and quotes a simple bell fixture without changing cash', () => {
    const registry = createRegistry({ drawSeed: () => SEED, drawId: () => 'simple-draft', limits: LIMITS });
    let now = 0;
    const options: DoorOptions = {
      registry, now: () => now, maxBoardSize: PUBLIC_MAX_BOARD_SIZE,
      newSessions: createTokenBucket(30, 3),
    };
    const sent: string[] = [];
    const socket: FrameSocket = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (text) => { sent.push(text); } };
    const connection: Connection = { socket, sessionId: null, playerId: null, messages: createWindowCounter(20, 10_000) };
    const send = (message: unknown): void => { handleInbound(options, connection, JSON.stringify(message)); };
    send(HELLO);
    send({ t: 'start', commandId: 'start-simple', pace: 1 });
    const entry = registry.get('simple-draft')!;
    // A server-only fixture: all companies open at $100 and finish at $110.
    // The center UP target is $100. At the bell one 100-share ticket pays
    // $1,000. A $2,500 spend buys two for $2,000, breaking even at $110.
    const market = structuredClone(entry.session.market);
    market.days[0]!.paths = market.days[0]!.paths.map(() => [100, ...Array.from({ length: 500 }, () => 110)]);
    registry.replace(entry.session.id, { ...entry.session, market });
    const before = entry.session;
    const log = playerOf(before.game, FIRST_PLAYER_ID).log;
    send({ t: 'draft', contractId: 20, spendCents: 250_000 });
    expect(entry.session).toBe(before);
    expect(playerOf(entry.session.game, FIRST_PLAYER_ID).log).toBe(log);
    expect(log).toHaveLength(1);
    expect(sent).toHaveLength(2);
    now = BELL_STEP_IN_DAY * STEP_MS;
    socket.bufferedAmount = 1;
    const stats = { sent: 0, skipped: 0 };
    sampleSessions(registry, now, stats, LIMITS.stressFullFrameMs);
    expect(sent).toHaveLength(2);
    expect(stats).toEqual({ sent: 0, skipped: 1 });
    socket.bufferedAmount = 0;
    sampleSessions(registry, now, { sent: 0, skipped: 0 }, LIMITS.stressFullFrameMs);
    const frame = frameSchema.parse(JSON.parse(sent[2]!));
    expect(frame.draft?.ticket).toMatchObject({
      contractId: 20, priceCents: 100_000, quantity: 2, costCents: 200_000, breakEvenCents: 11_000,
    });
    expect(frame.draft?.costs?.[20]).toBe(200_000);
    expect(frame.draft?.ticket?.whatIf).toContainEqual({ atCents: 10_000, profitCents: -200_000 });
    expect(frame.draft?.ticket?.whatIf).toContainEqual({ atCents: 11_000, profitCents: 0 });
    expect(frame.rev).toBe(1);
    expect(frame.account.cashCents).toBe(100_000_000);
    expect(playerOf(entry.session.game, FIRST_PLAYER_ID).log).toEqual(log);
    registry.detach(entry.session.id, socket, now);
    expect(entry.drafts.size).toBe(0);
  });
});
