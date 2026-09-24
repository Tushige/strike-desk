import { usePrice, useSeries } from '../../store/hooks';
import { percentChange, price } from '../format';
import { ChoiceButton, CompanyTile, cx } from '../ui';

/** Company navigation stays independent of whether a company has news. */
export function MarketCompany({
  companyId,
  name,
  ticker,
  selected,
  mine,
  picking,
  disabled,
  onSelect,
}: {
  companyId: number;
  name: string;
  ticker: string;
  selected: boolean;
  mine: boolean;
  picking: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const now = usePrice(companyId);
  const series = useSeries(companyId);
  const from = picking ? series.leadIn[0] : series.today[0];
  const change = now !== null && from !== undefined ? percentChange(from, now) : null;
  return (
    <ChoiceButton
      selected={selected}
      disabled={disabled}
      dimWhenDisabled={false}
      onClick={onSelect}
      className="market-company"
      aria-label={`${name}, ${now === null ? 'waiting for price' : price(now)}${mine ? ', your ticket' : ''}`}
    >
      <CompanyTile companyId={companyId} />
      <span className="market-company-name">
        <strong>{name}</strong>
        <span>
          {ticker}
          {mine ? ' · Yours' : ''}
        </span>
      </span>
      <span className="market-company-values">
        <strong className="tabular-nums">{now === null ? '—' : price(now)}</strong>
        <span className={cx('tabular-nums', change?.startsWith('−') ? 'text-coral' : 'text-mint')}>
          {change ?? '—'}
          <span className="sr-only"> {picking ? 'yesterday' : 'today'}</span>
        </span>
      </span>
    </ChoiceButton>
  );
}
