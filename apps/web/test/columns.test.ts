import { describe, expect, it } from 'vitest';
import type { CellClassParams, ColDef, ValueFormatterParams, ValueGetterParams } from 'ag-grid-community';
import { COLUMNS, DEFAULT_COL_DEF } from '../src/board/columns';
import type { ContractRow } from '../src/store/contractRows';

function column(headerName: string): ColDef<ContractRow> {
  const found = COLUMNS.find((one) => one.headerName === headerName);
  if (found === undefined) throw new Error(`no column ${headerName}`);
  return found;
}

/** What a column's formatter prints for a value; the grid passes more, the formatters read only this. */
function shown(headerName: string, value: unknown): string {
  const formatter = column(headerName).valueFormatter;
  if (typeof formatter !== 'function') throw new Error(`${headerName} has no formatter`);
  return formatter({ value } as ValueFormatterParams<ContractRow>);
}

const ROW: ContractRow = {
  id: '7',
  contractId: 7,
  companyId: 0,
  company: 'RoboPup',
  ticker: 'RPUP',
  side: 'up',
  targetCents: 8379,
  priceCents: 1200,
  dimmed: false,
  dir: 0,
};

/** The value the Price cell is given for a row: what it shows, and what the grid compares to decide on a flash. */
function priceValue(row: ContractRow): unknown {
  const getter = column('Price').valueGetter;
  if (typeof getter !== 'function') throw new Error('Price has no value getter');
  return getter({ data: row } as ValueGetterParams<ContractRow>);
}

/** The rule classes a column puts on a row's cell. */
function ruleClasses(headerName: string, row: ContractRow): string[] {
  const rules = column(headerName).cellClassRules ?? {};
  return Object.entries(rules)
    .filter(([, rule]) => typeof rule === 'function' && rule({ data: row } as CellClassParams<ContractRow>))
    .map(([name]) => name);
}

describe('the contract table columns', () => {
  it('come in the agreed order, under the glossary words', () => {
    expect(COLUMNS.map((one) => one.headerName)).toEqual(['Company', 'Ticket', 'Target', 'Price']);
  });

  it('cannot be sorted, filtered, moved or resized by the player', () => {
    expect(DEFAULT_COL_DEF).toMatchObject({ sortable: false, filter: false, suppressMovable: true, resizable: false });
    for (const one of COLUMNS) {
      expect(one.sortable).toBeUndefined();
      expect(one.filter).toBeUndefined();
    }
  });

  it('names the side with an arrow and the word, never colour alone', () => {
    expect(shown('Ticket', 'up')).toBe('↑ UP');
    expect(shown('Ticket', 'down')).toBe('↓ DOWN');
  });

  it('prints targets as money from whole cents', () => {
    expect(shown('Target', 8379)).toBe('$83.79');
    expect(shown('Target', 123456)).toBe('$1,234.56');
    expect(shown('Target', undefined)).toBe('');
  });

  it('shows a price, or nothing at all while the ticket is too cheap to trade', () => {
    expect(priceValue(ROW)).toBe(1200);
    expect(priceValue({ ...ROW, priceCents: 0 })).toBe(0);
    expect(priceValue({ ...ROW, priceCents: 300, dimmed: true })).toBeNull();
  });

  it('gives a row that stops being dimmed a new value, so its number comes back though the price stood still', () => {
    const dimmed = { ...ROW, priceCents: 300, dimmed: true };
    expect(priceValue(dimmed)).not.toBe(priceValue({ ...dimmed, dimmed: false }));
  });

  it('flashes the Price column and no other', () => {
    expect(COLUMNS.filter((one) => one.enableCellChangeFlash === true).map((one) => one.headerName)).toEqual(['Price']);
  });

  it('colours the flash by the direction of the move, and not at all without one', () => {
    expect(ruleClasses('Price', { ...ROW, dir: 1 })).toEqual(['sd-up']);
    expect(ruleClasses('Price', { ...ROW, dir: -1 })).toEqual(['sd-down']);
    expect(ruleClasses('Price', { ...ROW, dir: 0 })).toEqual([]);
  });

  it('colours the side by which side it is', () => {
    expect(ruleClasses('Ticket', ROW)).toEqual(['sd-side-up']);
    expect(ruleClasses('Ticket', { ...ROW, side: 'down' })).toEqual(['sd-side-down']);
  });

  it('keeps the Price cell right-aligned beside its own class', () => {
    expect(column('Price').cellClass).toEqual(['ag-right-aligned-cell', 'sd-price']);
  });

  it('right-aligns the two money columns and nothing else', () => {
    expect(COLUMNS.filter((one) => one.type === 'rightAligned').map((one) => one.headerName)).toEqual([
      'Target',
      'Price',
    ]);
  });
});
