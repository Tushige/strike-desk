import { describe, expect, it } from 'vitest';
import type { Side } from '../src/board';
import { DEFAULT_TARGETS_PER_COMPANY, buildCompanyBoard, contractCount, contractId, contractTarget, decodeContractId } from '../src/board';
import { CAST, COMPANY_COUNT } from '../src/cast';
import { CONTENT_VERSION, ENGINE_VERSION, boardFor, buildMarket } from '../src/market';

const market = buildMarket({ seed: 4242, engine: ENGINE_VERSION, content: CONTENT_VERSION });

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
