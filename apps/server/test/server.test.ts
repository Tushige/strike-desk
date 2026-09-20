import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app';
import type { App, BuildVersion } from '../src/app';

const TEST_VERSION: BuildVersion = { commit: 'abc1234', buildTime: '2026-01-02T03:04:05Z' };

let staticDir: string;
let app: App;
let closed = false;

interface TickCollector {
  socket: WebSocket;
  opened(): Promise<void>;
  waitForCount(count: number): Promise<number[]>;
}

/**
 * `ws`'s "message" event data is typed as `Buffer | ArrayBuffer | Buffer[]`
 * (never `string`) — a plain `.toString()` silently gives `"[object
 * ArrayBuffer]"` for the ArrayBuffer case instead of the frame's text.
 */
function toText(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString();
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString();
  }
  return Buffer.from(data).toString();
}

function getPort(instance: App): number {
  const address = instance.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('server has no assigned port');
  }
  return address.port;
}

function listen(instance: App): Promise<number> {
  return new Promise((resolve) => {
    instance.server.listen(0, '127.0.0.1', () => resolve(getPort(instance)));
  });
}

/**
 * Attaches the message listener at socket-creation time — before awaiting
 * `open` — so the tick sent immediately on connect can never be missed
 * by a listener added later on a subsequent microtask.
 */
function collectTicks(url: string): TickCollector {
  const socket = new WebSocket(url);
  const ticks: number[] = [];
  let waiter: { count: number; resolve: (values: number[]) => void } | null = null;

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(toText(data)) as { type: string; tick: number };
      if (parsed.type === 'tick') {
        ticks.push(parsed.tick);
        if (waiter !== null && ticks.length >= waiter.count) {
          const { count, resolve } = waiter;
          waiter = null;
          resolve(ticks.slice(0, count));
        }
      }
    } catch {
      // Ignore malformed frames.
    }
  });

  return {
    socket,
    opened() {
      return new Promise((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
      });
    },
    waitForCount(count: number) {
      if (ticks.length >= count) {
        return Promise.resolve(ticks.slice(0, count));
      }
      return new Promise((resolve) => {
        waiter = { count, resolve };
      });
    },
  };
}

beforeEach(() => {
  closed = false;
  staticDir = mkdtempSync(path.join(tmpdir(), 'strike-desk-smoke-'));
  writeFileSync(
    path.join(staticDir, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>',
  );
  mkdirSync(path.join(staticDir, 'assets'));
  writeFileSync(path.join(staticDir, 'assets', 'app-abc123.js'), 'console.log("placeholder");');
});

afterEach(async () => {
  if (!closed) {
    await app.close();
  }
  rmSync(staticDir, { recursive: true, force: true });
});

describe('ws tick', () => {
  it('ws tick delivers messages increasing by exactly 1', async () => {
    app = createApp({ staticDir, tickMs: 20, version: TEST_VERSION });
    const port = await listen(app);
    const client = collectTicks(`ws://127.0.0.1:${port}/ws`);
    await client.opened();

    const ticks = await client.waitForCount(5);
    client.socket.close();

    // The timer runs from app creation, so the first value is whatever the
    // counter has reached by the time this client connects, not always 0.
    expect(Number.isInteger(ticks[0])).toBe(true);
    expect(ticks[0]).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]).toBe((ticks[i - 1] as number) + 1);
    }
  });

  it('ws tick sends the current value on connect, without waiting for the timer', async () => {
    // A timer this slow never fires during the test, so the only message
    // that can arrive is the one sent on connect.
    app = createApp({ staticDir, tickMs: 60_000, version: TEST_VERSION });
    const port = await listen(app);
    const client = collectTicks(`ws://127.0.0.1:${port}/ws`);
    await client.opened();

    const ticks = await client.waitForCount(1);
    client.socket.close();

    expect(ticks).toEqual([0]);
  });

  it('ws tick with two clients: both sequences agree on order', async () => {
    app = createApp({ staticDir, tickMs: 20, version: TEST_VERSION });
    const port = await listen(app);
    const clientA = collectTicks(`ws://127.0.0.1:${port}/ws`);
    const clientB = collectTicks(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([clientA.opened(), clientB.opened()]);

    const [ticksA, ticksB] = await Promise.all([clientA.waitForCount(5), clientB.waitForCount(5)]);
    clientA.socket.close();
    clientB.socket.close();

    for (let i = 1; i < ticksA.length; i += 1) {
      expect(ticksA[i]).toBe((ticksA[i - 1] as number) + 1);
    }
    for (let i = 1; i < ticksB.length; i += 1) {
      expect(ticksB[i]).toBe((ticksB[i - 1] as number) + 1);
    }

    const commonFromA = ticksA.filter((tick) => ticksB.includes(tick));
    const commonFromB = ticksB.filter((tick) => ticksA.includes(tick));
    expect(commonFromA).toEqual(commonFromB);
    expect([...commonFromA].sort((a, b) => a - b)).toEqual(commonFromA);
  });
});

