import type { CellClassParams, ColDef, ValueFormatterParams, ValueGetterParams } from 'ag-grid-community';
import { formatCents } from '@strike-desk/shared/money';
import type { Side } from '@strike-desk/shared/protocol';
import type { ContractRow } from '../store/contractRows';
import { CompanyCell } from './CompanyCell';
import { PriceCell } from './PriceCell';

/**
 * The table's columns, made once per page load. The grid compares these by
 * identity, so an object built during a render would make it start again.
 */

/** An arrow and the word, so the side never rests on colour alone. */
const SIDE_TEXT: Record<Side, string> = { up: '↑ UP', down: '↓ DOWN' };

function sideText(params: ValueFormatterParams<ContractRow, Side>): string {
  return params.value == null ? '' : SIDE_TEXT[params.value];
}

function money(params: ValueFormatterParams<ContractRow, number>): string {
  return params.value == null ? '' : formatCents(params.value);
}

/**
 * What the Price cell shows: the price, or nothing while the ticket is too
 * cheap to trade. The grid redraws a cell, and flashes it, only when this
 * value changes. So a price that rounds to the same cents never flashes, and
 * a row that stops being dimmed at the closing bell gets its number back
 * even though its price did not move.
 */
function shownPrice(params: ValueGetterParams<ContractRow, number | null>): number | null {
  const row = params.data;
  return row === undefined || row.dimmed ? null : row.priceCents;
}

type Cell = CellClassParams<ContractRow>;

/**
 * The grid owns the flash and its timing; these two classes only say which
 * colour it is, by way of one variable the stylesheet sets on the cell. A
 * change with no direction, such as a new day's rows, shows no colour.
 */
const PRICE_CLASS_RULES = {
  'sd-up': (cell: Cell): boolean => cell.data?.dir === 1,
  'sd-down': (cell: Cell): boolean => cell.data?.dir === -1,
};

const SIDE_CLASS_RULES = {
  'sd-side-up': (cell: Cell): boolean => cell.data?.side === 'up',
  'sd-side-down': (cell: Cell): boolean => cell.data?.side === 'down',
};

/**
 * A column's own `cellClass` replaces the one its `rightAligned` type brings,
 * so the Price column names the grid's alignment class again beside its own.
 */
const PRICE_CELL_CLASS = ['ag-right-aligned-cell', 'sd-price'];

/*
 * Widths share out whatever the panel offers. The minimums are what each
 * column needs at phone width, so all four still fit there side by side.
 */
export const COLUMNS: ColDef<ContractRow>[] = [
  { headerName: 'Company', field: 'company', cellRenderer: CompanyCell, flex: 2, minWidth: 104 },
  {
    headerName: 'Ticket',
    field: 'side',
    valueFormatter: sideText,
    cellClassRules: SIDE_CLASS_RULES,
    flex: 1,
    minWidth: 80,
  },
  { headerName: 'Target', field: 'targetCents', valueFormatter: money, type: 'rightAligned', flex: 1, minWidth: 84 },
  {
    headerName: 'Price',
    colId: 'price',
    valueGetter: shownPrice,
    cellRenderer: PriceCell,
    type: 'rightAligned',
    cellClass: PRICE_CELL_CLASS,
    cellClassRules: PRICE_CLASS_RULES,
    // The only column that flashes: every other value on a row is either
    // fixed for the day or moves on the same tick as the price.
    enableCellChangeFlash: true,
    flex: 1,
    minWidth: 80,
  },
];

/**
 * The rows stay in the order they arrive in: company, then the UP tickets,
 * then the DOWN tickets, targets rising. Nothing here lets the player
 * reorder, filter or reshape the table.
 */
export const DEFAULT_COL_DEF: ColDef<ContractRow> = {
  sortable: false,
  filter: false,
  suppressMovable: true,
  resizable: false,
};
