import { memo, useEffect, useRef, useSyncExternalStore } from 'react';
import { stressMeasurements } from '../boot';
import { StressReadout } from './StressReadout';
import { watchTable } from './watchTable';
import { LiveGrid } from '../modules/live-grid/index';
import type { ContractRow } from '../store/contractRows';
import { boardRowSource } from '../store/hooks';
import { COLUMNS, DEFAULT_COL_DEF } from './columns';

/**
 * The contract table: one row per ticket, repricing live.
 *
 * The table itself is the live grid, a block of its own. This file is what
 * makes it the game's: the store as its row source, the contract columns, and
 * which rows are dimmed. The moving prices never pass through React, so this
 * component does not render while prices move.
 *
 * Everything handed to the grid is made once, here at module scope. A new
 * identity on any of it would make the grid set itself up again.
 */

const LABEL = 'Contracts';

/**
 * A ticket too cheap to trade keeps its place as a dimmed row. The store
 * decides which rows those are, and only while tickets can be bought, so
 * from the closing bell on every row shows what it settled at.
 */
const isDimmed = (row: ContractRow): boolean => row.dimmed;

export const ContractBoard = memo(function ContractBoard({ selectedId, onSelect, filter, isHighlighted, stale = false, staleNoticeId }: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: ((row: ContractRow) => boolean) | null;
  isHighlighted: (row: ContractRow) => boolean;
  stale?: boolean;
  staleNoticeId?: string;
}) {
  const stress = useSyncExternalStore(stressMeasurements.subscribe, stressMeasurements.isEnabled);
  const table = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const gridElement = table.current?.lastElementChild;
    if (!stress || !(gridElement instanceof HTMLElement)) return;
    return watchTable(gridElement, stressMeasurements);
  }, [stress]);
  const grid = (
    <LiveGrid<ContractRow>
      source={boardRowSource}
      columns={COLUMNS}
      defaultColDef={DEFAULT_COL_DEF}
      label={LABEL}
      selectedId={selectedId}
      onSelect={onSelect}
      filter={filter}
      isHighlighted={isHighlighted}
      isDimmed={isDimmed}
      stale={stale}
      staleNoticeId={staleNoticeId}
    />
  );
  return stress ? <div ref={table} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
    <StressReadout measurements={stressMeasurements} />
    {grid}
  </div> : grid;
});
