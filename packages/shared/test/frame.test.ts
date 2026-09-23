import { describe, expect, it } from 'vitest';
import { GAME_STEPS, OPEN_STEPS, bellStep, momentAt } from '../src/clock';
import type { ProjectOptions } from '../src/frame';
import { projectFrame } from '../src/frame';
import type { GameState } from '../src/game';
import { advanceTo, applyCommand, newGame, spendCapCents } from '../src/game';
import type { Market } from '../src/market';
import { CONTENT_VERSION, ENGINE_VERSION, boardFor, buildMarket, marketDay, quoteAt } from '../src/market';
import { sharePriceCents } from '../src/money';
import { MIN_TICKET_PRICE_CENTS, isTradable } from '../src/pricing';
import type { DraftRequest, Frame } from '../src/protocol';
import { decodeContractId, frameSchema } from '../src/protocol';
import { seedToMarketCode } from '../src/rng';
import { ME, TEST_IDENTITY, TEST_SEED, buyCommand, cashOut, findContract, me, priceOf, start, startedGame, testMarket } from './helpers';
import { TEST_CAST } from './testCast';

const market = testMarket();
const MARKET_CODE = seedToMarketCode(TEST_SEED);

/**
 * A copy of the market in which everything that has not happened yet at
 * `step` is replaced with something else: the rest of today's prices, the
 * outcome of every headline whose move has not landed, and every later day entirely.
 */
function scrambleFuture(source: Market, step: number): Market {
  const copy = structuredClone(source);
  const { day, priceIndex } = momentAt(step);
  copy.days.forEach((marketDay) => {
    if (marketDay.day < day) return;
    const today = marketDay.day === day;
    if (!today) marketDay.leadIn = marketDay.leadIn.map((path) => path.map((price) => price * 1.2 + 7));
    const from = today ? priceIndex + 1 : 0;
    marketDay.paths = marketDay.paths.map((path) => path.map((price, index) => (index < from ? price : price * 1.37 + 11 + index)));
    marketDay.news.forEach((item) => {
      const landed = today && item.hidden.revealIndex <= priceIndex;
      if (!landed) {
        const firstFuture = today ? priceIndex + 1 : 1;
        item.hidden.revealIndex = item.hidden.revealIndex === firstFuture ? firstFuture + 1 : firstFuture;
      }
      if (!landed) {
        item.hidden.wasTrue = !item.hidden.wasTrue;
        item.hidden.move = -3 * item.hidden.move + 0.01;
      }
      if (!today) {
        item.headline.title = 'scrambled';
        item.headline.body = 'scrambled';
        item.headline.trust = item.headline.trust === 1 ? 3 : 1;
        item.headline.companyId = (item.headline.companyId + 1) % 6;
        item.headline.direction = item.headline.direction === 'up' ? 'down' : 'up';
      }
    });
  });
  return copy;
}

/** Buy with half the cash on `day`, at a step inside it, then optionally cash out later the same day. */
function playDay(game: GameState, day: number, buyInDay: number, cashOutInDay?: number): GameState {
  const base = (day - 1) * 900;
  const priceIndex = Math.max(0, buyInDay - 300);
  const contract = findContract(market, day, (id) => id % 5 === day % 5 && isTradable(priceOf(market, day, priceIndex, id)));
  const command = buyCommand({ day, contractId: contract, spendCents: spendCapCents(me(game).cashCents), seenPriceCents: priceOf(market, day, priceIndex, contract) });
  let next = applyCommand(market, game, ME, command, base + buyInDay);
  expect(next.receipt.outcome).toBe('accepted');
  if (cashOutInDay !== undefined) {
    next = applyCommand(market, next.game, ME, cashOut(`d${day}`), base + cashOutInDay);
    expect(next.receipt.outcome).toBe('accepted');
  }
  return next.game;
}

/** Cashed out on day 1, held to the bell on day 2, and a ticket on each later day reached. */
function gameAt(step: number): GameState {
  let game = startedGame(market);
  const plan: [number, number, number?][] = [[1, 320, 500], [2, 100], [3, 330], [4, 310, 790], [5, 450]];
  for (const [day, buyInDay, cashOutInDay] of plan) {
    const base = (day - 1) * 900;
    if (base + buyInDay > step) break;
    game = playDay(game, day, buyInDay, cashOutInDay !== undefined && base + cashOutInDay <= step ? cashOutInDay : undefined);
  }
  return advanceTo(market, game, step);
}

const STEPS: [string, number][] = [
  ['before the opening bell on day 1', 100],
  ['open, before any reveal', 300 + 60],
  ['open, holding a ticket, before any reveal', 1800 + 300 + 100],
  ['open, with two reveals landed and one still to come', 1800 + 300 + 190],
  ['open, between reveals', 1800 + 300 + 250],
  ['open, after every reveal', 1800 + 300 + 400],
  ['the last open step', 1800 + 799],
  ['before the opening bell on day 4', 2700 + 150],
  ['open on day 4 after a cash-out', 2700 + 795],
  ['the debrief', 1800 + 850],
  ['the debrief of day 5', 3600 + 850],
  ['the final screen', GAME_STEPS],
];

