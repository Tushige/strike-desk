import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import WebSocket from 'ws';
import type { Frame, Reply, ServerError, ServerMessage } from '@strike-desk/shared';
import { parseServerMessage } from '@strike-desk/shared';
import { createApp } from '../src/app';
import type { App, AppOptions, BuildVersion } from '../src/app';

/**
 * The real app on an ephemeral port, with time as an input: the sampling
 * timer is off, the clock only moves when a test moves it, and the seeds are
 * fixed. A test calls `app.sampleOnce(clock.now())` and awaits the frame that
 * follows; nothing here waits for a duration. The only timers are the
 * failure timeouts that stop a broken test from hanging.
 */

export const TEST_VERSION: BuildVersion = { commit: 'abc1234', buildTime: '2026-01-02T03:04:05Z' };
export const FIXED_SEEDS = [198765432123456, 4242424242, 77, 281474976710655];
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
  /** Messages received and not yet taken. */
  waiting(): number;
  closed(): Promise<number>;
  close(): Promise<number>;
}

export interface Harness {
  app: App;
  clock: FakeClock;
  url: string;
  connect(): TestClient;
  /** One sample at the fake clock's current time. */
  sample(): void;
  close(): Promise<void>;
}

/**
 * The message listener is attached when the socket is made, before `open`,
 * so nothing sent on connect can be missed. Messages without a `t` key (the
 * placeholder tick, the heartbeat) are ignored. Every other message must
 * deep-equal its own schema parse: a field the schema does not name would be
 * stripped by the parse and fail here.
 */
export function connectClient(url: string): TestClient {
  const socket = new WebSocket(url);
  const queue: ServerMessage[] = [];
  let waiter: { resolve: (message: ServerMessage) => void; reject: (error: Error) => void } | null = null;
  let failure: Error | null = null;

  function fail(error: Error): void {
    failure = error;
    const waiting = waiter;
    waiter = null;
    waiting?.reject(error);
  }

  socket.on('message', (data) => {
    let raw: unknown;
    try {
      raw = JSON.parse(toText(data));
    } catch {
      fail(new Error('the server sent text that is not JSON'));
      return;
    }
    if (typeof raw !== 'object' || raw === null || !('t' in raw)) return;
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
  // Without a listener a refused connection would be an unhandled event.
  socket.on('error', () => undefined);

  const closedCode = new Promise<number>((resolve) => {
    socket.once('close', (code) => resolve(code));
  });

  function next(): Promise<ServerMessage> {
    if (failure !== null) return Promise.reject(failure);
    const ready = queue.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter = null;
        reject(new Error(`no message within ${FAILURE_TIMEOUT_MS} ms`));
      }, FAILURE_TIMEOUT_MS);
      waiter = {
        resolve(message) {
          clearTimeout(timer);
          resolve(message);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      };
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
    waiting: () => queue.length,
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

  const clock = fakeClock();
  let drawn = 0;
  const app = createApp({
    staticDir,
    version: TEST_VERSION,
    // Keep the placeholder tick and the heartbeat out of the way.
    tickMs: 3_600_000,
    heartbeatMs: 3_600_000,
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

  return {
    app,
    clock,
    url,
    connect: () => connectClient(url),
    sample: () => app.sampleOnce(clock.now()),
    async close() {
      await app.close();
      rmSync(staticDir, { recursive: true, force: true });
    },
  };
}
