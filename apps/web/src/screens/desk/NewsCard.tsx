import type { NewsView } from '@strike-desk/shared/protocol';
import { usePrice, useSeries } from '../../store/hooks';
import { percentChange, price } from '../format';
import { ChoiceButton, CompanyTile, cx } from '../ui';
import { TRUST_NAMES } from '../words';

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
function PriceAndChange({ companyId, picking, compact }: { companyId: number; picking: boolean; compact?: boolean }) {
  const now = usePrice(companyId);
  const series = useSeries(companyId);
  const from = picking ? series.leadIn[0] : series.today[0];
  const change = now !== null && from !== undefined ? percentChange(from, now) : null;
  const up = change === null || !change.startsWith('−');
  return (
    <span className={cx('flex shrink-0 flex-col items-end gap-0.5 whitespace-nowrap tabular-nums', compact && 'gap-0')}>
      <span className={cx('font-bold', compact ? 'text-[14px]' : 'text-[17px]')}>{now === null ? '—' : price(now)}</span>
      <span className={cx('text-[12px] font-semibold', up ? 'text-mint' : 'text-coral')}>
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
  news: NewsView;
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
        'flex w-full flex-col gap-1.5 rounded-[20px] border-2 p-3 text-left text-cloud lg:flex-auto',
        selected ? 'border-sun bg-raised' : 'border-line bg-panel',
      )}
    >
      <span className="flex items-center gap-2.5">
        <CompanyTile companyId={companyId} />
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="truncate text-[16px] font-bold leading-tight">{name}</span>
          <span className={cx('truncate text-[12px] leading-tight', mine ? 'text-sun' : 'text-muted')}>{mine ? 'Your ticket is here' : `makes ${product}`}</span>
        </span>
        <PriceAndChange companyId={companyId} picking={picking} />
      </span>
      <span className="block text-[13.5px] leading-snug font-semibold">{news.title}</span>
      <span className={cx('block text-[13px] leading-snug text-muted', selected ? '' : 'tall:block hidden')}>{news.body}</span>
      <span className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
        <TrustDots level={news.trust} />
        <span className="text-[12px] text-muted">{news.source}</span>
      </span>
    </ChoiceButton>
  );
}

function QuietPrice({ companyId }: { companyId: number }) {
  const now = usePrice(companyId);
  return <span className="text-[12px] leading-tight text-muted tabular-nums">{now === null ? '—' : price(now)}</span>;
}

/** The companies with no headline today: one small chip each, still tradable. */
export function QuietCompany({
  companyId,
  ticker,
  selected,
  mine,
  onSelect,
}: {
  companyId: number;
  ticker: string;
  selected: boolean;
  mine: boolean;
  onSelect: () => void;
}) {
  return (
    <ChoiceButton
      selected={selected}
      onClick={onSelect}
      className={cx(
        'flex min-w-0 items-center gap-2 rounded-2xl border-2 px-2 py-1.5 text-left text-cloud',
        selected ? 'border-sun bg-raised' : 'border-line bg-panel',
      )}
    >
      <CompanyTile companyId={companyId} size="sm" />
      <span className="flex min-w-0 grow flex-col">
        <span className={cx('text-[13px] font-bold leading-tight', mine && 'text-sun')}>{ticker}</span>
        <QuietPrice companyId={companyId} />
      </span>
    </ChoiceButton>
  );
}
