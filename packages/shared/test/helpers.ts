import type { Pace } from '../src/clock';
import type { CommandResult, GameState, PlayerState } from '../src/game';
import { FIRST_PLAYER_ID, applyCommand, newGame, playerOf } from '../src/game';
import type { Market } from '../src/market';
import { CONTENT_VERSION, ENGINE_VERSION, boardFor, buildMarket, quoteAt } from '../src/market';
import { contractCount } from '../src/board';
import type { Command } from '../src/protocol';

export const TEST_SEED = 198765432123456;
export const TEST_IDENTITY = { seed: TEST_SEED, engine: ENGINE_VERSION, content: CONTENT_VERSION };

export function testMarket(): Market {
  return buildMarket(TEST_IDENTITY);
}

/** The one player every real game has. Tests of a single player's game act as this player. */
export const ME = FIRST_PLAYER_ID;

/** The account of the game's one player. */
export function me(game: GameState): PlayerState {
  return playerOf(game, ME);
}

let nextId = 0;
export function freshId(): string {
  nextId += 1;
  return `command-${String(nextId).padStart(6, '0')}`;
}

export const start = (pace: Pace = 1, commandId = freshId()): Command => ({ t: 'start', commandId, pace });
export const cashOut = (positionId: string, commandId = freshId()): Command => ({ t: 'cashOut', commandId, positionId });
export const clockCommand = (t: 'openBell' | 'skipToBell' | 'nextDay', day: number, commandId = freshId()): Command => ({ t, commandId, day });

export function buyCommand(fields: { day: number; contractId: number; spendCents: number; seenPriceCents: number; commandId?: string }): Command {
  return {
    t: 'buy',
    commandId: fields.commandId ?? freshId(),
    day: fields.day,
    contractId: fields.contractId,
    spendCents: fields.spendCents,
    seenPriceCents: fields.seenPriceCents,
  };
}

/** A one-player game whose `start` has been accepted at step 0. */
export function startedGame(market: Market, options: { targetsPerCompany?: number; pace?: Pace } = {}): GameState {
  const result = applyCommand(market, newGame(options), ME, start(options.pace ?? 1), 0);
  if (result.receipt.outcome !== 'accepted') throw new Error('start was refused');
  return result.game;
}

export function priceOf(market: Market, day: number, priceIndex: number, contractId: number, targetsPerCompany?: number): number {
  const quote = quoteAt(market, day, priceIndex, boardFor(market, day, targetsPerCompany), contractId);
  if (quote === null) throw new Error(`contract ${contractId} is not on the board`);
  return quote.priceCents;
}

/** The first contract on a day's board that passes the test. Throws when none does, so a test never passes by accident. */
export function findContract(market: Market, day: number, test: (contractId: number) => boolean): number {
  const total = contractCount(boardFor(market, day));
  for (let id = 0; id < total; id += 1) {
    if (test(id)) return id;
  }
  throw new Error('no contract on this board passes the test');
}

/** Buy at the server's own price, so the price-moved check passes. */
export function buyAt(market: Market, game: GameState, playerId: string, step: number, day: number, priceIndex: number, contractId: number, spendCents: number): CommandResult {
  const seenPriceCents = priceOf(market, day, priceIndex, contractId, game.targetsPerCompany);
  return applyCommand(market, game, playerId, buyCommand({ day, contractId, spendCents, seenPriceCents }), step);
}
