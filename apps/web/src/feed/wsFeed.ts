import type { Frame, Hello, ServerMessage } from '@strike-desk/shared/protocol';
import { PROTOCOL_VERSION } from '@strike-desk/shared/protocol';
import type { Feed, FeedEvent, FeedStatus, Outbound } from '@strike-desk/shared/feed';
import { decode } from './decode';

/**
 * The one Feed implementation, and the only file in the web app that names
 * WebSocket: everything else reads data through the interface, and every
 * test hands in its own socket instead.
 *
 * The feed owns one connection to one session. It opens the socket, says
 * hello (naming the session it already had, if any), reconnects after a
 * drop with a growing wait, and drops anything that fails the schema before
 * a listener ever sees it. It keeps no frame data of its own.
 */

/** Where the session id is kept. Per tab, so a second tab is a second game. */
export const SESSION_KEY = 'strike-desk.session';

/** How long to wait before each reconnect attempt. The last wait repeats. */
const RECONNECT_MS = [1000, 2000, 4000, 8000];
/** Each wait is scaled by a factor in [0.8, 1.2) so reconnects do not line up. */
const JITTER_LEAST = 0.8;
const JITTER_SPAN = 0.4;

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

/** As much of a WebSocket as the feed uses, so a fake can stand in for one. */
export interface SocketLike {
  readyState: number;
  send(text: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void): void;
}

/** The part of `sessionStorage` the feed uses. */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WsFeedOptions {
  url: string;
  /** The transport seam: tests pass their own socket, the page passes a real one. */
  createSocket?: (url: string) => SocketLike;
  /** Null, or absent, means the session is not remembered across a reload. */
  storage?: SessionStore | null;
  schedule?: (run: () => void, ms: number) => () => void;
  random?: () => number;
  /** The clock every message is stamped with. The page's own, unless a test hands one in. */
  now?: () => number;
}

function pageClock(): number {
  return performance.now();
}

function browserSocket(url: string): SocketLike {
  // The one place a real WebSocket is made. It has everything SocketLike
  // asks for, so no cast is needed.
  return new WebSocket(url);
}

function afterDelay(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
}

/** A reply carries a frame too, and a frame is what names the session. */
function frameOf(message: ServerMessage): Frame | null {
  if (message.t === 'frame') return message;
  if (message.t === 'reply') return message.frame;
  return null;
}

export function createWsFeed(options: WsFeedOptions): Feed {
  const createSocket = options.createSocket ?? browserSocket;
  const schedule = options.schedule ?? afterDelay;
  const random = options.random ?? Math.random;
  const now = options.now ?? pageClock;
  const storage = options.storage ?? null;

  const listeners = new Set<(event: FeedEvent) => void>();
  let socket: SocketLike | null = null;
  let status: FeedStatus = 'closed';
  let sessionId = readSession();
  let attempt = 0;
  let cancelRetry: (() => void) | null = null;

  // Storage throws in some private-browsing modes, so every use is guarded.
  function readSession(): string | null {
    try {
      return storage?.getItem(SESSION_KEY) ?? null;
    } catch {
      return null;
    }
  }

  function rememberSession(id: string): void {
    if (id === sessionId) return;
    sessionId = id;
    try {
      storage?.setItem(SESSION_KEY, id);
    } catch {
      // Keeping it in memory is enough for this page load.
    }
  }

  function forgetSession(): void {
    sessionId = null;
    try {
      storage?.removeItem(SESSION_KEY);
    } catch {
      // Nothing to do: the id is already gone from memory.
    }
  }

  // Every listener gets the event, whatever the ones before it did. The
  // first error is kept and thrown once all of them have run, so a broken
  // listener is still loud and never costs another its event.
  function emit(event: FeedEvent): void {
    let failed = false;
    let firstError: unknown;
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
    if (failed) throw firstError;
  }

  function setStatus(next: FeedStatus): void {
    if (next === status) return;
    status = next;
    emit({ type: 'status', status: next });
  }

  function sendHello(target: SocketLike): void {
    const hello: Hello =
      sessionId === null
        ? { t: 'hello', v: PROTOCOL_VERSION }
        : { t: 'hello', v: PROTOCOL_VERSION, session: sessionId };
    target.send(JSON.stringify(hello));
  }

  function received(from: SocketLike, data: unknown): void {
    // Read before anything else, so parsing time never counts as travel time.
    const receivedAt = now();
    if (socket !== from) return;
    const message = decode(data);
    if (message === null) return;

    const frame = frameOf(message);
    if (frame !== null) {
      // A frame arrived, so this connection works: start the waits again.
      attempt = 0;
      if (frame.clock.phase === 'final') forgetSession();
      else rememberSession(frame.session);
    }
    if (message.t === 'error' && message.code === 'noSession') forgetSession();

    emit({ type: 'message', message, receivedAt });
  }

  function dropped(from: SocketLike): void {
    // A socket we have already given up on: its close is not a reason to retry.
    if (socket !== from) return;
    socket = null;
    // The retry is booked before anyone is told, so a listener that throws
    // cannot cost the page its reconnect.
    scheduleRetry();
    setStatus('reconnecting');
  }

  function scheduleRetry(): void {
    const last = RECONNECT_MS[RECONNECT_MS.length - 1] ?? 8000;
    const base = RECONNECT_MS[attempt] ?? last;
    attempt += 1;
    const delay = Math.round(base * (JITTER_LEAST + random() * JITTER_SPAN));
    cancelRetry = schedule(() => {
      cancelRetry = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (socket !== null && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) return;
    cancelRetry?.();
    cancelRetry = null;

    const next = createSocket(options.url);
    socket = next;
    next.addEventListener('open', () => {
      if (socket !== next) return;
      // Hello goes out before anyone is told, so it is the first text on
      // every socket whatever a listener does, throwing included.
      sendHello(next);
      setStatus('live');
    });
    next.addEventListener('message', (event) => {
      received(next, event.data);
    });
    next.addEventListener('close', () => {
      dropped(next);
    });
    next.addEventListener('error', () => {
      // A socket that fails raises this before it closes; the close that
      // follows is what schedules the reconnect. Listened for so a failed
      // connection can never become an unhandled event.
    });
    setStatus('connecting');
  }

  function close(): void {
    cancelRetry?.();
    cancelRetry = null;
    attempt = 0;
    const going = socket;
    socket = null;
    going?.close();
    setStatus('closed');
  }

  function send(message: Outbound): boolean {
    // The status is what the feed has been told; the readyState is what the
    // socket is. A dying socket is marked closed before its close event
    // arrives, and takes a text without a word in the meantime, so the status
    // alone would report a message that never left the tab as sent.
    if (status !== 'live' || socket === null || socket.readyState !== SOCKET_OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      // A socket that turned connecting, or was replaced under us, throws
      // here. Not sent.
      return false;
    }
  }

  function simulateDrop(): void {
    if (status !== 'live' || socket === null) return;
    const going = socket;
    // Treated as gone now: a real socket raises its close event later, a
    // fake one never does, and either way that event finds a socket the
    // feed has already given up on and is ignored.
    going.close();
    dropped(going);
  }

  function subscribe(listener: (event: FeedEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { connect, close, send, simulateDrop, subscribe };
}
