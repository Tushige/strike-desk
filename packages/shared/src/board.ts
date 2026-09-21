import type { Cents } from './money';
import { sharePriceCents } from './money';
import { decodeContractId } from './protocol';

/**
 * The contract board for one day. Every company has the same number of
 * targets, UP and DOWN on each, so a contract's numeric id encodes all
 * three parts and stays stable for the day. `quotes[contractId]` in a frame
 * is that contract's price, so the id scheme itself lives in the wire
 * contract (`protocol.ts`).
 *
 * A board may offer less than it lists. A target is "already passed" when it
 * sits on the far side of the opening price for its direction: below it for
 * UP, above it for DOWN. Each company's board says how far into those targets
 * each side is still on offer. A contract that is not offered keeps its id,
 * its target and its place in `quotes`; it simply cannot be bought.
 */

export const DEFAULT_TARGETS_PER_COMPANY = 21;
/** Targets span this many expected moves either side of the opening price. */
export const BOARD_SPAN_MOVES = 2;
/** How many expected moves of already-passed targets stay on offer. The board's full span: every contract is offered. */
export const OFFERED_PASSED_MOVES = BOARD_SPAN_MOVES;
/**
 * Close, Far, Moonshot: distance from the opening price, in expected moves.
 * The three are chosen to sit on the board's own grid points, which are 0.2
 * expected moves apart at 21 targets, so nothing is ever a tie between two
 * targets, and Far is exactly one expected move away on both sides.
 */
export const SIMPLE_CHOICE_MOVES = [0.4, 1, 1.6] as const;
export type SimpleChoice = 'close' | 'far' | 'moonshot';
export const SIMPLE_CHOICES: readonly SimpleChoice[] = ['close', 'far', 'moonshot'];

export interface CompanyBoard {
  /** Ascending, in cents. */
  targets: Cents[];
  /** Target indexes for Close, Far, Moonshot on the UP side. */
  simpleUp: [number, number, number];
  /** Target indexes for Close, Far, Moonshot on the DOWN side. */
  simpleDown: [number, number, number];
  /** UP is offered on target indexes at or above this. 0 on the full board. */
  lowestUpIndex: number;
  /** DOWN is offered on target indexes at or below this. The last index on the full board. */
  highestDownIndex: number;
}

export interface Board {
  targetsPerCompany: number;
  companies: CompanyBoard[];
}

export function contractCount(board: Board): number {
  return board.companies.length * board.targetsPerCompany * 2;
}

/** The contract's target in cents, or null when the id is not on the board. */
export function contractTarget(board: Board, id: number): Cents | null {
  if (!Number.isInteger(id) || id < 0) return null;
  const ref = decodeContractId(board.targetsPerCompany, id);
  return board.companies[ref.companyId]?.targets[ref.targetIndex] ?? null;
}

/**
 * True when the contract can be bought on this board. False for anything that
 * is not a whole-number id on the board, so a caller may ask about any number.
 */
export function isOffered(board: Board, id: number): boolean {
  if (!Number.isInteger(id) || id < 0 || id >= contractCount(board)) return false;
  const ref = decodeContractId(board.targetsPerCompany, id);
  const company = board.companies[ref.companyId];
  if (company === undefined) return false;
  return ref.side === 'up' ? ref.targetIndex >= company.lowestUpIndex : ref.targetIndex <= company.highestDownIndex;
}

/**
 * Where Close, Far and Moonshot sit on a board of this size. The money is the
 * middle of the board and the targets are evenly spaced, so a distance in
 * expected moves is a whole number of targets: 2, 5 and 8 at 21 targets. UP
 * counts that many targets up from the money and DOWN the same number down,
 * whatever the prices are. On a board with no middle target each side rounds
 * away from the money, and an index never leaves the board.
 */
function simpleChoiceIndexes(targetsPerCompany: number, sign: 1 | -1): [number, number, number] {
  const lastIndex = Math.max(0, targetsPerCompany - 1);
  const moneyIndex = lastIndex / 2;
  const [close, far, moonshot] = SIMPLE_CHOICE_MOVES.map((moves) => {
    const offset = Math.round((moves * lastIndex) / (2 * BOARD_SPAN_MOVES));
    const index = sign === 1 ? Math.ceil(moneyIndex + offset) : Math.floor(moneyIndex - offset);
    return Math.min(lastIndex, Math.max(0, index));
  }) as [number, number, number];
  return [close, far, moonshot];
}

/**
 * `expectedMove` is a fraction of the opening price (0.061 for 6.1%). It is
 * public: it depends only on the day's headline trust level, never on the
 * hidden outcome.
 *
 * `offeredPassedMoves` trims what is offered, never what is listed: targets,
 * ids and the simple choices are the same whatever it is.
 */
export function buildCompanyBoard(openPrice: number, expectedMove: number, targetsPerCompany: number, offeredPassedMoves = OFFERED_PASSED_MOVES): CompanyBoard {
  if (!Number.isFinite(offeredPassedMoves) || offeredPassedMoves < 0) throw new Error('the offered already-passed moves must be a number at or above zero');
  const low = openPrice * (1 - BOARD_SPAN_MOVES * expectedMove);
  const high = openPrice * (1 + BOARD_SPAN_MOVES * expectedMove);
  const targets: Cents[] = [];
  for (let i = 0; i < targetsPerCompany; i += 1) {
    const fraction = targetsPerCompany === 1 ? 0.5 : i / (targetsPerCompany - 1);
    targets.push(sharePriceCents(low + (high - low) * fraction));
  }
  const simpleUp = simpleChoiceIndexes(targetsPerCompany, 1);
  const simpleDown = simpleChoiceIndexes(targetsPerCompany, -1);
  const lastIndex = targets.length - 1;
  // At or past the full span nothing is compared: a one-cent rounding difference
  // at the edge of the grid can never drop a contract from the full board.
  if (offeredPassedMoves >= BOARD_SPAN_MOVES) {
    return { targets, simpleUp, simpleDown, lowestUpIndex: 0, highestDownIndex: lastIndex };
  }
  // The same rounding function and the same shape of expression as the targets themselves.
  const lowestUpCents = sharePriceCents(openPrice * (1 - offeredPassedMoves * expectedMove));
  const highestDownCents = sharePriceCents(openPrice * (1 + offeredPassedMoves * expectedMove));
  const firstAtOrAbove = targets.findIndex((target) => target >= lowestUpCents);
  const lastAtOrBelow = targets.findLastIndex((target) => target <= highestDownCents);
  return {
    targets,
    simpleUp,
    simpleDown,
    lowestUpIndex: firstAtOrAbove === -1 ? lastIndex : firstAtOrAbove,
    highestDownIndex: lastAtOrBelow === -1 ? 0 : lastAtOrBelow,
  };
}
