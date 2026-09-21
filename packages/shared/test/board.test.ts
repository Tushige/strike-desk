import { describe, expect, it } from 'vitest';
import type { Board } from '../src/board';
import { BOARD_SPAN_MOVES, DEFAULT_TARGETS_PER_COMPANY, OFFERED_PASSED_MOVES, SIMPLE_CHOICE_MOVES, buildCompanyBoard, contractCount, contractTarget, isOffered } from '../src/board';
import { CAST, COMPANY_COUNT } from '../src/cast';
import { FIRST_PLAYER_ID } from '../src/game';
import { CONTENT_VERSION, ENGINE_VERSION, boardFor, buildMarket, quoteAt } from '../src/market';
import type { Side } from '../src/protocol';
import { contractId, decodeContractId } from '../src/protocol';
import type { Session } from '../src/session';
import { createSession, frameFor, handleCommand } from '../src/session';

const IDENTITY = { seed: 4242, engine: ENGINE_VERSION, content: CONTENT_VERSION };
const market = buildMarket(IDENTITY);
const SEEDS = [4242, 77, 198765432123456];

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

  it('names the simple choices as 0.4, 1 and 1.6 expected moves from the opening price', () => {
    expect(SIMPLE_CHOICE_MOVES).toEqual([0.4, 1, 1.6]);
  });

  it('puts Far exactly one expected move away on both sides: $100 braced for 5% gives $105 and $95', () => {
    const board = buildCompanyBoard(100, 0.05, 21);
    expect(board.simpleUp.map((index) => board.targets[index])).toEqual([10_200, 10_500, 10_800]);
    expect(board.simpleDown.map((index) => board.targets[index])).toEqual([9800, 9500, 9200]);
  });

  it('puts Close, Far and Moonshot 2, 5 and 8 targets from the money for every company, seed and day', () => {
    for (const seed of SEEDS) {
      const each = buildMarket({ ...IDENTITY, seed });
      for (let day = 1; day <= 5; day += 1) {
        const board = boardFor(each, day);
        expect(board.companies).toHaveLength(COMPANY_COUNT);
        board.companies.forEach((company, companyId) => {
          expect(company.simpleUp).toEqual([12, 15, 18]);
          expect(company.simpleDown).toEqual([8, 5, 2]);
          for (const index of company.simpleUp) expect(isOffered(board, contractId(21, { companyId, targetIndex: index, side: 'up' }))).toBe(true);
          for (const index of company.simpleDown) expect(isOffered(board, contractId(21, { companyId, targetIndex: index, side: 'down' }))).toBe(true);
        });
      }
    }
  });

  it('works the same distances out on a finer board: 21, 52 and 83 targets from the money at 209', () => {
    for (const seed of SEEDS) {
      const each = buildMarket({ ...IDENTITY, seed });
      for (let day = 1; day <= 5; day += 1) {
        for (const company of boardFor(each, day, 209).companies) {
          expect(company.simpleUp).toEqual([125, 156, 187]);
          expect(company.simpleDown).toEqual([83, 52, 21]);
        }
      }
    }
  });

  it('keeps every simple choice on the board and on its own side of the money, whatever the board size', () => {
    for (let targets = 1; targets <= 40; targets += 1) {
      const board = buildCompanyBoard(84, 0.035, targets);
      const money = (targets - 1) / 2;
      let previousUp = money;
      let previousDown = money;
      board.simpleUp.forEach((up, choice) => {
        const down = board.simpleDown[choice] ?? NaN;
        for (const index of [up, down]) {
          expect(Number.isInteger(index)).toBe(true);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThanOrEqual(targets - 1);
        }
        expect(up).toBeGreaterThanOrEqual(previousUp);
        expect(down).toBeLessThanOrEqual(previousDown);
        // The same distance from the money on both sides.
        expect(up - money).toBe(money - down);
        previousUp = up;
        previousDown = down;
      });
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

/**
 * The stress board size at the two places it could quietly go wrong: the
 * share prices a player watches, and the grid of targets a finer board lays
 * over them.
 */
describe('the board size and the prices underneath it', () => {
  const STRESS_TARGETS = 209;
  const LARGEST_TARGETS = 2084;
  /** Steps spread across all five days, so nothing is proved on day 1 alone. */
  const STEPS = [0, 150, 400, 899, 950, 1250, 1800, 2400, 3150, 3700, 4200, 4499];
  const STEP_MS = 200;

  /** A session of the given size, started at pace 1, so a step is 200 ms from the start. */
  function started(seed: number, targetsPerCompany?: number): Session {
    const handled = handleCommand(
      createSession(`s-${String(targetsPerCompany ?? 0)}`, { ...IDENTITY, seed }, { targetsPerCompany }),
      FIRST_PLAYER_ID,
      { t: 'start', commandId: 'start-0001', pace: 1 },
      0,
    );
    expect(handled.receipt.outcome).toBe('accepted');
    return handled.session;
  }

  /** The six share prices this session shows at each step, taken through the projection a player sees. */
  function pricesOverTime(seed: number, targetsPerCompany?: number): number[][] {
    let session = started(seed, targetsPerCompany);
    return STEPS.map((step) => {
      const { session: next, frame } = frameFor(session, FIRST_PLAYER_ID, step * STEP_MS, { history: false, sections: 'live' });
      session = next;
      return [...frame.prices];
    });
  }

  it.each(SEEDS.slice(0, 2))('leaves every share price exactly where it was, seed %i', (seed) => {
    const ordinary = pricesOverTime(seed);
    const stressed = pricesOverTime(seed, STRESS_TARGETS);

    expect(stressed).toEqual(ordinary);
    // And the prices really do move, so equality above is not two flat lines.
    expect(new Set(ordinary.map((prices) => prices.join(','))).size).toBeGreaterThan(1);
    expect(ordinary.every((prices) => prices.length === COMPANY_COUNT)).toBe(true);
  });

  /** The first index whose target does not rise above the one before it, or -1 when they all do. */
  function firstFlatIndex(targets: readonly number[]): number {
    for (let index = 1; index < targets.length; index += 1) {
      if ((targets[index] ?? 0) <= (targets[index - 1] ?? 0)) return index;
    }
    return -1;
  }

  it.each([DEFAULT_TARGETS_PER_COMPANY, STRESS_TARGETS])('lists strictly ascending targets at %i a company, on the real cast, every day and seed', (targets) => {
    for (const seed of SEEDS.slice(0, 2)) {
      const each = buildMarket({ ...IDENTITY, seed });
      for (let day = 1; day <= 5; day += 1) {
        for (const company of boardFor(each, day, targets).companies) {
          expect(company.targets).toHaveLength(targets);
          expect(firstFlatIndex(company.targets)).toBe(-1);
        }
      }
    }
  });

  it('does not, at the largest listed size: neighbouring targets round to the same cent', () => {
    const flats: number[] = [];
    for (let day = 1; day <= 5; day += 1) {
      for (const company of boardFor(market, day, LARGEST_TARGETS).companies) {
        const flat = firstFlatIndex(company.targets);
        if (flat !== -1) {
          flats.push(flat);
          // Not a fall, a repeat: the grid is finer than a whole cent here.
          expect(company.targets[flat]).toBe(company.targets[flat - 1]);
        }
      }
    }
    // Recorded, not fixed: this is why a public instance grants only the
    // smaller size, and why any number quoted from a run at the largest one
    // has to say which size it was measured at.
    expect(flats.length).toBeGreaterThan(0);
  });

  it('counts 2508 contracts at 209 targets and 25008 at 2084', () => {
    expect(contractCount(boardFor(market, 1, STRESS_TARGETS))).toBe(2508);
    expect(contractCount(boardFor(market, 1, LARGEST_TARGETS))).toBe(25_008);
  });
});
