import { Component, lazy, Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import type { CompareOptions } from './CompareOptions';
import { ComparisonSkeleton } from './ComparisonSkeleton';

type Props = Parameters<typeof CompareOptions>[0];
const load = () => import('./CompareOptions').then((m) => ({ default: m.CompareOptions }));
class GridBoundary extends Component<
  { children: ReactNode; retry: () => void },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed)
      return (
        <div role="alert" className="p-4 text-sm">
          The comparison board could not load. Your game is still available.
          <button type="button" className="ml-2 underline" onClick={this.props.retry}>
            Retry board
          </button>
        </div>
      );
    return this.props.children;
  }
}
export function LazyComparison(props: Props) {
  const [attempt, setAttempt] = useState(() => ({ id: 0, Grid: lazy(load) }));
  const Grid = attempt.Grid;
  return (
    <GridBoundary
      key={attempt.id}
      retry={() => {
        setAttempt({ id: attempt.id + 1, Grid: lazy(load) });
      }}
    >
      <Suspense fallback={<ComparisonSkeleton />}>
        <Grid {...props} />
      </Suspense>
    </GridBoundary>
  );
}
