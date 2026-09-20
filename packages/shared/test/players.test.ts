import { describe, expect, it } from 'vitest';
import { projectFrame } from '../src/frame';
import type { GameState } from '../src/game';
import { FIRST_PLAYER_ID, STARTING_CASH_CENTS, advanceTo, applyCommand, newGame, playerOf } from '../src/game';
import { isTradable } from '../src/pricing';
import { createSession } from '../src/session';
import { TEST_IDENTITY, buyAt, cashOut, clockCommand, findContract, priceOf, start, testMarket } from './helpers';

/**
 * A session has players. They share the market, the clock and the step, and
 * never an account. The game itself always has exactly one player; only a
 * test makes two, to keep a later change from folding the account back into
 * the session.
 */

const market = testMarket();
const SPEND = 5_000_000;
/** A tradable contract on day 1, ten steps after the opening bell. */
const STEP = 310;
const INDEX = 10;
const CONTRACT = findContract(market, 1, (id) => isTradable(priceOf(market, 1, INDEX, id)));

const twoPlayers = (): GameState => newGame({ playerIds: ['p1', 'p2'] });

/** Two players, started by `p1`, and `p1` holding a ticket bought mid-day. */
function p1HoldsATicket(): GameState {
  const started = applyCommand(market, twoPlayers(), 'p1', start(1), 0).game;
  const result = buyAt(market, started, 'p1', STEP, 1, INDEX, CONTRACT, SPEND);
  expect(result.receipt.outcome).toBe('accepted');
  return result.game;
}

describe('a game with one player, which is every real game', () => {
  it('newGame with no player list makes exactly one player, p1', () => {
    expect(FIRST_PLAYER_ID).toBe('p1');
    expect(newGame().players.map((player) => player.id)).toEqual(['p1']);
    expect(newGame({ targetsPerCompany: 209 }).players.map((player) => player.id)).toEqual(['p1']);
  });

  it('createSession with no player list makes exactly one player, p1', () => {
    expect(createSession('s1', TEST_IDENTITY).game.players.map((player) => player.id)).toEqual(['p1']);
  });

  it('the session-level record holds no account of its own', () => {
    expect(Object.keys(newGame()).sort()).toEqual(['pace', 'players', 'step', 'stress', 'targetsPerCompany']);
    expect(Object.keys(playerOf(newGame(), 'p1')).sort()).toEqual(['cashCents', 'dayEndCents', 'id', 'log', 'positions', 'receipts', 'rev']);
  });
});