const project = (source: Market, game: GameState, step: number, history = true, sections?: ProjectOptions['sections']): Frame =>
  projectFrame(source, game, ME, step, sections === undefined ? { session: 'session-1', history } : { session: 'session-1', history, sections });

const projectLive = (source: Market, game: GameState, step: number, history = false): Frame => project(source, game, step, history, 'live');

const FORMS = ['full', 'live'] as const;
const STEPS_IN_BOTH_FORMS = FORMS.flatMap((form) => STEPS.map(([name, step]): [(typeof FORMS)[number], string, number] => [form, name, step]));

describe('projectFrame keeps the future secret', () => {
  it('projects only reached held value after sale, then clamps it to its own bell through final', () => {
    const source = structuredClone(market);
    source.days[0]!.news = [];
    source.days[0]!.paths[0] = Array<number>(501).fill(100);
    source.days[0]!.paths[0][498] = 110;
    source.days[0]!.paths[0][499] = 112;
    source.days[0]!.paths[0][500] = 120;
    const bought = applyCommand(source, startedGame(source), ME,
      buyCommand({ day: 1, contractId: 20, spendCents: 200000, seenPriceCents: 100000 }), 798);
    const sale = applyCommand(source, bought.game, ME, cashOut('d1'), 798);
    const atSale = project(source, sale.game, 798);
    // Two calls covering 100 shares each: $10 intrinsic pays $2,000;
    // the reached $12 intrinsic would pay $2,400, and $20 at the bell $4,000.
    expect(atSale.positions[0]).toMatchObject({ costCents: 200000, valueCents: 200000, profitCents: 0, ifHeldCents: 200000 });
    const reached = advanceTo(source, sale.game, 799);
    const live = project(source, reached, 799);
    expect(live.positions[0]?.ifHeldCents).toBe(240000);
    expect(project(scrambleFuture(source, 799), reached, 799)).toEqual(live);
    const control = structuredClone(source); control.days[0]!.paths[0]![499] = 113;
    expect(project(control, reached, 799).positions[0]?.ifHeldCents).toBe(260000);
    expect(live.account.cashCents).toBe(100000000);
    let game = reached;
    for (const step of [800, 950, GAME_STEPS]) {
      game = advanceTo(source, game, step);
      const frame = project(source, game, step);
      expect(frame.positions[0]).toMatchObject({ costCents: 200000, valueCents: 200000, profitCents: 0, ifHeldCents: 400000,
        exit: { kind: 'cashOut', step: 798, proceedsCents: 200000 } });
      expect(frame.account.cashCents).toBe(100000000);
      expect(frame.days[0]).toEqual({ day: 1, startCents: 100000000, endCents: 100000000, changeCents: 0,
        review: { companyId: 0, openingCents: 10000, closingCents: 12000 } });
      expect(project(source, game, step)).toEqual(frame);
      if (step === GAME_STEPS) expect(frame.final).toMatchObject({ finalCents: 100000000, changeCents: 0 });
    }
  });
  it('projects earlier observations as integer cents only beside requested full history', () => {
    const source = structuredClone(market);
    // $98.12 and $99.34 precede an unchanged $100 open: 9812, 9934, 10000 cents.
    source.days[0]!.leadIn[0] = [98.12, 99.34];
    source.days[0]!.paths[0]![0] = 100;
    const game = startedGame(source);
    const frame = project(source, game, 0);
    expect(frame).toHaveProperty('leadIn.0', [9812, 9934]);
    expect(frame.history?.[0]).toEqual([10000]);
    expect(project(source, game, 0, false)).not.toHaveProperty('leadIn');
    expect(projectLive(source, game, 0, true)).not.toHaveProperty('leadIn');
    expect(project(source, newGame(), 0)).not.toHaveProperty('leadIn');
  });
  it.each(STEPS_IN_BOTH_FORMS)('%s form, %s: scrambling everything still to come gives the identical frame', (form, _name, step) => {
    const game = gameAt(step);
    const scrambled = scrambleFuture(market, step);
    // After the last bell nothing is left to scramble.
    if (step < bellStep(5)) expect(scrambled).not.toEqual(market);
    const original = project(market, game, step, true, form);
    const changed = project(scrambled, game, step, true, form);
    expect(changed).toEqual(original);
    expect(JSON.stringify(changed)).toBe(JSON.stringify(original));
  });

  it('one of the moments really has reveals on both sides of it', () => {
    const { day, priceIndex } = momentAt(1800 + 300 + 190);
    const landed = marketDay(market, day).news.map((item) => item.hidden.revealIndex <= priceIndex);
    expect(landed.filter(Boolean)).toHaveLength(2);
    expect(landed).toHaveLength(3);
  });

  it('the scramble really changes what comes next in the live form too', () => {
    const step = 1800 + 300 + 100;
    const game = gameAt(step);
    expect(projectLive(scrambleFuture(market, step), game, step + 1).prices).not.toEqual(projectLive(market, game, step + 1).prices);
  });

  it('the scramble really changes what comes next', () => {
    const step = 1800 + 300 + 100;
    const scrambled = scrambleFuture(market, step);
    const game = gameAt(step);
    expect(project(scrambled, game, step + 1).prices).not.toEqual(project(market, game, step + 1).prices);
    expect(project(scrambled, game, 1800 + 800).news).not.toEqual(project(market, game, 1800 + 800).news);
  });

  it('shows a headline outcome only from the bell, and the reveal moment only once it has passed', () => {
    const game = startedGame(market);
    let sawHidden = false;
    let sawRevealed = false;
    for (let step = 0; step <= GAME_STEPS; step += 7) {
      const frame = project(market, advanceTo(market, game, step), step, false);
      const { day, priceIndex, phase } = momentAt(step);
      const bellRung = phase === 'debrief' || phase === 'final';
      expect(frame.news).toHaveLength(3);
      for (const item of frame.news) {
        expect(item.day).toBe(day);
        expect('wasTrue' in item).toBe(bellRung);
        expect('revealIndex' in item).toBe(item.revealed);
        if (item.revealed) expect(item.revealIndex).toBeLessThanOrEqual(priceIndex);
        expect(Object.keys(item)).not.toContain('move');
        expect(Object.keys(item)).not.toContain('hidden');
        sawHidden ||= !item.revealed;
        sawRevealed ||= item.revealed && !bellRung;
      }
    }
    expect(sawHidden && sawRevealed).toBe(true);
  });

  it('never shows the seed, and shows the market number only at the end', () => {
    for (let step = 0; step < GAME_STEPS; step += 49) {
      const frame = project(market, gameAt(step), step);
      const json = JSON.stringify(frame);
      expect(frame.final).toBeUndefined();
      expect(json).not.toContain(String(TEST_SEED));
      expect(json).not.toContain(MARKET_CODE);
      expect(json).not.toContain('seed');
    }
    const last = project(market, gameAt(GAME_STEPS), GAME_STEPS);
    expect(JSON.stringify(last)).not.toContain(String(TEST_SEED));
    expect(last.final).toEqual({
      marketCode: MARKET_CODE,
      engine: ENGINE_VERSION,
      content: CONTENT_VERSION,
      finalCents: last.account.cashCents,
      changeCents: last.account.cashCents - 100_000_000,
    });
    expect(project(market, gameAt(GAME_STEPS - 1), GAME_STEPS - 1).final).toBeUndefined();
  });
});

