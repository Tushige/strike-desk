import { lineStateOf, STALE_AFTER_MS } from '../modules/connection/index';
import type { ConnectionLine } from '../modules/connection/index';
import type { IngestResult, Slice } from '../store/gameStore';
import type { FeedStatus } from '@strike-desk/shared/feed';

export interface FreshnessSnapshot {
  waiting: boolean;
  ageSeconds: number | null;
  line: ConnectionLine;
}

export interface DeskFreshness extends Slice<FreshnessSnapshot> {
  get: () => FreshnessSnapshot;
  subscribe: (listener: () => void) => () => void;
  ingest(result: IngestResult, receivedAt: number): void;
  setStatus(status: FeedStatus): void;
  dispose(): void;
}

/** Accepted data owns the deadline; timestamps never become React state. */
export function createDeskFreshness(options: {
  now: () => number;
  schedule: (run: () => void, ms: number) => () => void;
}): DeskFreshness {
  let receivedAt: number | null = null;
  let status: FeedStatus = 'closed';
  let expectsUpdates = true;
  let identity: { session: string; day: number } | null = null;
  let resume: 'none' | 'awaitingFrame' | 'resumed' = 'none';
  let snapshot: FreshnessSnapshot = { waiting: true, ageSeconds: null, line: lineStateOf('connecting') };
  let cancel: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function update(): void {
    cancel?.();
    cancel = null;
    const elapsed = receivedAt === null ? null : Math.max(0, options.now() - receivedAt);
    const waiting = expectsUpdates && (elapsed === null || elapsed >= STALE_AFTER_MS || status !== 'live' || resume !== 'none');
    const ageSeconds = waiting && elapsed !== null ? Math.floor(elapsed / 1000) : null;
    const line = !expectsUpdates ? lineStateOf('live') : lineStateOf(status !== 'live' || elapsed === null || resume === 'awaitingFrame' ? 'reconnecting'
      : resume === 'resumed' ? 'resumed' : waiting ? 'stale' : 'live');
    if (snapshot.waiting !== waiting || snapshot.ageSeconds !== ageSeconds || snapshot.line !== line) {
      snapshot = { waiting, ageSeconds, line };
      listeners.forEach((listener) => { listener(); });
    }
    if (listeners.size > 0 && expectsUpdates && elapsed !== null) {
      cancel = options.schedule(update, waiting ? 1000 - elapsed % 1000 : STALE_AFTER_MS - elapsed);
    }
  }

  return {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      update();
      return () => { listeners.delete(listener); if (listeners.size === 0) { cancel?.(); cancel = null; } };
    },
    ingest(result, at) {
      if (!result.accepted) return;
      if (identity !== null && (identity.session !== result.session || identity.day !== result.day)) resume = 'none';
      identity = { session: result.session, day: result.day };
      expectsUpdates = result.phase === 'preBell' || result.phase === 'open';
      if (resume === 'awaitingFrame') {
        if (result.kind !== 'frame') return;
        resume = 'resumed';
      } else if (resume === 'resumed') resume = 'none';
      receivedAt = at;
      update();
    },
    setStatus(next) {
      status = next;
      if (next !== 'live' && receivedAt !== null) resume = 'awaitingFrame';
      update();
    },
    dispose() { cancel?.(); cancel = null; listeners.clear(); },
  };
}
