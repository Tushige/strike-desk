import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@strike-desk/shared/engine';
import { DEV_ORIGINS, originAllowed } from '../src/origin';
import type { Harness, TestClient } from './harness';
import { FIXED_SEEDS, startHarness } from './harness';

/**
 * The same-origin policy does not apply to WebSockets: any page on any site
 * can make a visitor's browser open one to this service. The rule below is
 * the only thing that stops it, and the case it must never refuse is the
 * client with no Origin header at all — the end-to-end check, the measurement
 * scripts and every other non-browser client send none.
 */

const HOST = 'strike-desk.onrender.com';
const HELLO = { t: 'hello', v: PROTOCOL_VERSION };

describe('the origin rule', () => {
  it('lets a client that sends no Origin through', () => {
    expect(originAllowed({ origin: undefined, host: HOST, forwardedHost: undefined })).toBe(true);
    expect(originAllowed({ origin: '', host: HOST, forwardedHost: undefined })).toBe(true);
  });

  it('lets the page this very host served through, on either scheme', () => {
    expect(originAllowed({ origin: `https://${HOST}`, host: HOST, forwardedHost: undefined })).toBe(true);
    expect(originAllowed({ origin: `http://${HOST}`, host: HOST, forwardedHost: undefined })).toBe(true);
    expect(originAllowed({ origin: 'http://127.0.0.1:10000', host: '127.0.0.1:10000', forwardedHost: undefined })).toBe(true);
  });

  it('lets a page through when a proxy carries the public address in X-Forwarded-Host', () => {
    expect(originAllowed({ origin: `https://${HOST}`, host: 'internal-10-0-0-4:10000', forwardedHost: HOST })).toBe(true);
    // A chain of proxies sends a list; the first entry is the address the
    // browser actually asked for.
    expect(originAllowed({ origin: `https://${HOST}`, host: 'internal-10-0-0-4:10000', forwardedHost: `${HOST}, inner.proxy` })).toBe(true);
  });

  it('lets the two development origins through', () => {
    expect(DEV_ORIGINS).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
    for (const origin of DEV_ORIGINS) {
      expect(originAllowed({ origin, host: '127.0.0.1:10000', forwardedHost: undefined })).toBe(true);
    }
  });

  const REFUSED: [string, string][] = [
    ['another site altogether', 'https://evil.example'],
    ['the right host on another port', `https://${HOST}:8443`],
    ['the right host with a path on the end', `https://${HOST}/evil`],
    ['the right host as the start of a longer name', `https://${HOST}.evil.example`],
    ['the right host as the end of a longer name', `https://evil.${HOST}`],
    ['a development origin as the start of a longer name', 'http://localhost:5173.evil.example'],
    ['a development origin on another port', 'http://localhost:5174'],
    ['the word null, which a sandboxed page sends', 'null'],
    ['text that is not an address at all', 'not an origin'],
    ['another scheme', `ws://${HOST}`],
    ['a file on the visitor\'s own machine', 'file:///tmp/evil.html'],
  ];

  it.each(REFUSED)('refuses %s', (_name, origin) => {
    expect(originAllowed({ origin, host: HOST, forwardedHost: HOST })).toBe(false);
  });

  it('refuses any present origin when the request names no host at all', () => {
    expect(originAllowed({ origin: `https://${HOST}`, host: undefined, forwardedHost: undefined })).toBe(false);
    expect(originAllowed({ origin: `https://${HOST}`, host: '', forwardedHost: '' })).toBe(false);
  });
});

let harness: Harness | null = null;
/** How many seeds have been drawn. Making a session is the only thing that draws one. */
let sessionsMade = 0;

async function boot(): Promise<Harness> {
  sessionsMade = 0;
  harness = await startHarness({
    drawSeed: () => {
      const seed = FIXED_SEEDS[sessionsMade % FIXED_SEEDS.length] ?? 0;
      sessionsMade += 1;
      return seed;
    },
  });
  return harness;
}

afterEach(async () => {
  await harness?.close();
  harness = null;
  vi.restoreAllMocks();
});

/** The address the client asks for, which is what it puts in its Host header. */
function hostOf(running: Harness): string {
  return new URL(running.url).host;
}

/**
 * Resolves when the socket is refused, whichever way the refusal reaches the
 * client: a destroyed connection surfaces as an error or as a close, and
 * either is a refusal. Rejects if it ever opens.
 */
function neverOpens(client: TestClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the socket neither opened nor was refused within 5000 ms')), 5000);
    client.socket.once('open', () => {
      clearTimeout(timer);
      reject(new Error('a foreign origin must never reach open'));
    });
    client.socket.once('error', () => {
      clearTimeout(timer);
      resolve();
    });
    client.socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Connect with the given origin, say hello and take the lobby frame. */
async function join(running: Harness, origin?: string): Promise<TestClient> {
  const client = running.connect(origin === undefined ? {} : { socket: { origin } });
  await client.opened();
  client.send(HELLO);
  expect((await client.nextFrame()).clock.phase).toBe('lobby');
  return client;
}

describe('the origin of an upgrade, at the real service', () => {
  it('a client with no Origin opens and is answered, exactly as the end-to-end check needs', async () => {
    const running = await boot();
    await join(running);
    expect(sessionsMade).toBe(1);
  });

  it('a page served by this host opens and is answered', async () => {
    const running = await boot();
    await join(running, `http://${hostOf(running)}`);
    expect(sessionsMade).toBe(1);
  });

  it('a page on another site never opens, makes no session, and is logged by its origin alone', async () => {
    const running = await boot();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const refused = running.connect({ socket: { origin: 'https://evil.example' } });
    await neverOpens(refused);

    expect(warn.mock.calls).toEqual([['ws origin refused', 'https://evil.example']]);
    expect(sessionsMade).toBe(0);

    // The refusal costs the next visitor nothing: the service is still serving.
    await join(running);
    expect(sessionsMade).toBe(1);
  });
});