describe('healthz', () => {
  it('healthz answers 200 with ok true, the build commit and build time, and nothing else', async () => {
    app = createApp({ staticDir, tickMs: 1000, version: TEST_VERSION });
    const port = await listen(app);
    const baseUrl = `http://127.0.0.1:${port}`;

    const getRes = await fetch(`${baseUrl}/healthz`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toContain('application/json');
    const body = await getRes.json();
    expect(body).toEqual({ ok: true, commit: TEST_VERSION.commit, buildTime: TEST_VERSION.buildTime });
    expect(Object.keys(body as object).sort()).toEqual(['buildTime', 'commit', 'ok']);

    const postRes = await fetch(`${baseUrl}/healthz`, { method: 'POST' });
    expect(postRes.status).toBe(405);
  });

  it('healthz: the tick message carries no version fields', async () => {
    app = createApp({ staticDir, tickMs: 20, version: TEST_VERSION });
    const port = await listen(app);

    const firstMessage = await new Promise<unknown>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      socket.once('message', (data) => {
        try {
          resolve(JSON.parse(toText(data)));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          socket.close();
        }
      });
      socket.once('error', reject);
    });

    expect(Object.keys(firstMessage as object).sort()).toEqual(['tick', 'type']);
  });
});

interface ParsedMessage {
  type: string;
  tick?: number;
}

interface MessageCollector {
  socket: WebSocket;
  opened(): Promise<void>;
  waitForCount(count: number, predicate?: (message: ParsedMessage) => boolean): Promise<ParsedMessage[]>;
  waitForPings(count: number): Promise<number>;
  messages(): ParsedMessage[];
  pingCount(): number;
}

/**
 * Like collectTicks, but keeps every parsed message (not only ticks) and
 * counts protocol-level ping frames, so the heartbeat message and the
 * ping/terminate cycle can be tested directly.
 */
function collectMessages(url: string, wsOptions?: WebSocket.ClientOptions): MessageCollector {
  const socket = new WebSocket(url, wsOptions);
  const messages: ParsedMessage[] = [];
  let pings = 0;
  let messageWaiter: {
    count: number;
    predicate?: (message: ParsedMessage) => boolean;
    resolve: (values: ParsedMessage[]) => void;
  } | null = null;
  let pingWaiter: { count: number; resolve: (count: number) => void } | null = null;

  function matching(predicate?: (message: ParsedMessage) => boolean): ParsedMessage[] {
    return predicate ? messages.filter(predicate) : messages;
  }

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(toText(data)) as ParsedMessage;
      messages.push(parsed);
    } catch {
      return;
    }
    if (messageWaiter !== null) {
      const found = matching(messageWaiter.predicate);
      if (found.length >= messageWaiter.count) {
        const { count, predicate, resolve } = messageWaiter;
        messageWaiter = null;
        resolve(matching(predicate).slice(0, count));
      }
    }
  });

  socket.on('ping', () => {
    pings += 1;
    if (pingWaiter !== null && pings >= pingWaiter.count) {
      const { resolve } = pingWaiter;
      pingWaiter = null;
      resolve(pings);
    }
  });

  return {
    socket,
    opened() {
      return new Promise((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
      });
    },
    waitForCount(count, predicate) {
      const found = matching(predicate);
      if (found.length >= count) {
        return Promise.resolve(found.slice(0, count));
      }
      return new Promise((resolve) => {
        messageWaiter = { count, predicate, resolve };
      });
    },
    waitForPings(count) {
      if (pings >= count) {
        return Promise.resolve(pings);
      }
      return new Promise((resolve) => {
        pingWaiter = { count, resolve };
      });
    },
    messages() {
      return messages;
    },
    pingCount() {
      return pings;
    },
  };
}

describe('heartbeat', () => {
  it('heartbeat: a quiet connection receives repeated hb messages and no ticks', async () => {
    app = createApp({ staticDir, tickMs: 20, heartbeatMs: 40, version: TEST_VERSION });
    const port = await listen(app);
    const client = collectMessages(`ws://127.0.0.1:${port}/ws?probe=quiet`);
    await client.opened();

    const hbMessages = await client.waitForCount(2, (message) => message.type === 'hb');
    client.socket.close();

    expect(hbMessages.length).toBeGreaterThanOrEqual(2);
    expect(client.messages().some((message) => message.type === 'tick')).toBe(false);
  }, 10000);

  it('heartbeat: a normal connection receives ticks and no hb messages', async () => {
    app = createApp({ staticDir, tickMs: 20, heartbeatMs: 40, version: TEST_VERSION });
    const port = await listen(app);
    const client = collectMessages(`ws://127.0.0.1:${port}/ws`);
    await client.opened();

    await client.waitForCount(5, (message) => message.type === 'tick');
    client.socket.close();

    expect(client.messages().some((message) => message.type === 'hb')).toBe(false);
  }, 10000);

  it('heartbeat: a silent connection receives nothing and is not pinged, but stays open', async () => {
    app = createApp({ staticDir, tickMs: 20, heartbeatMs: 40, version: TEST_VERSION });
    const port = await listen(app);
    const client = collectMessages(`ws://127.0.0.1:${port}/ws?probe=silent`);
    await client.opened();

    // Wait several heartbeat rounds so an erroneous send has every chance to
    // arrive. The assertion below is on absence, not on completing within
    // this window, so a slower machine only makes the wait more generous —
    // it can never turn a real send into a false pass.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(client.messages()).toEqual([]);
    expect(client.pingCount()).toBe(0);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.socket.close();
  }, 10000);
});

