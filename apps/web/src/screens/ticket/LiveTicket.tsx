import type { Frame, PositionView } from '@strike-desk/shared/protocol';
import { CASH_OUT_BLOCKER_WORDS, cashOutBlocker } from '../../modules/order-ticket/index';
import { OpeningBellButton, SkipToBellButton } from '../desk/PhaseActions';
import { count, money, price, signedMoney } from '../format';
import { ActionDock, cx, Label, GhostButton } from '../ui';
import { Notice } from './Notice';
import { RoboPup } from '../mascot/RoboPup';
import type { TicketMachine } from './useTicketMachine';

/**
 * Today's ticket while the market is open: what it is worth now, what it is
 * made of (real value plus hope value, and hope melts), and the cash-out
 * button. Every amount is the server's; the bar only draws proportions.
 */

function BigMoney({
  label,
  value,
  paid,
  profit,
  dim = false,
}: {
  label: string;
  value: number;
  paid: number;
  profit: number;
  dim?: boolean;
}) {
  const good = profit >= 0;
  return (
    <div className={cx('flex flex-col gap-1.5 transition-opacity', dim && 'opacity-60')}>
      <Label>{label}</Label>
      <div
        className={cx(
          'ticket-live-money font-display leading-tight font-extrabold tabular-nums',
          good ? 'text-mint' : 'text-coral',
        )}
      >
        {money(value)}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="text-sm text-muted">You paid {money(paid)}</span>
        <span
          className={cx(
            'w-[15ch] rounded-[10px] px-2.5 py-1 text-right text-sm font-bold whitespace-nowrap tabular-nums',
            good ? 'bg-mint/15 text-mint' : 'bg-coral/15 text-coral',
          )}
        >
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
  return (
    <div className="ticket-breakdown flex flex-col gap-3 short:gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">What a ticket is made of</span>
        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
          <span className="h-3.5 w-[3px] shrink-0 bg-sun" aria-hidden="true" />
          you paid {money(paid)}
        </span>
      </div>
      <div className="relative py-1" aria-hidden="true">
        <div className="relative h-[22px] overflow-hidden rounded-full bg-ink">
          <span
            className="value-bar-fill absolute inset-0 bg-grape"
            style={{ transform: `scaleX(${String((real + hope) / scale)})` }}
          />
          <span
            className="value-bar-fill absolute inset-0 bg-cloud"
            style={{ transform: `scaleX(${String(real / scale)})` }}
          />
        </div>
        {/* The marker sits outside the clipped bar so it stays visible at 100%. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 100 30"
          preserveAspectRatio="none"
        >
          <line
            className="value-bar-marker stroke-sun"
            x1="0"
            x2="0"
            y1="0"
            y2="30"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
            style={{ transform: `translateX(${String((paid / scale) * 100)}px)` }}
          />
        </svg>
      </div>
      <dl className="m-0 flex flex-col gap-2.5 short:gap-1.5">
        <div className="flex gap-2.5">
          <span className="mt-1 size-3 shrink-0 rounded bg-cloud" />
          <div className="flex min-w-0 grow flex-col gap-0.5">
            <div className="grid grid-cols-[5rem_minmax(0,1fr)] text-sm font-semibold">
              <dt>Real value</dt>
              <dd className="m-0 text-right whitespace-nowrap tabular-nums">
                {money(real)} /ticket
              </dd>
            </div>
            <div className="text-xs leading-snug text-muted short:hidden">
              How far the price is past your target right now.
            </div>
          </div>
        </div>
        <div className="flex gap-2.5">
          <span className="mt-1 size-3 shrink-0 rounded bg-grape" />
          <div className="flex min-w-0 grow flex-col gap-0.5">
            <div className="grid grid-cols-[5rem_minmax(0,1fr)] text-sm font-semibold">
              <dt>Hope value</dt>
              <dd className="m-0 text-right whitespace-nowrap tabular-nums">
                {money(hope)} /ticket
              </dd>
            </div>
            <div className="text-xs leading-snug text-muted short:hidden">
              What traders pay for the time that is left. It expires at the bell; it can rise or
              fall before then.
            </div>
          </div>
        </div>
      </dl>
    </div>
  );
}

function TicketSummary({ frame, position }: { frame: Frame; position: PositionView }) {
  const company = frame.companies[position.companyId];
  return (
    <div className="flex flex-col gap-1 border-b border-line pb-4">
      <div className="text-[15px] font-bold">
        {count(position.quantity)} {position.side === 'up' ? 'UP' : 'DOWN'} tickets on{' '}
        {company?.name}
      </div>
      <div className="text-sm text-muted">
        Pays if {company?.ticker} closes {position.side === 'up' ? 'above' : 'below'}{' '}
        {price(position.targetCents)}. Break-even {price(position.breakEvenCents)}.
      </div>
    </div>
  );
}

export function LiveTicket({
  frame,
  position,
  machine,
}: {
  frame: Frame;
  position: PositionView;
  machine: TicketMachine;
}) {
  const blocker = cashOutBlocker(machine.state, machine.snapshot);
  const purchaseNumber =
    frame.positions
      .filter((item) => item.day === position.day)
      .findIndex((item) => item.id === position.id) + 1;
  return (
    <div className="flex min-h-full flex-col gap-[18px] short:gap-3.5">
      <h2 className="ticket-panel-heading ticket-mascot-heading m-0">
        Purchase {purchaseNumber}{' '}
        <RoboPup
          pose="stamp"
          active={machine.state.notice?.kind === 'accepted' && machine.state.notice.of === 'buy'}
        />
      </h2>
      <div className="ticket-content">
        <TicketSummary frame={frame} position={position} />
        <BigMoney
          label="Worth right now"
          value={position.valueCents}
          paid={position.costCents}
          profit={position.profitCents}
          dim={machine.snapshot.line !== 'live'}
        />
        <ValueBar position={position} />
      </div>
      <ActionDock>
        <GhostButton
          tone="line"
          className="live-trade-action h-16 short:h-[52px]"
          disabled={blocker !== null}
          onClick={() => {
            machine.handlers.onPress('cashOut');
          }}
        >
          <span>Cash out</span>
          <span>{money(position.valueCents)}</span>
        </GhostButton>
        {blocker !== null && CASH_OUT_BLOCKER_WORDS[blocker] !== null && (
          <p className="m-0 text-xs text-muted" role="status">
            {CASH_OUT_BLOCKER_WORDS[blocker]}
          </p>
        )}
        <Notice machine={machine} />
        <p className="m-0 text-[13px] leading-snug text-muted short:text-xs">
          Or hold on. At the closing bell, a ticket past its target pays its real value. A ticket
          that missed is worth $0.
        </p>
        {frame.clock.phase === 'preBell' ? (
          <OpeningBellButton frame={frame} compact />
        ) : (
          <SkipToBellButton frame={frame} compact />
        )}
      </ActionDock>
    </div>
  );
}

/** After an early exit: what came back, and what holding on would be worth right now. */
export function CashedOut({ frame, position }: { frame: Frame; position: PositionView }) {
  const proceeds = position.exit?.proceedsCents ?? position.valueCents;
  return (
    <div className="flex min-h-full flex-col gap-[18px] short:gap-3.5">
      <h2 className="ticket-panel-heading ticket-confirmed-heading m-0">
        You cashed out <TicketStamp />
      </h2>
      <div className="ticket-content">
        <TicketSummary frame={frame} position={position} />
        <BigMoney
          label="Money back in your pocket"
          value={proceeds}
          paid={position.costCents}
          profit={position.profitCents}
        />
        {position.ifHeldCents !== undefined && (
          <div className="flex flex-col gap-1.5 border-t border-line pt-4">
            <div className="text-sm font-semibold">If you had held on</div>
            <div className="font-display text-2xl font-bold whitespace-nowrap tabular-nums">
              {money(position.ifHeldCents)}
            </div>
            <div className="text-[13px] leading-snug text-muted">
              This is what your ticket would be worth right now. Keep watching. It can still go
              either way.
            </div>
          </div>
        )}
      </div>
      <ActionDock>
        {frame.clock.phase === 'preBell' ? (
          <OpeningBellButton frame={frame} compact />
        ) : (
          <SkipToBellButton frame={frame} />
        )}
      </ActionDock>
    </div>
  );
}

/** Only mounted with a server-owned position or its confirmed early exit. */
function TicketStamp() {
  return (
    <svg className="ticket-stamp" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m7 12 3 3 7-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
