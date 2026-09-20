import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BELL_STEP_IN_DAY,
  DAY_STEPS,
  GAME_STEPS,
  PRE_BELL_STEPS,
  PROTOCOL_VERSION,
  STEP_MS,
  frameSchema,
  seedToMarketCode,
} from '@strike-desk/shared/engine';
import type { BuyCommand, CashOutCommand, ClockCommand, Frame } from '@strike-desk/shared/engine';
import type { Harness } from './harness';
import { FIXED_SEEDS, startHarness } from './harness';

/**
 * What actually leaves the service, read off a real socket. One game, one
 * fixed market, sampled at every kind of moment there is — the lobby, either
 * side of both bells, across a day boundary, and past the last step of the
 * last day. Two things are asserted about every frame collected: that the
 * only sections filled in are the ones this service owns (the clock, the
 * share prices, the names, the board and the ticket prices; never news,
 * positions, receipts, days, history or the final result), and that the
 * market's identity is nowhere in the text of it.
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
    everyQuoteIsWholeCentsFromZero: wholeCentsFromZero(frame.quotes) && wholeCentsFromZero(frame.quoteReals) && wholeCentsFromZero(frame.quoteHopes),
    quotesThatAreNotRealPlusHope: frame.quotes.flatMap((price, id) => ((frame.quoteReals[id] ?? Number.NaN) + (frame.quoteHopes[id] ?? Number.NaN) === price ? [] : [id])),
    companyKeys: frame.companies.map((company) => Object.keys(company).sort().join(',')),
    news: frame.news,
    positions: frame.positions,
    receipts: frame.receipts,
    days: frame.days,
    canBuy: frame.account.canBuy,
    stress: frame.stress,
    hasHistory: 'history' in frame,
    hasFinal: 'final' in frame,
    priceCount: frame.prices.length,
    everyPriceIsWholeCents: frame.prices.every((price) => Number.isInteger(price)),
  };
}

/** The lobby has no board and no ticket price. Every other moment has the whole board and one price, with its two parts, per contract. */
function thinAt(where: string): Record<string, unknown> {
  const started = where !== LOBBY;
  return {
    where,
    boardSize: started ? { targetsPerCompany: TARGETS_PER_COMPANY, targetsOfEachCompany: Array.from({ length: COMPANIES }, () => TARGETS_PER_COMPANY) } : null,
    quoteCount: started ? CONTRACTS : 0,
    realCount: started ? CONTRACTS : 0,
    hopeCount: started ? CONTRACTS : 0,
    everyQuoteIsWholeCentsFromZero: true,
    quotesThatAreNotRealPlusHope: [],
    companyKeys: Array.from({ length: COMPANIES }, () => 'name,ticker'),
    news: [],
    positions: [],
    receipts: [],
    days: [],
    canBuy: false,
    stress: false,
    hasHistory: false,
    hasFinal: false,
    priceCount: 6,
    everyPriceIsWholeCents: true,
  };
}

describe('every frame this service emits', () => {
  it('was collected at every moment of the game', () => {
    expect(collected.map(({ where }) => where)).toEqual([LOBBY, ...MOMENTS.map(([where]) => where)]);
  });

  it('fills in nothing but the clock, six whole-cent prices, the six names, the board, the ticket prices with their two parts, and the starting account', () => {
    for (const sampled of collected) {
      expect(allowList(sampled)).toEqual(thinAt(sampled.where));
      expect({ where: sampled.where, account: sampled.frame.account }).toEqual({
        where: sampled.where,
        account: { cashCents: STARTING_CASH_CENTS, worthCents: STARTING_CASH_CENTS, capCents: STARTING_CASH_CENTS / 2, canBuy: false },
      });
    }
  });

  it('round-trips the shared schema unchanged', () => {
    for (const { where, frame } of collected) {
      expect({ where, frame: frameSchema.parse(frame) }).toEqual({ where, frame });
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

describe('the five commands this service does not take', () => {
  let harness: Harness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  /**
   * Each one is typed as the contract's own command, so a command that the
   * schema would refuse on its own could not be written here: what is being
   * proved is that the door refuses a command that is otherwise perfectly
   * well formed.
   */
  const buy: BuyCommand = { t: 'buy', commandId: 'refused-buy', day: 1, contractId: 3, spendCents: 1_000_000, seenPriceCents: 5_000 };
  const cashOut: CashOutCommand = { t: 'cashOut', commandId: 'refused-cashOut', positionId: 'd1' };
  const openBell: ClockCommand = { t: 'openBell', commandId: 'refused-openBell', day: 1 };
  const skipToBell: ClockCommand = { t: 'skipToBell', commandId: 'refused-skipToBell', day: 1 };
  const nextDay: ClockCommand = { t: 'nextDay', commandId: 'refused-nextDay', day: 1 };
  const REFUSED = [buy, cashOut, openBell, skipToBell, nextDay];

  it.each(REFUSED)('$t is refused by name, and the revision and the cash are untouched', async (command) => {
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
    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage', commandId: command.commandId });

    harness.clock.advance(STEP_MS);
    harness.sample();
    const after = await client.nextFrame();
    expect(after.rev).toBe(before.rev);
    expect(after.account.cashCents).toBe(before.account.cashCents);
    expect(after.positions).toEqual([]);
    expect(after.receipts).toEqual([]);
  });
});
