import { contractId } from '@strike-desk/shared/protocol';
import type { CompanyView, Frame, Side } from '@strike-desk/shared/protocol';

/**
 * One table row per ticket, and the rule for which rows a frame changed.
 *
 * Pure: no React, no engine, no clock. Everything a row shows arrives in the
 * frame, because the page may not compute money and may not import the code
 * that knows the future.
 *
 * The row order is the one the table shows by default: company by company in
 * id order, and inside a company every UP target ascending, then every DOWN
 * target ascending. Contract ids interleave the two sides, so that order is
 * deliberately not id order.
 */

export interface ContractRow {
  /** The contract id as text: the table identifies rows by it, and wants a string. */
  id: string;
  contractId: number;
  companyId: number;
  company: string;
  ticker: string;
  side: Side;
  targetCents: number;
  priceCents: number;
  /**
   * The two parts of the price, exactly as the server sends them: how far the
   * share price is past the target right now, and what the time still to run
   * is worth. They add up to the price, and the page never works either of
   * them out — it only shows what it was sent.
   */
  realCents: number;
  hopeCents: number;
  /** True while this ticket is too cheap to trade: its money cells show a dash. */
  dimmed: boolean;
  /** Which way the price just moved: 1 up, -1 down, 0 for no move. */
  dir: -1 | 0 | 1;
}

type Board = NonNullable<Frame['board']>;

export interface RowInput {
  board: Board;
  companies: readonly CompanyView[];
  quotes: readonly number[];
  /** The real and hope parts of every quote, by contract id, as the frame sends them. */
  quoteReals: readonly number[];
  quoteHopes: readonly number[];
  minTicketCents: number;
  /** True while tickets can be bought, which is the only time a row is dimmed. */
  buyable: boolean;
}

const SIDES: readonly Side[] = ['up', 'down'];

/**
 * Walks the board in the default row order, handing out each contract's id
 * once. Both functions below share it, so they cannot drift apart.
 */
function eachContract(
  board: Board,
  visit: (id: number, companyId: number, targetIndex: number, side: Side, targetCents: number) => void,
): void {
  for (let companyId = 0; companyId < board.companies.length; companyId += 1) {
    const targets = board.companies[companyId]?.targets ?? [];
    for (const side of SIDES) {
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const id = contractId(board.targetsPerCompany, { companyId, targetIndex, side });
        visit(id, companyId, targetIndex, side, targets[targetIndex] ?? 0);
      }
    }
  }
}

function makeRow(
  input: RowInput,
  id: number,
  companyId: number,
  side: Side,
  targetCents: number,
  dir: -1 | 0 | 1,
): ContractRow {
  const company = input.companies[companyId];
  const priceCents = input.quotes[id] ?? 0;
  return {
    id: String(id),
    contractId: id,
    companyId,
    company: company?.name ?? '',
    ticker: company?.ticker ?? '',
    side,
    targetCents,
    priceCents,
    realCents: input.quoteReals[id] ?? 0,
    hopeCents: input.quoteHopes[id] ?? 0,
    dimmed: input.buyable && priceCents < input.minTicketCents,
    dir,
  };
}

/** Every row of the board, in the default order, none of them moving yet. */
export function buildRows(input: RowInput): ContractRow[] {
  const rows: ContractRow[] = [];
  eachContract(input.board, (id, companyId, _targetIndex, side, targetCents) => {
    rows.push(makeRow(input, id, companyId, side, targetCents, 0));
  });
  return rows;
}

/**
 * The rows this frame changed: a new object for every contract whose price,
 * real value, hope value or dimmed state differs from the row held for it,
 * and nothing at all for the rest. A held row is never modified, because the
 * table tells an update from a repeat by the object's identity.
 *
 * A ticket's two parts can move while its price stands still — a dollar of
 * hope becoming a dollar of real value is the same price and a different
 * ticket — so such a row is sent too, with no direction, because only the
 * price is allowed to flash.
 */
export function changedRows(heldById: readonly (ContractRow | undefined)[], input: RowInput): ContractRow[] {
  const changed: ContractRow[] = [];
  eachContract(input.board, (id, companyId, _targetIndex, side, targetCents) => {
    const held = heldById[id];
    const priceCents = input.quotes[id] ?? 0;
    const dimmed = input.buyable && priceCents < input.minTicketCents;
    if (held === undefined) {
      changed.push(makeRow(input, id, companyId, side, targetCents, 0));
      return;
    }
    if (
      priceCents === held.priceCents &&
      dimmed === held.dimmed &&
      (input.quoteReals[id] ?? 0) === held.realCents &&
      (input.quoteHopes[id] ?? 0) === held.hopeCents
    ) {
      return;
    }
    const dir = priceCents > held.priceCents ? 1 : priceCents < held.priceCents ? -1 : 0;
    changed.push(makeRow(input, id, companyId, side, targetCents, dir));
  });
  return changed;
}
