/** Decorative placeholders reserve space without inventing prices or controls. */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`loading-block ${className}`} />;
}

export function CompanyRosterSkeleton() {
  return (
    <div className="loading-roster" role="status" aria-label="Loading companies">
      <span className="sr-only">Loading companies…</span>
      <ul aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index}>
            <SkeletonBlock className="loading-company-icon" />
            <div className="loading-company-copy">
              <SkeletonBlock />
              <SkeletonBlock />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="loading-chart" role="status" aria-label="Preparing price chart">
      <span className="sr-only">Preparing price chart…</span>
      <div className="loading-chart-axis" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index}>
            <SkeletonBlock />
            <span />
          </div>
        ))}
      </div>
      <div className="loading-chart-labels" aria-hidden="true">
        <SkeletonBlock />
        <SkeletonBlock />
      </div>
    </div>
  );
}
