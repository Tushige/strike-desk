import { Children, memo } from 'react';
import type { CompanyStripProps } from './ports';

/**
 * The row of company chips: a list with a name, one chip to an item. It lays
 * out and nothing more. It holds no price and subscribes to nothing, so a new
 * price never redraws it: each chip the page hands in looks after its own.
 */
export const CompanyStrip = memo(function CompanyStrip({ label, children }: CompanyStripProps) {
  return (
    <ul aria-label={label} className="m-0 grid list-none grid-cols-6 gap-2 p-0 max-sm:grid-cols-3">
      {Children.map(children, (child) => (
        <li className="min-w-0">{child}</li>
      ))}
    </ul>
  );
});
