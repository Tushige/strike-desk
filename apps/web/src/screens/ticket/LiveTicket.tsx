import type { Frame, PositionView } from '@strike-desk/shared/protocol';
import { CASH_OUT_BLOCKER_WORDS, cashOutBlocker } from '../../modules/order-ticket/index';
import { OpeningBellButton, SkipToBellButton } from '../desk/PhaseActions';
import { count, money, price, signedMoney } from '../format';
import { ActionDock, cx, Label, PrimaryButton } from '../ui';
import { Notice } from './Notice';
import type { TicketMachine } from './useTicketMachine';

/**
 * Today's ticket while the market is open: what it is worth now, what it is
 * made of (real value plus hope value, and hope melts), and the cash-out
 * button. Every amount is the server's; the bar only draws proportions.
 */

function BigMoney({ label, value, paid, profit }: { label: string; value: number; paid: number; profit: number }) {
  const good = profit >= 0;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className={cx('font-display text-[38px] leading-tight font-extrabold tabular-nums short:text-[32px]', good ? 'text-mint' : 'text-coral')}>{money(value)}</div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">You paid {money(paid)}</span>
        <span className={cx('rounded-[10px] px-2.5 py-1 text-sm font-bold tabular-nums', good ? 'bg-mint/15 text-mint' : 'bg-coral/15 text-coral')}>
          {signedMoney(profit)}
        </span>
      </div>
    </div>
  );
}

/** The teaching piece: a ticket's value = real value + hope value, and hope melts. Per ticket, as the server splits it. */
function ValueBar({ position }: { position: PositionView }) {
  const real = position.realCents;
  const hope = position.hopeCents;
  const paid = position.entryPriceCents;
  const scale = Math.max(paid, real + hope, 1);
  const pct = (n: number): string => `${String((n / scale) * 100)}%`;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line p-4 short:gap-2 short:p-3">
      <div className="text-sm font-semibold">What your ticket is made of</div>
      <div className="relative py-1" aria-hidden="true">
        <div className="flex h-[22px] overflow-hidden rounded-full bg-ink">
          <span className="h-full bg-cloud transition-[width] duration-200" style={{ width: pct(real) }} />
          <span className="h-full bg-grape transition-[width] duration-200" style={{ width: pct(hope) }} />
        </div>
        {/* The marker sits outside the clipped bar so it stays visible at 100%. */}
        <span className="absolute inset-y-0 w-[3px] rounded-full bg-sun" style={{ left: `calc(${pct(paid)} - 3px)` }} />
      </div>
      <dl className="m-0 flex flex-col gap-2.5 short:gap-1.5">
        <div className="flex gap-2.5">
          <span className="mt-1 size-3 shrink-0 rounded bg-cloud" />
          <div className="flex grow flex-col gap-0.5">
            <div className="flex justify-between text-sm font-semibold">
              <dt>Real value</dt>
              <dd className="m-0 tabular-nums">{money(real)} a ticket</dd>
            </div>
            <div className="text-xs leading-snug text-muted short:hidden">How far the price is past your target right now.</div>
          </div>
        </div>
        <div className="flex gap-2.5">
          <span className="mt-1 size-3 shrink-0 rounded bg-grape" />
          <div className="flex grow flex-col gap-0.5">
            <div className="flex justify-between text-sm font-semibold">
              <dt>Hope value</dt>
              <dd className="m-0 tabular-nums">{money(hope)} a ticket</dd>
            </div>
            <div className="text-xs leading-snug text-muted short:hidden">What traders pay for the time that is left. It melts to $0 by the bell.</div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 short:hidden">
          <span className="mx-[4.5px] h-3.5 w-[3px] shrink-0 bg-sun" />
          <span className="text-xs text-muted">Yellow line: what you paid a ticket ({money(paid)}).</span>
        </div>
        <div className="hidden text-xs text-muted short:block">Yellow line: what you paid a ticket ({money(paid)}).</div>
      </dl>
    </div>
  );
}

function TicketSummary({ frame, position }: { frame: Frame; position: PositionView }) {
  const company = frame.companies[position.companyId];
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-raised px-4 py-3.5 short:py-2.5">
      <div className="text-[15px] font-bold">
        {count(position.quantity)} {position.side === 'up' ? 'UP' : 'DOWN'} tickets on {company?.name}
      </div>
      <div className="text-sm text-muted">
        Pays if {company?.ticker} closes {position.side === 'up' ? 'above' : 'below'} {price(position.targetCents)}. Break-even {price(position.breakEvenCents)}.
      </div>
    </div>
  );
}

export function LiveTicket({ frame, position, machine }: { frame: Frame; position: PositionView; machine: TicketMachine }) {
  const blocker = cashOutBlocker(machine.state, machine.snapshot);
  return (
    <div className="flex min-h-full flex-col gap-[18px] short:gap-3.5">
      <h2 className="m-0 font-display text-xl font-bold short:text-lg">Your ticket</h2>
      <TicketSummary frame={frame} position={position} />
      <BigMoney label="Worth right now" value={position.valueCents} paid={position.costCents} profit={position.profitCents} />
      <ValueBar position={position} />
      <ActionDock>
        <PrimaryButton className="h-16 short:h-[52px]" disabled={blocker !== null} onClick={() => { machine.handlers.onPress('cashOut'); }}>
          Cash out {money(position.valueCents)}
        </PrimaryButton>
        {blocker !== null && CASH_OUT_BLOCKER_WORDS[blocker] !== null && (
          <p className="m-0 text-xs text-muted" role="status">{CASH_OUT_BLOCKER_WORDS[blocker]}</p>
        )}
        <Notice machine={machine} />
        <p className="m-0 text-[13px] leading-snug text-muted short:text-xs">
          Or hold on. At the closing bell, a ticket past its target pays its real value. A ticket that missed is worth $0.
        </p>
        {frame.clock.phase === 'preBell' ? <OpeningBellButton frame={frame} compact /> : <SkipToBellButton frame={frame} compact />}
      </ActionDock>
    </div>
  );
}

/** After an early exit: what came back, and what holding on would be worth right now. */
export function CashedOut({ frame, position }: { frame: Frame; position: PositionView }) {
  const proceeds = position.exit?.proceedsCents ?? position.valueCents;
  return (
    <div className="flex min-h-full flex-col gap-[18px] short:gap-3.5">
      <h2 className="m-0 font-display text-xl font-bold">You cashed out</h2>
      <TicketSummary frame={frame} position={position} />
      <BigMoney label="Money back in your pocket" value={proceeds} paid={position.costCents} profit={position.profitCents} />
      {position.ifHeldCents !== undefined && (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-line p-4">
          <div className="text-sm font-semibold">If you had held on</div>
          <div className="font-display text-2xl font-bold tabular-nums">{money(position.ifHeldCents)}</div>
          <div className="text-[13px] leading-snug text-muted">This is what your ticket would be worth right now. Keep watching. It can still go either way.</div>
        </div>
      )}
      <ActionDock>{frame.clock.phase === 'preBell' ? <OpeningBellButton frame={frame} compact /> : <SkipToBellButton frame={frame} />}</ActionDock>
    </div>
  );
}
