import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@strike-desk/shared/engine';
import type { Harness, TestClient } from './harness';
import { TEST_ASSET_PATH, TEST_VERSION, startHarness } from './harness';

/**
 * The service phase 1 built, still standing: the page, the health check, the
 * upgrade handler, the heartbeat and a clean shutdown. Every round the server
 * runs is driven by hand from the fake clock, so no test here waits for a
 * duration and then asserts.
 */

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
const HEARTBEAT = { type: 'hb' };
/**
 * Long enough that its timer cannot fire inside a test: the rounds these
 * tests care about are the hand-driven ones, and the period is only there so
 * "nothing has been sent for a while" means something.
 */
const HEARTBEAT_MS = 60_000;

let harness: Harness | null = null;

async function boot(overrides: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  harness = await startHarness(overrides);
  return harness;
}

afterEach(async () => {
  await harness?.close();
  harness = null;
});

/** Connect, say hello, and take the lobby frame. */
async function join(to: Harness): Promise<TestClient> {
  const client = to.connect();
  await client.opened();
  client.send(HELLO);
  await client.nextFrame();
  return client;
}

/**
 * Resolves once the server has worked through everything this socket sent
 * before now: the answering pong is written after them. Lets a test assert
 * that something was *not* answered without waiting for a duration.
 */
function roundTrip(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    client.socket.once('pong', () => resolve());
    client.socket.ping();
  });
}

describe('a connection nobody has spoken for', () => {
  it('is sent nothing at all by the sampler, and answers only once it speaks', async () => {
    const running = await boot();
    const client = running.connect();
    await client.opened();

    for (let i = 0; i < 5; i += 1) {
      running.clock.advance(200);
      running.sample();
    }
    await roundTrip(client);
    expect(client.received()).toEqual([]);

    client.sendText('{');
    expect(await client.nextError()).toEqual({ t: 'error', code: 'badMessage' });
    expect(client.received()).toEqual([{ t: 'error', code: 'badMessage' }]);
  });
});