describe('projectFrame', () => {
  it('shows the lobby with no board, no quotes and no news', () => {
    const frame = project(market, newGame(), 0);
    expect(frame).toMatchObject({
      t: 'frame',
      session: 'session-1',
      rev: 0,
      step: 0,
      clock: { phase: 'lobby', day: 0, pace: null },
      board: null,
      quotes: [],
      quoteReals: [],
      quoteHopes: [],
      quoteBreakEvens: [],
      news: [],
      positions: [],
      account: { cashCents: 100_000_000, worthCents: 100_000_000, canBuy: false },
    });
    expect(frame.history).toBeUndefined();
    expect(frame.final).toBeUndefined();
    expect(frameSchema.parse(frame)).toEqual(frame);
  });

  it('shows the lobby prices of the cast the market was built on', () => {
    const small = buildMarket(TEST_IDENTITY, { cast: TEST_CAST });
    expect(project(small, newGame(), 0).prices).toEqual([10_000, 5_000, 2_000, 20_000]);
  });

  it('shows a rejected command in the lobby too', () => {
    const game = applyCommand(market, newGame(), ME, cashOut('d1'), 0).game;
    expect(project(market, game, 0).receipts).toHaveLength(1);
  });

  it('passes the frame schema at every kind of moment, in both forms', () => {
    for (const form of FORMS) {
      for (const [, step] of STEPS) {
        for (const history of [true, false]) {
          const frame = project(market, gameAt(step), step, history, form);
          expect(frameSchema.parse(frame)).toEqual(frame);
        }
      }
    }
  });

  it('carries one quote per contract, all whole dollars', () => {
    const frame = project(market, gameAt(400), 400);
    expect(frame.quotes).toHaveLength(252);
    expect(frame.board?.companies).toHaveLength(6);
    expect(frame.prices).toHaveLength(6);
    for (const quote of frame.quotes) {
      expect(Number.isInteger(quote) && quote >= 0 && quote % 100 === 0).toBe(true);
    }
    expect(frame.quotes[7]).toBe(priceOf(market, 1, 100, 7));
  });

  it('still carries one quote per contract, and says what is offered, when the board is trimmed', () => {
    const trimmed = buildMarket(TEST_IDENTITY, { offeredPassedMoves: 0.4 });
    const full = project(market, startedGame(market), 400, false);
    const frame = project(trimmed, startedGame(trimmed), 400, false);
    expect(frame.quotes).toHaveLength(252);
    expect(frame.quotes).toEqual(full.quotes);
    expect(full.board?.companies.map((company) => [company.lowestUpIndex, company.highestDownIndex])).toEqual(Array.from({ length: 6 }, () => [0, 20]));
    for (const company of frame.board?.companies ?? []) {
      expect(company.lowestUpIndex).toBeGreaterThan(0);
      expect(company.highestDownIndex).toBeLessThan(20);
    }
    expect(frameSchema.parse(frame)).toEqual(frame);
    expect(frameSchema.parse(full)).toEqual(full);
  });

  it('sends history from the opening price to now, only when asked', () => {
    for (const step of [100, 300, 301, 650, 800, 850, 900, GAME_STEPS]) {
      const frame = project(market, gameAt(step), step, true);
      const { priceIndex } = momentAt(step);
      expect(frame.history).toHaveLength(6);
      frame.history?.forEach((series, companyId) => {
        expect(series).toHaveLength(priceIndex + 1);
        expect(series[priceIndex]).toBe(frame.prices[companyId]);
      });
      expect(project(market, gameAt(step), step, false).history).toBeUndefined();
    }
  });

  it('makes worth equal to cash plus what the open ticket would sell for', () => {
    const step = 1800 + 300 + 100;
    const game = gameAt(step);
    const frame = project(market, game, step);
    const open = frame.positions.filter((position) => position.status === 'open');
    expect(open).toHaveLength(1);
    expect(frame.positions.map((position) => position.status)).toEqual(['cashedOut', 'settled', 'open']);
    const position = open[0];
    expect(position?.valueCents).toBe(priceOf(market, 3, 100, position?.contractId ?? -1) * (position?.quantity ?? NaN));
    expect(position?.realCents ?? NaN).toBeGreaterThanOrEqual(0);
    expect((position?.realCents ?? NaN) + (position?.hopeCents ?? NaN)).toBe(priceOf(market, 3, 100, position?.contractId ?? -1));
    expect(frame.account.cashCents).toBe(me(game).cashCents);
    expect(frame.account.worthCents).toBe(me(game).cashCents + (position?.valueCents ?? NaN));
    expect(frame.account.canBuy).toBe(false);

    const after = project(market, advanceTo(market, game, 1800 + 800), 1800 + 800);
    expect(after.account.worthCents).toBe(after.account.cashCents);
    expect(after.account.cashCents).toBe(me(game).cashCents + (after.positions[2]?.exit?.proceedsCents ?? NaN));
  });

  it('tells a cashed-out ticket what holding on would be worth, from its own day only', () => {
    const during = project(market, gameAt(600), 600).positions[0];
    expect(during).toMatchObject({ status: 'cashedOut', exit: { kind: 'cashOut', step: 500, priceIndex: 200 } });
    expect(during?.ifHeldCents).toBe(priceOf(market, 1, 300, during?.contractId ?? -1) * (during?.quantity ?? NaN));
    const nextDay = project(market, gameAt(1000), 1000).positions[0];
    expect(nextDay?.ifHeldCents).toBe(priceOf(market, 1, 500, nextDay?.contractId ?? -1) * (nextDay?.quantity ?? NaN));
    expect(nextDay?.valueCents).toBe(during?.valueCents);
  });

  it('says when buying is possible', () => {
    const game = startedGame(market);
    expect(project(market, game, 100).account.canBuy).toBe(true);
    expect(project(market, game, 799).account.canBuy).toBe(true);
    expect(project(market, advanceTo(market, game, 800), 800).account.canBuy).toBe(false);
    expect(project(market, gameAt(400), 400).account.canBuy).toBe(false);
    const stress = startedGame(market, { targetsPerCompany: 209 });
    const frame = project(market, stress, 400);
    expect(frame.account.canBuy).toBe(false);
    expect(frame.stress).toBe(true);
    expect(frame.quotes).toHaveLength(2508);
    const liveStress = projectLive(market, stress, 400);
    expect(liveStress.board?.targetsPerCompany).toBe(209);
    expect([liveStress.quotes.length, liveStress.quoteReals.length, liveStress.quoteHopes.length]).toEqual([2508, 2508, 2508]);
  });

  it('lists one result per finished day', () => {
    const frame = project(market, gameAt(1800 + 850), 1800 + 850);
    expect(frame.days.map((result) => result.day)).toEqual([1, 2, 3]);
    expect(frame.days[0]?.startCents).toBe(100_000_000);
    expect(frame.days[1]?.startCents).toBe(frame.days[0]?.endCents);
    expect(frame.days[2]?.endCents).toBe(frame.account.cashCents);
  });

  it('carries the latest 20 receipts', () => {
    let game = startedGame(market);
    for (let i = 0; i < 30; i += 1) game = applyCommand(market, game, ME, start(1), 10 + i).game;
    const frame = project(market, game, 40);
    expect(frame.receipts).toHaveLength(20);
    expect(frame.receipts[19]).toEqual(me(game).receipts[30]);
    expect(frame.rev).toBe(31);
  });

  it('stays small: a typical 252-contract frame is under 16 KB without history', () => {
    const step = 1800 + 300 + 400;
    const size = (history: boolean) => JSON.stringify(project(market, gameAt(step), step, history)).length;
    expect(size(false)).toBeLessThan(16_000);
    expect(size(true)).toBeLessThan(40_000);
  });
});

