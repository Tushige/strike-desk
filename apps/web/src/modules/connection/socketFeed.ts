import type { Feed, FeedEvent, FeedStatus, Outbound } from '@strike-desk/shared/feed';
import type { Frame, Hello, ServerMessage } from '@strike-desk/shared/protocol';
import { PROTOCOL_VERSION, parseServerMessage } from '@strike-desk/shared/protocol';
import type { SocketLike, TransportSeam } from './ports';

/**
 * The connection's own feed: one line to one session, over whatever the
 * transport seam hands it. It opens the socket, says hello (naming the
 * session it already had, if any), reconnects after a drop with a growing
 * wait, and drops anything that fails the schema before a listener sees it.
 *
 * It reads no global. Every socket, timer, clock reading, random draw and
 * stored value comes from the seam, and the key the session is kept under is
 * handed in beside it, so the same code runs in the game, in the lab and
 * under a test that drives all of it by hand.
 */

/** How long to wait before each reconnect attempt. The last wait repeats. */
const RECONNECT_MS = [1000, 2000, 4000, 8000];
const LONGEST_WAIT_MS = 8000;
/** Each wait is scaled by a factor in [0.8, 1.2) so reconnects do not line up. */
const JITTER_LEAST = 0.8;
const JITTER_SPAN = 0.4;

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

/** Where the reconnecting stands: what a status line needs and the feed alone knows. */
export interface RetryView {
  /** Attempts booked since a frame last arrived; 0 while the line works. */
  attempt: number;
  /** When the booked attempt is due on the seam's clock, or null when none is waiting. */
  retryAt: number | null;
}

export interface SocketFeed extends Feed {
  retry(): RetryView;
  /**
   * Hand over a text exactly as it is. A command's text is built once and
   * every send reuses it, so a resend can never differ from the first send.
   * Same answer as `send`: whether an open socket took it.
   */
  sendText(text: string): boolean;
}

/** Text off the wire, checked against the shared schema. Null for anything else; never throws. */
function decode(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  return parseServerMessage(raw);
}

/** A reply carries a frame too, and a frame is what names the session. */
export function frameOf(message: ServerMessage): Frame | null {
  if (message.t === 'frame') return message;
  if (message.t === 'reply') return message.frame;
  return null;
}

/**
 * Throw what the listeners threw, once all of them have run: the error by
 * itself when there was one, all of them together when there were more, so a
 * second broken listener is as loud as the first.
 */
export function throwAll(errors: readonly unknown[]): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  const first = errors[0];
  throw new AggregateError(errors, first instanceof Error ? first.message : 'several listeners failed');
}

