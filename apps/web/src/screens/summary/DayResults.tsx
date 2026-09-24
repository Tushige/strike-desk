import type { Frame } from '@strike-desk/shared/protocol';
import { signedMoney } from '../format';
import { DAYS, finalWords } from '../words';
import { DayReview } from '../ticket/DayReview';

export type SummaryStyle = 'journey' | 'receipt' | 'journal' | 'scorecard';
const compactMoney = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
export const tone = (amount: number) =>
  amount > 0 ? 'summary-profit' : amount < 0 ? 'summary-loss' : 'summary-flat';

export function DayChoices({
  frame,
  selected,
  onSelect,
  layout,
}: {
  frame: Frame;
  selected: number;
  onSelect: (day: number) => void;
  layout: SummaryStyle;
}) {
  const rows = layout === 'receipt' || layout === 'journal';
  return (
    <div
      className={`summary-days ${rows ? 'summary-day-rows' : 'summary-day-strip'}`}
      role="group"
      aria-label="Review your five days"
    >
      {Array.from({ length: DAYS }, (_, index) => {
        const day = index + 1;
        const result = frame.days.find((one) => one.day === day);
        const ticket = frame.positions.find((one) => one.day === day);
        const company = ticket === undefined ? undefined : frame.companies[ticket.companyId];
        const purchases = frame.positions.filter((one) => one.day === day).length;
        const label =
          purchases > 1
            ? `${String(purchases)} purchases`
            : ticket !== undefined
              ? `${company?.ticker ?? ''} ${ticket.side === 'up' ? 'UP' : 'DOWN'}`
              : result === undefined
                ? finalWords.notPlayed
                : finalWords.satOut;
        const amount =
          result === undefined
            ? '—'
            : result.changeCents === 0
              ? '$0'
              : signedMoney(result.changeCents);
        const compact =
          result === undefined
            ? '—'
            : result.changeCents === 0
              ? '$0'
              : `${result.changeCents < 0 ? '−' : '+'}$${compactMoney.format(Math.abs(result.changeCents) / 100)}`;
        return (
          <button
            key={day}
            type="button"
            className="summary-day"
            aria-pressed={selected === day}
            aria-label={`Review day ${String(day)}, ${label}, ${amount}`}
            title={`Day ${String(day)} · ${label} · ${amount}`}
            style={{
              animationDelay: `${String((layout === 'journey' ? 600 : 180) + index * 45)}ms`,
            }}
            onClick={() => {
              onSelect(day);
            }}
          >
            <span>Day {day}</span>
            {rows && <span className="summary-company">{label}</span>}
            <span
              className={`summary-day-amount ${tone(result?.changeCents ?? 0)}`}
              aria-hidden="true"
            >
              {rows ? amount : compact}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function SummaryReview({ frame, selected }: { frame: Frame; selected: number }) {
  return (
    <div className="summary-review-panels">
      {Array.from({ length: DAYS }, (_, i) => i + 1).map((day) => (
        <div
          key={day}
          className={selected === day ? 'summary-review-active' : 'summary-review-inactive'}
          aria-hidden={selected !== day}
          inert={selected !== day}
        >
          <DayReview frame={frame} day={day} />
        </div>
      ))}
    </div>
  );
}
