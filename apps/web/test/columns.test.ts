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
  realCents: 500,
  hopeCents: 700,
  dimmed: false,
  dir: 0,
};

/** The value a cell is given for a row: what it shows, and what the grid compares to decide on a redraw. */
function cellValue(headerName: string, row: ContractRow): unknown {
  const getter = column(headerName).valueGetter;
  if (typeof getter !== 'function') throw new Error(`${headerName} has no value getter`);
  return getter({ data: row } as ValueGetterParams<ContractRow>);
}

function priceValue(row: ContractRow): unknown {
  return cellValue('Price', row);
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
    expect(COLUMNS.map((one) => one.headerName)).toEqual([
      'Company',
      'Ticket',
      'Target',
      'Price',
      'Real value',
      'Hope value',
    ]);
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

  it('shows the two parts of the price, and nothing at all while the ticket is too cheap to trade', () => {
    expect(cellValue('Real value', ROW)).toBe(500);
    expect(cellValue('Hope value', ROW)).toBe(700);
    expect(cellValue('Real value', { ...ROW, realCents: 0 })).toBe(0);
    expect(cellValue('Hope value', { ...ROW, hopeCents: 0 })).toBe(0);

    const dimmed = { ...ROW, priceCents: 300, realCents: 0, hopeCents: 300, dimmed: true };
    expect(cellValue('Real value', dimmed)).toBeNull();
    expect(cellValue('Hope value', dimmed)).toBeNull();
  });

  it('brings all three money cells back at the closing bell, even the part that did not move', () => {
    // A ticket that ends out of the money settles at $0 with $0 of real
    // value: its real value never moved. Were the cell's value the field
    // itself, that cell would still be showing a dash after the bell.
    const dimmed = { ...ROW, priceCents: 300, realCents: 0, hopeCents: 300, dimmed: true };
    const settled = { ...dimmed, priceCents: 0, hopeCents: 0, dimmed: false };

    expect(cellValue('Real value', dimmed)).not.toBe(cellValue('Real value', settled));
    expect(cellValue('Hope value', dimmed)).not.toBe(cellValue('Hope value', settled));
    expect(priceValue(dimmed)).not.toBe(priceValue(settled));
    expect(cellValue('Real value', settled)).toBe(0);
  });

  it('prints both parts as money from whole cents', () => {
    expect(shown('Real value', 0)).toBe('$0');
    expect(shown('Hope value', 8379)).toBe('$83.79');
    expect(shown('Real value', null)).toBe('');
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

  it('right-aligns every money column and nothing else', () => {
    expect(COLUMNS.filter((one) => one.type === 'rightAligned').map((one) => one.headerName)).toEqual([
      'Target',
      'Price',
      'Real value',
      'Hope value',
    ]);
  });

  it('leaves the two parts out of the flash, so only the price moves the eye', () => {
    for (const headerName of ['Real value', 'Hope value']) {
      expect(column(headerName).enableCellChangeFlash).toBeUndefined();
      expect(column(headerName).cellClassRules).toBeUndefined();
    }
  });
});
