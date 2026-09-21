import { useState } from 'react';
import type { ReactElement } from 'react';
import type { CellClassParams, ColDef, ValueFormatterParams } from 'ag-grid-community';
import { createFakeRowSource } from '../../modules/live-grid/fake';
import type { FakeRow } from '../../modules/live-grid/fake';
import { LiveGrid } from '../../modules/live-grid/index';

/**
 * The live grid, shown by itself against made-up rows. Nothing here knows of
 * tickets or money: a row is a number, a group and a value that moves.
 */

const WHOLE_NUMBER = new Intl.NumberFormat('en-US');

function wholeNumber(params: ValueFormatterParams<FakeRow, number>): string {
  return params.value == null ? '' : WHOLE_NUMBER.format(params.value);
}

type Cell = CellClassParams<FakeRow>;

/** The grid owns the flash and its timing; these two classes only say which colour it is. */
const VALUE_CLASS_RULES = {
  'sd-up': (cell: Cell): boolean => cell.data?.dir === 1,
  'sd-down': (cell: Cell): boolean => cell.data?.dir === -1,
};

const VALUE_CELL_CLASS = ['ag-right-aligned-cell', 'sd-price'];

/** Made once: the grid compares columns by identity. */
const COLUMNS: ColDef<FakeRow>[] = [
  { headerName: 'Row', field: 'label', flex: 2, minWidth: 96 },
  { headerName: 'Group', field: 'group', flex: 1, minWidth: 80 },
  {
    headerName: 'Value',
    field: 'value',
    valueFormatter: wholeNumber,
    type: 'rightAligned',
    cellClass: VALUE_CELL_CLASS,
    cellClassRules: VALUE_CLASS_RULES,
    enableCellChangeFlash: true,
    flex: 1,
    minWidth: 96,
  },
];

const DEFAULT_COL_DEF: ColDef<FakeRow> = {
  sortable: false,
  filter: false,
  suppressMovable: true,
  resizable: false,
};

const LABEL = 'Made-up rows';
const isDimmed = (row: FakeRow): boolean => row.dimmed;
const onSelect = (): void => {};

export default function LiveGridDemo(): ReactElement {
  // One source for the life of the page, made on the first render only.
  const [source] = useState(() => createFakeRowSource({ rowCount: 252, seed: 7 }));

  return (
    <div id="lab-demo-live-grid" className="flex flex-col gap-3">
      <p className="m-0 max-w-[68ch] text-sm text-muted-foreground">
        252 made-up rows, drawn by the same table the game uses for its contracts.
      </p>
      <div className="h-[28rem] overflow-hidden rounded-md border border-border bg-card">
        <LiveGrid<FakeRow>
          source={source}
          columns={COLUMNS}
          defaultColDef={DEFAULT_COL_DEF}
          label={LABEL}
          selectedId={null}
          onSelect={onSelect}
          filter={null}
          isDimmed={isDimmed}
          stale={false}
        />
      </div>
    </div>
  );
}
