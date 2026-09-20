import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { GetRowIdParams, GridApi, GridReadyEvent } from 'ag-grid-community';
import type { ContractRow } from '../store/contractRows';
import { currentRows, registerRowSink, useBoardRows } from '../store/hooks';
import { COLUMNS, DEFAULT_COL_DEF } from './columns';
import { strikeTheme } from './gridSetup';

/**
 * The contract table: one row per ticket, repricing live.
 *
 * React hands the grid the day's row set, which changes once a day. The
 * moving prices never pass through React: the store works out which rows a
 * frame changed and hands only those to the sink registered below, and the
 * grid gathers them on its own short timer before it repaints. So a frame
 * costs the screen a handful of cells, never a table, and this component
 * does not render while prices move.
 *
 * Every object and function the grid is given is made once. A new identity
 * on any of them would make the grid set itself up again.
 */

/** Rows are told apart by contract id, which the store has already made a string. */
const getRowId = (params: GetRowIdParams<ContractRow>): string => params.data.id;

/**
 * The grid writes its styles into a named layer at the start of the body, so
 * they sit after the page's stylesheet and, being layered, always give way to
 * the page's own rules, in development and in the built page alike.
 */
const GRID_CSS_LAYER = 'ag-grid';
const gridStyleContainer = (): HTMLElement => document.body;

/** How long the grid gathers changed rows before it repaints them, in milliseconds. */
const BATCH_WAIT_MS = 50;

/**
 * A price can move between the store building the day's rows and the grid
 * receiving them. Sending the latest row for every ticket once means no row
 * is left showing a price that has passed. A row that has not moved is the
 * same object the grid already holds, which costs it nothing.
 */
function sendLatestRows(grid: GridApi<ContractRow>): void {
  const rows = currentRows();
  if (grid.isDestroyed() || rows.length === 0) return;
  grid.applyTransactionAsync({ update: [...rows] });
}

export const ContractBoard = memo(function ContractBoard() {
  const boardRows = useBoardRows();
  // The grid wants an array it may keep; the store's is read-only. One copy a day.
  const rowData = useMemo(() => [...boardRows], [boardRows]);

  const api = useRef<GridApi<ContractRow> | null>(null);
  const stopSink = useRef<(() => void) | null>(null);

  const onGridReady = useCallback((event: GridReadyEvent<ContractRow>) => {
    const grid = event.api;
    api.current = grid;
    stopSink.current?.();
    stopSink.current = registerRowSink((rows) => {
      if (grid.isDestroyed()) return;
      grid.applyTransactionAsync({ update: [...rows] });
    });
    sendLatestRows(grid);
  }, []);

  useEffect(
    () => () => {
      stopSink.current?.();
      stopSink.current = null;
      api.current = null;
    },
    [],
  );

  // Once after every new row set, which is once a day.
  useEffect(() => {
    if (api.current !== null) sendLatestRows(api.current);
  }, [rowData]);

  return (
    <AgGridReact<ContractRow>
      theme={strikeTheme}
      themeCssLayer={GRID_CSS_LAYER}
      themeStyleContainer={gridStyleContainer}
      rowData={rowData}
      columnDefs={COLUMNS}
      defaultColDef={DEFAULT_COL_DEF}
      getRowId={getRowId}
      onGridReady={onGridReady}
      asyncTransactionWaitMillis={BATCH_WAIT_MS}
      suppressModelUpdateAfterUpdateTransaction
      animateRows={false}
    />
  );
});
