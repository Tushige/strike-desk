import type { SessionStore, SocketLike, TransportSeam } from './ports';

/**
 * Two stand-ins for the network, neither the game's rules and neither a real
 * socket.
 *
 * `createFakeTransport` is driven entirely by hand. Nothing in it is
 * asynchronous, nothing starts a timer and nothing reads a real clock: a test
 * opens and closes every socket, runs every wait and moves the clock itself.
 *
 * `createLoopbackTransport`, further down, answers by itself on the timer and
 * clock it is handed, which is what the lab page needs.
 */

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;

type SocketEventType = 'open' | 'message' | 'close' | 'error';
type SocketListener = (event: { data?: unknown }) => void;

export interface FakeSocket extends SocketLike {
  /** The address it was opened to. */
  url: string;
  /** Every text this socket carried, in order: the ones handed over while it was open. */
  sent: string[];
  /** Every text handed over once it was closing or closed, which a real socket throws away. */
  discarded: string[];
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
    discarded: [],
    closeCalls: 0,
    // A real socket refuses a send only while it is still connecting; once it
    // is closing or closed it takes the text and quietly throws it away, so
    // the caller is never told. Both are worth catching, so the fake does the
    // same and keeps what it threw away.
    send(text: string) {
      if (socket.readyState === SOCKET_CONNECTING) throw new Error('the socket is still connecting');
      if (socket.readyState !== SOCKET_OPEN) {
        socket.discarded.push(text);
        return;
      }
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

/**
 * A stand-in for the network that answers by itself: every socket it makes is
 * answered by a small server living in the page. It opens a socket after a
 * short wait, answers a hello with a frame, and then sends a frame with a
 * rising step five times a second. It holds no rules of the game and opens no
 * real socket; the timer, the clock and the random draw it runs on are handed
 * in, so a page gives it the browser's and a test gives it fake ones.
 */

/** How long a socket takes to open, and how long the server takes to answer. */
const LOOPBACK_OPENS_AFTER_MS = 120;
const LOOPBACK_ANSWERS_AFTER_MS = 40;
/** Five frames a second. */
const LOOPBACK_FRAME_EVERY_MS = 200;
const LOOPBACK_SESSION = 'lab-1';
/** As many receipts as a real frame carries. */
const LOOPBACK_FRAME_RECEIPTS = 20;

export interface LoopbackOptions {
  schedule: TransportSeam['schedule'];
  now: TransportSeam['now'];
  random: TransportSeam['random'];
}

export interface LoopbackTransport {
  /** Hand this to the connection being shown. */
  seam: TransportSeam;
  /** The open socket closes the way a network drop closes it: no word from either side first. */
  cut(): void;
  /** While on, the server sends nothing at all, and the sockets stay open. */
  silent(on: boolean): void;
  /** The next command is taken, and whatever it buys is bought, but its reply is never sent. */
  loseNextReply(): void;
  /** The next command is handed to the socket and goes no further: the server never hears of it. */
  dropNextCommand(): void;
  /** How many tickets the server holds: one per buy it accepted, however often that buy arrived. */
  tickets(): number;
  /** Every text a socket was handed, oldest first, with which socket it was (1 for the first). */
  log(): readonly LoopbackLogEntry[];
}

export interface LoopbackLogEntry {
  socket: number;
  text: string;
}

export function createLoopbackTransport(options: LoopbackOptions): LoopbackTransport {
  const { schedule, now, random } = options;
  let current: FakeSocket | null = null;
  let quiet = false;
  let step = 0;

  // Kept in memory: the lab never touches the browser's storage.
  const kept = new Map<string, string>();
  const storage: SessionStore = {
    getItem: (key) => kept.get(key) ?? null,
    setItem(key, value) {
      kept.set(key, value);
    },
    removeItem(key) {
      kept.delete(key);
    },
  };

  function isUp(socket: FakeSocket): boolean {
    return current === socket && socket.readyState === SOCKET_OPEN;
  }

  /** What the server remembers of a command: the first answer it gave, kept for good. */
  const receipts = new Map<string, Record<string, unknown>>();
  let bought = 0;
  let rev = 0;
  let replyToLose = false;
  let commandToDrop = false;
  const handed: LoopbackLogEntry[] = [];
  const socketNumbers = new Map<FakeSocket, number>();

  /** A day of trading that never ends: made up, and only so that a buy of day 1 is a buy of today. */
  const LOOPBACK_CLOCK = { phase: 'open', day: 1, stepsLeft: 100, priceIndex: 0, pace: 3 };

  /**
   * A frame of the stand-in's. Its latest receipts ride on every one, which is
   * what the wire contract allows and what lets a frame settle a command. The
   * real service sends no receipts on any frame today, so what is seen here
   * of a frame settling a command is the connection's half of that, proved
   * ahead of the service's.
   */
  function frameNow(): Record<string, unknown> {
    step += 1;
    const latest = [...receipts.values()].slice(-LOOPBACK_FRAME_RECEIPTS);
    const text = fakeFrameText({ session: LOOPBACK_SESSION, rev, step, clock: LOOPBACK_CLOCK, receipts: latest });
    return JSON.parse(text) as Record<string, unknown>;
  }

  function sendFrame(socket: FakeSocket): void {
    if (quiet || !isUp(socket)) return;
    socket.fireMessage(JSON.stringify(frameNow()));
  }

  /**
   * One command, the way a server with safe retries takes it: an id seen
   * before gets its first answer back and nothing else happens. Only a buy
   * seen for the first time buys a ticket.
   */
  function serverTakesCommand(socket: FakeSocket, kind: string, commandId: string): void {
    let receipt = receipts.get(commandId);
    if (receipt === undefined) {
      rev += 1;
      receipt = { commandId, kind, step, outcome: 'accepted' };
      if (kind === 'buy') {
        bought += 1;
        receipt.positionId = `p-${String(bought)}`;
      }
      receipts.set(commandId, receipt);
    }
    if (replyToLose) {
      // Taken, stored, and the answer lost on the way back.
      replyToLose = false;
      return;
    }
    const answered = receipt;
    schedule(() => {
      if (quiet || !isUp(socket)) return;
      socket.fireMessage(JSON.stringify({ t: 'reply', receipt: answered, frame: frameNow() }));
    }, LOOPBACK_ANSWERS_AFTER_MS);
  }

  function keepSending(socket: FakeSocket): void {
    schedule(() => {
      if (!isUp(socket)) return;
      sendFrame(socket);
      keepSending(socket);
    }, LOOPBACK_FRAME_EVERY_MS);
  }

  /** The server's side of a text the page handed to `socket`. */
  function serverTakes(socket: FakeSocket, text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null || !('t' in message)) return;
    if (message.t === 'hello') {
      schedule(() => {
        sendFrame(socket);
      }, LOOPBACK_ANSWERS_AFTER_MS);
      return;
    }
    if (typeof message.t !== 'string' || !('commandId' in message) || typeof message.commandId !== 'string') return;
    if (commandToDrop) {
      // Handed to the socket and gone: the server never hears of it.
      commandToDrop = false;
      return;
    }
    serverTakesCommand(socket, message.t, message.commandId);
  }

  const seam: TransportSeam = {
    url: 'ws://lab.invalid/ws',
    createSocket(url: string) {
      const socket = createFakeSocket(url);
      const handOver = socket.send.bind(socket);
      socketNumbers.set(socket, socketNumbers.size + 1);
      socket.send = (text: string) => {
        const carried = socket.sent.length;
        handOver(text);
        if (socket.sent.length === carried) return;
        handed.push({ socket: socketNumbers.get(socket) ?? 0, text });
        serverTakes(socket, text);
      };
      current = socket;
      schedule(() => {
        // Closed by the page while it was still opening: it never opens.
        if (current !== socket || socket.readyState !== SOCKET_CONNECTING) return;
        socket.fireOpen();
        keepSending(socket);
      }, LOOPBACK_OPENS_AFTER_MS);
      return socket;
    },
    storage,
    schedule,
    random,
    now,
  };

  return {
    seam,
    cut() {
      const going = current;
      if (going === null || going.readyState !== SOCKET_OPEN) return;
      current = null;
      going.fireClose();
    },
    silent(on: boolean) {
      quiet = on;
    },
    loseNextReply() {
      replyToLose = true;
    },
    dropNextCommand() {
      commandToDrop = true;
    },
    tickets: () => bought,
    log: () => handed,
  };
}
