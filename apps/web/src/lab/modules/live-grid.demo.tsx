import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import type { CellClassParams, ColDef, ValueFormatterParams } from 'ag-grid-community';
import { createFakeRowSource } from '../../modules/live-grid/fake';
import type { FakeRow } from '../../modules/live-grid/fake';
import { LiveGrid } from '../../modules/live-grid/index';

/**
 * The live grid, shown by itself against made-up rows. Nothing here knows of
 * tickets or money: a row is a number, a group and a value that moves.
 *
 * The rows move only while Start is pressed, five rounds a second, the pace
 * the game's prices arrive at. Every control above the table changes what the
 * table is told, never the table: they are the props a screen of the game
 * will hand it.
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
const CHANGE_FRACTION = 0.3;
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
const FIELD_LABEL = 'flex items-center gap-2 text-sm text-foreground';
const CAPTION = 'text-[11px] uppercase tracking-[0.12em] text-muted-foreground';

export default function LiveGridDemo(): ReactElement {
  // One source for the life of the page, made on the first render only.
  const [source] = useState(() => createFakeRowSource({ rowCount: 252, seed: 7 }));
  const [running, setRunning] = useState(false);
  const [group, setGroup] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [highlightTenth, setHighlightTenth] = useState(false);
  const [stale, setStale] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      source.tick(CHANGE_FRACTION);
    }, 1000 / ROUNDS_PER_SECOND);
    return () => {
      window.clearInterval(timer);
    };
  }, [running, source]);

  // A new function only when a filter control changes: that is what tells the table to filter again.
  const filter = useMemo(() => filterFor(group, lowOnly), [group, lowOnly]);

  return (
    <div id="lab-demo-live-grid" className="flex flex-col gap-3">
      <p className="m-0 max-w-[68ch] text-sm text-muted-foreground">
        252 made-up rows in the table the game uses for its contracts. Press Start, sort by Value, then move the pointer
        over the table: the rows hold still until you leave.
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
          <span className={CAPTION}>Group</span>
          <select
            className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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

      <div className="h-[28rem] overflow-hidden rounded-md border border-border bg-card">
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
        />
      </div>
    </div>
  );
}
