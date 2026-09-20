import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import WebSocket from 'ws';
import type { Frame, Reply, ServerError, ServerMessage } from '@strike-desk/shared';
import { parseServerMessage } from '@strike-desk/shared';
import { createApp } from '../src/app';
import type { App, AppOptions, BuildVersion } from '../src/app';

/**
 * The real app on an ephemeral port, with time as an input: neither the
 * sampling timer nor the heartbeat timer exists, the clock only moves when a
 * test moves it, and the seeds are fixed. A test calls `sample()` or
 * `heartbeat()` and awaits what follows; nothing here waits for a duration.
 * The only timers are the failure timeouts that stop a broken test hanging.
 */

export const TEST_VERSION: BuildVersion = { commit: 'abc1234', buildTime: '2026-01-02T03:04:05Z' };
export const FIXED_SEEDS = [198765432123456, 4242424242, 77, 281474976710655];
/** The one asset the temporary static directory holds, so cache headers can be checked. */
export const TEST_ASSET_PATH = '/assets/app-abc123.js';
const FAILURE_TIMEOUT_MS = 5000;

export interface FakeClock {
  now(): number;
  advance(ms: number): void;
}

export function fakeClock(startMs = 1_000_000): FakeClock {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance(ms: number) {
      if (ms < 0) throw new Error('a monotonic clock never goes back');
      nowMs += ms;
    },
  };
}

function toText(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString();
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  return Buffer.from(data).toString();
}

export interface TestClient {
  socket: WebSocket;
  opened(): Promise<void>;
  /** Send any value as JSON. */
  send(message: unknown): void;
  sendText(text: string): void;
  /** The next message that has a `t` key, exactly as it arrived. */
  next(): Promise<ServerMessage>;
  nextFrame(): Promise<Frame>;
  nextReply(): Promise<Reply>;
  nextError(): Promise<ServerError>;
  /** The next message with no `t` key — on this wire, only the heartbeat. */
  nextOther(): Promise<unknown>;
  /** Everything that has arrived, in order, exactly as parsed. */
  received(): unknown[];
  /** Protocol messages received and not yet taken. */
  waiting(): number;
  /** Protocol-level pings the server has sent this socket. */
  pings(): number;
  /** Resolves once this socket has been pinged `count` times. */
  awaitPings(count: number): Promise<number>;
  closed(): Promise<number>;
  close(): Promise<number>;
}

export interface ConnectOptions {
  /** Query appended to the socket address, for example `probe=silent`. */
  search?: string;
  socket?: WebSocket.ClientOptions;
}

export interface Harness {
  app: App;
  clock: FakeClock;
  /** The socket address, `ws://127.0.0.1:<port>/ws`. */
  url: string;
  /** The page address, `http://127.0.0.1:<port>`. */
  baseUrl: string;
  connect(options?: ConnectOptions): TestClient;
  /** One sample at the fake clock's current time. */
  sample(): void;
  /** One heartbeat round at the fake clock's current time. */
  heartbeat(): void;
  close(): Promise<void>;
}

/**
 * The message listener is attached when the socket is made, before `open`,
 * so nothing sent on connect can be missed. Every message that has a `t` key
 * must deep-equal its own schema parse: a field the schema does not name
 * would be stripped by the parse and fail here. A message without a `t` key
 * is not dropped — it goes to `nextOther` and to `received`, so a test can
 * assert on exactly what a connection was sent, and on what it was not.
 */
