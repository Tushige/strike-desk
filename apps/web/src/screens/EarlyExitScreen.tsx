import { useEffect, useRef, useState } from 'react';
import type { Frame } from '@strike-desk/shared/protocol';
import { playAgain } from '../boot';
import { money, signedMoney } from './format';
import { LogoMark } from './ui';
import { RoboPup } from './mascot/RoboPup';
import { BalanceJourney } from './summary/BalanceJourney';
import { DayReview } from './ticket/DayReview';
import './summary/summary.css';

export interface EarlyExit {
  frame: Frame;
  pending: boolean;
  stale: boolean;
}

/** A frozen record of what was observed, not a fabricated final server result. */
export function EarlyExitScreen({ exit }: { exit: EarlyExit }) {
  const { frame } = exit;
  const [selected, setSelected] = useState(frame.days.at(-1)?.day ?? 1);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const openTickets = frame.positions.filter(position => position.status === 'open');
  const currentTrades = frame.positions.filter(position => position.day === frame.clock.day);
  const completeToday = frame.days.some(day => day.day === frame.clock.day);
  return <div className="app-shell flex min-h-dvh flex-col">
    <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-7">
      <div className="flex items-center gap-3"><LogoMark /><span className="brand-wordmark">Strike Desk</span></div>
      <span className="text-sm text-muted">Run ended early</span>
    </header>
    <main className="end-screen">
      <div className="summary-scene summary-journey">
        <div className="summary-heading">
          <div className="summary-verdict summary-verdict-with-pup">
            <div className="summary-verdict-copy">
              <h1 ref={heading} tabIndex={-1}>You rang your own bell.</h1>
              <p>{frame.positions.length === 0 ? 'A little window-shopping, then a well-earned snack break. RoboPup approves.' : 'The market can wait. RoboPup is closing your tab and keeping the receipt.'} You chose to leave on day {frame.clock.day}, with {frame.days.length} of 5 days complete.</p>
            </div>
            <RoboPup pose="receipt" />
          </div>
          <div className="summary-balance">
            <span className="summary-caption">Last observed portfolio value</span>
            <div className="summary-total">{money(frame.account.worthCents)}</div>
            <p className="summary-caption">Cash {money(frame.account.cashCents)}{openTickets.length > 0 && <> · Open positions {money(openTickets.reduce((sum, position) => sum + position.valueCents, 0))}</>}</p>
          </div>
        </div>
        <div className="summary-journey-body">
          {(exit.pending || exit.stale) && <p className="text-sm text-sun">{exit.pending ? 'An order was still being checked when you left. It will not be retried; this snapshot may not include its result.' : 'The connection was interrupted. These are the last values received, which may be out of date.'}</p>}
          {!completeToday && <section aria-label="Unfinished day" className="mb-6 rounded-xl bg-raised p-4 text-sm leading-relaxed">
            <h2 className="m-0 mb-2 font-semibold">Day {frame.clock.day} · Clocked out early</h2>
            <p className="m-0 text-muted">{openTickets.length > 0 ? <>{openTickets.length} {openTickets.length === 1 ? 'position was' : 'positions were'} still open. Their last values are included above, but ending the game did not cash them out or settle them.</> : currentTrades.length > 0 ? <>You cashed out today for {money(currentTrades.reduce((sum, position) => sum + (position.exit?.proceedsCents ?? position.valueCents), 0))}, a {signedMoney(currentTrades.reduce((sum, position) => sum + position.profitCents, 0))} result. The day was not completed.</> : 'No ticket bought today. This unfinished day is not counted as a completed day.'}</p>
          </section>}
          {frame.days.length > 0 ? <>
            <h2 className="text-base font-semibold">The days you completed</h2>
            <BalanceJourney days={frame.days} selected={selected} />
            <div className="summary-days summary-day-strip" role="group" aria-label="Review completed days">
              {frame.days.map(day => <button key={day.day} type="button" className="summary-day" aria-pressed={selected === day.day} onClick={() => { setSelected(day.day); }}>
                <span>Day {day.day}</span><span className={day.changeCents < 0 ? 'summary-loss' : 'summary-profit'}>{signedMoney(day.changeCents)}</span>
              </button>)}
            </div>
            <div className="summary-review-panels"><DayReview frame={frame} day={selected} /></div>
          </> : <p className="mb-6 text-sm text-muted">No closing bells yet. A fresh five-day run is waiting whenever you are.</p>}
        </div>
        <div className="summary-footer">
          <button className="summary-play" type="button" onClick={playAgain}>Back to start</button>
          <p>This run is over for you. A new game starts with fresh pretend money and a new market.</p>
        </div>
      </div>
    </main>
  </div>;
}
