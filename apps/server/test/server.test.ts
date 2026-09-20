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