describe('two players in one game share the market and never an account', () => {
  it('both start with the starting cash, no positions, no receipts and revision 0', () => {
    const game = twoPlayers();
    for (const id of ['p1', 'p2']) {
      expect(playerOf(game, id)).toEqual({ id, rev: 0, cashCents: STARTING_CASH_CENTS, positions: [], receipts: [], log: [], dayEndCents: [] });
    }
  });

  it('a start sets the pace for both and is receipted for the player who sent it only', () => {
    const lobby = twoPlayers();
    const started = applyCommand(market, lobby, 'p1', start(3), 0);
    expect(started.receipt).toMatchObject({ kind: 'start', outcome: 'accepted' });
    expect(started.game.pace).toBe(3);
    expect(playerOf(started.game, 'p1')).toMatchObject({ rev: 1, receipts: [started.receipt] });
    expect(playerOf(started.game, 'p1').log).toHaveLength(1);
    expect(playerOf(started.game, 'p2')).toBe(playerOf(lobby, 'p2'));

    const again = applyCommand(market, started.game, 'p2', start(1), 5);
    expect(again.receipt).toMatchObject({ kind: 'start', outcome: 'rejected', reason: 'alreadyStarted' });
    expect(again.game.pace).toBe(3);
    expect(playerOf(again.game, 'p2')).toMatchObject({ rev: 1, receipts: [again.receipt] });
    expect(playerOf(again.game, 'p1').receipts).toEqual([started.receipt]);
    expect(playerOf(again.game, 'p1').rev).toBe(1);
  });

  it("a buy changes the buyer's cash and positions and nothing of the other player's", () => {
    const started = applyCommand(market, twoPlayers(), 'p1', start(1), 0).game;
    const result = buyAt(market, started, 'p1', STEP, 1, INDEX, CONTRACT, SPEND);
    expect(result.receipt.outcome).toBe('accepted');
    const buyer = playerOf(result.game, 'p1');
    expect(buyer.cashCents).toBeLessThan(STARTING_CASH_CENTS);
    expect(buyer.positions).toHaveLength(1);
    expect(buyer.rev).toBe(2);
    expect(playerOf(result.game, 'p2')).toEqual({ id: 'p2', rev: 0, cashCents: STARTING_CASH_CENTS, positions: [], receipts: [], log: [], dayEndCents: [] });
    // Both are at the same step of the same clock.
    expect(result.game.step).toBe(STEP);
  });

  it('each player may hold a ticket of their own on the same day, and cash out only their own', () => {
    const both = buyAt(market, p1HoldsATicket(), 'p2', STEP + 1, 1, INDEX + 1, CONTRACT, SPEND * 2);
    expect(both.receipt.outcome).toBe('accepted');
    expect(playerOf(both.game, 'p1').positions).toHaveLength(1);
    expect(playerOf(both.game, 'p2').positions).toHaveLength(1);

    const before = playerOf(both.game, 'p1');
    const sold = applyCommand(market, both.game, 'p2', cashOut('d1'), STEP + 20);
    expect(sold.receipt.outcome).toBe('accepted');
    expect(playerOf(sold.game, 'p2').positions[0]?.exit?.kind).toBe('cashOut');
    expect(playerOf(sold.game, 'p1')).toBe(before);
    expect(before.positions[0]?.exit).toBeUndefined();
  });

  it('the closing bell settles a held ticket once and records the day for both players', () => {
    const held = p1HoldsATicket();
    const quantity = playerOf(held, 'p1').positions[0]?.quantity ?? NaN;
    const bellCash = playerOf(held, 'p1').cashCents + priceOf(market, 1, 500, CONTRACT) * quantity;

    const settled = advanceTo(market, held, 800);
    expect(playerOf(settled, 'p1').positions[0]?.exit).toMatchObject({ kind: 'bell', step: 800, priceIndex: 500 });
    expect(playerOf(settled, 'p1').cashCents).toBe(bellCash);
    expect(playerOf(settled, 'p1').dayEndCents).toEqual([bellCash]);
    expect(playerOf(settled, 'p1').rev).toBe(playerOf(held, 'p1').rev + 1);
    expect(playerOf(settled, 'p2')).toMatchObject({ rev: 0, cashCents: STARTING_CASH_CENTS, positions: [], dayEndCents: [STARTING_CASH_CENTS] });

    expect(advanceTo(market, settled, 800)).toBe(settled);
    const later = advanceTo(market, settled, 899);
    expect(playerOf(later, 'p1').cashCents).toBe(bellCash);
    expect(playerOf(later, 'p1').dayEndCents).toEqual([bellCash]);
    expect(playerOf(later, 'p2').dayEndCents).toEqual([STARTING_CASH_CENTS]);
  });

  it("a clock command moves the one clock for both and settles both players' tickets", () => {
    const both = buyAt(market, p1HoldsATicket(), 'p2', STEP + 1, 1, INDEX + 1, CONTRACT, SPEND).game;
    const skipped = applyCommand(market, both, 'p2', clockCommand('skipToBell', 1), 400);
    expect(skipped.jumpedTo).toBe(800);
    expect(skipped.game.step).toBe(800);
    for (const id of ['p1', 'p2']) {
      expect(playerOf(skipped.game, id).positions[0]?.exit?.kind).toBe('bell');
      expect(playerOf(skipped.game, id).dayEndCents).toHaveLength(1);
    }
    // The command is receipted and logged for the player who sent it only.
    expect(playerOf(skipped.game, 'p2').receipts.at(-1)).toBe(skipped.receipt);
    expect(playerOf(skipped.game, 'p1').receipts).toEqual(playerOf(both, 'p1').receipts);
    expect(playerOf(skipped.game, 'p1').log).toEqual(playerOf(both, 'p1').log);
  });

  it('frames for the two players at one step show the same market and different accounts', () => {
    const game = p1HoldsATicket();
    const options = { session: 'session-1', history: true };
    const mine = projectFrame(market, game, 'p1', STEP, options);
    const theirs = projectFrame(market, game, 'p2', STEP, options);

    expect(theirs.prices).toEqual(mine.prices);
    expect(theirs.clock).toEqual(mine.clock);
    expect(theirs.step).toBe(mine.step);
    expect(theirs.board).toEqual(mine.board);
    expect(theirs.quotes).toEqual(mine.quotes);
    expect(theirs.news).toEqual(mine.news);
    expect(theirs.history).toEqual(mine.history);

    expect(theirs.account).not.toEqual(mine.account);
    expect(theirs.positions).not.toEqual(mine.positions);
    expect(theirs.receipts).not.toEqual(mine.receipts);
    expect(theirs.rev).not.toBe(mine.rev);

    expect(mine).toMatchObject({ rev: 2, account: { cashCents: playerOf(game, 'p1').cashCents, canBuy: false } });
    expect(mine.positions).toHaveLength(1);
    expect(mine.receipts).toHaveLength(2);
    expect(theirs).toMatchObject({ rev: 0, positions: [], receipts: [], account: { cashCents: STARTING_CASH_CENTS, worthCents: STARTING_CASH_CENTS, canBuy: true } });
  });

  it('the live form reads the account of the player it is for, too', () => {
    const game = p1HoldsATicket();
    const options = { session: 'session-1', history: false, sections: 'live' as const };
    const mine = projectFrame(market, game, 'p1', STEP, options);
    const theirs = projectFrame(market, game, 'p2', STEP, options);
    expect(theirs.prices).toEqual(mine.prices);
    expect(mine).toMatchObject({ rev: 2, account: { cashCents: playerOf(game, 'p1').cashCents } });
    expect(theirs).toMatchObject({ rev: 0, account: { cashCents: STARTING_CASH_CENTS } });
  });

  it('the same command id used by both players is a repeat for neither', () => {
    const first = applyCommand(market, twoPlayers(), 'p1', start(1, 'the-same-command-id'), 0);
    const second = applyCommand(market, first.game, 'p2', cashOut('d1', 'the-same-command-id'), 3);
    expect(second.repeat).toBe(false);
    expect(second.receipt).toMatchObject({ commandId: 'the-same-command-id', kind: 'cashOut', outcome: 'rejected', reason: 'unknownPosition' });
    expect(playerOf(second.game, 'p1').receipts).toEqual([first.receipt]);
    expect(playerOf(second.game, 'p2').receipts).toEqual([second.receipt]);

    // Sent again, it is a repeat for each of them, of their own receipt.
    const mine = applyCommand(market, second.game, 'p1', start(7.5, 'the-same-command-id'), 9);
    const theirs = applyCommand(market, second.game, 'p2', cashOut('d1', 'the-same-command-id'), 9);
    expect(mine).toEqual({ game: second.game, receipt: first.receipt, repeat: true });
    expect(theirs).toEqual({ game: second.game, receipt: second.receipt, repeat: true });
  });
});

describe('a player that is not in the game', () => {
  it('playerOf, applyCommand and projectFrame throw for an unknown player id', () => {
    const game = twoPlayers();
    expect(() => playerOf(game, 'p3')).toThrow('no such player');
    expect(() => playerOf(game, '')).toThrow('no such player');
    expect(() => applyCommand(market, game, 'p3', start(1), 0)).toThrow('no such player');
    expect(() => applyCommand(market, newGame(), 'p2', start(1), 0)).toThrow('no such player');
    expect(() => projectFrame(market, game, 'p3', 0, { session: 'session-1', history: false })).toThrow('no such player');
  });

  it('newGame throws for an empty or duplicated id list', () => {
    expect(() => newGame({ playerIds: [] })).toThrow('at least one player');
    expect(() => newGame({ playerIds: ['p1', 'p1'] })).toThrow('more than once');
    expect(() => newGame({ playerIds: ['p1', ''] })).toThrow('empty');
  });
});
