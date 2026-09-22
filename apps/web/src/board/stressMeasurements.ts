import type { ServerMessage } from '@strike-desk/shared/protocol';
import { formatCents } from '@strike-desk/shared/money';
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
  shownPrice(contractId: number, text: string, at: number): void;
  frame(at: number): void;
  setSupport(support: { delay: boolean; frames: boolean; longTasks: boolean }): void;
  longTask(startTime: number, duration: number): void;
}

const WINDOW_MS = 10_000;
const SAMPLE_CAP = 4096;
interface Sample { at: number; value: number }
function trim(samples: Sample[], now: number, cap = SAMPLE_CAP) {
  while (samples.length > cap || (samples[0] !== undefined && samples[0].at <= now - WINDOW_MS)) samples.shift();
}
function distribution(samples: Sample[], now: number): Distribution {
  trim(samples, now);
  if (samples.length === 0) return 'Collecting…';
  const values = samples.map((sample) => sample.value).sort((a, b) => a - b);
  return { p50: values[Math.ceil(values.length * 0.5) - 1]!, p95: values[Math.ceil(values.length * 0.95) - 1]!, samples: values.length };
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
  let boardSize = 0;
  const candidates = new Map<number, { priceCents: number; receivedAt: number }>();
  const delays: Sample[] = [];
  const intervals: Sample[] = [];
  let lastFrame: number | undefined;
  const tasks: Sample[] = [];
  let visibleSince = started;
  let support = { delay: true, frames: true, longTasks: true };
  let cancel: (() => void) | undefined;
  const empty = (state: Unavailable): StressSnapshot => ({ records: state, changes: state,
    clientDelay: support.delay ? state : 'Unsupported', frameInterval: support.frames ? state : 'Unsupported', longTasks: support.longTasks ? state : 'Unsupported' });
  let snapshot = empty('Paused');
  const publish = () => { for (const listener of listeners) listener(); };
  const running = () => active && enabled;
  function tick() {
    cancel = undefined;
    if (!running()) return;
    const elapsed = now() - started;
    if (elapsed >= 1000) {
      trim(tasks, now(), 1024);
      snapshot = { ...snapshot, records: records * 1000 / elapsed, changes: changes * 1000 / elapsed,
        clientDelay: support.delay ? distribution(delays, now()) : 'Unsupported',
        frameInterval: support.frames ? distribution(intervals, now()) : 'Unsupported', longTasks: support.longTasks ? tasks.length : 'Unsupported' };
      for (const [id, candidate] of candidates) if (now() - candidate.receivedAt >= WINDOW_MS) candidates.delete(id);
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
    candidates.clear();
    delays.length = 0;
    intervals.length = 0;
    lastFrame = undefined;
    tasks.length = 0;
    visibleSince = started;
    snapshot = empty(running() ? 'Collecting…' : 'Paused');
    if (running()) cancel = schedule(tick, 1000);
    publish();
  }
  return {
    get: () => snapshot,
    isEnabled: () => enabled,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setActive(next) { if (next !== active) { active = next; reset(); } },
    setSupport(next) { support = next; reset(); },
    longTask(startTime, duration) {
      const end = startTime + duration;
      if (!running() || !support.longTasks || duration <= 50 || startTime < visibleSince || end > now()) return;
      tasks.push({ at: end, value: duration });
      trim(tasks, now(), 1024);
    },
    frame(at) {
      if (!running()) return;
      if (lastFrame !== undefined && at > lastFrame) { intervals.push({ at, value: at - lastFrame }); trim(intervals, at); }
      lastFrame = at;
    },
    shownPrice(contractId, text, at) {
      const candidate = candidates.get(contractId);
      if (!running() || candidate === undefined || at < candidate.receivedAt) return;
      if (at - candidate.receivedAt >= WINDOW_MS) { candidates.delete(contractId); return; }
      if (text !== formatCents(candidate.priceCents)) return;
      candidates.delete(contractId);
      delays.push({ at, value: at - candidate.receivedAt });
      trim(delays, at);
    },
    observe(message, result, receivedAt) {
      if (result.accepted) {
        const nextIdentity = `${result.session}/${String(result.day)}`;
        const replaced = nextIdentity !== identity || result.boardReplaced || enabled !== result.stress;
        identity = nextIdentity;
        enabled = result.stress;
        if (message.t === 'frame') boardSize = message.quotes.length;
        else if (message.t === 'reply') boardSize = message.frame.quotes.length;
        if (replaced) reset();
      }
      if (!running()) return;
      if (message.t === 'frame') records += message.quotes.length;
      else if (message.t === 'reply') records += message.frame.quotes.length;
      else if (message.t === 'quotes') records += message.changes.length;
      if (result.accepted) {
        changes += result.quoteChanges.length;
        for (const change of result.quoteChanges) {
          if (change.priceChanged && change.contractId < boardSize) candidates.set(change.contractId, { priceCents: change.priceCents, receivedAt });
        }
      }
    },
  };
}
