import { describe, expect, it } from 'vitest';
import { isOffered } from '../src/board';
import { GAME_STEPS } from '../src/clock';
import type { GameState } from '../src/game';
import { STARTING_CASH_CENTS, advanceTo, applyCommand, breakEvenCents, newGame, spendCapCents, toleranceLimitCents, withinTolerance } from '../src/game';
import { boardFor, buildMarket } from '../src/market';
import { isTradable } from '../src/pricing';
import type { Command } from '../src/protocol';
import { contractId, decodeContractId } from '../src/protocol';
import { ME, TEST_IDENTITY, buyAt, buyCommand, cashOut, clockCommand, findContract, me, priceOf, start, startedGame, testMarket } from './helpers';

const market = testMarket();
const SPEND = 5_000_000;

/** A tradable contract on day 1, ten steps after the opening bell. */
const STEP = 310;
const INDEX = 10;
const CONTRACT = findContract(market, 1, (id) => isTradable(priceOf(market, 1, INDEX, id)));
const PRICE = priceOf(market, 1, INDEX, CONTRACT);

function bought(): GameState {
  const result = buyAt(market, startedGame(market), ME, STEP, 1, INDEX, CONTRACT, SPEND);
  expect(result.receipt.outcome).toBe('accepted');
  return result.game;
}

function boundaryMarket() {
  const source = structuredClone(market);
  source.days[0]!.news = [];
  source.days[0]!.paths[0] = Array<number>(501).fill(100);
  source.days[0]!.paths[0][498] = 110;
  source.days[0]!.paths[0][499] = 112;
  source.days[0]!.paths[0][500] = 120;
  return source;
}

describe('literal bell payment and receipt boundaries', () => {
  it.each([799, 800, 801])('distinguishes a buy and a cash-out received at step %i', (step) => {
    const source = boundaryMarket(); const initial = startedGame(source);
    const bought = applyCommand(source, initial, ME, buyCommand({ day: 1, contractId: 20, spendCents: 200000, seenPriceCents: 100000 }), 798);
    expect(me(bought.game).positions[0]).toMatchObject({ targetCents: 10000, quantity: 2, costCents: 200000 });
    const sale = applyCommand(source, bought.game, ME, cashOut('d1', 'sale'), step);
    // Two 100-share calls: $112-$100 gives $2,400 before the bell;
    // $120-$100 gives $4,000 at the bell. The original cost was $2,000.
    expect(me(sale.game).cashCents).toBe(step === 799 ? 100040000 : 100200000);
    expect(me(sale.game).positions[0]?.exit).toMatchObject({ kind: step === 799 ? 'cashOut' : 'bell', proceedsCents: step === 799 ? 240000 : 400000 });
    expect(sale.receipt.step).toBe(step);
    expect(me(sale.game).rev).toBe(step === 799 ? 3 : 4);
    const purchase = applyCommand(source, initial, ME, buyCommand({ day: 1, contractId: 20, spendCents: 240000, seenPriceCents: 120000 }), step);
    expect(purchase.receipt).toMatchObject(step === 799 ? { outcome: 'accepted' } : { outcome: 'rejected', reason: 'marketClosed' });
  });

  it.each([799, 800])('keeps same-ID altered payloads immutable but stores distinct attempts at step %i', (step) => {
    const source = boundaryMarket();
    const bought = applyCommand(source, startedGame(source), ME, buyCommand({ day: 1, contractId: 20, spendCents: 200000, seenPriceCents: 100000 }), 798);
    const first = applyCommand(source, bought.game, ME, cashOut('d1', 'sale'), step);
    for (const changed of [cashOut('unknown', 'sale'), start(1, 'sale')]) {
      const duplicate = applyCommand(source, first.game, ME, changed, GAME_STEPS);
      expect(duplicate).toEqual({ game: first.game, receipt: first.receipt, repeat: true });
      expect(duplicate.game).toBe(first.game);
    }
    let game = first.game;
    for (const commandId of ['second', 'third']) {
      const before = me(game);
      const next = applyCommand(source, game, ME, cashOut('d1', commandId), step);
      expect(next.repeat).toBe(false);
      expect(next.receipt).toMatchObject(step === 799 ? { outcome: 'rejected', reason: 'alreadyClosed' } : { outcome: 'accepted', positionId: 'd1' });
      expect(me(next.game).cashCents).toBe(step === 799 ? 100040000 : 100200000);
      expect(me(next.game).rev).toBe(before.rev + 1);
      expect(me(next.game).log).toHaveLength(before.log.length + 1);
      expect(me(next.game).receipts).toHaveLength(before.receipts.length + 1);
      game = next.game;
    }
    game = advanceTo(source, game, GAME_STEPS);
    const final = applyCommand(source, game, ME, cashOut('d1', 'final-sale'), GAME_STEPS);
    expect(final.receipt).toMatchObject(step === 799 ? { outcome: 'rejected', reason: 'alreadyClosed' } : { outcome: 'accepted' });
    expect(me(final.game).cashCents).toBe(step === 799 ? 100040000 : 100200000);
    expect(applyCommand(source, final.game, ME, cashOut('unknown'), GAME_STEPS).receipt.reason).toBe('unknownPosition');
    expect(advanceTo(source, final.game, GAME_STEPS)).toBe(final.game);
    expect(applyCommand(source, newGame(), ME, cashOut('d1'), 0).receipt.reason).toBe('notStarted');
  });
});

