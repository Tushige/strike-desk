import { memo } from 'react';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { formatCents } from '@strike-desk/shared/money';
import type { ContractRow } from '../store/contractRows';

/**
 * A ticket's price, or a dash while the ticket is too cheap to trade.
 *
 * The dash is never `$0`, and nothing on screen explains it: the dimmed row
 * says enough. A screen reader cannot see dimming, so the dash carries the
 * reason as its name instead of being read out as nothing.
 */
export const PriceCell = memo(function PriceCell({ value }: CustomCellRendererProps<ContractRow, number | null>) {
  if (value == null) {
    return (
      <span role="img" aria-label="too cheap to trade">
        —
      </span>
    );
  }
  return <>{formatCents(value)}</>;
});
