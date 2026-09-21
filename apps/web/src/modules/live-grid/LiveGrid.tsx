import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FocusEvent, PointerEvent, ReactElement, TouchEvent } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  AsyncTransactionsFlushedEvent,
  CellKeyDownEvent,
  ColDef,
  FullWidthCellKeyDownEvent,
  GridApi,
  GridReadyEvent,
  IRowNode,
  OverlayType,
  RowClassParams,
  RowClickedEvent,
  RowSelectionOptions,
  SuppressKeyboardEventParams,
} from 'ag-grid-community';
import { strikeTheme } from './gridSetup';
import type { GridRow, LiveGridProps, RowSource } from './ports';
import { createSortPause } from './sortPause';
import type { SortPauseEvent } from './sortPause';

/**
 * The live grid: a table whose values move several times a second, and which
 * stays usable while they do.
 *
 * React hands the grid the row set, which changes rarely. The moving values
 * never pass through React: the row source hands only the rows that changed
 * to the sink registered below, and the grid gathers them on its own short
 * timer before it repaints. So a change costs the screen a handful of cells,
 * never a table, and this component does not render while values move.
 *
 * Every object and function the grid is given is made once, or made again
 * only when the caller hands over something new. A new identity on any of
 * them would make the grid do work; for the filter that is the point.
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
 * One row at a time, and the caller says which. The grid draws the selected
 * row and tells assistive technology about it; it never changes the selection
 * by itself, so a click or a key press is only ever a request to the caller.
 */
const ROW_SELECTION: RowSelectionOptions = { mode: 'singleRow', checkboxes: false, enableClickSelection: false };

/** A highlighted row: a gold left edge on a faint ground. Both are utilities on the page's colour names. */
const HIGHLIGHTED_ROW = 'bg-accent/40 shadow-[inset_3px_0_0_0_var(--gold)]';

/*
 * The two small notices share one look. They lie over the table's bottom left
 * corner rather than in a strip of their own: a strip that came and went would
 * move every row by its height, under the very pointer whose arrival brought
 * it. Down there they cover a row's name for a moment, never a header and
 * never a number.
 */
const NOTICE = 'rounded-sm border border-border bg-card px-2 py-0.5 text-[11px] leading-4';

const SELECT_KEYS = new Set(['Enter', ' ']);

function isSelectKey(event: Event | null | undefined): event is KeyboardEvent {
  return event instanceof KeyboardEvent && SELECT_KEYS.has(event.key);
}

/** True when focus moved between two places that are both inside the table. */
function stayedInside(event: FocusEvent): boolean {
  return event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);
}

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

/** Makes the grid's selection say what the caller says, and nothing when that row is not in the set. */
function showSelection<Row extends GridRow>(grid: GridApi<Row>, id: string | null): void {
  if (grid.isDestroyed()) return;
  const node = id === null ? undefined : grid.getRowNode(id);
  if (node === undefined) {
    if (grid.getSelectedNodes().length > 0) grid.deselectAll();
    return;
  }
  if (node.isSelected() !== true) node.setSelected(true, true);
}

function isAnyColumnSorted<Row extends GridRow>(grid: GridApi<Row>): boolean {
  return grid.getColumnState().some((column) => column.sort != null);
}

