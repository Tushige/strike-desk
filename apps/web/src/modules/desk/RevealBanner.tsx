import { memo } from 'react';
import type { RevealBannerProps } from './ports';
import { bannerWords } from './words';

/**
 * The banner that goes up when a headline's news lands in the price. It
 * names the company and stops there: it is handed a name and nothing else, so
 * it cannot say whether the news was true. The price says enough.
 *
 * The region is always on the page, empty or not. A screen reader announces
 * what arrives inside a live region it already knows about; one that appears
 * together with its words may be missed. How long the banner stays up is the
 * game's business: it shows whenever it is handed a name.
 *
 * The words slide in over a fifth of a second, and not at all for someone who
 * asked for less motion.
 */
export const RevealBanner = memo(function RevealBanner({ companyName }: RevealBannerProps) {
  return (
    <div role="status" aria-live="polite">
      {companyName === null ? null : (
        <p
          className={
            'm-0 flex flex-wrap items-baseline gap-x-3 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 ' +
            'transition-[opacity,translate] duration-200 starting:-translate-y-1 starting:opacity-0 motion-reduce:transition-none'
          }
        >
          <strong className="text-base font-medium text-gold">{bannerWords.title}</strong>
          <span className="text-sm">{bannerWords.body(companyName)}</span>
        </p>
      )}
    </div>
  );
});
