import { memo } from 'react';
import { formatCents } from '@strike-desk/shared/money';
import { CompanyMark } from './CompanyMark';
import type { CompanyChipProps, Trend } from './ports';
import { chipWords } from './words';

/**
 * One company, as a button: its mark, its name, its share price, which way
 * the price has gone today, and whether it is in today's news. Pressing it
 * selects the company.
 *
 * The trend is a direction, so this is where the up and down colours belong.
 * It is also said in words for a screen reader, and drawn as a shape, so it
 * never rests on colour alone. No percentage and no change amount is shown:
 * the server sends neither, and the page does not work money out.
 */

const TREND_LOOK: Record<Trend, { readonly colour: string; readonly shape: string }> = {
  up: { colour: 'text-up', shape: 'M5 1.5 9 8.5H1z' },
  down: { colour: 'text-down', shape: 'M1 1.5h8L5 8.5z' },
  flat: { colour: 'text-muted-foreground', shape: 'M1.5 4.25h7v1.5h-7z' },
};

const BASE =
  'grid w-full min-w-0 touch-manipulation grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-md border px-3 py-2 text-left ' +
  'transition-colors motion-reduce:transition-none hover:bg-accent ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const SELECTED = 'border-ring bg-accent';
const NOT_SELECTED = 'border-border bg-card';

export const CompanyChip = memo(function CompanyChip({
  companyId,
  ticker,
  name,
  priceCents,
  trend,
  hasNews,
  selected,
  onSelect,
}: CompanyChipProps) {
  const look = TREND_LOOK[trend];

  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={`${BASE} ${selected ? SELECTED : NOT_SELECTED}`}>
      <CompanyMark companyId={companyId} ticker={ticker} size="md" />
      <span className="grid min-w-0 gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm" translate="no">
            {name}
          </span>
          {hasNews ? (
            <span className="ml-auto shrink-0 rounded-sm border border-gold/40 px-1 text-xs leading-4 text-gold">{chipWords.news}</span>
          ) : null}
        </span>
        <span className="flex items-center gap-1.5">
          {priceCents === null ? (
            <span className="text-sm text-muted-foreground">{chipWords.noPrice}</span>
          ) : (
            <span className="text-base font-medium tabular-nums">{formatCents(priceCents)}</span>
          )}
          <span className={`inline-flex items-center ${look.colour}`}>
            <svg className="size-2.5" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" focusable="false">
              <path d={look.shape} />
            </svg>
            <span className="sr-only">{chipWords.trend(trend)}</span>
          </span>
        </span>
      </span>
    </button>
  );
});
