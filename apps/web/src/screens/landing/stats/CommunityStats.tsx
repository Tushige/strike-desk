import { useId } from 'react';
import type { LandingStats } from './publicStats';
import { statNumber } from './publicStats';
import { Odometer } from '../../motion/Odometer';
import { cx } from '../../ui';
import { useStatsEntrance } from './useStatsEntrance';

export type StatsStyle = 'ribbon' | 'ticket' | 'ledger';
export type StatsState = { status: 'ready'; data: LandingStats } | { status: 'loading' | 'error' };
type MetricKind = 'games' | 'profit' | 'best';

const STYLES = {
  ticket: {
    body: 'border border-line bg-panel px-5 py-6 @stats:p-8 before:absolute before:top-1/2 before:-left-3 before:size-6 before:-translate-y-1/2 before:rounded-full before:border before:border-line before:bg-ink before:[clip-path:inset(0_0_0_50%)] after:absolute after:top-1/2 after:-right-3 after:size-6 after:-translate-y-1/2 after:rounded-full after:border after:border-line after:bg-ink after:[clip-path:inset(0_50%_0_0)]',
    intro: 'sr-only',
    metrics:
      'grid grid-cols-2 gap-x-4 gap-y-6 @stats:grid-cols-[1.7fr_1fr] @stats:gap-x-8 @stats:gap-y-0',
    metric: {
      profit:
        'col-span-2 row-start-1 border-b border-dashed border-dusk pb-5 @stats:col-span-1 @stats:row-span-2 @stats:self-center @stats:border-0 @stats:py-3',
      games:
        '@stats:col-start-2 @stats:row-start-1 @stats:border-l @stats:border-dashed @stats:border-dusk @stats:pb-5 @stats:pl-8',
      best: '@stats:col-start-2 @stats:row-start-2 @stats:border-l @stats:border-dashed @stats:border-dusk @stats:pt-5 @stats:pl-8',
    },
    value: 'text-stat-small',
    profit: 'text-stat-profit',
    note: '',
  },
  ribbon: {
    body: 'border-y border-line py-6 @stats:py-8',
    intro: 'sr-only',
    metrics: 'grid grid-cols-2 gap-x-5 gap-y-6 @stats:grid-cols-[1fr_1.35fr_1.1fr] @stats:gap-0',
    metric: {
      games: '@stats:pr-6',
      profit:
        'col-span-2 row-start-1 @stats:col-span-1 @stats:row-auto @stats:border-l @stats:border-line @stats:px-8',
      best: 'border-l border-line pl-5 @stats:pl-8',
    },
    value: 'text-stat-ribbon',
    profit: 'text-stat-ribbon-profit',
    note: '',
  },
  ledger: {
    body: 'border-t border-line py-6 @stats:grid @stats:grid-cols-[1fr_1.4fr] @stats:gap-x-14 @stats:py-8',
    intro: 'pb-5 @stats:row-span-2 @stats:pt-2.5 [&_br]:hidden @stats:[&_br]:block',
    metrics: 'block',
    metric: {
      games: 'flex min-h-16 items-center justify-between gap-5 border-b border-line py-3.5',
      profit: 'flex min-h-16 items-center justify-between gap-5 border-b border-line py-3.5',
      best: 'flex min-h-16 items-center justify-between gap-5 border-b border-line py-3.5',
    },
    value: 'mt-0 w-[8.5ch] flex-none text-right text-stat-ledger',
    profit: '',
    note: '@stats:col-start-2',
  },
} satisfies Record<
  StatsStyle,
  {
    body: string;
    intro: string;
    metrics: string;
    metric: Record<MetricKind, string>;
    value: string;
    profit: string;
    note: string;
  }
>;

