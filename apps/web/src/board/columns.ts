import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { formatCents } from '@strike-desk/shared/money';
import type { Side } from '@strike-desk/shared/protocol';
import type { ContractRow } from '../store/contractRows';
import { CompanyCell } from './CompanyCell';

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

export const COLUMNS: ColDef<ContractRow>[] = [
  { headerName: 'Company', field: 'company', cellRenderer: CompanyCell, flex: 2, minWidth: 150 },
  { headerName: 'Ticket', field: 'side', valueFormatter: sideText, flex: 1, minWidth: 92 },
  { headerName: 'Target', field: 'targetCents', valueFormatter: money, type: 'rightAligned', flex: 1, minWidth: 96 },
  { headerName: 'Price', field: 'priceCents', valueFormatter: money, type: 'rightAligned', flex: 1, minWidth: 96 },
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
