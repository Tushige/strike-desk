import type { Frame } from '@strike-desk/shared/protocol';
import { money, price, signedMoney } from '../format';

/** Historical review uses only authoritative position/day records, never current-day news or paths. */
export function DayReview({ frame, day }: { frame: Frame; day: number }) {
  const position = frame.positions.find((p) => p.day === day);
  const result = frame.days.find((d) => d.day === day);
  return <section aria-label={`Day ${String(day)} review`} className="border-t border-line pt-4 text-sm" aria-live="polite">
    <h3 className="m-0 mb-3 font-bold">Day {day} · {position === undefined ? 'No trade' : `${frame.companies[position.companyId]?.name ?? ''} ${position.side === 'up' ? 'UP / call' : 'DOWN / put'}`}</h3>
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
