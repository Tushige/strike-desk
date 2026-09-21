import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import type { CellClassParams, ColDef, ValueFormatterParams } from 'ag-grid-community';
import { createFakeRowSource } from '../../modules/live-grid/fake';
import type { FakeRow } from '../../modules/live-grid/fake';
import { LiveGrid } from '../../modules/live-grid/index';
import type { GridReadout } from '../../modules/live-grid/index';
import { LONG_TASK_MS, watchPage } from './live-grid.probes';
import type { PageSample, PageWatch, Spread } from './live-grid.probes';

/**
 * The live grid, shown by itself against made-up rows. Nothing here knows of
 * tickets or money: a row is a number, a group and a value that moves.
 *
 * The rows move only while Start is pressed, five rounds a second, the pace
 * the game's prices arrive at. Every control above the table changes what the
 * table is told, never the table: they are the props a screen of the game
 * will hand it.
 *
 * The readout is the stress setting's: a few thousand made-up rows, and the
 * three measurements that say whether the table keeps up. Each figure says
 * what it includes. None of it reads the game, the engine or a recording.
 */

const WHOLE_NUMBER = new Intl.NumberFormat('en-US');
const MILLISECONDS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat('en-US', { style: 'percent' });

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
    // The one column that can be sorted, and the one whose values move.
    sortable: true,
    flex: 1,
    minWidth: 112,
  },
];

const DEFAULT_COL_DEF: ColDef<FakeRow> = {
  sortable: false,
  filter: false,
  suppressMovable: true,
  resizable: false,
};

const LABEL = 'Made-up rows';
const ROUNDS_PER_SECOND = 5;
const READOUT_EVERY_MS = 1000;
const ROW_COUNTS = [252, 2_500, 5_000];
/** How much of the set changes in one round: a hundredth, a tenth, three tenths, all of it. */
const CHANGE_SHARES = [0.01, 0.1, 0.3, 1];
const DEFAULT_SHARE = 0.3;
const GROUPS = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'];
const LOW_VALUE = 10_000;

const isDimmed = (row: FakeRow): boolean => row.dimmed;
const isEveryTenth = (row: FakeRow): boolean => row.n % 10 === 0;

/** One function per choice of filters, and none at all when every row is wanted. */
function filterFor(group: string, lowOnly: boolean): ((row: FakeRow) => boolean) | null {
  if (group === '' && !lowOnly) return null;
  return (row) => (group === '' || row.group === group) && (!lowOnly || row.value < LOW_VALUE);
}

const BUTTON =
  'rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const SELECT =
  'rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const FIELD_LABEL = 'flex items-center gap-2 text-sm text-foreground';
const CAPTION = 'text-[11px] uppercase tracking-[0.12em] text-muted-foreground';

const NO_SAMPLE = 'no sample yet';

function ms(value: number | null): string {
  return value === null ? NO_SAMPLE : `${MILLISECONDS.format(value)} ms`;
}

function spread(of: Spread | undefined): string {
  if (of === undefined || of.count === 0) return NO_SAMPLE;
  return `typical ${ms(of.typicalMs)} · worst 5% ${ms(of.worstMs)}`;
}

function longTasks(page: PageSample | null): string {
  if (page === null) return NO_SAMPLE;
  const tasks = page.longTasks;
  // A browser that cannot report long tasks has not had zero of them.
  if (!tasks.supported) return 'long tasks: not supported by this browser';
  return `${WHOLE_NUMBER.format(tasks.count)} long tasks, longest ${ms(tasks.longestMs)}`;
}

function Figure(props: { caption: string; value: string; includes: string }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-muted/40 p-3">
      <span className={CAPTION}>{props.caption}</span>
      <span className="text-sm tabular-nums text-foreground">{props.value}</span>
      <span className="text-xs text-muted-foreground">{props.includes}</span>
    </div>
  );
}

function Readout(props: { grid: GridReadout | null; page: PageSample | null }): ReactElement {
  const { grid, page } = props;
  return (
    <section aria-label="Stress readout" className="flex flex-col gap-2">
      <p className="m-0 text-xs text-muted-foreground">
        <span className={CAPTION}>Stress readout</span> · a stress setting on made-up rows, not a feature of the game ·
        the last ten seconds, refreshed once a second
        {grid === null ? '' : ` · ${WHOLE_NUMBER.format(grid.rowCount)} rows in the set`}
      </p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Figure
          caption="Records handed to the table"
          value={
            grid === null
              ? NO_SAMPLE
              : `${WHOLE_NUMBER.format(grid.rowsPerSecond)} rows a second in ${WHOLE_NUMBER.format(grid.batchesPerSecond)} batches · all of them real changes`
          }
          includes="The last whole second. The made-up source hands over only rows whose value changed, so none is a repeat."
        />
        <Figure
          caption="Client processing delay · not network latency"
          value={spread(page?.delay)}
          includes="From this page changing the rows to the first animation frame after the new values were written into the table. Only rounds that touched a row on screen count. Nothing on this page crosses a network."
        />
        <Figure
          caption={`Frame intervals · long tasks over ${String(LONG_TASK_MS)} ms`}
          value={`${spread(page?.frames)} · ${longTasks(page)}`}
          includes="The time between one animation frame and the next; 16.7 ms is a steady 60 a second. A hidden tab is not measured."
        />
        <Figure
          caption="The table's own apply time"
          value={
            grid === null ? NO_SAMPLE : `last ${ms(grid.lastApplyMs)} · worst ${ms(grid.worstApplyMs)} since this row set`
          }
          includes="From handing a batch to the table until it reports the batch applied. Includes up to 50 ms the table spends gathering batches before it repaints."
        />
      </div>
    </section>
  );
}

