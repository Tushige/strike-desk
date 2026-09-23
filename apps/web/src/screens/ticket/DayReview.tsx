import type { Frame } from '@strike-desk/shared/protocol';
import { money, price, signedMoney } from '../format';
import { NewsUpdate } from '../desk/NewsUpdate';
import { tradeStoryFor } from './lesson';

/** Historical review uses only authoritative position/day records, never current-day news or paths. */
export function DayReview({ frame, day }: { frame: Frame; day: number }) {
  const position = frame.positions.find((p) => p.day === day);
  const result = frame.days.find((d) => d.day === day);
  const review = result?.review;
  return <section aria-label={`Day ${String(day)} review`} className="border-t border-line pt-4 text-sm" aria-live="polite">
    <h3 className="m-0 mb-3 font-bold">Day {day} · {position === undefined ? 'No trade' : `${frame.companies[position.companyId]?.name ?? ''} ${position.side === 'up' ? 'UP / call' : 'DOWN / put'}`}</h3>
    {position && review && <div className="day-review-story">
      {review.news && <><p className="day-review-headline">Earlier: {review.news.title}</p><NewsUpdate news={review.news} /></>}
      <p>{tradeStoryFor(position, review.news ?? null, review.openingCents, review.closingCents)}</p>
      <p className="news-update-prices">Open {price(review.openingCents)} · Close {price(review.closingCents)}</p>
    </div>}
    {position === undefined ? <p className="m-0 text-muted">{result === undefined ? 'Not played.' : 'You sat out. Trading result: $0.'}</p> : <dl className="review-values">
      <dt>Target</dt><dd>{price(position.targetCents)}</dd>
      <dt>Cost / max loss</dt><dd>{money(position.costCents)}</dd>
      <dt>Money returned</dt><dd>{money(position.exit?.proceedsCents ?? position.valueCents)}</dd>
      <dt>Profit / loss</dt><dd className={position.profitCents < 0 ? 'text-coral' : 'text-mint'}>{signedMoney(position.profitCents)}</dd>
      <dt>Exit</dt><dd>{position.status === 'cashedOut' ? 'Cashed out during trading' : 'Settled at the bell'}</dd>
      {position.ifHeldCents !== undefined && <><dt>Holding to the bell</dt><dd>{money(position.ifHeldCents)}</dd></>}
    </dl>}
  </section>;
}