function expectRejected(game: GameState, command: Command, step: number, reason: string): void {
  const result = applyCommand(market, game, ME, command, step);
  expect(result.receipt).toMatchObject({ commandId: command.commandId, kind: command.t, outcome: 'rejected', reason });
  expect(result.repeat).toBe(false);
  expect(me(result.game).cashCents).toBe(me(game).cashCents);
  expect(me(result.game).positions).toEqual(me(game).positions);
}

describe('start', () => {
  it('leaves the lobby once, at the chosen pace', () => {
    const lobby = newGame();
    expect(lobby).toMatchObject({ step: 0, pace: null, stress: false });
    expect(me(lobby)).toMatchObject({ rev: 0, cashCents: 100_000_000 });
    const result = applyCommand(market, lobby, ME, start(3), 0);
    expect(result.receipt).toMatchObject({ kind: 'start', outcome: 'accepted', step: 0 });
    expect(result.game.pace).toBe(3);
    expectRejected(result.game, start(7.5), 5, 'alreadyStarted');
    expect(applyCommand(market, result.game, ME, start(7.5), 5).game.pace).toBe(3);
  });

  it('refuses every other command before it', () => {
    const lobby = newGame();
    expectRejected(lobby, buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE }), 0, 'notStarted');
    expectRejected(lobby, cashOut('d1'), 0, 'notStarted');
    expectRejected(lobby, clockCommand('openBell', 1), 0, 'notStarted');
  });
});

