import { describe, expect, it } from 'vitest';
import { contractId, decodeContractId } from '@strike-desk/shared/protocol';
import type { Frame } from '@strike-desk/shared/protocol';
import { choicesFor, contractFor, contractIdFor, NO_PICK, pickFromTable } from '../src/screens/desk/pick';
import { testFrame } from './fakeSocket';

/**
 * The simple way of picking a ticket is a lookup in the board the server
 * sent: Close, Far and Moonshot are the target indexes the board names for
 * each side, and a pick follows the player from company to company.
 */

const TARGETS_PER_COMPANY = 21;

function board(): NonNullable<Frame['board']> {
  return {
    targetsPerCompany: TARGETS_PER_COMPANY,
    companies: Array.from({ length: 6 }, (_unused, companyId) => ({
      targets: Array.from({ length: TARGETS_PER_COMPANY }, (_target, index) => 10_000 * (companyId + 1) + index * 100),
      simpleUp: [12, 15, 18] as [number, number, number],
      simpleDown: [8, 5, 2] as [number, number, number],
      lowestUpIndex: 3,
      highestDownIndex: 17,
    })),
  };
}

function frame(): Frame {
  return testFrame({
    board: board(),
    companies: [
      { ticker: 'RPUP', name: 'RoboPup', product: 'robot pets' },
      { ticker: 'FIZZ', name: 'Fizzly', product: 'fizzy drinks' },
      { ticker: 'JETK', name: 'JetKicks', product: 'jet sneakers' },
      { ticker: 'MUNC', name: 'MoonMunch', product: 'space snacks' },
      { ticker: 'PIXL', name: 'PixelPals', product: 'video games' },
      { ticker: 'ZAPP', name: 'ZapCharge', product: 'super batteries' },
    ],
  });
}

describe('the six simple choices of a company', () => {
  it('are the board\'s Close, Far and Moonshot targets, UP then DOWN', () => {
    const choices = choicesFor(board(), 1);
    expect(choices.map((choice) => [choice.side, choice.choice, choice.targetCents])).toEqual([
      ['up', 'close', 21_200],
      ['up', 'far', 21_500],
      ['up', 'moonshot', 21_800],
      ['down', 'close', 20_800],
      ['down', 'far', 20_500],
      ['down', 'moonshot', 20_200],
    ]);
    for (const choice of choices) {
      expect(decodeContractId(TARGETS_PER_COMPANY, choice.contractId)).toMatchObject({ companyId: 1, side: choice.side });
    }
  });

  it('are none without a board', () => {
    expect(choicesFor(null, 0)).toEqual([]);
  });
});

describe('what a pick means', () => {
  it('means nothing until a side and a choice are picked', () => {
    expect(contractIdFor(frame(), 0, NO_PICK)).toBeNull();
    expect(contractIdFor(frame(), 0, { side: 'up', choice: null, contractId: null })).toBeNull();
  });

  it('snaps a simple pick to the selected company\'s board, so the same pick follows the player across companies', () => {
    const pick = { side: 'down' as const, choice: 'far' as const, contractId: null };
    const onFizzly = contractIdFor(frame(), 1, pick);
    const onZapCharge = contractIdFor(frame(), 5, pick);
    expect(onFizzly).toBe(contractId(TARGETS_PER_COMPANY, { companyId: 1, targetIndex: 5, side: 'down' }));
    expect(onZapCharge).toBe(contractId(TARGETS_PER_COMPANY, { companyId: 5, targetIndex: 5, side: 'down' }));
  });

  it('keeps an exact table pick as it is, whatever company is selected', () => {
    const exact = contractId(TARGETS_PER_COMPANY, { companyId: 3, targetIndex: 7, side: 'up' });
    const pick = pickFromTable(frame(), exact);
    expect(pick).toEqual({ side: 'up', choice: null, contractId: exact });
    expect(contractIdFor(frame(), 0, pick)).toBe(exact);
  });

  it('names the simple choice a table pick happens to land on', () => {
    const close = contractId(TARGETS_PER_COMPANY, { companyId: 2, targetIndex: 12, side: 'up' });
    expect(pickFromTable(frame(), close)).toEqual({ side: 'up', choice: 'close', contractId: close });
  });
});

describe('the contract handed to the order ticket', () => {
  it('carries the company, the side, the target and whether the board offers it', () => {
    const offered = contractId(TARGETS_PER_COMPANY, { companyId: 4, targetIndex: 10, side: 'up' });
    expect(contractFor(frame(), offered)).toEqual({
      contractId: offered, companyName: 'PixelPals', ticker: 'PIXL', side: 'up', targetCents: 51_000, offered: true,
    });
    // UP below the lowest offered UP index, DOWN above the highest offered DOWN index: on the board, not on offer.
    const lowUp = contractId(TARGETS_PER_COMPANY, { companyId: 4, targetIndex: 2, side: 'up' });
    const highDown = contractId(TARGETS_PER_COMPANY, { companyId: 4, targetIndex: 18, side: 'down' });
    expect(contractFor(frame(), lowUp)?.offered).toBe(false);
    expect(contractFor(frame(), highDown)?.offered).toBe(false);
  });

  it('is null with nothing picked or no board', () => {
    expect(contractFor(frame(), null)).toBeNull();
    expect(contractFor(testFrame({ board: null }), 5)).toBeNull();
  });
});