export function connectClient(url: string, socketOptions?: WebSocket.ClientOptions): TestClient {
  const socket = new WebSocket(url, socketOptions);
  const queue: ServerMessage[] = [];
  const others: unknown[] = [];
  const all: unknown[] = [];
  let pings = 0;
  let waiter: { resolve: (message: ServerMessage) => void; reject: (error: Error) => void } | null = null;
  let otherWaiter: { resolve: (message: unknown) => void; reject: (error: Error) => void } | null = null;
  let pingWaiter: { count: number; resolve: (count: number) => void } | null = null;
  let failure: Error | null = null;

  function fail(error: Error): void {
    failure = error;
    const waiting = waiter;
    const waitingOther = otherWaiter;
    waiter = null;
    otherWaiter = null;
    waiting?.reject(error);
    waitingOther?.reject(error);
  }

  socket.on('message', (data) => {
    let raw: unknown;
    try {
      raw = JSON.parse(toText(data));
    } catch {
      fail(new Error('the server sent text that is not JSON'));
      return;
    }
    all.push(raw);
    if (typeof raw !== 'object' || raw === null || !('t' in raw)) {
      const waiting = otherWaiter;
      if (waiting !== null) {
        otherWaiter = null;
        waiting.resolve(raw);
      } else {
        others.push(raw);
      }
      return;
    }
    const parsed = parseServerMessage(raw);
    if (parsed === null) {
      fail(new Error(`the server sent a message that fails its schema: ${JSON.stringify(raw)}`));
      return;
    }
    if (!isDeepStrictEqual(parsed, raw)) {
      fail(new Error(`the server sent a field its schema does not name: ${JSON.stringify(raw)}`));
      return;
    }
    const waiting = waiter;
    if (waiting !== null) {
      waiter = null;
      waiting.resolve(parsed);
    } else {
      queue.push(parsed);
    }
  });
  socket.on('ping', () => {
    pings += 1;
    const waiting = pingWaiter;
    if (waiting !== null && pings >= waiting.count) {
      pingWaiter = null;
      waiting.resolve(pings);
    }
  });
  // Without a listener a refused connection would be an unhandled event.
  socket.on('error', () => undefined);

  const closedCode = new Promise<number>((resolve) => {
    socket.once('close', (code) => resolve(code));
  });

  /** A promise that rejects rather than hanging when the thing never arrives. */
  function awaiting<T>(what: string, register: (settle: { resolve: (value: T) => void; reject: (error: Error) => void }) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter = null;
        otherWaiter = null;
        pingWaiter = null;
        reject(new Error(`no ${what} within ${FAILURE_TIMEOUT_MS} ms`));
      }, FAILURE_TIMEOUT_MS);
      register({
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  function next(): Promise<ServerMessage> {
    if (failure !== null) return Promise.reject(failure);
    const ready = queue.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    return awaiting<ServerMessage>('message', (settle) => {
      waiter = settle;
    });
  }

  function nextOther(): Promise<unknown> {
    if (failure !== null) return Promise.reject(failure);
    if (others.length > 0) return Promise.resolve(others.shift());
    return awaiting<unknown>('message without a t key', (settle) => {
      otherWaiter = settle;
    });
  }

  async function nextOf<T extends ServerMessage>(t: T['t']): Promise<T> {
    const message = await next();
    if (message.t !== t) throw new Error(`expected a ${t}, got ${JSON.stringify(message)}`);
    return message as T;
  }

  return {
    socket,
    opened() {
      return new Promise((resolve, reject) => {
        if (socket.readyState === socket.OPEN) {
          resolve();
          return;
        }
        socket.once('open', () => resolve());
        socket.once('error', reject);
      });
    },
    send(message: unknown) {
      socket.send(JSON.stringify(message));
    },
    sendText(text: string) {
      socket.send(text);
    },
    next,
    nextFrame: () => nextOf<Frame>('frame'),
    nextReply: () => nextOf<Reply>('reply'),
    nextError: () => nextOf<ServerError>('error'),
    nextOther,
    received: () => [...all],
    waiting: () => queue.length,
    pings: () => pings,
    awaitPings(count: number) {
      if (pings >= count) return Promise.resolve(pings);
      return awaiting<number>(`${count} pings`, (settle) => {
        pingWaiter = { count, resolve: settle.resolve };
      });
    },
    closed: () => closedCode,
    close() {
      socket.close();
      return closedCode;
    },
  };
}

export async function startHarness(overrides: Partial<AppOptions> = {}): Promise<Harness> {
  const staticDir = mkdtempSync(path.join(tmpdir(), 'strike-desk-harness-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
  mkdirSync(path.join(staticDir, 'assets'));
  writeFileSync(path.join(staticDir, TEST_ASSET_PATH.slice(1)), 'console.log("placeholder");');

  const clock = fakeClock();
  let drawn = 0;
  const app = createApp({
    staticDir,
    version: TEST_VERSION,
    // No timer of any kind: both rounds are driven by hand.
    heartbeatMs: 0,
    sampleMs: 0,
    now: () => clock.now(),
    drawSeed: () => {
      const seed = FIXED_SEEDS[drawn % FIXED_SEEDS.length] ?? 0;
      drawn += 1;
      return seed;
    },
    ...overrides,
  });

  const port = await new Promise<number>((resolve, reject) => {
    app.server.listen(0, '127.0.0.1', () => {
      const address = app.server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('server has no assigned port'));
        return;
      }
      resolve(address.port);
    });
  });
  const url = `ws://127.0.0.1:${port}/ws`;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    clock,
    url,
    baseUrl,
    connect: (options: ConnectOptions = {}) =>
      connectClient(options.search === undefined ? url : `${url}?${options.search}`, options.socket),
    sample: () => app.sampleOnce(clock.now()),
    heartbeat: () => app.heartbeatOnce(clock.now()),
    async close() {
      await app.close();
      rmSync(staticDir, { recursive: true, force: true });
    },
  };
}