describe('buy', () => {
  it('takes exactly price x quantity out of cash', () => {
    const result = buyAt(market, startedGame(market), ME, STEP, 1, INDEX, CONTRACT, SPEND);
    const quantity = Math.floor(SPEND / PRICE);
    expect(quantity).toBeGreaterThan(0);
    expect(result.receipt).toEqual({ commandId: result.receipt.commandId, kind: 'buy', step: STEP, outcome: 'accepted', positionId: 'd1' });
    expect(me(result.game).cashCents).toBe(STARTING_CASH_CENTS - PRICE * quantity);
    const ref = decodeContractId(21, CONTRACT);
    expect(me(result.game).positions).toEqual([
      {
        id: 'd1',
        day: 1,
        contractId: CONTRACT,
        companyId: ref.companyId,
        side: ref.side,
        targetCents: boardFor(market, 1).companies[ref.companyId]?.targets[ref.targetIndex],
        quantity,
        entryPriceCents: PRICE,
        costCents: PRICE * quantity,
        entryStep: STEP,
        entryPriceIndex: INDEX,
      },
    ]);
  });

  it('is allowed before the opening bell, at the opening price', () => {
    const contract = findContract(market, 1, (id) => isTradable(priceOf(market, 1, 0, id)));
    const result = buyAt(market, startedGame(market), ME, 120, 1, 0, contract, SPEND);
    expect(result.receipt.outcome).toBe('accepted');
    expect(me(result.game).positions[0]).toMatchObject({ entryStep: 120, entryPriceIndex: 0, entryPriceCents: priceOf(market, 1, 0, contract) });
  });

  it('fills at the server price when that is better than the price seen', () => {
    const command = buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE * 2 });
    const result = applyCommand(market, startedGame(market), ME, command, STEP);
    expect(result.receipt.outcome).toBe('accepted');
    expect(me(result.game).positions[0]?.entryPriceCents).toBe(PRICE);
  });

  it('may spend up to the cap and not a cent more', () => {
    const cap = spendCapCents(STARTING_CASH_CENTS);
    expect(cap).toBe(50_000_000);
    expect(buyAt(market, startedGame(market), ME, STEP, 1, INDEX, CONTRACT, cap).receipt.outcome).toBe('accepted');
    expectRejected(startedGame(market), buyCommand({ day: 1, contractId: CONTRACT, spendCents: cap + 1, seenPriceCents: PRICE }), STEP, 'overCap');
  });

  it('rounds the cap down to whole thousands of dollars', () => {
    expect(spendCapCents(100_000_000)).toBe(50_000_000);
    expect(spendCapCents(87_654_321)).toBe(43_800_000);
    expect(spendCapCents(199_999)).toBe(0);
    expect(spendCapCents(0)).toBe(0);
  });

  it('refuses a spend above the cash in hand', () => {
    expectRejected(startedGame(market), buyCommand({ day: 1, contractId: CONTRACT, spendCents: STARTING_CASH_CENTS + 1, seenPriceCents: PRICE }), STEP, 'notEnoughCash');
  });

  it('closes at exactly the bell step', () => {
    const lastIndex = 499;
    const contract = findContract(market, 1, (id) => isTradable(priceOf(market, 1, lastIndex, id)));
    expect(buyAt(market, startedGame(market), ME, 799, 1, lastIndex, contract, SPEND).receipt.outcome).toBe('accepted');
    const command = buyCommand({ day: 1, contractId: contract, spendCents: SPEND, seenPriceCents: priceOf(market, 1, 500, contract) || 100 });
    expectRejected(startedGame(market), command, 800, 'marketClosed');
    expectRejected(startedGame(market), { ...command, commandId: 'later-in-debrief' }, 899, 'marketClosed');
  });

  it('allows one ticket a day, even after cashing it out', () => {
    const game = bought();
    expectRejected(game, buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE }), STEP + 1, 'alreadyBought');
    const sold = applyCommand(market, game, ME, cashOut('d1'), STEP + 5).game;
    const again = buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: priceOf(market, 1, INDEX + 6, CONTRACT) });
    expectRejected(sold, again, STEP + 6, 'alreadyBought');
  });

  it('refuses a contract that is too cheap to trade', () => {
    const cheap = findContract(market, 1, (id) => {
      const price = priceOf(market, 1, 450, id);
      return price > 0 && !isTradable(price);
    });
    const command = buyCommand({ day: 1, contractId: cheap, spendCents: SPEND, seenPriceCents: priceOf(market, 1, 450, cheap) });
    expectRejected(startedGame(market), command, 750, 'tooCheap');
  });

  it.each([
    [500, 600],
    [4_900, 5_000],
    [5_000, 5_100],
    [10_000, 10_200],
    [12_000, 12_240],
  ])('a buy that saw %i cents still fills at up to %i cents: two percent or a dollar above, whichever is larger', (seen, limit) => {
    expect(toleranceLimitCents(seen)).toBe(limit);
  });

  it.each([
    [600, 500, true],
    [700, 500, false],
    [5_100, 5_000, true],
    [5_200, 5_000, false],
    [10_200, 10_000, true],
    [10_201, 10_000, false],
    [12_240, 12_000, true],
    [12_241, 12_000, false],
    [9_000, 10_000, true],
    [400, 500, true],
  ])('a fill at %i cents against %i cents seen is within tolerance: %s', (fill, seen, within) => {
    expect(withinTolerance(fill, seen)).toBe(within);
  });

  it('refuses a price that moved against the player by more than the tolerance, and takes nothing', () => {
    const seen = Math.floor(PRICE / 2);
    expectRejected(startedGame(market), buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: seen }), STEP, 'priceMoved');
  });

  it('accepts a price that moved $1 against the player: the smallest move a whole-dollar ticket can make', () => {
    const command = buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE - 100 });
    const result = applyCommand(market, startedGame(market), ME, command, STEP);
    expect(result.receipt.outcome).toBe('accepted');
    expect(me(result.game).positions[0]?.entryPriceCents).toBe(PRICE);
  });

  it('pays the server\'s price, not the price claimed, when the claim is $50 above it', () => {
    const command = buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE + 5_000 });
    const result = applyCommand(market, startedGame(market), ME, command, STEP);
    expect(result.receipt.outcome).toBe('accepted');
    expect(me(result.game).positions[0]?.entryPriceCents).toBe(PRICE);
    expect(me(result.game).cashCents).toBe(STARTING_CASH_CENTS - PRICE * Math.floor(SPEND / PRICE));
  });

  it('refuses a command made for another day', () => {
    expectRejected(startedGame(market), buyCommand({ day: 2, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE }), STEP, 'wrongDay');
    expectRejected(startedGame(market), buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE }), 900 + STEP, 'wrongDay');
  });

  it('refuses a contract that is not on the board', () => {
    expectRejected(startedGame(market), buyCommand({ day: 1, contractId: 252, spendCents: SPEND, seenPriceCents: PRICE }), STEP, 'unknownContract');
  });

  it('refuses a contract the board does not offer, by name, and takes no cash', () => {
    const trimmed = buildMarket(TEST_IDENTITY, { offeredPassedMoves: 0.4 });
    const passed = contractId(21, { companyId: 0, targetIndex: 0, side: 'up' });
    expect(isOffered(boardFor(trimmed, 1), passed)).toBe(false);
    // The same ticket is tradable and is sold on the full board: only the trim refuses it.
    expect(isTradable(priceOf(trimmed, 1, INDEX, passed))).toBe(true);
    expect(buyAt(market, startedGame(market), ME, STEP, 1, INDEX, passed, SPEND).receipt.outcome).toBe('accepted');

    const game = startedGame(trimmed);
    const command = buyCommand({ day: 1, contractId: passed, spendCents: SPEND, seenPriceCents: priceOf(trimmed, 1, INDEX, passed) });
    const result = applyCommand(trimmed, game, ME, command, STEP);
    expect(result.receipt).toEqual({ commandId: command.commandId, kind: 'buy', step: STEP, outcome: 'rejected', reason: 'notOffered' });
    expect(me(result.game).cashCents).toBe(STARTING_CASH_CENTS);
    expect(me(result.game).positions).toEqual([]);
    expect(me(result.game).receipts.at(-1)).toBe(result.receipt);
    // Refused the same way when the ticket is also too dear: not offered is said before anything about money.
    const tooMuch = buyCommand({ day: 1, contractId: passed, spendCents: STARTING_CASH_CENTS + 1, seenPriceCents: 1 });
    expect(applyCommand(trimmed, game, ME, tooMuch, STEP).receipt.reason).toBe('notOffered');
  });

  it('sells an offered contract on a trimmed board exactly as before', () => {
    const trimmed = buildMarket(TEST_IDENTITY, { offeredPassedMoves: 0.4 });
    const offered = findContract(trimmed, 1, (id) => isOffered(boardFor(trimmed, 1), id) && isTradable(priceOf(trimmed, 1, INDEX, id)));
    const onTrimmed = buyAt(trimmed, startedGame(trimmed), ME, STEP, 1, INDEX, offered, SPEND);
    const onFull = buyAt(market, startedGame(market), ME, STEP, 1, INDEX, offered, SPEND);
    expect(onTrimmed.receipt).toMatchObject({ outcome: 'accepted', positionId: 'd1' });
    expect(me(onTrimmed.game).positions).toEqual(me(onFull.game).positions);
    expect(me(onTrimmed.game).cashCents).toBe(me(onFull.game).cashCents);
  });

  it('never says not offered on the default board, whichever contract is asked for', () => {
    const game = startedGame(market);
    for (let id = 0; id < 252; id += 1) {
      const command = buyCommand({ day: 1, contractId: id, spendCents: SPEND, seenPriceCents: priceOf(market, 1, INDEX, id) || 100 });
      expect(applyCommand(market, game, ME, command, STEP).receipt.reason).not.toBe('notOffered');
    }
    // An id that is not on the board at all is still an unknown contract, not an unoffered one.
    const unknown = buyCommand({ day: 1, contractId: 252, spendCents: SPEND, seenPriceCents: PRICE });
    expect(applyCommand(buildMarket(TEST_IDENTITY, { offeredPassedMoves: 0.4 }), game, ME, unknown, STEP).receipt.reason).toBe('unknownContract');
  });

  it('refuses every buy when the stress setting is on', () => {
    const game = startedGame(market, { targetsPerCompany: 209 });
    expect(game.stress).toBe(true);
    expectRejected(game, buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE }), STEP, 'stressMode');
  });

  it('refuses a spend that does not cover one ticket', () => {
    expectRejected(startedGame(market), buyCommand({ day: 1, contractId: CONTRACT, spendCents: PRICE - 1, seenPriceCents: PRICE }), STEP, 'spendTooSmall');
  });

  it('refuses once the game is over', () => {
    expectRejected(startedGame(market), buyCommand({ day: 5, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE }), GAME_STEPS, 'gameOver');
  });

  it('never leaves cash negative or costs more than the spend', () => {
    for (const spendCents of [PRICE, PRICE + 1, 1_234_567, 49_999_999]) {
      const result = buyAt(market, startedGame(market), ME, STEP, 1, INDEX, CONTRACT, spendCents);
      const position = me(result.game).positions[0];
      expect(position?.costCents).toBeLessThanOrEqual(spendCents);
      expect(me(result.game).cashCents + (position?.costCents ?? NaN)).toBe(STARTING_CASH_CENTS);
    }
  });
});