export default function LiveGridDemo(): ReactElement {
  // One source for the life of the page, made on the first render only.
  const [source] = useState(() => createFakeRowSource({ rowCount: 252, seed: 7 }));
  const [running, setRunning] = useState(false);
  const [rowCount, setRowCount] = useState(252);
  const [share, setShare] = useState(DEFAULT_SHARE);
  const [group, setGroup] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [highlightTenth, setHighlightTenth] = useState(false);
  const [stale, setStale] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gridReadout, setGridReadout] = useState<GridReadout | null>(null);
  const [pageSample, setPageSample] = useState<PageSample | null>(null);

  const table = useRef<HTMLDivElement | null>(null);
  const watch = useRef<PageWatch | null>(null);

  // The page's probes run for as long as the table is on the page.
  useEffect(() => {
    if (table.current === null) return undefined;
    const watching = watchPage(table.current);
    watch.current = watching;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') setPageSample(watching.sample());
    }, READOUT_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      watching.stop();
      watch.current = null;
    };
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      watch.current?.changed();
      source.tick(share);
    }, 1000 / ROUNDS_PER_SECOND);
    return () => {
      window.clearInterval(timer);
    };
  }, [running, source, share]);

  // A new function only when a filter control changes: that is what tells the table to filter again.
  const filter = useMemo(() => filterFor(group, lowOnly), [group, lowOnly]);

  return (
    <div id="lab-demo-live-grid" className="flex flex-col gap-3">
      <p className="m-0 max-w-[68ch] text-sm text-muted-foreground">
        {WHOLE_NUMBER.format(rowCount)} made-up rows in the table the game uses for its contracts. Press Start, sort by
        Value, then move the pointer over the table: the rows hold still until you leave.
      </p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button
          type="button"
          className={BUTTON}
          aria-pressed={running}
          onClick={() => {
            setRunning((now) => !now);
          }}
        >
          {running ? 'Stop' : 'Start'}
        </button>

        <label className={FIELD_LABEL}>
          <span className={CAPTION}>Rows</span>
          <select
            className={SELECT}
            value={rowCount}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              const next = Number(event.target.value);
              setRowCount(next);
              setSelectedId(null);
              source.replaceAll(next);
            }}
          >
            {ROW_COUNTS.map((count) => (
              <option key={count} value={count}>
                {WHOLE_NUMBER.format(count)}
              </option>
            ))}
          </select>
        </label>

        <label className={FIELD_LABEL}>
          <span className={CAPTION}>Changing each round</span>
          <select
            className={SELECT}
            value={share}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setShare(Number(event.target.value));
            }}
          >
            {CHANGE_SHARES.map((one) => (
              <option key={one} value={one}>
                {PERCENT.format(one)}
              </option>
            ))}
          </select>
        </label>

        <label className={FIELD_LABEL}>
          <span className={CAPTION}>Group</span>
          <select
            className={SELECT}
            value={group}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setGroup(event.target.value);
            }}
          >
            <option value="">All</option>
            {GROUPS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className={FIELD_LABEL}>
          <input
            type="checkbox"
            className="accent-gold"
            checked={lowOnly}
            onChange={(event) => {
              setLowOnly(event.target.checked);
            }}
          />
          Value under 10,000
        </label>

        <label className={FIELD_LABEL}>
          <input
            type="checkbox"
            className="accent-gold"
            checked={highlightTenth}
            onChange={(event) => {
              setHighlightTenth(event.target.checked);
            }}
          />
          Highlight every tenth row
        </label>

        <label className={FIELD_LABEL}>
          <input
            type="checkbox"
            className="accent-gold"
            checked={stale}
            onChange={(event) => {
              setStale(event.target.checked);
            }}
          />
          Stale
        </label>

        <p className="m-0 text-sm text-muted-foreground">
          Selected: <span className="tabular-nums text-foreground">{selectedId ?? 'none'}</span>
        </p>
      </div>

      <Readout grid={gridReadout} page={pageSample} />

      <div ref={table} className="h-[28rem] overflow-hidden rounded-md border border-border bg-card">
        <LiveGrid<FakeRow>
          source={source}
          columns={COLUMNS}
          defaultColDef={DEFAULT_COL_DEF}
          label={LABEL}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filter={filter}
          isDimmed={isDimmed}
          isHighlighted={highlightTenth ? isEveryTenth : undefined}
          stale={stale}
          onReadout={setGridReadout}
        />
      </div>
    </div>
  );
}
