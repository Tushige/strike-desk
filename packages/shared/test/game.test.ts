import { describe, expect, it } from 'vitest';
import { decodeContractId } from '../src/board';
import { GAME_STEPS } from '../src/clock';
import type { GameState } from '../src/game';
import { STARTING_CASH_CENTS, advanceTo, applyCommand, breakEvenCents, newGame, spendCapCents, withinTolerance } from '../src/game';
import { boardFor } from '../src/market';
import { isTradable } from '../src/pricing';
import type { Command } from '../src/protocol';
import { buyAt, buyCommand, cashOut, clockCommand, findContract, priceOf, start, startedGame, testMarket } from './helpers';

const market = testMarket();
const SPEND = 5_000_000;

/** A tradable contract on day 1, ten steps after the opening bell. */
const STEP = 310;
const INDEX = 10;
const CONTRACT = findContract(market, 1, (id) => isTradable(priceOf(market, 1, INDEX, id)));
const PRICE = priceOf(market, 1, INDEX, CONTRACT);

function bought(): GameState {
  const result = buyAt(market, startedGame(market), STEP, 1, INDEX, CONTRACT, SPEND);
  expect(result.receipt.outcome).toBe('accepted');
  return result.game;
}

function expectRejected(game: GameState, command: Command, step: number, reason: string): void {
  const result = applyCommand(market, game, command, step);
  expect(result.receipt).toMatchObject({ commandId: command.commandId, kind: command.t, outcome: 'rejected', reason });
  expect(result.repeat).toBe(false);
  expect(result.game.cashCents).toBe(game.cashCents);
  expect(result.game.positions).toEqual(game.positions);
}

describe('start', () => {
  it('leaves the lobby once, at the chosen pace', () => {
    const lobby = newGame();
    expect(lobby).toMatchObject({ rev: 0, step: 0, pace: null, cashCents: 100_000_000, stress: false });
    const result = applyCommand(market, lobby, start(3), 0);
    expect(result.receipt).toMatchObject({ kind: 'start', outcome: 'accepted', step: 0 });
    expect(result.game.pace).toBe(3);
    expectRejected(result.game, start(7.5), 5, 'alreadyStarted');
    expect(applyCommand(market, result.game, start(7.5), 5).game.pace).toBe(3);
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
    const result = buyAt(market, startedGame(market), STEP, 1, INDEX, CONTRACT, SPEND);
    const quantity = Math.floor(SPEND / PRICE);
    expect(quantity).toBeGreaterThan(0);
    expect(result.receipt).toEqual({ commandId: result.receipt.commandId, kind: 'buy', step: STEP, outcome: 'accepted', positionId: 'd1' });
    expect(result.game.cashCents).toBe(STARTING_CASH_CENTS - PRICE * quantity);
    const ref = decodeContractId(21, CONTRACT);
    expect(result.game.positions).toEqual([
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
    const result = buyAt(market, startedGame(market), 120, 1, 0, contract, SPEND);
    expect(result.receipt.outcome).toBe('accepted');
    expect(result.game.positions[0]).toMatchObject({ entryStep: 120, entryPriceIndex: 0, entryPriceCents: priceOf(market, 1, 0, contract) });
  });

  it('fills at the server price when that is better than the price seen', () => {
    const command = buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE * 2 });
    const result = applyCommand(market, startedGame(market), command, STEP);
    expect(result.receipt.outcome).toBe('accepted');
    expect(result.game.positions[0]?.entryPriceCents).toBe(PRICE);
  });

  it('may spend up to the cap and not a cent more', () => {
    const cap = spendCapCents(STARTING_CASH_CENTS);
    expect(cap).toBe(50_000_000);
    expect(buyAt(market, startedGame(market), STEP, 1, INDEX, CONTRACT, cap).receipt.outcome).toBe('accepted');
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
    expect(buyAt(market, startedGame(market), 799, 1, lastIndex, contract, SPEND).receipt.outcome).toBe('accepted');
    const command = buyCommand({ day: 1, contractId: contract, spendCents: SPEND, seenPriceCents: priceOf(market, 1, 500, contract) || 100 });
    expectRejected(startedGame(market), command, 800, 'marketClosed');
    expectRejected(startedGame(market), { ...command, commandId: 'later-in-debrief' }, 899, 'marketClosed');
  });

  it('allows one ticket a day, even after cashing it out', () => {
    const game = bought();
    expectRejected(game, buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE }), STEP + 1, 'alreadyBought');
    const sold = applyCommand(market, game, cashOut('d1'), STEP + 5).game;
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

  it('refuses a price that moved against the player by more than the tolerance', () => {
    const seen = Math.floor(PRICE / 1.03);
    expectRejected(startedGame(market), buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: seen }), STEP, 'priceMoved');
    expect(withinTolerance(10_200, 10_000)).toBe(true);
    expect(withinTolerance(10_201, 10_000)).toBe(false);
    expect(withinTolerance(9_000, 10_000)).toBe(true);
  });

  it('refuses a command made for another day', () => {
    expectRejected(startedGame(market), buyCommand({ day: 2, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE }), STEP, 'wrongDay');
    expectRejected(startedGame(market), buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE }), 900 + STEP, 'wrongDay');
  });

  it('refuses a contract that is not on the board', () => {
    expectRejected(startedGame(market), buyCommand({ day: 1, contractId: 252, spendCents: SPEND, seenPriceCents: PRICE }), STEP, 'unknownContract');
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
      const result = buyAt(market, startedGame(market), STEP, 1, INDEX, CONTRACT, spendCents);
      const position = result.game.positions[0];
      expect(position?.costCents).toBeLessThanOrEqual(spendCents);
      expect(result.game.cashCents + (position?.costCents ?? NaN)).toBe(STARTING_CASH_CENTS);
    }
  });
});