describe('a repeated commandId', () => {
  it('returns the original accepted receipt and changes nothing', () => {
    const first = buyAt(market, startedGame(market), ME, STEP, 1, INDEX, CONTRACT, SPEND);
    const resend = buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE, commandId: first.receipt.commandId });
    const second = applyCommand(market, first.game, ME, resend, STEP + 40);
    expect(second.repeat).toBe(true);
    expect(second.receipt).toBe(first.receipt);
    expect(second.game).toBe(first.game);
    expect(me(second.game).positions).toHaveLength(1);
  });

  it('returns the original rejected receipt and changes nothing, even when it would now pass', () => {
    const tooMuch = buyCommand({ day: 1, contractId: CONTRACT, spendCents: 60_000_000, seenPriceCents: PRICE });
    const first = applyCommand(market, startedGame(market), ME, tooMuch, STEP);
    expect(first.receipt.reason).toBe('overCap');
    const retry = buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE, commandId: tooMuch.commandId });
    const second = applyCommand(market, first.game, ME, retry, STEP);
    expect(second).toEqual({ game: first.game, receipt: first.receipt, repeat: true });
    expect(second.game).toBe(first.game);
    expect(me(second.game).cashCents).toBe(STARTING_CASH_CENTS);
  });

  it('pays a cash-out once however often it is resent', () => {
    const command = cashOut('d1');
    const first = applyCommand(market, bought(), ME, command, 500);
    let game = first.game;
    for (const step of [500, 501, 650, 800, 2000]) {
      const again = applyCommand(market, game, ME, command, step);
      expect(again.repeat).toBe(true);
      expect(again.receipt).toBe(first.receipt);
      game = again.game;
    }
    expect(game).toBe(first.game);
  });

  it('does not re-run a jump', () => {
    const command = clockCommand('openBell', 1);
    const first = applyCommand(market, startedGame(market), ME, command, 10);
    const again = applyCommand(market, first.game, ME, command, 300);
    expect(again.repeat).toBe(true);
    expect(again.jumpedTo).toBeUndefined();
    expect(again.game).toBe(first.game);
  });
});

