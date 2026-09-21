import type { ColDef } from 'ag-grid-community';

/**
 * The live grid: a table whose values move several times a second and which
 * stays usable while they do. This file is its whole public face: what it is
 * fed from (a row source), what it is told (its props) and what it reports (a
 * readout). It is generic over the row type and knows nothing of tickets.
 *
 * What the grid promises, for whoever builds it to keep:
 * - Changed rows are gathered for a short fixed time and applied in one go,
 *   never one redraw per message.
 * - A changed value flashes, and not at all for a reader who asked their
 *   device for reduced motion.
 * - While the pointer is over the table or focus is inside it, a changed
 *   value never moves a row: a hint says sorting is paused, and the order
 *   catches up once both have left.
 * - The selection follows the id, not the row's place, so it survives
 *   updates, sorting and filtering.
 * - Everything is reachable by keyboard, with a visible focus ring.
 * - React does not render while values move.
 *
 * What is deliberately absent, and why:
 * - Pages of rows: the data is small and shown whole.
 * - Grouping, editing, moving or resizing columns: no screen of ours uses them.
 * - A column language of our own: the grid library's `ColDef` is the column
 *   language.
 * - A server-side row model: every row is in the browser.
 * - Selecting several rows: one ticket is chosen at a time.
 * - An option for the gathering time or the flash time: the grid owns both.
 */

/** The least a row must have. */
export interface GridRow {
  /** Unique in the set and stable for as long as the row exists; the grid tells rows apart by it. */
  readonly id: string;
}

/**
 * Where the grid's rows come from. It lives outside React. Its four members
 * are plain functions, not methods: each may be handed on by itself.
 *
 * `rows` is the one snapshot fit for `useSyncExternalStore`, paired with
 * `subscribe`: it is cached, and changes identity only when the set is
 * replaced. `latest` is not a snapshot, and the note on it says why.
 *
 * A table sets itself up in this order: register the sink with `onChanged`
 * first, read `latest()` second.
 */
export interface RowSource<Row extends GridRow> {
  /**
   * Which rows exist, in the default order. The same array until the set is
   * replaced (a new day, another game, another board size). A value in it may
   * be out of date: a changed row is handed to the sink as a new object and
   * is never written into this array.
   */
  readonly rows: () => readonly Row[];
  /** Told only when `rows()` would return another array. Returns the call that unsubscribes. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Registers the sink for changed rows. One sink at a time, the table's:
   * registering replaces the one before. The sink is called with only the
   * rows whose shown values changed, each a new object with the same id,
   * never with an empty list and never for a replacement of the set. A change
   * made while no sink is registered is not replayed later; `latest()` shows
   * it. The function returned stops the sink, may be called twice, and does
   * nothing once a newer sink has replaced this one.
   */
  readonly onChanged: (sink: (changed: readonly Row[]) => void) => () => void;
  /**
   * The newest object for every row of the current set, in `rows()` order. A
   * row that has not changed is the same object as before. The table calls it
   * once after mounting and once after each replacement, so that no row is
   * left showing a value that has passed.
   *
   * The table registers its sink with `onChanged` first and calls this
   * second: the other order drops any change that lands between the two,
   * while this order at worst hands the same batch over twice, which leaves
   * the same values in place.
   *
   * A fresh array on every call; only the row objects inside it are shared.
   * Read it once and hand the rows to the grid. Never pass it to
   * `useSyncExternalStore`: an uncached snapshot renders forever.
   */
  readonly latest: () => readonly Row[];
}

/**
 * What the grid measured over the last whole second. The page that shows the
 * readout adds what only a page can see: the time between animation frames,
 * long tasks, and the delay since a message was received.
 */
export interface GridReadout {
  /** Rows in the current set, whether or not the filter shows them. */
  readonly rowCount: number;
  /** Rows handed to the grid in the last whole second. */
  readonly rowsPerSecond: number;
  /** Calls of the sink in the last whole second. */
  readonly batchesPerSecond: number;
  /** From handing the last batch to the grid until the grid reported it applied, in milliseconds. */
  readonly lastApplyMs: number;
  /** The longest such time since the row set was last replaced, in milliseconds. */
  readonly worstApplyMs: number;
}

/**
 * The identity rule, for `filter`, `isDimmed` and `isHighlighted` alike: the
 * same function means the answer has not changed for any row that was not
 * handed over as changed; a new function means it may have changed for every
 * row. So a caller keeps the function while its answers stand and makes a new
 * one when they do not.
 */
export interface LiveGridProps<Row extends GridRow> {
  readonly source: RowSource<Row>;
  /** Made once by the caller: the grid compares columns by identity. */
  readonly columns: readonly ColDef<Row>[];
  /** Made once by the caller, like `columns`. */
  readonly defaultColDef?: ColDef<Row>;
  /** The table's accessible name. */
  readonly label: string;
  /** The caller owns the selection. It is an id, so it survives updates, sorting and filtering. */
  readonly selectedId: string | null;
  /** A click on a row, or Enter or Space on a focused row, reports its id. */
  readonly onSelect: (id: string) => void;
  /** Rows it answers false for are hidden; null shows all. A hidden row may still be the selected one. */
  readonly filter: ((row: Row) => boolean) | null;
  /** Independent of `isHighlighted`: a row may be both. */
  readonly isDimmed?: (row: Row) => boolean;
  readonly isHighlighted?: (row: Row) => boolean;
  /** The values are no longer live: the table looks stale and says so, and still scrolls and selects. */
  readonly stale: boolean;
  /** When given, called about once a second. */
  readonly onReadout?: (sample: GridReadout) => void;
}
