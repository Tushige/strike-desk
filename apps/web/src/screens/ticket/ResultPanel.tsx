import type { Frame } from '@strike-desk/shared/protocol';
import { useSeries } from '../../store/hooks';
import { NextDayButton } from '../desk/PhaseActions';
import { money, percentChange, signedMoney } from '../format';
import { ActionDock, cx, Label } from '../ui';
import { headlineFor } from '../desk/tips';
import { lessonFor } from './lesson';
import { todaysTicket } from './sources';

/**
 * The debrief at the closing bell: how the ticket's company moved, what
 * today made or lost, what was paid and what came back, and one sentence
 * about what just happened. Then on to the next day.
 */
export function ResultPanel({ frame, companyId }: { frame: Frame; companyId: number }) {
  const ticket = todaysTicket(frame);
  const shown = ticket?.companyId ?? companyId;
  const company = frame.companies[shown];
  const series = useSeries(shown);
  const opening = series.today[0] ?? null;
  const bell = series.today[series.today.length - 1] ?? null;
  const result = frame.days.find((day) => day.day === frame.clock.day);
  const change = result?.changeCents ?? 0;
  const held = ticket !== null && ticket.status !== 'cashedOut';

  return (
    <div className="flex min-h-full flex-col gap-[18px] short:gap-3.5 motion-safe:animate-rise">
      <h2 className="m-0 font-display text-xl font-bold short:text-lg">Closing bell</h2>

      <div className="flex flex-col gap-1 rounded-2xl bg-raised px-4 py-3.5 short:py-2.5">
        <div className="font-bold">{headlineFor(frame, shown) === null ? `${company?.name ?? ''} had no news today.` : `Did the ${company?.name ?? ''} news come true?`}</div>
        <div className="text-sm text-muted">
          {opening !== null && bell !== null ? `${company?.ticker ?? ''} moved ${percentChange(opening, bell)} today.` : 'The price says enough.'}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Today you made</Label>
        <div className={cx('font-display text-[38px] leading-tight font-extrabold tabular-nums short:text-[32px]', change > 0 ? 'text-mint' : change < 0 ? 'text-coral' : 'text-cloud')}>
          {result === undefined ? '…' : signedMoney(change)}
        </div>
      </div>

      {ticket !== null && (
        <dl className="m-0 flex flex-col gap-2.5 rounded-2xl border border-line p-4 text-[15px] short:gap-2 short:p-3">
          <div className="flex justify-between">
            <dt className="text-muted">You paid</dt>
            <dd className="m-0 font-semibold tabular-nums">{money(ticket.costCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{held ? 'Paid out at the bell' : 'You cashed out for'}</dt>
            <dd className="m-0 font-semibold tabular-nums">{money(ticket.exit?.proceedsCents ?? ticket.valueCents)}</dd>
          </div>
          {!held && ticket.ifHeldCents !== undefined && (
            <div className="flex justify-between">
              <dt className="text-muted">Holding on would have paid</dt>
              <dd className="m-0 font-semibold tabular-nums">{money(ticket.ifHeldCents)}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="text-[13px] font-semibold text-sun">What just happened</div>
        <p className="m-0 text-[15px] leading-normal short:text-sm">{lessonFor(ticket, opening, bell)}</p>
      </div>

      <ActionDock>
        <NextDayButton frame={frame} />
      </ActionDock>
    </div>
  );
}
