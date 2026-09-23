import { MAX_DAILY_PURCHASES, type Side } from '@strike-desk/shared/protocol';
import { useEffect, useRef } from 'react';
import type { TicketContract } from '../../modules/order-ticket/index';
import { usePendingCommands, useScreenFrame } from '../../store/hooks';
import { money } from '../format';
import type { Pick } from '../desk/pick';
import { CashedOut, LiveTicket } from './LiveTicket';
import { ResultPanel } from './ResultPanel';
import { PositionList } from './PositionList';
import { TicketBuilder } from './TicketBuilder';
import { useTicketMachine } from './useTicketMachine';

/** One persistent draft, a compact ledger, and an inspector for the selected purchase. */
export function TicketPanel({
  companyId,
  contract,
  pick,
  onPick,
  onChooseSide,
  onChooseChoice,
  selectedPositionId,
  onSelectPosition,
}: {
  companyId: number;
  contract: TicketContract | null;
  pick: Pick;
  onPick: (contractId: number) => void;
  onChooseSide: (side: Side) => void;
  onChooseChoice: (choice: Pick['choice']) => void;
  selectedPositionId: string | null;
  onSelectPosition: (id: string | null) => void;
}) {
  const frame = useScreenFrame('ticket');
  const machine = useTicketMachine(frame, contract, onPick, selectedPositionId);
  const positions = frame.positions.filter(position => position.day === frame.clock.day);
  const ticket = positions.find(position => position.id === selectedPositionId) ?? null;
  const left = Math.max(0, MAX_DAILY_PURCHASES - positions.length);
  const pending = usePendingCommands().some(item => item.command.t === 'buy' || item.command.t === 'cashOut') || machine.state.form === 'pending' || machine.state.form === 'checking';
  const phase = frame.clock.phase;
  const detail = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastPurchaseCount = useRef(positions.length);
  useEffect(() => { if (detail.current) detail.current.scrollTop = 0; }, [selectedPositionId, positions.length]);
  useEffect(() => {
    if (positions.length > lastPurchaseCount.current && heading.current) {
      heading.current.focus({ preventScroll: true });
      if (window.innerWidth < 1024) heading.current.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
    lastPurchaseCount.current = positions.length;
  }, [positions.length]);

  if (phase === 'debrief') return <ResultPanel frame={frame} />;
  return <div className="purchase-panel">
    <div className="purchase-allowance">
      <div className="purchase-title"><h2 ref={heading} tabIndex={-1}>Your tickets</h2><span>{positions.length} of {MAX_DAILY_PURCHASES} purchases</span></div>
      <div className="purchase-marks" aria-hidden="true">{Array.from({ length: MAX_DAILY_PURCHASES }, (_, index) => <span key={index} className={index < positions.length ? 'used' : ''} />)}</div>
      <div className="purchase-budget"><span>Daily allowance left</span><strong>{money(frame.account.capCents)}</strong></div>
    </div>
    {ticket !== null && left > 0 && !frame.stress && <button type="button" className="purchase-new" disabled={pending} onClick={() => { onSelectPosition(null); }}>
      <span><span aria-hidden="true">＋ </span>New purchase</span><span>{left} left</span>
    </button>}
    <div className="purchase-holdings">
      {positions.length > 0 ? <PositionList frame={frame} positions={positions} selectedId={selectedPositionId} onSelect={onSelectPosition} disabled={pending} /> : <p className="purchase-empty">Up to three purchases today. Start with one below.</p>}
      {left === 0 && <p className="purchase-empty">All three purchases used. You can still cash out each open position.</p>}
    </div>
    <div className="purchase-detail" ref={detail}>
      <div hidden={ticket !== null || left === 0}>
        <TicketBuilder frame={frame} companyId={companyId} pick={pick} onChooseSide={onChooseSide} onChooseChoice={onChooseChoice} machine={machine} />
      </div>
      {ticket?.status === 'open' && <LiveTicket frame={frame} position={ticket} machine={machine} />}
      {ticket !== null && ticket.status !== 'open' && <CashedOut frame={frame} position={ticket} />}
    </div>
  </div>;
}