/** The six companies of the real cast as a player may see them. Written out: the frame must carry exactly this and no more. */
const REAL_NAMES = [
  { ticker: 'RPUP', name: 'RoboPup', product: 'robot pets' },
  { ticker: 'FIZZ', name: 'Fizzly', product: 'fizzy drinks' },
  { ticker: 'JETK', name: 'JetKicks', product: 'jet sneakers' },
  { ticker: 'MUNC', name: 'MoonMunch', product: 'space snacks' },
  { ticker: 'PIXL', name: 'PixelPals', product: 'video games' },
  { ticker: 'ZAPP', name: 'ZapCharge', product: 'super batteries' },
];

describe('projectFrame, the names and the cheapest tradable price', () => {
  const everyMoment = (): [string, GameState, number][] => [
    ['the lobby', newGame(), 0],
    ...STEPS.map(([name, step]): [string, GameState, number] => [name, gameAt(step), step]),
  ];

  it.each(FORMS)('%s form: one entry per company in id order, at every moment, the lobby included', (form) => {
    for (const [name, game, step] of everyMoment()) {
      expect({ name, companies: project(market, game, step, false, form).companies }).toEqual({ name, companies: REAL_NAMES });
    }
  });

  it.each(FORMS)('%s form: a company entry has a ticker, a name, what it makes and no other key', (form) => {
    for (const [name, game, step] of everyMoment()) {
      const { companies } = project(market, game, step, false, form);
      expect(companies).toHaveLength(6);
      for (const company of companies) expect({ name, keys: Object.keys(company).sort() }).toEqual({ name, keys: ['name', 'product', 'ticker'] });
    }
  });

  it('names the cast the market was built on', () => {
    const small = buildMarket(TEST_IDENTITY, { cast: TEST_CAST });
    const expected = [
      { ticker: 'TSTA', name: 'Test Alpha', product: 'test kites' },
      { ticker: 'TSTB', name: 'Test Bravo', product: 'test juice' },
      { ticker: 'TSTC', name: 'Test Charlie', product: 'test snacks' },
      { ticker: 'TSTD', name: 'Test Delta', product: 'test cells' },
    ];
    expect(project(small, newGame(), 0).companies).toEqual(expected);
    expect(projectLive(small, startedGame(small), 400).companies).toEqual(expected);
  });

  it.each(FORMS)('%s form: carries the cheapest tradable price at every moment, the lobby included', (form) => {
    for (const [name, game, step] of everyMoment()) {
      expect({ name, minTicketCents: project(market, game, step, false, form).minTicketCents }).toEqual({ name, minTicketCents: MIN_TICKET_PRICE_CENTS });
    }
  });
});

