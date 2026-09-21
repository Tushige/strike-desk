import type { Frame } from '@strike-desk/shared/protocol';
import type { SocketLike } from '../src/feed/wsFeed';

/**
 * The hand-driven doubles the web tests run on. Nothing here is
 * asynchronous and nothing here starts a timer: a test fires every event
 * itself and moves every wait on by hand, so no test depends on how fast
 * the machine is.
 */

export const CONNECTING = 0;
export const OPEN = 1;
export const CLOSED = 3;

type SocketEventType = 'open' | 'message' | 'close' | 'error';
type SocketListener = (event: { data?: unknown }) => void;

export interface FakeSocket extends SocketLike {
  readyState: number;
  /** Every text handed to `send`, in order. */
  sent: string[];
  closeCalls: number;
  fireOpen(): void;
  fireMessage(data: unknown): void;
  fireClose(): void;
  fireError(): void;
}

export function createFakeSocket(): FakeSocket {
  const listeners = new Map<SocketEventType, SocketListener[]>();

  function fire(type: SocketEventType, event: { data?: unknown }): void {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
  }

  const socket: FakeSocket = {
    readyState: CONNECTING,
    sent: [],
    closeCalls: 0,
    send(text: string) {
      socket.sent.push(text);
    },
    close() {
      socket.closeCalls += 1;
      socket.readyState = CLOSED;
    },
    addEventListener(type: SocketEventType, listener: SocketListener) {
      const already = listeners.get(type);
      if (already === undefined) listeners.set(type, [listener]);
      else already.push(listener);
    },
    fireOpen() {
      socket.readyState = OPEN;
      fire('open', {});
    },
    fireMessage(data: unknown) {
      fire('message', { data });
    },
    fireClose() {
      socket.readyState = CLOSED;
      fire('close', {});
    },
    fireError() {
      fire('error', {});
    },
  };

  return socket;
}

export interface SocketFactory {
  /** Hand this to the feed as its `createSocket`. */
  create(url: string): SocketLike;
  made: FakeSocket[];
  urls: string[];
  /** The socket made most recently. Throws when none was made. */
  last(): FakeSocket;
  /** Sockets that are neither closed nor closing. */
  live(): FakeSocket[];
}

export function createSocketFactory(): SocketFactory {
  const made: FakeSocket[] = [];
  const urls: string[] = [];
  return {
    create(url: string) {
      urls.push(url);
      const socket = createFakeSocket();
      made.push(socket);
      return socket;
    },
    made,
    urls,
    last() {
      const socket = made[made.length - 1];
      if (socket === undefined) throw new Error('no socket has been made');
      return socket;
    },
    live() {
      return made.filter((socket) => socket.readyState !== CLOSED);
    },
  };
}

export interface ScheduledRun {
  ms: number;
  run: () => void;
  cancelled: boolean;
}

export interface ManualScheduler {
  /** Hand this to the feed as its `schedule`. */
  schedule(run: () => void, ms: number): () => void;
  asked: ScheduledRun[];
  /** The waits asked for so far, in order, cancelled ones included. */
  delays(): number[];
  /** Run the oldest wait that is still pending. */
  runNext(): void;
  pending(): number;
}

export function createManualScheduler(): ManualScheduler {
  const asked: ScheduledRun[] = [];
  return {
    schedule(run: () => void, ms: number) {
      const entry: ScheduledRun = { ms, run, cancelled: false };
      asked.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    asked,
    delays: () => asked.map((entry) => entry.ms),
    runNext() {
      const next = asked.find((entry) => !entry.cancelled);
      if (next === undefined) throw new Error('nothing is waiting');
      next.cancelled = true;
      next.run();
    },
    pending: () => asked.filter((entry) => !entry.cancelled).length,
  };
}

export interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  held: Map<string, string>;
}

export function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const held = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem(key: string, value: string) {
      held.set(key, value);
    },
    removeItem(key: string) {
      held.delete(key);
    },
    held,
  };
}

/**
 * A live-form lobby frame, exactly as the server sends one: the clock, the
 * six names, six whole cent prices, the cheapest tradable price and the
 * starting account, with every other section empty. A test that passes
 * `quotes` gets matching real and hope values (all hope) and one break-even
 * per ticket (all 0), unless it passes its own.
 */
export function testFrame(changes: Partial<Frame> = {}): Frame {
  const quotes = changes.quotes ?? [];
  return {
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
    quotes,
    quoteReals: quotes.map(() => 0),
    quoteHopes: [...quotes],
    quoteBreakEvens: quotes.map(() => 0),
    news: [],
    account: { cashCents: 100_000_000, worthCents: 100_000_000, capCents: 50_000_000, canBuy: false },
    positions: [],
    receipts: [],
    days: [],
    stress: false,
    ...changes,
  };
}
