import type { Frame, Side } from '@strike-desk/shared/protocol';
import { contractId as contractIdOf, decodeContractId } from '@strike-desk/shared/protocol';
import type { SimpleChoice, TicketContract } from '../../modules/order-ticket/index';

/**
 * How the simple way of picking a ticket maps onto the board. The board
 * names, per company, which three targets are the Close, Far and Moonshot
 * choices for UP and for DOWN; a pick is just a lookup in it. No price is
 * read here.
 */

export type Choice = SimpleChoice['choice'];
export const CHOICES: readonly Choice[] = ['close', 'far', 'moonshot'];
export const CHOICE_NOTES: Record<Choice, string> = {
  close: 'Easier to hit. Pays less.',
  far: 'Harder to hit. Pays more.',
  moonshot: 'Long shot. Pays huge.',
};

type Board = NonNullable<Frame['board']>;

/** The six simple choices for one company, in the order the panel lists them: UP close, far, moonshot; then DOWN. */
export function choicesFor(board: Board | null, companyId: number): SimpleChoice[] {
  const company = board?.companies[companyId];
  if (board === null || company === undefined) return [];
  const choices: SimpleChoice[] = [];
  for (const side of ['up', 'down'] as const) {
    const indexes = side === 'up' ? company.simpleUp : company.simpleDown;
    CHOICES.forEach((choice, i) => {
      const targetIndex = indexes[i];
      if (targetIndex === undefined) return;
      const targetCents = company.targets[targetIndex];
      if (targetCents === undefined) return;
      choices.push({ side, choice, contractId: contractIdOf(board.targetsPerCompany, { companyId, targetIndex, side }), targetCents });
    });
  }
  return choices;
}

/** The contract the desk has selected, as the order ticket wants it, or null when nothing is chosen. */
export function contractFor(frame: Frame, contractId: number | null): TicketContract | null {
  const board = frame.board;
  if (board === null || contractId === null) return null;
  const ref = decodeContractId(board.targetsPerCompany, contractId);
  const company = board.companies[ref.companyId];
  const names = frame.companies[ref.companyId];
  const targetCents = company?.targets[ref.targetIndex];
  if (company === undefined || names === undefined || targetCents === undefined) return null;
  // The board offers UP from its lowest UP target up, and DOWN from its highest DOWN target down.
  const offered = ref.side === 'up' ? ref.targetIndex >= company.lowestUpIndex : ref.targetIndex <= company.highestDownIndex;
  return { contractId, companyName: names.name, ticker: names.ticker, side: ref.side, targetCents, offered };
}

/** Which company a contract belongs to. */
export function companyOf(frame: Frame, contractId: number): number | null {
  const board = frame.board;
  if (board === null) return null;
  return decodeContractId(board.targetsPerCompany, contractId).companyId;
}

/** The player's pick so far: a side, one of the three choices, or an exact contract from the table. */
export interface Pick {
  side: Side | null;
  choice: Choice | null;
  /** Set only when the table picked an exact row; the side and choice then follow it. */
  contractId: number | null;
}

export const NO_PICK: Pick = { side: null, choice: null, contractId: null };

/**
 * The contract a pick means on a company's board. A table pick is exact; a
 * simple pick snaps to that company's Close, Far or Moonshot target, so the
 * same pick follows the player from company to company.
 */
export function contractIdFor(frame: Frame, companyId: number, pick: Pick): number | null {
  if (pick.contractId !== null) return pick.contractId;
  if (pick.side === null || pick.choice === null) return null;
  const found = choicesFor(frame.board, companyId).find((choice) => choice.side === pick.side && choice.choice === pick.choice);
  return found?.contractId ?? null;
}

/** A pick made from the table: the exact row, and the side and choice it happens to match, if any. */
export function pickFromTable(frame: Frame, contractId: number): Pick {
  const board = frame.board;
  if (board === null) return { side: null, choice: null, contractId };
  const ref = decodeContractId(board.targetsPerCompany, contractId);
  const match = choicesFor(board, ref.companyId).find((choice) => choice.contractId === contractId);
  return { side: ref.side, choice: match?.choice ?? null, contractId };
}