describe('a repeated commandId', () => {
  it('returns the original accepted receipt and changes nothing', () => {
    const first = buyAt(market, startedGame(market), STEP, 1, INDEX, CONTRACT, SPEND);
    const resend = buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE, commandId: first.receipt.commandId });
    const second = applyCommand(market, first.game, resend, STEP + 40);
    expect(second.repeat).toBe(true);
    expect(second.receipt).toBe(first.receipt);
    expect(second.game).toBe(first.game);
    expect(second.game.positions).toHaveLength(1);
  });

  it('returns the original rejected receipt and changes nothing, even when it would now pass', () => {
    const tooMuch = buyCommand({ day: 1, contractId: CONTRACT, spendCents: 60_000_000, seenPriceCents: PRICE });
    const first = applyCommand(market, startedGame(market), tooMuch, STEP);
    expect(first.receipt.reason).toBe('overCap');
    const retry = buyCommand({ day: 1, contractId: CONTRACT, spendCents: SPEND, seenPriceCents: PRICE, commandId: tooMuch.commandId });
    const second = applyCommand(market, first.game, retry, STEP);
    expect(second).toEqual({ game: first.game, receipt: first.receipt, repeat: true });
    expect(second.game).toBe(first.game);
    expect(second.game.cashCents).toBe(STARTING_CASH_CENTS);
  });

  it('pays a cash-out once however often it is resent', () => {
    const command = cashOut('d1');
    const first = applyCommand(market, bought(), command, 500);
    let game = first.game;
    for (const step of [500, 501, 650, 800, 2000]) {
      const again = applyCommand(market, game, command, step);
      expect(again.repeat).toBe(true);
      expect(again.receipt).toBe(first.receipt);
      game = again.game;
    }
    expect(game).toBe(first.game);
  });

  it('does not re-run a jump', () => {
    const command = clockCommand('openBell', 1);
    const first = applyCommand(market, startedGame(market), command, 10);
    const again = applyCommand(market, first.game, command, 300);
    expect(again.repeat).toBe(true);
    expect(again.jumpedTo).toBeUndefined();
    expect(again.game).toBe(first.game);
  });
});

