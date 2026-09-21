import { memo } from 'react';
import type { ReactNode } from 'react';
import type { CompanyMarkProps } from './ports';

/**
 * A company's mark: a small tile washed with the company's own tint, holding
 * a glyph drawn in that tint, with the ticker beside it (small) or under it
 * (medium).
 *
 * A tint says which company, never which way a price went: the up, down and
 * gold colours are not tile colours, here or anywhere.
 */

interface MarkLook {
  /** The tile's wash, its border and the glyph's colour. */
  readonly tile: string;
  /** Drawn on a 24 by 24 grid, in the tile's text colour. */
  readonly glyph: ReactNode;
}

/*
 * Every class name below is written out in full, on purpose. The utility
 * engine finds class names by reading the source as text, so a name put
 * together while the page runs (a prefix plus a company's number) would
 * never be found, and the tile would come out unstyled.
 */
const MARKS = [
  {
    // Robot pets: a square head, two antennae, two eyes.
    tile: 'bg-company-0/15 border-company-0/30 text-company-0',
    glyph: (
      <>
        <rect x="5" y="8" width="14" height="11" rx="3" />
        <path d="M9 8V4.5M15 8V4.5M10 16h4" />
        <circle cx="9.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    // Fizzy drinks: a cup, a straw, two bubbles.
    tile: 'bg-company-1/15 border-company-1/30 text-company-1',
    glyph: (
      <>
        <path d="M6.5 9h11l-1.3 11H7.8zM13 9l2.5-5.5" />
        <circle cx="8.5" cy="5" r="1.2" />
        <circle cx="11.5" cy="14" r="1" />
      </>
    ),
  },
  {
    // Jet sneakers: a shoe, its sole, two lines of speed behind it.
    tile: 'bg-company-2/15 border-company-2/30 text-company-2',
    glyph: (
      <>
        <path d="M6 16.5V10l3.5-.5 2.5 3.5 7 1.5c1.5.3 2.5 1 2.5 2z" />
        <path d="M6 19.5h15.5M1.5 11.5h2.5M2.5 15h1.5" />
      </>
    ),
  },
  {
    // Space snacks: a crescent moon and two crumbs.
    tile: 'bg-company-3/15 border-company-3/30 text-company-3',
    glyph: (
      <>
        <path d="M14 3.5a8.5 8.5 0 1 0 6.5 12.5A7 7 0 0 1 14 3.5z" />
        <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="20" cy="10" r="0.7" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    // Video games: a small creature made of squares.
    tile: 'bg-company-4/15 border-company-4/30 text-company-4',
    glyph: (
      <g fill="currentColor" stroke="none">
        <rect x="7" y="4" width="2" height="2" />
        <rect x="15" y="4" width="2" height="2" />
        <rect x="6" y="6" width="12" height="2" />
        <rect x="4" y="8" width="4" height="3" />
        <rect x="10" y="8" width="4" height="3" />
        <rect x="16" y="8" width="4" height="3" />
        <rect x="4" y="11" width="16" height="4" />
        <rect x="6" y="15" width="3" height="2" />
        <rect x="15" y="15" width="3" height="2" />
        <rect x="4" y="17" width="3" height="2" />
        <rect x="17" y="17" width="3" height="2" />
      </g>
    ),
  },
  {
    // Super batteries: a battery, its cap, two bars of charge.
    tile: 'bg-company-5/15 border-company-5/30 text-company-5',
    glyph: (
      <>
        <rect x="3" y="7.5" width="16" height="9" rx="2" />
        <path d="M21.5 10.5v3" />
        <rect x="6" y="10" width="2.5" height="4" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="10" y="10" width="2.5" height="4" rx="0.5" fill="currentColor" stroke="none" />
      </>
    ),
  },
] as const satisfies readonly MarkLook[];

const SIZES = {
  sm: { root: 'inline-flex items-center gap-1.5', tile: 'size-6 rounded-sm', glyph: 'size-3.5' },
  md: { root: 'inline-flex flex-col items-center gap-1', tile: 'size-9 rounded-md', glyph: 'size-5' },
} as const;

export const CompanyMark = memo(function CompanyMark({ companyId, ticker, size }: CompanyMarkProps) {
  // An id this table does not know gets the first company's look rather than
  // an empty tile or an error.
  const look: MarkLook = MARKS[companyId] ?? MARKS[0];
  const sized = SIZES[size];

  return (
    <span className={sized.root}>
      <span className={`grid shrink-0 place-items-center border ${sized.tile} ${look.tile}`}>
        <svg
          className={sized.glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          {look.glyph}
        </svg>
      </span>
      <span className="text-xs leading-none tracking-wider text-muted-foreground" translate="no">
        {ticker}
      </span>
    </span>
  );
});
