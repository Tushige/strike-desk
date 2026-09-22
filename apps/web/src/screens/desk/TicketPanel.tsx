import type { Frame } from '@strike-desk/shared/protocol';
import { ActionDock } from '../ui';
import { NextDayButton, OpeningBellButton, SkipToBellButton } from './PhaseActions';

/**
 * The right-hand panel: build a ticket before and during the market, watch
 * it while it is open, read the debrief at the bell. The builder and the
 * live ticket arrive in the next step; for now the panel carries the clock
 * buttons so a whole day can be played.
 */
export function TicketPanel({ frame, companyId }: { frame: Frame; companyId: number }) {
  const phase = frame.clock.phase;
  const company = frame.companies[companyId];

  if (phase === 'preBell') {
    return (
      <div className="flex min-h-full flex-col gap-4 short:gap-3">
        <h2 className="m-0 font-display text-xl font-bold">Build your ticket</h2>
        <p className="m-0 leading-normal text-muted">Pick UP or DOWN on {company?.name ?? 'a company'}, a target, and how much to spend.</p>
        <ActionDock>
          <OpeningBellButton frame={frame} />
        </ActionDock>
      </div>
    );
  }
  if (phase === 'open') {
    return (
      <div className="flex min-h-full flex-col gap-[18px] short:gap-3.5">
        <h2 className="m-0 font-display text-xl font-bold">Sitting this one out</h2>
        <p className="m-0 leading-normal text-muted">No ticket today, so your cash is safe. Watch the prices and see which headlines turn out to be true.</p>
        <ActionDock>
          <SkipToBellButton frame={frame} />
        </ActionDock>
      </div>
    );
  }
  return (
    <div className="flex min-h-full flex-col gap-[18px] short:gap-3.5 motion-safe:animate-rise">
      <h2 className="m-0 font-display text-xl font-bold">Closing bell</h2>
      <ActionDock>
        <NextDayButton frame={frame} />
      </ActionDock>
    </div>
  );
}
