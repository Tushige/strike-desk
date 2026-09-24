import { memo } from 'react';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { formatCents } from '@strike-desk/shared/money';
import type { ContractRow } from '../store/contractRows';

/**
 * One part of a ticket's price — its real value or its hope value — or a dash
 * while the ticket is too cheap to trade.
 *
 * The dash is the same mark the price cell shows, so a row nobody can buy
 * reads as three dashes rather than as three numbers that would invite a
 * trade. Nothing on screen explains it: the dimmed row says enough. Only the
 * price's dash carries a reason for a screen reader; saying it three times on
 * one row would be noise, so these two are hidden from it instead.
 */
export const ValueCell = memo(function ValueCell({
  value,
}: CustomCellRendererProps<ContractRow, number | null>) {
  return value == null ? <span aria-hidden="true">—</span> : <>{formatCents(value)}</>;
});