describe('ping', () => {
  it('ping: a normal connection is pinged by the server', async () => {
    app = createApp({ staticDir, tickMs: 20, heartbeatMs: 40, version: TEST_VERSION });
    const port = await listen(app);
    const client = collectMessages(`ws://127.0.0.1:${port}/ws`);
    await client.opened();

    const pings = await client.waitForPings(1);
    client.socket.close();

    expect(pings).toBeGreaterThanOrEqual(1);
  }, 10000);
});

describe('dead peer', () => {
  it('dead peer: a connection that never answers a ping is terminated', async () => {
    app = createApp({ staticDir, tickMs: 20, heartbeatMs: 40, version: TEST_VERSION });
    const port = await listen(app);
    // autoPong: false — this client never answers the server's protocol
    // ping, so it must look dead to the heartbeat round.
    const client = collectMessages(`ws://127.0.0.1:${port}/ws?probe=quiet`, { autoPong: false });
    await client.opened();

    const closeCode = await new Promise<number>((resolve) => {
      client.socket.once('close', (code) => resolve(code));
    });

    // terminate() tears down the raw socket without a close handshake — this
    // asserts termination happened at all, not on which round it landed.
    expect(typeof closeCode).toBe('number');
  }, 10000);
});

describe('shutdown', () => {
  it('shutdown: close() resolves and every connection, in every mode, sees close code 1001', async () => {
    app = createApp({ staticDir, tickMs: 20, heartbeatMs: 40, version: TEST_VERSION });
    const port = await listen(app);
    const normal = collectMessages(`ws://127.0.0.1:${port}/ws`);
    const quiet = collectMessages(`ws://127.0.0.1:${port}/ws?probe=quiet`);
    const silent = collectMessages(`ws://127.0.0.1:${port}/ws?probe=silent`);
    await Promise.all([normal.opened(), quiet.opened(), silent.opened()]);

    const closeCodes = Promise.all(
      [normal, quiet, silent].map(
        (client) => new Promise<number>((resolve) => client.socket.once('close', (code) => resolve(code))),
      ),
    );

    await app.close();
    closed = true;

    expect(await closeCodes).toEqual([1001, 1001, 1001]);
  }, 10000);
});

describe('upgrade not swallowed', () => {
  it('upgrade not swallowed: only /ws completes the handshake, other paths behave correctly', async () => {
    app = createApp({ staticDir, tickMs: 1000, version: TEST_VERSION });
    const port = await listen(app);
    const baseUrl = `http://127.0.0.1:${port}`;

    const wsClient = collectTicks(`ws://127.0.0.1:${port}/ws`);
    await wsClient.opened();
    wsClient.socket.close();

    await new Promise<void>((resolve, reject) => {
      const other = new WebSocket(`ws://127.0.0.1:${port}/other`);
      const timer = setTimeout(() => reject(new Error('expected /other to error or close')), 2000);
      other.once('open', () => {
        clearTimeout(timer);
        reject(new Error('/other should never open'));
      });
      other.once('error', () => {
        clearTimeout(timer);
        resolve();
      });
      other.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const wsGetRes = await fetch(`${baseUrl}/ws`);
    expect(wsGetRes.status).toBe(426);

    const deepRes = await fetch(`${baseUrl}/some/deep/route`);
    expect(deepRes.status).toBe(200);
    expect(deepRes.headers.get('cache-control')).toContain('no-cache');
    const deepBody = await deepRes.text();
    expect(deepBody).toContain('id="root"');

    const assetRes = await fetch(`${baseUrl}/assets/app-abc123.js`);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get('cache-control')).toContain('immutable');
  });

  it('close() resolves and connected clients see close code 1001', async () => {
    app = createApp({ staticDir, tickMs: 1000, version: TEST_VERSION });
    const port = await listen(app);
    const client = collectTicks(`ws://127.0.0.1:${port}/ws`);
    await client.opened();

    const closeCode = new Promise<number>((resolve) => {
      client.socket.once('close', (code) => resolve(code));
    });

    await app.close();
    closed = true;
    expect(await closeCode).toBe(1001);
  });
});
