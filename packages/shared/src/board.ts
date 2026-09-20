import type { Cents } from './money';
import { sharePriceCents } from './money';

/**
 * The contract board for one day. Every company has the same number of
 * targets, UP and DOWN on each, so a contract's numeric id encodes all
 * three parts and stays stable for the day. `quotes[contractId]` in a frame
 * is that contract's price.
 */

export type Side = 'up' | 'down';

export const DEFAULT_TARGETS_PER_COMPANY = 21;
/** Targets span this many expected moves either side of the opening price. */
export const BOARD_SPAN_MOVES = 2;
/** Close, Far, Moonshot: distance from the opening price, in expected moves. */
export const SIMPLE_CHOICE_MOVES = [0.35, 0.9, 1.6] as const;
export type SimpleChoice = 'close' | 'far' | 'moonshot';
export const SIMPLE_CHOICES: readonly SimpleChoice[] = ['close', 'far', 'moonshot'];

export interface CompanyBoard {
  /** Ascending, in cents. */
  targets: Cents[];
  /** Target indexes for Close, Far, Moonshot on the UP side. */
  simpleUp: [number, number, number];
  /** Target indexes for Close, Far, Moonshot on the DOWN side. */
  simpleDown: [number, number, number];
}

export interface Board {
  targetsPerCompany: number;
  companies: CompanyBoard[];
}

export interface ContractRef {
  companyId: number;
  targetIndex: number;
  side: Side;
}

export function contractId(targetsPerCompany: number, ref: ContractRef): number {
  return (ref.companyId * targetsPerCompany + ref.targetIndex) * 2 + (ref.side === 'up' ? 0 : 1);
}

export function decodeContractId(targetsPerCompany: number, id: number): ContractRef {
  const side: Side = id % 2 === 0 ? 'up' : 'down';
  const slot = Math.floor(id / 2);
  return {
    companyId: Math.floor(slot / targetsPerCompany),
    targetIndex: slot % targetsPerCompany,
    side,
  };
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

function nearestIndex(targets: readonly Cents[], wantedCents: number): number {
  let best = 0;
  let bestGap = Infinity;
  targets.forEach((target, index) => {
    const gap = Math.abs(target - wantedCents);
    if (gap < bestGap) {
      best = index;
      bestGap = gap;
    }
  });
  return best;
}

/**
 * `expectedMove` is a fraction of the opening price (0.061 for 6.1%). It is
 * public: it depends only on the day's headline trust level, never on the
 * hidden outcome.
 */
export function buildCompanyBoard(openPrice: number, expectedMove: number, targetsPerCompany: number): CompanyBoard {
  const low = openPrice * (1 - BOARD_SPAN_MOVES * expectedMove);
  const high = openPrice * (1 + BOARD_SPAN_MOVES * expectedMove);
  const targets: Cents[] = [];
  for (let i = 0; i < targetsPerCompany; i += 1) {
    const fraction = targetsPerCompany === 1 ? 0.5 : i / (targetsPerCompany - 1);
    targets.push(sharePriceCents(low + (high - low) * fraction));
  }
  const pick = (sign: 1 | -1): [number, number, number] => {
    const [close, far, moonshot] = SIMPLE_CHOICE_MOVES.map((moves) =>
      nearestIndex(targets, sharePriceCents(openPrice * (1 + sign * moves * expectedMove))),
    ) as [number, number, number];
    return [close, far, moonshot];
  };
  return { targets, simpleUp: pick(1), simpleDown: pick(-1) };
}
