import { useCompanies } from '../../../store/hooks';
import { SkeletonBlock } from '../../LoadingSkeleton';
import { CompanyTile } from '../../ui';
import { useCompanyEntrance } from './useCompanyEntrance';
import './companies.css';

export function CompanyRoster() {
  const companies = useCompanies();
  const list = useCompanyEntrance(companies.length > 0);
  return (
    <section
      className="page-width scroll-mt-6 border-b border-landing-line py-8 md:pt-10 md:pb-11"
      id="meet-the-market"
      aria-labelledby="companies-title"
    >
      <h2 id="companies-title" className="mb-6 text-xs font-medium md:text-sm">
        Fictional companies. <span className="text-landing-muted">Real decisions.</span>
      </h2>
      <div className="min-h-38 md:min-h-24 wide:min-h-9">
        {companies.length > 0 ? (
          <ul
            ref={list}
            className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 md:gap-6 wide:grid-cols-6 wide:gap-5"
          >
            {companies.map((company, index) => (
              <li
                key={company.ticker}
                className="flex min-w-0 items-center gap-2 md:gap-3 [&>span]:size-9 [&>span]:rounded [&_svg]:size-6"
              >
                <CompanyTile companyId={index} size="md" />
                <div>
                  <h3 data-company-title className="mb-1 text-xs font-medium md:text-sm">
                    {company.name}
                  </h3>
                  <p data-company-subtitle className="text-2xs text-landing-muted">
                    {company.product}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="company-skeleton" role="status" aria-label="Loading companies">
            <span className="sr-only">Loading companies…</span>
            <ul
              className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 md:gap-6 wide:grid-cols-6 wide:gap-5"
              aria-hidden="true"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <li className="flex items-center gap-2 md:gap-3" key={index}>
                  <SkeletonBlock className="loading-company-icon" />
                  <div className="flex flex-1 flex-col gap-2">
                    <SkeletonBlock className="loading-company-title w-3/4 max-w-22" />
                    <SkeletonBlock className="w-9/10 max-w-26" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
