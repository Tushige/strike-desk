import type { Command, Frame, Hello, ServerMessage } from '@strike-desk/shared/protocol';
import { PROTOCOL_VERSION } from '@strike-desk/shared/protocol';
import type { Feed, FeedEvent, FeedStatus } from '@strike-desk/shared/feed';
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

  function emit(event: FeedEvent): void {
    for (const listener of [...listeners]) listener(event);
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

    emit({ type: 'message', message });
  }

  function dropped(from: SocketLike): void {
    // A socket we have already given up on: its close is not a reason to retry.
    if (socket !== from) return;
    socket = null;
    setStatus('reconnecting');
    scheduleRetry();
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
      setStatus('live');
      sendHello(next);
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

  function send(command: Command): void {
    if (status !== 'live' || socket === null) return;
    socket.send(JSON.stringify(command));
  }

  function subscribe(listener: (event: FeedEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { connect, close, send, subscribe };
}
