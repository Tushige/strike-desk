import { describe, expect, it } from 'vitest';
import type { Side } from '../src/board';
import type { Board } from '../src/board';
import {
  BOARD_SPAN_MOVES,
  DEFAULT_TARGETS_PER_COMPANY,
  OFFERED_PASSED_MOVES,
  buildCompanyBoard,
  contractCount,
  contractId,
  contractTarget,
  decodeContractId,
  isOffered,
} from '../src/board';
import { CAST, COMPANY_COUNT } from '../src/cast';
import { CONTENT_VERSION, ENGINE_VERSION, boardFor, buildMarket, quoteAt } from '../src/market';

const IDENTITY = { seed: 4242, engine: ENGINE_VERSION, content: CONTENT_VERSION };
const market = buildMarket(IDENTITY);

describe('contract ids', () => {
  it.each([21, 209])('round-trip for %i targets per company and fill 0..n-1 exactly once', (targets) => {
    const seen = new Set<number>();
    for (let companyId = 0; companyId < COMPANY_COUNT; companyId += 1) {
      for (let targetIndex = 0; targetIndex < targets; targetIndex += 1) {
        for (const side of ['up', 'down'] as Side[]) {
          const ref = { companyId, targetIndex, side };
          const id = contractId(targets, ref);
          expect(decodeContractId(targets, id)).toEqual(ref);
          seen.add(id);
        }
      }
    }
    expect(seen.size).toBe(COMPANY_COUNT * targets * 2);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(COMPANY_COUNT * targets * 2 - 1);
  });
});

describe('the day board', () => {
  it('has 252 contracts by default', () => {
    const board = boardFor(market, 1);
    expect(board.targetsPerCompany).toBe(DEFAULT_TARGETS_PER_COMPANY);
    expect(board.companies).toHaveLength(6);
    expect(contractCount(board)).toBe(252);
    expect(contractCount(boardFor(market, 1, 209))).toBe(2508);
  });

  it('is the same object each time it is asked for', () => {
    expect(boardFor(market, 3)).toBe(boardFor(market, 3));
    expect(boardFor(market, 3, 209)).not.toBe(boardFor(market, 3));
  });

  it('lists whole-cent targets in rising order around the opening price', () => {
    for (let day = 1; day <= 5; day += 1) {
      boardFor(market, day).companies.forEach((company, companyId) => {
        const open = Math.round((market.days[day - 1]?.paths[companyId]?.[0] ?? 0) * 100);
        expect(company.targets).toHaveLength(21);
        company.targets.forEach((target, index) => {
          expect(Number.isInteger(target)).toBe(true);
          if (index > 0) expect(target).toBeGreaterThan(company.targets[index - 1] ?? Infinity);
        });
        expect(company.targets[0]).toBeLessThan(open);
        expect(company.targets[20]).toBeGreaterThan(open);
        expect(Math.abs((company.targets[10] ?? 0) - open)).toBeLessThanOrEqual(1);
      });
    }
  });

  it('puts Close, Far and Moonshot on the right side of the opening price, further each time', () => {
    for (const targets of [21, 209]) {
      for (const company of CAST) {
        for (const expectedMove of [0.035, 0.061, 0.154]) {
          const board = buildCompanyBoard(company.startPrice, expectedMove, targets);
          const open = company.startPrice * 100;
          const up = board.simpleUp.map((index) => board.targets[index] ?? NaN);
          const down = board.simpleDown.map((index) => board.targets[index] ?? NaN);
          expect(up[0]).toBeGreaterThan(open);
          expect(up[1]).toBeGreaterThan(up[0] ?? NaN);
          expect(up[2]).toBeGreaterThan(up[1] ?? NaN);
          expect(down[0]).toBeLessThan(open);
          expect(down[1]).toBeLessThan(down[0] ?? NaN);
          expect(down[2]).toBeLessThan(down[1] ?? NaN);
        }
      }
    }
  });

  it('answers null for an id that is not on the board', () => {
    const board = boardFor(market, 1);
    expect(contractTarget(board, 0)).toBe(board.companies[0]?.targets[0]);
    expect(contractTarget(board, 251)).toBe(board.companies[5]?.targets[20]);
    expect(contractTarget(board, 252)).toBeNull();
    expect(contractTarget(board, -1)).toBeNull();
    expect(contractTarget(board, 1.5)).toBeNull();
  });
});

