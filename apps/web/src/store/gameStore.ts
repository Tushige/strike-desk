import type { Frame, FrameOrder, ServerMessage } from '@strike-desk/shared/protocol';
import { isNewerFrame } from '@strike-desk/shared/protocol';
import type { FeedStatus } from '@strike-desk/shared/feed';

/**
 * Where the live data lives: outside React, one slice per thing the page
 * shows. This file imports no React.
 *
 * Two steps, and the difference between them matters. `isNewerFrame`
 * answers "may I accept this frame?" — it says yes to a frame equal to the
 * one held, because any frame is the whole picture. Whether anyone is told
 * is a separate question, answered slice by slice: a slice notifies only
 * when its own value changed. Without that, a stopped clock at five frames
 * a second would redraw the page five times a second for nothing.
 *
 * Only the ordering triple is kept, never the frame itself.
 */

export interface Slice<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

interface WritableSlice<T> extends Slice<T> {
  set(next: T): void;
}

export interface GameStore {
  ingest(message: ServerMessage): void;
  setStatus(status: FeedStatus): void;
  price(companyId: number): Slice<number | null>;
  phase: Slice<string>;
  day: Slice<number>;
  status: Slice<FeedStatus>;
  sessionGone: Slice<boolean>;
  counters: { accepted: number; dropped: number };
}

function createSlice<T>(initial: T): WritableSlice<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A reply carries the frame that answers a command. */
function frameOf(message: ServerMessage): Frame | null {
  if (message.t === 'frame') return message;
  if (message.t === 'reply') return message.frame;
  return null;
}

export function createGameStore(companyCount = 6): GameStore {
  const prices = Array.from({ length: companyCount }, () => createSlice<number | null>(null));
  const phase = createSlice('');
  const day = createSlice(0);
  const status = createSlice<FeedStatus>('closed');
  const sessionGone = createSlice(false);
  const counters = { accepted: 0, dropped: 0 };
  let held: FrameOrder | null = null;

  function price(companyId: number): Slice<number | null> {
    const slice = prices[companyId];
    if (slice === undefined) throw new Error(`no company ${String(companyId)}`);
    return slice;
  }

  function ingest(message: ServerMessage): void {
    if (message.t === 'error') {
      if (message.code === 'noSession') sessionGone.set(true);
      return;
    }

    const frame = frameOf(message);
    if (frame === null) return;

    if (!isNewerFrame(held, frame)) {
      counters.dropped += 1;
      return;
    }
    // A session we have not seen before is a game of its own: whatever was
    // said about the last one no longer applies.
    if (held !== null && held.session !== frame.session) sessionGone.set(false);
    held = { session: frame.session, rev: frame.rev, step: frame.step };
    counters.accepted += 1;

    phase.set(frame.clock.phase);
    day.set(frame.clock.day);
    for (let companyId = 0; companyId < companyCount; companyId += 1) {
      prices[companyId]?.set(frame.prices[companyId] ?? null);
    }
  }

  function setStatus(next: FeedStatus): void {
    status.set(next);
  }

  return { ingest, setStatus, price, phase, day, status, sessionGone, counters };
}