describe('the heartbeat', () => {
  it('goes only to a connection nothing has been sent for the period, and pings every connection', async () => {
    const running = await boot({ heartbeatMs: HEARTBEAT_MS });
    const watching = await join(running);
    const idle = running.connect();
    await idle.opened();

    running.clock.advance(HEARTBEAT_MS);
    running.sample();
    await watching.nextFrame();

    running.heartbeat();
    expect(await idle.nextOther()).toEqual(HEARTBEAT);
    expect(await watching.awaitPings(1)).toBe(1);
    expect(await idle.awaitPings(1)).toBe(1);

    await roundTrip(watching);
    expect(watching.received().filter((message) => !(typeof message === 'object' && message !== null && 't' in message))).toEqual([]);
  });

  it('keeps a connection that is slow to answer one round, and drops one that misses two', async () => {
    const running = await boot();
    // autoPong false: this client never answers the server's ping, so it is
    // exactly the peer that has gone away without saying so.
    const client = running.connect({ socket: { autoPong: false } });
    await client.opened();

    running.heartbeat();
    expect(await client.awaitPings(1)).toBe(1);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);

    running.heartbeat();
    await client.closed();
    expect(client.socket.readyState).toBe(WebSocket.CLOSED);
  });

  it('forgives a connection that does answer, however many rounds pass', async () => {
    const running = await boot();
    const client = running.connect();
    await client.opened();

    for (let round = 1; round <= 4; round += 1) {
      running.heartbeat();
      expect(await client.awaitPings(round)).toBe(round);
      // The pong that `ws` sends back must have reached the server before the
      // next round, or the count this test is about would not be the one
      // being exercised.
      await roundTrip(client);
    }
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe('the measurement-only connection modes', () => {
  it('ignores the probe query unless this instance was started for a measurement', async () => {
    const running = await boot();
    const client = running.connect({ search: 'probe=silent' });
    await client.opened();

    client.send(HELLO);
    expect((await client.nextFrame()).clock.phase).toBe('lobby');

    running.heartbeat();
    expect(await client.awaitPings(1)).toBe(1);
  });

  it('with the modes on, a silent connection is sent nothing, is not pinged, and stays open', async () => {
    const running = await boot({ probeModes: true });
    const silent = running.connect({ search: 'probe=silent' });
    const ordinary = running.connect();
    await Promise.all([silent.opened(), ordinary.opened()]);
    silent.send(HELLO);

    running.heartbeat();
    // The ordinary connection is the witness that the round happened at all.
    expect(await ordinary.awaitPings(1)).toBe(1);
    await roundTrip(silent);

    expect(silent.received()).toEqual([]);
    expect(silent.pings()).toBe(0);
    expect(silent.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('with the modes on, a quiet connection is pinged and sees the heartbeat, and the door never answers it', async () => {
    const running = await boot({ probeModes: true });
    const quiet = running.connect({ search: 'probe=quiet' });
    await quiet.opened();

    quiet.send(HELLO);
    await roundTrip(quiet);

    running.heartbeat();
    expect(await quiet.nextOther()).toEqual(HEARTBEAT);
    expect(await quiet.awaitPings(1)).toBe(1);
    expect(quiet.received()).toEqual([HEARTBEAT]);
  });
});

describe('the page and the health check', () => {
  it('healthz answers 200 with ok, the build commit and the build time, and nothing else', async () => {
    const running = await boot();

    const getRes = await fetch(`${running.baseUrl}/healthz`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toContain('application/json');
    const body: unknown = await getRes.json();
    expect(body).toEqual({ ok: true, commit: TEST_VERSION.commit, buildTime: TEST_VERSION.buildTime });
    expect(Object.keys(body as object).sort()).toEqual(['buildTime', 'commit', 'ok']);

    const postRes = await fetch(`${running.baseUrl}/healthz`, { method: 'POST' });
    expect(postRes.status).toBe(405);
  });

  it('serves the page and its asset with the right cache headers, and answers 426 on a plain GET of the socket path', async () => {
    const running = await boot();

    const deepRes = await fetch(`${running.baseUrl}/some/deep/route`);
    expect(deepRes.status).toBe(200);
    expect(deepRes.headers.get('cache-control')).toContain('no-cache');
    expect(await deepRes.text()).toContain('id="root"');

    const assetRes = await fetch(`${running.baseUrl}${TEST_ASSET_PATH}`);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get('cache-control')).toContain('immutable');

    const wsGetRes = await fetch(`${running.baseUrl}/ws`);
    expect(wsGetRes.status).toBe(426);
  });

  it('the build version reaches the page, never the wire', async () => {
    const running = await boot({ heartbeatMs: HEARTBEAT_MS });
    const client = running.connect();
    await client.opened();
    client.send(HELLO);
    await client.nextFrame();

    running.clock.advance(HEARTBEAT_MS);
    running.heartbeat();
    await client.nextOther();

    const wire = JSON.stringify(client.received());
    expect(wire).not.toContain(TEST_VERSION.commit);
    expect(wire).not.toContain(TEST_VERSION.buildTime);
  });
});

describe('the upgrade handler', () => {
  it('completes a handshake on the socket path and on no other', async () => {
    const running = await boot();
    const client = running.connect();
    await client.opened();
    await client.close();

    await new Promise<void>((resolve, reject) => {
      const other = new WebSocket(`${running.url.replace('/ws', '')}/other`);
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
  });
});

describe('shutdown', () => {
  it('close() resolves and every connection, in every mode, sees close code 1001', async () => {
    const running = await boot({ probeModes: true });
    const normal = running.connect();
    const quiet = running.connect({ search: 'probe=quiet' });
    const silent = running.connect({ search: 'probe=silent' });
    await Promise.all([normal.opened(), quiet.opened(), silent.opened()]);

    const closeCodes = Promise.all([normal.closed(), quiet.closed(), silent.closed()]);
    await running.close();
    harness = null;

    expect(await closeCodes).toEqual([1001, 1001, 1001]);
  });

  it('close() resolves with a session in play, and that connection sees 1001 too', async () => {
    const running = await boot();
    const client = await join(running);

    const closeCode = client.closed();
    await running.close();
    harness = null;

    expect(await closeCode).toBe(1001);
  });
});