export function createSocketFeed(seam: TransportSeam, sessionKey: string, board?: number): SocketFeed {
  const { createSocket, schedule, random, now, storage } = seam;

  const listeners = new Set<(event: FeedEvent) => void>();
  let socket: SocketLike | null = null;
  /** The socket whose hello asked for a board size and has not been refused yet. */
  let boardAskedOn: SocketLike | null = null;
  let status: FeedStatus = 'closed';
  let sessionId = readSession();
  let attempt = 0;
  let retryAt: number | null = null;
  let cancelRetry: (() => void) | null = null;

  // Storage throws in some private-browsing modes, so every use is guarded.
  function readSession(): string | null {
    try {
      return storage?.getItem(sessionKey) ?? null;
    } catch {
      return null;
    }
  }

  function rememberSession(id: string): void {
    if (id === sessionId) return;
    sessionId = id;
    try {
      storage?.setItem(sessionKey, id);
    } catch {
      // Keeping it in memory is enough for this page load.
    }
  }

  function forgetSession(): void {
    sessionId = null;
    try {
      storage?.removeItem(sessionKey);
    } catch {
      // Nothing to do: the id is already gone from memory.
    }
  }

  // Every listener gets the event, whatever the ones before it did.
  function emit(event: FeedEvent): void {
    const errors: unknown[] = [];
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        errors.push(error);
      }
    }
    throwAll(errors);
  }

  function setStatus(next: FeedStatus): void {
    if (next === status) return;
    status = next;
    emit({ type: 'status', status: next });
  }

  /**
   * The board size is asked for only when a new game is being made: the
   * server reads it when it creates a session and never when it resumes one,
   * so a resume that named it would risk being refused and losing the game.
   */
  function sendHello(target: SocketLike, withBoard: boolean): void {
    const hello: Hello = { t: 'hello', v: PROTOCOL_VERSION };
    if (sessionId !== null) hello.session = sessionId;
    const asking = withBoard && board !== undefined && sessionId === null;
    if (asking) hello.board = board;
    boardAskedOn = asking ? target : null;
    target.send(JSON.stringify(hello));
  }

  function received(from: SocketLike, data: unknown): void {
    // A socket already given up on has nothing to say.
    if (socket !== from) return;
    // Read before parsing, so parsing time never counts as travel time.
    const receivedAt = now();
    const message = decode(data);
    if (message === null) return;

    const frame = frameOf(message);
    if (frame !== null) {
      // A frame arrived, so this line works: start the waits again. The
      // board size asked for, if any, was granted.
      attempt = 0;
      boardAskedOn = null;
      if (frame.clock.phase === 'final') forgetSession();
      else rememberSession(frame.session);
    }
    if (message.t === 'error' && message.code === 'noSession') forgetSession();
    // The server would not build the board size asked for: ask once more,
    // for its normal board and a fresh game, on the same socket.
    if (message.t === 'error' && message.code === 'badMessage' && message.commandId === undefined && boardAskedOn === from) {
      forgetSession();
      sendHello(from, false);
      return;
    }

    emit({ type: 'message', message, receivedAt });
  }

  function dropped(from: SocketLike): void {
    // A socket already given up on: its close is not a reason to retry.
    if (socket !== from) return;
    socket = null;
    // The retry is booked before anyone is told, so a listener that throws
    // cannot cost the page its reconnect.
    bookRetry();
    setStatus('reconnecting');
  }

  function clearRetry(): void {
    cancelRetry?.();
    cancelRetry = null;
    retryAt = null;
  }

  function bookRetry(): void {
    // Never two attempts waiting: whatever was booked before is called off.
    clearRetry();
    const base = RECONNECT_MS[attempt] ?? LONGEST_WAIT_MS;
    attempt += 1;
    const delay = Math.round(base * (JITTER_LEAST + random() * JITTER_SPAN));
    retryAt = now() + delay;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      retryAt = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (socket !== null && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) return;
    clearRetry();

    const next = createSocket(seam.url);
    socket = next;
    next.addEventListener('open', () => {
      if (socket !== next) return;
      // Hello goes out before anyone is told, so it is the first text on
      // every socket whatever a listener does, throwing included.
      sendHello(next, true);
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
      // follows is what books the reconnect. Listened for so a failed
      // connection can never become an unhandled event.
    });
    setStatus('connecting');
  }

  function close(): void {
    clearRetry();
    attempt = 0;
    const going = socket;
    socket = null;
    going?.close();
    setStatus('closed');
  }

  function sendText(text: string): boolean {
    // The status is what the feed has been told; the readyState is what the
    // socket is. A dying socket is marked closed before its close event
    // arrives and takes a text without a word in the meantime, so the status
    // alone would report a text that never left the tab as sent.
    if (status !== 'live' || socket === null || socket.readyState !== SOCKET_OPEN) return false;
    try {
      socket.send(text);
      return true;
    } catch {
      // A socket that turned connecting, or was replaced under us, throws
      // here. Not sent.
      return false;
    }
  }

  function send(message: Outbound): boolean {
    return sendText(JSON.stringify(message));
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

  return {
    connect,
    close,
    send,
    sendText,
    simulateDrop,
    subscribe,
    retry: () => ({ attempt, retryAt }),
  };
}