describe('what a board offers', () => {
  /** A one-company board: open price $100, expected move 5%, 21 targets, so the targets are $90 to $110 in whole dollars. */
  const oneCompany = (offeredPassedMoves?: number): Board => ({
    targetsPerCompany: 21,
    companies: [offeredPassedMoves === undefined ? buildCompanyBoard(100, 0.05, 21) : buildCompanyBoard(100, 0.05, 21, offeredPassedMoves)],
  });
  const idOf = (targetIndex: number, side: Side): number => contractId(21, { companyId: 0, targetIndex, side });

  it('keeps the whole board on offer until a trim is chosen: the constant is the full span', () => {
    expect(OFFERED_PASSED_MOVES).toBe(BOARD_SPAN_MOVES);
  });

  it.each([21, 209])('the default board of %i targets offers every contract, and nothing that is not on it', (targets) => {
    for (let day = 1; day <= 5; day += 1) {
      const board = boardFor(market, day, targets);
      for (const company of board.companies) {
        expect(company.lowestUpIndex).toBe(0);
        expect(company.highestDownIndex).toBe(targets - 1);
      }
      const total = contractCount(board);
      expect(total).toBe(COMPANY_COUNT * targets * 2);
      for (let id = 0; id < total; id += 1) expect(isOffered(board, id)).toBe(true);
      for (const id of [-1, 1.5, total, total + 1, NaN, Infinity]) expect(isOffered(board, id)).toBe(false);
    }
  });

  it('a value at or above the full span never drops a contract, whatever the rounding at the edge of the grid', () => {
    for (const company of CAST) {
      for (const expectedMove of [0.035, 0.061, 0.154]) {
        for (const value of [BOARD_SPAN_MOVES, BOARD_SPAN_MOVES + 0.5, 100]) {
          const board = buildCompanyBoard(company.startPrice, expectedMove, 21, value);
          expect([board.lowestUpIndex, board.highestDownIndex]).toEqual([0, 20]);
        }
      }
    }
  });

  it('trimmed to 0.4 expected moves, UP is offered from $98 and DOWN up to $102', () => {
    const board = buildCompanyBoard(100, 0.05, 21, 0.4);
    expect(board.targets).toEqual(Array.from({ length: 21 }, (_, index) => 9000 + index * 100));
    expect(board.lowestUpIndex).toBe(8);
    expect(board.highestDownIndex).toBe(12);
    expect(board.targets[board.lowestUpIndex]).toBe(9800);
    expect(board.targets[board.highestDownIndex]).toBe(10_200);
  });

  it('on the trimmed board UP is refused on indexes 0 to 7 and DOWN on 13 to 20, and nothing else', () => {
    const board = oneCompany(0.4);
    for (let index = 0; index < 21; index += 1) {
      expect(isOffered(board, idOf(index, 'up'))).toBe(index >= 8);
      expect(isOffered(board, idOf(index, 'down'))).toBe(index <= 12);
    }
    for (const id of [-1, 1.5, 42, 43]) expect(isOffered(board, id)).toBe(false);
  });

  it('trimming changes no target, no contract id and no count', () => {
    const full = oneCompany();
    const trimmed = oneCompany(0.4);
    expect(trimmed.companies[0]?.targets).toEqual(full.companies[0]?.targets);
    expect(trimmed.companies[0]?.simpleUp).toEqual(full.companies[0]?.simpleUp);
    expect(trimmed.companies[0]?.simpleDown).toEqual(full.companies[0]?.simpleDown);
    expect(contractCount(trimmed)).toBe(contractCount(full));
    expect(contractCount(trimmed)).toBe(42);
    for (let id = 0; id < 42; id += 1) {
      expect(contractTarget(trimmed, id)).toBe(contractTarget(full, id));
      expect(decodeContractId(trimmed.targetsPerCompany, id)).toEqual(decodeContractId(full.targetsPerCompany, id));
    }
  });

  it('a trimmed market has the same prices, the same ids and the same quote for every id as the full one', () => {
    const trimmedMarket = buildMarket(IDENTITY, { offeredPassedMoves: 0.4 });
    expect(trimmedMarket.days).toEqual(market.days);
    for (const day of [1, 3, 5]) {
      const full = boardFor(market, day);
      const trimmed = boardFor(trimmedMarket, day);
      expect(contractCount(trimmed)).toBe(252);
      let refused = 0;
      for (let id = 0; id < 252; id += 1) {
        expect(contractTarget(trimmed, id)).toBe(contractTarget(full, id));
        expect(quoteAt(trimmedMarket, day, 100, trimmed, id)).toEqual(quoteAt(market, day, 100, full, id));
        if (!isOffered(trimmed, id)) refused += 1;
      }
      // Eight or so already-passed targets a side, per company: a real trim, and never the whole board.
      expect(refused).toBeGreaterThan(60);
      expect(refused).toBeLessThan(126);
    }
  });

  it('always offers Close, Far and Moonshot on both sides, trimmed or not', () => {
    for (const targets of [21, 209]) {
      for (const company of CAST) {
        for (const expectedMove of [0.035, 0.061, 0.154]) {
          for (const value of [undefined, 1, 0.4, 0.2, 0]) {
            const built = value === undefined ? buildCompanyBoard(company.startPrice, expectedMove, targets) : buildCompanyBoard(company.startPrice, expectedMove, targets, value);
            const board: Board = { targetsPerCompany: targets, companies: [built] };
            for (const index of built.simpleUp) expect(isOffered(board, contractId(targets, { companyId: 0, targetIndex: index, side: 'up' }))).toBe(true);
            for (const index of built.simpleDown) expect(isOffered(board, contractId(targets, { companyId: 0, targetIndex: index, side: 'down' }))).toBe(true);
          }
        }
      }
    }
  });

  it('refuses a trim value that is not a number at or above zero', () => {
    for (const value of [-0.1, NaN, Infinity]) {
      expect(() => buildCompanyBoard(100, 0.05, 21, value)).toThrow('at or above zero');
      expect(() => buildMarket(IDENTITY, { offeredPassedMoves: value })).toThrow('at or above zero');
    }
  });
});
