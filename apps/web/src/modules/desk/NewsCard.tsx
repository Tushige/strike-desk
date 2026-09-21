import { memo } from 'react';
import type { Side } from '@strike-desk/shared/protocol';
import { CompanyMark } from './CompanyMark';
import type { NewsCardProps } from './ports';
import { newsWords } from './words';

/**
 * One headline: whose it is, who is saying it, how far to trust it, what it
 * says and which way it claims the price will go. Pressing the title selects
 * the company; the press reaches across the whole card.
 *
 * What the card must never do is give the ending away. Its direction is the
 * headline's claim, coloured as a claim the same way before and after the
 * news lands. Once the news is out the card says exactly that and nothing
 * else. It says how the claim turned out only when it is handed an outcome,
 * in one plain line that wears no direction colour; without that prop a card
 * that is out differs from one that is not by its one mark.
 */

const TRUST_LEVELS = [1, 2, 3] as const;

const CLAIM_LOOK: Record<Side, { readonly colour: string; readonly shape: string }> = {
  up: { colour: 'text-up', shape: 'M5 1.5 9 8.5H1z' },
  down: { colour: 'text-down', shape: 'M1 1.5h8L5 8.5z' },
};

const BASE =
  'relative grid min-w-0 content-start gap-1.5 rounded-md border px-3.5 py-3 transition-colors motion-reduce:transition-none hover:bg-accent';
const SELECTED = 'border-ring bg-accent';
const NOT_SELECTED = 'border-border bg-card';

/*
 * The button is the title, so its name is the headline. Its `after` box is
 * stretched over the card, which makes the whole card the target and gives
 * the focus ring the card's outline rather than the title's.
 */
const TITLE_BUTTON =
  'touch-manipulation text-left text-base leading-snug font-medium text-pretty focus-visible:outline-hidden ' +
  'after:absolute after:inset-0 after:rounded-md ' +
  'focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring';

export const NewsCard = memo(function NewsCard({
  companyId,
  companyName,
  ticker,
  trust,
  source,
  title,
  body,
  direction,
  revealed,
  outcome,
  selected,
  onSelect,
}: NewsCardProps) {
  const claim = CLAIM_LOOK[direction];

  return (
    <article className={`${BASE} ${selected ? SELECTED : NOT_SELECTED}`}>
      <header className="flex min-w-0 items-center gap-2">
        <CompanyMark companyId={companyId} ticker={ticker} size="sm" />
        <span className="truncate text-sm" translate="no">
          {companyName}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs">
          <span className="flex gap-0.5" aria-hidden="true">
            {TRUST_LEVELS.map((level) => (
              <span
                key={level}
                data-filled={level <= trust}
                className={`size-2 rounded-full border ${level <= trust ? 'border-gold bg-gold' : 'border-muted-foreground'}`}
              />
            ))}
          </span>
          <span className="sr-only">{newsWords.trustDots(trust)}</span>
          <span>{newsWords.trust(trust)}</span>
        </span>
      </header>

      <p className="m-0 text-xs text-muted-foreground">{source}</p>
      <h3 className="m-0">
        <button type="button" aria-pressed={selected} onClick={onSelect} className={TITLE_BUTTON}>
          {title}
        </button>
      </h3>
      <p className="m-0 text-sm text-muted-foreground">{body}</p>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className={`inline-flex items-center gap-1.5 ${claim.colour}`}>
          <svg className="size-2.5" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" focusable="false">
            <path d={claim.shape} />
          </svg>
          {newsWords.claim(direction)}
        </span>
        {revealed ? (
          <span data-news-out="true" className="ml-auto rounded-sm border border-border px-1.5 text-xs leading-5">
            {newsWords.newsOut}
          </span>
        ) : null}
      </footer>

      {outcome === undefined ? null : (
        <p data-outcome={outcome} className="m-0 border-t border-border pt-1.5 text-sm">
          {outcome === 'true' ? newsWords.outcomeTrue : newsWords.outcomeFalse}
        </p>
      )}
    </article>
  );
});
