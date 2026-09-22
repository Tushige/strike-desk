import type { ServerMessage } from '@strike-desk/shared/protocol';
import type { IngestResult } from '../store/gameStore';

export type Unavailable = 'Collecting…' | 'Paused' | 'Unsupported';
export type Distribution = Unavailable | { readonly p50: number; readonly p95: number; readonly samples: number };
export interface StressSnapshot {
  readonly records: number | Unavailable;
  readonly changes: number | Unavailable;
  readonly clientDelay: Distribution;
  readonly frameInterval: Distribution;
  readonly longTasks: number | Unavailable;
}
export interface StressMeasurements {
  get: () => StressSnapshot;
  isEnabled: () => boolean;
  subscribe: (listener: () => void) => () => void;
  observe(message: ServerMessage, result: IngestResult, receivedAt: number): void;
  setActive(active: boolean): void;
}

/** Received workload and accepted changes share a window, never a counter. */
export function createStressMeasurements({ now, schedule }: {
  now: () => number;
  schedule: (run: () => void, ms: number) => () => void;
}): StressMeasurements {
  const listeners = new Set<() => void>();
  let enabled = false;
  let active = false;
  let identity = '';
  let started = now();
  let records = 0;
  let changes = 0;
  let cancel: (() => void) | undefined;
  const empty = (state: Unavailable): StressSnapshot => ({ records: state, changes: state, clientDelay: state, frameInterval: state, longTasks: state });
  let snapshot = empty('Paused');
  const publish = () => { for (const listener of listeners) listener(); };
  const running = () => active && enabled;
  function tick() {
    cancel = undefined;
    if (!running()) return;
    const elapsed = now() - started;
    if (elapsed >= 1000) {
      snapshot = { ...snapshot, records: records * 1000 / elapsed, changes: changes * 1000 / elapsed };
      records = 0;
      changes = 0;
      started = now();
      publish();
    }
    cancel = schedule(tick, Math.max(1, 1000 - (now() - started)));
  }
  function reset() {
    cancel?.();
    cancel = undefined;
    started = now();
    records = 0;
    changes = 0;
    snapshot = empty(running() ? 'Collecting…' : 'Paused');
    if (running()) cancel = schedule(tick, 1000);
    publish();
  }
  return {
    get: () => snapshot,
    isEnabled: () => enabled,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setActive(next) { if (next !== active) { active = next; reset(); } },
    observe(message, result) {
      if (result.accepted) {
        const nextIdentity = `${result.session}/${String(result.day)}`;
        const replaced = nextIdentity !== identity || result.boardReplaced || enabled !== result.stress;
        identity = nextIdentity;
        enabled = result.stress;
        if (replaced) reset();
      }
      if (!running()) return;
      if (message.t === 'frame') records += message.quotes.length;
      else if (message.t === 'reply') records += message.frame.quotes.length;
      else if (message.t === 'quotes') records += message.changes.length;
      if (result.accepted) changes += result.quoteChanges.length;
    },
  };
}
