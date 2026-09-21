import type { FeedEvent, FeedStatus } from '@strike-desk/shared/feed';
import type { ServerMessage } from '@strike-desk/shared/protocol';
import type { ConnectionState, CreateConnection, PendingCommand, ReadSlice } from './ports';
import { createSocketFeed, frameOf, throwAll } from './socketFeed';

/**
 * The connection: the block's feed, plus an honest account of where the line
 * stands. It listens to its own feed before anyone else can, so by the time
 * any other listener hears of an event, `state` has already moved on.
 */

/** A value with listeners. `set` only stores; `flush` tells, once, if anything was stored. */
interface Slice<T> extends ReadSlice<T> {
  set(next: T): void;
  /** Tell every listener if the value changed since the last flush; failures go into `errors`. */
  flush(errors: unknown[]): void;
}

function createSlice<T>(initial: T): Slice<T> {
  const listeners = new Set<() => void>();
  let value = initial;
  let changed = false;

  return {
    get: () => value,
    set(next: T) {
      if (next === value) return;
      value = next;
      changed = true;
    },
    flush(errors: unknown[]) {
      if (!changed) return;
      changed = false;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          errors.push(error);
        }
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The reading half of a slice, which is all a caller is handed. */
function readOnly<T>(slice: Slice<T>): ReadSlice<T> {
  return {
    get: () => slice.get(),
    subscribe: (listener) => slice.subscribe(listener),
  };
}

const NOTHING_PENDING: readonly PendingCommand[] = [];

export const createConnection: CreateConnection = ({ seam, sessionKey }) => {
  // The feed takes the seam's clock, so `receivedAt` and the age of the data
  // are readings of one clock.
  const feed = createSocketFeed(seam, sessionKey);

  const state = createSlice<ConnectionState>({
    phase: 'connecting',
    attempt: 0,
    retryAt: null,
    lastMessageAt: null,
    gameGone: false,
    serverFull: false,
  });
  const pending = createSlice<readonly PendingCommand[]>(NOTHING_PENDING);

  /** True from a drop until the first frame on a later socket. */
  let droppedSinceFrame = false;

  /** Lay `changes` over the snapshot, keeping the same object when no member differs. */
  function change(changes: Partial<ConnectionState>): void {
    const held = state.get();
    const next = { ...held, ...changes };
    const same =
      next.phase === held.phase &&
      next.attempt === held.attempt &&
      next.retryAt === held.retryAt &&
      next.lastMessageAt === held.lastMessageAt &&
      next.gameGone === held.gameGone &&
      next.serverFull === held.serverFull;
    if (!same) state.set(next);
  }

  function onStatus(status: FeedStatus): void {
    const retry = feed.retry();
    if (status === 'reconnecting') {
      droppedSinceFrame = true;
      change({ phase: 'reconnecting', attempt: retry.attempt, retryAt: retry.retryAt });
      return;
    }
    if (status === 'closed') {
      droppedSinceFrame = false;
      change({ phase: 'closed', attempt: 0, retryAt: null });
      return;
    }
    if (status === 'connecting') {
      // The first socket, or the first after the page closed the last one, is
      // `connecting`; one opened after a drop is an attempt under way.
      change({ phase: droppedSinceFrame ? 'reconnecting' : 'connecting', retryAt: null });
      return;
    }
    // An open socket is not a working line yet: only a frame says the server
    // is there, so `live` from the feed changes nothing here.
  }

  function onMessage(message: ServerMessage, receivedAt: number): void {
    if (message.t === 'error') {
      // An error is not data: nothing on screen got newer.
      if (message.code === 'serverFull') change({ serverFull: true });
      return;
    }

    const frame = frameOf(message);
    if (frame === null) {
      // A batch of quotes: newer data, and no news about where the line stands
      // until a frame has said the server is there.
      const phase = state.get().phase;
      change({ lastMessageAt: receivedAt, phase: phase === 'connecting' || phase === 'reconnecting' ? phase : 'live' });
      return;
    }

    droppedSinceFrame = false;
    change({ phase: 'live', attempt: 0, retryAt: null, lastMessageAt: receivedAt, serverFull: false });
  }

  function onEvent(event: FeedEvent): void {
    if (event.type === 'status') onStatus(event.status);
    else onMessage(event.message, event.receivedAt);
    flush();
  }

  function flush(): void {
    const errors: unknown[] = [];
    state.flush(errors);
    pending.flush(errors);
    throwAll(errors);
  }

  // First in, so first told: never removed.
  feed.subscribe(onEvent);

  return {
    connect: () => {
      feed.connect();
    },
    close: () => {
      feed.close();
    },
    send: (message) => feed.send(message),
    simulateDrop: () => {
      feed.simulateDrop();
    },
    subscribe: (listener) => feed.subscribe(listener),
    state: readOnly(state),
    pending: readOnly(pending),
    submit: () => Promise.resolve({ outcome: 'lost' }),
    resend() {
      // Nothing is ever pending yet.
    },
    dismissGameGone() {
      change({ gameGone: false });
      flush();
    },
  };
};
