import type { Side } from './board';
import { DEFAULT_TARGETS_PER_COMPANY, decodeContractId } from './board';
import type { Pace } from './clock';
import { DAYS, GAME_STEPS, OPEN_STEPS, bellStep, jumpTarget, momentAt } from './clock';
import type { Market } from './market';
import { boardFor, quoteAt } from './market';
import type { Cents } from './money';
import { quantityForSpend, totalCents } from './money';
import { SHARES_PER_TICKET, isTradable } from './pricing';
import type { Command, Receipt, RejectReason } from './protocol';

/**
 * The rules of one player's game, as pure functions of the logical step.
 * No wall clock in here: `applyCommand` and `advanceTo` take the step, so a
 * logged game replays exactly at any pace. The command path is one
 * synchronous call: check for a repeat, settle up to the step, apply, store
 * the receipt, log the input.
 */

export const STARTING_CASH_CENTS: Cents = 100_000_000;
/** At most this share of cash may go on one day's ticket... */
export const SPEND_CAP_FRACTION = 0.5;
/** ...rounded down to a multiple of this. */
export const SPEND_CAP_ROUND_CENTS: Cents = 100_000;
/** A buy fills at the server's price if that is no more than this much worse than the price seen (basis points). */
export const PRICE_TOLERANCE_BPS = 200;

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

export interface GameState {
  /** Goes up with every stored receipt and every settlement. */
  rev: number;
  /** The latest step this state has been advanced to. Never goes back. */
  step: number;
  /** Null until `start`: the lobby. */
  pace: Pace | null;
  cashCents: Cents;
  positions: PositionRecord[];
  receipts: Receipt[];
  /** Every schema-valid, non-repeated command with the step it arrived at. With the market identity, enough to replay the game. */
  log: LoggedInput[];
  /** Cash after each closing bell so far, by day. */
  dayEndCents: Cents[];
  targetsPerCompany: number;
  /** Stress setting: a bigger board, buying disabled. */
  stress: boolean;
}

export function newGame(options: { targetsPerCompany?: number } = {}): GameState {
  const targetsPerCompany = options.targetsPerCompany ?? DEFAULT_TARGETS_PER_COMPANY;
  return {
    rev: 0,
    step: 0,
    pace: null,
    cashCents: STARTING_CASH_CENTS,
    positions: [],
    receipts: [],
    log: [],
    dayEndCents: [],
    targetsPerCompany,
    stress: targetsPerCompany !== DEFAULT_TARGETS_PER_COMPANY,
  };
}

export function spendCapCents(cashCents: Cents): Cents {
  const half = Math.floor(cashCents * SPEND_CAP_FRACTION);
  return Math.floor(half / SPEND_CAP_ROUND_CENTS) * SPEND_CAP_ROUND_CENTS;
}

/** The share price at which a ticket has earned back what it cost. */
export function breakEvenCents(targetCents: Cents, ticketPriceCentsPaid: Cents, side: Side): Cents {
  const perShare = Math.round(ticketPriceCentsPaid / SHARES_PER_TICKET);
  return side === 'up' ? targetCents + perShare : targetCents - perShare;
}

/** True when the fill price is within tolerance of the price the player saw. Integer maths only. */
export function withinTolerance(fillPriceCents: Cents, seenPriceCents: Cents): boolean {
  return fillPriceCents * 10_000 <= seenPriceCents * (10_000 + PRICE_TOLERANCE_BPS);
}

/**
 * Bring the state up to a step: settle any ticket whose closing bell has
 * rung, exactly once, at the bell's value, and note each finished day's
 * cash. Calling it late, early or often gives the same cash.
 */
