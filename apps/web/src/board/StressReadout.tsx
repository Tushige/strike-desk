import { useSyncExternalStore } from 'react';
import type { Distribution, StressMeasurements, Unavailable } from './stressMeasurements';

const number = (value: number | Unavailable) => typeof value === 'number' ? value.toFixed(1) : value;
const distribution = (value: Distribution) => typeof value === 'string' ? value : `${value.p50.toFixed(1)} / ${value.p95.toFixed(1)}`;

export function StressReadout({ measurements }: { measurements: StressMeasurements }) {
  const value = useSyncExternalStore(measurements.subscribe, measurements.get);
  return <div aria-label="Table measurements" className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-b border-border px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
    <div><span>Records/s</span> <span>{number(value.records)}</span></div>
    <div><span>Changes/s</span> <span>{number(value.changes)}</span></div>
    <div><span>Client delay (ms)</span> <span>p50 / p95</span> <span>{distribution(value.clientDelay)}</span></div>
    <div><span>Frame interval (ms)</span> <span>p50 / p95</span> <span>{distribution(value.frameInterval)}</span></div>
    <div><span>Long tasks &gt;50 ms</span> <span>{number(value.longTasks)}</span></div>
  </div>;
}