function LiveGridInner<Row extends GridRow>(props: LiveGridProps<Row>): ReactElement {
  const { source, columns, defaultColDef, label, selectedId, onSelect, filter, isDimmed, isHighlighted, stale } = props;

  const rows = useSyncExternalStore(source.subscribe, source.rows, source.rows);
  // The grid wants an array it may keep; the source's is read-only. One copy per row set.
  const rowData = useMemo(() => [...rows], [rows]);
  // Likewise the columns: the caller's array is made once, so this copy is too.
  const columnDefs = useMemo(() => [...columns], [columns]);

  const api = useRef<GridApi<Row> | null>(null);
  const stopSink = useRef<(() => void) | null>(null);

  /*
   * What the grid's long-lived callbacks read. They are made once, so they
   * reach the caller's latest props through this ref rather than through a
   * closure that would go out of date.
   */
  const latest = useRef({ selectedId, onSelect, filter, isDimmed, isHighlighted });
  useEffect(() => {
    latest.current = { selectedId, onSelect, filter, isDimmed, isHighlighted };
  });

  // ------------------------------------------------------------------ the order holds still

  /*
   * How the order is held: the grid is told, once and for good, never to sort
   * or filter again because a value changed (`suppressModelUpdateAfterUpdateTransaction`),
   * and this component asks for that work itself after each applied batch
   * (`refreshClientSideRowModel`), unless the pause rule says to hold. Values
   * keep arriving and flashing either way. The other way, switching the
   * option on and off, would hand the grid a new option at every pointer move
   * across the table's edge; this way the grid's options never change and the
   * only thing that varies is whether one call is made.
   *
   * A sort the player asks for by pressing a header, and a new filter from
   * the caller, are not changed values: the grid acts on those at once.
   */
  const [pause] = useState(createSortPause);
  const sorted = useRef(false);
  const behind = useRef(false);
  const [holding, setHolding] = useState(false);

  const bringUpToDate = useCallback((grid: GridApi<Row>) => {
    behind.current = false;
    if (grid.isDestroyed()) return;
    // The steps run in order, so starting at the filter also sorts.
    grid.refreshClientSideRowModel(latest.current.filter === null ? 'sort' : 'filter');
  }, []);

  const onAsyncTransactionsFlushed = useCallback(
    (event: AsyncTransactionsFlushedEvent<Row>) => {
      // No sort and no filter: no value can move or hide a row, and there is nothing to redo.
      if (!sorted.current && latest.current.filter === null) return;
      if (pause.state().paused) behind.current = true;
      else bringUpToDate(event.api);
    },
    [pause, bringUpToDate],
  );

  const tell = useCallback(
    (event: SortPauseEvent) => {
      const { paused, catchUp } = pause.on(event);
      setHolding(paused && sorted.current);
      if (catchUp && behind.current && api.current !== null) bringUpToDate(api.current);
    },
    [pause, bringUpToDate],
  );

  const onSortChanged = useCallback(
    (event: { api: GridApi<Row> }) => {
      sorted.current = isAnyColumnSorted(event.api);
      setHolding(pause.state().paused && sorted.current);
    },
    [pause],
  );

  // A mouse or a pen. A finger is followed by its touch instead: a browser
  // that takes a touch for scrolling cancels its pointer, which then "leaves"
  // while the finger is still moving the rows.
  const onPointerEnter = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== 'touch') tell('pointerIn');
    },
    [tell],
  );
  const onPointerLeave = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== 'touch') tell('pointerOut');
    },
    [tell],
  );
  const onTouchStart = useCallback(() => {
    tell('touchStart');
  }, [tell]);
  const onTouchEnd = useCallback(
    (event: TouchEvent) => {
      if (event.touches.length === 0) tell('touchEnd');
    },
    [tell],
  );
  // Focus moving from one cell to the next never leaves the table.
  const onFocus = useCallback(
    (event: FocusEvent) => {
      if (!stayedInside(event)) tell('focusIn');
    },
    [tell],
  );
  const onBlur = useCallback(
    (event: FocusEvent) => {
      if (!stayedInside(event)) tell('focusOut');
    },
    [tell],
  );

  // ------------------------------------------------------------------ selection, by id

  const onRowClicked = useCallback((event: RowClickedEvent<Row>) => {
    if (event.data !== undefined) latest.current.onSelect(event.data.id);
  }, []);

  const onCellKeyDown = useCallback((event: CellKeyDownEvent<Row> | FullWidthCellKeyDownEvent<Row>) => {
    if (event.data === undefined || !isSelectKey(event.event)) return;
    // Space would otherwise scroll the page.
    event.event.preventDefault();
    latest.current.onSelect(event.data.id);
  }, []);

  // If anything but the caller changes the grid's selection, the caller's word is put back.
  const onSelectionChanged = useCallback((event: { api: GridApi<Row> }) => {
    showSelection(event.api, latest.current.selectedId);
  }, []);

  // A new row set, or a row that was not there before: the selection is looked up again by id.
  const onRowDataUpdated = useCallback((event: { api: GridApi<Row> }) => {
    showSelection(event.api, latest.current.selectedId);
  }, []);

  useEffect(() => {
    if (api.current !== null) showSelection(api.current, selectedId);
  }, [selectedId]);

  /*
   * The grid's own use of Space is to select and deselect the focused row.
   * Here the caller owns the selection, so the grid is told to leave Space
   * and Enter alone; `onCellKeyDown` above still hears them.
   */
  const colDefaults = useMemo((): ColDef<Row> => {
    const callers = defaultColDef?.suppressKeyboardEvent;
    return {
      ...defaultColDef,
      suppressKeyboardEvent: (params: SuppressKeyboardEventParams<Row>): boolean =>
        (!params.editing && SELECT_KEYS.has(params.event.key)) || callers?.(params) === true,
    };
  }, [defaultColDef]);

  // ------------------------------------------------------------------ filter, dimmed, highlighted

  // A new filter from the caller is a new pair of functions for the grid,
  // and the grid filters again when it is handed one; the same filter, the
  // same pair, no work.
  const isExternalFilterPresent = useCallback((): boolean => filter !== null, [filter]);
  const doesExternalFilterPass = useCallback(
    (node: IRowNode<Row>): boolean => filter === null || node.data === undefined || filter(node.data),
    [filter],
  );

  // One rule object for the grid's whole life; the rules read the caller's latest answer.
  const rowClassRules = useMemo(
    () => ({
      'sd-row-dimmed': (row: RowClassParams<Row>): boolean =>
        row.data !== undefined && latest.current.isDimmed?.(row.data) === true,
      [HIGHLIGHTED_ROW]: (row: RowClassParams<Row>): boolean =>
        row.data !== undefined && latest.current.isHighlighted?.(row.data) === true,
    }),
    [],
  );

  // A new function may answer differently for every row, so the rows on screen are drawn again.
  const drawnWith = useRef({ isDimmed, isHighlighted });
  useEffect(() => {
    const before = drawnWith.current;
    if (before.isDimmed === isDimmed && before.isHighlighted === isHighlighted) return;
    drawnWith.current = { isDimmed, isHighlighted };
    if (api.current !== null && !api.current.isDestroyed()) api.current.redrawRows();
  }, [isDimmed, isHighlighted]);

  // ------------------------------------------------------------------ the source

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

  const onGridReady = useCallback(
    (event: GridReadyEvent<Row>) => {
      api.current = event.api;
      event.api.setGridAriaProperty('label', label);
      sorted.current = isAnyColumnSorted(event.api);
      connect(event.api);
      showSelection(event.api, latest.current.selectedId);
    },
    [connect, label],
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

  useEffect(() => {
    if (api.current !== null && !api.current.isDestroyed()) api.current.setGridAriaProperty('label', label);
  }, [label]);

  // Once after every new row set, which is rare.
  useEffect(() => {
    if (api.current !== null) sendLatestRows(api.current, source);
  }, [rowData, source]);

  return (
    <div
      className="relative h-full w-full"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div
        className={`h-full w-full motion-safe:transition-opacity motion-safe:duration-200 ${stale ? 'opacity-60' : 'opacity-100'}`}
      >
        <AgGridReact<Row>
          theme={strikeTheme}
          themeCssLayer={GRID_CSS_LAYER}
          themeStyleContainer={gridStyleContainer}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={colDefaults}
          getRowId={getRowId}
          onGridReady={onGridReady}
          asyncTransactionWaitMillis={BATCH_WAIT_MS}
          suppressModelUpdateAfterUpdateTransaction
          onAsyncTransactionsFlushed={onAsyncTransactionsFlushed}
          onSortChanged={onSortChanged}
          animateRows={false}
          rowSelection={ROW_SELECTION}
          onRowClicked={onRowClicked}
          onCellKeyDown={onCellKeyDown}
          onSelectionChanged={onSelectionChanged}
          onRowDataUpdated={onRowDataUpdated}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          rowClassRules={rowClassRules}
          suppressOverlays={NO_GRID_MESSAGES}
          cellFlashDuration={FLASH_MS}
          cellFadeDuration={FADE_MS}
        />
      </div>
      {/* Always here, so that a screen reader hears a notice arrive; empty, it takes no room and catches no pointer. */}
      <div role="status" className="pointer-events-none absolute bottom-2 left-2 z-10 flex gap-1.5">
        {stale ? <span className={`${NOTICE} text-foreground`}>These prices are old</span> : null}
        {holding ? <span className={`${NOTICE} text-muted-foreground`}>Sorting paused</span> : null}
      </div>
    </div>
  );
}

/**
 * Memoised, so a parent that renders for its own reasons does not render the
 * table. `memo` forgets the row type, and the cast gives it back.
 */
export const LiveGrid = memo(LiveGridInner) as typeof LiveGridInner;