describe('projectFrame, each ticket price with its real value and its hope value', () => {
  it.each(STEPS_IN_BOTH_FORMS)('%s form, %s: 252 of each, from the one pricing call at the current point of the path', (form, _name, step) => {
    const { day, priceIndex } = momentAt(step);
    const frame = project(market, gameAt(step), step, false, form);
    const board = boardFor(market, day, 21);
    expect(frame.quotes).toHaveLength(252);
    expect(frame.quoteReals).toHaveLength(252);
    expect(frame.quoteHopes).toHaveLength(252);
    for (let id = 0; id < 252; id += 1) {
      const value = quoteAt(market, day, priceIndex, board, id);
      expect({ id, price: frame.quotes[id], real: frame.quoteReals[id], hope: frame.quoteHopes[id] }).toEqual({
        id,
        price: value?.priceCents,
        real: value?.realCents,
        hope: value?.hopeCents,
      });
    }
  });

  it.each(STEPS_IN_BOTH_FORMS)('%s form, %s: real plus hope is the price on every contract, all three whole cents from zero', (form, _name, step) => {
    const frame = project(market, gameAt(step), step, false, form);
    frame.quotes.forEach((price, id) => {
      const real = frame.quoteReals[id] ?? NaN;
      const hope = frame.quoteHopes[id] ?? NaN;
      expect({ id, sum: real + hope }).toEqual({ id, sum: price });
      for (const cents of [price, real, hope]) expect(Number.isInteger(cents) && cents >= 0).toBe(true);
    });
  });

  it.each(FORMS)('%s form: at the bell no hope is left, and before it some is', (form) => {
    for (const step of [1800 + 800, 1800 + 850, GAME_STEPS]) {
      expect(momentAt(step).priceIndex).toBe(OPEN_STEPS);
      const frame = project(market, gameAt(step), step, false, form);
      expect(frame.quoteHopes).toEqual(Array.from({ length: 252 }, () => 0));
      expect(frame.quoteReals).toEqual(frame.quotes);
    }
    const open = project(market, gameAt(1800 + 300 + 250), 1800 + 300 + 250, false, form);
    expect(open.quoteHopes.some((hope) => hope > 0)).toBe(true);
    expect(open.quoteReals.some((real) => real > 0)).toBe(true);
  });
});

describe('projectFrame, each ticket\'s break-even', () => {
  it.each(STEPS_IN_BOTH_FORMS)('%s form, %s: 252 whole-cent break-evens, each its target plus (UP) or minus (DOWN) the ticket price over 100 shares', (form, _name, step) => {
    const frame = project(market, gameAt(step), step, false, form);
    const targetsPerCompany = frame.board?.targetsPerCompany ?? NaN;
    expect(frame.quoteBreakEvens).toHaveLength(252);
    frame.quoteBreakEvens.forEach((breakEven, id) => {
      const { companyId, targetIndex, side } = decodeContractId(targetsPerCompany, id);
      const target = frame.board?.companies[companyId]?.targets[targetIndex] ?? NaN;
      const perShare = (frame.quotes[id] ?? NaN) / 100;
      expect({ id, whole: Number.isInteger(breakEven) }).toEqual({ id, whole: true });
      expect({ id, breakEven }).toEqual({ id, breakEven: side === 'up' ? target + perShare : target - perShare });
    });
  });

  it.each(FORMS)('%s form: the lobby has none', (form) => {
    expect(project(market, newGame(), 0, false, form).quoteBreakEvens).toEqual([]);
  });

  it('a ticket bought at a step breaks even where the frame of that same step said it would', () => {
    for (const [step, bought] of [[320, 0], [1800 + 330, 2]] as const) {
      const frame = project(market, gameAt(step), step);
      const position = frame.positions[bought];
      expect(position?.entryStep).toBe(step);
      expect(position?.breakEvenCents).toBe(frame.quoteBreakEvens[position?.contractId ?? -1]);
    }
  });
});