function Metric({
  label,
  value,
  kind,
  status,
  variant,
  play,
}: {
  label: string;
  value: string | null;
  kind: MetricKind;
  status: StatsState['status'];
  variant: StatsStyle;
  play: boolean;
}) {
  const formatted = value === null ? null : statNumber(value, kind !== 'games');
  const negative = value !== null && BigInt(value) < 0n;
  const styles = STYLES[variant];
  return (
    <div
      className={cx(`community-metric community-${kind}`, 'min-w-0', styles.metric[kind])}
      data-negative={negative}
    >
      <dt className="text-xs leading-normal text-muted @stats:text-sm">{label}</dt>
      <dd
        className={cx(
          'mt-2 min-h-[1.25em] font-brand leading-[1.15] font-extrabold tracking-tight tabular-nums',
          kind === 'profit' && styles.profit ? styles.profit : styles.value,
          negative ? 'text-coral' : kind === 'profit' && 'text-mint',
        )}
        data-unavailable={status !== 'ready' || value === null}
      >
        {status === 'loading' ? (
          <span
            className="community-placeholder relative my-[.12em] block h-[.86em] w-3/4 overflow-hidden rounded bg-raised after:absolute after:inset-0 after:animate-stat-loading after:bg-linear-to-r after:from-transparent after:via-line after:to-transparent"
            aria-hidden="true"
          />
        ) : (
          <span className="community-number-window block overflow-clip pb-[.12em]">
            <span
              className={cx(
                'community-number inline-block whitespace-nowrap',
                (status === 'error' || !formatted) && 'text-stat-unavailable text-muted',
              )}
            >
              {status === 'error' ? (
                'Unavailable'
              ) : formatted ? (
                <Odometer value={formatted.compact} label={formatted.exact} play={play} />
              ) : (
                'Not yet'
              )}
            </span>
          </span>
        )}
      </dd>
    </div>
  );
}

export function CommunityStats({
  variant,
  state,
  onRetry,
}: {
  variant: StatsStyle;
  state: StatsState;
  onRetry: () => void;
}) {
  const id = useId();
  const { metrics, play } = useStatsEntrance(state.status === 'ready');
  const data = state.status === 'ready' ? state.data : null;
  const styles = STYLES[variant];
  const statusText =
    state.status === 'error'
      ? 'Community stats couldn’t load. Your game is ready to play.'
      : state.status === 'loading'
        ? 'Loading community stats.'
        : data?.completedGames === '0'
          ? 'Be the first to finish five days.'
          : 'Starting $1M excluded. Total profits count winning runs only.';
  return (
    <section
      className={`community-stats community-${variant} @container`}
      aria-labelledby={`${id}-heading`}
      aria-busy={state.status === 'loading'}
    >
      <div className={cx('community-body relative', styles.body)}>
        <div className={cx('community-intro', styles.intro)}>
          <h2
            id={`${id}-heading`}
            className="font-brand text-4xl leading-none font-extrabold tracking-tight"
          >
            The desk,
            <br /> <span className="text-sun">so far.</span>
          </h2>
          <p className="mt-4 hidden text-sm leading-relaxed text-muted @stats:block">
            Five fictional days.
            <br />
            Your decisions add up.
          </p>
        </div>
        <dl ref={metrics} className={cx('community-metrics', styles.metrics)}>
          <Metric
            variant={variant}
            kind="games"
            play={play}
            label="Games completed"
            value={data?.completedGames ?? null}
            status={state.status}
          />
          <Metric
            variant={variant}
            kind="profit"
            play={play}
            label="Pretend profits earned"
            value={data?.pretendProfitsEarnedCents ?? null}
            status={state.status}
          />
          <Metric
            variant={variant}
            kind="best"
            play={play}
            label="Best completed run"
            value={data?.bestNetProfitCents ?? null}
            status={state.status}
          />
        </dl>
        <div
          className={cx(
            'community-note mt-5 flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-relaxed text-muted',
            styles.note,
          )}
        >
          <p role="status">{statusText}</p>
          {state.status === 'error' && (
            <button
              className="min-h-11 border-b border-sun py-2.5 text-sun hover:text-cloud focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sun"
              type="button"
              onClick={onRetry}
            >
              Try again
            </button>
          )}
          {state.status === 'ready' && <span>All money is pretend.</span>}
        </div>
      </div>
    </section>
  );
}