describe('cash out', () => {
  it('pays quantity x the current price', () => {
    const game = bought();
    const position = game.positions[0];
    const priceNow = priceOf(market, 1, 200, CONTRACT);
    const result = applyCommand(market, game, cashOut('d1'), 500);
    expect(result.receipt).toMatchObject({ kind: 'cashOut', outcome: 'accepted', step: 500, positionId: 'd1' });
    expect(result.game.cashCents).toBe(game.cashCents + priceNow * (position?.quantity ?? NaN));
    expect(result.game.positions[0]?.exit).toEqual({
      kind: 'cashOut',
      step: 500,
      priceIndex: 200,
      priceCents: priceNow,
      proceedsCents: priceNow * (position?.quantity ?? NaN),
    });
  });

  it('refuses a second cash-out and a ticket that does not exist', () => {
    const sold = applyCommand(market, bought(), cashOut('d1'), 500).game;
    expectRejected(sold, cashOut('d1'), 510, 'alreadyClosed');
    expectRejected(sold, cashOut('d2'), 510, 'unknownPosition');
    expect(advanceTo(market, sold, 900).cashCents).toBe(sold.cashCents);
  });

  it.each([800, 801, 899, 900, 2345, GAME_STEPS])('at or after the bell (step %i) is accepted and pays the bell value exactly once', (step) => {
    const game = bought();
    const quantity = game.positions[0]?.quantity ?? NaN;
    const bellCash = game.cashCents + priceOf(market, 1, 500, CONTRACT) * quantity;
    const first = applyCommand(market, game, cashOut('d1'), step);
    expect(first.receipt).toMatchObject({ outcome: 'accepted', positionId: 'd1' });
    expect(first.game.cashCents).toBe(bellCash);
    expect(first.game.positions[0]?.exit).toMatchObject({ kind: 'bell', step: 800, priceIndex: 500 });
    const second = applyCommand(market, first.game, cashOut('d1'), step + 1);
    expect(second.receipt.outcome).toBe('accepted');
    expect(second.game.cashCents).toBe(bellCash);
    expect(advanceTo(market, second.game, GAME_STEPS).cashCents).toBe(bellCash);
  });

  it('one step before the bell still pays the live price', () => {
    const game = bought();
    const result = applyCommand(market, game, cashOut('d1'), 799);
    expect(result.game.positions[0]?.exit).toMatchObject({ kind: 'cashOut', priceIndex: 499, priceCents: priceOf(market, 1, 499, CONTRACT) });
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
      const game = buyAt(market, startedGame(market), STEP, 1, INDEX, contract, SPEND).game;
      const settled = advanceTo(market, game, 800);
      const position = settled.positions[0];
      expect(position?.exit).toEqual({
        kind: 'bell',
        step: 800,
        priceIndex: 500,
        priceCents: realAtBell(contract),
        proceedsCents: realAtBell(contract) * (position?.quantity ?? NaN),
      });
      expect(settled.cashCents).toBe(game.cashCents + realAtBell(contract) * (position?.quantity ?? NaN));
      expect(settled.dayEndCents).toEqual([settled.cashCents]);
    }
  });

  it('does not settle one step early', () => {
    const game = bought();
    const before = advanceTo(market, game, 799);
    expect(before.positions[0]?.exit).toBeUndefined();
    expect(before.cashCents).toBe(game.cashCents);
    expect(before.dayEndCents).toEqual([]);
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
    expect(late.dayEndCents).toHaveLength(5);
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
    const result = applyCommand(market, startedGame(market), clockCommand('openBell', 1), 10);
    expect(result.receipt).toMatchObject({ kind: 'openBell', outcome: 'accepted', step: 10 });
    expect(result.jumpedTo).toBe(300);
    expect(result.game.step).toBe(300);
  });

  it('skip to the closing bell and settle the held ticket there', () => {
    const game = bought();
    const result = applyCommand(market, game, clockCommand('skipToBell', 1), 400);
    expect(result.jumpedTo).toBe(800);
    expect(result.game.step).toBe(800);
    expect(result.game.positions[0]?.exit).toMatchObject({ kind: 'bell', step: 800 });
    expect(result.game.cashCents).toBe(advanceTo(market, game, 800).cashCents);
  });

  it('move to the next day from the debrief', () => {
    const result = applyCommand(market, startedGame(market), clockCommand('nextDay', 1), 850);
    expect(result.jumpedTo).toBe(900);
    expect(result.game.dayEndCents).toHaveLength(1);
  });

  it('reach the final screen after day 5', () => {
    const result = applyCommand(market, startedGame(market), clockCommand('nextDay', 5), 4450);
    expect(result.jumpedTo).toBe(GAME_STEPS);
    expect(result.game.step).toBe(GAME_STEPS);
    expect(result.game.dayEndCents).toHaveLength(5);
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
    const jumped = applyCommand(market, startedGame(market), clockCommand('openBell', 1), 10).game;
    const result = applyCommand(market, jumped, clockCommand('openBell', 1), 50);
    expect(result.receipt).toMatchObject({ step: 300, outcome: 'rejected', reason: 'wrongPhase' });
  });
});

