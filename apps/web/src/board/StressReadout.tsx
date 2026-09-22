import { useId, useState, useSyncExternalStore } from 'react';
import type { Distribution, StressMeasurements, StressSnapshot, Unavailable } from './stressMeasurements';

const number = (value: number | Unavailable) => typeof value === 'number' ? value.toFixed(1) : value;
const distribution = (value: Distribution) => typeof value === 'string' ? value : `${value.p50.toFixed(1)} / ${value.p95.toFixed(1)}`;
const STATES = 'Collecting… means a usable sample is not yet available. Paused excludes hidden or inactive time. Unsupported means the browser API is unavailable.';
const PERCENTILES = 'Nearest-rank p50 / p95: 50% / 95% of samples are at or below these values. Rolling 10-second window, at most 4,096 samples; oldest samples are dropped.';
const GROUPS: readonly { key: keyof StressSnapshot; label: string; definition: string; spread?: boolean }[] = [
  { key: 'records', label: 'Records/s', definition: 'Received quote records per second, including repeated or discarded records. Whole frames and replies count each quote once. One-second visible windows, adjusted for actual elapsed time.' },
  { key: 'changes', label: 'Changes/s', definition: 'Accepted quote records whose price, real value, hope value or break-even changed. A new board establishes a baseline, not changes. One-second visible windows, adjusted for actual elapsed time.' },
  { key: 'clientDelay', label: 'Client delay (ms)', spread: true, definition: `From receipt to the first animation-frame observation of the latest changed price in a visible Price cell. This DOM/render-opportunity proxy excludes network latency and is not physical paint time. Offscreen and superseded prices are excluded. ${PERCENTILES}` },
  { key: 'frameInterval', label: 'Frame interval (ms)', spread: true, definition: `Time between adjacent animation frames while visible. Returning from a hidden tab starts a new baseline. ${PERCENTILES}` },
  { key: 'longTasks', label: 'Long tasks >50 ms', definition: 'Browser tasks lasting strictly more than 50 ms, wholly within visible measuring time. Rolling 10-second count, at most 1,024 entries; oldest entries are dropped. A supported measured interval without a long task shows 0.' },
];

export function StressReadout({ measurements }: { measurements: StressMeasurements }) {
  const value = useSyncExternalStore(measurements.subscribe, measurements.get);
  const id = useId();
  const [open, setOpen] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  return <div aria-label="Table measurements" className="min-w-0 shrink-0 border-b border-border px-3 font-mono text-xs tabular-nums text-muted-foreground sm:py-2">
    <div className="flex min-w-0 gap-x-4 gap-y-1 overflow-x-auto overscroll-contain sm:flex-wrap sm:overflow-x-visible sm:pb-1">
    {GROUPS.map((group) => <div key={group.key} className="flex shrink-0 items-baseline gap-x-1 whitespace-nowrap">
      <button type="button" aria-describedby={`${id}-${group.key}`} className="rounded-sm underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:focus-visible:outline-offset-2"
        onFocus={() => { setFocused(group.key); setOpen(group.key); }} onBlur={() => { setFocused(null); setOpen(null); }}
        onMouseEnter={() => { setOpen(group.key); }} onMouseLeave={() => { setOpen(focused); }}
        onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(null); event.stopPropagation(); } }}>
        {group.label}
      </button>
      {group.spread ? <span>p50 / p95</span> : null}
      <span className="inline-block w-[17ch] text-right">{group.spread ? distribution(value[group.key] as Distribution) : group.key === 'longTasks' ? String(value.longTasks) : number(value[group.key] as number | Unavailable)}</span>
    </div>)}
    </div>
    {GROUPS.map((group) => <p key={group.key} id={`${id}-${group.key}`} role="tooltip" hidden={open !== group.key}
      className="fixed inset-x-2 top-2 z-50 m-0 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-sm border border-border bg-card p-3 font-sans text-xs leading-relaxed text-foreground sm:static sm:max-h-none sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:py-1">{group.definition} {STATES}</p>)}
  </div>;
}
