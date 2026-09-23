import type { Frame } from '@strike-desk/shared/protocol';
import { NextDayButton } from '../desk/PhaseActions';
import { signedMoney } from '../format';
import { ActionDock, cx, Label } from '../ui';
import { RoboPup } from '../mascot/RoboPup';
import { DayReview } from './DayReview';

/** The closing bell combines today's result, with a separate review for each purchase. */
export function ResultPanel({ frame }: { frame: Frame }) {
  const result = frame.days.find(day => day.day === frame.clock.day);
  const change = result?.changeCents ?? 0;
  return <div className="day-result flex min-h-full flex-col gap-[18px] short:gap-3.5">
    <h2 className="ticket-panel-heading ticket-mascot-heading m-0">Closing bell <RoboPup key={frame.clock.day} pose="bell" active={result !== undefined} /></h2>
    <div className="ticket-content">
      <div className="flex flex-col gap-1.5">
        <Label>Today you made</Label>
        <div className={cx('font-display text-[38px] leading-tight font-extrabold tabular-nums short:text-[32px]', change > 0 ? 'text-mint' : change < 0 ? 'text-coral' : 'text-cloud')}>
          {result === undefined ? '…' : signedMoney(change)}
        </div>
      </div>
      <DayReview key={frame.clock.day} frame={frame} day={frame.clock.day} />
    </div>
    <ActionDock><NextDayButton frame={frame} /></ActionDock>
  </div>;
}
