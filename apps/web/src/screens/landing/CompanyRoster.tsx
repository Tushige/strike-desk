import { useCompanies } from '../../store/hooks';
import { CompanyRosterSkeleton } from '../LoadingSkeleton';
import { CompanyTile } from '../ui';

export function CompanyRoster() {
  const companies = useCompanies();
  return (
    <section
      className="page-width scroll-mt-6 border-b border-landing-line py-8 md:pt-10 md:pb-11"
      id="meet-the-market"
      aria-labelledby="companies-title"
    >
      <h2 id="companies-title" className="mb-6 text-xs font-medium md:text-sm">
        Made-up companies. <span className="text-landing-muted">Real decisions.</span>
      </h2>
      <div className="min-h-38 md:min-h-24 wide:min-h-9">
        {companies.length > 0 ? (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 md:gap-6 wide:grid-cols-6 wide:gap-5">
            {companies.map((company, index) => (
              <li
                key={company.ticker}
                className="flex min-w-0 items-center gap-2 md:gap-3 [&>span]:size-9 [&>span]:rounded [&_svg]:size-6"
              >
                <CompanyTile companyId={index} size="md" />
                <div>
                  <h3 className="mb-1 text-xs font-medium md:text-sm">{company.name}</h3>
                  <p className="text-2xs text-landing-muted">{company.product}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <CompanyRosterSkeleton />
        )}
      </div>
    </section>
  );
}
