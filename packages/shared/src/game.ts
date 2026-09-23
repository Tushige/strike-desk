import { DEFAULT_TARGETS_PER_COMPANY, isOffered } from './board';
import type { Pace } from './clock';
import { DAYS, GAME_STEPS, OPEN_STEPS, bellStep, jumpTarget, momentAt } from './clock';
import type { Market } from './market';
import { boardFor, quoteAt } from './market';
import type { Cents } from './money';
import { quantityForSpend, totalCents } from './money';
import { SHARES_PER_TICKET, isTradable } from './pricing';
import type { Command, Receipt, RejectReason, Side } from './protocol';
import { BUY_TOLERANCE_BPS, BUY_TOLERANCE_FLOOR_CENTS, MAX_DAILY_PURCHASES, decodeContractId } from './protocol';

/**
 * The rules of a game, as pure functions of the logical step. A game is what
 * the players of one session share (the step, the pace, the board size) and
 * the players themselves; each player owns an account. Every command names
 * the player it acts for: there is no default player and no account that
 * belongs to the game as a whole.
 * No wall clock in here: `applyCommand` and `advanceTo` take the step, so a
 * logged game replays exactly at any pace. The command path is one
 * synchronous call: check for a repeat, settle up to the step, apply, store
 * the receipt, log the input.
 */

export const STARTING_CASH_CENTS: Cents = 100_000_000;
/** At most this share of start-of-day cash may fund all that day's purchases... */
export const SPEND_CAP_FRACTION = 0.5;
/** ...rounded down to a multiple of this. */
export const SPEND_CAP_ROUND_CENTS: Cents = 100_000;

export interface PositionExit {
  kind: 'cashOut' | 'bell';
  step: number;
  priceIndex: number;
  priceCents: Cents;
  proceedsCents: Cents;
}

export interface PositionRecord {
  id: string;
  day: number;
  contractId: number;
  companyId: number;
  side: Side;
  targetCents: Cents;
  quantity: number;
  entryPriceCents: Cents;
  costCents: Cents;
  entryStep: number;
  entryPriceIndex: number;
  exit?: PositionExit;
}

export interface LoggedInput {
  step: number;
  command: Command;
}

/** The id of a session's only player. A game with more than one player is made only by a test. */
export const FIRST_PLAYER_ID = 'p1';

/** One player's account inside a session. */
export interface PlayerState {
  id: string;
  /** Goes up with every stored receipt and every settlement of this player. */
  rev: number;
  cashCents: Cents;
  positions: PositionRecord[];
  receipts: Receipt[];
  /** Every schema-valid, non-repeated command this player sent, with the step it arrived at. With the market identity, enough to replay the game. */
  log: LoggedInput[];
  /** Cash after each closing bell so far, by day. */
  dayEndCents: Cents[];
}

/** The session-level record: what every player of a session shares, and the players. */
export interface GameState {
  /** The latest step this state has been advanced to. Never goes back. */
  step: number;
  /** Null until `start`: the lobby. */
  pace: Pace | null;
  targetsPerCompany: number;
  /** Stress setting: a bigger board, buying disabled. */
  stress: boolean;
  players: PlayerState[];
}

function newPlayer(id: string): PlayerState {
  return { id, rev: 0, cashCents: STARTING_CASH_CENTS, positions: [], receipts: [], log: [], dayEndCents: [] };
}

export function newGame(options: { targetsPerCompany?: number; playerIds?: readonly string[] } = {}): GameState {
  const targetsPerCompany = options.targetsPerCompany ?? DEFAULT_TARGETS_PER_COMPANY;
  const playerIds = options.playerIds ?? [FIRST_PLAYER_ID];
  if (playerIds.length === 0) throw new Error('a game needs at least one player');
  playerIds.forEach((id, index) => {
    if (id === '') throw new Error('a player id cannot be empty');
    if (playerIds.indexOf(id) !== index) throw new Error(`player ${id} is listed more than once`);
  });
  return {
    step: 0,
    pace: null,
    targetsPerCompany,
    stress: targetsPerCompany !== DEFAULT_TARGETS_PER_COMPANY,
    players: playerIds.map(newPlayer),
  };
}

/** The named player's account. Throws when the game has no such player: a command is never applied to a guess. */
export function playerOf(game: GameState, playerId: string): PlayerState {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (player === undefined) throw new Error(`no such player: ${playerId}`);
  return player;
}

/** The game with one player's account replaced. Every other player is left exactly as it was. */
function withPlayer(game: GameState, player: PlayerState): GameState {
  return { ...game, players: game.players.map((candidate) => (candidate.id === player.id ? player : candidate)) };
}

export function spendCapCents(cashCents: Cents): Cents {
  const half = Math.floor(cashCents * SPEND_CAP_FRACTION);
  return Math.floor(half / SPEND_CAP_ROUND_CENTS) * SPEND_CAP_ROUND_CENTS;
}