describe('cash out', () => {
  it('pays quantity x the current price', () => {
    const game = bought();
    const position = me(game).positions[0];
    const priceNow = priceOf(market, 1, 200, CONTRACT);
    const result = applyCommand(market, game, ME, cashOut('d1'), 500);
    expect(result.receipt).toMatchObject({ kind: 'cashOut', outcome: 'accepted', step: 500, positionId: 'd1' });
    expect(me(result.game).cashCents).toBe(me(game).cashCents + priceNow * (position?.quantity ?? NaN));
    expect(me(result.game).positions[0]?.exit).toEqual({
      kind: 'cashOut',
      step: 500,
      priceIndex: 200,
      priceCents: priceNow,
      proceedsCents: priceNow * (position?.quantity ?? NaN),
    });
  });

  it('refuses a second cash-out and a ticket that does not exist', () => {
    const sold = applyCommand(market, bought(), ME, cashOut('d1'), 500).game;
    expectRejected(sold, cashOut('d1'), 510, 'alreadyClosed');
    expectRejected(sold, cashOut('d2'), 510, 'unknownPosition');
    expect(me(advanceTo(market, sold, 900)).cashCents).toBe(me(sold).cashCents);
  });

  it.each([800, 801, 899, 900, 2345, GAME_STEPS])('at or after the bell (step %i) is accepted and pays the bell value exactly once', (step) => {
    const game = bought();
    const quantity = me(game).positions[0]?.quantity ?? NaN;
    const bellCash = me(game).cashCents + priceOf(market, 1, 500, CONTRACT) * quantity;
    const first = applyCommand(market, game, ME, cashOut('d1'), step);
    expect(first.receipt).toMatchObject({ outcome: 'accepted', positionId: 'd1' });
    expect(me(first.game).cashCents).toBe(bellCash);
    expect(me(first.game).positions[0]?.exit).toMatchObject({ kind: 'bell', step: 800, priceIndex: 500 });
    const second = applyCommand(market, first.game, ME, cashOut('d1'), step + 1);
    expect(second.receipt.outcome).toBe('accepted');
    expect(me(second.game).cashCents).toBe(bellCash);
    expect(me(advanceTo(market, second.game, GAME_STEPS)).cashCents).toBe(bellCash);
  });

  it('one step before the bell still pays the live price', () => {
    const game = bought();
    const result = applyCommand(market, game, ME, cashOut('d1'), 799);
    expect(me(result.game).positions[0]?.exit).toMatchObject({ kind: 'cashOut', priceIndex: 499, priceCents: priceOf(market, 1, 499, CONTRACT) });
  });
});