describe('projectFrame, profit, a day\'s change and the headline\'s direction', () => {
  it.each(STEPS)('%s: an open ticket has made its worth minus its cost, a closed one what it paid minus its cost', (_name, step) => {
    for (const position of project(market, gameAt(step), step).positions) {
      const made = position.exit === undefined ? position.valueCents : position.exit.proceedsCents;
      expect({ id: position.id, profitCents: position.profitCents }).toEqual({ id: position.id, profitCents: made - position.costCents });
    }
  });

  it('the sampled moments really hold an open, a cashed-out and a settled ticket', () => {
    const statuses = new Set(STEPS.flatMap(([, step]) => project(market, gameAt(step), step).positions.map((position) => position.status)));
    expect([...statuses].sort()).toEqual(['cashedOut', 'open', 'settled']);
  });

  it('a ticket that settled at $0 has lost exactly what it cost', () => {
    const worthless = findContract(market, 1, (id) => isTradable(priceOf(market, 1, 10, id)) && priceOf(market, 1, OPEN_STEPS, id) === 0);
    const held = applyCommand(market, startedGame(market), ME, buyCommand({ day: 1, contractId: worthless, spendCents: 5_000_000, seenPriceCents: priceOf(market, 1, 10, worthless) }), 310);
    expect(held.receipt.outcome).toBe('accepted');
    const position = project(market, advanceTo(market, held.game, 800), 800).positions[0];
    expect(position).toMatchObject({ status: 'settled', valueCents: 0, exit: { kind: 'bell', proceedsCents: 0 } });
    expect(position?.costCents).toBeGreaterThan(0);
    expect(position?.profitCents).toBe(-(position?.costCents ?? NaN));
  });

  it('every finished day says what it changed, and the final screen what the whole game changed', () => {
    const last = project(market, gameAt(GAME_STEPS), GAME_STEPS);
    expect(last.days).toHaveLength(5);
    for (const result of last.days) {
      expect({ day: result.day, changeCents: result.changeCents }).toEqual({ day: result.day, changeCents: result.endCents - result.startCents });
    }
    expect(last.final?.changeCents).toBe((last.final?.finalCents ?? NaN) - 100_000_000);
    expect(last.days.reduce((sum, result) => sum + result.changeCents, 0)).toBe(last.final?.changeCents);
  });

  it('every headline of every day points up or down', () => {
    const game = startedGame(market);
    const seen = new Set<string>();
    for (let step = 0; step <= GAME_STEPS; step += 450) {
      const frame = project(market, advanceTo(market, game, step), step, false);
      expect(frame.news).toHaveLength(3);
      for (const item of frame.news) {
        expect(['up', 'down']).toContain(item.direction);
        seen.add(item.direction);
      }
    }
    expect([...seen].sort()).toEqual(['down', 'up']);
  });

  it('a headline\'s direction is public before the bell and does not move when its outcome is scrambled', () => {
    const step = 300 + 60;
    const game = gameAt(step);
    const scrambled = scrambleFuture(market, step);
    expect(marketDay(scrambled, 1).news.map((item) => item.hidden.wasTrue)).not.toEqual(marketDay(market, 1).news.map((item) => item.hidden.wasTrue));
    const directions = (source: Market) => project(source, game, step).news.map((item) => item.direction);
    expect(directions(scrambled)).toEqual(directions(market));
    expect(directions(market)).toEqual(marketDay(market, 1).news.map((item) => item.headline.direction));
  });
});

