import { useSeries } from '../../store/hooks';
import { cx } from '../ui';

/** A small, axis-free trend from observed prices; no projected points. */
export function CompanyTrend({ companyId, picking }: { companyId: number; picking: boolean }) {
  const series = useSeries(companyId);
  const values = picking ? [...series.leadIn, ...series.today.slice(0, 1)] : series.today;
  const first = values[0];
  const last = values.at(-1);
  const direction =
    first === undefined || last === undefined
      ? null
      : last > first
        ? 'rising'
        : last < first
          ? 'falling'
          : 'flat';
  let low = first ?? 0;
  let high = low;
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const y = (value: number) => (high === low ? 20 : 4 + ((high - value) / (high - low)) * 32);
  const points = values
    .map(
      (value, index) =>
        `${(4 + (index / Math.max(1, values.length - 1)) * 104).toFixed(1)},${y(value).toFixed(1)}`,
    )
    .join(' ');
  const label =
    direction === null
      ? 'Price history not available yet'
      : `Observed price trend ${picking ? 'before opening' : 'today'}: ${direction}`;

  return (
    <svg
      viewBox="0 0 112 40"
      role="img"
      aria-label={label}
      className={cx(
        'ml-auto block h-10 w-28 shrink-0',
        direction === 'rising'
          ? 'text-mint'
          : direction === 'falling'
            ? 'text-coral'
            : 'text-muted',
      )}
    >
      <title>{label}</title>
      {values.length > 1 && (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {values.length === 1 && first !== undefined && (
        <circle cx="4" cy={y(first)} r="2" fill="currentColor" />
      )}
    </svg>
  );
}
