import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { GridApi, GridReadyEvent, OverlayType, RowClassParams } from 'ag-grid-community';
import { strikeTheme } from './gridSetup';
import type { GridRow, LiveGridProps, RowSource } from './ports';

/**
 * The live grid: a table whose values move several times a second.
 *
 * React hands the grid the row set, which changes rarely. The moving values
 * never pass through React: the row source hands only the rows that changed
 * to the sink registered below, and the grid gathers them on its own short
 * timer before it repaints. So a change costs the screen a handful of cells,
 * never a table, and this component does not render while values move.
 *
 * Every object and function the grid is given is made once. A new identity
 * on any of them would make the grid set itself up again.
 */

/**
 * Rows are told apart by their id, which the source keeps stable. It asks of
 * its argument only what it reads, so the one function serves every row type.
 */
const getRowId = (params: { readonly data: GridRow }): string => params.data.id;

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
 * A changed value holds its colour for 240 ms and fades over 360 ms, so it
 * has finished before the next change can flash it again. Someone who has
 * asked their device for less motion gets no flash at all: a duration of
 * zero is the grid's own way of saying "do not flash". Read once, here,
 * because the grid must not be handed a new value while it runs.
 */
const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLASH_MS = REDUCED_MOTION ? 0 : 240;
const FADE_MS = REDUCED_MOTION ? 0 : 360;

/**
 * Before the first rows arrive the table is simply empty: the grid's own
 * "loading" and "no rows" messages are words nobody chose for this game.
 */
const NO_GRID_MESSAGES: OverlayType[] = ['loading', 'noRows'];

/**
 * A value can move between the source building its row set and the grid
 * receiving it. Sending the latest row for every id once means no row is left
 * showing a value that has passed. A row that has not moved is the same
 * object the grid already holds, which costs it nothing.
 */
function sendLatestRows<Row extends GridRow>(grid: GridApi<Row>, source: RowSource<Row>): void {
  if (grid.isDestroyed()) return;
  const rows = source.latest();
  if (rows.length === 0) return;
  grid.applyTransactionAsync({ update: [...rows] });
}

function LiveGridInner<Row extends GridRow>(props: LiveGridProps<Row>): ReactElement {
  const { source, columns, defaultColDef, label, isDimmed } = props;

  const rows = useSyncExternalStore(source.subscribe, source.rows, source.rows);
  // The grid wants an array it may keep; the source's is read-only. One copy per row set.
  const rowData = useMemo(() => [...rows], [rows]);
  // Likewise the columns: the caller's array is made once, so this copy is too.
  const columnDefs = useMemo(() => [...columns], [columns]);

  const wrapper = useRef<HTMLDivElement | null>(null);
  const api = useRef<GridApi<Row> | null>(null);
  const stopSink = useRef<(() => void) | null>(null);

  // The grid is handed one rule object for its whole life; which rows are
  // dimmed is read through this ref, so the caller may change its mind.
  const dimmed = useRef(isDimmed);
  const rowClassRules = useMemo(
    () => ({
      'sd-row-dimmed': (row: RowClassParams<Row>): boolean =>
        row.data !== undefined && dimmed.current?.(row.data) === true,
    }),
    [],
  );
  useEffect(() => {
    dimmed.current = isDimmed;
  }, [isDimmed]);

  /** The sink first, the latest rows second: the other order could drop a change that lands between the two. */
  const connect = useCallback(
    (grid: GridApi<Row>) => {
      stopSink.current?.();
      stopSink.current = source.onChanged((changed) => {
        if (grid.isDestroyed()) return;
        grid.applyTransactionAsync({ update: [...changed] });
      });
      sendLatestRows(grid, source);
    },
    [source],
  );

  const nameTheGrid = useCallback(() => {
    wrapper.current?.querySelector('[role="grid"]')?.setAttribute('aria-label', label);
  }, [label]);

  const onGridReady = useCallback(
    (event: GridReadyEvent<Row>) => {
      api.current = event.api;
      connect(event.api);
      nameTheGrid();
    },
    [connect, nameTheGrid],
  );

  // The sink is stopped whenever this component lets go of the source, and
  // picked up again if the grid is already there when it comes back.
  useEffect(() => {
    const grid = api.current;
    if (grid !== null && !grid.isDestroyed()) connect(grid);
    return () => {
      stopSink.current?.();
      stopSink.current = null;
    };
  }, [connect]);

  useEffect(nameTheGrid, [nameTheGrid]);

  // Once after every new row set, which is rare.
  useEffect(() => {
    if (api.current !== null) sendLatestRows(api.current, source);
  }, [rowData, source]);

  return (
    <div ref={wrapper} className="h-full w-full">
      <AgGridReact<Row>
        theme={strikeTheme}
        themeCssLayer={GRID_CSS_LAYER}
        themeStyleContainer={gridStyleContainer}
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={getRowId}
        onGridReady={onGridReady}
        asyncTransactionWaitMillis={BATCH_WAIT_MS}
        suppressModelUpdateAfterUpdateTransaction
        animateRows={false}
        rowClassRules={rowClassRules}
        suppressOverlays={NO_GRID_MESSAGES}
        cellFlashDuration={FLASH_MS}
        cellFadeDuration={FADE_MS}
      />
    </div>
  );
}

/**
 * Memoised, so a parent that renders for its own reasons does not render the
 * table. `memo` forgets the row type, and the cast gives it back.
 */
export const LiveGrid = memo(LiveGridInner) as typeof LiveGridInner;
