import { useState } from 'react';
import type { Frame } from '@strike-desk/shared/protocol';
import { playAgain } from '../boot';
import { useScreenFrame } from '../store/hooks';
import { money, signedMoney } from './format';
import { finalWords, rankFor } from './words';
import { DayChoices, SummaryReview, tone } from './summary/DayResults';
import type { SummaryStyle } from './summary/DayResults';
import { BalanceJourney } from './summary/BalanceJourney';
import { RoboPup } from './mascot/RoboPup';
import { LessonConveyor } from './summary/LessonConveyor';
import './summary/summary.css';

export function FinalScreen() {
  const frame = useScreenFrame('review');
  return <SummaryComposition frame={frame} layout="journey" />;
}

export function SummaryComposition({ frame, layout }: { frame: Frame; layout: SummaryStyle }) {
  const [selected, setSelected] = useState(frame.positions[0]?.day ?? frame.days[0]?.day ?? 1);
  const finalCents = frame.final?.finalCents ?? frame.account.cashCents;
  const change = frame.final?.changeCents;
  const rank = rankFor(finalCents);
  const verdict = (
    <div className={`summary-verdict ${layout === 'journey' ? 'summary-verdict-with-pup' : ''}`}>
      <div className="summary-verdict-copy">
        <h1>{rank.title}</h1>
        <p>{rank.blurb}</p>
      </div>
      {layout === 'journey' && <RoboPup pose="receipt" />}
    </div>
  );
  const balance = (
    <div className="summary-balance">
      <span className="summary-caption">{finalWords.finishedWith}</span>
      <div className="summary-total">{money(finalCents)}</div>
      {change !== undefined && (
        <p className={tone(change)}>
          {change === 0 ? '$0' : signedMoney(change)}{' '}
          <span className="summary-caption">{change === 0 ? 'change overall' : 'overall'}</span>
        </p>
      )}
    </div>
  );
  const choices = (
    <DayChoices frame={frame} selected={selected} onSelect={setSelected} layout={layout} />
  );
  const review = <SummaryReview frame={frame} selected={selected} />;

  return (
    <main className="end-screen">
      <div key={layout} className={`summary-scene summary-${layout}`}>
        {(layout === 'receipt' || layout === 'scorecard') && (
          <div className="summary-masthead">
            <strong>STRIKE DESK</strong>
            <span>{finalWords.kicker}</span>
          </div>
        )}
        {layout === 'receipt' ? (
          <div className="summary-receipt-body">
            <div className="summary-receipt-verdict">
              {verdict}
              {balance}
              {frame.days[0] && (
                <div className="summary-starting">
                  <span>Starting money</span>
                  <span>{money(frame.days[0].startCents)}</span>
                </div>
              )}
            </div>
            <div className="summary-receipt-ledger">
              <h2>{finalWords.daysHeading}</h2>
              {choices}
              {review}
            </div>
          </div>
        ) : (
          <>
            <div className="summary-heading">
              {verdict}
              {balance}
            </div>
            {layout === 'journey' ? (
              <div className="summary-journey-body">
                <BalanceJourney days={frame.days} selected={selected} />
                {choices}
                {review}
              </div>
            ) : (
              <div className="summary-results">
                {choices}
                {review}
              </div>
            )}
          </>
        )}
        <LessonConveyor />
        <div className="summary-footer">
          <button className="summary-play" type="button" onClick={playAgain}>
            {finalWords.action}
          </button>
          {frame.final && (
            <p>
              {finalWords.marketLabel} <strong>{frame.final.marketCode}</strong>.<br />
              {finalWords.marketHint}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
