import type { SessionStore, SocketLike, TransportSeam } from './ports';

/**
 * A stand-in for the network, driven entirely by hand. Nothing here is
 * asynchronous, nothing starts a timer and nothing reads a real clock: a
 * test, or the lab page, opens and closes every socket, runs every wait and
 * moves the clock itself. It is never the game's rules and never a real
 * socket.
 */

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;

type SocketEventType = 'open' | 'message' | 'close' | 'error';
type SocketListener = (event: { data?: unknown }) => void;

export interface FakeSocket extends SocketLike {
  /** The address it was opened to. */
  url: string;
  /** Every text handed to `send`, in order. */
  sent: string[];
  closeCalls: number;
  fireOpen(): void;
  fireMessage(data: unknown): void;
  fireClose(): void;
  fireError(): void;
}

function createFakeSocket(url: string): FakeSocket {
  const listeners = new Map<SocketEventType, SocketListener[]>();

  function fire(type: SocketEventType, event: { data?: unknown }): void {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
  }

  const socket: FakeSocket = {
    url,
    readyState: SOCKET_CONNECTING,
    sent: [],
    closeCalls: 0,
    send(text: string) {
      socket.sent.push(text);
    },
    // Counts the call and marks the socket closed, and fires nothing: a real
    // socket's close event comes later, if at all.
    close() {
      socket.closeCalls += 1;
      socket.readyState = SOCKET_CLOSED;
    },
    addEventListener(type: SocketEventType, listener: SocketListener) {
      const already = listeners.get(type);
      if (already === undefined) listeners.set(type, [listener]);
      else already.push(listener);
    },
    fireOpen() {
      socket.readyState = SOCKET_OPEN;
      fire('open', {});
    },
    fireMessage(data: unknown) {
      fire('message', { data });
    },
    fireClose() {
      socket.readyState = SOCKET_CLOSED;
      fire('close', {});
    },
    fireError() {
      fire('error', {});
    },
  };

  return socket;
}

interface Wait {
  ms: number;
  run: () => void;
  done: boolean;
}

export interface FakeTransport {
  /** Hand this to whatever is being tried. */
  seam: TransportSeam;
  /** Every socket made, oldest first. */
  sockets: FakeSocket[];
  /** The socket made most recently. Throws when none was made. */
  last(): FakeSocket;
  /** Starts at 0 and moves only when told to. Refuses to go back. */
  clock: { now(): number; advance(ms: number): void };
  /** Every wait asked for so far, in order, cancelled ones included. */
  waits(): number[];
  /** How many waits have neither run nor been cancelled. */
  pendingWaits(): number;
  /** Runs the oldest wait not yet run or cancelled. Throws when there is none. */
  runNextWait(): void;
  /** The session id in the fake storage, or null. */
  stored(): string | null;
}

export interface FakeTransportOptions {
  /** The address the seam carries. Default `ws://lab.invalid/ws`. */
  url?: string;
  /** A session id already in storage, as after a reload. Default none. */
  session?: string | null;
  /** What every random draw returns. Default 0.5, which leaves a wait unscaled. */
  random?: number;
}

export function createFakeTransport(options: FakeTransportOptions = {}): FakeTransport {
  const sockets: FakeSocket[] = [];
  const asked: Wait[] = [];
  const draw = options.random ?? 0.5;
  let time = 0;

  // A connection keeps one thing in storage, the session id, so the fake
  // holds one value whatever key it is kept under.
  let held: string | null = options.session ?? null;
  const storage: SessionStore = {
    getItem: () => held,
    setItem(_key: string, value: string) {
      held = value;
    },
    removeItem() {
      held = null;
    },
  };

  const seam: TransportSeam = {
    url: options.url ?? 'ws://lab.invalid/ws',
    createSocket(url: string) {
      const socket = createFakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    storage,
    schedule(run: () => void, ms: number) {
      const wait: Wait = { ms, run, done: false };
      asked.push(wait);
      return () => {
        wait.done = true;
      };
    },
    random: () => draw,
    now: () => time,
  };

  return {
    seam,
    sockets,
    last() {
      const socket = sockets[sockets.length - 1];
      if (socket === undefined) throw new Error('no socket has been made');
      return socket;
    },
    clock: {
      now: () => time,
      advance(ms: number) {
        if (ms < 0) throw new Error('the clock never goes back');
        time += ms;
      },
    },
    waits: () => asked.map((wait) => wait.ms),
    pendingWaits: () => asked.filter((wait) => !wait.done).length,
    runNextWait() {
      const next = asked.find((wait) => !wait.done);
      if (next === undefined) throw new Error('nothing is waiting');
      next.done = true;
      next.run();
    },
    stored: () => held,
  };
}

/**
 * The JSON text of a lobby frame, as the server would send one, with
 * `changes` laid over it. Built from a plain object on purpose: text is what
 * a socket carries, and whatever reads it checks it against the shared
 * schema like any other text off the wire.
 */
export function fakeFrameText(changes: Record<string, unknown> = {}): string {
  const frame: Record<string, unknown> = {
    t: 'frame',
    session: 's-1',
    rev: 0,
    step: 0,
    clock: { phase: 'lobby', day: 0, stepsLeft: 0, priceIndex: 0, pace: null },
    companies: [
      { ticker: 'RPUP', name: 'RoboPup' },
      { ticker: 'FIZZ', name: 'Fizzly' },
      { ticker: 'JETK', name: 'JetKicks' },
      { ticker: 'MUNC', name: 'MoonMunch' },
      { ticker: 'PIXL', name: 'PixelPals' },
      { ticker: 'ZAPP', name: 'ZapCharge' },
    ],
    prices: [8400, 4200, 12000, 2800, 6500, 15000],
    minTicketCents: 500,
    board: null,
    quotes: [],
    quoteReals: [],
    quoteHopes: [],
    quoteBreakEvens: [],
    news: [],
    account: { cashCents: 100000000, worthCents: 100000000, capCents: 50000000, canBuy: false },
    positions: [],
    receipts: [],
    days: [],
    stress: false,
    ...changes,
  };
  return JSON.stringify(frame);
}
