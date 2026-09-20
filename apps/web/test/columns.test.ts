import { describe, expect, it } from 'vitest';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
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

  it('right-aligns the two money columns and nothing else', () => {
    expect(COLUMNS.filter((one) => one.type === 'rightAligned').map((one) => one.headerName)).toEqual([
      'Target',
      'Price',
    ]);
  });
});