describe('projectFrame, the ticket being built', () => {
  const DRAFT: DraftRequest = { contractId: 0, spendCents: 10_000_000 };
  const projectDraft = (source: Market, game: GameState, step: number, draft: DraftRequest | null, sections: ProjectOptions['sections'] = 'full'): Frame =>
    projectFrame(source, game, ME, step, { session: 'session-1', history: true, sections, draft });

  it.each(STEPS)('%s: scrambling everything still to come gives the identical frame, draft section included', (_name, step) => {
    const game = gameAt(step);
    const frame = projectDraft(market, game, step, DRAFT);
    expect(frame.draft).toMatchObject({ contractId: 0, spendCents: 10_000_000 });
    expect(frame.draft?.costs).toHaveLength(252);
    expect(projectDraft(scrambleFuture(market, step), game, step, DRAFT)).toEqual(frame);
  });

  it('the live form never has a draft section, whatever is asked', () => {
    for (const [, step] of STEPS) expect('draft' in projectDraft(market, gameAt(step), step, DRAFT, 'live')).toBe(false);
  });

  it('the lobby never has one, in either form', () => {
    for (const form of FORMS) expect('draft' in projectDraft(market, newGame(), 0, DRAFT, form)).toBe(false);
  });

  it('the full form has none when nothing is asked, or when what is asked is empty', () => {
    const step = 1800 + 300 + 250;
    expect('draft' in project(market, gameAt(step), step)).toBe(false);
    expect('draft' in projectDraft(market, gameAt(step), step, null)).toBe(false);
    expect('draft' in projectDraft(market, gameAt(step), step, { contractId: null, spendCents: null })).toBe(false);
  });

  it.each(STEPS)('%s: the quoted ticket shows the price and the break-even of its own row, and makes $0 exactly at its break-even', (_name, step) => {
    let bought = 0;
    for (let contractId = 0; contractId < 252; contractId += 17) {
      const frame = projectDraft(market, gameAt(step), step, { contractId, spendCents: 10_000_000 });
      const ticket = frame.draft?.ticket;
      expect({ contractId, priceCents: ticket?.priceCents }).toEqual({ contractId, priceCents: frame.quotes[contractId] });
      expect({ contractId, breakEvenCents: ticket?.breakEvenCents }).toEqual({ contractId, breakEvenCents: frame.quoteBreakEvens[contractId] });
      expect(frameSchema.parse(frame)).toEqual(frame);
      if ((ticket?.quantity ?? 0) === 0) continue;
      bought += 1;
      expect(ticket?.whatIf.filter((stop) => stop.atCents === ticket.breakEvenCents)).toEqual([{ atCents: ticket?.breakEvenCents, profitCents: 0 }]);
      expect(ticket?.costCents).toBe(frame.draft?.costs?.[contractId]);
    }
    expect(bought).toBeGreaterThan(0);
  });
});

