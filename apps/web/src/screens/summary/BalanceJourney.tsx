import type { CSSProperties } from 'react';
import type { DayResult } from '@strike-desk/shared/protocol';
import { money } from '../format';

interface BalancePoint { day: number; cents: number; start: boolean }

/** Use recorded balances, not reconstructed profits. Missing days break the trace. */
export function balancePoints(days: readonly DayResult[]): BalancePoint[] {
  const points: BalancePoint[] = [];
  let previousDay = -1;
  for (const day of [...days].sort((a, b) => a.day - b.day)) {
    if (day.day !== previousDay + 1) points.push({ day: day.day - 1, cents: day.startCents, start: true });
    points.push({ day: day.day, cents: day.endCents, start: false });
    previousDay = day.day;
  }
  return points;
}

export function BalanceJourney({ days, selected }: { days: readonly DayResult[]; selected: number }) {
  const points = balancePoints(days);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return <p className="summary-chart-empty">Daily balance records are not available for this run.</p>;
  const low = Math.min(...points.map(point => point.cents));
  const high = Math.max(...points.map(point => point.cents));
  const padding = Math.max(1, (high - low) * .15);
  const x = (day: number) => day === 0 ? 1 : (day - .5) * 20;
  const y = (cents: number) => 88 - (cents - low + padding) / (high - low + padding * 2) * 76;
  const path = points.map(point => `${point.start ? 'M' : 'L'}${String(x(point.day) * 10)},${String(y(point.cents) * 2)}`).join(' ');
  const startLabel = first.day === 0 ? 'Start' : `Before day ${String(first.day + 1)}`;
  return <div className="summary-chart">
    <div className="summary-chart-caption"><span>{startLabel} {money(first.cents)}</span><span>End of day {last.day} · {money(last.cents)}</span></div>
    <div className="summary-plot" role="img" aria-label={`Recorded balance: ${points.map(point => `${point.start ? point.day === 0 ? 'Start' : `Before day ${String(point.day + 1)}` : `Day ${String(point.day)}`}, ${money(point.cents)}`).join('; ')}`}>
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
        <line className="summary-chart-baseline" x1="10" x2="990" y1={y(first.cents) * 2} y2={y(first.cents) * 2} vectorEffect="non-scaling-stroke" />
        <path className="summary-chart-trace" d={path} vectorEffect="non-scaling-stroke" />
      </svg>
      {points.map((point, index) => <span key={`${String(point.day)}:${String(index)}`} aria-hidden="true"
        className={`summary-chart-point ${!point.start && point.day === selected ? 'is-selected' : ''}`}
        style={{ left: `${String(x(point.day))}%`, top: `${String(y(point.cents))}%`, '--point-delay': `${String(180 + index / Math.max(1, points.length - 1) * 950)}ms` } as CSSProperties} />)}
    </div>
  </div>;
}