describe('advanceTo', () => {
  it('pays a held ticket its real value at the bell, or nothing', () => {
    const bellPrice = (companyId: number) => market.days[0]?.paths[companyId]?.[500] ?? NaN;
    const realAtBell = (id: number) => {
      const ref = decodeContractId(21, id);
      const target = (boardFor(market, 1).companies[ref.companyId]?.targets[ref.targetIndex] ?? NaN) / 100;
      const perShare = Math.max(0, ref.side === 'up' ? bellPrice(ref.companyId) - target : target - bellPrice(ref.companyId));
      return Math.round(perShare * 100) * 100;
    };
    const winner = findContract(market, 1, (id) => isTradable(priceOf(market, 1, INDEX, id)) && realAtBell(id) > 0);
    const loser = findContract(market, 1, (id) => isTradable(priceOf(market, 1, INDEX, id)) && realAtBell(id) === 0);
    for (const contract of [winner, loser]) {
      const game = buyAt(market, startedGame(market), ME, STEP, 1, INDEX, contract, SPEND).game;
      const settled = advanceTo(market, game, 800);
      const position = me(settled).positions[0];
      expect(position?.exit).toEqual({
        kind: 'bell',
        step: 800,
        priceIndex: 500,
        priceCents: realAtBell(contract),
        proceedsCents: realAtBell(contract) * (position?.quantity ?? NaN),
      });
      expect(me(settled).cashCents).toBe(me(game).cashCents + realAtBell(contract) * (position?.quantity ?? NaN));
      expect(me(settled).dayEndCents).toEqual([me(settled).cashCents]);
    }
  });

  it('does not settle one step early', () => {
    const game = bought();
    const before = advanceTo(market, game, 799);
    expect(me(before).positions[0]?.exit).toBeUndefined();
    expect(me(before).cashCents).toBe(me(game).cashCents);
    expect(me(before).dayEndCents).toEqual([]);
  });

  it('gives identical state whether it is called late, often or early', () => {
    const game = bought();
    const late = advanceTo(market, game, GAME_STEPS);
    let often = game;
    for (let step = STEP; step <= GAME_STEPS; step += 1) often = advanceTo(market, often, step);
    let early = advanceTo(market, game, 5);
    early = advanceTo(market, early, 800);
    early = advanceTo(market, early, 800);
    early = advanceTo(market, early, 100);
    early = advanceTo(market, early, GAME_STEPS + 500);
    expect(often).toEqual(late);
    expect(early).toEqual(late);
    expect(me(late).dayEndCents).toHaveLength(5);
    expect(late.step).toBe(GAME_STEPS);
  });

  it('is idempotent and never goes back', () => {
    const settled = advanceTo(market, bought(), 850);
    expect(advanceTo(market, settled, 850)).toBe(settled);
    expect(advanceTo(market, settled, 400)).toBe(settled);
  });

  it('does nothing in the lobby', () => {
    const lobby = newGame();
    expect(advanceTo(market, lobby, 3000)).toBe(lobby);
  });
});

