import type { NewsView } from '@strike-desk/shared/protocol';
import { usePrice, useSeries } from '../../store/hooks';
import { percentChange, price } from '../format';
import { ChoiceButton, CompanyTile, cx } from '../ui';
import { TRUST_NAMES } from '../words';
import { CompanyTrend } from './CompanyTrend';

/**
 * One company's card in the news column: who it is, its price and how it
 * moved, today's headline and how much to trust it. Tapping a card selects
 * the company for the chart and the ticket.
 *
 * Before the bell the price stands still, so the card shows it without a
 * change; from the opening bell on the change is against the opening price.
 */

function TrustDots({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex gap-1" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={cx('size-2.5 rounded-full', n <= level ? 'bg-sun' : 'bg-line')} />
        ))}
      </span>
      <span className="text-[13px] font-semibold">
        <span className="sr-only">Trust {level} of 3: </span>
        {TRUST_NAMES[level]}
      </span>
    </span>
  );
}

/** A company's price and its change so far, read from the store. */
function PriceAndChange({ companyId, picking }: { companyId: number; picking: boolean }) {
  const now = usePrice(companyId);
  const series = useSeries(companyId);
  const from = picking ? series.leadIn[0] : series.today[0];
  const change = now !== null && from !== undefined ? percentChange(from, now) : null;
  const up = change === null || !change.startsWith('−');
  return (
    <span className="grid grid-cols-2 items-baseline gap-2 whitespace-nowrap tabular-nums">
      <span className="text-[17px] font-bold">{now === null ? '—' : price(now)}</span>
      <span className={cx('text-right text-[12px] font-semibold', up ? 'text-mint' : 'text-coral')}>
        {change === null ? '' : `${change} ${picking ? 'yesterday' : 'today'}`}
      </span>
    </span>
  );
}

export function NewsCard({
  news,
  companyId,
  name,
  product,
  selected,
  mine,
  picking,
  onSelect,
}: {
  news: NewsView | null;
  companyId: number;
  name: string;
  product: string;
  selected: boolean;
  /** The player's ticket today is on this company. */
  mine: boolean;
  picking: boolean;
  onSelect: () => void;
}) {
  return (
    <ChoiceButton
      selected={selected}
      onClick={onSelect}
      className={cx(
        'flex w-full shrink-0 flex-col gap-1.5 rounded-[20px] border-2 p-3 text-left text-cloud',
        selected ? 'border-sun bg-raised' : 'border-line bg-panel',
      )}
    >
      <span className="flex items-center gap-2.5">
        <CompanyTile companyId={companyId} />
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="text-[15px] font-bold leading-tight">{name}</span>
          <span className={cx('text-[12px] leading-tight', mine ? 'text-sun' : 'text-muted')}>{mine ? 'Your ticket is here' : product === '' ? '' : `makes ${product}`}</span>
        </span>
      </span>
      <PriceAndChange companyId={companyId} picking={picking} />
      {news === null ? <span className="text-[13px] leading-snug text-muted">No news today. Still tradable.</span> : <>
        <span className="block text-[13.5px] leading-snug font-semibold">{news.title}</span>
        {news.wasTrue !== undefined && <span className="text-xs font-semibold text-sun">{news.wasTrue ? 'The claimed direction happened.' : 'The event reversed the claim.'}</span>}
        <span className={cx('block text-[13px] leading-snug text-muted', selected ? '' : 'tall:block hidden')}>{news.body}</span>
      </>}
      <span className="mt-auto flex items-end gap-3 pt-1">
        {news !== null && <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <TrustDots level={news.trust} />
          <span className="text-[12px] text-muted">{news.source}</span>
        </span>}
        <CompanyTrend companyId={companyId} picking={picking} />
      </span>
    </ChoiceButton>
  );
}
