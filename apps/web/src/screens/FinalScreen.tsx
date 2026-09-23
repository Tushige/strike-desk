import { useState } from 'react';
import type { Frame } from '@strike-desk/shared/protocol';
import { playAgain } from '../boot';
import { useScreenFrame } from '../store/hooks';
import { money, signedMoney } from './format';
import { DAYS, finalWords, rankFor } from './words';
import { DayReview } from './ticket/DayReview';
import { BalanceJourney } from './summary/BalanceJourney';
import { RoboPup } from './mascot/RoboPup';
import { LessonConveyor } from './summary/LessonConveyor';
import './summary/summary.css';

type SummaryStyle = 'journey' | 'receipt' | 'journal' | 'scorecard';
const compactMoney = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const tone = (amount: number) => amount > 0 ? 'summary-profit' : amount < 0 ? 'summary-loss' : 'summary-flat';

function DayChoices({ frame, selected, onSelect, layout }: {
  frame: Frame; selected: number; onSelect: (day: number) => void; layout: SummaryStyle;
}) {
  const rows = layout === 'receipt' || layout === 'journal';
  return <div className={`summary-days ${rows ? 'summary-day-rows' : 'summary-day-strip'}`} role="group" aria-label="Review your five days">
    {Array.from({ length: DAYS }, (_, index) => {
      const day = index + 1;
      const result = frame.days.find(one => one.day === day);
      const ticket = frame.positions.find(one => one.day === day);
      const company = ticket === undefined ? undefined : frame.companies[ticket.companyId];
      const purchases = frame.positions.filter(one => one.day === day).length;
      const label = purchases > 1 ? `${String(purchases)} purchases` : ticket !== undefined ? `${company?.ticker ?? ''} ${ticket.side === 'up' ? 'UP' : 'DOWN'}` : result === undefined ? finalWords.notPlayed : finalWords.satOut;
      const amount = result === undefined ? '—' : result.changeCents === 0 ? '$0' : signedMoney(result.changeCents);
      const compact = result === undefined ? '—' : result.changeCents === 0 ? '$0' : `${result.changeCents < 0 ? '−' : '+'}$${compactMoney.format(Math.abs(result.changeCents) / 100)}`;
      return <button key={day} type="button" className="summary-day" aria-pressed={selected === day}
        aria-label={`Review day ${String(day)}, ${label}, ${amount}`} title={`Day ${String(day)} · ${label} · ${amount}`}
        style={{ animationDelay: `${String(180 + index * 45)}ms` }} onClick={() => { onSelect(day); }}>
        <span>Day {day}</span>{rows && <span className="summary-company">{label}</span>}
        <span className={`summary-day-amount ${tone(result?.changeCents ?? 0)}`} aria-hidden="true">{rows ? amount : compact}</span>
      </button>;
    })}
  </div>;
}

function Review({ frame, selected }: { frame: Frame; selected: number }) {
  return <div className="summary-review-panels">
    {Array.from({ length: DAYS }, (_, i) => i + 1).map(day => <div key={day}
      className={selected === day ? 'summary-review-active' : 'summary-review-inactive'} aria-hidden={selected !== day} inert={selected !== day}>
      <DayReview frame={frame} day={day} />
    </div>)}
  </div>;
}

export function FinalScreen() {
  const frame = useScreenFrame('review');
  return <SummaryComposition frame={frame} layout="journey" />;
}

/** Alternative compositions remain in code; the live screen always uses Journey. */
export function SummaryComposition({ frame, layout }: { frame: Frame; layout: SummaryStyle }) {
  const [selected, setSelected] = useState(frame.positions[0]?.day ?? frame.days[0]?.day ?? 1);
  const finalCents = frame.final?.finalCents ?? frame.account.cashCents;
  const change = frame.final?.changeCents;
  const rank = rankFor(finalCents);
  const verdict = <div className={`summary-verdict ${layout === 'journey' ? 'summary-verdict-with-pup' : ''}`}><div className="summary-verdict-copy"><h1>{rank.title}</h1><p>{rank.blurb}</p></div>{layout === 'journey' && <RoboPup pose="receipt" />}</div>;
  const balance = <div className="summary-balance"><span className="summary-caption">{finalWords.finishedWith}</span>
    <div className="summary-total">{money(finalCents)}</div>
    {change !== undefined && <p className={tone(change)}>{change === 0 ? '$0' : signedMoney(change)} <span className="summary-caption">{change === 0 ? 'change overall' : 'overall'}</span></p>}
  </div>;
  const choices = <DayChoices frame={frame} selected={selected} onSelect={setSelected} layout={layout} />;
  const review = <Review frame={frame} selected={selected} />;

  return <main className="end-screen">
    <div key={layout} className={`summary-scene summary-${layout}`}>
      {(layout === 'receipt' || layout === 'scorecard') && <div className="summary-masthead"><strong>STRIKE DESK</strong><span>{finalWords.kicker}</span></div>}
      {layout === 'receipt' ? <div className="summary-receipt-body">
        <div className="summary-receipt-verdict">{verdict}{balance}
          {frame.days[0] && <div className="summary-starting"><span>Starting money</span><span>{money(frame.days[0].startCents)}</span></div>}
        </div>
        <div className="summary-receipt-ledger"><h2>{finalWords.daysHeading}</h2>{choices}{review}</div>
      </div> : <>
        <div className="summary-heading">{verdict}{balance}</div>
        {layout === 'journey' ? <div className="summary-journey-body">
          <BalanceJourney days={frame.days} selected={selected} />{choices}{review}
        </div> : <div className="summary-results">{choices}{review}</div>}
      </>}
      <LessonConveyor />
      <div className="summary-footer"><button className="summary-play" type="button" onClick={playAgain}>{finalWords.action}</button>
        {frame.final && <p>{finalWords.marketLabel} <strong>{frame.final.marketCode}</strong>.<br />{finalWords.marketHint}</p>}
      </div>
    </div>
  </main>;
}