/** Cash-outs never refill the day's purchase allowance. Actual filled costs consume it. */
export function remainingDaySpendCents(player: PlayerState, day: number): Cents {
  const opening = day <= 1 ? STARTING_CASH_CENTS : player.dayEndCents[day - 2] ?? player.cashCents;
  const spent = player.positions.filter(position => position.day === day).reduce((sum, position) => sum + position.costCents, 0);
  return Math.max(0, Math.min(player.cashCents, spendCapCents(opening) - spent));
}

/** The share price at which a ticket has earned back what it cost. */
export function breakEvenCents(targetCents: Cents, ticketPriceCentsPaid: Cents, side: Side): Cents {
  const perShare = Math.round(ticketPriceCentsPaid / SHARES_PER_TICKET);
  return side === 'up' ? targetCents + perShare : targetCents - perShare;
}

/**
 * The highest price at which a buy that saw `seenPriceCents` still fills: the
 * price seen plus the larger of the floor and the whole-cent part of its
 * percentage. Integer maths only. The buy check and the quote of a ticket
 * being built both read this, so they cannot disagree.
 */
export function toleranceLimitCents(seenPriceCents: Cents): Cents {
  const share = Math.floor((seenPriceCents * BUY_TOLERANCE_BPS) / 10_000);
  return seenPriceCents + Math.max(BUY_TOLERANCE_FLOOR_CENTS, share);
}

/** True when the fill price is within tolerance of the price the player saw. A price that fell always is. */
export function withinTolerance(fillPriceCents: Cents, seenPriceCents: Cents): boolean {
  return fillPriceCents <= toleranceLimitCents(seenPriceCents);
}

/** One player's account brought up to a step. The same object comes back when no bell has rung for it since. */
function settlePlayer(market: Market, targetsPerCompany: number, player: PlayerState, target: number): PlayerState {
  let next = player;
  for (let day = player.dayEndCents.length + 1; day <= DAYS && bellStep(day) <= target; day += 1) {
    let cashCents = next.cashCents;
    let rev = next.rev;
    const positions = next.positions.map((position) => {
      if (position.day !== day || position.exit !== undefined) return position;
      const board = boardFor(market, day, targetsPerCompany);
      const priceCents = quoteAt(market, day, OPEN_STEPS, board, position.contractId)?.priceCents ?? 0;
      const proceedsCents = totalCents(priceCents, position.quantity);
      cashCents += proceedsCents;
      rev += 1;
      const exit: PositionExit = { kind: 'bell', step: bellStep(day), priceIndex: OPEN_STEPS, priceCents, proceedsCents };
      return { ...position, exit };
    });
    next = { ...next, rev, cashCents, positions, dayEndCents: [...next.dayEndCents, cashCents] };
  }
  return next;
}

/**
 * Bring the state up to a step: for every player, settle any ticket whose
 * closing bell has rung, exactly once, at the bell's value, and note each
 * finished day's cash. Calling it late, early or often gives the same cash.
 */
export function advanceTo(market: Market, game: GameState, step: number): GameState {
  const target = Math.min(Math.max(step, game.step), GAME_STEPS);
  if (game.pace === null) return game;
  const settled = game.players.map((player) => settlePlayer(market, game.targetsPerCompany, player, target));
  const players = settled.some((player, index) => player !== game.players[index]) ? settled : game.players;
  if (players === game.players && target === game.step) return game;
  return { ...game, step: target, players };
}

export interface CommandResult {
  game: GameState;
  receipt: Receipt;
  /** True when this commandId had been seen before: nothing changed, the original receipt is returned. */
  repeat: boolean;
  /** Set when an accepted clock command moved the game forward; the caller re-anchors its wall clock here. */
  jumpedTo?: number;
}

type Verdict = { reason: RejectReason } | { game: GameState; positionId?: string; jumpedTo?: number };