describe('clock commands', () => {
  it('ring the opening bell early', () => {
    const result = applyCommand(market, startedGame(market), ME, clockCommand('openBell', 1), 10);
    expect(result.receipt).toMatchObject({ kind: 'openBell', outcome: 'accepted', step: 10 });
    expect(result.jumpedTo).toBe(300);
    expect(result.game.step).toBe(300);
  });

  it('skip to the closing bell and settle the held ticket there', () => {
    const game = bought();
    const result = applyCommand(market, game, ME, clockCommand('skipToBell', 1), 400);
    expect(result.jumpedTo).toBe(800);
    expect(result.game.step).toBe(800);
    expect(me(result.game).positions[0]?.exit).toMatchObject({ kind: 'bell', step: 800 });
    expect(me(result.game).cashCents).toBe(me(advanceTo(market, game, 800)).cashCents);
  });

  it('move to the next day from the debrief', () => {
    const result = applyCommand(market, startedGame(market), ME, clockCommand('nextDay', 1), 850);
    expect(result.jumpedTo).toBe(900);
    expect(me(result.game).dayEndCents).toHaveLength(1);
  });

  it('reach the final screen after day 5', () => {
    const result = applyCommand(market, startedGame(market), ME, clockCommand('nextDay', 5), 4450);
    expect(result.jumpedTo).toBe(GAME_STEPS);
    expect(result.game.step).toBe(GAME_STEPS);
    expect(me(result.game).dayEndCents).toHaveLength(5);
    expectRejected(result.game, clockCommand('nextDay', 5), GAME_STEPS, 'gameOver');
  });

  it('are refused in the wrong phase or for another day', () => {
    const game = startedGame(market);
    expectRejected(game, clockCommand('skipToBell', 1), 10, 'wrongPhase');
    expectRejected(game, clockCommand('nextDay', 1), 400, 'wrongPhase');
    expectRejected(game, clockCommand('openBell', 1), 300, 'wrongPhase');
    expectRejected(game, clockCommand('nextDay', 1), 1750, 'wrongDay');
    expectRejected(game, clockCommand('openBell', 2), 10, 'wrongDay');
  });

  it('keep later commands at or after the jump target', () => {
    const jumped = applyCommand(market, startedGame(market), ME, clockCommand('openBell', 1), 10).game;
    const result = applyCommand(market, jumped, ME, clockCommand('openBell', 1), 50);
    expect(result.receipt).toMatchObject({ step: 300, outcome: 'rejected', reason: 'wrongPhase' });
  });
});

