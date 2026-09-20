import { describe, expect, it } from 'vitest';
import { GAME_STEPS, OPEN_STEPS, bellStep, momentAt } from '../src/clock';
import type { ProjectOptions } from '../src/frame';
import { projectFrame } from '../src/frame';
import type { GameState } from '../src/game';
import { advanceTo, applyCommand, newGame, spendCapCents } from '../src/game';
import type { Market } from '../src/market';
import { marketDay } from '../src/market';
import { sharePriceCents } from '../src/money';
import { isTradable } from '../src/pricing';
import type { Frame } from '../src/protocol';
import { frameSchema } from '../src/protocol';
import { seedToMarketCode } from '../src/rng';
import { TEST_SEED, buyCommand, cashOut, findContract, priceOf, start, startedGame, testMarket } from './helpers';

const market = testMarket();
const MARKET_CODE = seedToMarketCode(TEST_SEED);

/**
 * A copy of the market in which everything that has not happened yet at
 * `step` is replaced with something else: the rest of today's prices, the
 * outcome of every headline whose move has not landed (and, until the bell,
 * the truth of those that have), and every later day entirely.
 */
function scrambleFuture(source: Market, step: number): Market {
  const copy = structuredClone(source);
  const { day, priceIndex } = momentAt(step);
  copy.days.forEach((marketDay) => {
    if (marketDay.day < day) return;
    const today = marketDay.day === day;
    const from = today ? priceIndex + 1 : 0;
    marketDay.paths = marketDay.paths.map((path) => path.map((price, index) => (index < from ? price : price * 1.37 + 11 + index)));
    marketDay.news.forEach((item) => {
      const landed = today && item.hidden.revealIndex <= priceIndex;
      if (!landed) {
        const firstFuture = today ? priceIndex + 1 : 1;
        item.hidden.revealIndex = item.hidden.revealIndex === firstFuture ? firstFuture + 1 : firstFuture;
      }
      if (!today || priceIndex < OPEN_STEPS) {
        item.hidden.wasTrue = !item.hidden.wasTrue;
        item.hidden.move = -3 * item.hidden.move + 0.01;
      }
      if (!today) {
        item.headline.title = 'scrambled';
        item.headline.body = 'scrambled';
        item.headline.trust = item.headline.trust === 1 ? 3 : 1;
        item.headline.companyId = (item.headline.companyId + 1) % 6;
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
  const command = buyCommand({ day, contractId: contract, spendCents: spendCapCents(game.cashCents), seenPriceCents: priceOf(market, day, priceIndex, contract) });
  let next = applyCommand(market, game, command, base + buyInDay);
  expect(next.receipt.outcome).toBe('accepted');
  if (cashOutInDay !== undefined) {
    next = applyCommand(market, next.game, cashOut(`d${day}`), base + cashOutInDay);
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
  projectFrame(source, game, step, sections === undefined ? { session: 'session-1', history } : { session: 'session-1', history, sections });

const projectLive = (source: Market, game: GameState, step: number, history = false): Frame => project(source, game, step, history, 'live');

const FORMS = ['full', 'live'] as const;
const STEPS_IN_BOTH_FORMS = FORMS.flatMap((form) => STEPS.map(([name, step]): [(typeof FORMS)[number], string, number] => [form, name, step]));

describe('projectFrame keeps the future secret', () => {
  it.each(STEPS_IN_BOTH_FORMS)('%s form, %s: scrambling everything still to come gives the identical frame', (form, _name, step) => {
    const game = gameAt(step);
    const scrambled = scrambleFuture(market, step);
    // After the last bell nothing is left to scramble.
    if (step < bellStep(5)) expect(scrambled).not.toEqual(market);
    expect(project(scrambled, game, step, true, form)).toEqual(project(market, game, step, true, form));
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
    expect(last.final).toEqual({ marketCode: MARKET_CODE, engine: 'e-test', content: 'c-test', finalCents: last.account.cashCents });
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
      news: [],
      positions: [],
      account: { cashCents: 100_000_000, worthCents: 100_000_000, canBuy: false },
    });
    expect(frame.history).toBeUndefined();
    expect(frame.final).toBeUndefined();
    expect(frameSchema.parse(frame)).toEqual(frame);
  });

  it('shows a rejected command in the lobby too', () => {
    const game = applyCommand(market, newGame(), cashOut('d1'), 0).game;
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
    expect(frame.account.cashCents).toBe(game.cashCents);
    expect(frame.account.worthCents).toBe(game.cashCents + (position?.valueCents ?? NaN));
    expect(frame.account.canBuy).toBe(false);

    const after = project(market, advanceTo(market, game, 1800 + 800), 1800 + 800);
    expect(after.account.worthCents).toBe(after.account.cashCents);
    expect(after.account.cashCents).toBe(game.cashCents + (after.positions[2]?.exit?.proceedsCents ?? NaN));
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
    for (let i = 0; i < 30; i += 1) game = applyCommand(market, game, start(1), 10 + i).game;
    const frame = project(market, game, 40);
    expect(frame.receipts).toHaveLength(20);
    expect(frame.receipts[19]).toEqual(game.receipts[30]);
    expect(frame.rev).toBe(31);
  });

  it('stays small: a typical 252-contract frame is under 16 KB without history', () => {
    const step = 1800 + 300 + 400;
    const size = (history: boolean) => JSON.stringify(project(market, gameAt(step), step, history)).length;
    expect(size(false)).toBeLessThan(16_000);
    expect(size(true)).toBeLessThan(40_000);
  });
});

describe('projectFrame, live form', () => {
  const EMPTY_SECTIONS = { board: null, quotes: [], news: [], positions: [], receipts: [], days: [] };

  const MOMENTS: [string, number][] = [
    ['a step before the opening bell', 100],
    ['an open step', 1800 + 300 + 250],
    ['a debrief step', 1800 + 850],
    ['the last step of the game', GAME_STEPS],
  ];

  it('shows the lobby with every other section empty, even after a refused command', () => {
    const game = applyCommand(market, newGame(), cashOut('d1'), 0).game;
    expect(game.receipts).toHaveLength(1);
    const frame = projectLive(market, game, 0, true);
    expect(frame).toMatchObject({
      ...EMPTY_SECTIONS,
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
    expect(frameSchema.parse(frame)).toEqual(frame);
  });

  it.each(MOMENTS)('%s: only the clock, six prices and the account are filled', (_name, step) => {
    // The game holds tickets, receipts and finished days by now; none of it may show.
    const game = gameAt(step);
    expect(game.receipts.length).toBeGreaterThan(0);
    const frame = projectLive(market, game, step, true);
    expect(frame).toMatchObject({
      ...EMPTY_SECTIONS,
      rev: game.rev,
      step,
      clock: { ...momentAt(step), pace: 1 },
      account: { cashCents: game.cashCents, worthCents: game.cashCents, capCents: spendCapCents(game.cashCents), canBuy: false },
      stress: false,
    });
    expect('history' in frame).toBe(false);
    expect('final' in frame).toBe(false);
    expect(Object.keys(frame).sort()).toEqual(
      ['account', 'board', 'clock', 'days', 'news', 'positions', 'prices', 'quotes', 'receipts', 'rev', 'session', 'step', 'stress', 't'],
    );
    expect(frameSchema.parse(frame)).toEqual(frame);
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

  it('builds no board and prices no ticket: it never reads the headlines, which both need', () => {
    const step = 1800 + 300 + 100;
    const game = gameAt(step);
    const sealed = structuredClone(market);
    sealed.days.forEach((day) => {
      Object.defineProperty(day, 'news', {
        get(): never {
          throw new Error('the headlines were read');
        },
      });
    });
    expect(() => project(sealed, game, step)).toThrow('the headlines were read');
    expect(projectLive(sealed, game, step)).toEqual(projectLive(market, game, step));
  });

  it('stays tiny: under 600 bytes', () => {
    const step = 1800 + 300 + 400;
    expect(JSON.stringify(projectLive(market, gameAt(step), step)).length).toBeLessThan(600);
  });
});