/** A whole game with every kind of command, a few rejects and a few resends. */
function playScriptedGame(): GameState {
  let game = newGame();
  const send = (command: Command, step: number) => {
    game = applyCommand(market, game, command, step).game;
  };
  const buy = (day: number, step: number, priceIndex: number, commandId?: string) => {
    const contract = findContract(market, day, (id) => id % 7 === day && isTradable(priceOf(market, day, priceIndex, id)));
    const seenPriceCents = priceOf(market, day, priceIndex, contract);
    const fields = { day, contractId: contract, spendCents: spendCapCents(game.cashCents), seenPriceCents };
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
    expect(game.rev).toBe(1);
    game = buyAt(market, game, STEP, 1, INDEX, CONTRACT, SPEND).game;
    expect(game.rev).toBe(2);
    game = applyCommand(market, game, cashOut('nope'), STEP + 1).game;
    expect(game.rev).toBe(3);
    game = advanceTo(market, game, 799);
    expect(game.rev).toBe(3);
    game = advanceTo(market, game, 800);
    expect(game.rev).toBe(4);
    game = advanceTo(market, game, 1700);
    expect(game.rev).toBe(4);
    const repeat = applyCommand(market, game, cashOut('d1', game.receipts[2]?.commandId), 1700);
    expect(repeat.game.rev).toBe(4);
  });

  it('logs every command that is not a repeat, with the step it arrived at', () => {
    const game = playScriptedGame();
    expect(game.log).toHaveLength(game.receipts.length);
    game.log.forEach((entry, index) => {
      expect(entry.command.commandId).toBe(game.receipts[index]?.commandId);
      expect(entry.step).toBe(game.receipts[index]?.step);
    });
    expect(game.log.filter((entry) => entry.command.commandId === 'first-buy-of-the-game')).toHaveLength(1);
    const steps = game.log.map((entry) => entry.step);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(new Set(game.receipts.map((receipt) => receipt.outcome))).toEqual(new Set(['accepted', 'rejected']));
    expect(game.positions.map((position) => position.exit?.kind)).toEqual(['cashOut', 'bell', 'bell', 'bell']);
  });

  it('replays the log on the same market to the identical state', () => {
    const played = playScriptedGame();
    let replayed = newGame();
    for (const entry of played.log) replayed = applyCommand(market, replayed, entry.command, entry.step).game;
    replayed = advanceTo(market, replayed, played.step);
    expect(replayed).toEqual(played);
    expect(played.cashCents).not.toBe(STARTING_CASH_CENTS);
  });

  it('keeps cash equal to the start plus every exit minus every cost', () => {
    const game = playScriptedGame();
    const flows = game.positions.reduce((sum, position) => sum - position.costCents + (position.exit?.proceedsCents ?? 0), 0);
    expect(game.cashCents).toBe(STARTING_CASH_CENTS + flows);
    expect(game.dayEndCents[4]).toBe(game.cashCents);
  });
});

describe('breakEvenCents', () => {
  it('is the target plus or minus the ticket price per share', () => {
    expect(breakEvenCents(8400, 35_000, 'up')).toBe(8750);
    expect(breakEvenCents(8400, 35_000, 'down')).toBe(8050);
  });
});
