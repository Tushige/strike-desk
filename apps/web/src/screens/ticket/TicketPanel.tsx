import type { Frame, Side } from '@strike-desk/shared/protocol';
import type { TicketContract } from '../../modules/order-ticket/index';
import { NextDayButton } from '../desk/PhaseActions';
import type { Pick } from '../desk/pick';
import { ActionDock } from '../ui';
import { CashedOut, LiveTicket } from './LiveTicket';
import { todaysTicket } from './sources';
import { TicketBuilder } from './TicketBuilder';
import { useTicketMachine } from './useTicketMachine';

/**
 * The right-hand panel, chosen by the day's state: build a ticket until one
 * is bought (before the bell and while the market is open), watch it while
 * it is held, see what came back after an early exit, and read the debrief
 * at the bell.
 */
export function TicketPanel({
  frame,
  companyId,
  contract,
  pick,
  onPick,
  onChooseSide,
  onChooseChoice,
}: {
  frame: Frame;
  companyId: number;
  contract: TicketContract | null;
  pick: Pick;
  onPick: (contractId: number) => void;
  onChooseSide: (side: Side) => void;
  onChooseChoice: (choice: Pick['choice']) => void;
}) {
  const machine = useTicketMachine(frame, contract, onPick);
  const ticket = todaysTicket(frame);
  const phase = frame.clock.phase;

  if (phase === 'debrief') {
    return (
      <div className="flex min-h-full flex-col gap-[18px] short:gap-3.5 motion-safe:animate-rise">
        <h2 className="m-0 font-display text-xl font-bold">Closing bell</h2>
        <ActionDock>
          <NextDayButton frame={frame} />
        </ActionDock>
      </div>
    );
  }
  if (ticket === null) {
    return (
      <TicketBuilder frame={frame} companyId={companyId} pick={pick} onChooseSide={onChooseSide} onChooseChoice={onChooseChoice} machine={machine} />
    );
  }
  if (ticket.status === 'open') return <LiveTicket frame={frame} position={ticket} machine={machine} />;
  return <CashedOut frame={frame} position={ticket} />;
}