export function advanceTo(market: Market, game: GameState, step: number): GameState {
  const target = Math.min(Math.max(step, game.step), GAME_STEPS);
  if (game.pace === null) return game;
  let next = game;
  for (let day = game.dayEndCents.length + 1; day <= DAYS && bellStep(day) <= target; day += 1) {
    let cashCents = next.cashCents;
    let rev = next.rev;
    const positions = next.positions.map((position) => {
      if (position.day !== day || position.exit !== undefined) return position;
      const board = boardFor(market, day, next.targetsPerCompany);
      const priceCents = quoteAt(market, day, OPEN_STEPS, board, position.contractId)?.priceCents ?? 0;
      const proceedsCents = totalCents(priceCents, position.quantity);
      cashCents += proceedsCents;
      rev += 1;
      const exit: PositionExit = { kind: 'bell', step: bellStep(day), priceIndex: OPEN_STEPS, priceCents, proceedsCents };
      return { ...position, exit };
    });
    next = { ...next, rev, cashCents, positions, dayEndCents: [...next.dayEndCents, cashCents] };
  }
  return target === next.step ? next : { ...next, step: target };
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

function buy(market: Market, game: GameState, command: Extract<Command, { t: 'buy' }>): Verdict {
  const moment = momentAt(game.step);
  if (command.day !== moment.day) return { reason: 'wrongDay' };
  if (game.stress) return { reason: 'stressMode' };
  if (moment.phase !== 'preBell' && moment.phase !== 'open') return { reason: 'marketClosed' };
  if (game.positions.some((position) => position.day === moment.day)) return { reason: 'alreadyBought' };
  const board = boardFor(market, moment.day, game.targetsPerCompany);
  const quote = quoteAt(market, moment.day, moment.priceIndex, board, command.contractId);
  if (quote === null) return { reason: 'unknownContract' };
  if (!isTradable(quote.priceCents)) return { reason: 'tooCheap' };
  // Cash first: the cap is never more than the cash, so the other order would hide this reason.
  if (command.spendCents > game.cashCents) return { reason: 'notEnoughCash' };
  if (command.spendCents > spendCapCents(game.cashCents)) return { reason: 'overCap' };
  if (!withinTolerance(quote.priceCents, command.seenPriceCents)) return { reason: 'priceMoved' };
  const quantity = quantityForSpend(command.spendCents, quote.priceCents);
  if (quantity < 1) return { reason: 'spendTooSmall' };

  const ref = decodeContractId(board.targetsPerCompany, command.contractId);
  const costCents = totalCents(quote.priceCents, quantity);
  const position: PositionRecord = {
    id: `d${moment.day}`,
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
    game: { ...game, cashCents: game.cashCents - costCents, positions: [...game.positions, position] },
    positionId: position.id,
  };
}

function cashOut(market: Market, game: GameState, command: Extract<Command, { t: 'cashOut' }>): Verdict {
  const position = game.positions.find((candidate) => candidate.id === command.positionId);
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
    game: {
      ...game,
      cashCents: game.cashCents + proceedsCents,
      positions: game.positions.map((candidate) => (candidate === position ? { ...position, exit } : candidate)),
    },
    positionId: position.id,
  };
}

function decide(market: Market, game: GameState, command: Command): Verdict {
  if (command.t === 'start') {
    return game.pace === null ? { game: { ...game, pace: command.pace, step: 0 } } : { reason: 'alreadyStarted' };
  }
  if (game.pace === null) return { reason: 'notStarted' };
  if (command.t === 'cashOut') return cashOut(market, game, command);
  if (game.step >= GAME_STEPS) return { reason: 'gameOver' };
  if (command.t === 'buy') return buy(market, game, command);
  if (command.day !== momentAt(game.step).day) return { reason: 'wrongDay' };
  const jumpedTo = jumpTarget(command.t, game.step);
  if (jumpedTo === null) return { reason: 'wrongPhase' };
  return { game: advanceTo(market, game, jumpedTo), jumpedTo };
}

/**
 * Apply one schema-valid command at the server's logical step on receipt.
 * A repeated commandId returns the original receipt and changes nothing.
 */
export function applyCommand(market: Market, game: GameState, command: Command, step: number): CommandResult {
  const original = game.receipts.find((receipt) => receipt.commandId === command.commandId);
  if (original !== undefined) return { game, receipt: original, repeat: true };

  const settled = advanceTo(market, game, step);
  const verdict = decide(market, settled, command);
  const base = { commandId: command.commandId, kind: command.t, step: settled.step };
  const receipt: Receipt =
    'reason' in verdict
      ? { ...base, outcome: 'rejected', reason: verdict.reason }
      : { ...base, outcome: 'accepted', ...(verdict.positionId === undefined ? {} : { positionId: verdict.positionId }) };
  const after = 'reason' in verdict ? settled : verdict.game;
  const next: GameState = {
    ...after,
    rev: after.rev + 1,
    receipts: [...after.receipts, receipt],
    log: [...after.log, { step: settled.step, command }],
  };
  const jumpedTo = 'reason' in verdict ? undefined : verdict.jumpedTo;
  return jumpedTo === undefined ? { game: next, receipt, repeat: false } : { game: next, receipt, repeat: false, jumpedTo };
}
