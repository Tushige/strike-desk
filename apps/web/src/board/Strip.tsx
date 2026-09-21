import { memo } from 'react';
import { formatCents } from '@strike-desk/shared/money';
import type { CompanyView } from '@strike-desk/shared/protocol';
import { useCompanies, usePrice } from '../store/hooks';
import { CompanyMark } from '../modules/desk/index';

/**
 * The six companies and their share prices, one card each, in one row above
 * the table. Each card subscribes to its own price, so a new price redraws
 * one card's number and nothing else. The strip itself subscribes only to
 * the names, which arrive once and then stay still.
 */

/** Shown until the first price arrives. */
const NO_PRICE = '—';

const CompanyCard = memo(function CompanyCard({ companyId, company }: { companyId: number; company: CompanyView }) {
  const price = usePrice(companyId);
  return (
    <li className="strip-card">
      <span className="strip-name">
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span className="w-full truncate">{company.name}</span>
          <CompanyMark companyId={companyId} ticker={company.ticker} size="sm" />
        </span>
      </span>
      <span className="strip-price">{price === null ? NO_PRICE : formatCents(price)}</span>
    </li>
  );
});

export const Strip = memo(function Strip() {
  const companies = useCompanies();
  return (
    <ul className="strip" role="list">
      {companies.map((company, companyId) => (
        <CompanyCard key={companyId} companyId={companyId} company={company} />
      ))}
    </ul>
  );
});