describe('projectFrame, live form', () => {
  const EMPTY_SECTIONS = { news: [], positions: [], receipts: [], days: [] };
  const LIVE_KEYS = [
    'account',
    'board',
    'clock',
    'companies',
    'days',
    'minTicketCents',
    'news',
    'positions',
    'prices',
    'quoteBreakEvens',
    'quoteHopes',
    'quoteReals',
    'quotes',
    'receipts',
    'rev',
    'session',
    'step',
    'stress',
    't',
  ];

  const MOMENTS: [string, number][] = [
    ['a step before the opening bell', 100],
    ['an open step', 1800 + 300 + 250],
    ['a debrief step', 1800 + 850],
    ['the last step of the game', GAME_STEPS],
  ];

  it('shows the lobby with no board and no ticket price, and every other section empty, even after a refused command', () => {
    const game = applyCommand(market, newGame(), ME, cashOut('d1'), 0).game;
    expect(me(game).receipts).toHaveLength(1);
    const frame = projectLive(market, game, 0, true);
    expect(frame).toMatchObject({
      ...EMPTY_SECTIONS,
      board: null,
      quotes: [],
      quoteReals: [],
      quoteHopes: [],
      quoteBreakEvens: [],
      t: 'frame',
      session: 'session-1',
      rev: 1,
      step: 0,
      clock: { phase: 'lobby', day: 0, stepsLeft: 0, priceIndex: 0, pace: null },
      account: { cashCents: 100_000_000, worthCents: 100_000_000, capCents: 50_000_000, canBuy: false },
      stress: false,
    });
    expect(frame.prices).toHaveLength(6);
    expect('history' in frame).toBe(false);
    expect('final' in frame).toBe(false);
    expect(Object.keys(frame).sort()).toEqual(LIVE_KEYS);
    expect(frameSchema.parse(frame)).toEqual(frame);
  });

  it.each(MOMENTS)('%s: the clock, six prices, the names, the board, the ticket prices and the account are filled, and nothing else', (_name, step) => {
    // The game holds tickets, receipts and finished days by now; none of it may show.
    const game = gameAt(step);
    expect(me(game).receipts.length).toBeGreaterThan(0);
    const frame = projectLive(market, game, step, true);
    expect(frame).toMatchObject({
      ...EMPTY_SECTIONS,
      rev: me(game).rev,
      step,
      clock: { ...momentAt(step), pace: 1 },
      account: { cashCents: me(game).cashCents, worthCents: me(game).cashCents, capCents: spendCapCents(me(game).cashCents), canBuy: false },
      stress: false,
    });
    expect('history' in frame).toBe(false);
    expect('final' in frame).toBe(false);
    expect(Object.keys(frame).sort()).toEqual(LIVE_KEYS);
    expect(frameSchema.parse(frame)).toEqual(frame);
  });

  it.each(STEPS)('%s: carries the day\'s board exactly as built, nothing trimmed', (_name, step) => {
    const frame = projectLive(market, gameAt(step), step);
    expect(frame.board).toEqual(boardFor(market, momentAt(step).day, 21));
    expect(frame.board?.targetsPerCompany).toBe(21);
    expect(frame.board?.companies.map((company) => company.targets.length)).toEqual([21, 21, 21, 21, 21, 21]);
    expect(frame.board?.companies.map((company) => [company.lowestUpIndex, company.highestDownIndex])).toEqual(Array.from({ length: 6 }, () => [0, 20]));
  });

  it('shows the same board and the same ticket prices as the full form', () => {
    for (const [, step] of STEPS) {
      const game = gameAt(step);
      const full = project(market, game, step, false);
      const live = projectLive(market, game, step);
      expect(live.board).toEqual(full.board);
      expect(live.quotes).toEqual(full.quotes);
      expect(live.quoteReals).toEqual(full.quoteReals);
      expect(live.quoteHopes).toEqual(full.quoteHopes);
      expect(live.quoteBreakEvens).toEqual(full.quoteBreakEvens);
    }
  });

  it('never carries the seed or the market number, not even on the final screen', () => {
    for (const step of [0, 100, 1800 + 300 + 250, GAME_STEPS - 1, GAME_STEPS]) {
      const json = JSON.stringify(projectLive(market, gameAt(step), step, true));
      expect(json).not.toContain(String(TEST_SEED));
      expect(json).not.toContain(MARKET_CODE);
      expect(json).not.toContain('seed');
    }
  });

  it('every price is a whole number of cents from the one rounding function, at the current point of the path', () => {
    for (let step = 0; step <= GAME_STEPS; step += 37) {
      const { day, priceIndex } = momentAt(step);
      const frame = projectLive(market, advanceTo(market, startedGame(market), step), step);
      expect(frame.prices).toHaveLength(6);
      frame.prices.forEach((price, companyId) => {
        expect(Number.isInteger(price)).toBe(true);
        expect(price).toBe(sharePriceCents(marketDay(market, day).paths[companyId]?.[priceIndex] ?? NaN));
      });
    }
  });

  it('shows the same prices as the full form', () => {
    for (const [, step] of STEPS) {
      const game = gameAt(step);
      const full = project(market, game, step, false);
      const live = projectLive(market, game, step);
      expect(live.prices).toEqual(full.prices);
      expect(live.clock).toEqual(full.clock);
      expect(live.rev).toBe(full.rev);
    }
  });

  it('is the same for a game that holds tickets and receipts as for one that holds none, cash and rev aside', () => {
    const step = 1800 + 300 + 100;
    const busy = projectLive(market, gameAt(step), step);
    const idle = projectLive(market, advanceTo(market, startedGame(market), step), step);
    expect(busy.rev).not.toBe(idle.rev);
    expect(busy.account.cashCents).not.toBe(idle.account.cashCents);
    const cashBlind = (frame: Frame) => ({ ...frame, rev: 0, account: { canBuy: frame.account.canBuy } });
    expect(cashBlind(busy)).toEqual(cashBlind(idle));
  });

  /**
   * A copy of the market in which reading anything a live frame has no
   * business with throws: a price past `step`'s point of the path, any other
   * day, a headline's wording, and what a headline did to the price. The
   * reveal moment stays readable: pricing reads it, and the scramble case is
   * what proves the result does not depend on it while it is still to come.
   */
  function sealFuture(source: Market, step: number): Market {
    const sealed = structuredClone(source);
    const { day, priceIndex } = momentAt(step);
    const refuse = (what: string) => ({
      get(): never {
        throw new Error(`${what} was read`);
      },
    });
    sealed.days.forEach((marketDayData) => {
      if (marketDayData.day !== day) {
        Object.defineProperty(marketDayData, 'paths', refuse('another day\'s prices'));
        Object.defineProperty(marketDayData, 'news', refuse('another day\'s headlines'));
        return;
      }
      marketDayData.paths = marketDayData.paths.map(
        (path) =>
          new Proxy(path, {
            get(target, key, receiver): unknown {
              if (typeof key === 'string' && /^\d+$/.test(key) && Number(key) > priceIndex) throw new Error('a price still to come was read');
              return Reflect.get(target, key, receiver);
            },
          }),
      );
      marketDayData.news.forEach((item) => {
        Object.defineProperty(item.hidden, 'move', refuse('a headline\'s move'));
        Object.defineProperty(item.hidden, 'wasTrue', refuse('a headline\'s outcome'));
        Object.defineProperty(item.headline, 'title', refuse('a headline\'s wording'));
        Object.defineProperty(item.headline, 'body', refuse('a headline\'s wording'));
        Object.defineProperty(item.headline, 'source', refuse('a headline\'s wording'));
      });
    });
    return sealed;
  }

  it.each(STEPS)('%s: reads no price still to come, no other day, no headline wording and no outcome', (_name, step) => {
    const game = gameAt(step);
    expect(projectLive(sealFuture(market, step), game, step)).toEqual(projectLive(market, game, step));
  });

  it('the seal really refuses: the full form reads the wording, and one step on reads the next price', () => {
    const step = 1800 + 300 + 100;
    const game = gameAt(step);
    const sealed = sealFuture(market, step);
    expect(() => project(sealed, game, step, false)).toThrow('another day\'s headlines was read');
    expect(() => projectLive(sealed, game, step + 1)).toThrow('a price still to come was read');
  });

  it('stays small: under 8 KB with the board and 252 ticket prices, and under 1 KB in the lobby', () => {
    const step = 1800 + 300 + 400;
    expect(JSON.stringify(projectLive(market, gameAt(step), step)).length).toBeLessThan(8_000);
    expect(JSON.stringify(projectLive(market, newGame(), 0)).length).toBeLessThan(1_000);
  });
});