/** A whole game with every kind of command, a few rejects and a few resends. */
function playScriptedGame(): GameState {
  let game = newGame();
  const send = (command: Command, step: number) => {
    game = applyCommand(market, game, ME, command, step).game;
  };
  const buy = (day: number, step: number, priceIndex: number, commandId?: string) => {
    const contract = findContract(market, day, (id) => id % 7 === day && isTradable(priceOf(market, day, priceIndex, id)));
    const seenPriceCents = priceOf(market, day, priceIndex, contract);
    const fields = { day, contractId: contract, spendCents: spendCapCents(me(game).cashCents), seenPriceCents };
    send(buyCommand(commandId === undefined ? fields : { ...fields, commandId }), step);
  };

  send(cashOut('d1'), 0);
  send(start(3), 0);
  send(start(1), 2);
  buy(1, 40, 0, 'first-buy-of-the-game');
  buy(1, 45, 0, 'first-buy-of-the-game');
  buy(1, 50, 0);
  send(clockCommand('openBell', 1), 60);
  send(cashOut('d1'), 520);
  send(cashOut('d1'), 530);
  send(clockCommand('skipToBell', 1), 600);
  send(clockCommand('nextDay', 1), 820);
  buy(2, 900 + 420, 120);
  send(clockCommand('nextDay', 2), 900 + 870);
  send(clockCommand('openBell', 3), 1800 + 5);
  buy(3, 1800 + 310, 10);
  send(clockCommand('skipToBell', 3), 1800 + 330);
  send(cashOut('d3'), 1800 + 810);
  send(clockCommand('nextDay', 3), 1800 + 820);
  send(buyCommand({ day: 4, contractId: 9999, spendCents: 1000, seenPriceCents: 1000 }), 2700 + 100);
  buy(4, 2700 + 799, 499);
  send(clockCommand('nextDay', 4), 2700 + 850);
  send(clockCommand('nextDay', 5), 3600 + 880);
  send(cashOut('d4'), GAME_STEPS);
  return advanceTo(market, game, GAME_STEPS);
}

describe('rev, log and replay', () => {
  it('raises rev on every receipt and on every settlement, and on nothing else', () => {
    let game = startedGame(market);
    expect(me(game).rev).toBe(1);
    game = buyAt(market, game, ME, STEP, 1, INDEX, CONTRACT, SPEND).game;
    expect(me(game).rev).toBe(2);
    game = applyCommand(market, game, ME, cashOut('nope'), STEP + 1).game;
    expect(me(game).rev).toBe(3);
    game = advanceTo(market, game, 799);
    expect(me(game).rev).toBe(3);
    game = advanceTo(market, game, 800);
    expect(me(game).rev).toBe(4);
    game = advanceTo(market, game, 1700);
    expect(me(game).rev).toBe(4);
    const repeat = applyCommand(market, game, ME, cashOut('d1', me(game).receipts[2]?.commandId), 1700);
    expect(me(repeat.game).rev).toBe(4);
  });

  it('logs every command that is not a repeat, with the step it arrived at', () => {
    const game = playScriptedGame();
    expect(me(game).log).toHaveLength(me(game).receipts.length);
    me(game).log.forEach((entry, index) => {
      expect(entry.command.commandId).toBe(me(game).receipts[index]?.commandId);
      expect(entry.step).toBe(me(game).receipts[index]?.step);
    });
    expect(me(game).log.filter((entry) => entry.command.commandId === 'first-buy-of-the-game')).toHaveLength(1);
    const steps = me(game).log.map((entry) => entry.step);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(new Set(me(game).receipts.map((receipt) => receipt.outcome))).toEqual(new Set(['accepted', 'rejected']));
    expect(me(game).positions.map((position) => position.exit?.kind)).toEqual(['cashOut', 'bell', 'bell', 'bell']);
  });

  it('replays the log on the same market to the identical state', () => {
    const played = playScriptedGame();
    let replayed = newGame();
    for (const entry of me(played).log) replayed = applyCommand(market, replayed, ME, entry.command, entry.step).game;
    replayed = advanceTo(market, replayed, played.step);
    expect(replayed).toEqual(played);
    expect(me(played).cashCents).not.toBe(STARTING_CASH_CENTS);
  });

  it('keeps cash equal to the start plus every exit minus every cost', () => {
    const game = playScriptedGame();
    const flows = me(game).positions.reduce((sum, position) => sum - position.costCents + (position.exit?.proceedsCents ?? 0), 0);
    expect(me(game).cashCents).toBe(STARTING_CASH_CENTS + flows);
    expect(me(game).dayEndCents[4]).toBe(me(game).cashCents);
  });
});

describe('breakEvenCents', () => {
  it('is the target plus or minus the ticket price per share', () => {
    expect(breakEvenCents(8400, 35_000, 'up')).toBe(8750);
    expect(breakEvenCents(8400, 35_000, 'down')).toBe(8050);
  });
});
