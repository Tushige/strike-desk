import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import sirv from 'sirv';
import { HEALTH_PATH, SAMPLE_INTERVAL_MS, WS_PATH } from '@strike-desk/shared';
import type { Connection } from './door';
import { handleClosed, handleInbound } from './door';
import type { FrameSocket } from './sampler';
import { sampleSessions } from './sampler';
import { drawSeed, drawSessionId } from './seed';
import { createRegistry } from './sessions';

export interface BuildVersion {
  /** First 7 characters of the commit the build was made from. */
  commit: string;
  /** ISO 8601 UTC time of the build, seconds precision, for example 2026-09-20T01:02:03Z. */
  buildTime: string;
}

export interface AppOptions {
  /** Absolute path of the built web files (apps/web/dist). */
  staticDir: string;
  /** Milliseconds between ticks. Default 1000. Tests pass a small value. */
  tickMs?: number;
  /**
   * Stamped once at build time by scripts/write-version.mjs, never read from
   * the clock or the environment here — a free instance waking from sleep
   * restarts this process without a new build.
   */
  version: BuildVersion;
  /** Milliseconds between heartbeat rounds. Default 20000. Tests pass a small value. */
  heartbeatMs?: number;
  /**
   * The clock every session runs on, in milliseconds. It must never go back.
   * Default `performance.now()`. Tests pass one that only moves when told to.
   */
  now?: () => number;
  /** Milliseconds between sampling passes. Default SAMPLE_INTERVAL_MS. 0 makes no timer: `sampleOnce` is then called by hand. */
  sampleMs?: number;
  /** Draws a new game's seed. Default: the crypto source. Tests pass fixed seeds. */
  drawSeed?: () => number;
}

export interface App {
  server: Server;
  wss: WebSocketServer;
  /**
   * One sampling pass at `nowMs`: a frame for every session somebody is
   * watching. The timer calls this; a test calls it directly.
   */
  sampleOnce(nowMs: number): void;
  /** Stops the timers, closes every client with code 1001, closes both servers. */
  close(): Promise<void>;
}

/**
 * `/ws` (no `probe` value, or an unknown one): normal, receives ticks, is
 * pinged. `/ws?probe=quiet`: no ticks, is pinged and receives the heartbeat
 * message. `/ws?probe=silent`: receives nothing at all and is not pinged —
 * the baseline for the host idle-timeout measurement.
 */
type ConnMode = 'normal' | 'quiet' | 'silent';

interface ConnState {
  mode: ConnMode;
  /** `Date.now()` of the last frame sent to this connection. */
  lastSendMs: number;
  /** True once the current round's ping has been answered by a pong. */
  alive: boolean;
}

const HB_PAYLOAD = JSON.stringify({ type: 'hb' });
/** Close code for "the server hit something it did not expect". */
const CLOSE_INTERNAL_ERROR = 1011;

function toText(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString();
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  return Buffer.from(data).toString();
}

function modeFromUrl(url: URL): ConnMode {
  const probe = url.searchParams.get('probe');
  if (probe === 'quiet') return 'quiet';
  if (probe === 'silent') return 'silent';
  return 'normal';
}

export function createApp(options: AppOptions): App {
  const tickMs = options.tickMs ?? 1000;
  const heartbeatMs = options.heartbeatMs ?? 20000;
  const sampleMs = options.sampleMs ?? SAMPLE_INTERVAL_MS;
  const now = options.now ?? (() => performance.now());

  const registry = createRegistry({ drawSeed: options.drawSeed ?? drawSeed, drawId: drawSessionId });
  const door = { registry, now };
  const samplerStats = { sent: 0, skipped: 0 };

  const serveStatic = sirv(options.staticDir, {
    single: true,
    etag: true,
    dev: false,
    setHeaders(res, pathname) {
      if (pathname.startsWith('/assets/')) {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('cache-control', 'no-cache');
      }
    },
  });

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    try {
      if (req.url === HEALTH_PATH) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, commit: options.version.commit, buildTime: options.version.buildTime }));
        return;
      }

      if (req.url === WS_PATH) {
        res.writeHead(426);
        res.end('Upgrade Required');
        return;
      }

      serveStatic(req, res);
    } catch {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  const server = createServer(handleRequest);

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });

  const connections = new Map<WebSocket, ConnState>();

  /** Routes every send through here so `lastSendMs` is always accurate. */
  function sendTo(ws: WebSocket, state: ConnState, payload: string): void {
    ws.send(payload);
    state.lastSendMs = Date.now();
  }

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    const mode = modeFromUrl(url);

    wss.handleUpgrade(req, socket, head, (ws) => {
      const state: ConnState = { mode, lastSendMs: Date.now(), alive: true };
      connections.set(ws, state);

      ws.on('pong', () => {
        state.alive = true;
      });
      // What the door and the sampler hold: every send still goes through
      // `sendTo`, so the heartbeat knows when this socket last heard anything.
      const frameSocket: FrameSocket = {
        OPEN: ws.OPEN,
        get readyState() {
          return ws.readyState;
        },
        get bufferedAmount() {
          return ws.bufferedAmount;
        },
        send(text: string) {
          sendTo(ws, state, text);
        },
      };
      const connection: Connection = { socket: frameSocket, sessionId: null };

      ws.on('message', (data, isBinary) => {
        // The probe modes only listen.
        if (mode !== 'normal') return;
        try {
          // Binary is never part of the contract: it goes to the door as text that cannot parse.
          handleInbound(door, connection, isBinary ? '' : toText(data));
        } catch {
          // Nothing a client sends may take the process down.
          ws.close(CLOSE_INTERNAL_ERROR);
        }
      });
      ws.on('error', () => {
        // `ws` reports a frame over `maxPayload` (and any other protocol
        // error) here and closes the socket itself. Without a listener the
        // event would be unhandled.
      });
      ws.on('close', () => {
        connections.delete(ws);
        handleClosed(door, connection);
      });

      if (mode === 'normal') {
        sendTo(ws, state, JSON.stringify({ type: 'tick', tick }));
      }

      wss.emit('connection', ws, req);
    });
  });

  let tick = 0;

  const interval = setInterval(() => {
    tick += 1;
    const payload = JSON.stringify({ type: 'tick', tick });
    for (const [ws, state] of connections) {
      if (state.mode !== 'normal') continue;
      if (ws.readyState === ws.OPEN) {
        sendTo(ws, state, payload);
      }
    }
  }, tickMs);

  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const [ws, state] of connections) {
      if (state.mode === 'silent') continue;
      if (!state.alive) {
        ws.terminate();
        continue;
      }
      state.alive = false;
      ws.ping();
      if (now - state.lastSendMs >= heartbeatMs) {
        sendTo(ws, state, HB_PAYLOAD);
      }
    }
  }, heartbeatMs);

  function sampleOnce(nowMs: number): void {
    sampleSessions(registry, nowMs, samplerStats);
  }

  // One timer for every session; no game has a timer of its own. A pass is
  // synchronous today, so passes cannot overlap; the flag keeps a late timer
  // from piling them up if a pass ever comes to wait on something.
  let sampling = false;
  const sampleTimer =
    sampleMs > 0
      ? setInterval(() => {
          if (sampling) return;
          sampling = true;
          try {
            sampleOnce(now());
          } finally {
            sampling = false;
          }
        }, sampleMs)
      : null;

  async function close(): Promise<void> {
    clearInterval(interval);
    clearInterval(heartbeatTimer);
    if (sampleTimer !== null) clearInterval(sampleTimer);
    for (const ws of connections.keys()) {
      ws.close(1001);
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { server, wss, sampleOnce, close };
}
