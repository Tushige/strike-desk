import { useView, views } from '../../store/hooks';
import { SkeletonBlock } from '../LoadingSkeleton';
import { COMPARISON_CHIP, comparisonIntro } from './comparisonLayout';

export function ComparisonSkeleton() {
  const frame = useView(views.comparison);
  return <div className="comparison-content flex min-h-0 flex-col gap-3" role="status" aria-label="Loading live contracts">
    <span className="sr-only">Loading live contracts…</span>
    <p className="m-0 text-xs text-muted" aria-hidden="true">{comparisonIntro(frame?.stress ?? false)}</p>
    <div className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
      <span className={`${COMPARISON_CHIP} loading-chip`}>All</span>
      {frame?.companies.map(company => <span className={`${COMPARISON_CHIP} pl-1 loading-chip`} key={company.ticker}>
        <span className="size-5" />{company.ticker}
      </span>)}
      <span className="mx-1 h-5 w-px bg-line" />
      {['Both', 'UP', 'DOWN'].map(label => <span key={label} className={`${COMPARISON_CHIP} loading-chip`}>{label}</span>)}
      <span className="mx-1 h-5 w-px bg-line" />
      <span className={`${COMPARISON_CHIP} loading-chip`}>Affordable for me</span>
    </div>
    <div className="comparison-grid loading-table min-h-0 overflow-hidden rounded-[18px] border border-line bg-panel" aria-hidden="true" data-stress={frame?.stress ?? false}>
      {Array.from({ length: 19 }, (_, row) => <div className="loading-table-row" key={row}>
        {Array.from({ length: frame?.stress ? 7 : 8 }, (_, column) => <div key={column}><SkeletonBlock /></div>)}
      </div>)}
    </div>
  </div>;
}