function buy(market: Market, game: GameState, player: PlayerState, command: Extract<Command, { t: 'buy' }>): Verdict {
  const moment = momentAt(game.step);
  if (command.day !== moment.day) return { reason: 'wrongDay' };
  if (game.stress) return { reason: 'stressMode' };
  if (moment.phase !== 'preBell' && moment.phase !== 'open') return { reason: 'marketClosed' };
  const purchases = player.positions.filter((position) => position.day === moment.day).length;
  if (purchases >= MAX_DAILY_PURCHASES) return { reason: 'alreadyBought' };
  const board = boardFor(market, moment.day, game.targetsPerCompany);
  const quote = quoteAt(market, moment.day, moment.priceIndex, board, command.contractId);
  if (quote === null) return { reason: 'unknownContract' };
  if (!isOffered(board, command.contractId)) return { reason: 'notOffered' };
  if (!isTradable(quote.priceCents)) return { reason: 'tooCheap' };
  // Cash first: the cap is never more than the cash, so the other order would hide this reason.
  if (command.spendCents > player.cashCents) return { reason: 'notEnoughCash' };
  if (command.spendCents > remainingDaySpendCents(player, moment.day)) return { reason: 'overCap' };
  if (!withinTolerance(quote.priceCents, command.seenPriceCents)) return { reason: 'priceMoved' };
  const quantity = quantityForSpend(command.spendCents, quote.priceCents);
  if (quantity < 1) return { reason: 'spendTooSmall' };

  const ref = decodeContractId(board.targetsPerCompany, command.contractId);
  const costCents = totalCents(quote.priceCents, quantity);
  const position: PositionRecord = {
    id: purchases === 0 ? `d${moment.day}` : `d${moment.day}-p${purchases + 1}`,
    day: moment.day,
    contractId: command.contractId,
    companyId: ref.companyId,
    side: ref.side,
    targetCents: board.companies[ref.companyId]?.targets[ref.targetIndex] ?? 0,
    quantity,
    entryPriceCents: quote.priceCents,
    costCents,
    entryStep: game.step,
    entryPriceIndex: moment.priceIndex,
  };
  return {
    game: withPlayer(game, { ...player, cashCents: player.cashCents - costCents, positions: [...player.positions, position] }),
    positionId: position.id,
  };
}

function cashOut(market: Market, game: GameState, player: PlayerState, command: Extract<Command, { t: 'cashOut' }>): Verdict {
  const position = player.positions.find((candidate) => candidate.id === command.positionId);
  if (position === undefined) return { reason: 'unknownPosition' };
  // At or after the bell the ticket has already settled at the bell value: that is the outcome.
  if (position.exit?.kind === 'bell') return { game, positionId: position.id };
  if (position.exit !== undefined) return { reason: 'alreadyClosed' };
  const moment = momentAt(game.step);
  const board = boardFor(market, position.day, game.targetsPerCompany);
  const priceCents = quoteAt(market, position.day, moment.priceIndex, board, position.contractId)?.priceCents ?? 0;
  const proceedsCents = totalCents(priceCents, position.quantity);
  const exit: PositionExit = { kind: 'cashOut', step: game.step, priceIndex: moment.priceIndex, priceCents, proceedsCents };
  return {
    game: withPlayer(game, {
      ...player,
      cashCents: player.cashCents + proceedsCents,
      positions: player.positions.map((candidate) => (candidate === position ? { ...position, exit } : candidate)),
    }),
    positionId: position.id,
  };
}

/** `start` and the clock commands change what every player shares; `buy` and `cashOut` change the named player's account only. */
function decide(market: Market, game: GameState, player: PlayerState, command: Command): Verdict {
  if (command.t === 'start') {
    return game.pace === null ? { game: { ...game, pace: command.pace, step: 0 } } : { reason: 'alreadyStarted' };
  }
  if (game.pace === null) return { reason: 'notStarted' };
  if (command.t === 'cashOut') return cashOut(market, game, player, command);
  if (game.step >= GAME_STEPS) return { reason: 'gameOver' };
  if (command.t === 'buy') return buy(market, game, player, command);
  if (command.day !== momentAt(game.step).day) return { reason: 'wrongDay' };
  const jumpedTo = jumpTarget(command.t, game.step);
  if (jumpedTo === null) return { reason: 'wrongPhase' };
  return { game: advanceTo(market, game, jumpedTo), jumpedTo };
}

/**
 * Apply one player's schema-valid command at the server's logical step on
 * receipt. A commandId this player has sent before returns the original
 * receipt and changes nothing. The receipt, the logged input and the
 * revision are the named player's, whatever the command changed.
 */
export function applyCommand(market: Market, game: GameState, playerId: string, command: Command, step: number): CommandResult {
  const original = playerOf(game, playerId).receipts.find((receipt) => receipt.commandId === command.commandId);
  if (original !== undefined) return { game, receipt: original, repeat: true };

  const settled = advanceTo(market, game, step);
  const verdict = decide(market, settled, playerOf(settled, playerId), command);
  const base = { commandId: command.commandId, kind: command.t, step: settled.step };
  const receipt: Receipt =
    'reason' in verdict
      ? { ...base, outcome: 'rejected', reason: verdict.reason }
      : { ...base, outcome: 'accepted', ...(verdict.positionId === undefined ? {} : { positionId: verdict.positionId }) };
  const after = 'reason' in verdict ? settled : verdict.game;
  const player = playerOf(after, playerId);
  const next = withPlayer(after, {
    ...player,
    rev: player.rev + 1,
    receipts: [...player.receipts, receipt],
    log: [...player.log, { step: settled.step, command }],
  });
  const jumpedTo = 'reason' in verdict ? undefined : verdict.jumpedTo;
  return jumpedTo === undefined ? { game: next, receipt, repeat: false } : { game: next, receipt, repeat: false, jumpedTo };
}
