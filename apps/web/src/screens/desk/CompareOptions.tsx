import { useMemo, useRef, useState } from 'react';
import type { Side } from '@strike-desk/shared/protocol';
import { decodeContractId } from '@strike-desk/shared/protocol';
import { ContractBoard } from '../../board/ContractBoard';
import type { ContractRow } from '../../store/contractRows';
import { ChoiceButton, CompanyTile, cx } from '../ui';
import { useView, views } from '../../store/hooks';
import { choicesFor } from './pick';
import { COMPARISON_CHIP as CHIP, comparisonIntro } from './comparisonLayout';

/**
 * "Compare options": the whole contract board, every ticket of every company
 * repricing live, in the middle of the desk. Filters narrow it to a company,
 * a side, or the tickets the player can afford; the column headers sort it;
 * picking a row fills the ticket on the right. The six simple choices of the
 * selected company are highlighted, so the table and the builder agree.
 *
 * A company chip also selects the company shown by the chart and builder.
 * Side and affordability filters only narrow rows; All keeps the current
 * chart company while showing every company's contracts.
 */

const chipTone = (on: boolean): string => (on ? 'border-sun bg-sun text-ink' : 'border-line text-cloud');

export function CompareOptions({
  companyId,
  selectedContractId,
  onPick,
  onChooseCompany,
  companyLocked,
  stale,
}: {
  /** The selected company, whose simple choices are highlighted. */
  companyId: number;
  selectedContractId: number | null;
  onPick: (contractId: number) => void;
  onChooseCompany: (companyId: number) => void;
  companyLocked: boolean;
  stale: boolean;
}) {
  const frame = useView(views.comparison);
  const [filterCompany, setFilterCompany] = useState(false);
  const company = filterCompany ? companyId : null;
  const [side, setSide] = useState<Side | null>(null);
  const [affordable, setAffordable] = useState(false);

  // The board is a new object in every frame but the same board all day, so
  // the filter and the highlight are rebuilt when the day (or the game)
  // changes, not five times a second: a rebuilt filter makes the table
  // re-filter and re-sort every row, flashes included.
  const boardRef = useRef(frame?.board ?? null);
  if (frame === null) throw new Error('Comparison needs a frame');
  boardRef.current = frame.board;
  const boardKey = frame.board === null ? '' : `${frame.session}:${String(frame.clock.day)}:${String(frame.board.targetsPerCompany)}`;
  const { cashCents, capCents } = frame.account;
  const { minTicketCents } = frame;
  const buyable = frame.clock.phase === 'preBell' || frame.clock.phase === 'open';

  const filter = useMemo(() => {
    if (company === null && side === null && !affordable) return null;
    return (row: ContractRow): boolean => {
      if (company !== null && row.companyId !== company) return false;
      if (side !== null && row.side !== side) return false;
      if (!affordable) return true;
      const board = boardRef.current;
      if (board === null || !buyable) return false;
      const ref = decodeContractId(board.targetsPerCompany, row.contractId);
      const offers = board.companies[row.companyId];
      if (offers === undefined) return false;
      const offered = row.side === 'up' ? ref.targetIndex >= offers.lowestUpIndex : ref.targetIndex <= offers.highestDownIndex;
      // One ticket must be buyable: on offer, not too cheap to trade, and within both the cash and today's cap.
      return offered && row.priceCents >= minTicketCents && row.priceCents <= cashCents && row.priceCents <= capCents;
    };
    // boardKey stands in for the board itself, which is read through the ref.
  }, [company, side, affordable, boardKey, buyable, cashCents, capCents, minTicketCents]);

  const isHighlighted = useMemo(() => {
    const ids = new Set(choicesFor(boardRef.current, companyId).map((choice) => choice.contractId));
    return (row: ContractRow): boolean => ids.has(row.contractId);
  }, [boardKey, companyId]);

  return (
    <div className="comparison-content flex min-h-0 flex-col gap-3">
      <p className="m-0 text-xs text-muted">{comparisonIntro(frame.stress)}</p>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
        <ChoiceButton selected={company === null} className={cx(CHIP, chipTone(company === null))} onClick={() => { setFilterCompany(false); }}>
          All
        </ChoiceButton>
        {frame.companies.map((one, id) => (
          <ChoiceButton key={one.ticker} selected={company === id} disabled={companyLocked} className={cx(CHIP, 'pl-1', chipTone(company === id))} onClick={() => { setFilterCompany(true); onChooseCompany(id); }}>
            <CompanyTile companyId={id} size="xs" />
            {one.ticker}
          </ChoiceButton>
        ))}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <ChoiceButton selected={side === null} className={cx(CHIP, chipTone(side === null))} onClick={() => { setSide(null); }}>
          Both
        </ChoiceButton>
        <ChoiceButton selected={side === 'up'} className={cx(CHIP, side === 'up' ? 'border-mint bg-mint text-ink' : 'border-mint/50 text-mint')} onClick={() => { setSide('up'); }}>
          UP
        </ChoiceButton>
        <ChoiceButton selected={side === 'down'} className={cx(CHIP, side === 'down' ? 'border-coral bg-coral text-ink' : 'border-coral/50 text-coral')} onClick={() => { setSide('down'); }}>
          DOWN
        </ChoiceButton>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <ChoiceButton selected={affordable} className={cx(CHIP, chipTone(affordable))} onClick={() => { setAffordable((on) => !on); }}>
          Affordable for me
        </ChoiceButton>
      </div>
      <div className="comparison-grid min-h-0 overflow-hidden rounded-[18px] border border-line bg-panel">
        <ContractBoard
          selectedId={selectedContractId === null ? null : String(selectedContractId)}
          onSelect={(id) => { onPick(Number(id)); }}
          filter={filter}
          isHighlighted={isHighlighted}
          stale={stale}
        />
      </div>
    </div>
  );
}
